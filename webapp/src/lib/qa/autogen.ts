import { importKit } from "./kit";
import type { AiConfig } from "@/lib/types";

// Puente webapp → planificador de guion del kit (runtime/generate/flow-planner.mjs).
// El planner deduce los pasos de los AC del work item (los mismos que muestra el AcPanel) y produce
// un guion EFÍMERO por corrida (no se persiste): así, una HU/Feature sin guion guardado se prueba
// igual. Prioridad interna del planner:
//   · IA (Ollama) ENCENDIDA en Ajustes y disponible → guion deducido por el modelo local.
//   · IA apagada / sin modelo / falla                → generador DETERMINISTA (ac-to-flow.mjs).
// El núcleo NUNCA depende de la IA. Si el WI no es E2E-able (backend) o no se dedujo nada,
// devuelve e2eable=false con la razón (el orquestador lo salta con aviso claro).

export interface GenResult {
  flow: Array<Record<string, any>>;
  notes: string[];
  e2eable: boolean;
  reason?: string;
  origin?: "ia" | "determinista";
}

/**
 * Autogenera el guion de un WI a partir de sus AC declarados en Azure. No persiste nada.
 * @param login  si la corrida trae credenciales → antepone el login automático (heurístico).
 * @param ai     config de IA del tenant (Ollama). Si viene apagada/ausente → determinista.
 * @param dom    resumen del DOM (recon) — opcional; mejora los localizadores en el path IA.
 */
export async function autogenFlow(
  adapter: any,
  wid: string,
  appUrl: string,
  login = false,
  ai: AiConfig | null = null,
  dom = "",
): Promise<GenResult> {
  const wi = await adapter.getWorkItem(wid).catch(() => null);
  if (!wi) return { flow: [], notes: [`WI ${wid} no encontrado en el tracker.`], e2eable: false, reason: "WI no encontrado" };

  const { planFlow } = await importKit("runtime/generate/flow-planner.mjs");
  // Transporte HTTP endurecido (reintento ante fallos de red) SOLO si la IA está activa.
  let http: any = null;
  if (ai && ai.enabled && ai.model) {
    const { defaultHttp } = await importKit("adapters/_shared/http-retry.mjs");
    http = defaultHttp;
  }
  return (await planFlow({
    acs: wi.acceptance_criteria || [],
    appUrl,
    title: wi.title || "",
    login,
    dom,
    ai,
    http,
  })) as GenResult;
}

/** ¿El guion generado tiene al menos un paso accionable (no solo el ir_a)? */
export function hasActionableSteps(g: GenResult | null | undefined): boolean {
  return !!(g && g.e2eable && Array.isArray(g.flow) && g.flow.some((s) => s.op !== "ir_a"));
}
