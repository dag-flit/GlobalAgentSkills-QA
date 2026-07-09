// git-blame.mjs — atribución best-effort de un fallo a un desarrollador, por git blame del
// archivo/línea que aparece en el error. SOLO LECTURA: únicamente corre subcomandos git de
// lectura (rev-parse, ls-files, blame, log) en el repo probado, nunca escribe ni muta nada.
// El ejecutor `git` es INYECTABLE → el smoke corre sin lanzar procesos ni tocar un repo real.
//
// Encuadre honesto: devuelve "el último que MODIFICÓ ese archivo/línea", NO "el culpable de la
// falla" (el que tocó por última vez no siempre es la causa). La superficie lo rotula así.

import { spawnSync } from "node:child_process";

// Ejecutor git por defecto: read-only, con timeout, sin ventana. Nunca recibe subcomandos de
// escritura (los callers de este módulo solo pasan rev-parse/ls-files/blame/log).
function defaultGit(repoRoot, args) {
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function isoDate(unixSecs) {
  const n = Number(unixSecs);
  if (!isFinite(n)) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
const posixJoin = (a, b) => (a ? `${norm(a).replace(/\/+$/, "")}/${norm(b)}` : norm(b));

/** ¿repoRoot es un árbol de trabajo git? (best-effort). */
export function isGitRepo(repoRoot, { git = defaultGit } = {}) {
  const r = git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && /true/.test(r.stdout);
}

/**
 * Deriva el archivo (y línea, si la hay) a CULPAR desde un caso fallido, según lo que aparezca en
 * el error. Prioriza: (1) el `from "X"` de un import roto (archivo FUENTE), (2) el primer
 * archivo:línea del mensaje que NO sea de node_modules, (3) un archivo en el nombre del caso.
 * @returns {{file:string, line:number|null}|null}
 */
export function culpritRef(tc = {}) {
  const name = String(tc.name || "");
  const msg = String(tc.message || "");

  // (1) import roto: `from "components/.../X.tsx"` → el archivo fuente que hace el import.
  let m = msg.match(/from\s+["'`]([^"'`\s]+\.[A-Za-z0-9]+)["'`]/i);
  if (m) return { file: norm(m[1]), line: null };

  // (2)/(3) primer "archivo.ext:línea" que no sea dependencia, buscando en mensaje y luego nombre.
  const re = /([\w./\\-]+\.[A-Za-z0-9]+)(?::(\d+))?/g;
  for (const src of [msg, name]) {
    let mm;
    re.lastIndex = 0;
    while ((mm = re.exec(src))) {
      const f = mm[1];
      if (/node_modules|\.pnpm|\.next|dist\//i.test(f)) continue;
      if (!/\.(tsx?|jsx?|mjs|cjs|py|cs|go|rb|java|vue|svelte)$/i.test(f)) continue;
      return { file: norm(f), line: mm[2] ? Number(mm[2]) : null };
    }
  }
  return null;
}

/** blame de un path tracked (con línea → autor de esa línea; sin línea → último commit del archivo). */
function blamePath(repoRoot, file, line, git) {
  if (line) {
    const r = git(repoRoot, ["blame", "--porcelain", "-L", `${line},${line}`, "--", file]);
    if (r.code !== 0 || !r.stdout) return null;
    const a = r.stdout.match(/^author (.+)$/m);
    if (!a) return null;
    const e = r.stdout.match(/^author-mail <?([^>\n]*)>?$/m);
    const t = r.stdout.match(/^author-time (\d+)$/m);
    return { author: a[1].trim(), email: e ? e[1].trim() : null, date: t ? isoDate(t[1]) : null };
  }
  const r = git(repoRoot, ["log", "-1", "--format=%an%x00%ae%x00%at", "--", file]);
  if (r.code !== 0 || !r.stdout.trim()) return null;
  const [author, email, at] = r.stdout.trim().split("\0");
  if (!author) return null;
  return { author: author.trim(), email: (email || "").trim() || null, date: at ? isoDate(at) : null };
}

// Cuenta segmentos finales de ruta que coinciden (para elegir el mejor match por basename).
function trailOverlap(a, b) {
  const A = norm(a).split("/").reverse();
  const B = norm(b).split("/").reverse();
  let n = 0;
  while (n < A.length && n < B.length && A[n] === B[n]) n++;
  return n;
}

/** Resuelve el path realmente tracked por git para un ref (maneja cwd de la capa y rutas sucias). */
function resolveTrackedPath(repoRoot, ref, cwd, git) {
  const f = norm(ref.file);
  const direct = [];
  if (cwd && cwd !== ".") direct.push(posixJoin(cwd, f));
  direct.push(f);
  for (const d of [...new Set(direct)]) {
    const r = git(repoRoot, ["ls-files", "--error-unmatch", "--", d]);
    if (r.code === 0) return norm(d);
  }
  // Fallback por basename (rutas absolutas con espacios, prefijos raros): busca el archivo tracked
  // por su nombre y elige el que más comparte cola de ruta con lo extraído.
  const base = f.split("/").pop();
  if (!base) return null;
  const r = git(repoRoot, ["ls-files", "--", `**/${base}`, base]);
  const hits = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    return hits.map((h) => [trailOverlap(h, f), h]).sort((a, b) => b[0] - a[0])[0][1];
  }
  return null;
}

/**
 * Atribuye cada caso FALLIDO a su último autor y lo cuelga en `tc.blame = {author,email,date,file,line}`.
 * Best-effort y acotado: si el repo no es git, si no se resuelve el archivo, o si git falla, se omite
 * ese caso sin romper. `git` inyectable; `cwdOf(r)` devuelve el subdir de la capa (métricas).
 * @returns {{gitRepo:boolean, attributed:number, capped?:boolean}}
 */
export function attributeFailures(repoRoot, results = [], { git = defaultGit, max = 80 } = {}) {
  if (!isGitRepo(repoRoot, { git })) return { gitRepo: false, attributed: 0 };
  let attributed = 0;
  const attribute = (target, ref, cwd) => {
    if (!ref) return false;
    const path = resolveTrackedPath(repoRoot, ref, cwd, git);
    if (!path) return false;
    const info = blamePath(repoRoot, path, ref.line, git);
    if (!info) return false;
    target.blame = { ...info, file: path, line: ref.line };
    attributed++;
    return true;
  };
  for (const r of results) {
    const cwd = (r && r.metrics && r.metrics.cwd) || "";
    const cases = Array.isArray(r?.cases) ? r.cases : [];
    let anyFailCase = false;
    for (const tc of cases) {
      if (tc.status !== "fail") continue;
      anyFailCase = true;
      if (attributed >= max) return { gitRepo: true, attributed, capped: true };
      attribute(tc, culpritRef(tc), cwd);
    }
    // Fallo SIN caso fallido (caseless: tsc/redocly/dotnet…): intenta atribuir a nivel de capa
    // usando el archivo/línea que aparezca en la narrativa (si no hay, queda sin responsable).
    if (r && r.status === "fail" && !anyFailCase && attributed < max) {
      attribute(r, culpritRef({ name: r.layer, message: r.narrative || "" }), cwd);
    }
  }
  return { gitRepo: true, attributed };
}

export default { isGitRepo, culpritRef, attributeFailures };
