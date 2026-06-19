// api.mjs — runner de la capa `api`. Ejecuta el contract testing existente.
// Hoy: colección Postman vía newman (`newman run <colección>`). El contrato OpenAPI
// sin runner estándar instalado se omite con aviso. Emite el EvidenceObject al sink.

import fs from "node:fs";
import path from "node:path";
import { runLayer } from "./_runner-core.mjs";

// Busca una colección Postman en la raíz y un nivel de subcarpetas (sin node_modules).
function findPostmanCollection(repoRoot) {
  const isColl = (n) => /\.postman_collection\.json$/i.test(n);
  let entries;
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && isColl(e.name)) return path.join(repoRoot, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const sub = path.join(repoRoot, e.name);
    let subEntries;
    try {
      subEntries = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const s of subEntries) if (s.isFile() && isColl(s.name)) return path.join(sub, s.name);
  }
  return null;
}

const TOOLS = {
  postman: ({ repoRoot }) => {
    const coll = findPostmanCollection(repoRoot);
    if (!coll) return { skip: "colección Postman detectada pero no localizada en raíz/subcarpeta" };
    return ["newman", "run", coll];
  },
  openapi: () => ({ skip: "contrato OpenAPI detectado: sin runner estándar instalado (pendiente schemathesis/dredd)" }),
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject} */
export function runApiTests(opts = {}) {
  return runLayer({ layer: "api", tools: TOOLS, ...opts });
}

export default { runApiTests };
