// orchestrator.mjs — backbone del ciclo QA local-first.
// Encadena: preflight (CONDICIONAL) → qa-detect → plan-phase → runners de capas → sink.
//
// Preflight condicional (invariante local-first): solo se ejecuta si el tracker
// REQUIERE RED (capabilities().network === true). Con `tracker: local` no hay red,
// así que el ciclo ARRANCA DIRECTO, sin PAT ni preflight. Para ADO/GitHub/Jira el
// preflight corre primero y un FAIL detiene el ciclo ANTES de cualquier runner.
//
// Gating por capability, no por el literal "local": cualquier tracker sin red
// arranca directo; cualquiera con red exige preflight.
//
// La generación de tests + la planificación (TC por criterio + Plan del Feature) viven en
// ./orchestrator/plan-phase.mjs; el manejo de novedades (Bug + reactivación) en
// ./orchestrator/novelty.mjs. Este archivo es solo el backbone (F1).
//
// Uso:
//   import { runQaCycle } from "./orchestrator.mjs";
//   const summary = await runQaCycle({ repoRoot, env: process.env });

import { resolveProfile } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "./detect/qa-detect.mjs";
import { generateTestsForRequirement } from "./generate/skeleton-generator.mjs";
import { generateAndPlan } from "./orchestrator/plan-phase.mjs";
import { handleNovelties } from "./orchestrator/novelty.mjs";
import { runStaticAnalysis } from "./runners/static-analysis.mjs";
import { runUnitTests } from "./runners/unit.mjs";
import { runE2eTests } from "./runners/e2e.mjs";
import { runApiTests } from "./runners/api.mjs";
import { runDbTests } from "./runners/db.mjs";
import { runSecurityTests } from "./runners/security.mjs";
import { runBddTests } from "./runners/bdd.mjs";
import { runExplore } from "./runners/explore.mjs";

// Registro de runners portados (todas las capas del kit).
const RUNNERS = {
  static: runStaticAnalysis,
  unit: runUnitTests,
  e2e: runE2eTests,
  api: runApiTests,
  bdd: runBddTests,
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
  huIds,             // HUs hijas seleccionadas: cada una recibe sus TC (Task por criterio) + comentario
  developer,
  exec,
  http,
  generate = false,  // si true (+ huIds): genera tests desde los criterios de cada HU antes de correr
  generateTests = generateTestsForRequirement, // generador INYECTABLE (default: esqueletos offline)
  approvedTcKeys,    // Set/Array de claves "TC-AC<n>" aprobadas en la revisión (default: todas)
  templateCases = [], // B3.5: casos adicionales desde plantillas [{template, params, huId}] → TC bajo la HU
  planOnly = false,  // si true: solo PLANIFICA (crea Plan + TC en el tracker) y termina, sin ejecutar
  appUrl,            // URL viva opcional: baseURL para el e2e del repo (BASE_URL/PLAYWRIGHT_BASE_URL)
  explore = false,   // si true (y hay appUrl), corre además la capa `explore` (crawler de la URL)
  launchBrowser,     // launcher de navegador inyectable para `explore` (offline-testable)
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

  // Si hay URL viva, se inyecta como baseURL para los E2E del repo (best-effort: la config
  // de playwright/cypress del proyecto puede leer estas variables). El kit ya reenvía env al hijo.
  const runEnv = appUrl
    ? { ...env, BASE_URL: appUrl, PLAYWRIGHT_BASE_URL: appUrl, CYPRESS_BASE_URL: appUrl }
    : env;

  // ── Generación de tests + planificación (TC por criterio + Plan del Feature) ──
  // Todo lo PREVIO a la ejecución vive en plan-phase: lee criterios por HU, genera archivos,
  // arma `requirements`/`plan` y crea la estructura en el tracker (estado pendiente).
  const { requirements, featureTitle, plan, testPlan: initialTestPlan } = await generateAndPlan({
    adapter, caps, repoRoot, detection, profile: resolvedProfile,
    huIds, featureId, generate, generateTests, approvedTcKeys, templateCases,
  });
  // testPlan inicial = el creado en la planificación; se ACTUALIZA tras ejecutar (más abajo).
  let testPlan = initialTestPlan;

  // Modo SOLO PLANIFICACIÓN: ya se crearon el Plan + los TC en el tracker; se termina aquí
  // sin ejecutar runners. La ejecución es una acción aparte (el usuario la lanza después).
  if (planOnly) {
    return {
      ok: true,
      stopped: "planOnly",
      tracker: adapter.name,
      preflight,
      detection,
      results: [],
      report: null,
      plan,
      testPlan,
      huEvidence: null,
      novelties: null,
      warnings: [],
    };
  }

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
    results.push(...runner({ repoRoot, profile: resolvedProfile, env: runEnv, detection, exec, workItemId }));
  }

  // Capas omitidas por detección (herramienta ausente): al reporte, con su razón.
  for (const { layer, reason } of detection.skipped) {
    results.push({ layer, status: "skip", narrative: reason, metrics: { tool: null } });
  }

  // ── Exploración de URL (capa `explore`, async, gated por `explore` + appUrl) ──
  // No se detecta del repo: corre SOLO si se pide explícitamente explorar una URL viva.
  // (appUrl por sí solo solo inyecta baseURL al e2e del repo; no dispara el crawler.)
  if (explore && appUrl) {
    const explored = await runExplore({ repoRoot, env: runEnv, appUrl, launchBrowser });
    results.push(...explored);
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
  // en local → reporte md/html, CON el plan de pruebas para paridad offline).
  const report = await adapter.publishEvidence(
    { work_item_id: requirementId, feature_id: featureId, developer },
    { results, plan }
  );

  // ── Actualización (DESPUÉS de ejecutar): resultado por HU + Plan con resultados ──
  // El Plan y los TC ya se crearon en la planificación; aquí se comenta el RESULTADO por HU
  // y se ACTUALIZA el Plan del Feature con el resultado consolidado. Reusa `requirements`.
  const reportLink = (report && report.local && report.local.htmlPath) || null;
  let huEvidence = null;
  if (caps.states && requirements && requirements.length && typeof adapter.publishRequirementEvidence === "function") {
    huEvidence = [];
    for (const req of requirements) {
      try {
        const r = await adapter.publishRequirementEvidence(req.id, { criteria: req.criteria, tcs: req.tcs, results, reportLink, huTitle: req.title, phase: "result" });
        huEvidence.push({ work_item_id: req.id, ...r });
      } catch (e) {
        huEvidence.push({ work_item_id: req.id, ok: false, error: e.message });
      }
    }
    if (plan && plan.featureId && typeof adapter.publishTestPlan === "function") {
      try {
        testPlan = await adapter.publishTestPlan(plan.featureId, { featureTitle, hus: plan.hus, results, reportLink });
      } catch (e) {
        testPlan = { ok: false, featureId: plan.featureId, error: e.message };
      }
    }
  }

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
    huEvidence,                // null = no aplica; [{work_item_id, tcs:[{key,tcId,...}], commentOk}] por HU
    testPlan,                  // null = no aplica; {planId, created/updated} de la Task "PLAN PRUEBAS FEATURE…"
    novelties,                 // null = no aplica; [] = sin fallas; [{...}] = HUs con novedad
    warnings,                  // avisos no fatales del ciclo (p.ej. remoto sin -w)
  };
}

export { RUNNERS };
export default { runQaCycle };
