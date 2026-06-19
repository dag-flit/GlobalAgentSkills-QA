// qa-detect.mjs — detección de capas/stack a partir del repo (local-first, sin red).
// Hace que `testing.layers_enabled: auto` encienda SOLO las capas cuya herramienta existe.
// Pura: recibe repoRoot, escanea el árbol (acotado) y devuelve un objeto normalizado.
// Cross-platform, Node puro, CERO literales de dominio.
//
// Uso:
//   import { detectRepo, resolveEnabledLayers } from "./qa-detect.mjs";
//   const detection = detectRepo({ repoRoot: process.cwd() });
//   const layers = resolveEnabledLayers(profile, detection);

import fs from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "bin", "obj", ".venv", "venv", "__pycache__", "vendor", ".turbo", ".cache",
]);

const ALL_LAYERS = ["static", "unit", "api", "e2e", "db", "security"];

// ── Walker acotado ──────────────────────────────────────────────────────────
// Recolecta rutas relativas (posix), nombres de carpeta y los package.json.
function scanRepo(repoRoot, { maxDepth = 5 } = {}) {
  const files = [];      // rutas relativas posix, p.ej. "tests/login.spec.ts"
  const dirs = new Set(); // nombres de carpeta vistos, p.ej. "migrations"
  const pkgs = [];        // contenidos parseados de cada package.json

  function walk(absDir, relDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (ent.isDirectory()) {
        // saltar ruido y carpetas ocultas, salvo señales útiles (.semgrep)
        const hidden = name.startsWith(".") && name !== ".semgrep";
        if (IGNORE_DIRS.has(name) || hidden) continue;
        dirs.add(name.toLowerCase());
        walk(path.join(absDir, name), rel, depth + 1);
      } else if (ent.isFile()) {
        files.push(rel);
        if (name === "package.json") {
          try {
            pkgs.push(JSON.parse(fs.readFileSync(path.join(absDir, name), "utf8")));
          } catch { /* package.json inválido: se ignora */ }
        }
      }
    }
  }

  walk(repoRoot, "", 0);
  return { files, dirs, pkgs };
}

// ── Utilidades de coincidencia ───────────────────────────────────────────────
function basename(p) {
  const i = p.lastIndexOf("/");
  return (i >= 0 ? p.slice(i + 1) : p).toLowerCase();
}

function makeMatchers({ files, dirs, pkgs }) {
  const bases = files.map(basename);
  const lowerFiles = files.map((f) => f.toLowerCase());

  // dependencias mezcladas de todos los package.json (root + monorepo)
  const deps = {};
  for (const pkg of pkgs) {
    for (const block of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (pkg && pkg[block]) Object.assign(deps, pkg[block]);
    }
  }
  const pkgKeys = new Set(); // claves de primer nivel (jest, etc.)
  for (const pkg of pkgs) for (const k of Object.keys(pkg || {})) pkgKeys.add(k);

  return {
    hasDep: (name) => Object.prototype.hasOwnProperty.call(deps, name),
    hasPkgKey: (k) => pkgKeys.has(k),
    hasBase: (re) => bases.some((b) => re.test(b)),
    hasDir: (name) => dirs.has(name.toLowerCase()),
    hasPath: (re) => lowerFiles.some((f) => re.test(f)),
    deps,
  };
}

// lee pyproject.toml del root si existe, para detectar [tool.ruff] etc.
function readPyproject(repoRoot) {
  const p = path.join(repoRoot, "pyproject.toml");
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

// ── Detección de stack ───────────────────────────────────────────────────────
function detectStack(m) {
  // backend: prioridad determinista para un valor escalar
  let backend = "none";
  if (m.hasBase(/\.(csproj|sln)$/)) backend = "dotnet";
  else if (m.pkgsExist || m.hasBase(/^package\.json$/)) backend = "node";
  else if (m.hasBase(/^(pyproject\.toml|requirements\.txt|setup\.py|setup\.cfg)$/)) backend = "python";
  else if (m.hasBase(/^(pom\.xml|build\.gradle(\.kts)?)$/)) backend = "java";
  else if (m.hasBase(/^go\.mod$/)) backend = "go";

  let frontend = "none";
  if (m.hasDep("react") || m.hasDep("next")) frontend = "react";
  else if (m.hasDep("vue") || m.hasDep("nuxt")) frontend = "vue";
  else if (m.hasDep("@angular/core") || m.hasBase(/^angular\.json$/)) frontend = "angular";

  let db = "none";
  if (m.hasDep("pg") || m.hasDep("postgres") || m.hasDep("psycopg2") ||
      m.hasDep("psycopg2-binary") || m.hasDep("Npgsql")) db = "postgres";
  else if (m.hasDep("mysql") || m.hasDep("mysql2") || m.hasDep("pymysql")) db = "mysql";
  else if (m.hasDep("sqlite3") || m.hasDep("better-sqlite3")) db = "sqlite";

  return { backend, frontend, db };
}

function detectArchitecture(stack, layers, pkgCount) {
  if (pkgCount > 1) return "microservices";
  if (stack.frontend !== "none" && stack.backend === "none") return "react-spa";
  if (stack.backend !== "none" && stack.frontend === "none" && layers.api.enabled) return "api-rest";
  return "monolith";
}

// ── Detección por capa ───────────────────────────────────────────────────────
// Cada detector devuelve { enabled, tool, signals } y, si no enciende, una razón.
function detectLayers(m, pyproject) {
  const layers = {};

  // static — linters / type-checkers
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^\.eslintrc(\.(js|cjs|json|ya?ml))?$/) || m.hasBase(/^eslint\.config\.(js|mjs|cjs|ts)$/) || m.hasDep("eslint")) {
      tool = "eslint"; signals.push("eslint");
    }
    if (m.hasBase(/^tsconfig\.json$/)) { tool = tool || "tsc"; signals.push("tsconfig.json"); }
    if (m.hasBase(/^\.?ruff\.toml$/) || /\[tool\.ruff\]/.test(pyproject) || m.hasDep("ruff")) {
      tool = tool || "ruff"; signals.push("ruff");
    }
    if (m.hasBase(/^\.?mypy\.ini$/) || /\[tool\.mypy\]/.test(pyproject)) { tool = tool || "mypy"; signals.push("mypy"); }
    layers.static = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin linter/type-checker (eslint/ruff/tsc/mypy)" };
  }

  // unit
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^vitest\.config\.(js|mjs|cjs|ts|mts)$/) || m.hasDep("vitest")) { tool = "vitest"; signals.push("vitest"); }
    if (m.hasBase(/^jest\.config\.(js|cjs|mjs|ts|json)$/) || m.hasDep("jest") || m.hasPkgKey("jest")) { tool = tool || "jest"; signals.push("jest"); }
    if (m.hasBase(/^pytest\.ini$/) || m.hasBase(/^conftest\.py$/) || /\[tool\.pytest/.test(pyproject)) { tool = tool || "pytest"; signals.push("pytest"); }
    if (m.hasPath(/test.*\.csproj$/) || m.hasDep("xunit") || m.hasBase(/^.*tests?\.csproj$/)) { tool = tool || "dotnet-test"; signals.push("*.csproj (test)"); }
    layers.unit = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin runner unit (vitest/jest/pytest/*.csproj)" };
  }

  // api
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^(openapi|swagger)\.(ya?ml|json)$/)) { tool = "openapi"; signals.push("openapi/swagger"); }
    if (m.hasBase(/\.postman_collection\.json$/)) { tool = tool || "postman"; signals.push("postman collection"); }
    layers.api = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin contrato API (openapi/postman)" };
  }

  // e2e
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^playwright\.config\.(js|mjs|cjs|ts)$/) || m.hasDep("@playwright/test")) { tool = "playwright"; signals.push("playwright"); }
    if (m.hasBase(/^cypress\.config\.(js|mjs|cjs|ts)$/) || m.hasDep("cypress")) { tool = tool || "cypress"; signals.push("cypress"); }
    layers.e2e = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin runner e2e (playwright/cypress)" };
  }

  // db — se prefiere una herramienta EJECUTABLE (pgtap/prisma) sobre el directorio
  // migrations/ suelto (que es señal pero no tiene runner universal).
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/\.pgtap$/) || m.hasDep("pgtap")) { tool = "pgtap"; signals.push("pgtap"); }
    if (m.hasPath(/prisma\/schema\.prisma$/)) { tool = tool || "prisma"; signals.push("prisma"); }
    if (m.hasDep("testcontainers")) { tool = tool || "testcontainers"; signals.push("testcontainers"); }
    if (m.hasDir("migrations")) { tool = tool || "migrations"; signals.push("migrations/"); }
    layers.db = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin migraciones/pgtap/testcontainers" };
  }

  // security
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^\.?semgrep\.ya?ml$/) || m.hasDir(".semgrep")) { tool = "semgrep"; signals.push("semgrep"); }
    if (m.hasBase(/^\.bandit$/) || m.hasDep("bandit") || /\[tool\.bandit\]/.test(pyproject)) { tool = tool || "bandit"; signals.push("bandit"); }
    layers.security = signals.length
      ? { enabled: true, tool, signals }
      : { enabled: false, tool: null, signals: [], reason: "sin escáner (semgrep/bandit)" };
  }

  return layers;
}

/**
 * Detecta capas y stack del repo.
 * @param {object} opts
 * @param {string} opts.repoRoot  raíz del repo a inspeccionar
 * @returns {{stack, architecture, layers, enabled: string[], skipped: {layer,reason}[]}}
 */
export function detectRepo({ repoRoot = process.cwd() } = {}) {
  const scan = scanRepo(repoRoot);
  const m = makeMatchers(scan);
  m.pkgsExist = scan.pkgs.length > 0;
  const pyproject = readPyproject(repoRoot);

  const layers = detectLayers(m, pyproject);
  const stack = detectStack(m);
  const architecture = detectArchitecture(stack, layers, scan.pkgs.length);

  const enabled = ALL_LAYERS.filter((l) => layers[l].enabled);
  const skipped = ALL_LAYERS
    .filter((l) => !layers[l].enabled)
    .map((l) => ({ layer: l, reason: layers[l].reason }));

  return { stack, architecture, layers, enabled, skipped };
}

/**
 * Reconcilia la detección con el perfil: `auto` usa lo detectado; un valor
 * explícito SOBRESCRIBE (principio 2 — la config explícita gana).
 * @param {object} profile  perfil resuelto
 * @param {object} detection  salida de detectRepo()
 * @returns {{enabled: string[], source: "auto"|"profile"}}
 */
export function resolveEnabledLayers(profile, detection) {
  const declared = profile?.testing?.layers_enabled;
  if (Array.isArray(declared)) {
    return { enabled: declared.filter((l) => ALL_LAYERS.includes(l)), source: "profile" };
  }
  // "auto" (o ausente) → lo detectado
  return { enabled: detection.enabled, source: "auto" };
}

export const LAYERS = ALL_LAYERS;
export default { detectRepo, resolveEnabledLayers, LAYERS };
