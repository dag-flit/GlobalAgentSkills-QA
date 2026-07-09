// local-sink.mjs — sink de evidencia LOCAL. Sin red. Escribe md + html en qa-evidence/.
// Es el destino por defecto cuando tracker=local (o evidence.sink=local).

import fs from "node:fs";
import path from "node:path";
import { renderCoverageMd, renderCoverageHtml } from "./ac-coverage.mjs";
import { toolDescription, interpretLayer } from "./layer-explain.mjs";
import { explainFailure, explainLayerFailure } from "./failure-explain.mjs";
import { planMd, planHtml } from "./report-plan.mjs";
import { slug, collectShots } from "./report-shots.mjs";

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
// Render HTML del detalle paso a paso. Embebe la captura de CADA paso (línea de tiempo del
// flujo) usando el mapa src→rel; los `src` embebidos se marcan en `embedded` para no repetirlos
// luego en la galería del pie.
function casesHtml(results, byFile = {}, embedded = new Set()) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases
    .map((r) => {
      const items = r.cases
        .map((tc) => {
          const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : r.layer === "static" ? "⚠" : "⏭";
          const d = typeof tc.duration === "number" ? ` <small style="color:#888">(${tc.duration} ms)</small>` : "";
          // Explicación en lenguaje llano (qué pasó / qué hacer) para no técnicos, antes del detalle.
          const ex = tc.status === "fail" ? explainFailure(tc, { layer: r.layer, tool: r.metrics?.tool }) : null;
          const blameLine = tc.blame
            ? `<div style="color:#555;margin-top:2px">👤 <b>Último en modificar</b> <code>${esc(
                tc.blame.line ? `${tc.blame.file}:${tc.blame.line}` : tc.blame.file
              )}</code>: ${esc(tc.blame.author)}${tc.blame.date ? ` <small>(${esc(tc.blame.date)})</small>` : ""}</div>`
            : tc.status === "fail"
              ? `<div style="color:#888;margin-top:2px">👤 Sin responsable: el error no señala un archivo/línea del repo, no hay a quién atribuirlo automáticamente.</div>`
              : "";
          const human =
            ex || tc.status === "fail"
              ? `<div style="margin:2px 0 4px 1.4rem;font-size:.9em">${
                  ex ? `<div><b>🧩 Qué pasó:</b> ${esc(ex.plain)}</div>` : ""
                }${ex && ex.action ? `<div style="color:#0a5"><b>👉 Qué hacer:</b> ${esc(ex.action)}</div>` : ""}${blameLine}</div>`
              : "";
          const msg =
            tc.status === "fail" && tc.message
              ? `${human}<div style="color:#b00020;margin:2px 0 6px 1.4rem;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:.8em"><b style="color:#888">Detalle técnico:</b> ${esc(
                  String(tc.message).split(/\r?\n/).slice(0, 3).join("\n")
                )}</div>`
              : human;
          const uri = tc.file && byFile[tc.file];
          let img = "";
          if (uri) {
            embedded.add(tc.file);
            img = `<div style="margin:.3rem 0 .7rem 1.4rem"><img src="${uri}" alt="${esc(tc.name)}" loading="lazy" style="max-width:560px;width:100%;border:1px solid #ccc;border-radius:6px"></div>`;
          }
          return `<li style="margin:.35rem 0">${ic} ${esc(tc.name)}${d}${msg}${img}</li>`;
        })
        .join("");
      return `<details open style="margin:.5rem 0"><summary><b>${esc(r.layer)} — ${esc(
        r.metrics?.tool ?? ""
      )}</b>${caseWhere(r)} · ${caseCounts(r.cases)}</summary><ul style="margin:.4rem 0;list-style:none;padding-left:.4rem">${items}</ul></details>`;
    })
    .join("");
  return `<h2>Detalle del flujo (paso a paso)</h2>${blocks}`;
}

// Línea "qué se ejecutó": comando exacto + duración + código de salida, desde las métricas.
function execLine(r) {
  const parts = [];
  if (r.metrics?.command) parts.push(`comando: ${r.metrics.command}`);
  if (typeof r.metrics?.ms === "number") parts.push(`${(r.metrics.ms / 1000).toFixed(1)} s`);
  if (typeof r.metrics?.exitCode === "number") parts.push(`exit ${r.metrics.exitCode}`);
  return parts.join(" · ");
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.profile
 * @param {string} [opts.workItemId]
 * @param {string} [opts.featureId]   número/id del Feature (FT) padre — para trazar la HU a su FT
 * @param {string} [opts.developer]   desarrollador responsable — para separar corridas por dev
 * @param {object} [opts.plan]        plan de pruebas del Feature (HUs + TC) para paridad offline
 * @param {EvidenceObject[]} opts.results
 * @returns {{dir:string, mdPath:string, htmlPath:string}}
 */
export function writeLocalReport({ repoRoot, profile = {}, workItemId = "local", featureId, developer, plan, results = [] }) {
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

  // Capturas: se copian a <dir>/capturas/ para que la evidencia sea autocontenida.
  const shots = collectShots(results, dir);

  const total = results.length;
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;

  // Veredicto: cuenta casos/pasos fallidos Y capas que fallan SIN desglose por caso (tsc/pytest/
  // redocly salen ≠0 sin JSON por caso) — así "FALLÓ" nunca queda como "0 con problemas". El término
  // se adapta al modo: "paso" para exploración E2E, "prueba" para QA del código.
  const allCases = results.flatMap((r) => (Array.isArray(r.cases) ? r.cases : []));
  const stepPass = allCases.filter((c) => c.status === "pass").length;
  const stepFail = allCases.filter((c) => c.status === "fail").length;
  const failed = fail > 0 || stepFail > 0;
  const unitWord = results.some((r) => r.layer === "explore") ? "paso" : "prueba";
  const caselessFails = results.filter(
    (r) => r.status === "fail" && !(Array.isArray(r.cases) && r.cases.some((c) => c.status === "fail")),
  );
  let verdictTxt;
  if (!failed) {
    verdictTxt = `✅ PASÓ${allCases.length ? ` — ${stepPass}/${allCases.length} ${unitWord}(s) ok` : ""}`;
  } else {
    const parts = [];
    if (stepFail > 0) parts.push(`${stepFail} de ${allCases.length} ${unitWord}(s) con problemas`);
    if (caselessFails.length) {
      parts.push(`capa(s) con fallo: ${caselessFails.map((r) => `${r.layer}${r.metrics?.tool ? ` (${r.metrics.tool})` : ""}`).join(", ")}`);
    }
    verdictTxt = `❌ FALLÓ — ${parts.join(" · ") || "revisá el detalle"}`;
  }

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
  md.push(`**Veredicto:** ${verdictTxt}`);
  md.push("");
  md.push(`**Resumen:** ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip`);
  md.push("");
  // Cobertura de criterios de aceptación (matriz AC ↔ pasos) — cuando el guion la declara.
  for (const r of results) if (r.coverage) for (const line of renderCoverageMd(r.coverage)) md.push(line);
  // Plan de pruebas del Feature (paridad con la Task del tracker) — antes de la tabla de capas.
  for (const line of planMd(plan, results)) md.push(line);
  md.push("| Capa | TC | Resultado | Notas |");
  md.push("|------|----|-----------|-------|");
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
    md.push(`| ${esc(r.layer)} | ${esc(r.tc_id ?? "—")} | ${icon} ${r.status} | ${esc(r.narrative ?? "")} |`);
  }
  md.push("");

  // ---- Capas con FALLO sin desglose por prueba (caseless): misma claridad 🧩/👉 que los TC ----
  // (dotnet-test/tsc/redocly salen ≠0 sin JSON por caso → no aparecen en el detalle de TC de abajo).
  const caselessFail = results.filter(
    (r) => r.status === "fail" && !(Array.isArray(r.cases) && r.cases.some((c) => c.status === "fail")),
  );
  if (caselessFail.length) {
    md.push("## Capas con fallo (sin desglose por prueba)");
    md.push("");
    for (const r of caselessFail) {
      const ex = explainLayerFailure(r);
      md.push(`### ${esc(r.layer)} — ${esc(r.metrics?.tool ?? "")}${caseWhere(r)}`);
      if (ex) {
        md.push(`- 🧩 **Qué pasó:** ${esc(ex.plain)}`);
        if (ex.action) md.push(`- 👉 **Qué hacer:** ${esc(ex.action)}`);
      }
      if (r.blame) {
        const at = r.blame.line ? `${r.blame.file}:${r.blame.line}` : r.blame.file;
        md.push(`- 👤 **Último en modificar** \`${esc(at)}\`: ${esc(r.blame.author)}${r.blame.date ? ` _(${esc(r.blame.date)})_` : ""}`);
      } else {
        md.push(`- 👤 _Sin responsable: la herramienta no dejó un archivo/línea en el error, no hay a quién atribuirlo automáticamente._`);
      }
      if (r.narrative) md.push(`- ⚠ _Detalle técnico:_ ${esc(String(r.narrative).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}`);
      md.push("");
    }
  }

  // ---- Detalle por capa: los TC ejecutados por debajo de cada capa ----
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (withCases.length) {
    md.push("## Detalle de pruebas (TC ejecutados)");
    md.push("");
    for (const r of withCases) {
      md.push(`### ${esc(r.layer)} — ${esc(r.metrics?.tool ?? "")}${caseWhere(r)}  ·  ${caseCounts(r.cases)}`);
      md.push("");
      for (const tc of r.cases) {
        // En static, "skip" = advertencia del linter (no un test saltado) → ⚠ para no confundir.
        const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : r.layer === "static" ? "⚠" : "⏭";
        const d = typeof tc.duration === "number" ? ` _(${tc.duration} ms)_` : "";
        md.push(`- ${ic} ${esc(tc.name)}${d}`);
        if (tc.status === "fail") {
          // Explicación en lenguaje llano (qué pasó / qué hacer) ANTES del detalle técnico.
          const ex = explainFailure(tc, { layer: r.layer, tool: r.metrics?.tool });
          if (ex) {
            md.push(`  - 🧩 **Qué pasó:** ${esc(ex.plain)}`);
            if (ex.action) md.push(`  - 👉 **Qué hacer:** ${esc(ex.action)}`);
          }
          if (tc.blame) {
            const at = tc.blame.line ? `${tc.blame.file}:${tc.blame.line}` : tc.blame.file;
            md.push(`  - 👤 **Último en modificar** \`${esc(at)}\`: ${esc(tc.blame.author)}${tc.blame.date ? ` _(${esc(tc.blame.date)})_` : ""}`);
          } else {
            md.push(`  - 👤 _Sin responsable: el error no señala un archivo/línea del repo, así que no hay a quién atribuirlo automáticamente._`);
          }
          if (tc.message) {
            md.push(`  - ⚠ _Detalle técnico:_ ${esc(String(tc.message).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}`);
          }
        }
      }
      md.push("");
    }
  }

  // ---- Qué se ejecutó por capa (comando exacto + duración) ----
  const execd = results.filter((r) => r.metrics?.command);
  if (execd.length) {
    md.push("## Qué se ejecutó por capa");
    md.push("");
    for (const r of execd) {
      md.push(`- **${esc(r.layer)}** (${esc(r.metrics.tool ?? "")}): \`${esc(r.metrics.command)}\` · ${(r.metrics.ms / 1000).toFixed(1)} s · exit ${r.metrics.exitCode}`);
      const desc = toolDescription(r.metrics.tool, r.layer);
      if (desc) md.push(`  - _Qué hace:_ ${esc(desc)}.`);
      md.push(`  - _Resultado:_ ${esc(interpretLayer(r))}`);
    }
    md.push("");
  }

  // ---- Capturas (referencias a las imágenes copiadas a capturas/) ----
  if (shots.length) {
    md.push("## Capturas");
    md.push("");
    for (const s of shots) {
      md.push(`**${esc(s.layer)}** — ${esc(s.name)}`);
      md.push("");
      md.push(`![${esc(s.layer)}](${s.rel})`);
      md.push("");
    }
  }

  const mdPath = path.join(dir, "report.md");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  // ---- HTML ----
  const rows = results
    .map((r) => {
      const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
      const ex = execLine(r);
      const desc = toolDescription(r.metrics?.tool, r.layer);
      const note = `${esc(interpretLayer(r))}${
        desc ? `<br><small style="color:#888">Qué hace: ${esc(desc)}.</small>` : ""
      }${ex ? `<br><small style="color:#666">Comando: <code>${esc(ex)}</code></small>` : ""}`;
      return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id ?? "—")}</td><td>${icon} ${esc(
        r.status
      )}</td><td>${note}</td></tr>`;
    })
    .join("\n");
  // Detalle paso a paso con la captura embebida en cada paso; marca las capturas ya mostradas
  // para no repetirlas en la galería del pie.
  // Se embebe la captura como data-URI (HTML autocontenido) en vez de una ruta relativa que un
  // proxy no podría resolver. Los `src` embebidos se marcan para no repetirlos en la galería.
  const byData = Object.fromEntries(shots.map((s) => [s.src, s.data]));
  const embedded = new Set();
  const casesBlock = casesHtml(results, byData, embedded);

  // Capas con FALLO sin desglose por caso → misma claridad 🧩/👉 a nivel de capa (caseless).
  const caselessBlock = caselessFail.length
    ? `<h2>Capas con fallo (sin desglose por prueba)</h2>${caselessFail
        .map((r) => {
          const ex = explainLayerFailure(r);
          const td = r.narrative
            ? `<div style="color:#b00020;margin-top:2px;font-family:ui-monospace,Consolas,monospace;font-size:.8em"><b style="color:#888">Detalle técnico:</b> ${esc(
                String(r.narrative).split(/\r?\n/).slice(0, 3).join(" ")
              )}</div>`
            : "";
          const blameB = r.blame
            ? `<div style="color:#555;margin-top:2px">👤 <b>Último en modificar</b> <code>${esc(
                r.blame.line ? `${r.blame.file}:${r.blame.line}` : r.blame.file
              )}</code>: ${esc(r.blame.author)}${r.blame.date ? ` <small>(${esc(r.blame.date)})</small>` : ""}</div>`
            : `<div style="color:#888;margin-top:2px">👤 Sin responsable: la herramienta no dejó un archivo/línea en el error, no hay a quién atribuirlo automáticamente.</div>`;
          return `<div style="margin:.5rem 0;padding:.4rem .6rem;border:1px solid #f0c9c9;border-radius:6px;background:#fdf2f2"><b>❌ ${esc(
            r.layer
          )} — ${esc(r.metrics?.tool ?? "")}</b>${caseWhere(r)}${
            ex ? `<div style="margin-top:3px"><b>🧩 Qué pasó:</b> ${esc(ex.plain)}</div>` : ""
          }${ex && ex.action ? `<div style="color:#0a5"><b>👉 Qué hacer:</b> ${esc(ex.action)}</div>` : ""}${blameB}${td}</div>`;
        })
        .join("")}`
    : "";
  const galleryShots = shots.filter((s) => !embedded.has(s.src));

  const verdictColor = failed
    ? "border:1px solid #f5c6cb;background:#fdecea;color:#b00020"
    : "border:1px solid #b6e0c2;background:#e7f6ec;color:#0a7a34";
  const verdictHtml = `<div style="${verdictColor};padding:10px 14px;border-radius:8px;font-weight:600;margin:.6rem 0">${esc(verdictTxt)}</div>`;

  const shotsHtml = galleryShots.length
    ? `<h2>Otras capturas</h2>${galleryShots
        .map(
          (s) =>
            `<figure style="margin:.6rem 0"><img src="${s.data}" alt="${esc(s.layer)}" style="max-width:100%;border:1px solid #ccc;border-radius:6px"><figcaption style="color:#666;font-size:.85em">${esc(
              s.layer
            )} — ${esc(s.name)}</figcaption></figure>`
        )
        .join("")}`
    : "";
  const wiHtml =
    workItemId && workItemId !== "local" ? `<p><b>WI destino:</b> ${esc(workItemId)}</p>` : "";
  const coverageBlock = results.filter((r) => r.coverage).map((r) => renderCoverageHtml(r.coverage)).join("");
  const html = `<!doctype html><meta charset="utf-8">
<title>Reporte QA local</title>
<body style="font-family:system-ui,Arial,sans-serif;max-width:900px;margin:2rem auto;color:#222">
<h1>Reporte QA local</h1>
<p><b>Fecha:</b> ${stamp} · <b>Proyecto:</b> ${esc(profile.project?.name ?? "auto")} · <b>Tracker:</b> local</p>
${wiHtml}
${featureId || developer ? `<p>${[featureId ? `<b>Feature (FT):</b> ${esc(featureId)}` : null, developer ? `<b>Desarrollador:</b> ${esc(developer)}` : null].filter(Boolean).join(" · ")}</p>` : ""}
${verdictHtml}
<p><b>Resumen:</b> ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip</p>
${coverageBlock}
${planHtml(plan, results)}
<table style="border-collapse:collapse;width:100%">
<thead><tr>${["Capa", "TC", "Resultado", "Notas"]
    .map((h) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f0f0f0;text-align:left">${h}</th>`)
    .join("")}</tr></thead>
<tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 8px">')}</tbody>
</table>
${caselessBlock}
${casesBlock}
${shotsHtml}
</body>`;
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return { dir, mdPath, htmlPath };
}

export default { writeLocalReport };
