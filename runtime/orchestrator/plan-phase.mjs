// orchestrator/plan-phase.mjs — fase PREVIA a la ejecución de runners.
// 1) Generación de pruebas desde los criterios de cada HU (Fase A: esqueletos / generador
//    inyectable) + casos adicionales desde plantillas (B3.5).
// 2) Planificación: arma `requirements` y el `plan` del Feature, y crea la estructura en el
//    tracker (TC por criterio en estado pendiente + Plan del Feature).
// Extraído de orchestrator.mjs (F1) sin cambiar comportamiento; devuelve {requirements, plan,
// testPlan} para que el backbone continúe con la ejecución.

import fs from "node:fs";
import path from "node:path";
import { applyTemplate } from "../generate/template-applier.mjs";

export async function generateAndPlan({
  adapter,
  caps,
  repoRoot,
  detection,
  profile,
  huIds,
  featureId,
  generate,
  generateTests,
  approvedTcKeys,
  templateCases = [],
}) {
  // ── Generación de pruebas desde criterios (Fase A: esqueletos) ───────────────
  // ANTES de los runners: por cada HU se leen sus CRITERIOS (de la HU, no del Feature) y se
  // generan archivos de prueba (uno por criterio, etiquetados [HU-###]). Se escriben en el cwd
  // de la capa unit para que el runner los ejecute. Gated por `generate` + `huIds`. Devuelve un
  // manifest por HU que luego alimenta los TC (Task) y el Plan del Feature.
  const generatedByHu = {}; // huId -> { huTitle, criteria, tcs[] }
  if ((generate || (Array.isArray(templateCases) && templateCases.length > 0)) && Array.isArray(huIds) && huIds.length) {
    const unitInfo = detection.layers && detection.layers.unit;
    const unitTool = (unitInfo && (unitInfo.tool || (unitInfo.targets && unitInfo.targets[0] && unitInfo.targets[0].tool))) || null;
    const unitCwd = (unitInfo && (unitInfo.cwd || (unitInfo.targets && unitInfo.targets[0] && unitInfo.targets[0].cwd))) || "";
    const genBase = path.join(repoRoot, unitCwd);
    const approved = approvedTcKeys ? new Set(Array.from(approvedTcKeys)) : null;
    const tcTitlePrefix = (profile.azure && profile.azure.work_item && profile.azure.work_item.test_case_title_prefix) || "TC-";
    for (const huId of huIds) {
      const id = String(huId);
      if (!id || id === "local") continue;
      let wi = null;
      try { wi = await adapter.getWorkItem(id); } catch { /* sin HU/red: se omite */ }
      const criteria = (wi && wi.acceptance_criteria) || [];
      // generateTests puede ser síncrono (esqueletos) o async (generador con IA inyectado).
      // Se pasa repoRoot/projectDir (cwd de unit) para que un generador con IA pueda leer el
      // contexto del repo (grounding); el generador determinista los ignora.
      const tcs = generate
        ? await generateTests({ requirement: { id, title: wi && wi.title }, criteria, options: { unitTool, tcTitlePrefix }, repoRoot, projectDir: genBase })
        : [];
      // Casos ADICIONALES desde plantillas (B3.5) → TC extra bajo ESTA HU (decisión #1). Se etiqueta el
      // Feature con [HU-###] para que la atribución por-HU de resultados funcione igual que con los AC.
      (templateCases || []).filter((t) => String(t.huId) === id).forEach((tc, ti) => {
        const n = ti + 1;
        let applied;
        try { applied = applyTemplate({ template: tc.template, params: tc.params || {}, huId: id }); }
        catch { applied = { code: "", supported: false }; }
        const code = String(applied.code || "").replace(/^(\s*Feature:\s*)/m, `$1[HU-${id}] `);
        const key = `${tcTitlePrefix}PLANTILLA-${n}`;
        tcs.push({
          huId: id, key, title: `${key} - ${tc.template}`,
          criterion: `Plantilla: ${tc.template}`, summary: `Caso adicional (plantilla "${tc.template}")`,
          framework: "cucumber", relPath: `qa-generated/HU-${id}/plantilla-${n}-${tc.template}.feature`,
          code, supported: !!applied.supported, status: "pending", fromTemplate: true,
        });
      });
      for (const tc of tcs) {
        // La aprobación es por (HU, criterio); los casos de plantilla se incluyen siempre (el usuario los agregó).
        if (approved && !tc.fromTemplate && !approved.has(`${id}:${tc.key}`)) { tc.skipped = "no aprobado en revisión"; continue; }
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

  return { requirements, featureTitle, plan, testPlan };
}
