// bdd.mjs — runner de la capa `bdd` (especificaciones ejecutables / Gherkin, Ruta B).
// Ejecuta los archivos `.feature` con el framework BDD detectado. En esta fase: Cucumber.js
// (JS/TS, +Playwright para los steps web). Emite el EvidenceObject normalizado; cada Scenario = un
// caso. pytest-bdd / behave / Reqnroll llegan en fases siguientes (B4).
//
// B2: la librería de step-definitions del kit (bdd/steps/) se MATERIALIZA en qa-generated/bdd/steps/
// del proyecto (donde sí viven @cucumber/cucumber y playwright) y se carga con `--import`, junto a
// los steps PROPIOS del proyecto (convención bdd/steps · tests/bdd/steps · features/steps · …).
//
// Local-first: si no hay `.feature`, o el runner BDD no está instalado, _runner-core degrada a skip
// (nunca rompe el ciclo). Ejecutor inyectable → offline-testable.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLayer } from "./_runner-core.mjs";
import { parseCucumber } from "./parse-cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // runtime/runners/
const KIT_STEPS = path.resolve(HERE, "..", "..", "bdd", "steps"); // <kit>/bdd/steps

// Versión PINEADA de cucumber para el modo on-demand (F2: nunca `@latest`). Major estable;
// el perfil puede fijar un pin exacto vía bdd.cucumber_pkg.
const CUCUMBER_PKG = "@cucumber/cucumber@11";

const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "bin", "obj", ".venv", "venv", "__pycache__", "vendor", ".turbo", ".cache",
]);

// Directorios (relativos al repo, posix) que contienen al menos un `.feature`. Acotado, sin ruido.
function featureDirs(repoRoot, maxDepth = 6) {
  const dirs = new Set();
  function walk(absDir, relDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    let hasFeature = false;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
        walk(path.join(absDir, e.name), relDir ? `${relDir}/${e.name}` : e.name, depth + 1);
      } else if (e.isFile() && /\.feature$/i.test(e.name)) {
        hasFeature = true;
      }
    }
    if (hasFeature) dirs.add(relDir || ".");
  }
  walk(repoRoot, "", 0);
  return [...dirs].sort();
}

// Materializa la librería de steps del kit en <baseDir>/qa-generated/bdd/steps/ para que Cucumber
// (corriendo en el proyecto) la cargue resolviendo @cucumber/cucumber y playwright del proyecto.
// Devuelve el directorio destino (absoluto) o null si no hay fuente.
function ensureCoreSteps(baseDir) {
  let files;
  try {
    files = fs.readdirSync(KIT_STEPS).filter((f) => f.endsWith(".mjs"));
  } catch {
    return null;
  }
  if (!files.length) return null;
  const dest = path.join(baseDir, "qa-generated", "bdd", "steps");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    try {
      fs.copyFileSync(path.join(KIT_STEPS, f), path.join(dest, f));
    } catch {
      /* best-effort: un archivo que no copia no debe romper la corrida */
    }
  }
  return dest;
}

// Directorios de steps PROPIOS del proyecto (convención), si existen → se cargan junto al core.
function projectStepDirs(repoRoot) {
  const cands = ["bdd/steps", "qa-bdd/steps", "tests/bdd/steps", "features/steps", "features/support"];
  const out = [];
  for (const c of cands) {
    const abs = path.join(repoRoot, c);
    try {
      if (fs.statSync(abs).isDirectory()) out.push(abs);
    } catch {
      /* no existe: se omite */
    }
  }
  return out;
}

// ¿el proyecto tiene Cucumber instalado? (sube desde startDir mirando node_modules/@cucumber/cucumber).
function hasLocalCucumber(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "node_modules", "@cucumber", "cucumber"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// Glob posix (cross-platform para cucumber) de los .mjs de un directorio.
const toGlob = (dir) => dir.replace(/\\/g, "/") + "/**/*.mjs";

const TOOLS = {
  // Cucumber.js: ejecuta los `.feature` cargando la librería de steps (kit + proyecto) y emite JSON
  // (formato clásico) para extraer los Scenarios. El flag exacto del formateador puede variar por
  // versión; `parseCucumber` tolera el JSON clásico.
  //
  // B2.5 (sin sesgo, mínimas limitaciones): el proyecto NO tiene que preinstalar nada.
  //   - si el proyecto YA tiene cucumber → se usa el suyo (más rápido).
  //   - si no → el KIT lo trae ON-DEMAND con `npx --yes --package @cucumber/cucumber` (mismo patrón
  //     que la capa `api` con redocly). NODE_PATH (en runBddTests) ayuda a resolver los imports de
  //     los steps. Si está offline sin caché, _runner-core degrada a skip (no rompe el ciclo).
  cucumber: ({ repoRoot, profile }) => {
    const dirs = featureDirs(repoRoot);
    if (!dirs.length) return { skip: "BDD detectado pero sin archivos .feature en el repo" };
    const globs = dirs.map((d) => (d === "." ? "**/*.feature" : `${d}/**/*.feature`));

    // Steps: librería del kit (materializada) + steps propios del proyecto.
    const importDirs = [];
    const core = ensureCoreSteps(repoRoot);
    if (core) importDirs.push(core);
    importDirs.push(...projectStepDirs(repoRoot));
    const importArgs = importDirs.flatMap((d) => ["--import", toGlob(d)]);

    const tail = [...globs, ...importArgs, "--format", "json"];
    // Pin de versión (F2): nunca `@latest`. Major estable, sobreescribible por perfil
    // (bdd.cucumber_pkg). Si el proyecto ya tiene cucumber, se usa el suyo (sin npx).
    const pkg = profile?.bdd?.cucumber_pkg || CUCUMBER_PKG;
    const argv = hasLocalCucumber(repoRoot)
      ? ["cucumber-js", ...tail]
      : ["npx", "--yes", "--package", pkg, "cucumber-js", ...tail];

    return { argv, parseCases: parseCucumber };
  },
  // Fases siguientes (B4): por ahora skip accionable para no romper en stacks no-JS.
  "pytest-bdd": () => ({ skip: "pytest-bdd/behave aún no soportado en esta fase (llega en B4)" }),
  reqnroll: () => ({ skip: "Reqnroll/.NET aún no soportado en esta fase (llega en B4)" }),
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runBddTests(opts = {}) {
  // B2.5: NODE_PATH incluye el node_modules del KIT para que los imports de los steps
  // (@cucumber/cucumber, playwright) resuelvan cuando el proyecto no los trae (runtime del kit /
  // cacheado). No exige nada al proyecto; si el path no existe es inofensivo.
  const kitNm = path.resolve(HERE, "..", "..", "node_modules");
  const prevNodePath = (opts.env && opts.env.NODE_PATH) || process.env.NODE_PATH || "";
  const env = { ...(opts.env || {}), NODE_PATH: [kitNm, prevNodePath].filter(Boolean).join(path.delimiter) };
  return runLayer({ layer: "bdd", tools: TOOLS, ...opts, env });
}

export default { runBddTests };
