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

import fs from "node:fs";
import path from "node:path";
import { resolveProfile } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "./detect/qa-detect.mjs";
import { generateTestsForRequirement } from "./generate/skeleton-generator.mjs";
import { runStaticAnalysis } from "./runners/static-analysis.mjs";
import { runUnitTests } from "./runners/unit.mjs";
import { runE2eTests } from "./runners/e2e.mjs";
import { runApiTests } from "./runners/api.mjs";
import { runDbTests } from "./runners/db.mjs";
import { runSecurityTests } from "./runners/security.mjs";
import { runExplore } from "./runners/explore.mjs";

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
  huIds,             // HUs hijas seleccionadas: cada una recibe sus TC (Task por criterio) + comentario
  developer,
  exec,
  http,
  generate = false,  // si true (+ huIds): genera tests desde los criterios de cada HU antes de correr
  generateTests = generateTestsForRequirement, // generador INYECTABLE (default: esqueletos offline)
  approvedTcKeys,    // Set/Array de claves "TC-AC<n>" aprobadas en la revisión (default: todas)
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

  // ── Generación de pruebas desde criterios (Fase A: esqueletos) ───────────────
  // ANTES de los runners: por cada HU se leen sus CRITERIOS (de la HU, no del Feature) y se
  // generan archivos de prueba (uno por criterio, etiquetados [HU-###]). Se escriben en el cwd
  // de la capa unit para que el runner los ejecute. Gated por `generate` + `huIds`. Devuelve un
  // manifest por HU que luego alimenta los TC (Task) y el Plan del Feature.
  const generatedByHu = {}; // huId -> { huTitle, criteria, tcs[] }
  if (generate && Array.isArray(huIds) && huIds.length) {
    const unitInfo = detection.layers && detection.layers.unit;
    const unitTool = (unitInfo && (unitInfo.tool || (unitInfo.targets && unitInfo.targets[0] && unitInfo.targets[0].tool))) || null;
    const unitCwd = (unitInfo && (unitInfo.cwd || (unitInfo.targets && unitInfo.targets[0] && unitInfo.targets[0].cwd))) || "";
    const genBase = path.join(repoRoot, unitCwd);
    const approved = approvedTcKeys ? new Set(Array.from(approvedTcKeys)) : null;
    const tcTitlePrefix = (resolvedProfile.azure && resolvedProfile.azure.work_item && resolvedProfile.azure.work_item.test_case_title_prefix) || "TC-";
    for (const huId of huIds) {
      const id = String(huId);
      if (!id || id === "local") continue;
      let wi = null;
      try { wi = await adapter.getWorkItem(id); } catch { /* sin HU/red: se omite */ }
      const criteria = (wi && wi.acceptance_criteria) || [];
      // generateTests puede ser síncrono (esqueletos) o async (generador con IA inyectado).
      const tcs = await generateTests({ requirement: { id, title: wi && wi.title }, criteria, options: { unitTool, tcTitlePrefix } });
      for (const tc of tcs) {
        // La aprobación es por (HU, criterio): la clave TC-AC<n> se repite entre HUs.
        if (approved && !approved.has(`${id}:${tc.key}`)) { tc.skipped = "no aprobado en revisión"; continue; }
        if (!tc.supported || !tc.code) continue;
        try {
          const abs = path.join(genBase, tc.relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, tc.code, "utf8");
          tc.written = tc.relPath;
        } catch (e) { tc.writeError = e.message; }
      }
      generatedByHu[id] = { huTitle: wi && wi.title, criteria, tcs };
    }
  }

  // ── Planificación (ANTES de ejecutar): requisitos + Plan del Feature + TC ─────
  // Lógica QA: el plan de pruebas se arma en la PLANIFICACIÓN — entendidos el Feature, sus HUs
  // y los criterios — no al final. Aquí se crea la estructura (Plan del Feature + TC por criterio,
  // en estado "pendiente"); tras ejecutar se ACTUALIZA con los resultados. El plan también se
  // pasa al sink para el reporte local (paridad offline).
  let requirements = null;
  let featureTitle = null;
  if (Array.isArray(huIds) && huIds.length) {
    requirements = [];
    for (const huId of huIds) {
      const id = String(huId);
      if (!id || id === "local") continue;
      const cached = generatedByHu[id];
      let huTitle = cached && cached.huTitle;
      let criteria = cached && cached.criteria;
      const tcs = (cached && cached.tcs) || [];
      if (!cached) {
        let wi = null;
        try { wi = await adapter.getWorkItem(id); } catch { /* sin HU/red */ }
        huTitle = wi && wi.title;
        criteria = (wi && wi.acceptance_criteria) || [];
      }
      requirements.push({ id, title: huTitle, criteria: criteria || [], tcs });
    }
    if (featureId && String(featureId) !== "local") {
      try { const fwi = await adapter.getWorkItem(featureId); featureTitle = fwi && fwi.title; } catch { /* sin Feature/red */ }
    }
  }
  const plan = requirements
    ? {
        featureId: featureId && String(featureId) !== "local" ? String(featureId) : null,
        featureTitle,
        hus: requirements.map((r) => ({
          id: r.id,
          title: r.title,
          criteria: r.criteria,
          tcs: r.tcs.map((t) => ({ key: t.key, title: t.title, status: t.status })),
        })),
      }
    : null;

  // Crea la estructura en el tracker (online): TC por criterio (pendientes) + Plan del Feature
  // (sin resultados aún). Gated por `states`: trackers sin jerarquía degradan a no-op.
  let testPlan = null;
  if (caps.states && requirements && requirements.length && typeof adapter.publishRequirementEvidence === "function") {
    for (const req of requirements) {
      try {
        await adapter.publishRequirementEvidence(req.id, { criteria: req.criteria, tcs: req.tcs, huTitle: req.title, phase: "plan" });
      } catch { /* degrada: la planificación de un TC no aborta el ciclo */ }
    }
    if (plan && plan.featureId && typeof adapter.publishTestPlan === "function") {
      try {
        testPlan = await adapter.publishTestPlan(plan.featureId, { featureTitle, hus: plan.hus, results: [], phase: "plan" });
      } catch (e) {
        testPlan = { ok: false, featureId: plan.featureId, error: e.message };
      }
    }
  }

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

// Extrae el id de HU de una etiqueta de convención: "[HU-103]" / "HU-103" / "HU 103".
// Las pruebas declaran su HU dueña en el título/nombre; lo no etiquetado cae a la HU del ciclo.
function extractHuTag(text) {
  if (!text) return null;
  const m = String(text).match(/\bHU[-\s]?(\d+)\b/i);
  return m ? m[1] : null;
}

// Agrupa las fallas por la HU EFECTIVA, a nivel de CASO (una capa puede tener pruebas de varias
// HUs). Por convención, cada prueba etiqueta su HU dueña en el nombre ("[HU-103] ..."): así la
// novedad se registra en ESA HU, no en el Feature paraguas. Resolución por caso, en orden:
//   etiqueta [HU-###] del caso → work_item_id declarado por el resultado → HU del ciclo (-w).
// Casos sin etiqueta (y capas transversales sin casos: lint/seguridad) caen a la HU del ciclo
// (p.ej. el Feature). Sin una HU real (local / remoto sin -w) la falla se descarta.
function groupFailuresByRequirement(results, cycleWi) {
  const cycle = cycleWi ? String(cycleWi) : null;
  const groups = new Map();
  const push = (huId, fragment) => {
    if (!huId || huId === "local") return; // sin HU real → no hay dónde crear el Bug
    if (!groups.has(huId)) groups.set(huId, []);
    groups.get(huId).push(fragment);
  };
  for (const r of results) {
    if (r.status !== "fail") continue;
    const resultHu = r.work_item_id ? String(r.work_item_id) : null;
    const failingCases = Array.isArray(r.cases) ? r.cases.filter((c) => c.status === "fail") : [];
    if (failingCases.length) {
      // agrupa los casos fallidos por su etiqueta de HU; un mismo resultado puede repartirse
      // entre varias HUs (un fragmento por HU, conservando solo sus casos).
      const byHu = new Map();
      for (const c of failingCases) {
        const hu = extractHuTag(c.name) || resultHu || cycle;
        if (!byHu.has(hu)) byHu.set(hu, []);
        byHu.get(hu).push(c);
      }
      for (const [hu, cases] of byHu) {
        push(hu, { layer: r.layer, tc_id: r.tc_id, narrative: r.narrative, metrics: r.metrics, cases });
      }
    } else {
      const hu = resultHu || extractHuTag(r.tc_id) || extractHuTag(r.narrative) || cycle;
      push(hu, { layer: r.layer, tc_id: r.tc_id, narrative: r.narrative, metrics: r.metrics, cases: [] });
    }
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
