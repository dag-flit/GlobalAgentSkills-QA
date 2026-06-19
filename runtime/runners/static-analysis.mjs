// static-analysis.mjs — runner de la capa `static` (linter / type-checker).
// Detecta la herramienta (vía qa-detect) y emite el EvidenceObject normalizado.
// La mecánica (resolución de binario, ejecución, mapeo) vive en _runner-core.mjs.

import { runLayer } from "./_runner-core.mjs";

// El orden de prioridad ya lo fija qa-detect (eslint > tsc > ruff > mypy);
// aquí solo mapeamos cada herramienta a su invocación neutra.
const TOOLS = {
  eslint: ["eslint", "."],
  tsc: ["tsc", "--noEmit"],
  ruff: ["ruff", "check", "."],
  mypy: ["mypy", "."],
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runStaticAnalysis(opts = {}) {
  return runLayer({ layer: "static", tools: TOOLS, ...opts });
}

export default { runStaticAnalysis };
