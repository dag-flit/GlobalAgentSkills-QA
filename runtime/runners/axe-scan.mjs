// axe-scan.mjs — accesibilidad (WCAG) en el modo "Explorar URL" (E2E). Inyecta axe-core en la
// página viva y reporta las violaciones de accesibilidad. SOLO se usa en la exploración de una URL;
// NUNCA en la QA de código (static/unit/api/db/security) → esas capas no lo mencionan en ningún lado.
//
// Motor CERO-dependencias (invariante 4): NO importa axe-core directo. La FUENTE de axe-core llega
// INYECTADA (`axeSource`, la provee la webapp desde su node_modules) igual que `launchBrowser`. Con
// `page` inyectable (Playwright real o falso) → 100% offline-testable. Best-effort: si axe no está o
// falla, no rompe la exploración.
//
// Cada violación → un caso {name, status, message, plain, action}: `plain`/`action` (la explicación en
// lenguaje llano que `failure-explain` deja pasar) → HU/MD/HTML/UX muestran lo mismo (invariante 8).

const IMPACT_ES = { critical: "crítica", serious: "grave", moderate: "moderada", minor: "menor" };
const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const DEFAULT_FAIL_ON = ["critical", "serious"]; // lo que BLOQUEA; el resto = sugerencia

// Corre DENTRO de la página (tras inyectar la fuente). Devuelve solo lo necesario (no todo el árbol).
// Es una función autocontenida (Playwright la serializa) que usa globals del navegador (window/document).
async function axeRunInPage() {
  const r = await window.axe.run(document, { resultTypes: ["violations"] });
  return (r.violations || []).map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    helpUrl: v.helpUrl,
    count: (v.nodes || []).length,
    nodes: (v.nodes || []).slice(0, 5).map((n) => (n.target || []).join(" ")),
  }));
}

// Carga la fuente de axe-core por import dinámico (fallback para CLI). En la webapp la fuente se
// INYECTA (resuelta desde webapp/node_modules), así que este import no hace falta ahí.
export async function loadAxeSource() {
  try {
    const m = await import("axe-core");
    return (m.default && m.default.source) || m.source || null;
  } catch {
    return null;
  }
}

/**
 * Corre axe sobre UNA página ya cargada. Best-effort.
 * @param {object} page  página tipo Playwright (inyectable)
 * @param {{axeSource?:string}} [opts]  fuente de axe-core (string); sin ella no corre
 * @returns {Promise<{ran:boolean, violations:object[]}>}
 */
export async function scanPageAccessibility(page, { axeSource } = {}) {
  if (!axeSource || !page || typeof page.evaluate !== "function") return { ran: false, violations: [] };
  try {
    await page.evaluate(axeSource); // inyecta axe-core (define window.axe)
    const violations = await page.evaluate(axeRunInPage); // corre axe en la página
    return { ran: true, violations: Array.isArray(violations) ? violations : [] };
  } catch {
    return { ran: false, violations: [] };
  }
}

/**
 * Arma el EvidenceObject de accesibilidad a partir de las violaciones por página. Devuelve null si
 * axe no llegó a analizar ninguna página (queda en silencio: no ensucia la exploración).
 * @param {Array<{url?:string, ran:boolean, violations:object[]}>} pages
 * @param {{profile?:object, tcId?:string}} [opts]
 */
export function buildAxeEvidence(pages = [], { profile = {}, tcId } = {}) {
  const cfg = (profile.explore && profile.explore.accessibility) || {};
  if (cfg.off === true) return null;
  const ran = pages.filter((p) => p.ran);
  if (!ran.length) return null; // axe no analizó nada → no se reporta
  const failOn = new Set((cfg.fail_on || DEFAULT_FAIL_ON).map((s) => String(s).toLowerCase()));
  const ignore = (cfg.ignore || []).map((s) => String(s).toLowerCase());
  const base = { layer: "explore", ...(tcId ? { tc_id: tcId } : {}), metrics: { tool: "axe", pages: ran.length } };

  // Agrupa por REGLA (una explicación por regla; las ocurrencias = página → selector, para corregir).
  const byRule = new Map();
  for (const p of pages) {
    for (const v of p.violations || []) {
      if (ignore.includes(String(v.id).toLowerCase())) continue;
      if (!byRule.has(v.id)) byRule.set(v.id, { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, hits: [] });
      const g = byRule.get(v.id);
      for (const sel of v.nodes && v.nodes.length ? v.nodes : ["(elemento)"]) g.hits.push(`${p.url || "página"} → ${sel}`);
    }
  }
  if (!byRule.size) {
    return {
      ...base, status: "pass",
      narrative: `accesibilidad: sin violaciones en ${ran.length} página(s)`,
      cases: [{
        name: "Accesibilidad (axe-core)", status: "pass", message: `${ran.length} página(s) analizada(s).`,
        plain: `Se revisó la accesibilidad (reglas WCAG con axe-core) de ${ran.length} página(s) y no aparecieron violaciones automáticas. Es un análisis automático: cubre parte de WCAG, no reemplaza una revisión manual (lector de pantalla, teclado).`,
      }],
    };
  }
  const groups = [...byRule.values()].sort((a, b) => (IMPACT_RANK[a.impact] ?? 4) - (IMPACT_RANK[b.impact] ?? 4));
  const cases = groups.map((g) => {
    const impact = String(g.impact || "minor").toLowerCase();
    const blocks = failOn.has(impact);
    const where = g.hits.slice(0, 8).join(" · ") + (g.hits.length > 8 ? `, …(+${g.hits.length - 8})` : "");
    return {
      name: `${g.help || g.id} [${IMPACT_ES[impact] || impact}]`,
      status: blocks ? "fail" : "skip",
      message: `${g.id} · ${g.helpUrl || ""}\n${where}`,
      plain: `Problema de accesibilidad de severidad ${IMPACT_ES[impact] || impact}: ${g.help || g.id}. Afecta a quienes navegan con lector de pantalla, solo teclado o alto contraste. Apareció en ${g.hits.length} elemento(s): ${where}.`,
      action: `Corregí esos elementos según la regla WCAG «${g.id}» (guía: ${g.helpUrl || "axe-core"}).${blocks ? "" : " Es de severidad menor/moderada: sugerencia, no bloquea."}`,
    };
  });
  const fails = cases.filter((c) => c.status === "fail").length;
  return {
    ...base, status: fails ? "fail" : "pass",
    narrative: `accesibilidad: ${byRule.size} tipo(s) de problema en ${ran.length} página(s)${fails ? ` (${fails} que bloquea[n])` : " (todas sugerencias)"}`,
    cases,
  };
}

export default { scanPageAccessibility, buildAxeEvidence, loadAxeSource };
