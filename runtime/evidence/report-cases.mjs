// report-cases.mjs — render del DETALLE POR CASO del reporte local (markdown + html).
// Extraído de local-sink.mjs para respetar el guardrail de 400 líneas y para que MD y HTML
// compartan UNA sola regla de presentación (antes cada uno la implementaba por su lado).
//
// Regla de COHERENCIA (la misma en HU, MD, HTML y UX): un caso que trae explicación (`plain`) la
// muestra SIEMPRE — pase, falle o se omita — con la etiqueta que corresponde a su estado
// (✔ qué se validó / 🧩 qué pasó / ℹ️ qué significa). Antes solo se explicaban los ROJOS: un check
// omitido («no declarado») o uno en verde perdían su mensaje y quedaban como una línea muda.

import { explainFailure, explainLabels } from "./failure-explain.mjs";
import { friendlyFile } from "./lint-explain.mjs";

export function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
// Etiqueta de ubicación del objetivo (monorepo) para el encabezado de detalle.
export function caseWhere(r) {
  return r.metrics?.cwd ? ` @ ${esc(r.metrics.cwd)}` : "";
}
// Recuento ✅/❌/⏭ de una lista de casos.
export function caseCounts(cases) {
  const c = (s) => cases.filter((x) => x.status === s).length;
  return `✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`;
}
// Atribución: nombre AMIGABLE del archivo + ruta EXACTA (esta la usan los agentes para corregir).
export function blameAt(b) {
  return { friendly: friendlyFile(b.file), exact: `${String(b.file || "").replace(/\\/g, "/")}${b.line ? ":" + b.line : ""}` };
}

// Capas cuyos hallazgos NO se atribuyen por git-blame: esquema (db/api) y seguridad (una dependencia
// vulnerable o un secreto no son una línea "de autor"). La HU tampoco muestra "Sin responsable" para
// estas → tenerlas en un set ÚNICO mantiene las 4 rutas coherentes. Espejado en la webapp (CaseList).
export const NO_BLAME_LAYERS = new Set(["db", "api", "security"]);

// ¿Este caso lleva bloque explicativo? Los rojos siempre; el resto solo si el check emitió su
// propia explicación (`plain`) — así las 71 pruebas verdes de una suite NO inflan el reporte,
// pero un check declarativo de BD sí se explica aunque esté en verde u omitido.
const explains = (tc) => tc.status === "fail" || Boolean(tc.plain);
// En `static`, un "skip" es una ADVERTENCIA del linter (no un test saltado) → ⚠ para no confundir.
const icon = (tc, layer) => (tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : layer === "static" ? "⚠" : "⏭");
const techDetail = (m) => String(m).split(/\r?\n/).slice(0, 3).join(" ⏎ ");

// Encabezado según el modo: "flujo (paso a paso)" para exploración E2E; "por capa" para QA del código.
function heading(results) {
  return results.some((r) => r.layer === "explore") ? "Detalle del flujo (paso a paso)" : "Detalle por capa (pruebas ejecutadas)";
}
function layerHead(r) {
  const label = r.metrics?.label ? ` · ${esc(r.metrics.label)}` : "";
  return `${esc(r.layer)} — ${esc(r.metrics?.tool ?? "")}${label}${caseWhere(r)}`;
}

/** Detalle por caso en MARKDOWN → array de líneas (vacío si ninguna capa trae casos). */
export function casesMd(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return [];
  const md = [`## ${heading(results)}`, ""];
  for (const r of withCases) {
    md.push(`### ${layerHead(r)}  ·  ${caseCounts(r.cases)}`);
    md.push("");
    for (const tc of r.cases) {
      const d = typeof tc.duration === "number" ? ` _(${tc.duration} ms)_` : "";
      md.push(`- ${icon(tc, r.layer)} ${esc(tc.name)}${d}`);
      if (!explains(tc)) continue;
      const ex = explainFailure(tc, { layer: r.layer, tool: r.metrics?.tool });
      const L = explainLabels(tc.status);
      if (ex) {
        md.push(`  - **${L.plain}:** ${esc(ex.plain)}`);
        if (ex.action) md.push(`  - **${L.action}:** ${esc(ex.action)}`);
      }
      if (tc.status === "fail") {
        if (tc.blame) {
          const bl = blameAt(tc.blame);
          md.push(`  - 👤 **Último en modificar** ${esc(bl.friendly)} \`${esc(bl.exact)}\`: ${esc(tc.blame.author)}${tc.blame.date ? ` _(${esc(tc.blame.date)})_` : ""}`);
        } else if (!NO_BLAME_LAYERS.has(r.layer)) {
          // La atribución por git-blame no aplica a hallazgos de esquema (db/api) ni de seguridad
          // (una dependencia vulnerable o un secreto no son una línea "de autor" en ese sentido). La HU
          // tampoco la muestra para estos → suprimirla acá mantiene las 4 rutas coherentes.
          md.push(`  - 👤 _Sin responsable: el error no señala un archivo/línea del repo, así que no hay a quién atribuirlo automáticamente._`);
        }
      }
      if (tc.message) md.push(`  - 🔎 _Detalle técnico:_ ${esc(techDetail(tc.message))}`);
    }
    md.push("");
  }
  return md;
}

/**
 * Detalle por caso en HTML. Embebe la captura de CADA paso (línea de tiempo del flujo) usando el
 * mapa src→data-URI; los `src` embebidos se marcan en `embedded` para no repetirlos en la galería.
 */
export function casesHtml(results, byFile = {}, embedded = new Set()) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases
    .map((r) => {
      const items = r.cases
        .map((tc) => {
          const d = typeof tc.duration === "number" ? ` <small style="color:#888">(${tc.duration} ms)</small>` : "";
          let body = "";
          if (explains(tc)) {
            const ex = explainFailure(tc, { layer: r.layer, tool: r.metrics?.tool });
            const L = explainLabels(tc.status);
            const parts = [];
            if (ex) {
              parts.push(`<div><b>${L.plain}:</b> ${esc(ex.plain)}</div>`);
              if (ex.action) parts.push(`<div style="color:#0a5"><b>${L.action}:</b> ${esc(ex.action)}</div>`);
            }
            if (tc.status === "fail") {
              if (tc.blame) {
                const bl = blameAt(tc.blame);
                parts.push(`<div style="color:#555">👤 <b>Último en modificar</b> ${esc(bl.friendly)} <code>${esc(bl.exact)}</code>: ${esc(tc.blame.author)}${tc.blame.date ? ` <small>(${esc(tc.blame.date)})</small>` : ""}</div>`);
              } else if (!NO_BLAME_LAYERS.has(r.layer)) {
                parts.push(`<div style="color:#888">👤 Sin responsable: el error no señala un archivo/línea del repo, no hay a quién atribuirlo automáticamente.</div>`);
              }
            }
            if (tc.message) {
              parts.push(`<div style="color:${tc.status === "fail" ? "#b00020" : "#666"};white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:.85em"><b style="color:#888">Detalle técnico:</b> ${esc(techDetail(tc.message))}</div>`);
            }
            if (parts.length) body = `<div style="margin:2px 0 4px 1.4rem;font-size:.9em">${parts.join("")}</div>`;
          }
          const uri = tc.file && byFile[tc.file];
          let img = "";
          if (uri) {
            embedded.add(tc.file);
            img = `<div style="margin:.3rem 0 .7rem 1.4rem"><img src="${uri}" alt="${esc(tc.name)}" loading="lazy" style="max-width:560px;width:100%;border:1px solid #ccc;border-radius:6px"></div>`;
          }
          return `<li style="margin:.35rem 0">${icon(tc, r.layer)} ${esc(tc.name)}${d}${body}${img}</li>`;
        })
        .join("");
      return `<details open style="margin:.5rem 0"><summary><b>${layerHead(r)}</b> · ${caseCounts(
        r.cases,
      )}</summary><ul style="margin:.4rem 0;list-style:none;padding-left:.4rem">${items}</ul></details>`;
    })
    .join("");
  return `<h2>${heading(results)}</h2>${blocks}`;
}

export default { casesMd, casesHtml, esc, caseWhere, caseCounts, blameAt };
