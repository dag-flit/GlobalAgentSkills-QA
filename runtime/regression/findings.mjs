// findings.mjs — Description HTML (con estilo EN LÍNEA) de UNA prueba de regresión, para la HU que
// se crea en ADO al «Publicar en ADO». Azure DevOps descarta las hojas de estilo → todo el estilo va
// inline (mismo criterio que findings-workitem del modo código). PURO/offline (sin IO) → smoke.
// La evidencia rica (capturas por paso + video) viaja ADJUNTA como report.html autocontenido; esta
// Description es el resumen legible que queda en el cuerpo de la HU.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Prefijo ESTABLE del título (base del conteo #N, igual que la HU de QA del código). Es un marcador
// PROPIO y distintivo → el conteo por WIQL (título CONTIENE este prefijo) cuenta SOLO las HU de
// regresión y no cualquier ítem que mencione la palabra "regresión". No cambiar sin migrar el conteo.
export const REGRESSION_TITLE_PREFIX = "Regresión E2E (QualityOps)";

/**
 * Título de la HU de regresión: prefijo estable + suite/prueba + fecha·hora + #N (como QA del código).
 * @param {{suite?:string,test?:string,stamp?:string,seq?:number}} o
 */
export function regressionTitle({ suite = "", test = "", stamp = "", seq } = {}) {
  const base = `${REGRESSION_TITLE_PREFIX} — ${suite} / ${test}${stamp ? ` — ${stamp}` : ""}`;
  return (seq != null ? `${base} #${seq}` : base).slice(0, 255);
}

function stepRow(c) {
  const ok = c.status === "pass";
  const color = ok ? "#14532d" : "#b42318";
  const mark = ok ? "✔ Pasó" : "✗ Falló";
  const msg = c.message ? `<div style="color:#b42318;font-size:12px;margin-top:2px">— ${esc(c.message)}</div>` : "";
  return `<tr><td style="padding:5px 8px;border:1px solid #d0d5dd;white-space:nowrap;color:${color};font-weight:600">${mark}</td><td style="padding:5px 8px;border:1px solid #d0d5dd">${esc(c.name)}${msg}</td></tr>`;
}

/**
 * @param {object} o
 * @param {string} o.system  nombre del sistema probado
 * @param {string} o.suite   nombre de la suite
 * @param {{name?:string,status?:string,cases?:Array,warnings?:string[]}} o.test  la prueba corrida
 * @param {string} [o.stamp] marca de tiempo legible de la corrida
 * @returns {string} HTML con estilo en línea (Description de la HU)
 */
export function renderRegressionFindings({ system = "", suite = "", test = {}, stamp = "", url = "" } = {}) {
  const cases = Array.isArray(test.cases) ? test.cases : [];
  const warnings = Array.isArray(test.warnings) ? test.warnings : [];
  const passed = cases.filter((c) => c.status === "pass").length;
  const ok = test.status ? test.status === "pass" : cases.length > 0 && passed === cases.length;
  const bg = ok ? "#e7f6ec" : "#fde8e8";
  const bar = ok ? "#14532d" : "#b42318";
  const verdict = ok ? "✔ La prueba de regresión pasó" : "✗ La prueba de regresión falló";

  const warnHtml = warnings.length
    ? `<div style="margin:12px 0;padding:8px 10px;background:#fff8e6;border-left:4px solid #f5a623;border-radius:4px"><b style="color:#8a6d00">Avisos de regresión</b>${warnings
        .map((w) => `<div style="font-size:12px;color:#8a6d00">⚠ ${esc(w)}</div>`)
        .join("")}</div>`
    : "";

  const rows = cases.length
    ? cases.map(stepRow).join("")
    : `<tr><td colspan="2" style="padding:6px 8px;border:1px solid #d0d5dd;color:#667">Sin pasos registrados.</td></tr>`;

  const metaRow = (k, v) => `<tr><td style="padding:2px 10px 2px 0;color:#667">${k}</td><td style="padding:2px 0"><b>${v}</b></td></tr>`;

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#101828">
    <div style="padding:10px 12px;background:${bg};border-left:5px solid ${bar};border-radius:6px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700;color:${bar}">${verdict}</div>
      <div style="font-size:12px;color:#475467;margin-top:2px">Prueba: <b>${esc(test.name || "")}</b></div>
    </div>
    <table style="font-size:12px;border-collapse:collapse;margin-bottom:12px">
      ${metaRow("Sistema", esc(system))}
      ${url ? metaRow("URL probada", `<a href="${esc(url)}" style="color:#155eef">${esc(url)}</a>`) : ""}
      ${metaRow("Suite", esc(suite))}
      ${metaRow("Pasos correctos", `${passed}/${cases.length}`)}
      ${stamp ? metaRow("Ejecutada", esc(stamp)) : ""}
    </table>
    ${warnHtml}
    <div style="font-weight:600;margin-bottom:6px">Pasos ejecutados</div>
    <table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>
    <p style="font-size:12px;color:#667;margin-top:12px">La evidencia (capturas por paso y video) va <b>adjunta</b> a esta HU como archivo HTML autocontenido.</p>
  </div>`;
}

export default { renderRegressionFindings };
