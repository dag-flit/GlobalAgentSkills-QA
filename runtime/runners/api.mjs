// api.mjs — runner de la capa `api`. Ejecuta el contract testing existente.
//  - postman → `newman run <colección>` (necesita la colección en el repo).
//  - openapi → validación de contrato OFFLINE con `@redocly/cli lint` vía npx
//    (local-first: cero-config, no requiere servidor vivo ni instalar nada; degrada a
//    skip si npx/red no están disponibles). El ruleset es configurable por perfil.
// Emite el EvidenceObject al sink.

import fs from "node:fs";
import path from "node:path";
import { runLayer } from "./_runner-core.mjs";

// Busca un archivo (por matcher) en la raíz y un nivel de subcarpetas (sin node_modules).
function findInRootOrSubdir(repoRoot, isMatch) {
  let entries;
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && isMatch(e.name)) return path.join(repoRoot, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const sub = path.join(repoRoot, e.name);
    let subEntries;
    try {
      subEntries = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of subEntries) if (s.isFile() && isMatch(s.name)) return path.join(sub, s.name);
  }
  return null;
}

const isPostman = (n) => /\.postman_collection\.json$/i.test(n);
const isOpenapi = (n) => /^(openapi|swagger)\.(ya?ml|json)$/i.test(n);

const TOOLS = {
  postman: ({ repoRoot }) => {
    const coll = findInRootOrSubdir(repoRoot, isPostman);
    if (!coll) return { skip: "colección Postman detectada pero no localizada en raíz/subcarpeta" };
    return ["newman", "run", coll];
  },
  // Validación de contrato OpenAPI sin servidor: `redocly lint`. Ruleset por perfil
  // (`api.openapi_ruleset`); por defecto `minimal` = solo conformidad con la spec (gate
  // de validez de contrato, sin opiniones de estilo). Se invoca vía npx para no exigir
  // que el proyecto preinstale la herramienta; si npx no resuelve, _runner-core degrada
  // a skip. (Contract testing contra servidor vivo —schemathesis/dredd— es otro modo,
  // no local-first: requiere la API corriendo; queda fuera de este runner offline.)
  openapi: ({ repoRoot, profile }) => {
    const spec = findInRootOrSubdir(repoRoot, isOpenapi);
    if (!spec) return { skip: "contrato OpenAPI detectado pero no localizado en raíz/subcarpeta" };
    const ruleset = profile?.api?.openapi_ruleset || "minimal";
    return ["npx", "--yes", "@redocly/cli@latest", "lint", spec, `--extends=${ruleset}`, "--format=stylish"];
  },
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runApiTests(opts = {}) {
  return runLayer({ layer: "api", tools: TOOLS, ...opts });
}

export default { runApiTests };
