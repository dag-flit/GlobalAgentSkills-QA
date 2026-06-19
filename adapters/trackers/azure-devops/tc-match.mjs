// tc-match.mjs — resuelve el Task hijo (en ADO) que corresponde a un tc_id de evidencia.
// Específico de ADO (Task work items + WIQL), por eso vive con el adapter y NO en core/.
// Aplica las estrategias declaradas en el perfil (azure.tc_ado_matching.strategies), en
// orden, y degrada con aviso (on_unmatched: warn) sin abortar.
//
// Estrategias soportadas:
//   - annotation    : el EvidenceObject ya trae el id (ev.task_id) — la anota el propio test
//   - mapping_file  : JSON { tc_id: taskId } en azure.tc_ado_matching.mapping_file_path
//   - env_map       : JSON { tc_id: taskId } en env.AZURE_TC_MAP
//   - exact_title / prefix_seq / normalized_slug : WIQL por título que CONTIENE el tc_id,
//                     acotado a los hijos del WI padre (las tres colapsan a esa consulta
//                     con los datos disponibles del EvidenceObject)

import fs from "node:fs";
import path from "node:path";

const QUERY_STRATEGIES = new Set(["exact_title", "prefix_seq", "normalized_slug"]);

function readMappingFile(repoRoot, profile, parentId) {
  const cfg = (profile.azure && profile.azure.tc_ado_matching) || {};
  const rel = (cfg.mapping_file_path || ".qa/mappings/wi-{work_item_id}.json").replace(
    "{work_item_id}",
    String(parentId ?? "")
  );
  const file = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parseEnvMap(env) {
  if (!env || !env.AZURE_TC_MAP) return null;
  try {
    return JSON.parse(env.AZURE_TC_MAP);
  } catch {
    return null;
  }
}

/**
 * Resuelve el Task id para un EvidenceObject.
 * @returns {Promise<{taskId: string|null, strategy: string|null, warning?: string}>}
 */
export async function resolveTaskId({ evidence, parentId, profile = {}, env = {}, repoRoot = process.cwd(), client }) {
  const tcId = evidence && evidence.tc_id;
  const cfg = (profile.azure && profile.azure.tc_ado_matching) || {};
  const strategies = Array.isArray(cfg.strategies) ? cfg.strategies : ["annotation", "mapping_file"];

  if (!tcId) return { taskId: null, strategy: null, warning: "evidencia sin tc_id" };

  for (const strat of strategies) {
    if (strat === "annotation" && evidence.task_id) {
      return { taskId: String(evidence.task_id), strategy: "annotation" };
    }
    if (strat === "mapping_file") {
      const map = readMappingFile(repoRoot, profile, parentId);
      if (map && map[tcId] != null) return { taskId: String(map[tcId]), strategy: "mapping_file" };
    }
    if (strat === "env_map") {
      const map = parseEnvMap(env);
      if (map && map[tcId] != null) return { taskId: String(map[tcId]), strategy: "env_map" };
    }
    if (QUERY_STRATEGIES.has(strat) && client && client.queryByWiql) {
      const safe = String(tcId).replace(/'/g, "''");
      const parentClause = parentId ? ` AND [System.Parent] = ${Number(parentId) || 0}` : "";
      const wiql =
        `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Task'` +
        ` AND [System.Title] CONTAINS '${safe}'${parentClause}`;
      const res = await client.queryByWiql(wiql);
      const hit = res && res.json && res.json.workItems && res.json.workItems[0];
      if (hit && hit.id != null) return { taskId: String(hit.id), strategy: strat };
    }
  }

  // on_unmatched: warn (default) — no se aborta; el adapter registra el aviso.
  return { taskId: null, strategy: null, warning: `tc '${tcId}' sin Task asociado (estrategias agotadas)` };
}

export default { resolveTaskId };
