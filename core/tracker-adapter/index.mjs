// index.mjs — factory: selecciona el adapter de tracker según el perfil resuelto.
// getAdapter({ profile, env, repoRoot }) -> instancia de TrackerAdapter.
// 'github' y 'jira' quedan registrados como pendientes (fase 5) sin romper la factory.

import { LocalAdapter } from "../../adapters/trackers/local/local-adapter.mjs";
import { AzureDevOpsAdapter } from "../../adapters/trackers/azure-devops/azure-devops-adapter.mjs";

const REGISTRY = {
  local: LocalAdapter,
  "azure-devops": AzureDevOpsAdapter,
  // github: GithubAdapter,  // fase 5
  // jira: JiraAdapter,      // fase 5
};

export function getAdapter(ctx = {}) {
  const trackerName = (ctx.profile && ctx.profile.tracker) || "local";
  const Impl = REGISTRY[trackerName];
  if (!Impl) {
    throw new Error(
      `Tracker '${trackerName}' no soportado todavía. Disponibles: ${Object.keys(REGISTRY).join(", ")}.`
    );
  }
  return new Impl(ctx);
}

export { TrackerAdapter } from "./tracker-adapter.mjs";
export default { getAdapter };
