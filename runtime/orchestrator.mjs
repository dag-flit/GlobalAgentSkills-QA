// orchestrator.mjs — backbone del ciclo QA, acotado a EXPLORACIÓN de una URL viva (pruebas E2E).
// El kit se redujo a un solo propósito: explorar una app corriendo (smoke + capturas por página) y
// entregar la evidencia al tracker (local o azure-devops). Ver runtime/runners/explore.mjs.
//
// Preflight CONDICIONAL (invariante local-first): solo se ejecuta si el tracker REQUIERE RED
// (capabilities().network === true, p.ej. azure-devops). Con `tracker: local` arranca directo.
//
// Uso:
//   import { runQaCycle } from "./orchestrator.mjs";
//   const summary = await runQaCycle({ repoRoot, env, appUrl, launchBrowser });

import { resolveProfile } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { runExplore } from "./runners/explore.mjs";

/**
 * Corre el ciclo de exploración de punta a punta.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.env]
 * @param {object} [opts.profile]        perfil ya resuelto (si no, se resuelve del repo)
 * @param {string} [opts.workItemId]     HU/Feature destino de la evidencia (o "local")
 * @param {function} [opts.http]         transporte HTTP inyectable para el adapter (tests offline)
 * @param {string} [opts.appUrl]         URL viva a explorar (sin ella, no se explora nada)
 * @param {function} [opts.launchBrowser] launcher de navegador inyectable (offline-testable)
 * @returns {Promise<object>} resumen del ciclo
 */
export async function runQaCycle({
  repoRoot = process.cwd(),
  env = {},
  profile,
  workItemId = "local",
  featureId,
  developer,
  http,
  appUrl,
  explore = true,   // compat: la exploración corre si hay appUrl
  launchBrowser,
} = {}) {
  const resolvedProfile = profile || resolveProfile({ repoRoot }).profile;
  const adapter = getAdapter({ profile: resolvedProfile, env, repoRoot, http });
  const caps = adapter.capabilities();

  // ── Preflight CONDICIONAL (solo trackers de red: azure-devops) ──────────────
  let preflight = null;
  if (caps.network) {
    preflight = await adapter.preflight();
    if (!preflight.ok) {
      return { ok: false, stopped: "preflight", tracker: adapter.name, preflight, results: [], report: null, warnings: [] };
    }
  }

  // ── Exploración de la URL viva (única capa del kit) ─────────────────────────
  const results = [];
  if (explore && appUrl) {
    const explored = await runExplore({ repoRoot, env, appUrl, launchBrowser });
    results.push(...explored);
  }

  // ── Guarda online: tracker remoto sin HU real ───────────────────────────────
  // Sin `-w` (workItemId="local") no se comenta sobre una HU inexistente (evitaría un 404
  // online): la evidencia queda en el reporte local + aviso. Para `local` no aplica.
  const warnings = [];
  const requirementId = caps.network && (!workItemId || workItemId === "local") ? null : workItemId;
  if (caps.network && !requirementId) {
    warnings.push(
      `Tracker remoto '${adapter.name}' sin work item (-w): la evidencia se deja solo en el reporte ` +
        `local; no se comenta sobre una HU inexistente.`
    );
  }

  // ── Entrega al sink (comentario en la HU si aplica + reporte local) ──────────
  const report = await adapter.publishEvidence(
    { work_item_id: requirementId, feature_id: featureId, developer },
    { results }
  );

  return {
    ok: true,
    stopped: null,
    tracker: adapter.name,
    preflight,       // null = no se requirió (local arrancó directo)
    results,
    report,
    warnings,        // avisos no fatales del ciclo (p.ej. remoto sin -w)
  };
}

export default { runQaCycle };
