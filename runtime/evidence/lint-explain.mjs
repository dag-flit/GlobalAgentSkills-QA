// lint-explain.mjs — traduce una ADVERTENCIA de linter (eslint/ruff) a lenguaje CLARO para no técnicos,
// y la renderiza como "sugerencia" (positivo) en el reporte md y html. Las advertencias no rompen ni
// bloquean la app; son buenas prácticas. Espejo del `lintRuleHelp` de la webapp (mantener en sync). Puro.

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Regla exacta → qué significa (lenguaje llano). Las más comunes de FLIT (Next/React/TS).
// NOTA: sin `<` `>` en el texto — en Markdown/HTML se interpretan como etiquetas y desaparecen; se usan «».
const RULE_HELP = {
  "@next/next/no-img-element": "Se usa la etiqueta «img» en vez del componente «Image» de Next, que optimiza el peso y la carga de la imagen. Conviene reemplazarla por «Image».",
  "react-hooks/exhaustive-deps": "A un useEffect/useMemo le faltan (o le sobran) dependencias en su lista; puede mostrar datos desactualizados.",
  "react/no-unescaped-entities": "Hay comillas o apóstrofos sin escapar dentro del texto JSX; conviene escaparlos.",
  "prefer-const": "Una variable declarada con «let» que nunca cambia: debería ser «const».",
  "no-console": "Quedó un console.* (log/warn) en el código; conviene quitarlo antes de producción.",
  "no-debugger": "Quedó un «debugger» en el código; hay que quitarlo.",
};
const RULE_PREFIX_HELP = [
  [/no-unused-vars/, "Hay una variable, import o parámetro declarado que no se usa; conviene quitarlo para limpiar el código."],
  [/no-explicit-any/, "Se usa el tipo «any», que apaga el chequeo de tipos; preferí un tipo concreto."],
  [/^jsx-a11y\//, "Regla de accesibilidad (a11y): el elemento no cumple una buena práctica de accesibilidad (p.ej. falta una etiqueta o un texto alternativo)."],
  [/^@typescript-eslint\//, "Regla de TypeScript sobre tipos o estilo del código."],
  [/^react-hooks\//, "Regla sobre el uso correcto de los hooks de React."],
  [/^react\//, "Regla de buenas prácticas de React."],
  [/^import\//, "Regla sobre cómo se importan o exportan los módulos."],
];

/** "ruta/archivo.ext:línea[:col] regla" → { rule, location, help } (o null si no matchea). */
export function lintRuleHelp(name) {
  const m = String(name || "").match(/^(.*?:\d+(?::\d+)?)\s+(\S.*)$/);
  if (!m) return null;
  const rule = m[2].trim();
  const help = RULE_HELP[rule] || (RULE_PREFIX_HELP.find(([re]) => re.test(rule)) || [])[1]
    || "Regla de buenas prácticas del linter. No bloquea ni rompe la app, pero conviene revisarla (el nombre de la regla indica el tema).";
  return { rule, location: m[1], help };
}

// Nombre amigable de la capa de la que proviene la advertencia (para referenciarla).
const LAYER_NAME = { static: "Análisis estático", unit: "Pruebas unitarias", api: "Contrato de API", db: "Base de datos", security: "Seguridad" };

// Normaliza a posix y separa `ruta:línea[:col]`. Preserva la RUTA EXACTA (los agentes la usan para corregir).
export function parseLoc(location) {
  const s = String(location || "").replace(/\\/g, "/");
  const m = s.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (m) return { path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null };
  return { path: s.replace(/:.*$/, "") || s, line: null, col: null };
}

// Nombre AMIGABLE de un archivo (para no técnicos), DERIVADO de la ruta por convención (Next app router,
// componentes, hooks, libs, tests…). NO reemplaza la ruta exacta: es un rótulo humano que se muestra JUNTO
// a `ruta:línea:col` (esta última la consumen los agentes de desarrollo para localizar y corregir).
export function friendlyFile(path) {
  const p = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const base = p.split("/").pop() || p;
  const noExt = base.replace(/\.[^.]+$/, "");
  const app = p.match(/(?:^|\/)app\/(.*)\/(page|layout|route|loading|error|not-found)\.[jt]sx?$/i);
  if (app) {
    const route = "/" + app[1].replace(/\((?:[^)]+)\)\/?/g, "").replace(/^\/+/, "");
    const kind = { page: "Página", layout: "Layout", route: "Ruta API", loading: "Estado de carga", error: "Página de error", "not-found": "Página 404" }[app[2].toLowerCase()] || "Vista";
    return `${kind} «${route || "/"}»`;
  }
  if (/(?:^|\/)components?\//i.test(p)) return `Componente «${noExt}»`;
  if (/(?:^|\/)hooks?\//i.test(p) || /^use[A-Z]/.test(noExt)) return `Hook «${noExt}»`;
  if (/\.(test|spec)\.[jt]sx?$|(?:^|\/)__tests__\//i.test(p)) return `Prueba «${noExt}»`;
  if (/(?:^|\/)api\//i.test(p)) return `API «${noExt}»`;
  if (/(?:^|\/)(lib|utils?|helpers?|services?|domain|application|infrastructure)\//i.test(p)) return `Módulo «${noExt}»`;
  return `Archivo «${base}»`;
}

// Rótulo humano de una ubicación: "Componente «Login» · línea 126".
export function friendlyLocation(location) {
  const { path, line } = parseLoc(location);
  if (!path) return "";
  return `${friendlyFile(path)}${line ? ` · línea ${line}` : ""}`;
}

// Advertencias (casos "skip", p.ej. de la capa static) de todos los resultados, ya explicadas y con
// su ORIGEN (capa + herramienta + paquete) para poder REFERENCIARLAS a la capa a la que pertenecen.
export function collectWarnings(results = []) {
  const out = [];
  for (const r of results) {
    const cases = Array.isArray(r.cases) ? r.cases : [];
    // "skip" en static = advertencia del linter. (Otras capas no emiten advertencias hoy.)
    if (r.layer !== "static") continue;
    const tool = r.metrics?.tool || "";
    const cwd = r.metrics?.cwd || r.metrics?.label || "";
    const source = `${LAYER_NAME[r.layer] || r.layer}${tool ? ` — ${tool}` : ""}${cwd ? ` · ${cwd}` : ""}`;
    for (const c of cases) {
      if (c.status !== "skip") continue;
      const lr = lintRuleHelp(c.name);
      out.push({ source, rule: lr?.rule || c.name, location: lr?.location || "", help: lr?.help || "", message: c.message || "" });
    }
  }
  return out;
}

// Agrupa las advertencias por CAPA/origen y, dentro, por REGLA (para explicar UNA vez y no repetir).
// Devuelve [{ source, total, rules: [{ rule, help, files, occ: [{friendly, path, line, col, raw}] }] }].
// `raw` = "ruta:línea:col" EXACTA (normalizada a posix) → la consumen los agentes para corregir.
export function groupWarnings(results = []) {
  const w = collectWarnings(results);
  const bySource = new Map();
  for (const x of w) {
    if (!bySource.has(x.source)) bySource.set(x.source, new Map());
    const byRule = bySource.get(x.source);
    if (!byRule.has(x.rule)) byRule.set(x.rule, { rule: x.rule, help: x.help, occ: [] });
    const { path, line, col } = parseLoc(x.location);
    const raw = `${path}${line ? `:${line}${col ? `:${col}` : ""}` : ""}`;
    byRule.get(x.rule).occ.push({ friendly: friendlyFile(path), path, line, col, raw });
  }
  return [...bySource.entries()].map(([source, byRule]) => {
    const rules = [...byRule.values()].map((r) => ({ ...r, files: new Set(r.occ.map((o) => o.path)).size }));
    return { source, total: rules.reduce((n, r) => n + r.occ.length, 0), rules };
  });
}

const INTRO = "No bloquean ni rompen la app: son buenas prácticas del linter para mejorar el código. Se agrupan por capa y por regla; cada ocurrencia incluye la ruta exacta (para localizar y corregir).";

/** Sección de sugerencias en Markdown (array de líneas; vacío si no hay advertencias). */
export function warningsMd(results = []) {
  const groups = groupWarnings(results);
  const total = groups.reduce((n, g) => n + g.total, 0);
  if (!total) return [];
  const md = ["---", `## 💡 Sugerencias (${total} advertencia(s) del linter)`, "", `_${INTRO}_`, ""];
  for (const g of groups) {
    md.push(`### Capa: ${g.source} (${g.total})`);
    for (const r of g.rules) {
      md.push(`- **${r.rule}** — ${r.occ.length} uso(s) en ${r.files} archivo(s)`);
      if (r.help) md.push(`  - 📖 **Qué significa:** ${r.help}`);
      for (const o of r.occ) md.push(`  - ${o.friendly}${o.line ? ` · línea ${o.line}` : ""} — \`${o.raw}\``);
    }
    md.push("");
  }
  return md;
}

/** Sección de sugerencias en HTML (usa la clase .warn del reporte; "" si no hay). */
export function warningsHtml(results = []) {
  const groups = groupWarnings(results);
  const total = groups.reduce((n, g) => n + g.total, 0);
  if (!total) return "";
  let out = `<h2>💡 Sugerencias (${total} advertencia(s) del linter)</h2><p class="muted">${esc(INTRO)}</p>`;
  for (const g of groups) {
    out += `<p style="margin:10px 0 2px"><b>Capa: ${esc(g.source)}</b> <small class="muted">(${g.total})</small></p>`;
    out += g.rules
      .map((r) => {
        const occ = r.occ
          .map((o) => `<li>${esc(o.friendly)}${o.line ? ` · línea ${o.line}` : ""} — <code>${esc(o.raw)}</code></li>`)
          .join("");
        return `<div class="warn"><b>${esc(r.rule)}</b> <small class="muted">(${r.occ.length} uso(s) en ${r.files} archivo(s))</small>` +
          `${r.help ? `<div>📖 <b>Qué significa:</b> ${esc(r.help)}</div>` : ""}` +
          `<ul style="margin:4px 0 0 18px">${occ}</ul></div>`;
      })
      .join("");
  }
  return out;
}

export default { lintRuleHelp, collectWarnings, groupWarnings, warningsMd, warningsHtml, friendlyFile, friendlyLocation, parseLoc };
