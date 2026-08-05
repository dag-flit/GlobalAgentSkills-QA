import type { RegressionRecorrido, RegressionStep } from "@/lib/types";

// Convierte un RECORRIDO (grabado o armado a mano) en los PASOS de una prueba de regresión: aplana las
// etapas (prepare + advance, en orden) en una única secuencia de pasos. Los pasos grabados ya tienen la
// forma de RegressionStep (op/alias/valor/ruta), así que es un APLANADO DIRECTO — determinista, SIN IA.
// Antepone un `ir_a` a la ruta de entrada para que la prueba LLEGUE al inicio del flujo tras el login
// automático. NO agrega verificaciones: eso es criterio de QA que el humano añade después (el recorrido
// solo capturó las ACCIONES —clics/escrituras—, no las aserciones).
export function recorridoToSteps(rec: Pick<RegressionRecorrido, "entryRoute" | "stages">): RegressionStep[] {
  const steps: RegressionStep[] = [];
  const entry = (rec.entryRoute || "").trim();
  if (entry && entry !== "/") steps.push({ op: "ir_a", ruta: entry });
  for (const stage of rec.stages ?? []) {
    for (const s of [...(stage.prepare ?? []), ...(stage.advance ?? [])]) {
      if (s && s.op) steps.push({ ...s });
    }
  }
  return steps;
}
