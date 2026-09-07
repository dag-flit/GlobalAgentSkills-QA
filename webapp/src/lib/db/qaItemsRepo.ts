import { withTenant } from "./tx";

// DAL del tablero de SEGUIMIENTO QA (dato del tenant → withTenant → RLS forzada). El tenant sale del
// contexto (runInTenant), nunca del input.

export type QaStatus = "todo" | "doing" | "blocked" | "review" | "done";
export type QaPriority = "alta" | "media" | "baja";
export type QaType = "bug" | "task" | "test" | "improvement";
export type QaSeverity = "" | "trivial" | "menor" | "mayor" | "critica";
export interface QaRunLink { kind: string; id: string; title: string; sub: string; href: string | null; when: string; status: string }

export interface QaItemRow {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  type: QaType;
  severity: QaSeverity;
  labels: string[];
  due_date: string | null;
  reporter: string;
  assignee: string;
  ado_wi: string;
  link_run_kind: string;
  link_run_id: string;
  link_run_meta: Record<string, unknown>;
  link_runs: QaRunLink[];
  position: number;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, title, notes, status, priority, type, severity, labels, to_char(due_date, 'YYYY-MM-DD') AS due_date, " +
  "reporter, assignee, ado_wi, link_run_kind, link_run_id, link_run_meta, link_runs, position, created_at, updated_at";

export async function listQaItems(): Promise<QaItemRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(`SELECT ${COLS} FROM qa_items ORDER BY status, position, created_at`);
    return r.rows as QaItemRow[];
  });
}

export async function getQaItem(id: string): Promise<QaItemRow | null> {
  return withTenant(async (c) => {
    const r = await c.query(`SELECT ${COLS} FROM qa_items WHERE id = $1`, [id]);
    return (r.rows[0] as QaItemRow) ?? null;
  });
}

export interface QaItemInput {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  type: QaType;
  severity: QaSeverity;
  labels: string[];
  dueDate: string | null;
  reporter: string;
  assignee: string;
  adoWi: string;
  linkRunKind: string;
  linkRunId: string;
  linkRunMeta: Record<string, unknown>;
  linkRuns: QaRunLink[];
  position: number;
}

export async function upsertQaItem(i: QaItemInput): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO qa_items(id, title, notes, status, priority, type, severity, labels, due_date, reporter, assignee, ado_wi, link_run_kind, link_run_id, link_run_meta, link_runs, position, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULLIF($9, '')::date, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         title = EXCLUDED.title, notes = EXCLUDED.notes, status = EXCLUDED.status, priority = EXCLUDED.priority,
         type = EXCLUDED.type, severity = EXCLUDED.severity, labels = EXCLUDED.labels, due_date = EXCLUDED.due_date,
         assignee = EXCLUDED.assignee, ado_wi = EXCLUDED.ado_wi, link_run_kind = EXCLUDED.link_run_kind,
         link_run_id = EXCLUDED.link_run_id, link_run_meta = EXCLUDED.link_run_meta, link_runs = EXCLUDED.link_runs,
         position = EXCLUDED.position, updated_at = now()`,
      [i.id, i.title, i.notes, i.status, i.priority, i.type, i.severity, JSON.stringify(i.labels ?? []),
        i.dueDate ?? "", i.reporter, i.assignee, i.adoWi, i.linkRunKind, i.linkRunId,
        JSON.stringify(i.linkRunMeta ?? {}), JSON.stringify(i.linkRuns ?? []), i.position],
    );
  });
}

export async function deleteQaItem(id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM qa_items WHERE id = $1", [id]);
  });
}
