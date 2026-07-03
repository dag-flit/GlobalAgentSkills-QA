import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import { KIT_ROOT, DATA_DIR, tenantDir, ensureDataDirs } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "./tracker";
import { emitEvent, endRun } from "@/lib/events";
import { saveRun } from "@/lib/runStore";
import { currentTenantId, runInTenant } from "@/lib/db/tenantContext";
import { isStopRequested, clearStop } from "@/lib/procRegistry";
import { runFeatureFanout } from "./fanout";
import { autogenFlow, hasActionableSteps } from "./autogen";
import type { AppConfig, RunMode, RunRecord } from "@/lib/types";

export interface RunInput {
  mode: RunMode;
  appUrl?: string;
  workItemId?: string;
  steps?: Array<Record<string, string>>;
  vars?: Record<string, string>;
  declaredAcs?: string[]; // AC declarados de la HU → matriz de cobertura en el reporte
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
  const flow = Array.isArray(input.steps) && input.steps.length > 0;
  return `Explorar${flow ? " (flujo)" : ""} → ${input.appUrl || "?"}`;
}

/** Construye el perfil efectivo (default ← preset del tracker) sin tocar el repo. */
async function buildProfile(tracker: string): Promise<any> {
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
async function buildEnv(cfg: AppConfig): Promise<Record<string, string>> {
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
    workItemId: input.workItemId?.trim() || undefined,
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
    // ¿La corrida trae credenciales? → el guion autogenerado antepone el login automático.
    const hasCreds = !!(input.vars && input.vars.QA_USER && input.vars.QA_PASS);

    // Guion AUTOGENERADO para la HU sola (sin guion manual): se deduce de sus AC (determinista).
    let autoFlow: Array<Record<string, any>> | null = null;
    let autoDeclaredAcs: string[] = [];

    // ¿Fan-out de Feature? Solo azure con WI real: si el WI destino es un Feature, se recorre cada
    // HU hija y se corre su guion GUARDADO o, si no hay, uno AUTOGENERADO desde sus AC.
    let fanout: any = null;
    if (tracker === "azure-devops" && workItemId !== "local") {
      try {
        const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
        const adapter = getAdapter({ profile, env, repoRoot });
        const wi = await adapter.getWorkItem(workItemId);

        // RECON (solo si la IA está activa y hay con qué navegar): captura UNA vez el DOM de la app
        // —autenticado si hay credenciales— para que el planner deduzca localizadores REALES. Se
        // comparte entre el fan-out y la HU sola. Best-effort: si falla, la IA usa solo los AC.
        const aiOn = !!(cfg.ai && cfg.ai.enabled && cfg.ai.model);
        let reconDom = "";
        const willAutogen = wi?.type === "Feature" || (wi && !manualFlow && input.appUrl);
        if (aiOn && input.appUrl && launchBrowser && willAutogen) {
          try {
            const { captureDom } = await importKit("runtime/generate/recon.mjs");
            emitEvent(id, "info", "IA activa → recon: abriendo la app para leer sus campos/botones reales…");
            const rc = await captureDom({ appUrl: input.appUrl, login: hasCreds, env, vars: input.vars || {}, launchBrowser });
            reconDom = rc.dom || "";
            emitEvent(id, rc.ok ? "info" : "stderr", rc.ok ? `Recon OK (${reconDom.length} caracteres de pantalla leídos).` : `Recon no disponible: ${rc.message}. La IA usará solo los AC.`);
          } catch (e: any) {
            emitEvent(id, "stderr", `Recon falló: ${describeError(e)}. La IA usará solo los AC.`);
          }
        }

        if (wi?.type === "Feature") {
          emitEvent(id, "system", `WI ${workItemId} es un Feature → fan-out por HU hija (guion guardado o autogenerado de cada una).`);
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
            // Autogenera el guion de una HU hija desde sus AC cuando no tiene guion guardado.
            // Usa la IA (Ollama) si está encendida en Ajustes; si no, el generador determinista.
            // El `reconDom` (pantalla real) alimenta al planner IA para localizadores reales.
            autogen: (cid: string) => autogenFlow(adapter, cid, input.appUrl || "", hasCreds, cfg.ai, reconDom),
            profile,
            env,
            repoRoot,
            launchBrowser,
            vars: input.vars || {},
            emit: (lvl: string, msg: string) => emitEvent(id, lvl as any, msg),
          });
        } else if (wi && !manualFlow && input.appUrl) {
          // HU sola sin guion manual → autogenerar desde sus AC (autonomía sin copiar/pegar).
          const g = await autogenFlow(adapter, workItemId, input.appUrl, hasCreds, cfg.ai, reconDom);
          if (hasActionableSteps(g)) {
            autoFlow = g.flow;
            autoDeclaredAcs = (wi.acceptance_criteria || [])
              .map((a: any) => (typeof a === "string" ? a : a?.title))
              .filter((t: any) => t && String(t).trim() !== "");
            emitEvent(id, "info", `WI ${workItemId}: guion AUTOGENERADO (${g.origin === "ia" ? "IA local" : "determinista"}) desde sus AC (${g.flow.length} paso(s)).`);
            for (const n of g.notes || []) emitEvent(id, "stderr", `  · ${n}`);
          } else {
            emitEvent(id, "stderr", `No se pudo autogenerar para ${workItemId}: ${g.reason || "AC no aptos para E2E"}. Sigo con lo indicado.`);
          }
        }
      } catch (e: any) {
        emitEvent(id, "stderr", `No se pudo evaluar el fan-out/autogeneración: ${describeError(e)}. Sigo como corrida única.`);
      }
    }

    // Guion efectivo de la corrida única: el manual tiene prioridad; si no, el autogenerado.
    const flowToRun = manualFlow ? input.steps! : autoFlow;
    const useFlow = Array.isArray(flowToRun) && flowToRun.length > 0;
    const declaredAcsToRun = input.declaredAcs && input.declaredAcs.length ? input.declaredAcs : autoDeclaredAcs;

    let summary: any;
    if (fanout) {
      summary = fanout;
      record.status = !fanout.anyRun ? "error" : fanout.anyFail ? "failed" : "passed";
      if (!fanout.anyRun) emitEvent(id, "error", "Ninguna HU hija tenía guion guardado.");
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
