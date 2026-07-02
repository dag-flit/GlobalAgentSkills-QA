// ado-html.mjs — render HTML + parse/text helpers PUROS del adapter de Azure DevOps.
// Acotado a lo que necesita el kit explore-only: parsear la HU (parseAc) y renderizar el
// resumen de la exploración (renderSummary + casesHtml) para la Discussion del work item.

// ── parse/text helpers ────────────────────────────────────────────────────────

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
// contenido hasta el siguiente encabezado es su DETALLE. Si NO hay encabezados, se cae al modo
// por-línea (cada línea/viñeta es un criterio). Devuelve objetos {title, detail}.
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
    else out.push({ title: t, detail: "" });
  }
  return out;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ── render del resumen de la corrida ──────────────────────────────────────────

// Detalle de los casos ejecutados por debajo de cada capa (mismo nivel de detalle que la
// evidencia local), para que la Discussion no muestre solo el agregado.
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
  return `<p><strong>Detalle (casos ejecutados)</strong></p>${blocks}`;
}

export function renderSummary({ sup, results }) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const rows = results
    .map((r) => {
      const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
      return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id || "—")}</td><td>${icon} ${esc(
        r.status
      )}</td><td>${esc(r.narrative || "")}</td></tr>`;
    })
    .join("");
  return (
    `${sup}<p><strong>Resumen QA</strong> — ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
    `<table><thead><tr><th>Capa</th><th>TC</th><th>Resultado</th><th>Notas</th></tr></thead><tbody>${rows}</tbody></table>` +
    casesHtml(results)
  );
}
