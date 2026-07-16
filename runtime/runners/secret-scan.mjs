// secret-scan.mjs — escáner de SECRETOS quemados en el código del repo probado.
//
// Por qué es PROPIO (sin herramienta externa): igual que `db-declared` lee el DDL del repo, este
// camina los archivos del repo y busca CREDENCIALES escritas directamente en el código (contraseñas,
// llaves privadas, tokens de API, cadenas de conexión con contraseña). PURO/offline: solo lee texto,
// sin red ni ejecución → 100% offline-testable (`listFiles`/`readFile` inyectables).
//
// Autonomía (invariante 9): NO opina de estilo ("esta variable se llama password"). Solo marca formas
// REALES de credencial de ALTA confianza, y respeta lo que el repo ya ignora (carpetas de build/deps).
// El valor detectado JAMÁS se plasma completo en la evidencia (iría a la HU/ADO): se REDACTA — el
// escáner no puede convertirse él mismo en una fuga.
//
// Cada caso devuelve {name, status, message, plain, action}: `plain`/`action` son la explicación en
// lenguaje llano que `failure-explain` deja pasar tal cual → las 4 rutas (HU, MD, HTML, UX) muestran lo
// mismo (invariante 8). `message` es el detalle técnico (ruta:línea + valor REDACTADO) para los agentes.

import fs from "node:fs";
import path from "node:path";

// Carpetas que el repo ya considera generadas/ajenas (deps, build, control de versiones, salida del kit).
const SKIP_DIRS = new Set([
  "node_modules", "bin", "obj", ".git", "dist", "build", ".next", ".nuxt", "out",
  "coverage", ".vs", ".vscode", ".idea", "vendor", "packages", "qa-evidence", "qa-generated",
]);
// Extensiones sin secretos de app (binarios, imágenes, lockfiles y bundles minificados = ruido).
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf|zip|gz|tgz|tar|7z|rar|exe|dll|so|dylib|bin|woff2?|ttf|eot|mp[34]|mov|avi|class|jar|pyc|lock|snap|map|min\.js|min\.css)$/i;
const SKIP_BASE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Cargo\.lock)$/i;
const MAX_FILE_BYTES = 512 * 1024; // un archivo de fuente real no pesa medio mega; más = generado
const MAX_FILES = 6000;

// ── Reglas de ALTA confianza: la FORMA es inequívocamente una credencial ──────────────────────────
// `value` (índice del grupo capturado) permite redactar y filtrar placeholders; sin él, el match entero
// es la evidencia (p.ej. una llave privada PEM, que no se muestra jamás).
const RULES = [
  { rule: "private-key", label: "Llave privada", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, opaque: true },
  { rule: "aws-key", label: "Clave de acceso de AWS", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { rule: "gcp-key", label: "Clave de API de Google", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { rule: "github-token", label: "Token de GitHub", re: /\b(?:gh[pousr]_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{22,})\b/g },
  { rule: "slack-token", label: "Token de Slack", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { rule: "stripe-key", label: "Clave secreta de Stripe", re: /\bsk_live_[0-9A-Za-z]{20,}\b/g },
  { rule: "openai-key", label: "Clave de API de OpenAI", re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g, value: 0 },
  // Contraseña embebida en una URL de conexión (postgres://user:PASS@host). El grupo 1 = la contraseña.
  { rule: "conn-url", label: "Contraseña en una cadena de conexión", value: 1,
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp|mssql|sqlserver):\/\/[^\s:@/]+:([^\s:@/]{3,})@[^\s/]+/gi },
];

// Regla KV (.NET/ADO): `Password=...` SOLO si la línea es una cadena de conexión de verdad (trae
// Server/Data Source/Host/Database). Así no matchea un `password = x` cualquiera. Grupo 1 = la clave.
const KV_RE = /(?:Password|Pwd)\s*=\s*([^;"'\s]{3,})/gi;
const KV_CONTEXT = /(?:Server|Data\s*Source|Host|Initial\s*Catalog|Database|Uid|User\s*Id)\s*=/i;

// Regla GENÉRICA (la más ruidosa → la más filtrada): una var con nombre de secreto asignada a un
// literal de ALTA entropía. Grupo 1 = el valor. Se descarta si es placeholder, si referencia el entorno
// o si no tiene entropía suficiente → solo queda lo que de verdad parece una credencial pegada.
const GENERIC_RE = /\b(?:api[_-]?key|secret|token|access[_-]?key|client[_-]?secret|auth[_-]?token|passwd|password)\b\s*["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi;
const ENV_REF = /(?:process\.env|os\.environ|getenv|GetEnvironmentVariable|import\.meta\.env|\$\{|\{\{|%[A-Z_]+%)/i;

// Valores que NO son secretos aunque tengan la forma: placeholders y ejemplos.
const PLACEHOLDER = /^(?:x{3,}|\.{3}|your[_-]?|my[_-]?|example|changeme|change[_-]?this|placeholder|dummy|sample|test|fake|none|null|undefined|password|secret|todo|xxxx|<[^>]+>|\$\{|\{\{|env\()/i;
function isPlaceholder(v) {
  const s = String(v || "").trim();
  if (!s || PLACEHOLDER.test(s)) return true;
  if (/^(.)\1{3,}$/.test(s)) return true; // aaaa, 0000
  if (ENV_REF.test(s)) return true;
  return false;
}
// Entropía barata: exige mezcla de clases y variedad de caracteres (evita "abcdefghijkl" o un slug).
function highEntropy(v) {
  const s = String(v || "");
  if (s.length < 12) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  const variety = new Set(s).size / s.length;
  return (classes >= 3 && variety > 0.35) || (s.length >= 24 && classes >= 2 && variety > 0.45);
}

// Redacta el valor: el reporte va a la HU/ADO, el secreto NO puede viajar completo.
function redact(v) {
  const s = String(v || "");
  if (s.length <= 6) return "•••";
  return `${s.slice(0, 3)}…${s.slice(-2)} (${s.length} car.)`;
}
const lineOf = (text, idx) => text.slice(0, idx).split(/\n/).length;

/** Escanea UN texto y devuelve los hallazgos (con el valor ya redactado). Puro. */
export function scanText(text, file = "") {
  const found = [];
  const push = (rule, label, index, value, opaque) => {
    if (!opaque && value != null && isPlaceholder(value)) return;
    found.push({ rule, label, file, line: lineOf(text, index), preview: opaque ? "(bloque)" : redact(value) });
  };
  for (const R of RULES) {
    R.re.lastIndex = 0;
    let m;
    while ((m = R.re.exec(text))) {
      const value = R.opaque ? null : m[R.value != null ? R.value : 1] ?? m[0];
      push(R.rule, R.label, m.index, value, R.opaque);
    }
  }
  // KV con contexto de conexión.
  KV_RE.lastIndex = 0;
  let k;
  while ((k = KV_RE.exec(text))) {
    const lineStart = text.lastIndexOf("\n", k.index) + 1;
    const lineEnd = text.indexOf("\n", k.index);
    const lineTxt = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (KV_CONTEXT.test(lineTxt)) push("conn-kv", "Contraseña en una cadena de conexión", k.index, k[1]);
  }
  // Genérica de alta entropía.
  GENERIC_RE.lastIndex = 0;
  let g;
  while ((g = GENERIC_RE.exec(text))) {
    if (!isPlaceholder(g[1]) && highEntropy(g[1])) push("generic-assign", "Posible secreto asignado en el código", g.index, g[1]);
  }
  return found;
}

// Recorrido por defecto del repo (rutas relativas). Salta SKIP_DIRS, extensiones binarias y archivos grandes.
function defaultListFiles(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const out = [];
  const walk = (abs, rel, depth) => {
    if (out.length >= maxFiles || depth > 12) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(abs, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        if (SKIP_EXT.test(e.name) || SKIP_BASE.test(e.name)) continue;
        out.push(childRel);
      }
    }
  };
  walk(path.resolve(repoRoot), "", 0);
  return out;
}
function defaultReadFile(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  try {
    if (fs.statSync(abs).size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

// Ruta ignorada por el perfil (escape hatch para falsos positivos concretos). No es el camino normal:
// el escáner es autónomo; esto solo silencia rutas que el equipo sabe que no son secretos (fixtures).
function ignored(rel, ignore) {
  return (ignore || []).some((frag) => rel.includes(frag));
}

/**
 * Escanea el repo en busca de secretos quemados. `listFiles`/`readFile` inyectables → offline.
 * @returns {{status:"pass"|"fail", cases:object[], filesScanned:number, findings:object[]}}
 */
export function scanSecrets(repoRoot, opts = {}) {
  const { profile = {}, listFiles = defaultListFiles, readFile = defaultReadFile } = opts;
  const cfg = (profile.security && profile.security.secrets) || {};
  if (cfg.off === true) return { status: "pass", cases: [], filesScanned: 0, findings: [] };
  const files = listFiles(repoRoot, opts).filter((rel) => !ignored(rel, cfg.ignore));
  const findings = [];
  let scanned = 0;
  for (const rel of files) {
    const text = readFile(repoRoot, rel);
    if (text == null) continue;
    scanned++;
    for (const f of scanText(text, rel)) if (!ignored(f.file, cfg.ignore)) findings.push(f);
  }
  return { status: findings.length ? "fail" : "pass", cases: buildCases(findings, scanned), filesScanned: scanned, findings };
}

// Qué ES cada tipo de secreto, en lenguaje llano (por qué es peligroso). Compartido por las 4 rutas.
const RULE_PLAIN = {
  "private-key": "una LLAVE PRIVADA (de servidor SSH, TLS o firma) escrita dentro del repositorio. Quien la tenga puede suplantar al servidor o descifrar comunicaciones.",
  "aws-key": "una clave de acceso de AWS pegada en el código. Permite operar la cuenta de nube (crear recursos, leer datos, generar costos).",
  "gcp-key": "una clave de API de Google Cloud pegada en el código.",
  "github-token": "un token de acceso de GitHub pegado en el código. Da acceso a los repositorios de la organización.",
  "slack-token": "un token de Slack pegado en el código.",
  "stripe-key": "una clave SECRETA de Stripe (cobros reales) pegada en el código.",
  "openai-key": "una clave de API de OpenAI pegada en el código (uso facturable a nombre de la cuenta).",
  "conn-url": "la CONTRASEÑA de la base de datos escrita dentro de una cadena de conexión, en el código.",
  "conn-kv": "la CONTRASEÑA de la base de datos escrita dentro de una cadena de conexión, en el código.",
  "generic-assign": "un valor con pinta de credencial (clave/token/secreto) asignado directamente en el código, en vez de leerse de una variable de entorno.",
};

// Un caso POR TIPO de secreto (agrupado por regla, como las advertencias del linter): la explicación va
// una vez y las ocurrencias (ruta:línea + valor REDACTADO) quedan para los agentes de desarrollo.
function buildCases(findings, scanned) {
  if (!findings.length) {
    return [{
      name: "Credenciales quemadas en el código",
      status: "pass",
      message: `${scanned} archivo(s) revisado(s) con reglas de alta confianza.`,
      plain: `No se encontraron credenciales ni secretos escritos directamente en el código (contraseñas, llaves privadas, tokens de API, cadenas de conexión con contraseña). Se revisaron ${scanned} archivo(s). Es un escaneo automático de alta confianza: reduce el riesgo, no garantiza ausencia total.`,
    }];
  }
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  const cases = [];
  for (const [rule, hits] of byRule) {
    const locs = hits.map((h) => `${h.file}:${h.line} → ${h.preview}`);
    const where = locs.slice(0, 6).join(" · ") + (locs.length > 6 ? `, …(+${locs.length - 6})` : "");
    cases.push({
      name: hits[0].label,
      status: "fail",
      message: locs.join("\n"),
      plain: `Se encontró ${RULE_PLAIN[rule] || "un secreto escrito directamente en el código."} Apareció ${hits.length} vez/veces: ${where}.`,
      action: `Tratá esa credencial como COMPROMETIDA: rotala o invalidala YA. Sacala del código y leela de una variable de entorno o de un gestor de secretos. Y purgala del historial de git (borrarla en un commit nuevo NO la quita del historial).`,
    });
  }
  return cases;
}

export default { scanSecrets, scanText };
