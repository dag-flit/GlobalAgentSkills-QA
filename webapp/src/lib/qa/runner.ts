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
import type { AppConfig, RunMode, RunRecord } from "@/lib/types";

export interface RunInput {
  mode: RunMode;
  appUrl?: string;
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
  return `Explorar → ${input.appUrl || "?"}`;
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

    emitEvent(id, "info", `Explorando ${input.appUrl}…`);
    const summary = await runQaCycle({
      repoRoot,
      env,
      profile,
      workItemId: "local",
      appUrl: input.appUrl,
      explore: true,
      launchBrowser,
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
    clearStop(id);
    await endRun(id);
  }
}
