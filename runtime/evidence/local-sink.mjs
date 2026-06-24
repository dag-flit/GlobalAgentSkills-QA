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

// Texto de un criterio que puede venir como string (línea) u objeto {title, detail}.
function critText(c) {
  return typeof c === "string" ? c : (c && c.title) || "";
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

// Línea "qué se ejecutó": comando exacto + duración + código de salida, desde las métricas.
function execLine(r) {
  const parts = [];
  if (r.metrics?.command) parts.push(`comando: ${r.metrics.command}`);
  if (typeof r.metrics?.ms === "number") parts.push(`${(r.metrics.ms / 1000).toFixed(1)} s`);
  if (typeof r.metrics?.exitCode === "number") parts.push(`exit ${r.metrics.exitCode}`);
  return parts.join(" · ");
}

// Copia las capturas (png/jpg) de los resultados a <dir>/capturas/ y devuelve sus refs relativas.
// Así la carpeta de evidencia queda AUTOCONTENIDA (reporte + imágenes juntos, portable y
// adjuntable). Best-effort: si un archivo no existe o no se puede copiar, se omite sin romper.
function collectShots(results, dir) {
  const out = [];
  const capDir = path.join(dir, "capturas");
  let made = false;
  for (const r of results) {
    for (const f of Array.isArray(r.files) ? r.files : []) {
      if (!/\.(png|jpe?g)$/i.test(f)) continue;
      try {
        if (!fs.existsSync(f)) continue;
        if (!made) {
          fs.mkdirSync(capDir, { recursive: true });
          made = true;
        }
        const baseName = `${slug(r.layer)}-${path.basename(f)}`;
        fs.copyFileSync(f, path.join(capDir, baseName));
        out.push({ layer: r.layer, rel: `capturas/${baseName}`, name: path.basename(f) });
      } catch {
        /* best-effort */
      }
    }
  }
  return out;
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

// Plan de pruebas del Feature (paridad OFFLINE con la Task "PLAN PRUEBAS FEATURE…" del tracker):
// objetivo + HUs y sus TC (por criterio) + resultado consolidado. `plan` = { featureId,
// featureTitle, hus: [{id, title, criteria?, tcs?:[{key,title,status}]}] }.
function planMd(plan, results) {
  if (!plan || !Array.isArray(plan.hus) || !plan.hus.length) return [];
  const c = (s) => results.filter((r) => r.status === s).length;
  const out = [
    `## Plan de pruebas del Feature${plan.featureId ? ` #${plan.featureId}` : ""}${plan.featureTitle ? ` — ${plan.featureTitle}` : ""}`,
    "",
    `**Alcance:** las HUs y criterios de abajo + la corrida general de capas.`,
    `**Resultado consolidado:** ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`,
    "",
  ];
  for (const hu of plan.hus) {
    out.push(`### HU #${esc(hu.id)}${hu.title ? ` — ${esc(hu.title)}` : ""}`);
    const tcs = Array.isArray(hu.tcs) ? hu.tcs : [];
    if (tcs.length) {
      // sin clave duplicada: el título ya incluye "TC-AC<n> -"
      for (const tc of tcs) out.push(`- ${esc(tc.title ?? tc.key ?? "")} _(${esc(tc.status ?? "pendiente")})_`);
    } else if (Array.isArray(hu.criteria) && hu.criteria.length) {
      for (const cr of hu.criteria) out.push(`- ${esc(critText(cr))}`);
    } else {
      out.push(`- _(sin criterios declarados)_`);
    }
    out.push("");
  }
  return out;
}
function planHtml(plan, results) {
  if (!plan || !Array.isArray(plan.hus) || !plan.hus.length) return "";
  const c = (s) => results.filter((r) => r.status === s).length;
  const huBlocks = plan.hus
    .map((hu) => {
      const tcs = Array.isArray(hu.tcs) ? hu.tcs : [];
      const items = tcs.length
        ? tcs.map((tc) => `<li>${esc(tc.title ?? tc.key ?? "")} <small style="color:#888">(${esc(tc.status ?? "pendiente")})</small></li>`).join("")
        : (Array.isArray(hu.criteria) ? hu.criteria : []).map((cr) => `<li>${esc(critText(cr))}</li>`).join("") || "<li><i>(sin criterios declarados)</i></li>";
      return `<p><b>HU #${esc(hu.id)}</b>${hu.title ? ` — ${esc(hu.title)}` : ""}</p><ul>${items}</ul>`;
    })
    .join("");
  return (
    `<h2>Plan de pruebas del Feature${plan.featureId ? ` #${esc(plan.featureId)}` : ""}${plan.featureTitle ? ` — ${esc(plan.featureTitle)}` : ""}</h2>` +
    `<p><b>Alcance:</b> las HUs y criterios de abajo + la corrida general de capas.<br>` +
    `<b>Resultado consolidado:</b> ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}</p>` +
    huBlocks
  );
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
  // Plan de pruebas del Feature (paridad con la Task del tracker) — antes de la tabla de capas.
  for (const line of planMd(plan, results)) md.push(line);
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

  // ---- Qué se ejecutó por capa (comando exacto + duración) ----
  const execd = results.filter((r) => r.metrics?.command);
  if (execd.length) {
    md.push("## Qué se ejecutó por capa");
    md.push("");
    for (const r of execd) {
      md.push(`- **${esc(r.layer)}** (${esc(r.metrics.tool ?? "")}): \`${esc(r.metrics.command)}\` · ${(r.metrics.ms / 1000).toFixed(1)} s · exit ${r.metrics.exitCode}`);
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
      const note = `${esc(r.narrative ?? "")}${
        ex ? `<br><small style="color:#666">Qué se ejecutó: <code>${esc(ex)}</code></small>` : ""
      }`;
      return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id ?? "—")}</td><td>${icon} ${esc(
        r.status
      )}</td><td>${note}</td></tr>`;
    })
    .join("\n");
  const shotsHtml = shots.length
    ? `<h2>Capturas</h2>${shots
        .map(
          (s) =>
            `<figure style="margin:.6rem 0"><img src="${s.rel}" alt="${esc(s.layer)}" style="max-width:100%;border:1px solid #ccc;border-radius:6px"><figcaption style="color:#666;font-size:.85em">${esc(
              s.layer
            )} — ${esc(s.name)}</figcaption></figure>`
        )
        .join("")}`
    : "";
  const html = `<!doctype html><meta charset="utf-8">
<title>Reporte QA local</title>
<body style="font-family:system-ui,Arial,sans-serif;max-width:900px;margin:2rem auto;color:#222">
<h1>Reporte QA local</h1>
<p><b>Fecha:</b> ${stamp} · <b>Proyecto:</b> ${esc(profile.project?.name ?? "auto")} · <b>Tracker:</b> local</p>
${featureId || developer ? `<p>${[featureId ? `<b>Feature (FT):</b> ${esc(featureId)}` : null, developer ? `<b>Desarrollador:</b> ${esc(developer)}` : null].filter(Boolean).join(" · ")}</p>` : ""}
<p><b>Resumen:</b> ${total} total · ✅ ${pass} pass · ❌ ${fail} fail · ⏭ ${skip} skip</p>
${planHtml(plan, results)}
<table style="border-collapse:collapse;width:100%">
<thead><tr>${["Capa", "TC", "Resultado", "Notas"]
    .map((h) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f0f0f0;text-align:left">${h}</th>`)
    .join("")}</tr></thead>
<tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 8px">')}</tbody>
</table>
${casesHtml(results)}
${shotsHtml}
</body>`;
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return { dir, mdPath, htmlPath };
}

export default { writeLocalReport };
