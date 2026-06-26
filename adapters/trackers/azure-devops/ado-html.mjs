// ado-html.mjs — render HTML + parse/text helpers PUROS del adapter de Azure DevOps.
// Extraído de azure-devops-adapter.mjs (F1) sin cambiar comportamiento: las funciones que
// antes eran métodos de instancia reciben ahora por parámetro lo que tomaban de `this`
// (`sup` = prefijo de supervisión, `client` = cliente REST, `wi` = azure.work_item del perfil).

// ── parse/text helpers ────────────────────────────────────────────────────────

// Texto de un criterio que puede venir como string (línea) u objeto {title, detail}.
export function critText(c) {
  return typeof c === "string" ? c : (c && c.title) || "";
}

export function decodeHtml(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;/gi, "'");
}

// HTML → una línea (quita tags/entidades). Para títulos de encabezado.
export function htmlLineText(html) {
  return decodeHtml(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// HTML → texto multilínea, preservando saltos (de <br>, bloques y <pre>). Para el detalle.
export function htmlBlockText(html) {
  const txt = decodeHtml(
    String(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|h\d|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
  return txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");
}

// AC en ADO es HTML. Si trae ENCABEZADOS (<h1-6>), cada encabezado es UN criterio (AC) y el
// contenido hasta el siguiente encabezado es su DETALLE (Gherkin/pasos) → 1 TC por AC. Si NO
// hay encabezados, se cae al modo por-línea (cada línea/viñeta es un criterio). Devuelve
// objetos {title, detail}; los renderers usan critText() y son tolerantes a strings.
export function parseAc(html) {
  if (!html) return [];
  const s = String(html);
  if (/<h[1-6][^>]*>/i.test(s)) {
    const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;
    const heads = [];
    let m;
    while ((m = re.exec(s))) heads.push({ title: htmlLineText(m[1]), titleEnd: re.lastIndex, start: m.index });
    const out = [];
    for (let i = 0; i < heads.length; i++) {
      const detailHtml = s.slice(heads[i].titleEnd, i + 1 < heads.length ? heads[i + 1].start : s.length);
      out.push({ title: heads[i].title, detail: htmlBlockText(detailHtml) });
    }
    return out.filter((c) => c.title);
  }
  // sin encabezados: por línea (compat), como objetos {title, detail:""}
  const out = [];
  for (const raw of htmlBlockText(s).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^- \[.?\]/.test(t)) out.push({ title: t.replace(/^- \[.?\]\s*/, ""), detail: "" });
    else if (/^[-*]\s+/.test(t)) out.push({ title: t.replace(/^[-*]\s+/, ""), detail: "" });
    else out.push({ title: t, detail: "" }); // incluye líneas Gherkin sueltas
  }
  return out;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Id de HU de una etiqueta de convención "[HU-103]" / "HU-103" / "HU 103" (igual que el
// orquestador). Permite que el comentario por-HU muestre solo las pruebas de esa HU si las hay.
export function huTagOf(text) {
  const m = String(text || "").match(/\bHU[-\s]?(\d+)\b/i);
  return m ? m[1] : null;
}

// Detalle de los TC ejecutados por debajo de cada capa (mismo nivel de detalle que la
// evidencia local), para que la Discussion del WI padre no muestre solo el agregado.
export function casesHtml(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases
    .map((r) => {
      const c = (s) => r.cases.filter((x) => x.status === s).length;
      const where = r.metrics && r.metrics.cwd ? ` @ ${esc(r.metrics.cwd)}` : "";
      const items = r.cases
        .map((tc) => {
          const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : "⏭";
          const d = typeof tc.duration === "number" ? ` (${tc.duration} ms)` : "";
          const msg = tc.status === "fail" && tc.message ? `<br/><em>${esc(String(tc.message).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}</em>` : "";
          return `<li>${ic} ${esc(tc.name)}${d}${msg}</li>`;
        })
        .join("");
      return `<p><strong>${esc(r.layer)} — ${esc((r.metrics && r.metrics.tool) || "")}</strong>${where} · ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}</p><ul>${items}</ul>`;
    })
    .join("");
  return `<p><strong>Detalle de pruebas (TC ejecutados)</strong></p>${blocks}`;
}

// ── render de comentarios/descr. (puros; reciben sup/client/wi) ────────────────

// Descripción del TC: criterios de aceptación de la HU como checklist a validar.
export function renderTcDescription({ sup, huId, huTitle, criteria }) {
  const items = (criteria || []).map((c) => `<li>${esc(critText(c))}</li>`).join("");
  return (
    `${sup}` +
    `<p>TC de validación de la HU #${esc(huId)}${huTitle ? ` — ${esc(huTitle)}` : ""}.</p>` +
    (items
      ? `<p>Criterios de aceptación a validar:</p><ol>${items}</ol>`
      : `<p>(La HU no declara criterios de aceptación.)</p>`)
  );
}

// Descripción de un TC por CRITERIO: el criterio + su detalle (Gherkin) + estado.
export function renderTcCriterion({ sup, huId, tc = {} }) {
  const detail = tc.detail ? `<pre>${esc(tc.detail)}</pre>` : "";
  return (
    `${sup}` +
    `<p>TC <strong>${esc(tc.key || "")}</strong> — HU #${esc(huId)}.</p>` +
    `<p><strong>Criterio de aceptación:</strong></p><blockquote>${esc(tc.criterion || "")}</blockquote>` +
    detail +
    `<p><em>Estado: ${esc(tc.status || "pendiente")} — prueba auto-generada (esqueleto), pendiente de implementar.</em></p>`
  );
}

// Comentario de PLANIFICACIÓN en la HU: registra los TC (pendientes) desde los criterios,
// antes de ejecutar (lógica QA: el plan se arma en la planificación).
export function renderHuPlan({ sup, huId, criteria, tcs }) {
  const tcArr = Array.isArray(tcs) ? tcs : [];
  const tcList = tcArr.length
    ? `<ul>${tcArr.map((t) => `<li>${esc(t.title || t.key)} <em>(pendiente)</em></li>`).join("")}</ul>`
    : (criteria || []).length
    ? `<ol>${criteria.map((c) => `<li>${esc(critText(c))}</li>`).join("")}</ol>`
    : "<p><em>(sin criterios declarados)</em></p>";
  return (
    `${sup}` +
    `<p>📋 <strong>Plan de pruebas — HU #${esc(huId)}</strong></p>` +
    `<p>Se registraron los TC a partir de los criterios de aceptación (pendientes de ejecución):</p>` +
    tcList
  );
}

// Bloque "Plan por HU" (vertical, agrupado): HU como encabezado y sus TC en lista debajo.
// SIN clave duplicada (el título del TC ya incluye "TC-AC<n> -"). Reusado por el Plan del
// Feature y por el comentario general de ejecución del Feature.
export function renderPlanByHu(hus) {
  return (Array.isArray(hus) ? hus : [])
    .map((h) => {
      const tcItems = (h.tcs || [])
        .map((tc) => `<li>${esc(tc.title || tc.key || "")} <em>(${esc(tc.status || "pendiente")})</em></li>`)
        .join("");
      return (
        `<p><strong>HU #${esc(h.id)}</strong>${h.title ? ` — ${esc(h.title)}` : ""}</p>` +
        (tcItems ? `<ul>${tcItems}</ul>` : `<p><em>(sin criterios declarados)</em></p>`)
      );
    })
    .join("");
}

// Plan de Pruebas del Feature: objetivo + HUs y sus TC + alcance global + resultado.
export function renderTestPlan({ sup, info = {} }) {
  const hus = Array.isArray(info.hus) ? info.hus : [];
  const results = Array.isArray(info.results) ? info.results : [];
  const executed = results.length > 0;
  const count = (s) => results.filter((r) => r.status === s).length;
  const layers = [...new Set(results.map((r) => r.layer))];
  return (
    `${sup}` +
    `<p>🗂️ <strong>Plan de Pruebas del Feature #${esc(info.featureId || "")}</strong>${info.featureTitle ? ` — ${esc(info.featureTitle)}` : ""}</p>` +
    (info.objective ? `<p><strong>Objetivo:</strong> ${esc(info.objective)}</p>` : "") +
    `<p><strong>Alcance:</strong> las HUs y criterios de abajo, MÁS la corrida general de capas${executed ? ` (${esc(layers.join(", ") || "—")})` : ""}.</p>` +
    (executed
      ? `<p><strong>Resultado consolidado:</strong> ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}.</p>`
      : `<p><strong>Estado:</strong> planificado (pendiente de ejecución).</p>`) +
    `<p><strong>Historias y sus TC:</strong></p>${renderPlanByHu(hus) || "<p><em>(sin HUs)</em></p>"}` +
    (info.reportLink ? `<p>Evidencia local del ciclo: <code>${esc(info.reportLink)}</code></p>` : "")
  );
}

// Comentario de ejecución que se deja en la HU: resultado GLOBAL del ciclo + criterios +
// pruebas asociadas a ESTA HU si las hay (etiqueta [HU-###]) o, si no, la nota de cómo
// habilitar la validación por criterio. La evidencia local se enlaza si vino.
export function renderHuEvidence({ sup, client, huId, criteria, results, info, tcId, tcs }) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const huCases = [];
  for (const r of results)
    for (const c of Array.isArray(r.cases) ? r.cases : [])
      if (huTagOf(c.name) === String(huId)) huCases.push({ layer: r.layer, ...c });
  const reportNote =
    info && info.reportLink ? `<p>Evidencia local del ciclo: <code>${esc(info.reportLink)}</code></p>` : "";

  // Si hay TC por criterio (manifest), se listan con su link y estado; si no, se cae al
  // listado simple de criterios (compat).
  const tcArr = Array.isArray(tcs) ? tcs.filter((t) => t && (t.key || t.title)) : [];
  const tcSection = tcArr.length
    ? `<p><strong>TC por criterio de esta HU:</strong></p><ul>${tcArr
        .map((t) => {
          const link = t.tcId ? ` <a href="${esc(client.workItemWebUrl(t.tcId))}">#${esc(t.tcId)}</a>` : "";
          return `<li>${esc(t.title || t.key)}${link} <em>(${esc(t.status || "pendiente")})</em></li>`;
        })
        .join("")}</ul>`
    : (criteria || []).length
    ? `<p><strong>Criterios de aceptación:</strong></p><ol>${criteria.map((c) => `<li>${esc(critText(c))}</li>`).join("")}</ol>`
    : "";

  const huSection = huCases.length
    ? `<p>Pruebas asociadas a esta HU (etiqueta [HU-${esc(huId)}]):</p><ul>${huCases
        .map((c) => {
          const ic = c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⏭";
          return `<li>${ic} ${esc(c.layer)} — ${esc(c.name)}</li>`;
        })
        .join("")}</ul>`
    : `<p><em>El resultado mostrado es el GLOBAL del ciclo. La validación por criterio se hace sobre los TC de arriba (hoy en estado «pendiente»: prueba generada por implementar).</em></p>`;

  return (
    `${sup}` +
    `<p>🧪 <strong>Ejecución QA — HU #${esc(huId)}</strong></p>` +
    `<p>Resultado global del ciclo: ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
    tcSection +
    huSection +
    reportNote
  );
}

export function renderSummary({ sup, results, plan }) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const rows = results
    .map((r) => {
      const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
      return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id || "—")}</td><td>${icon} ${esc(
        r.status
      )}</td><td>${esc(r.narrative || "")}</td></tr>`;
    })
    .join("");
  // Desglose "Plan por HU" (HU → sus TC) bajo la tabla de capas, si vino el plan.
  const planBlock =
    plan && Array.isArray(plan.hus) && plan.hus.length
      ? `<p><strong>Plan por HU</strong></p>${renderPlanByHu(plan.hus)}`
      : "";
  return (
    `${sup}<p><strong>Resumen QA</strong> — ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
    `<table><thead><tr><th>Capa</th><th>TC</th><th>Resultado</th><th>Notas</th></tr></thead><tbody>${rows}</tbody></table>` +
    planBlock +
    casesHtml(results)
  );
}

// Comentario de trazabilidad que se deja en la HU reactivada: enlaza el Bug creado y
// lista los hallazgos (capa/TC/narrativa) que originaron la novedad.
export function renderTrace({ sup, client, wi, info = {} }) {
  const bugId = info.bugId;
  const link = bugId
    ? `<a href="${esc(client.workItemWebUrl(bugId))}">#${esc(bugId)}</a>`
    : "(no se pudo crear el Bug)";
  const items = Array.isArray(info.items) ? info.items : [];
  const rows = items
    .map((r) => {
      const tc = r.tc_id ? ` ${esc(r.tc_id)}` : "";
      const tool = r.metrics && r.metrics.tool ? ` [${esc(r.metrics.tool)}]` : "";
      return `<li>❌ ${esc(r.layer)}${tool}${tc} — ${esc(r.narrative || "falla")}</li>`;
    })
    .join("");
  const stateNote = wi.on_defect_reactivate_state
    ? ` Historia reactivada a <strong>${esc(wi.on_defect_reactivate_state)}</strong>.`
    : "";
  return (
    `${sup}` +
    `<p>🔴 <strong>Novedad QA</strong> — se registró el Bug de trazabilidad ${link}.${stateNote}</p>` +
    `<p>Hallazgos que originaron la novedad:</p><ul>${rows}</ul>`
  );
}
