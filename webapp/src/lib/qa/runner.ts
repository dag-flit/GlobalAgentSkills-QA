import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import { KIT_ROOT, DATA_DIR, tenantDir, ensureDataDirs } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "./tracker";
import { buildConnectionString } from "@/lib/db/dbClient";
import { openSshTunnel, type Tunnel } from "@/lib/db/sshTunnel";
import { emitEvent, endRun } from "@/lib/events";
import { makeBddGenerator } from "./bdd-generator";
import { saveRun } from "@/lib/runStore";
import { currentTenantId, runInTenant } from "@/lib/db/tenantContext";
import { isStopRequested, clearStop } from "@/lib/procRegistry";
import type { AppConfig, RunMode, RunRecord } from "@/lib/types";

export interface RunInput {
  mode: RunMode;
  repoRoot?: string;
  layers?: string[];
  appUrl?: string;
  featureId?: string;
  huIds?: string[];
  generate?: boolean;          // generar tests desde los criterios
  approvedTcKeys?: string[];   // claves "<huId>:<TC-AC#>" aprobadas en la revisión
  templateCases?: { template: string; params?: Record<string, string>; huId: string }[]; // casos adicionales (plantillas)
}

/** Capas efectivas para código (Ruta B): fuerza la capa `bdd` que ejecuta los `.feature` generados. */
function withBddLayer(layers: string[]): string[] {
  return Array.from(new Set([...layers, "bdd"]));
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

function titleFor(input: RunInput, tracker: string): string {
  if (input.mode === "explore") return `Explorar → ${input.appUrl || "?"}`;
  // code
  if (input.featureId) return `QA código · Feature #${input.featureId} · ${tracker}`;
  return `QA código · ${tracker}`;
}

/** Construye el perfil efectivo (default ← preset del tracker ← capas elegidas) sin tocar el repo. */
async function buildProfile(tracker: string, layers: string[]): Promise<any> {
  const { resolveProfile } = await importKit("runtime/profile/resolve-profile.mjs");
  ensureDataDirs();
  const tmpDir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `profile-${Date.now()}-${Math.floor(Math.random() * 1e6)}.yaml`);
  const lines: string[] = [];
  if (tracker && tracker !== "local") lines.push(`profile: ${tracker}`);
  lines.push("testing:");
  if (layers.length === 0) {
    lines.push("  layers_enabled: []"); // explícito: ninguna capa de código (modo explore)
  } else {
    lines.push("  layers_enabled:");
    for (const l of layers) lines.push(`    - ${l}`);
  }
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

/** env para el ciclo: credenciales del tracker + DATABASE_URL (con túnel SSH si la capa db corre). */
async function buildEnv(
  cfg: AppConfig,
  layers: string[]
): Promise<{ env: Record<string, string>; tunnel: Tunnel | null }> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...trackerEnv(cfg.tracker) };
  let tunnel: Tunnel | null = null;
  if (layers.includes("db")) {
    const db = cfg.databases.find((d) => d.isDefault) ?? cfg.databases[0];
    if (db) {
      let host = db.host;
      let port = db.port;
      if (db.ssh?.enabled) {
        tunnel = await openSshTunnel(db);
        host = tunnel.localHost;
        port = tunnel.localPort;
      }
      const conn = buildConnectionString({ ...db, host, port });
      env.DATABASE_URL = conn;
      env.PG_CONNECTION = conn;
      env.DB_CONNECTION = conn;
    }
  }
  return { env, tunnel };
}

/**
 * SOLO PLANIFICACIÓN: crea el Plan del Feature + los TC en el tracker (sin ejecutar pruebas).
 * Es la acción "Publicar plan" del paso de Revisión, antes de la ejecución. Devuelve el resumen
 * del plan (testPlan + plan). No abre túnel SSH (no se ejecuta la capa db).
 */
export async function publishPlanOnly(input: RunInput): Promise<any> {
  const cfg = await loadConfig();
  const tracker = cfg.tracker.selected;
  const { runQaCycle } = await importKit("runtime/orchestrator.mjs");
  const layers = withBddLayer(input.layers || []);
  const profile = await buildProfile(tracker, layers);
  const built = await buildEnv(cfg, []); // sin túnel: la planificación no ejecuta db
  try {
    const summary = await runQaCycle({
      repoRoot: input.repoRoot || KIT_ROOT,
      env: built.env,
      profile,
      workItemId: input.featureId || "local",
      featureId: input.featureId,
      huIds: input.huIds,
      generate: !!input.generate,
      generateTests: makeBddGenerator(), // Ruta B: AC → .feature (Gherkin ejecutable)
      approvedTcKeys: input.approvedTcKeys,
      templateCases: input.templateCases, // casos adicionales (plantillas) → TC bajo la HU elegida
      planOnly: true,
    });
    return { ok: true, summary };
  } finally {
    try {
      built.tunnel?.close?.();
    } catch {
      /* noop */
    }
  }
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
    title: titleFor(input, tracker),
    repoRoot: input.repoRoot,
    appUrl: input.appUrl,
    featureId: input.featureId,
    huIds: input.huIds,
    layers: input.layers,
  };
  await saveRun(record); // la fila del run debe existir antes de emitir eventos (FK run_events)
  // La corrida es fire-and-forget tras responder: re-abre el contexto de tenant con un
  // snapshot, para que saveRun/eventos en background queden scopeados por RLS al tenant dueño.
  const tenantId = currentTenantId();
  void runInTenant(tenantId, () => execute(record, input, cfg));
  return record;
}

async function execute(record: RunRecord, input: RunInput, cfg: AppConfig): Promise<void> {
  const id = record.id;
  const tracker = cfg.tracker.selected;
  emitEvent(id, "system", `Iniciando ciclo · modo ${record.mode} · tracker ${tracker}`);
  let tunnel: Tunnel | null = null;
  try {
    const { runQaCycle } = await importKit("runtime/orchestrator.mjs");
    const { defaultExec } = await importKit("runtime/runners/_runner-core.mjs");
    // Ruta B fuerza la capa `bdd` para ejecutar los `.feature` generados.
    const layers = record.mode === "code" ? withBddLayer(input.layers || []) : (input.layers || []);

    emitEvent(id, "info", "Resolviendo perfil y entorno…");
    const profile = await buildProfile(tracker, layers);
    const built = await buildEnv(cfg, layers);
    tunnel = built.tunnel;
    if (tunnel) emitEvent(id, "info", "Túnel SSH abierto para la base de datos.");

    // Modo explorar: sin repo. La evidencia/capturas caen en webapp/data/evidence/<id>
    // (no hay repo del usuario donde ponerlas) e inyectamos el navegador real.
    let repoRoot = input.repoRoot || KIT_ROOT;
    let launchBrowser: (() => Promise<any>) | undefined;
    if (record.mode === "explore") {
      // Evidencia bajo data/tenants/<tenantId>/evidence/<runId> (aislada por tenant en disco).
      repoRoot = path.join(tenantDir(currentTenantId()), "evidence", id);
      fs.mkdirSync(repoRoot, { recursive: true });
      record.repoRoot = repoRoot;
      await saveRun(record);
      try {
        const pw: any = await import("playwright");
        const chromium = pw.chromium ?? pw.default?.chromium;
        if (!chromium) throw new Error("playwright.chromium no disponible");
        launchBrowser = () => chromium.launch();
        emitEvent(id, "info", "Navegador Playwright listo para explorar la URL.");
      } catch (e: any) {
        emitEvent(id, "stderr", `Playwright no disponible: ${e?.message ?? e}. La exploración se omitirá.`);
      }
    }

    // Ejecutor inyectado: emite un evento por herramienta y respeta la solicitud de stop.
    const exec = (cmd: string, args: string[], ctx: any = {}) => {
      if (isStopRequested(id)) {
        emitEvent(id, "error", "Detenido por el usuario.");
        return { code: 130, stdout: "", stderr: "detenido" };
      }
      const base = path.basename(String(cmd));
      const shown = Array.isArray(args) ? args.slice(0, 4).join(" ") : "";
      emitEvent(id, "tool", `▶ ${base} ${shown}`.trim() + (ctx?.cwd ? `  ·  ${ctx.cwd}` : ""));
      const res = defaultExec(cmd, args, ctx);
      emitEvent(id, res.code === 0 ? "result" : "stderr", `   exit ${res.code}`);
      return res;
    };

    // Modo código: traza al Feature si se indicó; si no, reporte local. Explore: local.
    const workItemId = record.mode === "code" ? input.featureId || "local" : "local";

    emitEvent(id, "info", `Capas: ${layers.length ? layers.join(", ") : "(ninguna de código)"}`);
    if (record.mode === "explore") emitEvent(id, "info", `Explorando ${input.appUrl}…`);
    const summary = await runQaCycle({
      repoRoot,
      env: built.env,
      profile,
      workItemId,
      featureId: input.featureId,
      huIds: record.mode === "code" ? input.huIds : undefined,
      generate: record.mode === "code" ? !!input.generate : false,
      generateTests: makeBddGenerator(), // Ruta B: AC → .feature (Gherkin ejecutable)
      approvedTcKeys: record.mode === "code" ? input.approvedTcKeys : undefined,
      templateCases: record.mode === "code" ? input.templateCases : undefined,
      appUrl: input.appUrl,
      explore: record.mode === "explore",
      launchBrowser,
      exec,
    });

    for (const w of summary.warnings || []) emitEvent(id, "stderr", `⚠ ${w}`);

    const fails = (summary.results || []).filter((r: any) => r.status === "fail").length;
    record.status = summary.stopped ? "error" : fails ? "failed" : "passed";
    record.summary = summary;
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
    emitEvent(id, "result", `Ciclo terminado: ${record.status} · ${fails} fallo(s).`);
    const local = summary.report?.local || summary.report;
    if (local?.htmlPath) emitEvent(id, "info", `Reporte: ${local.htmlPath}`);
  } catch (e: any) {
    record.status = "error";
    record.error = describeError(e);
    record.finishedAt = new Date().toISOString();
    await saveRun(record);
    emitEvent(id, "error", `Error: ${record.error}`);
  } finally {
    try {
      tunnel?.close?.();
    } catch {
      /* noop */
    }
    clearStop(id);
    await endRun(id);
  }
}
