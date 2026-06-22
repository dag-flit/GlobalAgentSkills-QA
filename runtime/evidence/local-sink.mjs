// local-sink.mjs — sink de evidencia LOCAL. Sin red. Escribe md + html en qa-evidence/.
// Es el destino por defecto cuando tracker=local (o evidence.sink=local).

import fs from "node:fs";
import path from "node:path";

function todayStamp(tz) {
  // tz reservado para F1 (locale.timezone); por ahora fecha ISO local
  return new Date().toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Etiqueta de ubicación del objetivo (monorepo) para el encabezado de detalle de TC.
function caseWhere(r) {
  return r.metrics?.cwd ? ` @ ${esc(r.metrics.cwd)}` : "";
}
// Recuento ✅/❌/⏭ de una lista de TC.
function caseCounts(cases) {
  const c = (s) => cases.filter((x) => x.status === s).length;
  return `✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`;
}
// Render HTML del detalle de TC (un bloque <details> por capa/herramienta).
function casesHtml(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases
    .map((r) => {
      const items = r.cases
        .map((tc) => {
          const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : "⏭";
          const d = typeof tc.duration === "number" ? ` <small style="color:#888">(${tc.duration} ms)</small>` : "";
          const msg =
            tc.status === "fail" && tc.message
              ? `<div style="color:#b00020;margin:2px 0 6px 1.4rem;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:.85em">${esc(
                  String(tc.message).split(/\r?\n/).slice(0, 3).join("\n")
                )}</div>`
              : "";
          return `<li>${ic} ${esc(tc.name)}${d}${msg}</li>`;
        })
        .join("");
      return `<details open style="margin:.5rem 0"><summary><b>${esc(r.layer)} — ${esc(
        r.metrics?.tool ?? ""
      )}</b>${caseWhere(r)} · ${caseCounts(r.cases)}</summary><ul style="margin:.4rem 0">${items}</ul></details>`;
    })
    .join("");
  return `<h2>Detalle de pruebas (TC ejecutados)</h2>${blocks}`;
}

// Convierte un valor libre (nombre de dev, id) en un segmento de carpeta seguro y portable:
// quita tildes (ñ→n, á→a), colapsa lo no [A-Za-z0-9._-] en `-`, recorta. Cross-platform.
function slug(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.profile
 * @param {string} [opts.workItemId]
 * @param {string} [opts.featureId]   número/id del Feature (FT) padre — para trazar la HU a su FT
 * @param {string} [opts.developer]   desarrollador responsable — para separar corridas por dev
 * @param {EvidenceObject[]} opts.results
 * @returns {{dir:string, mdPath:string, htmlPath:string}}
 */
export function writeLocalReport({ repoRoot, profile = {}, workItemId = "local", featureId, developer, results = [] }) {
  const outDir = (profile.evidence && profile.evidence.output_dir) || "qa-evidence";
  const stamp = todayStamp(profile.locale && profile.locale.timezone);
  // Subcarpeta del test: se nombra netamente con el Feature (FT-<feature>) y el dev (slug),
  // p.ej. `FT-10118__Dev-Nono-Perez`. Así, al correr pruebas de distintos devs sobre el
  // mismo feature, cada corrida queda en su propia carpeta trazable y no se pisan.
  // Fallback: si no llega ni FT ni dev, se usa WI-<id> para que la carpeta nunca quede sin nombre.
  const segParts = [];
  if (featureId) segParts.push(`FT-${slug(featureId)}`);
  if (developer) segParts.push(slug(developer));
  if (segParts.length === 0) segParts.push(`WI-${workItemId}`);
  const dir = path.join(repoRoot, outDir, stamp, segParts.join("__"));
  fs.mkdirSync(dir, { recursive: true });

  const total = results.length;
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;

  // ---- Markdown ----
  const md = [];
  md.push(`# Reporte QA local`);
  md.push("");
  md.push(`**Fecha:** ${stamp}  ·  **Proyecto:** ${esc(profile.project?.name ?? "auto")}  ·  **Tracker:** local`);
  if (featureId || developer) {
    const trace = [];
    if (featureId) trace.push(`**Feature (FT):** ${esc(featureId)}`);
    if (developer) trace.push(`**Desarrollador:** ${esc(developer)}`);
    md.push("");
    md.push(trace.join("  ·  "));
  }
  md.push("");
  md.push(`**Resumen:** ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip`);
  md.push("");
  md.push("| Capa | TC | Resultado | Notas |");
  md.push("|------|----|-----------|-------|");
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
    md.push(`| ${esc(r.layer)} | ${esc(r.tc_id ?? "—")} | ${icon} ${r.status} | ${esc(r.narrative ?? "")} |`);
  }
  md.push("");

  // ---- Detalle por capa: los TC ejecutados por debajo de cada capa ----
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (withCases.length) {
    md.push("## Detalle de pruebas (TC ejecutados)");
    md.push("");
    for (const r of withCases) {
      md.push(`### ${esc(r.layer)} — ${esc(r.metrics?.tool ?? "")}${caseWhere(r)}  ·  ${caseCounts(r.cases)}`);
      md.push("");
      for (const tc of r.cases) {
        const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : "⏭";
        const d = typeof tc.duration === "number" ? ` _(${tc.duration} ms)_` : "";
        md.push(`- ${ic} ${esc(tc.name)}${d}`);
        if (tc.status === "fail" && tc.message) {
          md.push(`  - ⚠ ${esc(String(tc.message).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}`);
        }
      }
      md.push("");
    }
  }

  const mdPath = path.join(dir, "report.md");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  // ---- HTML ----
  const rows = results
    .map((r) => {
      const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
      return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id ?? "—")}</td><td>${icon} ${esc(
        r.status
      )}</td><td>${esc(r.narrative ?? "")}</td></tr>`;
    })
    .join("\n");
  const html = `<!doctype html><meta charset="utf-8">
<title>Reporte QA local</title>
<body style="font-family:system-ui,Arial,sans-serif;max-width:900px;margin:2rem auto;color:#222">
<h1>Reporte QA local</h1>
<p><b>Fecha:</b> ${stamp} · <b>Proyecto:</b> ${esc(profile.project?.name ?? "auto")} · <b>Tracker:</b> local</p>
${featureId || developer ? `<p>${[featureId ? `<b>Feature (FT):</b> ${esc(featureId)}` : null, developer ? `<b>Desarrollador:</b> ${esc(developer)}` : null].filter(Boolean).join(" · ")}</p>` : ""}
<p><b>Resumen:</b> ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip</p>
<table style="border-collapse:collapse;width:100%">
<thead><tr>${["Capa", "TC", "Resultado", "Notas"]
    .map((h) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f0f0f0;text-align:left">${h}</th>`)
    .join("")}</tr></thead>
<tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 8px">')}</tbody>
</table>
${casesHtml(results)}
</body>`;
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return { dir, mdPath, htmlPath };
}

export default { writeLocalReport };
