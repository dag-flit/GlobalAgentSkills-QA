// runtime/pr/brief.mjs — GENERADOR DE BRIEF de validación QA (puro, sin red ni IA). Ensambla lo que
// producen los demás módulos del pipeline PR-driven en un documento accionable (markdown + HTML
// auto-contenido) que le dice a QA QUÉ validar de un despliegue:
//   readPr()  → metadatos + archivos + test plan del dev + HU/Feature vinculados
//   classifyChangedFiles() → superficie E2E (áreas visibles vs backend/infra/docs)
//   buildScopeMatrix()     → escenarios por HU/área, más allá del happy path, con dev-cubierto vs gap-QA
// El brief se publica luego en la HU de ADO (comentario) y queda en qa-evidence/. Este módulo NO
// llama a Azure ni a GitHub: recibe los AC ya leídos (husWithAcs) → se mantiene puro/offline-testable.

import { classifyChangedFiles } from "./classify-files.mjs";
import { buildScopeMatrix, TECHNIQUES } from "./scope-matrix.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const DEV = (b) => (b ? "✅ dev" : "🔺 QA");

/** Conteos de superficie ("Frontend visible: 2 · Backend: 3 · …") en orden legible. */
function surfaceLine(counts) {
  const order = [
    ["frontend-visible", "Frontend visible (E2E)"],
    ["frontend-support", "Frontend soporte"],
    ["backend", "Backend"],
    ["infra", "Infra/contratos"],
    ["docs", "Docs"],
    ["test", "Tests"],
    ["other", "Otros"],
  ];
  return order.filter(([k]) => counts[k]).map(([k, label]) => `${label}: ${counts[k]}`).join(" · ");
}

/**
 * Ensambla el brief. `husWithAcs` = [{ id, title, acs:[{title,detail}] }] (los AC ya leídos de Azure).
 * `apiDiff` (opcional) = salida de openapi-diff.analyzeApiBreaking: cambios que rompen el contrato OpenAPI.
 * @returns { data, markdown, html }
 */
export function generateBrief({ pr, husWithAcs = [], apiDiff = null }) {
  const cls = classifyChangedFiles(pr.changedFiles || []);
  const hus = husWithAcs.map((hu) => ({
    ...hu,
    isPrimary: pr.primaryHu != null && String(hu.id) === String(pr.primaryHu),
    scope: buildScopeMatrix({ acs: hu.acs || [], e2eAreas: cls.e2eAreas, testPlan: pr.testPlan, acClaims: pr.acClaims }),
  }));
  const data = { pr, classification: cls, hus, apiDiff };
  return { data, markdown: toMarkdown(pr, cls, hus, apiDiff), html: toHtml(pr, cls, hus, apiDiff) };
}

// ---------- Contrato de API (breaking-change) — compartido por md/html/comentario ----------

// Aplana los cambios que ROMPEN de todos los specs → [{method,path,detail,file}].
function flattenBreaking(apiDiff) {
  if (!apiDiff || !Array.isArray(apiDiff.specs)) return [];
  return apiDiff.specs.flatMap((s) => (s.breaking || []).map((b) => ({ ...b, file: s.file })));
}
function apiDiffMd(apiDiff) {
  if (!apiDiff || !apiDiff.checked) return ""; // silencioso: el PR no cambió ningún contrato OpenAPI
  const breaks = flattenBreaking(apiDiff);
  const L = ["", "## Contrato de API (OpenAPI)"];
  if (breaks.length) {
    L.push(`> ⚠ **${breaks.length} cambio(s) que ROMPEN el contrato** — quien ya consume el API puede fallar. Priorizá validar regresión de los clientes.`);
    for (const b of breaks) L.push(`- \`${b.method} ${b.path}\` — ${b.detail}`);
  } else {
    L.push("> ✅ No se detectaron cambios que rompan el contrato en los specs OpenAPI cambiados (revisión automática determinista).");
  }
  for (const s of apiDiff.specs) {
    if (s.error) L.push(`- ⏭ \`${s.file}\`: ${s.error}`);
    else if (s.note) L.push(`- ℹ️ \`${s.file}\`: ${s.note}`);
    for (const i of s.info || []) L.push(`- ℹ️ \`${i.method} ${i.path}\` — ${i.detail}`);
  }
  return L.join("\n");
}
function apiDiffHtml(apiDiff) {
  if (!apiDiff || !apiDiff.checked) return "";
  const breaks = flattenBreaking(apiDiff);
  const rows = breaks.map((b) => `<li class="gap"><code>${esc(b.method)} ${esc(b.path)}</code> — ${esc(b.detail)}</li>`).join("");
  const notes = apiDiff.specs
    .flatMap((s) => [
      s.error ? `<li>⏭ <code>${esc(s.file)}</code>: ${esc(s.error)}</li>` : "",
      s.note ? `<li>ℹ️ <code>${esc(s.file)}</code>: ${esc(s.note)}</li>` : "",
      ...(s.info || []).map((i) => `<li>ℹ️ <code>${esc(i.method)} ${esc(i.path)}</code> — ${esc(i.detail)}</li>`),
    ])
    .filter(Boolean)
    .join("");
  const head = breaks.length
    ? `<p class="warn"><b>${breaks.length} cambio(s) que ROMPEN el contrato</b> — validá regresión de los clientes del API.</p><ul>${rows}</ul>`
    : `<p class="ok"><b>Sin rupturas de contrato</b> detectadas en los specs OpenAPI cambiados.</p>`;
  return `<div class="card"><h3>Contrato de API (OpenAPI)</h3>${head}${notes ? `<ul>${notes}</ul>` : ""}</div>`;
}

// ---------- Markdown ----------

function scopeRows(scope) {
  const rows = [];
  for (const a of scope.acScenarios) {
    rows.push(`\n**AC: ${a.ac}**`);
    for (const s of a.scenarios) rows.push(`- [${DEV(s.devCovered)}] _(${TECHNIQUES[s.technique]}, ${s.priority})_ ${s.title}`);
  }
  if (scope.areaScenarios.length) {
    rows.push(`\n**Por área de UI cambiada**`);
    for (const a of scope.areaScenarios) for (const s of a.scenarios) {
      rows.push(`- [${DEV(s.devCovered)}] _(${TECHNIQUES[s.technique]}, ${s.priority})_ ${s.title}`);
    }
  }
  return rows.join("\n");
}

function toMarkdown(pr, cls, hus, apiDiff) {
  const L = [];
  L.push(`# Brief de validación QA — PR #${pr.number}`);
  L.push(`**${pr.title}**`);
  L.push(`Autor: \`${pr.author}\` · Rama: \`${pr.branch}\` · Estado: ${pr.state}${pr.merged ? " (merged)" : ""}`);
  const huList = hus.map((h) => `${h.id}${h.isPrimary ? " (primaria)" : ""}`).join(", ") || "—";
  L.push(`Feature: ${pr.feature ?? "—"} · HU: ${huList}`);
  L.push("");
  L.push(`## Superficie del cambio`);
  L.push(surfaceLine(cls.counts) || "—");
  if (cls.hasE2eSurface) L.push(`\n> **Áreas visibles a validar por navegador (E2E):** ${cls.e2eAreas.join(", ")}.`);
  else L.push(`\n> ⚠ Este PR **no toca UI visible** (backend/infra/docs) → no hay superficie E2E directa; validar por API/BD/otra vía.`);
  if (pr.filesTruncated) L.push(`\n> ⚠ La lista de archivos se truncó (PR muy grande): la superficie puede estar incompleta.`);
  const apiMd = apiDiffMd(apiDiff);
  if (apiMd) L.push(apiMd);
  L.push("");
  L.push(`## Lo que el dev dice haber probado`);
  L.push(pr.testPlan ? pr.testPlan : "_No declaró un test plan funcional (o corrió solo CI: lint/build/test). QA valida desde cero._");
  L.push("");
  L.push(`## Alcance de validación por HU (QA — más allá del happy path)`);
  L.push(`Leyenda: **✅ dev** = el dev dice haberlo probado · **🔺 QA** = falta, lo cubre QA.`);
  if (!hus.length) L.push(`\n_No se resolvieron HU con AC para este PR. Vinculá la HU en el PR o revisá el work item._`);
  for (const h of hus) {
    L.push(`\n### HU ${h.id} — ${h.title || ""}${h.isPrimary ? "  ·  ⭐ primaria" : ""}`);
    const s = h.scope.summary;
    L.push(`AC declarados: ${(h.acs || []).length} · Escenarios: ${s.total} · **Gaps de QA: ${s.gaps}** · Dev-cubierto: ${s.devCovered}`);
    if (!(h.acs || []).length) L.push(`> ⚠ Esta HU no tiene AC declarados en Azure → el alcance sale solo de las áreas de UI cambiadas.`);
    L.push(scopeRows(h.scope));
  }
  L.push("");
  L.push(`---`);
  L.push(`_Brief determinista generado desde el PR (GitHub) + los AC (Azure). Sin IA. El "cómo" (pasos clicables) lo aporta un guion guardado o el humano; este brief dice el "qué"._`);
  return L.join("\n");
}

// ---------- HTML (auto-contenido, tema claro/oscuro básico) ----------

function scopeHtml(scope) {
  const item = (s) =>
    `<li class="${s.devCovered ? "dev" : "gap"}"><span class="tag">${esc(TECHNIQUES[s.technique])}</span>` +
    `<span class="prio ${esc(s.priority)}">${esc(s.priority)}</span> ${esc(s.title)} ` +
    `<b>${s.devCovered ? "✅ dev" : "🔺 QA"}</b></li>`;
  const parts = [];
  for (const a of scope.acScenarios) {
    parts.push(`<div class="ac"><h4>AC: ${esc(a.ac)}</h4><ul>${a.scenarios.map(item).join("")}</ul></div>`);
  }
  if (scope.areaScenarios.length) {
    const lis = scope.areaScenarios.flatMap((a) => a.scenarios).map(item).join("");
    parts.push(`<div class="ac"><h4>Por área de UI cambiada</h4><ul>${lis}</ul></div>`);
  }
  return parts.join("");
}

function toHtml(pr, cls, hus, apiDiff) {
  const huList = hus.map((h) => `${h.id}${h.isPrimary ? " ⭐" : ""}`).join(", ") || "—";
  const husHtml = hus.length
    ? hus
        .map((h) => {
          const s = h.scope.summary;
          return `<section class="hu"><h3>HU ${esc(h.id)} — ${esc(h.title || "")}${h.isPrimary ? " · ⭐ primaria" : ""}</h3>` +
            `<p class="sum">AC: ${(h.acs || []).length} · Escenarios: ${s.total} · <b class="gaps">Gaps QA: ${s.gaps}</b> · Dev: ${s.devCovered}</p>` +
            scopeHtml(h.scope) + `</section>`;
        })
        .join("")
    : `<p class="warn">No se resolvieron HU con AC para este PR.</p>`;
  const surface = cls.hasE2eSurface
    ? `<p class="ok">Áreas E2E: <b>${esc(cls.e2eAreas.join(", "))}</b></p>`
    : `<p class="warn">Sin UI visible → no hay superficie E2E directa.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>Brief QA — PR #${esc(pr.number)}</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--card:#f6f7f9;--line:#e2e4e8;--gap:#b4531f;--dev:#2e7d32}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e6e8ea;--muted:#9aa0a6;--card:#1e2127;--line:#2c303a;--gap:#ff9d5c;--dev:#7bd88f}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px}
h1{font-size:20px} h3{margin:.6em 0 .2em} h4{margin:.5em 0 .2em;color:var(--muted)}
.meta{color:var(--muted)} .card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
ul{list-style:none;padding-left:0;margin:.3em 0} li{padding:4px 0;border-bottom:1px dashed var(--line)}
.tag{display:inline-block;background:var(--line);border-radius:4px;padding:1px 6px;font-size:11px;margin-right:4px}
.prio{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-right:6px}
.prio.alta{color:var(--gap);font-weight:600} li.gap b{color:var(--gap)} li.dev b{color:var(--dev)}
.gaps{color:var(--gap)} .ok b{color:var(--dev)} .warn{color:var(--gap)} pre{white-space:pre-wrap;background:var(--card);padding:10px;border-radius:6px}
</style>
<h1>Brief de validación QA — PR #${esc(pr.number)}</h1>
<p><b>${esc(pr.title)}</b></p>
<p class="meta">Autor: <code>${esc(pr.author)}</code> · Rama: <code>${esc(pr.branch)}</code> · Estado: ${esc(pr.state)}${pr.merged ? " (merged)" : ""}<br>
Feature: ${esc(pr.feature ?? "—")} · HU: ${esc(huList)}</p>
<div class="card"><h3>Superficie del cambio</h3><p>${esc(surfaceLine(cls.counts) || "—")}</p>${surface}</div>
${apiDiffHtml(apiDiff)}
<div class="card"><h3>Lo que el dev dice haber probado</h3><pre>${esc(pr.testPlan || "No declaró un test plan funcional (o corrió solo CI). QA valida desde cero.")}</pre></div>
<h2>Alcance de validación por HU <span class="meta">(✅ dev = probado por el dev · 🔺 QA = gap a cubrir)</span></h2>
${husHtml}
<hr><p class="meta">Brief determinista: PR (GitHub) + AC (Azure). Sin IA. Dice el <b>qué</b> validar; el <b>cómo</b> lo aporta un guion o el humano.</p>`;
}

/**
 * Fragmento HTML COMPACTO del brief para publicar como comentario en ADO (sin <style>/<html>, que la
 * Discussion no soporta): encabezado + superficie + por HU, los gaps de QA (lo que falta validar).
 */
export function briefComment({ pr, hus, apiDiff = null }) {
  const cls = classifyChangedFiles(pr.changedFiles || []);
  const parts = [
    `<b>🔎 Brief de validación QA — PR #${esc(pr.number)}</b>`,
    `<div>${esc(pr.title)}</div>`,
    `<div><i>Autor: ${esc(pr.author)} · rama: ${esc(pr.branch)}</i></div>`,
    `<div>Superficie: ${esc(surfaceLine(cls.counts) || "—")}</div>`,
    cls.hasE2eSurface
      ? `<div>Áreas E2E a validar: <b>${esc(cls.e2eAreas.join(", "))}</b></div>`
      : `<div><i>Sin UI visible → sin superficie E2E directa.</i></div>`,
  ];
  // Cambios que rompen el contrato de la API (si el PR tocó un OpenAPI). Va en el comentario de la HU.
  const breaks = flattenBreaking(apiDiff);
  if (apiDiff && apiDiff.checked) {
    parts.push(breaks.length
      ? `<br><b>⚠ API: ${breaks.length} cambio(s) que ROMPEN el contrato</b><ul>${breaks.map((b) => `<li><code>${esc(b.method)} ${esc(b.path)}</code> — ${esc(b.detail)}</li>`).join("")}</ul>`
      : `<div>✅ API: sin rupturas de contrato en los specs OpenAPI cambiados.</div>`);
  }
  for (const h of hus) {
    const scope = buildScopeMatrix({ acs: h.acs || [], e2eAreas: cls.e2eAreas, testPlan: pr.testPlan, acClaims: pr.acClaims });
    const gaps = scope.acScenarios
      .flatMap((a) => a.scenarios)
      .concat(scope.areaScenarios.flatMap((a) => a.scenarios))
      .filter((s) => !s.devCovered);
    parts.push(`<br><b>HU ${esc(h.id)} — ${esc(h.title || "")}</b> · ${gaps.length} gap(s) de QA:`);
    parts.push(`<ul>${gaps.map((s) => `<li>[${esc(TECHNIQUES[s.technique])}] ${esc(s.title)}</li>`).join("")}</ul>`);
  }
  parts.push(`<div><i>Brief determinista (PR de GitHub + AC de Azure, sin IA). Dice el QUÉ validar.</i></div>`);
  return parts.join("\n");
}

export default { generateBrief, briefComment };
