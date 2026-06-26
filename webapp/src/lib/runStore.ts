import { upsertRun, getRun as repoGetRun, listRuns as repoListRuns } from "./db/runsRepo";
import type { RunRecord } from "./types";

// Persistencia de runs sobre el control-plane (Postgres). Antes era un Map en
// globalThis + data/runs.json (cachés divergentes entre procesos → lost-update); ahora
// hay UNA fuente de verdad y los upserts son atómicos. Mismas firmas, ahora async.

export async function saveRun(record: RunRecord): Promise<void> {
  await upsertRun(record);
}

export async function getRun(id: string): Promise<RunRecord | undefined> {
  return repoGetRun(id);
}

export async function listRuns(): Promise<RunRecord[]> {
  return repoListRuns();
}
