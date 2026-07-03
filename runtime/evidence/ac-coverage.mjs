// ac-coverage.mjs — matriz de COBERTURA DE CRITERIOS DE ACEPTACIÓN (AC). Puro y offline: cruza
// los casos del guion que declaran qué AC prueban (`case.ac`) con la lista de AC declarados de la
// HU (`declaredAcs`, opcional). NO genera pruebas ni interpreta el requerimiento (eso se retiró en
// el giro explore-only): solo MAPEA evidencia ↔ criterio, de forma determinista.
//
// - Un AC con ≥1 paso fallido → ❌ fail.
// - Un AC con pasos, todos ok   → ✅ pass.
// - Un AC declarado SIN ningún paso que lo pruebe → ⚠ uncovered (sin cubrir).
// - Un AC etiquetado en un paso pero NO declarado (offline / etiqueta libre) → igual se reporta.

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/**
 * @param {object[]} cases      casos del guion; los que prueban un AC traen `ac` (string)
 * @param {string[]} declaredAcs lista de AC declarados de la HU (títulos). Opcional.
 * @returns {null | {rows:{ac:string,status:string,steps:{name:string,status:string}[]}[], passed:number, failed:number, uncovered:number}}
 */
export function computeCoverage(cases = [], declaredAcs = []) {
  const tagged = (Array.isArray(cases) ? cases : []).filter((c) => c && String(c.ac ?? "").trim() !== "");
  const declared = (Array.isArray(declaredAcs) ? declaredAcs : []).map((d) => String(d).trim()).filter(Boolean);
  if (!tagged.length && !declared.length) return null; // nada que reportar

  const byAc = new Map();
  for (const c of tagged) {
    const k = String(c.ac).trim();
    if (!byAc.has(k)) byAc.set(k, []);
    byAc.get(k).push({ name: c.name, status: c.status });
  }

  const rows = [];
  const seen = new Set();
  const pushRow = (ac) => {
    const steps = byAc.get(ac) || [];
    const status = !steps.length ? "uncovered" : steps.some((s) => s.status === "fail") ? "fail" : "pass";
    rows.push({ ac, status, steps });
    seen.add(ac);
  };
  for (const d of declared) if (!seen.has(d)) pushRow(d); // orden: primero los declarados
  for (const k of byAc.keys()) if (!seen.has(k)) pushRow(k); // luego los etiquetados no declarados

  const passed = rows.filter((r) => r.status === "pass").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const uncovered = rows.filter((r) => r.status === "uncovered").length;
  return { rows, passed, failed, uncovered };
}

const ICON = { pass: "✅", fail: "❌", uncovered: "⚠" };
const LABEL = { pass: "cubierto", fail: "con fallo", uncovered: "sin cubrir" };

/** Líneas Markdown de la sección de cobertura (vacío si no hay cobertura). */
export function renderCoverageMd(cov) {
  if (!cov || !cov.rows.length) return [];
  const out = [
    "## Cobertura de criterios de aceptación",
    "",
    `**AC:** ✅ ${cov.passed} cubierto(s) · ❌ ${cov.failed} con fallo · ⚠ ${cov.uncovered} sin cubrir`,
    "",
  ];
  for (const r of cov.rows) {
    const proof = r.steps.length ? ` _(prueba: ${r.steps.map((s) => s.name).join("; ")})_` : "";
    out.push(`- ${ICON[r.status]} **${r.ac}** — ${LABEL[r.status]}${proof}`);
  }
  out.push("");
  return out;
}

/** Bloque HTML de la sección de cobertura (cadena vacía si no hay cobertura). */
export function renderCoverageHtml(cov) {
  if (!cov || !cov.rows.length) return "";
  const items = cov.rows
    .map((r) => {
      const proof = r.steps.length
        ? ` <small style="color:#666">(prueba: ${esc(r.steps.map((s) => s.name).join("; "))})</small>`
        : "";
      return `<li style="margin:.25rem 0">${ICON[r.status]} <b>${esc(r.ac)}</b> — ${LABEL[r.status]}${proof}</li>`;
    })
    .join("");
  return (
    `<h2>Cobertura de criterios de aceptación</h2>` +
    `<p><b>AC:</b> ✅ ${cov.passed} cubierto(s) · ❌ ${cov.failed} con fallo · ⚠ ${cov.uncovered} sin cubrir</p>` +
    `<ul style="list-style:none;padding-left:.4rem">${items}</ul>`
  );
}

export default { computeCoverage, renderCoverageMd, renderCoverageHtml };
