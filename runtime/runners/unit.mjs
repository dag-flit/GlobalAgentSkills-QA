// unit.mjs — runner de la capa `unit`. Ejecuta los tests unitarios existentes del repo
// (vitest/jest/pytest/dotnet) y emite el EvidenceObject normalizado al sink.
// NO genera código ni se acopla a un stack: solo corre lo que ya existe (la generación
// de tests es del pack opcional dev-side, fuera del core QA).
//
// Deuda D1 cerrada: este runner NUNCA escribe en `Custom.Evidences` ni en ningún campo
// de tracker. Emite el objeto normalizado; el sink (local por defecto) decide el destino.

import { runLayer } from "./_runner-core.mjs";

// Prioridad fijada por qa-detect (vitest > jest > pytest > *.csproj).
const TOOLS = {
  vitest: ["vitest", "run"],
  jest: ["jest"],
  pytest: ["pytest"],
  "dotnet-test": ["dotnet", "test"],
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject} */
export function runUnitTests(opts = {}) {
  return runLayer({ layer: "unit", tools: TOOLS, ...opts });
}

export default { runUnitTests };
