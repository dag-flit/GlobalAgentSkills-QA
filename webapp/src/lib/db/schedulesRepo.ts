import { withTenant } from "./tx";
import type { Cadence } from "@/lib/qa/cadence";

// DAL de HORARIOS (dato del tenant → todo por withTenant → RLS forzada). El tenant sale del
// contexto (runInTenant), nunca del input.

export interface ScheduleRow {
  id: string;
  target_id: string;
  suite_id: string;
  cadence: Cadence;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_run_id: string | null;
  last_status: string | null;
}

const COLS =
  "id, target_id, suite_id, cadence, enabled, next_run_at, last_run_at, last_run_id, last_status";

export async function listSchedules(): Promise<ScheduleRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(`SELECT ${COLS} FROM schedules ORDER BY next_run_at`);
    return r.rows as ScheduleRow[];
  });
}

export async function listDueSchedules(now: Date): Promise<ScheduleRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(
      `SELECT ${COLS} FROM schedules WHERE enabled = true AND next_run_at <= $1 ORDER BY next_run_at`,
      [now.toISOString()],
    );
    return r.rows as ScheduleRow[];
  });
}

export async function upsertSchedule(s: {
  id: string;
  targetId: string;
  suiteId: string;
  cadence: Cadence;
  enabled: boolean;
  nextRunAt: Date;
}): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO schedules(id, target_id, suite_id, cadence, enabled, next_run_at, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         target_id = EXCLUDED.target_id, suite_id = EXCLUDED.suite_id, cadence = EXCLUDED.cadence,
         enabled = EXCLUDED.enabled, next_run_at = EXCLUDED.next_run_at, updated_at = now()`,
      [s.id, s.targetId, s.suiteId, JSON.stringify(s.cadence), s.enabled, s.nextRunAt.toISOString()],
    );
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM schedules WHERE id = $1", [id]);
  });
}

export async function markScheduleRun(
  id: string,
  u: { lastRunAt: Date; nextRunAt: Date; lastRunId: string | null; lastStatus: string },
): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `UPDATE schedules SET last_run_at = $2, next_run_at = $3, last_run_id = $4, last_status = $5,
         updated_at = now() WHERE id = $1`,
      [id, u.lastRunAt.toISOString(), u.nextRunAt.toISOString(), u.lastRunId, u.lastStatus],
    );
  });
}
