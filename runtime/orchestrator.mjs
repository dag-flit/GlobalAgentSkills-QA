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
import { runApiTests } from "./runners/api.mjs";
import { runDbTests } from "./runners/db.mjs";
import { runSecurityTests } from "./runners/security.mjs";

// Registro de runners portados (todas las capas del kit).
const RUNNERS = {
  static: runStaticAnalysis,
  unit: runUnitTests,
  e2e: runE2eTests,
  api: runApiTests,
  db: runDbTests,
  security: runSecurityTests,
};

/**
 * Corre el ciclo QA de punta a punta.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.env]
 * @param {object} [opts.profile]   perfil ya resuelto (si no, se resuelve del repo)
 * @param {string} [opts.workItemId]
 * @param {function} [opts.exec]    ejecutor inyectable para los runners (tests offline)
 * @param {function} [opts.http]    transporte HTTP inyectable para el adapter (tests offline)
 * @returns {Promise<object>} resumen del ciclo
 */
export async function runQaCycle({
  repoRoot = process.cwd(),
  env = {},
  profile,
  workItemId = "local",
  featureId,
  developer,
  exec,
  http,
} = {}) {
  const resolvedProfile = profile || resolveProfile({ repoRoot }).profile;
  const adapter = getAdapter({ profile: resolvedProfile, env, repoRoot, http });
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
    // Cada runner devuelve N EvidenceObjects (uno por objetivo/paquete en monorepo).
    results.push(...runner({ repoRoot, profile: resolvedProfile, env, detection, exec, workItemId }));
  }

  // Capas omitidas por detección (herramienta ausente): al reporte, con su razón.
  for (const { layer, reason } of detection.skipped) {
    results.push({ layer, status: "skip", narrative: reason, metrics: { tool: null } });
  }

  // ── Guarda online: tracker remoto sin HU real ───────────────────────────────
  // Un tracker remoto (network) necesita una HU real para comentar/operar. Sin `-w`
  // (workItemId="local") NO se intenta comentar sobre una HU inexistente — eso daría 404
  // online — sino que se degrada a SOLO reporte local + aviso. Para `local` no aplica:
  // "local" es un nombre de carpeta válido, así que se conserva el workItemId tal cual.
  const warnings = [];
  const requirementId = caps.network && (!workItemId || workItemId === "local") ? null : workItemId;
  if (caps.network && !requirementId) {
    warnings.push(
      `Tracker remoto '${adapter.name}' sin work item (-w): se omite el comentario en la HU del ` +
        `ciclo para evitar un 404 online. La evidencia local se genera igual; las novedades se ` +
        `crean solo para resultados que declaren su propia HU.`
    );
  }

  // ── Entrega al sink (vía adapter) ───────────────────────────────────────────
  // Publica SIEMPRE el resumen de lo ejecutado (en ADO/github/jira → comentario en la HU;
  // en local → reporte md/html). Así cada corrida deja constancia de las pruebas corridas.
  const report = await adapter.publishEvidence(
    { work_item_id: requirementId, feature_id: featureId, developer },
    { results }
  );

  // ── Manejo de NOVEDADES (fallas) ────────────────────────────────────────────
  // Por cada HU con al menos una falla: crear un Bug enlazado a ESA HU + reactivar la HU
  // (estado de novedad del perfil) + dejar la trazabilidad del Bug en su comentario.
  // Gated por `states`: solo aplica a trackers con estados (ADO/github/jira), no a local.
  const novelties = caps.states ? await handleNovelties({ adapter, results, workItemId: requirementId }) : null;

  return {
    ok: true,
    stopped: null,
    tracker: adapter.name,
    preflight,                 // null = no se requirió (local-first arrancó directo)
    detection,
    results,
    report,
    novelties,                 // null = no aplica; [] = sin fallas; [{...}] = HUs con novedad
    warnings,                  // avisos no fatales del ciclo (p.ej. remoto sin -w)
  };
}

// Agrupa las fallas por la HU efectiva (la evidencia puede declarar su propio work_item_id;
// si no, cae a la HU del ciclo `-w`) y descarta lo que no tiene una HU real a la cual asociar.
function groupFailuresByRequirement(results, cycleWi) {
  const groups = new Map();
  for (const r of results) {
    if (r.status !== "fail") continue;
    const id = String(r.work_item_id || cycleWi || "");
    if (!id || id === "local") continue; // sin HU real → no hay dónde crear el Bug
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  return [...groups.entries()].map(([id, items]) => ({ id, items }));
}

// Compone el Bug a partir de las capas/casos fallidos de una HU (texto neutro de tracker;
// cada adapter lo renderiza a su formato).
function buildDefectPayload(usId, items) {
  const bullet = (r) => {
    const tc = r.tc_id ? `${r.tc_id} ` : "";
    const tool = r.metrics && r.metrics.tool ? ` [${r.metrics.tool}]` : "";
    return `- ${r.layer}${tool} ${tc}— ${r.narrative || "falla"}`;
  };
  const failedCases = [];
  for (const r of items) {
    if (!Array.isArray(r.cases)) continue;
    for (const c of r.cases) {
      if (c.status !== "fail") continue;
      const msg = c.message ? `: ${String(c.message).split(/\r?\n/)[0]}` : "";
      failedCases.push(`- (${r.layer}) ${c.name}${msg}`);
    }
  }
  const title = `[QA] Novedad en HU ${usId} — ${items.length} capa(s) con fallas`;
  const description = [
    `Novedades detectadas por el ciclo QA local-first en la HU ${usId}.`,
    "",
    "Capas/pruebas con falla:",
    ...items.map(bullet),
    ...(failedCases.length ? ["", "Casos fallidos:", ...failedCases] : []),
  ].join("\n");
  return { title, description };
}

// Por cada HU con novedad: createDefect (Bug enlazado a la HU) → reactivateRequirement
// (reactiva la HU + comentario de trazabilidad). Degrada con aviso: un fallo de red en un
// paso se registra en el resumen pero no aborta el ciclo ni el resto de HUs.
async function handleNovelties({ adapter, results, workItemId }) {
  const groups = groupFailuresByRequirement(results, workItemId);
  const out = [];
  for (const g of groups) {
    const entry = { work_item_id: g.id, fails: g.items.length, bugId: null };
    try {
      entry.bugId = await adapter.createDefect({ ...buildDefectPayload(g.id, g.items), parent_id: g.id });
    } catch (e) {
      entry.bugError = e.message;
    }
    if (typeof adapter.reactivateRequirement === "function") {
      try {
        entry.reactivation = await adapter.reactivateRequirement(g.id, { bugId: entry.bugId, items: g.items });
      } catch (e) {
        entry.reactivationError = e.message;
      }
    }
    out.push(entry);
  }
  return out;
}

export { RUNNERS };
export default { runQaCycle };
