import { importKit } from "./kit";
import { KIT_ROOT } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "./tracker";
import { generateForRequirement, aiStatus } from "./ai-generator";

/** Una prueba (TC) generada desde un criterio, para revisión en lenguaje claro. */
export interface TcPreview {
  key: string;          // clave estable "TC-AC<n>"
  acIndex: number;
  criterion: string;    // texto completo del criterio
  title: string;        // "TC-AC1 - <objetivo>"
  summary: string;      // "Verifica que: <criterio>" (lenguaje de negocio)
  code: string | null;  // código del test (para "ver código"); null si el stack no es soportado
  supported: boolean;
  reason: string | null;
  framework: string | null;
  source?: "ai" | "skeleton"; // de dónde salió el código (IA real vs esqueleto pendiente)
  aiError?: string;           // si la IA falló y cayó a esqueleto
}

export interface HuPreview {
  huId: string;
  huTitle?: string;
  criteria: string[];
  tcs: TcPreview[];
}

export interface PreviewResult {
  previews: HuPreview[];
  ai: { enabled: boolean; provider: string; model: string };
}

/**
 * Genera (sin escribir ni ejecutar) la previsualización de los TC de cada HU, leyendo sus
 * criterios desde el tracker vía el adapter del kit. Tracker-agnóstico; `local` no expone criterios.
 */
export async function previewGeneratedTests({
  huIds,
  unitTool,
}: {
  huIds: string[];
  unitTool?: string | null;
}): Promise<PreviewResult> {
  const cfg = loadConfig();
  const tracker = cfg.tracker.selected;
  const ai = aiStatus();
  if (tracker === "local") return { previews: [], ai };

  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  const env = trackerEnv(cfg.tracker);
  const adapter = getAdapter({ profile: { tracker }, env, repoRoot: KIT_ROOT });

  const out: HuPreview[] = [];
  for (const huId of huIds) {
    let wi: any = null;
    try {
      wi = await adapter.getWorkItem(String(huId));
    } catch {
      /* HU inaccesible: se reporta sin criterios */
    }
    const criteria: string[] = (wi && wi.acceptance_criteria) || [];
    // El prefijo "TC-" coincide con el preset azure-devops (el perfil que arma la corrida);
    // así las claves aprobadas calzan con las que genera el orquestador. Usa la IA si está
    // configurada (con fallback a esqueleto), igual que la corrida real.
    const tcs: TcPreview[] = await generateForRequirement({
      requirement: { id: String(huId), title: wi?.title },
      criteria,
      options: { unitTool: unitTool || "vitest", tcTitlePrefix: "TC-" },
    });
    out.push({ huId: String(huId), huTitle: wi?.title, criteria, tcs });
  }
  return { previews: out, ai };
}
