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

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.profile
 * @param {string} [opts.workItemId]
 * @param {EvidenceObject[]} opts.results
 * @returns {{dir:string, mdPath:string, htmlPath:string}}
 */
export function writeLocalReport({ repoRoot, profile = {}, workItemId = "local", results = [] }) {
  const outDir = (profile.evidence && profile.evidence.output_dir) || "qa-evidence";
  const stamp = todayStamp(profile.locale && profile.locale.timezone);
  const dir = path.join(repoRoot, outDir, stamp, `WI-${workItemId}`);
  fs.mkdirSync(dir, { recursive: true });

  const total = results.length;
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;

  // ---- Markdown ----
  const md = [];
  md.push(`# Reporte QA local — WI ${workItemId}`);
  md.push("");
  md.push(`**Fecha:** ${stamp}  ·  **Proyecto:** ${esc(profile.project?.name ?? "auto")}  ·  **Tracker:** local`);
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
<title>Reporte QA local — WI ${esc(workItemId)}</title>
<body style="font-family:system-ui,Arial,sans-serif;max-width:900px;margin:2rem auto;color:#222">
<h1>Reporte QA local — WI ${esc(workItemId)}</h1>
<p><b>Fecha:</b> ${stamp} · <b>Proyecto:</b> ${esc(profile.project?.name ?? "auto")} · <b>Tracker:</b> local</p>
<p><b>Resumen:</b> ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip</p>
<table style="border-collapse:collapse;width:100%">
<thead><tr>${["Capa", "TC", "Resultado", "Notas"]
    .map((h) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f0f0f0;text-align:left">${h}</th>`)
    .join("")}</tr></thead>
<tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 8px">')}</tbody>
</table>
</body>`;
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return { dir, mdPath, htmlPath };
}

export default { writeLocalReport };
