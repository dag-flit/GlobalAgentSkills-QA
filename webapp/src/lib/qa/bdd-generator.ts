import { importKit } from "./kit";

// Generador de la Ruta B (BDD) para la webapp: envuelve el feature-writer del kit
// (runtime/generate/feature-writer.mjs) como una estrategia `generateTests` inyectable en
// runQaCycle. Determinista, sin IA: el AC se emite como `.feature` (Gherkin ejecutable).

/** Generador compatible con `runQaCycle.generateTests`: AC → `.feature` (Gherkin). */
export function makeBddGenerator() {
  return async (args: any) => {
    const { generateFeaturesForRequirement } = await importKit("runtime/generate/feature-writer.mjs");
    return generateFeaturesForRequirement(args);
  };
}
