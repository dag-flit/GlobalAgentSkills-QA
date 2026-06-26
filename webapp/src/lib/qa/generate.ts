import { importKit } from "./kit";
import { KIT_ROOT } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "./tracker";

/** Una prueba (TC) por criterio, para revisión en lenguaje claro. Ruta B: el AC = Gherkin ejecutable. */
export interface TcPreview {
  key: string;          // clave estable "TC-AC<n>"
  acIndex: number;
  criterion: string;    // texto completo del criterio
  title: string;        // "TC-AC1 - <objetivo>"
  summary: string;      // qué valida, en lenguaje de negocio
  code: string | null;  // especificación Gherkin (.feature) para "ver"; null si no se pudo emitir
  supported: boolean;
  reason: string | null;
  framework: string | null;
  kind?: "gherkin";
}

export interface HuPreview {
  huId: string;
  huTitle?: string;
  criteria: string[];
  tcs: TcPreview[];
}

export interface PreviewResult {
  previews: HuPreview[];
}

/**
 * Previsualización (sin escribir ni ejecutar) de los TC por HU. Ruta B (BDD): el AC se emite como
 * `.feature` (Gherkin ejecutable) con el feature-writer del kit, leyendo los criterios desde el
 * tracker vía el adapter. Tracker-agnóstico; `local` no expone criterios.
 */
export async function previewGeneratedTests(args: {
  huIds: string[];
  unitTool?: string | null; // aceptado por compatibilidad; BDD no lo usa
  repoRoot?: string | null;
}): Promise<PreviewResult> {
  const { huIds } = args;
  const cfg = await loadConfig();
  const tracker = cfg.tracker.selected;
  if (tracker === "local") return { previews: [] };

  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  const env = trackerEnv(cfg.tracker);
  const adapter = getAdapter({ profile: { tracker }, env, repoRoot: KIT_ROOT });
  const { generateFeaturesForRequirement } = await importKit("runtime/generate/feature-writer.mjs");

  const out: HuPreview[] = [];
  for (const huId of huIds) {
    let wi: any = null;
    try {
      wi = await adapter.getWorkItem(String(huId));
    } catch {
      /* HU inaccesible: se reporta sin criterios */
    }
    const criteria: string[] = (wi && wi.acceptance_criteria) || [];
    // El prefijo "TC-" coincide con el preset azure-devops → las claves aprobadas calzan con las que
    // genera el orquestador.
    const tcs: TcPreview[] = generateFeaturesForRequirement({
      requirement: { id: String(huId), title: wi?.title },
      criteria,
      options: { tcTitlePrefix: "TC-" },
    }).map((f: any) => ({ ...f, kind: "gherkin" as const }));
    out.push({ huId: String(huId), huTitle: wi?.title, criteria, tcs });
  }
  return { previews: out };
}
