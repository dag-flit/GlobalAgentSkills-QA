// report-plan.mjs — render del "Plan de pruebas del Feature" (md + html) para el reporte local.
// Paridad OFFLINE con la Task "PLAN PRUEBAS FEATURE…" del tracker: objetivo + HUs y sus TC (por
// criterio) + resultado consolidado. Extraído de local-sink para respetar el presupuesto de líneas.
// `plan` = { featureId, featureTitle, hus: [{id, title, criteria?, tcs?:[{key,title,status}]}] }.

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Texto de un criterio que puede venir como string (línea) u objeto {title, detail}.
function critText(c) {
  return typeof c === "string" ? c : (c && c.title) || "";
}

export function planMd(plan, results) {
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

export function planHtml(plan, results) {
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

export default { planMd, planHtml };
