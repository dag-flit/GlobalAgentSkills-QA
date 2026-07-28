// local-sink.mjs — sink de evidencia LOCAL. Sin red. Escribe md + html en qa-evidence/.
// Es el destino por defecto cuando tracker=local (o evidence.sink=local).

import fs from "node:fs";
import path from "node:path";
import { renderCoverageMd, renderCoverageHtml } from "./ac-coverage.mjs";
import { toolDescription, interpretLayer, describeEvidence, evidenceItems, evidenceLayers, notVerifiedCases, suggestionCases, techDetail } from "./layer-explain.mjs";
import { warningsMd, warningsHtml } from "./lint-explain.mjs";
import { explainLayerFailure } from "./failure-explain.mjs";
import { executedMd } from "./report-executed.mjs";
import { planMd, planHtml } from "./report-plan.mjs";
import { collectShots, evidenceRunDir } from "./report-shots.mjs";
// El detalle POR CASO (md + html) vive en report-cases.mjs: una sola regla de presentación para
// ambos formatos, y este archivo queda dentro del guardrail de 400 líneas. `skipSection*` renderiza
// las dos secciones de casos omitidos (💡 sugerencias de seguridad · ⏭ no verificado) con una regla.
import { casesMd, casesHtml, esc, caseWhere, blameAt, skipSectionMd, skipSectionHtml } from "./report-cases.mjs";

// Intros de las dos secciones de casos omitidos (compartidas con la HU → mismo texto en las 4 rutas).
const SUGG_INTRO = "Hallazgos reales pero que NO bloquean la certificación: se detectaron y se reportan como sugerencia (p.ej. vulnerabilidades de dependencia de severidad media/baja, o licencias a revisar). Conviene atenderlas; no reprueban.";
const NOVER_INTRO = "Puntos que NO se pudieron comprobar. No cuentan como hallazgo: o el criterio no aplica a este proyecto (el kit no lo asume por su cuenta), o faltó un requisito para verificarlos.";

function todayStamp(tz) {
  // tz reservado para F1 (locale.timezone); por ahora fecha ISO local
  return new Date().toISOString().slice(0, 10);
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
  // Carpeta de ESTA corrida: qa-evidence/<fecha>/<FT-feature__dev | WI-id>/<hora>. La subcarpeta por
  // hora hace que cada corrida quede en la suya y NO sobreescriba las evidencias previas (ver report-shots).
  const dir = evidenceRunDir({ repoRoot, outDir, stamp, featureId, developer, workItemId });

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
  const warnCount = results.filter((r) => r.layer === "static").flatMap((r) => (Array.isArray(r.cases) ? r.cases : [])).filter((c) => c.status === "skip").length;
  // Sugerencias = advertencias del linter (static) + hallazgos no bloqueantes (SCA media/baja, licencias).
  // Se cuentan JUNTAS en el veredicto para que 14 vulns medias NO se lean como pruebas saltadas.
  const secSugg = suggestionCases(results);
  const notVer = notVerifiedCases(results);
  const suggCount = warnCount + secSugg.length;
  const failed = fail > 0 || stepFail > 0;
  const unitWord = results.some((r) => r.layer === "explore") ? "paso" : "prueba";
  const caselessFails = results.filter(
    (r) => r.status === "fail" && !(Array.isArray(r.cases) && r.cases.some((c) => c.status === "fail")),
  );
  // Veredicto con números CLAROS y ETIQUETADOS: distingue CAPAS (objetivos) de PRUEBAS (casos) — antes se
  // mezclaban (p.ej. "5 fallos" [capas] vs "7 hallazgos" [pruebas]) y confundía. Las advertencias aparte.
  const sugg = suggCount ? ` · 💡 ${suggCount} sugerencia(s)` : "";
  let verdictTxt;
  if (!failed) {
    verdictTxt = `✅ PASÓ — ${pass} de ${total} capa(s) OK${stepPass ? `, ${stepPass} ${unitWord}(s) en verde` : ""}${sugg}`;
  } else {
    const caseless = caselessFails.length ? ` (incluye ${caselessFails.length} capa[s] que fallaron sin desglose por ${unitWord})` : "";
    verdictTxt = `❌ FALLÓ — ${fail} de ${total} capa(s) con hallazgos · ${stepFail} ${unitWord}(s) en rojo${caseless}${sugg}`;
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
  md.push(`**Resumen por capa:** ${total} capa(s) · ✅ ${pass} pasaron · ❌ ${fail} con hallazgos · ⏭ ${skip} omitidas`);
  md.push(`**Pruebas:** ✅ ${stepPass} en verde · ❌ ${stepFail} en rojo${suggCount ? `  ·  💡 ${suggCount} sugerencia(s)` : ""}`);
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
  // EVIDENCIA (positivo), no solo los fallos. Incluye las capas en rojo que igual validaron cosas
  // adentro (evidencia parcial) → todo ítem que una capa cubre queda plasmado, como en la HU.
  const evLayers = evidenceLayers(results);
  if (evLayers.length) {
    md.push("---");
    md.push("## ✅ Evidencia — lo que se validó correctamente");
    md.push("");
    for (const r of evLayers) {
      const { partial, passed, lead } = describeEvidence(r);
      const head = `**${esc(r.layer)}**${r.metrics?.tool ? ` (${esc(r.metrics.tool)})` : ""}${r.metrics?.label ? ` · ${esc(r.metrics.label)}` : ""}${partial ? " _(evidencia parcial)_" : ""}`;
      md.push(`- ${head} — ${esc(lead)}`);
      // Cada verificación COMPLETA (sin recortar) + su detalle técnico — misma regla que la HU.
      for (const c of evidenceItems(passed)) {
        md.push(`  - ✅ ${esc(c.name)}${c.plain ? ` — ${esc(c.plain)}` : ""}`);
        if (c.message) md.push(`    - 🔎 _Detalle técnico:_ ${esc(techDetail(c.message))}`);
      }
    }
    md.push("");
  }
  // Sugerencias del LINTER (advertencias) descritas en lenguaje claro — como en la HU.
  for (const line of warningsMd(results)) md.push(line);
  // 💡 Sugerencias de SEGURIDAD: hallazgos detectados que NO bloquean (SCA media/baja, licencias a
  // revisar). Sección PROPIA para que no se lean como pruebas saltadas (antes caían en «No verificado»).
  for (const line of skipSectionMd({ title: "💡 Sugerencias de seguridad", icon: "💡", intro: SUGG_INTRO, items: secSugg })) md.push(line);
  // ⏭ No verificado: lo que NO se pudo comprobar (misma sección que la HU). Sin esto, un check así
  // (p.ej. «Índices en llaves foráneas», de la capa db y NO del linter) solo aparecía enterrado en el
  // detalle por capa. Ya NO incluye las sugerencias (tienen su sección arriba).
  for (const line of skipSectionMd({ title: "⏭ No verificado", icon: "⏭", intro: NOVER_INTRO, items: notVer })) md.push(line);

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
        const bl = blameAt(r.blame);
        md.push(`- 👤 **Último en modificar** ${esc(bl.friendly)} \`${esc(bl.exact)}\`: ${esc(r.blame.author)}${r.blame.date ? ` _(${esc(r.blame.date)})_` : ""}`);
      } else {
        md.push(`- 👤 _Sin responsable: la herramienta no dejó un archivo/línea en el error, no hay a quién atribuirlo automáticamente._`);
      }
      if (r.narrative) md.push(`- ⚠ _Detalle técnico:_ ${esc(String(r.narrative).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}`);
      md.push("");
    }
  }

  // ---- Detalle por capa: los casos ejecutados por debajo de cada capa (ver report-cases.mjs) ----
  for (const line of casesMd(results)) md.push(line);

  // ---- Qué se ejecutó por capa (bitácora) — compartido con el comentario de la HU (report-executed) ----
  for (const line of executedMd(results)) md.push(line);

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
            ? `<div style="color:#555;margin-top:2px">👤 <b>Último en modificar</b> ${esc(blameAt(r.blame).friendly)} <code>${esc(
                blameAt(r.blame).exact
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
  // EVIDENCIA (positivo), no solo los fallos — misma regla que el md y la HU (evidenceLayers).
  const passedHtml = evLayers.length
    ? `<h2>✅ Evidencia — lo que se validó correctamente</h2>${evLayers
        .map((r) => {
          const { partial, passed, lead } = describeEvidence(r);
          const tool = r.metrics?.tool ? ` — ${esc(r.metrics.tool)}` : "";
          const label = r.metrics?.label ? ` · ${esc(r.metrics.label)}` : "";
          const tag = partial ? ` <small style="color:#8a6d3b">(evidencia parcial)</small>` : "";
          const evi = evidenceItems(passed);
          const items = evi.length
            ? `<ul style="margin:.3rem 0 0 1.1rem">${evi
                .map((c) => {
                  const det = c.message ? `<div class="muted">🔎 Detalle técnico: <code>${esc(techDetail(c.message))}</code></div>` : "";
                  return `<li>✅ ${esc(c.name)}${c.plain ? ` — ${esc(c.plain)}` : ""}${det}</li>`;
                })
                .join("")}</ul>`
            : "";
          return `<div class="evi"><b>✅ ${esc(r.layer)}</b>${tool}${label}${tag}<br>${esc(lead)}${items}</div>`;
        })
        .join("")}`
    : "";
  // 💡 Sugerencias de seguridad (.warn amarillo) + ⏭ No verificado (.nov gris) — misma selección y
  // texto que la HU y el md. skipSectionHtml aplica la regla ÚNICA a ambas.
  const secSuggHtml = skipSectionHtml({ title: "💡 Sugerencias de seguridad", icon: "💡", intro: SUGG_INTRO, items: secSugg, cls: "warn" });
  const notVerHtml = skipSectionHtml({ title: "⏭ No verificado", icon: "⏭", intro: NOVER_INTRO, items: notVer, cls: "nov" });

  const CSS =
    "body{font-family:system-ui,Arial,sans-serif;max-width:920px;margin:2rem auto;color:#222;padding:0 1rem;line-height:1.5}" +
    "h1{font-size:1.6rem;margin:.2rem 0}h2{font-size:1.15rem;margin:1.6rem 0 .6rem;padding-bottom:.3rem;border-bottom:2px solid #e2e6ea}" +
    "hr{border:none;border-top:1px solid #e2e6ea;margin:1.2rem 0}code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:.85em}" +
    ".evi{border:1px solid #cbe8d5;background:#f2faf5;border-radius:8px;padding:8px 12px;margin:8px 0}" +
    ".warn{border:1px solid #f0e2b6;background:#fdf9ec;border-radius:8px;padding:8px 12px;margin:8px 0}.muted{color:#888;font-size:.85em}" +
    ".nov{border:1px solid #d7dbe0;background:#fafbfc;border-radius:8px;padding:8px 12px;margin:8px 0}";
  const html = `<!doctype html><meta charset="utf-8">
<title>Reporte QA local</title>
<style>${CSS}</style>
<body>
<h1>Reporte QA local</h1>
<p><b>Fecha:</b> ${stamp} · <b>Proyecto:</b> ${esc(profile.project?.name ?? "auto")} · <b>Tracker:</b> local</p>
${wiHtml}
${featureId || developer ? `<p>${[featureId ? `<b>Feature (FT):</b> ${esc(featureId)}` : null, developer ? `<b>Desarrollador:</b> ${esc(developer)}` : null].filter(Boolean).join(" · ")}</p>` : ""}
${verdictHtml}
<p><b>Resumen por capa:</b> ${total} capa(s) · ✅ ${pass} pasaron · ❌ ${fail} con hallazgos · ⏭ ${skip} omitidas<br>
<b>Pruebas:</b> ✅ ${stepPass} en verde · ❌ ${stepFail} en rojo${warnCount ? ` · 💡 ${warnCount} sugerencia(s)` : ""}</p>
${coverageBlock}
${planHtml(plan, results)}
<table style="border-collapse:collapse;width:100%">
<thead><tr>${["Capa", "TC", "Resultado", "Notas"]
    .map((h) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f0f0f0;text-align:left">${h}</th>`)
    .join("")}</tr></thead>
<tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 8px">')}</tbody>
</table>
${passedHtml}
${warningsHtml(results)}
${secSuggHtml}
${notVerHtml}
${caselessBlock}
${casesBlock}
${shotsHtml}
</body>`;
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return { dir, mdPath, htmlPath };
}

export default { writeLocalReport };
