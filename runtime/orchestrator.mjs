// orchestrator.mjs — backbone del ciclo QA local-first.
// Encadena: preflight (CONDICIONAL) → qa-detect → runners de capas → sink.
//
// Preflight condicional (invariante local-first): solo se ejecuta si el tracker
// REQUIERE RED (capabilities().network === true). Con `tracker: local` no hay red,
// así que el ciclo ARRANCA DIRECTO, sin PAT ni preflight. Para ADO/GitHub/Jira el
// preflight corre primero y un FAIL detiene el ciclo ANTES de cualquier runner.
//
// Gating por capability, no por el literal "local": cualquier tracker sin red
// arranca directo; cualquiera con red exige preflight.
//
// Uso:
//   import { runQaCycle } from "./orchestrator.mjs";
//   const summary = await runQaCycle({ repoRoot, env: process.env });

import { resolveProfile } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "./detect/qa-detect.mjs";
import { runStaticAnalysis } from "./runners/static-analysis.mjs";
import { runUnitTests } from "./runners/unit.mjs";
import { runE2eTests } from "./runners/e2e.mjs";

// Registro de runners portados. Las capas habilitadas sin runner aún se omiten
// con aviso (no abortan): api/db/security se portan en F3.
const RUNNERS = {
  static: runStaticAnalysis,
  unit: runUnitTests,
  e2e: runE2eTests,
};

/**
 * Corre el ciclo QA de punta a punta.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.env]
 * @param {object} [opts.profile]   perfil ya resuelto (si no, se resuelve del repo)
 * @param {string} [opts.workItemId]
 * @param {function} [opts.exec]    ejecutor inyectable para los runners (tests offline)
 * @returns {Promise<object>} resumen del ciclo
 */
export async function runQaCycle({
  repoRoot = process.cwd(),
  env = {},
  profile,
  workItemId = "local",
  exec,
} = {}) {
  const resolvedProfile = profile || resolveProfile({ repoRoot }).profile;
  const adapter = getAdapter({ profile: resolvedProfile, env, repoRoot });
  const caps = adapter.capabilities();

  // ── Preflight CONDICIONAL ──────────────────────────────────────────────────
  let preflight = null;
  if (caps.network) {
    preflight = await adapter.preflight();
    if (!preflight.ok) {
      // El tracker remoto no está operativo: se detiene antes de correr runners.
      return {
        ok: false,
        stopped: "preflight",
        tracker: adapter.name,
        preflight,
        detection: null,
        results: [],
        report: null,
      };
    }
  }
  // tracker local (sin red): preflight queda en null → arranca directo.

  // ── Detección de capas ──────────────────────────────────────────────────────
  const detection = detectRepo({ repoRoot });
  const { enabled } = resolveEnabledLayers(resolvedProfile, detection);

  // ── Ejecución de runners por capa ───────────────────────────────────────────
  const results = [];
  for (const layer of enabled) {
    const runner = RUNNERS[layer];
    if (!runner) {
      results.push({
        layer,
        status: "skip",
        narrative: "runner aún no portado (F1/F3) — capa detectada pero sin ejecutor",
        metrics: { tool: detection.layers[layer]?.tool || null },
      });
      continue;
    }
    results.push(runner({ repoRoot, profile: resolvedProfile, detection, exec, workItemId }));
  }

  // Capas omitidas por detección (herramienta ausente): al reporte, con su razón.
  for (const { layer, reason } of detection.skipped) {
    results.push({ layer, status: "skip", narrative: reason, metrics: { tool: null } });
  }

  // ── Entrega al sink (vía adapter) ───────────────────────────────────────────
  const report = await adapter.publishEvidence({ work_item_id: workItemId }, { results });

  return {
    ok: true,
    stopped: null,
    tracker: adapter.name,
    preflight,                 // null = no se requirió (local-first arrancó directo)
    detection,
    results,
    report,
  };
}

export { RUNNERS };
export default { runQaCycle };
