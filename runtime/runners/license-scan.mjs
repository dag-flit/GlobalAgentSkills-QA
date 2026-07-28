// license-scan.mjs — cumplimiento de LICENCIAS de las dependencias (parte de la capa `security`).
//
// Por qué PROPIO y SOLO-LECTURA: igual que `secret-scan` lee el código y `db-declared` lee el DDL,
// este LEE los `package.json` de las dependencias YA INSTALADAS (node_modules) del repo probado y
// clasifica su licencia. NO instala nada, NO ejecuta nada, NO toca el repo → 100% offline-testable
// (`listInstalled`/`projectLicense` inyectables).
//
// Autonomía (invariante 9): NO impone una postura de licenciamiento. El criterio sale del PROPIO repo:
// si el `package.json` raíz se declara PROPIETARIO (`private:true` o `UNLICENSED`/`SEE LICENSE`) y
// arrastra una dependencia COPYLEFT FUERTE (GPL/AGPL/SSPL), eso es un CONFLICTO objetivo → falla; si la
// postura del proyecto no es clara, queda como SUGERENCIA informativa. `profile.security.licenses`
// (off / deny / allow / ignore) es el escape hatch, no el camino normal.
//
// Cada caso emite {name, status, message, plain, action} → las 4 rutas (HU, MD, HTML, UX) muestran lo
// mismo (invariante 8). `message` lista dependencia@versión (licencia) para los agentes de desarrollo.

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["bin", "obj", ".git", "dist", "build", ".next", "out", ".vs", "qa-evidence", "qa-generated"]);
const MAX_PKGS = 6000;

// Clasificación por familia SPDX (alta confianza). El orden importa: AGPL/LGPL contienen "GPL".
const PERMISSIVE = /\b(MIT|ISC|0BSD|BSD-2-CLAUSE|BSD-3-CLAUSE|BSD|APACHE-2\.0|APACHE|UNLICENSE|CC0-1\.0|CC0|ZLIB|WTFPL|PYTHON-2\.0|BLUEOAK|MIT-0|PostgreSQL)\b/i;
const WEAK_COPYLEFT = /\b(LGPL|MPL-2\.0|MPL|EPL|CDDL|MS-PL|EUPL-1\.1)\b/i;
const STRONG_COPYLEFT = /\b(AGPL|SSPL|GPL-2\.0|GPL-3\.0|GPL|OSL|EUPL-1\.2|EUPL)\b/i;
const UNKNOWN_ID = /^(unknown|unlicensed|see\s+license|custom|proprietary|)$/i;

/** Clasifica una expresión de licencia SPDX. Con OR (doble licencia) elige la alternativa MENOS
 *  restrictiva (podés cumplir con esa). Devuelve la clase efectiva. */
export function classifyLicense(expr) {
  const s = String(expr || "").trim();
  if (UNKNOWN_ID.test(s)) return "unknown";
  // Doble/múltiple licencia "A OR B": alcanza con cumplir UNA → tomamos la menos restrictiva.
  const alts = s.split(/\s+OR\s+/i).map((a) => a.replace(/^[()\s]+|[()\s]+$/g, ""));
  const classOne = (a) => {
    if (PERMISSIVE.test(a) && !STRONG_COPYLEFT.test(a) && !WEAK_COPYLEFT.test(a)) return "permissive";
    if (STRONG_COPYLEFT.test(a) && !WEAK_COPYLEFT.test(a.replace(STRONG_COPYLEFT, ""))) {
      // "LGPL" matchea STRONG por contener GPL: si además hay LGPL/MPL, es weak; si es GPL puro, strong.
      return WEAK_COPYLEFT.test(a) ? "weak" : "strong";
    }
    if (WEAK_COPYLEFT.test(a)) return "weak";
    if (PERMISSIVE.test(a)) return "permissive";
    return "unknown";
  };
  const rank = { permissive: 0, weak: 1, strong: 2, unknown: 3 };
  let best = null;
  for (const a of alts) {
    const c = classOne(a);
    if (best === null || rank[c] < rank[best]) best = c;
  }
  return best || "unknown";
}

// Lee el campo de licencia de un package.json: string SPDX, objeto {type}, o legacy `licenses:[{type}]`.
function licenseId(pkg) {
  if (!pkg) return "";
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) return String(pkg.license.type);
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (l && l.type) || l).filter(Boolean).join(" OR ");
  return "";
}

// ── Lectura por defecto de node_modules (solo lectura) ────────────────────────────────────────────
// Encuentra los node_modules del repo (raíz + por paquete) y lee el package.json de cada dependencia.
function defaultListInstalled(repoRoot) {
  const nmDirs = [];
  const walk = (abs, depth) => {
    if (depth > 6 || nmDirs.length > 50) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules") { nmDirs.push(path.join(abs, e.name)); continue; }
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(path.join(abs, e.name), depth + 1);
    }
  };
  walk(path.resolve(repoRoot), 0);
  const out = [];
  const seen = new Set();
  const readPkg = (dir, name) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      const id = `${pkg.name || name}@${pkg.version || "?"}`;
      if (seen.has(id) || out.length >= MAX_PKGS) return;
      seen.add(id);
      out.push({ name: pkg.name || name, version: pkg.version || "?", license: licenseId(pkg) });
    } catch { /* dependencia sin package.json legible → se ignora */ }
  };
  for (const nm of nmDirs) {
    let entries;
    try { entries = fs.readdirSync(nm, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".bin" || e.name === ".cache") continue;
      if (e.name.startsWith("@")) { // scope: @scope/<pkg>
        let scoped;
        try { scoped = fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }); } catch { continue; }
        for (const s of scoped) if (s.isDirectory()) readPkg(path.join(nm, e.name, s.name), `${e.name}/${s.name}`);
      } else readPkg(path.join(nm, e.name), e.name);
    }
  }
  return out;
}

// Postura de licenciamiento del PROPIO proyecto (de su package.json raíz): ¿se declara propietario?
function defaultProjectLicense(repoRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return { license: licenseId(pkg), private: pkg.private === true };
  } catch { return { license: "", private: false }; }
}
function isProprietary(proj) {
  return Boolean(proj && (proj.private || /^(unlicensed|see\s+license)/i.test(String(proj.license || ""))));
}

const CLASS_PLAIN = {
  strong: "son de licencia COPYLEFT FUERTE (familia GPL/AGPL/SSPL). En un producto propietario, distribuir software que las usa puede OBLIGAR a publicar tu propio código fuente bajo la misma licencia. Es un riesgo legal, no técnico.",
  weak: "son de licencia COPYLEFT DÉBIL (LGPL/MPL/EPL). Suelen ser compatibles con software propietario si se usan como biblioteca sin modificarlas, pero conviene revisar las condiciones.",
  unknown: "NO declaran una licencia reconocible (campo vacío, «UNLICENSED» o licencia a medida). Sin saber la licencia, no se puede evaluar si su uso es legalmente seguro.",
};
const CLASS_ACTION = {
  strong: "Revisá con el área legal si podés usarlas. Si no, reemplazalas por una alternativa de licencia permisiva (MIT/BSD/Apache), o aislá su uso para no distribuir código derivado.",
  weak: "Verificá que las uses como biblioteca sin modificar su código; documentá su uso y licencia.",
  unknown: "Confirmá la licencia real de cada una (repositorio del proyecto) antes de usarlas en producción.",
};

// Arma un caso por CLASE de licencia con problema. `hard` (proyecto propietario o deny) → fail; si no,
// sugerencia (skip). Cada caso lista dependencia@versión (licencia) para los agentes.
function buildCases(byClass, { total, proprietary, deny }) {
  if (!byClass.strong.length && !byClass.weak.length && !byClass.unknown.length) {
    return [{
      name: "Licencias de dependencias",
      status: "pass",
      message: `${total} dependencia(s) instalada(s) revisada(s).`,
      plain: `Se revisaron las licencias de ${total} dependencia(s) de terceros y todas tienen una licencia permisiva conocida (MIT/BSD/Apache/ISC…), compatible con un producto propietario. Es un chequeo automático de la licencia declarada: reduce el riesgo legal, no lo elimina.`,
    }];
  }
  const cases = [];
  for (const klass of ["strong", "weak", "unknown"]) {
    const hits = byClass[klass];
    if (!hits.length) continue;
    const list = hits.map((h) => `${h.name}@${h.version} (${h.license || "sin licencia"})`);
    const where = list.slice(0, 15).join(" · ") + (list.length > 15 ? `, …(+${list.length - 15})` : "");
    // Solo el copyleft FUERTE se vuelve hallazgo cuando el proyecto es propietario (conflicto objetivo)
    // o cuando el perfil lo prohíbe; el resto es informativo (no imponemos postura — invariante 9).
    const hard = klass === "strong" && (proprietary || deny);
    const posture = proprietary ? " Tu proyecto se declara PROPIETARIO en su package.json, así que esto es un conflicto de licencias real." : "";
    cases.push({
      name: `Dependencias con licencia ${klass === "strong" ? "copyleft fuerte" : klass === "weak" ? "copyleft débil" : "no declarada"}`,
      status: hard ? "fail" : "skip",
      // Una licencia a revisar que NO bloquea es una SUGERENCIA (detectada, no reprueba) → va a su
      // propia sección, no a «No verificado». Un conflicto duro (fail) es un hallazgo, no lleva marca.
      ...(hard ? {} : { kind: "suggestion" }),
      message: list.join("\n"),
      plain: `${hits.length} dependencia(s) ${CLASS_PLAIN[klass]}${posture} Afecta a: ${where}.`,
      action: CLASS_ACTION[klass],
    });
  }
  return cases;
}

/**
 * Escanea las licencias de las dependencias instaladas. `listInstalled`/`projectLicense` inyectables.
 * @returns {{status:"pass"|"fail"|"skip", cases:object[], total:number}}
 */
export function scanLicenses(repoRoot, opts = {}) {
  const { profile = {}, listInstalled = defaultListInstalled, projectLicense = defaultProjectLicense } = opts;
  const cfg = (profile.security && profile.security.licenses) || {};
  if (cfg.off === true) return { status: "skip", cases: [], total: 0 };
  const installed = listInstalled(repoRoot, opts) || [];
  // Sin dependencias instaladas → no se puede leer licencias (son artefacto del repo, no del kit).
  if (!installed.length) {
    return {
      status: "skip", total: 0,
      cases: [{
        name: "Licencias de dependencias", status: "skip",
        plain: "No se pudo auditar licencias: no se encontraron dependencias instaladas (node_modules). Las licencias se leen de las dependencias YA instaladas del proyecto.",
        action: "Instalá las dependencias del proyecto (su build habitual) para poder auditar las licencias.",
        message: "sin node_modules",
      }],
    };
  }
  const deny = (cfg.deny || []).map((s) => String(s).toLowerCase());
  const allow = (cfg.allow || []).map((s) => String(s).toLowerCase());
  const ignore = (cfg.ignore || []).map((s) => String(s).toLowerCase());
  const proprietary = isProprietary(projectLicense(repoRoot));
  const byClass = { strong: [], weak: [], unknown: [], denied: [] };
  for (const dep of installed) {
    if (ignore.some((f) => dep.name.toLowerCase().includes(f))) continue;
    const id = String(dep.license || "").toLowerCase();
    if (allow.length && allow.some((a) => id.includes(a))) continue; // licencia en la allowlist → ok
    const denied = deny.some((d) => id.includes(d));
    const klass = classifyLicense(dep.license);
    if (denied) byClass.strong.push(dep); // deny explícito → tratar como hallazgo duro
    else if (klass === "strong") byClass.strong.push(dep);
    else if (klass === "weak") byClass.weak.push(dep);
    else if (klass === "unknown") byClass.unknown.push(dep);
  }
  const cases = buildCases(byClass, { total: installed.length, proprietary, deny: deny.length > 0 });
  const status = cases.some((c) => c.status === "fail") ? "fail" : cases.every((c) => c.status === "pass") ? "pass" : "skip";
  return { status, cases, total: installed.length };
}

export default { scanLicenses, classifyLicense };
