// findings-workitem.mjs — render PURO de la HU de "hallazgos" del modo QA del código.
// Arma el TÍTULO (prefijo + fecha/hora + incrementador #N) y el HTML de la Description a partir
// de los EvidenceObjects de las capas. Sin red y sin estado: el conteo #N y el POST a Azure viven
// en el adapter (azure-devops). Los fallos se HUMANIZAN (qué pasó / qué hacer) con failure-explain.
// Ver [[reintro-qa-codigo-modulo]].

import { explainFailure, explainLayerFailure, explainLabels } from "./failure-explain.mjs";
import { groupWarnings, friendlyFile } from "./lint-explain.mjs";
import { describeEvidence, evidenceItems, evidenceLayers, notVerifiedCases, techDetail } from "./layer-explain.mjs";

// Prefijo estable del título (base del conteo #N). NO cambiar sin migrar el conteo por tag.
export const TITLE_PREFIX = "Hallazgos QA de código (QualityOps Framework)";
// Tags visibles del WI creado (marca del agente + hallazgos).
export const FINDINGS_TAGS = "QualityOps; Hallazgos-QA";
// Token de conteo por WIQL (`[System.Tags] CONTAINS '<token>'`). Palabra única, sin guiones ni
// espacios → el conteo #N es robusto y no colisiona con otros work items del proyecto.
export const FINDINGS_COUNT_TAG = "QualityOps";

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function short(s, n = 240) {
  // Normaliza el carácter de reemplazo (U+FFFD) que dejan las herramientas cuando pierden un
  // acento aguas arriba (p.ej. un error de PostgreSQL pre-auth) → "?" en vez de un cuadro roto.
  const t = String(s || "").replace(/�/g, "?").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ⏎ ");
  return t.length > n ? t.slice(0, n) + "…" : t;
}

// Marca de fecha/hora LOCAL "YYYY-MM-DD HH:MM" (fecha inyectable → testeable/determinista).
export function stampNow(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Título completo con fecha/hora + incrementador. El #N lo provee el adapter (conteo por tag).
export function buildFindingsTitle({ seq = 1, when = "" } = {}) {
  return when ? `${TITLE_PREFIX} — ${when} #${seq}` : `${TITLE_PREFIX} #${seq}`;
}

// Agregado de resultados: hay "hallazgo" si alguna capa quedó en rojo o hay pruebas fallidas.
export function summarizeFindings(results = []) {
  const r = Array.isArray(results) ? results : [];
  const layerFails = r.filter((x) => x.status === "fail");
  const caseFails = r.flatMap((x) => (Array.isArray(x.cases) ? x.cases : []).filter((c) => c.status === "fail"));
  return {
    layers: r.length,
    layerFails: layerFails.length,
    caseFails: caseFails.length,
    hasFindings: layerFails.length > 0 || caseFails.length > 0,
  };
}

// Nombres legibles de capa (para no técnicos).
const LAYER_LABEL = {
  static: "Análisis estático (linter / tipos)",
  unit: "Pruebas unitarias",
  api: "Contrato de API",
  db: "Base de datos",
  security: "Seguridad",
};
function layerLabel(l) {
  return LAYER_LABEL[l] || l;
}

// ── Bloques visuales (inline-styled: ADO conserva estos estilos en la Description) ──────────────
// Tarjeta con borde+fondo redondeados. Un color por tono (verde=evidencia, rojo=hallazgo, gris=neutro).
function box(inner, { bg = "#f7f8fa", border = "#d7dbe0" } = {}) {
  return `<div style="border:1px solid ${border};background:${bg};border-radius:8px;padding:8px 12px;margin:8px 0">${inner}</div>`;
}
// Barra de sección: separa visualmente los grandes bloques (resumen / evidencia / hallazgos).
function sectionBar(text) {
  return `<div style="background:#eef1f4;border-left:5px solid #5b6b7b;padding:6px 12px;margin:16px 0 8px;font-weight:700;font-size:1.05em">${esc(text)}</div>`;
}
// Sección de SUGERENCIAS: advertencias del linter AGRUPADAS por capa y por REGLA (la explicación va UNA
// vez), con nombre AMIGABLE del componente/archivo + la ruta EXACTA (para que un agente pueda corregir).
function suggestionsSection(results) {
  const groups = groupWarnings(results);
  const total = groups.reduce((n, g) => n + g.total, 0);
  if (!total) return "";
  let html =
    sectionBar(`💡 Sugerencias (${total} advertencia(s) del linter)`) +
    `<p style="color:#666;margin:2px 0 6px">Buenas prácticas para mejorar el código (no bloquean la app). Agrupadas por capa y regla; cada ocurrencia trae la ruta exacta para localizar y corregir.</p>`;
  for (const g of groups) {
    html += `<p style="margin:10px 0 2px"><strong>Capa: ${esc(g.source)}</strong> <small style="color:#888">(${g.total})</small></p>`;
    html += g.rules
      .map((r) => {
        let inner = `<p style="margin:2px 0"><strong>${esc(r.rule)}</strong> <small style="color:#888">(${r.occ.length} uso(s) en ${r.files} archivo(s))</small></p>`;
        if (r.help) inner += `<p style="margin:2px 0">📖 <strong>Qué significa:</strong> ${esc(r.help)}</p>`;
        inner += `<ul style="margin:4px 0 0 18px">${r.occ.map((o) => `<li>${esc(o.friendly)}${o.line ? ` · línea ${o.line}` : ""} — <code>${esc(o.raw)}</code></li>`).join("")}</ul>`;
        return box(inner, { bg: "#fdf9ec", border: "#f0e2b6" });
      })
      .join("");
  }
  return html;
}

// Cuadro RESUMEN por capa (tabla con bordes/inline-style para que se vea limpia en ADO).
function layerTable(results) {
  const th = (t, a = "left") => `<th style="border:1px solid #c7ccd1;background:#f0f2f5;padding:6px 10px;text-align:${a}">${t}</th>`;
  const td = (t, a = "left") => `<td style="border:1px solid #d7dbe0;padding:6px 10px;text-align:${a}">${t}</td>`;
  const rows = results
    .map((r) => {
      const cases = Array.isArray(r.cases) ? r.cases : [];
      const p = cases.filter((c) => c.status === "pass").length;
      const f = cases.filter((c) => c.status === "fail").length;
      const sk = cases.filter((c) => c.status === "skip").length;
      const verdict = r.status === "pass" ? "✅ Pasó" : r.status === "fail" ? "❌ Falló" : "⏭ Omitida";
      const tool = (r.metrics && r.metrics.tool) || "—";
      const label = r.metrics && r.metrics.label ? ` <small>(${esc(r.metrics.label)})</small>` : "";
      return `<tr>${td(esc(layerLabel(r.layer)) + label)}${td(esc(tool))}${td(verdict)}${td(String(p), "center")}${td(String(f), "center")}${td(String(sk), "center")}</tr>`;
    })
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;margin:6px 0"><thead><tr>` +
    `${th("Capa")}${th("Herramienta")}${th("Resultado")}${th("✅ Pasaron", "center")}${th("❌ Fallaron", "center")}${th("⏭ Omitidas", "center")}` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

// Tarjeta de EVIDENCIA de una capa: qué validó + los puntos concretos que pasaron. Cubre también la
// capa que quedó en rojo pero validó cosas adentro (evidencia PARCIAL) — antes desaparecía entera.
function evidenceCard(r) {
  const { partial, passed, lead } = describeEvidence(r);
  const tool = (r.metrics && r.metrics.tool) || "";
  const label = r.metrics && r.metrics.label ? ` · ${esc(r.metrics.label)}` : "";
  const head = partial ? `✅ ${esc(layerLabel(r.layer))} <small style="color:#8a6d3b">(evidencia parcial)</small>` : `✅ ${esc(layerLabel(r.layer))}`;
  let inner = `<p style="margin:2px 0"><strong>${head}</strong>${tool ? ` — ${esc(tool)}` : ""}${label}</p>`;
  inner += `<p style="margin:2px 0;color:#0a7a34">${esc(lead)}</p>`;
  // Cada verificación se lista COMPLETA: su explicación (`plain`) + su detalle técnico. La explicación
  // la escribe el propio check y es acotada → NO se recorta (antes moría en "…" a los 220 caracteres,
  // p.ej. la lista de tablas más grandes). El detalle crudo de una herramienta sí se acota.
  const items = evidenceItems(passed);
  if (items.length) {
    inner += `<ul style="margin:2px 0 2px 18px">${items
      .map((c) => {
        const why = c.plain ? ` — ${esc(c.plain)}` : "";
        const det = c.message
          ? `<div style="margin:1px 0 0;color:#666;font-size:.9em">🔎 <strong>Detalle técnico:</strong> <code>${esc(c.plain ? techDetail(c.message) : short(c.message, 140))}</code></div>`
          : "";
        return `<li style="margin:2px 0">✅ ${esc(c.name)}${why}${det}</li>`;
      })
      .join("")}</ul>`;
  }
  return box(inner, { bg: "#f2faf5", border: partial ? "#e0d6b6" : "#cbe8d5" });
}

// Sección "no verificado": casos OMITIDOS que traen su propia explicación (los checks declarativos la
// emiten). NO son hallazgos: o el proyecto no declaró ese criterio, o no se pudo comprobar. Sin esto
// un check «no declarado» quedaba invisible en la HU aunque sí salía en el reporte local. El filtro por
// `plain` deja fuera el ruido (advertencias del linter, tests saltados), que ya tienen su propia sección.
function notVerifiedSection(results) {
  const rows = notVerifiedCases(results); // misma selección que el reporte md/html
  if (!rows.length) return "";
  const L = explainLabels("skip");
  let html =
    sectionBar(`⏭ No verificado (${rows.length})`) +
    `<p style="color:#666;margin:2px 0 6px">Puntos que NO se comprobaron o que quedan como sugerencia. No cuentan como hallazgo: o el proyecto no declaró ese criterio (el kit no lo asume por su cuenta), o no se pudo verificar.</p>`;
  for (const { c, r } of rows) {
    let inner = `<p style="margin:2px 0"><strong>⏭ ${esc(c.name)}</strong> <small style="color:#888">— ${esc(layerLabel(r.layer))}</small></p>`;
    inner += `<p style="margin:2px 0">${L.plain}: ${esc(c.plain)}</p>`;
    if (c.action) inner += `<p style="margin:2px 0;color:#0a5">${L.action}: ${esc(c.action)}</p>`;
    html += box(inner);
  }
  return html;
}

// Tarjeta de UN hallazgo (caso fallido), humanizada + en rojo: qué pasó / qué hacer / autor / detalle.
function failCard(tc, r) {
  const ex = explainFailure(tc, { layer: r.layer, tool: r.metrics && r.metrics.tool });
  const b = tc.blame;
  const out = [`<p style="margin:2px 0"><strong>❌ ${esc(tc.name)}</strong></p>`];
  if (ex) {
    out.push(`<p style="margin:2px 0">🧩 <strong>Qué pasó:</strong> ${esc(ex.plain)}</p>`);
    if (ex.action) out.push(`<p style="margin:2px 0;color:#0a5">👉 <strong>Qué hacer:</strong> ${esc(ex.action)}</p>`);
  }
  if (b) {
    // Nombre amigable + ruta EXACTA (esta última la usa el agente para localizar y corregir).
    const exact = `${(b.file || "").replace(/\\/g, "/")}${b.line ? ":" + b.line : ""}`;
    out.push(`<p style="margin:2px 0;color:#555">👤 <strong>Último en modificar</strong> ${esc(friendlyFile(b.file))} <code>${esc(exact)}</code>: <strong>${esc(b.author || "?")}</strong></p>`);
  }
  if (tc.message) out.push(`<p style="margin:2px 0;color:#8a1020">🔎 <strong>Detalle técnico:</strong> <code>${esc(short(tc.message, 400))}</code></p>`);
  return box(out.join(""), { bg: "#fdf3f3", border: "#f0cccc" });
}

// HTML de la Description de la HU: cabecera con veredicto + resumen por capa + EVIDENCIA (lo que pasó) +
// hallazgos humanizados (una tarjeta por caso) + pie. Estructurado en cajas/secciones para lectura clara.
export function renderFindingsDescription({ results = [], layersRun = [], when = "", reportPath = "" } = {}) {
  const s = summarizeFindings(results);
  // Números CLAROS y ETIQUETADOS: CAPAS (objetivos, p.ej. cada proyecto de test) ≠ PRUEBAS (casos). Antes
  // se mezclaban ("N hallazgos" tomaba pruebas o capas indistintamente) y por eso 5 vs 7 confundía.
  const warnCount = results.filter((r) => r.layer === "static").flatMap((r) => (Array.isArray(r.cases) ? r.cases : [])).filter((c) => c.status === "skip").length;
  const sugg = warnCount ? ` · 💡 ${warnCount} sugerencia(s)` : "";
  const verdictBox = s.hasFindings
    ? box(`❌ <strong>FALLÓ</strong> — ${s.layerFails} capa(s) con hallazgos · ${s.caseFails} prueba(s) en rojo${sugg}. <br><small style="color:#8a1020">Una «capa» es un objetivo (p.ej. un proyecto de test); una «prueba» es un caso dentro de la capa.</small>`, { bg: "#fdecea", border: "#f5c6cb" })
    : box(`✅ <strong>Sin hallazgos</strong> — ${s.layers} capa(s) ejecutada(s), todo en verde${sugg}.`, { bg: "#e7f6ec", border: "#b6e0c2" });
  const head =
    `<p style="font-size:1.1em"><strong>${esc(TITLE_PREFIX)}</strong></p>` +
    `<p>🗓️ Ejecución: <strong>${esc(when)}</strong> · Capas corridas: ${esc(layersRun.map(layerLabel).join(", ") || "ninguna")}</p>` +
    verdictBox;

  const table = sectionBar("📊 Resumen por capa") + layerTable(results);

  // Evidencia: todo lo que se validó bien — incluye las capas que quedaron en rojo pero comprobaron
  // cosas adentro (p.ej. la BD conectó y verificó 6 puntos aunque uno fallara).
  const evLayers = evidenceLayers(results);
  const evidence = evLayers.length
    ? sectionBar("✅ Evidencia — lo que se validó correctamente") + evLayers.map(evidenceCard).join("")
    : "";

  // Sugerencias (advertencias del linter) — positivas, junto a la evidencia.
  const suggestions = suggestionsSection(results);

  // Hallazgos: capas/casos en rojo, cada uno en su tarjeta.
  let findings = sectionBar("❌ Hallazgos");
  if (s.hasFindings) {
    for (const r of results) {
      const cases = Array.isArray(r.cases) ? r.cases : [];
      const fails = cases.filter((c) => c.status === "fail");
      if (r.status !== "fail" && !fails.length) continue;
      const tool = (r.metrics && r.metrics.tool) || "";
      const label = r.metrics && r.metrics.label ? ` (${esc(r.metrics.label)})` : "";
      findings += `<p style="margin:10px 0 2px"><strong>📁 ${esc(layerLabel(r.layer))}</strong>${tool ? ` — ${esc(tool)}` : ""}${label}${fails.length ? ` · ${fails.length} hallazgo(s)` : ""}</p>`;
      if (fails.length) {
        // Lo que SÍ pasó en esta capa ya está arriba, en «✅ Evidencia» (evidencia parcial).
        findings += fails.map((c) => failCard(c, r)).join("");
      } else {
        // Capa en rojo SIN desglose por caso (dotnet/tsc/redocly salen ≠0 sin JSON por prueba).
        const ex = explainLayerFailure(r);
        const parts = [];
        if (ex) {
          parts.push(`<p style="margin:2px 0">🧩 <strong>Qué pasó:</strong> ${esc(ex.plain)}</p>`);
          if (ex.action) parts.push(`<p style="margin:2px 0;color:#0a5">👉 <strong>Qué hacer:</strong> ${esc(ex.action)}</p>`);
        }
        if (r.narrative) parts.push(`<p style="margin:2px 0;color:#8a1020">🔎 <strong>Detalle técnico:</strong> <code>${esc(short(r.narrative, 400))}</code></p>`);
        findings += box(parts.join("") || "Falló sin más detalle.", { bg: "#fdf3f3", border: "#f0cccc" });
      }
    }
  } else {
    findings += box("✅ No se encontraron hallazgos en las capas ejecutadas.", { bg: "#e7f6ec", border: "#b6e0c2" });
  }

  const foot =
    `<hr/>` +
    (reportPath ? `<p>📄 Reporte local (autocontenido): <code>${esc(reportPath)}</code></p>` : "") +
    `<p><em>HU creada automáticamente por el Agente QA (QualityOps Framework). No está relacionada a ninguna HU/Feature: agrupa los hallazgos de esta ejecución en el sprint en curso del proyecto.</em></p>`;

  return head + table + evidence + suggestions + notVerifiedSection(results) + findings + foot;
}

export default { renderFindingsDescription, buildFindingsTitle, summarizeFindings, stampNow, TITLE_PREFIX, FINDINGS_TAGS, FINDINGS_COUNT_TAG };
