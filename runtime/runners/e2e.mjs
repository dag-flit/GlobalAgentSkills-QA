// e2e.mjs — runner de la capa `e2e`. Ejecuta la suite end-to-end existente del repo
// (playwright/cypress) y emite el EvidenceObject normalizado al sink.
// Renombra el viejo `playwright-runner`: el tracker/PAT salen del flujo (los aporta el
// adapter ADO en F2, solo si el sink lo requiere). En local arranca sin preflight.

import { runLayer } from "./_runner-core.mjs";
import { parsePlaywright } from "./parse-cases.mjs";

// Prioridad fijada por qa-detect (playwright > cypress).
// playwright emite el detalle por TC con su reporter JSON nativo → parsePlaywright.
// cypress no trae JSON estándar a stdout: queda con el resumen de texto.
const TOOLS = {
  playwright: () => ({ argv: ["playwright", "test", "--reporter=json"], parseCases: parsePlaywright }),
  cypress: ["cypress", "run"],
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runE2eTests(opts = {}) {
  return runLayer({ layer: "e2e", tools: TOOLS, ...opts });
}

export default { runE2eTests };
