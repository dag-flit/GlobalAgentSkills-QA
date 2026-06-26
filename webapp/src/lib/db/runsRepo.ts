import { withTenant } from "./tx";
import type { RunRecord } from "@/lib/types";

// Repositorio de runs POR TENANT. Corre en withTenant → RLS aísla por tenant; tenant_id se
// llena por DEFAULT desde el GUC. Upsert ATÓMICO (INSERT…ON CONFLICT) + lock optimista
// (`version`). Los run ids son únicos globalmente (timestamp+aleatorio).

function rowToRun(r: any): RunRecord {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    startedAt: r.started_at ? r.started_at.toISOString() : undefined,
    finishedAt: r.finished_at ? r.finished_at.toISOString() : undefined,
    status: r.status,
    mode: r.mode,
    tracker: r.tracker,
    title: r.title,
    repoRoot: r.repo_root ?? undefined,
    appUrl: r.app_url ?? undefined,
    featureId: r.feature_id ?? undefined,
    huIds: r.hu_ids ?? undefined,
    layers: r.layers ?? undefined,
    summary: r.summary ?? undefined,
    error: r.error ?? undefined,
  };
}

const J = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

export async function upsertRun(r: RunRecord): Promise<void> {
  await withTenant((c) =>
    c.query(
      `INSERT INTO runs
         (id,created_at,started_at,finished_at,status,mode,tracker,title,
          repo_root,app_url,feature_id,hu_ids,layers,summary,error,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0)
       ON CONFLICT (id) DO UPDATE SET
         created_at=$2,started_at=$3,finished_at=$4,status=$5,mode=$6,tracker=$7,title=$8,
         repo_root=$9,app_url=$10,feature_id=$11,hu_ids=$12,layers=$13,summary=$14,error=$15,
         version = runs.version + 1`,
      [
        r.id, r.createdAt, r.startedAt ?? null, r.finishedAt ?? null, r.status, r.mode,
        r.tracker, r.title, r.repoRoot ?? null, r.appUrl ?? null, r.featureId ?? null,
        r.huIds ? JSON.stringify(r.huIds) : null, r.layers ? JSON.stringify(r.layers) : null,
        J(r.summary), r.error ?? null,
      ],
    ),
  );
}

export async function getRun(id: string): Promise<RunRecord | undefined> {
  return withTenant(async (c) => {
    const res = await c.query("SELECT * FROM runs WHERE id = $1", [id]);
    return res.rows[0] ? rowToRun(res.rows[0]) : undefined;
  });
}

export async function listRuns(): Promise<RunRecord[]> {
  return withTenant(async (c) => {
    const res = await c.query("SELECT * FROM runs ORDER BY created_at DESC");
    return res.rows.map(rowToRun);
  });
}

/** Persiste el stop (copia durable; el hot-path lee el flag en memoria desde procRegistry). */
export async function markStopRequested(id: string): Promise<void> {
  await withTenant((c) => c.query("UPDATE runs SET stop_requested = true WHERE id = $1", [id]));
}
