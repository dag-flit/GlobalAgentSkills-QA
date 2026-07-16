import type { PoolClient } from "pg";
import { withTenant } from "./tx";
import { activeRunIds } from "@/lib/procRegistry";
import type { RunRecord, RunStatus } from "@/lib/types";

// Una corrida `running` cuyo heartbeat (o inicio, si nunca latió) es más viejo que esto = su proceso
// murió sin finalizarla → huérfana. El proceso vivo late cada ~15s, así que este margen no la alcanza.
const STALE_SECS = 90;
const ORPHAN_MSG =
  "La corrida quedó huérfana: el proceso que la ejecutaba terminó antes de finalizarla (p.ej. un reinicio del servidor). Se cerró automáticamente; volvé a ejecutarla.";

// Reconciliación PEREZOSA (dentro de la MISMA transacción de lectura, con el tenant ya fijado por
// withTenant → RLS): cierra como error las corridas `running`/`pending` con heartbeat vencido. Excluye
// las que ESTE proceso ejecuta (su heartbeat igual está fresco, pero es defensa en profundidad). No hay
// barrido global entre tenants: cada tenant limpia sus huérfanas al mirar sus corridas — que es justo
// cuando la mentira ("sigue corriendo") sería visible.
async function reconcileStaleInTx(c: PoolClient): Promise<void> {
  await c.query(
    `UPDATE runs
        SET status = 'error',
            error = COALESCE(NULLIF(error, ''), $1),
            finished_at = COALESCE(finished_at, now())
      WHERE status IN ('running', 'pending')
        AND COALESCE(heartbeat_at, started_at, created_at) < now() - make_interval(secs => $2)
        AND NOT (id = ANY($3::text[]))`,
    [ORPHAN_MSG, STALE_SECS, activeRunIds()],
  );
}

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
          repo_root,app_url,summary,error,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)
       ON CONFLICT (id) DO UPDATE SET
         created_at=$2,started_at=$3,finished_at=$4,status=$5,mode=$6,tracker=$7,title=$8,
         repo_root=$9,app_url=$10,summary=$11,error=$12,
         version = runs.version + 1`,
      [
        r.id, r.createdAt, r.startedAt ?? null, r.finishedAt ?? null, r.status, r.mode,
        r.tracker, r.title, r.repoRoot ?? null, r.appUrl ?? null, J(r.summary), r.error ?? null,
      ],
    ),
  );
}

export async function getRun(id: string): Promise<RunRecord | undefined> {
  return withTenant(async (c) => {
    await reconcileStaleInTx(c); // huérfanas → error antes de devolver (no muestra un zombi vivo)
    const res = await c.query("SELECT * FROM runs WHERE id = $1", [id]);
    return res.rows[0] ? rowToRun(res.rows[0]) : undefined;
  });
}

export async function listRuns(): Promise<RunRecord[]> {
  return withTenant(async (c) => {
    await reconcileStaleInTx(c); // limpia huérfanas del tenant al listar (RLS ya fijó el tenant)
    const res = await c.query("SELECT * FROM runs ORDER BY created_at DESC");
    return res.rows.map(rowToRun);
  });
}

/** Persiste el stop (copia durable; el hot-path lee el flag en memoria desde procRegistry). */
export async function markStopRequested(id: string): Promise<void> {
  await withTenant((c) => c.query("UPDATE runs SET stop_requested = true WHERE id = $1", [id]));
}

/** Late "sigo viva": actualiza el heartbeat de una corrida en curso (best-effort, cada ~15s). */
export async function touchHeartbeat(id: string): Promise<void> {
  await withTenant((c) =>
    c.query("UPDATE runs SET heartbeat_at = now() WHERE id = $1 AND status IN ('running','pending')", [id]),
  );
}

/**
 * Finaliza una corrida en curso directamente en la base (para cuando ESTE proceso no la ejecuta y no
 * puede cortarla cooperativamente: una huérfana de un proceso anterior). No pisa una ya terminada.
 * @returns true si la cerró (estaba en curso), false si ya estaba finalizada.
 */
export async function finalizeRun(id: string, status: RunStatus, error: string): Promise<boolean> {
  return withTenant(async (c) => {
    const res = await c.query(
      `UPDATE runs SET status = $2, error = COALESCE(NULLIF(error, ''), $3), finished_at = COALESCE(finished_at, now())
        WHERE id = $1 AND status IN ('running', 'pending')`,
      [id, status, error],
    );
    return (res.rowCount ?? 0) > 0;
  });
}
