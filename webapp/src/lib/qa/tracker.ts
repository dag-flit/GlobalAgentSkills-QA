import { importKit } from "./kit";
import { KIT_ROOT } from "@/lib/paths";
import type { TrackerConfig, TrackerName } from "@/lib/types";

export interface PreflightResult {
  ok: boolean;
  mode: string;
  detail?: string;
}

/** Traduce la config del tracker a las variables de entorno que el adapter del kit espera. */
export function trackerEnv(t: TrackerConfig): Record<string, string> {
  if (t.selected === "azure-devops") {
    return {
      AZURE_ORG_URL: t.azure.orgUrl,
      AZURE_PROJECT_NAME: t.azure.project,
      AZURE_PAT: t.azure.pat,
      USER_REAL_EMAIL: t.azure.userEmail,
    };
  }
  return {};
}

/**
 * Corre el preflight REAL del adapter del kit (red real; no se inyecta `http`).
 * `local` no requiere conexión.
 */
export async function testTracker(
  tracker: TrackerName,
  env: Record<string, string>
): Promise<PreflightResult> {
  if (tracker === "local") {
    return { ok: true, mode: "local", detail: "Local: el reporte se guarda en el repo, sin conexión." };
  }
  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  const adapter = getAdapter({ profile: { tracker }, env, repoRoot: KIT_ROOT });
  return adapter.preflight();
}
