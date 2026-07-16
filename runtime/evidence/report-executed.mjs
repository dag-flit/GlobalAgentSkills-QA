// report-executed.mjs — resumen "Qué se ejecutó por capa": el registro de lo que la corrida corrió
// realmente (comando exacto, duración, código de salida, qué hace la herramienta y qué significó).
//
// Vive aparte porque lo comparten DOS destinos: el reporte local (md) y el COMENTARIO de la HU de
// hallazgos en Azure (Discussion) — la Description de la HU no lo lleva (ahí va el análisis; acá, la
// bitácora de ejecución). Una sola redacción para ambos → no se desincronizan.
//
// Incluye TODA capa que efectivamente corrió, tenga o no un comando de consola: la sonda de BD
// (postgres-probe) no lanza un binario y antes quedaba fuera de este resumen.

import { toolDescription, interpretLayer } from "./layer-explain.mjs";

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Nombres legibles de capa (para no técnicos). Espejo del de findings-workitem.
const LAYER_LABEL = {
  static: "Análisis estático (linter / tipos)",
  unit: "Pruebas unitarias",
  api: "Contrato de API",
  db: "Base de datos",
  security: "Seguridad",
  explore: "Exploración de la URL",
};
const label = (l) => LAYER_LABEL[l] || l;

// Corrió = lanzó un comando o produjo verificaciones. La capa OMITIDA no entra (no se ejecutó).
const ran = (r) => Boolean(r.metrics && r.metrics.command) || (Array.isArray(r.cases) && r.cases.length > 0);

/** Capas que efectivamente se ejecutaron en la corrida. */
export function executedLayers(results = []) {
  return results.filter((r) => r.status !== "skip" && ran(r));
}

// Datos de ejecución de una capa, normalizados para md y html.
function execInfo(r) {
  const m = r.metrics || {};
  const bits = [];
  if (typeof m.ms === "number") bits.push(`${(m.ms / 1000).toFixed(1)} s`);
  if (typeof m.exitCode === "number") bits.push(`código de salida ${m.exitCode}`);
  const cases = Array.isArray(r.cases) ? r.cases : [];
  if (cases.length) {
    const c = (s) => cases.filter((x) => x.status === s).length;
    bits.push(`${cases.length} verificación(es): ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`);
  }
  return {
    head: `${label(r.layer)}${m.tool ? ` — ${m.tool}` : ""}${m.label ? ` · ${m.label}` : ""}${m.cwd ? ` @ ${m.cwd}` : ""}`,
    // La sonda de BD no ejecuta un binario: se dice explícitamente en vez de dejar el campo vacío.
    command: m.command || (m.tool === "postgres-probe" ? "(conexión directa a PostgreSQL — no ejecuta un comando de consola)" : ""),
    meta: bits.join(" · "),
    what: toolDescription(m.tool, r.layer),
    result: interpretLayer(r),
    icon: r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭",
  };
}

/** "Qué se ejecutó por capa" en MARKDOWN → array de líneas (vacío si no corrió nada). */
export function executedMd(results = []) {
  const ex = executedLayers(results);
  if (!ex.length) return [];
  const md = ["## Qué se ejecutó por capa", ""];
  for (const r of ex) {
    const i = execInfo(r);
    md.push(`- ${i.icon} **${esc(i.head)}**`);
    if (i.command) md.push(`  - _Comando:_ \`${esc(i.command)}\`${i.meta ? ` · ${esc(i.meta)}` : ""}`);
    else if (i.meta) md.push(`  - ${esc(i.meta)}`);
    if (i.what) md.push(`  - _Qué hace:_ ${esc(i.what)}.`);
    md.push(`  - _Resultado:_ ${esc(i.result)}`);
  }
  md.push("");
  return md;
}

/**
 * "Qué se ejecutó por capa" en HTML, para el COMENTARIO de la HU (Discussion de Azure).
 * Inline-styled: ADO conserva estilos en línea pero descarta las hojas de estilo.
 * @param {object[]} results
 * @param {{when?:string, reportPath?:string}} [meta]
 */
export function executedHtml(results = [], { when = "", reportPath = "" } = {}) {
  const ex = executedLayers(results);
  if (!ex.length) return "";
  const cards = ex
    .map((r) => {
      const i = execInfo(r);
      const rows = [`<p style="margin:2px 0"><strong>${i.icon} ${esc(i.head)}</strong></p>`];
      if (i.command) {
        rows.push(
          `<p style="margin:2px 0;color:#444">▶️ <strong>Comando:</strong> <code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">${esc(
            i.command,
          )}</code>${i.meta ? `<br><small style="color:#777">${esc(i.meta)}</small>` : ""}</p>`,
        );
      } else if (i.meta) {
        rows.push(`<p style="margin:2px 0;color:#777"><small>${esc(i.meta)}</small></p>`);
      }
      if (i.what) rows.push(`<p style="margin:2px 0;color:#666">📖 <strong>Qué hace:</strong> ${esc(i.what)}.</p>`);
      rows.push(`<p style="margin:2px 0">📌 <strong>Resultado:</strong> ${esc(i.result)}</p>`);
      return `<div style="border:1px solid #d7dbe0;background:#fafbfc;border-radius:8px;padding:8px 12px;margin:8px 0">${rows.join("")}</div>`;
    })
    .join("");
  return (
    `<p style="font-size:1.05em"><strong>🧾 Qué se ejecutó en esta corrida</strong>${when ? ` — ${esc(when)}` : ""}</p>` +
    `<p style="color:#666;margin:2px 0 6px">Bitácora de la ejecución: qué herramienta corrió sobre cada capa, con qué comando y qué resultó. El análisis de los hallazgos está en la descripción de esta HU.</p>` +
    cards +
    (reportPath ? `<p style="color:#666">📄 Reporte local (autocontenido): <code>${esc(reportPath)}</code></p>` : "")
  );
}

export default { executedMd, executedHtml, executedLayers };
