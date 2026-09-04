import { withTenant } from "./tx";

// DAL del tablero de SEGUIMIENTO QA (dato del tenant → withTenant → RLS forzada). El tenant sale del
// contexto (runInTenant), nunca del input.

export type QaStatus = "todo" | "doing" | "blocked" | "review" | "done";
export type QaPriority = "alta" | "media" | "baja";

export interface QaItemRow {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  assignee: string;
  ado_wi: string;
  link_run_kind: string;
  link_run_id: string;
  link_run_meta: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, title, notes, status, priority, assignee, ado_wi, link_run_kind, link_run_id, link_run_meta, position, created_at, updated_at";

export async function listQaItems(): Promise<QaItemRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(`SELECT ${COLS} FROM qa_items ORDER BY status, position, created_at`);
    return r.rows as QaItemRow[];
  });
}

export interface QaItemInput {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  assignee: string;
  adoWi: string;
  linkRunKind: string;
  linkRunId: string;
  linkRunMeta: Record<string, unknown>;
  position: number;
}

export async function upsertQaItem(i: QaItemInput): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO qa_items(id, title, notes, status, priority, assignee, ado_wi, link_run_kind, link_run_id, link_run_meta, position, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         title = EXCLUDED.title, notes = EXCLUDED.notes, status = EXCLUDED.status, priority = EXCLUDED.priority,
         assignee = EXCLUDED.assignee, ado_wi = EXCLUDED.ado_wi, link_run_kind = EXCLUDED.link_run_kind,
         link_run_id = EXCLUDED.link_run_id, link_run_meta = EXCLUDED.link_run_meta, position = EXCLUDED.position,
         updated_at = now()`,
      [i.id, i.title, i.notes, i.status, i.priority, i.assignee, i.adoWi, i.linkRunKind, i.linkRunId,
        JSON.stringify(i.linkRunMeta ?? {}), i.position],
    );
  });
}

export async function deleteQaItem(id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM qa_items WHERE id = $1", [id]);
  });
}
