// parse-sca.mjs — parsers PUROS de las herramientas de SCA (vulnerabilidades en dependencias).
// Cada uno recibe la salida del ejecutor { code, stdout, stderr } y un set `failOn` de severidades que
// BLOQUEAN (las demás son sugerencias) y devuelve casos {name, status, message, plain, action}.
// `plain`/`action` = explicación en lenguaje llano (invariante 8) → las 4 rutas la muestran igual.
// CERO red, CERO ejecución: solo transforman texto/JSON. Si la salida no es la esperada, devuelven null
// (el runner degrada al resumen de siempre, nunca rompe el ciclo).

// Severidad → estado del caso: bloquea (fail) si está en `failOn`, si no queda como sugerencia (skip).
function sevStatus(sev, failOn) {
  return failOn.has(String(sev || "").toLowerCase()) ? "fail" : "skip";
}
const SEV_ES = { critical: "crítica", high: "alta", moderate: "media", low: "baja", info: "informativa", unknown: "desconocida" };
const sevEs = (s) => SEV_ES[String(s || "").toLowerCase()] || String(s || "desconocida");

// Explicación llana común: qué ES una dependencia vulnerable + qué hacer. Reutilizada por los 3 parsers.
function vulnPlain(pkg, sev, title) {
  return `La dependencia «${pkg}» tiene una vulnerabilidad conocida de severidad ${sevEs(sev)}${title ? `: ${title}` : ""}. Es código de terceros que tu proyecto usa; una versión afectada puede exponer la app aunque tu propio código esté bien.`;
}
function vulnAction(pkg, fix) {
  return `Actualizá «${pkg}» a una versión corregida${fix ? ` (${fix})` : ""}. Si es una dependencia transitiva (la trae otra), actualizá la que la incluye o fijá una versión segura. No la ignores por ser "de otro paquete": corre con tu app.`;
}
const firstLine = (s) => String(s || "").split(/\r?\n/)[0].trim();
// Una vuln DETECTADA que no bloquea (severidad menor) es una SUGERENCIA: se encontró y se reporta, pero
// no reprueba. La marca `kind:"suggestion"` la separa de «No verificado» (lo que NO se pudo comprobar) →
// las 14 vulns medias dejan de leerse como "pruebas saltadas". Solo aplica a los casos `skip`.
function tagSuggestions(cases) {
  for (const c of cases) if (c && c.status === "skip") c.kind = "suggestion";
  return cases;
}
function pickJson(text) {
  if (!text) return null;
  try { return JSON.parse(String(text)); } catch { /* intenta recortar */ }
  const t = String(text);
  const a = t.indexOf("{"); const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* noop */ } }
  const c = t.indexOf("["); const d = t.lastIndexOf("]");
  if (c >= 0 && d > c) { try { return JSON.parse(t.slice(c, d + 1)); } catch { /* noop */ } }
  return null;
}

/** npm audit --json (soporta el formato npm v7+ `vulnerabilities` y el v6 `advisories`). */
export function parseNpmAudit(out, { failOn } = { failOn: new Set(["critical", "high"]) }) {
  const j = pickJson(out.stdout);
  if (!j || typeof j !== "object") return null;
  const cases = [];
  if (j.vulnerabilities && typeof j.vulnerabilities === "object") {
    for (const [name, v] of Object.entries(j.vulnerabilities)) {
      const sev = v.severity || "unknown";
      const via = Array.isArray(v.via) ? v.via : [];
      const titles = via.map((x) => (typeof x === "object" ? x.title : null)).filter(Boolean);
      const urls = via.map((x) => (typeof x === "object" ? x.url : null)).filter(Boolean);
      const fix = v.fixAvailable ? "hay arreglo con `npm audit fix`" : "";
      cases.push({
        name: `${name} (${sevEs(sev)})`, status: sevStatus(sev, failOn),
        message: `${urls[0] || ""}${v.range ? ` · rango vulnerable: ${v.range}` : ""}`.trim() || null,
        plain: vulnPlain(name, sev, titles[0] || ""), action: vulnAction(name, fix),
      });
    }
    return tagSuggestions(cases);
  }
  if (j.advisories && typeof j.advisories === "object") {
    for (const a of Object.values(j.advisories)) {
      cases.push({
        name: `${a.module_name} (${sevEs(a.severity)})`, status: sevStatus(a.severity, failOn),
        message: `${a.url || ""}${a.vulnerable_versions ? ` · rango vulnerable: ${a.vulnerable_versions}` : ""}`.trim() || null,
        plain: vulnPlain(a.module_name, a.severity, a.title || ""), action: vulnAction(a.module_name, a.patched_versions ? `versión parcheada: ${a.patched_versions}` : ""),
      });
    }
    return tagSuggestions(cases);
  }
  return cases; // JSON válido sin vulnerabilidades → [] (pass)
}

// dotnet list package --vulnerable (salida de TEXTO, portable entre versiones del SDK). Cada línea de
// paquete vulnerable empieza con `>`: `> Paquete   Requerida   Resuelta   Severidad   URL`.
const DOTNET_ROW = /^\s*>\s+(\S+)\s+(?:\S+\s+)?(\S+)\s+(Critical|High|Moderate|Low)\s+(\S+)?/i;
export function parseDotnetVulnerable(out, { failOn } = { failOn: new Set(["critical", "high"]) }) {
  const text = `${out.stdout}\n${out.stderr}`;
  const cases = [];
  for (const line of text.split(/\r?\n/)) {
    const m = DOTNET_ROW.exec(line);
    if (!m) continue;
    const [, pkg, resolved, sev, url] = m;
    cases.push({
      name: `${pkg} (${sevEs(sev)})`, status: sevStatus(sev, failOn),
      message: `${url || ""}${resolved ? ` · versión resuelta: ${resolved}` : ""}`.trim() || null,
      plain: vulnPlain(pkg, sev, ""), action: vulnAction(pkg, "actualizá el paquete NuGet a una versión no afectada"),
    });
  }
  return tagSuggestions(cases);
}

/** pip-audit --format json → `{dependencies:[{name,version,vulns:[{id,fix_versions,description}]}]}` o array. */
export function parsePipAudit(out, { failOn } = { failOn: new Set(["critical", "high"]) }) {
  const j = pickJson(out.stdout);
  if (!j) return null;
  const deps = Array.isArray(j) ? j : Array.isArray(j.dependencies) ? j.dependencies : null;
  if (!deps) return null;
  const cases = [];
  for (const d of deps) {
    for (const v of d.vulns || d.vulnerabilities || []) {
      const sev = v.severity || "unknown";
      const fix = Array.isArray(v.fix_versions) && v.fix_versions.length ? `versión corregida: ${v.fix_versions.join(", ")}` : "";
      cases.push({
        name: `${d.name} (${sevEs(sev)})`, status: sevStatus(sev, failOn),
        message: `${v.id || ""}${d.version ? ` · instalada: ${d.version}` : ""}`.trim() || null,
        plain: vulnPlain(d.name, sev, firstLine(v.description || v.details || "")), action: vulnAction(d.name, fix),
      });
    }
  }
  return tagSuggestions(cases);
}

export default { parseNpmAudit, parseDotnetVulnerable, parsePipAudit };
