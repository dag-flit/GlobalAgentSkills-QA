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
  switch (t.selected) {
    case "azure-devops":
      return {
        AZURE_ORG_URL: t.azure.orgUrl,
        AZURE_PROJECT_NAME: t.azure.project,
        AZURE_PAT: t.azure.pat,
        USER_REAL_EMAIL: t.azure.userEmail,
      };
    case "github":
      return { GITHUB_REPOSITORY: t.github.repository, GITHUB_TOKEN: t.github.token };
    case "jira":
      return {
        JIRA_BASE_URL: t.jira.baseUrl,
        JIRA_EMAIL: t.jira.email,
        JIRA_TOKEN: t.jira.token,
        JIRA_PROJECT_KEY: t.jira.projectKey,
      };
    default:
      return {};
  }
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

export interface WorkItemLite {
  id: string;
  title?: string;
  state?: string;
  type?: string;
}

/**
 * Trae un Feature/HU y sus hijos jerárquicos (HUs de un Feature) usando el adapter del kit
 * (conexión REST establecida, NO MCP). `local` no expone jerarquía.
 */
export async function fetchFeatureTree(
  tracker: TrackerName,
  env: Record<string, string>,
  featureId: string
): Promise<{ feature: WorkItemLite | null; children: WorkItemLite[] }> {
  if (tracker === "local") return { feature: null, children: [] };
  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  const adapter = getAdapter({ profile: { tracker }, env, repoRoot: KIT_ROOT });
  const [feature, children] = await Promise.all([
    adapter.getWorkItem(featureId),
    adapter.listChildren(featureId),
  ]);
  const lite = (w: any): WorkItemLite | null =>
    w ? { id: String(w.id), title: w.title, state: w.state, type: w.raw?.["System.WorkItemType"] } : null;
  return {
    feature: lite(feature),
    children: (children || []).map((c: any) => ({
      id: String(c.id),
      title: c.title,
      state: c.state,
      type: c.type,
    })),
  };
}
