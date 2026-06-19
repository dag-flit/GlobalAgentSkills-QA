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
  const pkgs = [];        // { dir, json } — package.json con SU directorio (monorepo-aware)

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
            const json = JSON.parse(fs.readFileSync(path.join(absDir, name), "utf8"));
            pkgs.push({ dir: relDir, json });
          } catch { /* package.json inválido: se ignora */ }
        }
      }
    }
  }

  walk(repoRoot, "", 0);
  return { files, dirs, pkgs };
}

// ── Soporte de workspaces (monorepo) ─────────────────────────────────────────
// El kit debe adaptarse a CUALQUIER proyecto: repo plano, o monorepo pnpm/yarn/npm
// donde las herramientas (vitest/playwright/tsc…) y sus binarios viven en un
// subpaquete (p.ej. `frontend/`), NO en la raíz. Para eso cada capa registra el
// directorio (`cwd`, relativo al repo) donde su herramienta fue detectada; el
// runner ejecuta ahí y resuelve el binario subiendo hasta la raíz.

function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

// Conjunto de directorios que contienen un package.json (siempre incluye la raíz "").
function pkgDirSetOf(pkgs) {
  const set = new Set([""]);
  for (const p of pkgs) set.add(p.dir);
  return set;
}

// Paquete "dueño" de un directorio: el package.json más profundo que lo contiene.
function ownerPkgDir(dir, pkgDirSet) {
  let cur = dir;
  while (true) {
    if (pkgDirSet.has(cur)) return cur;
    if (cur === "") return "";
    cur = dirOf(cur);
  }
}

// Recorta el scan a UN paquete: sus archivos (relativos al paquete) y su package.json.
// Permite detectar capas "como si" el subpaquete fuese un repo aparte → ubica la capa.
function buildScope(scan, scopeDir, pkgDirSet) {
  const prefix = scopeDir ? scopeDir + "/" : "";
  const files = [];
  const dirs = new Set();
  for (const f of scan.files) {
    if (ownerPkgDir(dirOf(f), pkgDirSet) !== scopeDir) continue;
    const rel = scopeDir ? f.slice(prefix.length) : f;
    files.push(rel);
    const segs = rel.split("/");
    for (let i = 0; i < segs.length - 1; i++) dirs.add(segs[i].toLowerCase());
  }
  const pkgs = scan.pkgs.filter((p) => p.dir === scopeDir).map((p) => p.json);
  return { files, dirs, pkgs };
}

function depthOf(dir) {
  return dir === "" ? 0 : dir.split("/").length;
}

// ¿`a` es ancestro de `b`? (raíz "" es ancestro de todo lo demás)
function isAncestorDir(a, b) {
  if (a === b) return false;
  if (a === "") return true;
  return b.startsWith(a + "/");
}

// Colapsa objetivos: para una MISMA herramienta, descarta el cwd que es ancestro de
// otro (dep hoisteada en raíz + config en subpaquete → conserva el subpaquete). Mantiene
// herramientas DISTINTAS y paquetes hermanos (vitest@web + jest@api conviven).
function collapseTargets(targets) {
  const out = [];
  for (const t of targets) {
    const dominated = targets.some(
      (o) => o !== t && o.tool === t.tool && isAncestorDir(t.cwd, o.cwd)
    );
    if (dominated) continue;
    if (!out.some((o) => o.tool === t.tool && o.cwd === t.cwd)) out.push(t);
  }
  return out;
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

// lee pyproject.toml de un directorio si existe, para detectar [tool.ruff] etc.
function readPyproject(dir) {
  const p = path.join(dir, "pyproject.toml");
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
    // Un contrato no siempre se llama openapi.yaml: equipos lo versionan (core-api.v1.yaml)
    // y lo guardan en una carpeta `openapi/` (p.ej. contracts/openapi/). Cualquier .yaml/.json
    // que viva DENTRO de un directorio `openapi/` es, por convención, un contrato OpenAPI.
    if (!tool && m.hasPath(/(^|\/)openapi\/[^/]+\.(ya?ml|json)$/)) { tool = "openapi"; signals.push("contrato en openapi/"); }
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

  // security — ZERO-CONFIG: corre en CUALQUIER repo con código, sin exigir `.semgrep.yml`.
  // Config explícita (.semgrep / bandit) tiene prioridad; si no hay señal, se elige el
  // escáner por stack: bandit (offline) para Python, semgrep (ruleset `auto`) para el resto.
  // El runner degrada a skip si el escáner no está instalado (igual que `api` con redocly).
  {
    const signals = [];
    let tool = null;
    if (m.hasBase(/^\.?semgrep\.ya?ml$/) || m.hasDir(".semgrep")) { tool = "semgrep"; signals.push("semgrep config"); }
    if (m.hasBase(/^\.bandit$/) || m.hasDep("bandit") || /\[tool\.bandit\]/.test(pyproject)) { tool = tool || "bandit"; signals.push("bandit config"); }
    if (!tool) {
      const isPython = m.hasBase(/^(pyproject\.toml|requirements\.txt|setup\.py|setup\.cfg)$/) || pyproject.length > 0;
      tool = isPython ? "bandit" : "semgrep";
      signals.push("zero-config");
    }
    layers.security = { enabled: true, tool, signals };
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
  // Detección GLOBAL (mezcla todos los package.json): determina qué capa enciende y
  // con qué herramienta. Idéntica al comportamiento previo → no cambia la selección.
  const jsonPkgs = scan.pkgs.map((p) => p.json);
  const m = makeMatchers({ files: scan.files, dirs: scan.dirs, pkgs: jsonPkgs });
  m.pkgsExist = jsonPkgs.length > 0;
  const pyproject = readPyproject(repoRoot);

  const layers = detectLayers(m, pyproject);
  const stack = detectStack(m);
  const architecture = detectArchitecture(stack, layers, scan.pkgs.length);

  // Detección por PAQUETE (workspace-aware): "como si" cada subpaquete fuese un repo,
  // para ubicar DÓNDE vive la herramienta de cada capa (monorepo pnpm/yarn/npm).
  const pkgDirSet = pkgDirSetOf(scan.pkgs);
  const scopeDetections = [...pkgDirSet].sort().map((dir) => {
    const scope = buildScope(scan, dir, pkgDirSet);
    const sm = makeMatchers(scope);
    sm.pkgsExist = scope.pkgs.length > 0;
    return { dir, layers: detectLayers(sm, readPyproject(path.join(repoRoot, dir))) };
  });

  // Cada capa encendida recibe `targets`: UN objetivo por (herramienta, paquete) donde la
  // capa enciende. Así un monorepo corre `unit` en TODOS sus paquetes (vitest@frontend +
  // dotnet-test@backend), no solo el de mayor prioridad. Repo plano → un único target cwd "".
  for (const layer of ALL_LAYERS) {
    if (!layers[layer].enabled) { layers[layer].cwd = ""; layers[layer].targets = []; continue; }
    const raw = [];
    for (const sd of scopeDetections) {
      const ls = sd.layers[layer];
      if (ls?.enabled) raw.push({ tool: ls.tool, cwd: sd.dir, signals: ls.signals || [] });
    }
    let targets = collapseTargets(raw);
    // Defensa: si ningún scope reprodujo la detección global, usa el global como único target.
    if (!targets.length) targets = [{ tool: layers[layer].tool, cwd: "", signals: layers[layer].signals || [] }];
    targets.sort((a, b) => (a.cwd === b.cwd ? a.tool.localeCompare(b.tool) : a.cwd.localeCompare(b.cwd)));
    layers[layer].targets = targets;
    // Primario (compat con lectores de `.tool`/`.cwd`): el objetivo de la herramienta global,
    // el más profundo; si no aparece, el primero.
    const primary =
      targets.filter((t) => t.tool === layers[layer].tool).sort((a, b) => depthOf(b.cwd) - depthOf(a.cwd))[0] ||
      targets[0];
    layers[layer].tool = primary.tool;
    layers[layer].cwd = primary.cwd;
  }

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
