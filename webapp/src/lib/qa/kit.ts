import { pathToFileURL } from "node:url";
import { kitModule } from "@/lib/paths";

// Allowlist de los módulos del MOTOR que la webapp puede importar. Blinda contra que un
// specifier (si alguna vez llegara desde input) cargue código arbitrario del disco (RCE).
// Mantener sincronizada con los importKit() reales del código (búsqueda: importKit(").
const ALLOWED = new Set<string>([
  "core/tracker-adapter/index.mjs",
  "runtime/orchestrator.mjs",
  "runtime/profile/resolve-profile.mjs",
  "runtime/generate/ac-to-flow.mjs", // generador determinista AC→guion (autogen.ts)
  "runtime/generate/flow-planner.mjs", // planner IA (Ollama) con fallback determinista (autogen.ts)
  "runtime/generate/recon.mjs", // recon: captura el DOM de la app para el planner IA (runner.ts)
  "adapters/_shared/http-retry.mjs", // transporte HTTP endurecido para el planner (autogen.ts)
]);

/**
 * Importa un módulo del motor del kit (ESM .mjs) por ruta absoluta, solo si está en la
 * allowlist. Usa import dinámico nativo (webpackIgnore) para que Next NO bundlee los .mjs
 * del kit (tienen sus propios imports relativos).
 */
export async function importKit(rel: string): Promise<any> {
  if (!ALLOWED.has(rel)) {
    throw new Error(`Módulo del kit no permitido: ${rel}`);
  }
  const url = pathToFileURL(kitModule(rel)).href;
  return import(/* webpackIgnore: true */ url);
}
