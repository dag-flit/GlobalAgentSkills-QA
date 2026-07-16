// validate-project.mjs — valida que la ruta tecleada en "QA del código" apunte a un PROYECTO real
// antes de dejar avanzar al paso «Ejecutar». Sin red. Reúsa el confinamiento de local-source
// (base OPT-IN + rechazo de traversal) y agrega una heurística de "esto parece un repo" para que
// un texto cualquiera (p.ej. "X") NO pase el gate. El acceso a disco (fs) es inyectable → testeable.

import fs from "node:fs";
import { resolveLocalSource } from "./local-source.mjs";

// Archivos raíz que delatan un proyecto por stack (Node, Java, Go, Python, Rust, PHP, git, TS).
const MARKERS = [
  "package.json", "pom.xml", "build.gradle", "go.mod", "requirements.txt",
  "pyproject.toml", "Cargo.toml", "composer.json", ".git", "tsconfig.json", "Makefile",
];
// .NET/otros por extensión de archivo raíz (csproj/sln/fsproj).
const BY_EXT = /\.(csproj|sln|fsproj)$/i;

// ¿El directorio ya resuelto parece un proyecto? Devuelve {ok, marker} | {ok:false, reason}.
export function looksLikeProject(dir, io = fs) {
  let entries;
  try {
    entries = io.readdirSync(dir);
  } catch {
    return { ok: false, reason: "no se pudo leer el contenido de la carpeta" };
  }
  const set = new Set(entries);
  for (const m of MARKERS) if (set.has(m)) return { ok: true, marker: m };
  if (entries.some((e) => BY_EXT.test(e))) return { ok: true, marker: "proyecto .NET (.csproj/.sln)" };
  if (set.has("src")) return { ok: true, marker: "carpeta src/" };
  return {
    ok: false,
    reason: "no encontré señales de un proyecto (package.json, .csproj, pyproject.toml, go.mod, .git, src/, …)",
  };
}

/**
 * Resuelve + valida la ruta de código. Primero confina/resuelve (local-source), luego exige que
 * el directorio parezca un proyecto. Cualquier fallo → {ok:false, reason} accionable.
 * @param {object} opts
 * @param {string} opts.sourcePath  ruta tecleada (relativa a la base o directa)
 * @param {string} [opts.baseDir]   base permitida (default: env.CODE_QA_BASE_DIR)
 * @param {object} [opts.env]       entorno (lee CODE_QA_BASE_DIR)
 * @param {object} [opts.io]        acceso a fs inyectable (default: node:fs)
 * @returns {{ok:true, resolved:string, confined:boolean, marker:string} | {ok:false, reason:string, resolved?:string}}
 */
export function validateProjectPath({ sourcePath, baseDir, env, io = fs } = {}) {
  const src = resolveLocalSource({ sourcePath, baseDir, env });
  if (!src.ok) return { ok: false, reason: src.message };
  const proj = looksLikeProject(src.repoRoot, io);
  if (!proj.ok) {
    return { ok: false, reason: `La ruta existe pero no parece un proyecto: ${proj.reason}.`, resolved: src.repoRoot };
  }
  return { ok: true, resolved: src.repoRoot, confined: Boolean(src.confined), marker: proj.marker };
}

export default { validateProjectPath, looksLikeProject };
