// fanout-comment.mjs — resumen HTML de un fan-out de Feature para comentar en el WI PADRE.
// PURO/offline. A partir de las HU hijas ejecutadas ({id,title,status,origen}) arma una tabla +
// conteo, como el "Resumen QA" que QA del código deja en su WI. NO es evidencia (las capturas se
// adjuntan por HU vía publishEvidence); es el "qué se ejecutó" a nivel Feature, para que quien mire
// el Feature vea el resultado de la corrida sin abrir cada HU. Se publica con adapter.commentWorkItem.

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

const ICON = { passed: "✅", failed: "❌", skipped: "⏭" };

/**
 * @param {object} opts
 * @param {string} opts.feature      id del Feature (WI padre)
 * @param {Array}  opts.hus          [{ id, title?, status: passed|failed|skipped, origen? }]
 * @returns {string} HTML para la Discussion del Feature
 */
export function renderFanoutSummary({ feature, hus = [] } = {}) {
  const n = (s) => hus.filter((h) => h.status === s).length;
  const rows = hus
    .map((h) => {
      const icon = ICON[h.status] || "•";
      return (
        `<tr><td>${esc(h.id)}</td><td>${esc(h.title || "")}</td>` +
        `<td>${icon} ${esc(h.status)}</td><td>${esc(h.origen || "")}</td></tr>`
      );
    })
    .join("");
  return (
    `<p><strong>Resumen de ejecución QA — Feature ${esc(feature)}</strong> — ` +
    `✅ ${n("passed")} pasó · ❌ ${n("failed")} falló · ⏭ ${n("skipped")} omitida · ${hus.length} HU</p>` +
    `<table><thead><tr><th>HU</th><th>Título</th><th>Resultado</th><th>Origen</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export default { renderFanoutSummary };
