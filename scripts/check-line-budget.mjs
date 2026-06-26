#!/usr/bin/env node
// Guardrail de la regla dura del proyecto: ningún archivo de código supera 400 líneas.
// Recorre el repo (excluyendo dependencias y artefactos), cuenta líneas de cada
// .mjs/.ts/.tsx y FALLA (exit 1) si algún archivo NO permitido supera el límite.
//
// La ALLOWLIST es temporal: lista los archivos que YA violaban la regla al fijarla.
// Cada fase del plan multitenant la va vaciando hasta dejarla en cero.
//
// Uso:
//   node scripts/check-line-budget.mjs                 # todo el repo
//   node scripts/check-line-budget.mjs engine          # solo el motor (core/runtime/adapters/bdd)
//   node scripts/check-line-budget.mjs webapp          # solo webapp/src
//
// Cross-platform, sin dependencias (Node puro). Exit 0 = OK, 1 = violación, 2 = error de uso.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIMIT = 400;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Directorios que nunca se analizan (dependencias, builds, datos, fixtures).
const IGNORED_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "qa-evidence", "qa-generated",
  "data", "coverage", ".turbo",
]);
// Sub-rutas (relativas al repo) que se excluyen aunque contengan código.
const IGNORED_PREFIXES = [
  path.join("webapp", "test", "fixtures"),
];
const CODE_EXT = new Set([".mjs", ".ts", ".tsx"]);

// Scopes: subconjuntos del repo para correr el guardrail por capa.
const SCOPES = {
  all: ["core", "runtime", "adapters", "bdd", "scripts", path.join("webapp", "src")],
  engine: ["core", "runtime", "adapters", "bdd"],
  webapp: [path.join("webapp", "src")],
};

// ALLOWLIST temporal: archivos que YA superaban 400 líneas al fijar la regla (2026-06-25).
// Rutas relativas al repo, con separador POSIX. VACÍA: la deuda preexistente se saldó
// (los 3 componentes webapp se partieron en el refactor JIT de F5).
export const ALLOWLIST = new Set([]);

function toPosix(rel) {
  return rel.split(path.sep).join("/");
}

function isIgnored(rel) {
  return IGNORED_PREFIXES.some((p) => rel === p || rel.startsWith(p + path.sep));
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(REPO_ROOT, full);
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      if (isIgnored(rel)) continue;
      yield* walk(full);
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
      if (isIgnored(rel)) continue;
      yield full;
    }
  }
}

function countLines(file) {
  const buf = fs.readFileSync(file, "utf8");
  if (buf === "") return 0;
  // Líneas físicas: nº de saltos + 1 (salvo que termine en salto).
  let n = 1;
  for (let i = 0; i < buf.length; i++) if (buf.charCodeAt(i) === 10) n++;
  if (buf.charCodeAt(buf.length - 1) === 10) n--;
  return n;
}

/** Analiza un scope y devuelve {violations, allowlisted, scanned}. */
export function analyze(scope = "all") {
  const roots = SCOPES[scope];
  if (!roots) throw new Error(`scope desconocido: ${scope}`);
  const violations = [];
  const allowlisted = [];
  let scanned = 0;
  for (const root of roots) {
    const base = path.join(REPO_ROOT, root);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      scanned++;
      const lines = countLines(file);
      if (lines <= LIMIT) continue;
      const rel = toPosix(path.relative(REPO_ROOT, file));
      if (ALLOWLIST.has(rel)) allowlisted.push({ rel, lines });
      else violations.push({ rel, lines });
    }
  }
  violations.sort((a, b) => b.lines - a.lines);
  allowlisted.sort((a, b) => b.lines - a.lines);
  return { violations, allowlisted, scanned };
}

function main() {
  const scope = process.argv[2] || "all";
  if (!SCOPES[scope]) {
    console.error(`Uso: node scripts/check-line-budget.mjs [all|engine|webapp]`);
    process.exit(2);
  }
  const { violations, allowlisted, scanned } = analyze(scope);
  console.log(`check-line-budget · scope=${scope} · ${scanned} archivos · límite ${LIMIT} líneas`);
  if (allowlisted.length) {
    console.log(`\nDeuda conocida (allowlist, ${allowlisted.length}):`);
    for (const v of allowlisted) console.log(`  ~ ${v.lines}\t${v.rel}`);
  }
  if (violations.length) {
    console.log(`\n✗ VIOLACIONES NUEVAS (${violations.length}):`);
    for (const v of violations) console.log(`  ✗ ${v.lines}\t${v.rel}`);
    console.log(`\nPartí el/los archivo(s) por responsabilidad antes de continuar.`);
    process.exit(1);
  }
  console.log(`\n✓ Sin violaciones nuevas.`);
  process.exit(0);
}

// Ejecutar solo si es el entrypoint (permite importar analyze() desde el smoke test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
