import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import { KIT_ROOT, DATA_DIR, tenantDir, ensureDataDirs } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "./tracker";
import { emitEvent, endRun } from "@/lib/events";
import { saveRun } from "@/lib/runStore";
import { currentTenantId, runInTenant } from "@/lib/db/tenantContext";
import { isStopRequested, clearStop, markActive, markDone } from "@/lib/procRegistry";
import { startHeartbeat, stopHeartbeat } from "@/lib/qa/heartbeat";
import { runFeatureFanout } from "./fanout";
import { setupConfiguredDb, type DbInjection } from "./dbInject";
import type { AppConfig, RunMode, RunRecord } from "@/lib/types";

export interface RunInput {
  mode: RunMode;
  appUrl?: string;
  workItemId?: string;
  steps?: Array<Record<string, string>>;
  vars?: Record<string, string>;
  declaredAcs?: string[]; // AC declarados de la HU → matriz de cobertura en el reporte
  // --- modo "code" (QA del código) ---
  sourcePath?: string; // ruta del repo a analizar (relativa a CODE_QA_BASE_DIR)
  layers?: string[]; // subconjunto de capas static/unit/api/db/security (vacío = detectadas)
  featureId?: string; // FT padre (traza la carpeta de evidencia)
  developer?: string; // dev responsable (traza la carpeta de evidencia)
  useConfiguredDb?: boolean; // inyectar la BD configurada (módulo BD) al entorno de las pruebas
}

/**
 * Mensaje de error legible que NO pierde la causa real. `fetch` (undici) lanza un escueto
 * "fetch failed" y esconde el motivo en `e.cause` (p.ej. ECONNRESET, ENOTFOUND, ETIMEDOUT).
 * Lo desempaquetamos para que el reporte/consola muestren el código real y sea diagnosticable.
 */
function describeError(e: any): string {
  const msg = String(e?.message ?? e);
  const cause = e?.cause;
  if (cause) {
    const code = cause.code ?? cause.errno;
    const cmsg = cause.message ?? String(cause);
    const detail = [code, cmsg && cmsg !== msg ? cmsg : null].filter(Boolean).join(" · ");
    if (detail) return `${msg} (${detail})`;
  }
  return msg;
}

function runId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${Math.floor(Math.random() * 10000)}`;
}

function titleFor(input: RunInput): string {
  if (input.mode === "code") return `Analizar código → ${input.sourcePath || "?"}`;
  const flow = Array.isArray(input.steps) && input.steps.length > 0;
  return `Explorar${flow ? " (flujo)" : ""} → ${input.appUrl || "?"}`;
}

/** Construye el perfil efectivo (default ← preset del tracker) sin tocar el repo. */
export async function buildProfile(tracker: string): Promise<any> {
  const { resolveProfile } = await importKit("runtime/profile/resolve-profile.mjs");
  ensureDataDirs();
  const tmpDir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `profile-${Date.now()}-${Math.floor(Math.random() * 1e6)}.yaml`);
  const lines: string[] = [];
  if (tracker && tracker !== "local") lines.push(`profile: ${tracker}`);
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  try {
    const { profile } = resolveProfile({ repoRoot: KIT_ROOT, projectProfilePath: file });
    return profile;
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* noop */
    }
  }
}

/** env para el ciclo: credenciales del tracker (la exploración no usa BD). */
export async function buildEnv(cfg: AppConfig): Promise<Record<string, string>> {
  return { ...(process.env as Record<string, string>), ...trackerEnv(cfg.tracker) };
}

/** Crea el run y lo arranca en segundo plano (fire-and-forget). Devuelve el registro inicial. */
export async function startRun(input: RunInput): Promise<RunRecord> {
  const cfg = await loadConfig();
  const tracker = cfg.tracker.selected;
  const id = runId();
  const now = new Date().toISOString();
  const record: RunRecord = {
    id,
    createdAt: now,
    startedAt: now,
    status: "running",
    mode: input.mode,
    tracker,
    title: titleFor(input),
    appUrl: input.appUrl,
    sourcePath: input.sourcePath,
    workItemId: input.workItemId?.trim() || undefined,
  };
  await saveRun(record); // la fila del run debe existir antes de emitir eventos (FK run_events)
  // La corrida es fire-and-forget tras responder: re-abre el contexto de tenant con un
  // snapshot, para que saveRun/eventos en background queden scopeados por RLS al tenant dueño.
  const tenantId = currentTenantId();
  // Este proceso pasa a ser DUEÑO de la corrida: la marca activa y late su heartbeat mientras corre.
  // Si el proceso muere, markDone/stopHeartbeat no llegan a correr → el heartbeat se congela y la
  // reconciliación perezosa la cerrará como huérfana (en vez de quedar `running` para siempre).
  markActive(id);
  const beat = startHeartbeat(id, tenantId);
  void runInTenant(tenantId, () => execute(record, input, cfg)).finally(() => {
    stopHeartbeat(beat);
    markDone(id);
  });
  return record;
}

async function execute(record: RunRecord, input: RunInput, cfg: AppConfig): Promise<void> {
  const id = record.id;
  const tracker = cfg.tracker.selected;
  emitEvent(id, "system", `Iniciando ciclo · modo ${record.mode} · tracker ${tracker}`);
  // Modo "QA del código": ruta aparte y autónoma. NO toca el camino E2E/PR de abajo.
  if (input.mode === "code") return executeCode(record, input, cfg);
  try {
    const { runQaCycle } = await importKit("runtime/orchestrator.mjs");

    emitEvent(id, "info", "Resolviendo perfil y entorno…");
    const profile = await buildProfile(tracker);
    const env = await buildEnv(cfg);

    // Explorar: sin repo del usuario. La evidencia/capturas caen bajo
    // data/tenants/<tenantId>/evidence/<runId> (aislada por tenant en disco) e inyectamos
    // el navegador real (Playwright).
    const repoRoot = path.join(tenantDir(currentTenantId()), "evidence", id);
    fs.mkdirSync(repoRoot, { recursive: true });
    record.repoRoot = repoRoot;
    await saveRun(record);
    let launchBrowser: (() => Promise<any>) | undefined;
    try {
      const pw: any = await import("playwright");
      const chromium = pw.chromium ?? pw.default?.chromium;
      if (!chromium) throw new Error("playwright.chromium no disponible");
      launchBrowser = () => chromium.launch();
      emitEvent(id, "info", "Navegador Playwright listo para explorar la URL.");
    } catch (e: any) {
      emitEvent(id, "stderr", `Playwright no disponible: ${e?.message ?? e}. La exploración se omitirá.`);
    }
    // Fuente de axe-core (accesibilidad, SOLO modo Explorar URL): se carga desde el node_modules de la
    // webapp y se inyecta al motor como `axeSource` (el motor es cero-dependencias). Si no está, la
    // accesibilidad simplemente no corre (queda en silencio) → la QA de código nunca la ve.
    let axeSource: string | undefined;
    try {
      const axe: any = await import("axe-core");
      axeSource = axe.source ?? axe.default?.source;
    } catch {
      /* axe-core no instalado → sin análisis de accesibilidad */
    }

    if (isStopRequested(id)) {
      emitEvent(id, "error", "Detenido por el usuario.");
      record.status = "error";
      record.finishedAt = new Date().toISOString();
      await saveRun(record);
      return;
    }

    // Con pasos → GUION (flujo E2E): la URL viaja como primer paso, no como appUrl. El WI real
    // (no "local") comenta la evidencia y traza el caso (tcId) para el attach en ADO.
    const manualFlow = Array.isArray(input.steps) && input.steps.length > 0;
    const workItemId = input.workItemId?.trim() || "local";

    // ¿Fan-out de Feature? Solo azure con WI real: si el WI destino es un Feature, se recorre cada
    // HU hija y se corre su guion GUARDADO (sin guion → esa HU se salta). Una HU sola sin guion
    // manual cae al smoke de la URL (más abajo); ya NO se autogenera nada desde los AC ni con IA.
    let fanout: any = null;
    if (tracker === "azure-devops" && workItemId !== "local") {
      try {
        const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
        const adapter = getAdapter({ profile, env, repoRoot });
        const wi = await adapter.getWorkItem(workItemId);

        if (wi?.type === "Feature") {
          emitEvent(id, "system", `WI ${workItemId} es un Feature → fan-out por HU hija (guion guardado de cada una).`);
          fanout = await runFeatureFanout(workItemId, {
            runQaCycle,
            getChildren: (fid: string) => adapter.getChildren(fid),
            // AC declarados de CADA HU hija → su matriz de cobertura (detecta "sin cubrir").
            getDeclaredAcs: async (cid: string) => {
              const child = await adapter.getWorkItem(cid).catch(() => null);
              return (child?.acceptance_criteria || [])
                .map((a: any) => (typeof a === "string" ? a : a?.title))
                .filter((t: any) => t && String(t).trim() !== "");
            },
            profile,
            env,
            repoRoot,
            launchBrowser,
            axeSource,
            vars: input.vars || {},
            // URL adjunta a la corrida → habilita el login-smoke en HU frontend SIN guion guardado
            // (abre la URL + login + captura por paso). Sin URL, esas HU se saltan como antes.
            appUrl: input.appUrl,
            emit: (lvl: string, msg: string) => emitEvent(id, lvl as any, msg),
          });

          // Comentario de RESUMEN de la corrida en el FEATURE (padre), además de la evidencia por
          // HU. Espeja lo que hace "QA del código" en su WI: quien mira el Feature ve el resultado
          // de la ejecución (qué HU pasó/falló/se omitió) sin abrir cada hija. Best-effort: si el
          // comentario falla, la corrida NO se cae (la evidencia por HU ya se publicó).
          try {
            const { renderFanoutSummary } = await importKit("runtime/evidence/fanout-comment.mjs");
            const html = renderFanoutSummary({ feature: workItemId, hus: fanout.hus });
            const c = await adapter.commentWorkItem(workItemId, html);
            if (c?.ok) emitEvent(id, "info", `Resumen de la ejecución comentado en el Feature ${workItemId}.`);
            else emitEvent(id, "stderr", `No se pudo comentar el resumen en el Feature ${workItemId}: ${c?.reason ?? "?"}`);
          } catch (e: any) {
            emitEvent(id, "stderr", `Resumen del Feature no publicado: ${describeError(e)}`);
          }
        }
      } catch (e: any) {
        emitEvent(id, "stderr", `No se pudo evaluar el fan-out: ${describeError(e)}. Sigo como corrida única.`);
      }
    }

    // Guion efectivo de la corrida única: solo el manual (sin autogeneración).
    const flowToRun = manualFlow ? input.steps! : null;
    const useFlow = Array.isArray(flowToRun) && flowToRun.length > 0;
    const declaredAcsToRun = input.declaredAcs || [];

    let summary: any;
    if (fanout) {
      summary = fanout;
      record.status = !fanout.anyRun ? "error" : fanout.anyFail ? "failed" : "passed";
      if (!fanout.anyRun) {
        const bk = fanout.backendSkipped || 0;
        const fe = fanout.frontendNoGuion || 0;
        const parts: string[] = [];
        if (bk) parts.push(`${bk} backend (no se prueban por navegador)`);
        if (fe) parts.push(`${fe} frontend sin guion guardado`);
        const detail = parts.length ? ` De ${fanout.hus.length} HU: ${parts.join(" y ")}.` : "";
        emitEvent(
          id,
          "error",
          `No se ejecutó ninguna prueba.${detail} El brief te dice QUÉ validar; para EJECUTAR necesitás un guion: armalo (o usá «🧩 Generar andamiaje» en el paso «Desde un PR») y guardalo en las HU frontend, luego volvé a correr.`,
        );
      }
      emitEvent(id, "result", `Fan-out terminado: ${record.status} · ${fanout.hus.length} HU(s).`);
    } else {
      emitEvent(id, "info", useFlow ? `Ejecutando flujo de ${flowToRun!.length} paso(s)…` : `Explorando ${input.appUrl}…`);
      summary = await runQaCycle({
        repoRoot,
        env,
        profile,
        workItemId,
        appUrl: useFlow ? undefined : input.appUrl,
        flow: useFlow ? flowToRun : undefined,
        vars: input.vars || {},
        tcId: workItemId !== "local" ? workItemId : undefined,
        declaredAcs: declaredAcsToRun,
        explore: true,
        launchBrowser,
        axeSource,
      });
      for (const w of summary.warnings || []) emitEvent(id, "stderr", `⚠ ${w}`);
      const fails = (summary.results || []).filter((r: any) => r.status === "fail").length;
      record.status = summary.stopped ? "error" : fails ? "failed" : "passed";
      emitEvent(id, "result", `Ciclo terminado: ${record.status} · ${fails} fallo(s).`);
      const local = summary.report?.local || summary.report;
      if (local?.htmlPath) emitEvent(id, "info", `Reporte: ${local.htmlPath}`);
    }

    record.summary = summary;
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
  } catch (e: any) {
    record.status = "error";
    record.error = describeError(e);
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
    emitEvent(id, "error", `Error: ${record.error}`);
  } finally {
    clearStop(id);
    await endRun(id);
  }
}

/**
 * Ejecuta el modo "QA del código": corre las capas static/unit/api/db/security sobre un repo
 * LOCAL confinado (dentro de CODE_QA_BASE_DIR) y publica la evidencia por el mismo sink que el
 * E2E. Autónomo: no comparte cuerpo con execute() (la espina E2E queda intacta). Sin navegador.
 */
async function executeCode(record: RunRecord, input: RunInput, cfg: AppConfig): Promise<void> {
  const id = record.id;
  const tracker = cfg.tracker.selected;
  let dbInjection: DbInjection | null = null; // conexión + sonda de BD (si se pidió); se cierra en el finally
  try {
    // runCodeCycle se re-exporta desde orchestrator.mjs (ya en la allowlist de importKit) → no se
    // amplía la superficie de kit.ts; el grafo interno del motor se resuelve por import nativo.
    const { runCodeCycle } = await importKit("runtime/orchestrator.mjs");

    emitEvent(id, "info", "Resolviendo perfil y entorno…");
    const profile = await buildProfile(tracker);
    const env = await buildEnv(cfg);

    // BD configurada (opt-in): inyecta la conexión del módulo de BD al entorno de las pruebas → las
    // pruebas de integración (.NET) conectan y se activa la capa `db`. Con SSH abre un túnel (puerto
    // local real) y apunta ahí; se cierra en el finally. Sin BD por defecto → aviso, sigue sin inyectar.
    // La contraseña va SOLO al entorno del proceso hijo (necesario para conectar); nunca al navegador.
    if (input.useConfiguredDb) {
      try {
        dbInjection = await setupConfiguredDb(cfg);
        if (dbInjection) {
          Object.assign(env, dbInjection.env); // vars de conexión → pruebas de integración (capa unit)
          emitEvent(id, "info", dbInjection.info);
        } else {
          emitEvent(id, "stderr", "Se pidió usar la BD configurada, pero no hay una conexión por defecto con host/usuario en el módulo de BD.");
        }
      } catch (e: any) {
        emitEvent(id, "stderr", `No se pudo preparar la BD configurada: ${describeError(e)} — las pruebas usarán su propia configuración.`);
      }
    }

    if (isStopRequested(id)) {
      emitEvent(id, "error", "Detenido por el usuario.");
      record.status = "error";
      record.finishedAt = new Date().toISOString();
      await saveRun(record);
      return;
    }

    const workItemId = input.workItemId?.trim() || "local";
    const layers = Array.isArray(input.layers) && input.layers.length ? input.layers : undefined;
    emitEvent(id, "info", `Analizando código en «${input.sourcePath}»… (detectando capas y corriendo sus herramientas — las pruebas grandes pueden tardar minutos)`);

    // Sin `evidenceRoot` → el motor escribe la evidencia DENTRO del proyecto analizado
    // (<proyecto>/qa-evidence/<fecha>/…), como el modo local-first: queda junto al repo y trazable.
    const summary = await runCodeCycle({
      sourcePath: input.sourcePath,
      env,
      profile,
      workItemId,
      featureId: input.featureId,
      developer: input.developer,
      layers,
      pgQuery: dbInjection?.pgQuery, // sonda directa a Postgres para la capa db (undefined si no hay BD)
      // Progreso en vivo por capa (la corrida es bloqueante; sin esto la UI parece colgada).
      emit: (lvl: string, msg: string) => emitEvent(id, lvl as any, msg),
    });

    // La evidencia quedó en <proyecto>/qa-evidence/…: apuntamos repoRoot a esa carpeta del run para
    // que /api/artifacts pueda servir el reporte (el sandbox de artefactos = repoRoot del run).
    const rep = summary.report?.local || summary.report;
    if (rep?.dir) {
      record.repoRoot = rep.dir;
      await saveRun(record);
    }

    for (const w of summary.warnings || []) emitEvent(id, "stderr", `⚠ ${w}`);
    if (summary.stopped === "source") {
      // Gate/confinamiento de ruta rechazó la fuente (CODE_QA_BASE_DIR sin configurar o traversal).
      const msg: string = summary.warnings?.[0] || "No se pudo resolver la ruta de código.";
      record.status = "error";
      record.error = msg;
      emitEvent(id, "error", msg);
    } else {
      const fails = (summary.results || []).filter((r: any) => r.status === "fail").length;
      record.status = summary.stopped ? "error" : fails ? "failed" : "passed";
      const ran = (summary.layersRun || []).join(", ") || "ninguna";
      emitEvent(id, "result", `Análisis terminado: ${record.status} · ${fails} fallo(s) · capas: ${ran}.`);
      const local = summary.report?.local || summary.report;
      if (local?.htmlPath) emitEvent(id, "info", `Reporte: ${local.htmlPath}`);
    }

    record.summary = summary;
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
  } catch (e: any) {
    record.status = "error";
    record.error = describeError(e);
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
    emitEvent(id, "error", `Error: ${record.error}`);
  } finally {
    await dbInjection?.close(); // cierra el cliente pg de la sonda + el túnel SSH (best-effort interno)
    clearStop(id);
    await endRun(id);
  }
}
