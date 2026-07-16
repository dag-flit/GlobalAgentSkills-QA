import { pathToFileURL } from "node:url";
import { kitModule } from "@/lib/paths";

// Allowlist de los módulos del MOTOR que la webapp puede importar. Blinda contra que un
// specifier (si alguna vez llegara desde input) cargue código arbitrario del disco (RCE).
// Mantener sincronizada con los importKit() reales del código (búsqueda: importKit(").
const ALLOWED = new Set<string>([
  "core/tracker-adapter/index.mjs",
  "runtime/orchestrator.mjs",
  "runtime/profile/resolve-profile.mjs",
  "runtime/pr/pr-reader.mjs", // lector de PRs de GitHub (PR-driven QA) — prBrief.ts
  "runtime/pr/brief.mjs", // generador de brief de validación (PR-driven QA) — prBrief.ts
  "runtime/pr/scaffold.mjs", // andamiaje determinista de guion desde los AC — prBrief.ts
  "runtime/pr/openapi-diff.mjs", // breaking-change de contrato OpenAPI (modo PR/E2E) — prBrief.ts
  "runtime/evidence/fanout-comment.mjs", // resumen de la corrida para comentar en el Feature — runner.ts
  "runtime/source/validate-project.mjs", // valida que la ruta del repo (QA del código) sea un proyecto real — api/code/validate-path
  "runtime/source/db-env.mjs", // arma las vars de conexión a BD para inyectar a las pruebas — runner.ts
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
