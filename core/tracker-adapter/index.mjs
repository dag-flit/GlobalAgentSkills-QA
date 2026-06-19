// index.mjs — factory: selecciona el adapter de tracker según el perfil resuelto.
// getAdapter({ profile, env, repoRoot, http }) -> instancia de TrackerAdapter.

import { LocalAdapter } from "../../adapters/trackers/local/local-adapter.mjs";
import { AzureDevOpsAdapter } from "../../adapters/trackers/azure-devops/azure-devops-adapter.mjs";
import { GithubAdapter } from "../../adapters/trackers/github/github-adapter.mjs";
import { JiraAdapter } from "../../adapters/trackers/jira/jira-adapter.mjs";

const REGISTRY = {
  local: LocalAdapter,
  "azure-devops": AzureDevOpsAdapter,
  github: GithubAdapter,
  jira: JiraAdapter,
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
