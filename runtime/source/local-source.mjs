// local-source.mjs — resuelve la ruta local del repo a analizar en el modo "QA del código".
// Sin red. El confinamiento es OPT-IN por el operador:
//   • CON `CODE_QA_BASE_DIR` definido → Mitigación 1 (confinamiento): la ruta se resuelve DENTRO
//     de esa base y se rechaza cualquier escape (../, absoluta fuera, symlink que salga). Se
//     comparan RUTAS REALES (realpath) → un enlace simbólico no burla la cerca. Apto para un
//     server multitenant compartido: cada corrida solo puede tocar repos dentro de la base.
//   • SIN base definida → RUTA DIRECTA: se acepta la carpeta tecleada tal cual (como el módulo
//     antiguo). Pensado para un server de un solo operador. La cerca queda como decisión suya.
// Mitigación 2 (allowlist + timeout de exec, en exec-sandbox.mjs) sigue SIEMPRE activa en AMBOS
// modos: aunque uses ruta directa, el repo solo puede lanzar las herramientas de QA conocidas.

import fs from "node:fs";
import path from "node:path";

// Valida que una ruta real exista y sea un directorio → resultado ok normalizado.
function asRepo(real, extra) {
  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return { ok: false, message: `ruta no accesible: ${real}` };
  }
  if (!st.isDirectory()) {
    return { ok: false, message: `la ruta no es un directorio de repo: ${real}` };
  }
  return { ok: true, repoRoot: real, ...extra };
}

/**
 * Resuelve la ruta de código a analizar. Confina a la base si el operador la definió; si no,
 * acepta la ruta directa (server de un solo operador).
 * @param {object} opts
 * @param {string} opts.sourcePath   carpeta del repo (relativa a la base, o ruta directa)
 * @param {string} [opts.baseDir]    directorio base permitido (default: env.CODE_QA_BASE_DIR)
 * @param {object} [opts.env]        entorno para leer CODE_QA_BASE_DIR
 * @returns {{ok:true, repoRoot:string, baseDir:string|null, relPath:string|null, confined:boolean}
 *           | {ok:false, message:string}}
 */
export function resolveLocalSource({ sourcePath, baseDir, env = process.env } = {}) {
  const base = baseDir || env?.CODE_QA_BASE_DIR;
  if (!sourcePath || typeof sourcePath !== "string" || !sourcePath.trim()) {
    return { ok: false, message: "ruta de código vacía: indicá la carpeta del repo a analizar." };
  }

  // ── Sin base: RUTA DIRECTA (comportamiento del módulo antiguo) ──────────────
  // El operador no puso cerca → se confía en la ruta tecleada. Se resuelve relativa a la cwd del
  // server si no es absoluta; solo se valida que exista y sea un directorio.
  if (!base) {
    let real;
    try {
      real = fs.realpathSync(path.resolve(sourcePath));
    } catch {
      return { ok: false, message: `la ruta no existe: ${sourcePath}` };
    }
    return asRepo(real, { baseDir: null, relPath: null, confined: false });
  }

  // ── Con base: CONFINAMIENTO (multitenant-seguro) ────────────────────────────
  let baseReal;
  try {
    baseReal = fs.realpathSync(path.resolve(base));
  } catch {
    return { ok: false, message: `CODE_QA_BASE_DIR no existe o no es accesible: ${base}` };
  }
  // path.resolve respeta una ruta absoluta; el confinamiento de abajo la rechaza si cae fuera.
  const candidate = path.resolve(baseReal, sourcePath);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { ok: false, message: `la ruta no existe dentro del directorio base: ${sourcePath}` };
  }
  const rel = path.relative(baseReal, real);
  if (rel !== "" && (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))) {
    return { ok: false, message: `ruta fuera del directorio permitido (posible traversal/symlink): ${sourcePath}` };
  }
  return asRepo(real, { baseDir: baseReal, relPath: rel || ".", confined: true });
}

export default { resolveLocalSource };
