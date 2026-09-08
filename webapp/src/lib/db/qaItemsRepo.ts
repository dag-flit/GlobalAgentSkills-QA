import { withTenant } from "./tx";

// DAL del tablero de SEGUIMIENTO QA (dato del tenant → withTenant → RLS forzada). El tenant sale del
// contexto (runInTenant), nunca del input.

export type QaStatus = "todo" | "doing" | "blocked" | "review" | "done";
export type QaPriority = "alta" | "media" | "baja";
export type QaType = "bug" | "task" | "test" | "improvement" | "story";
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
  source: string;        // 'local' | 'ado'
  ado_state: string;     // estado en ADO (informativo)
  ado_type: string;      // tipo real en ADO
  ado_url: string;
  ado_synced_at: string | null;
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
  "reporter, assignee, ado_wi, source, ado_state, ado_type, ado_url, ado_synced_at, " +
  "link_run_kind, link_run_id, link_run_meta, link_runs, position, created_at, updated_at";

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

// ── Importar work items de Azure DevOps al tablero (una vía, solo lectura desde ADO) ──────────────
export interface AdoImportRow {
  adoWi: string; title: string; localType: QaType; adoType: string; adoState: string; assignee: string; url: string;
}

// Upsert por ado_wi: si ya existe un pendiente con ese work item, REFRESCA los datos de ADO SIN pisar
// el estado/posición/notas/prioridad LOCAL (el tablero es del usuario); si no, lo crea como 'ado'.
export async function importAdoItems(rows: AdoImportRow[]): Promise<{ created: number; updated: number }> {
  return withTenant(async (c) => {
    let created = 0, updated = 0;
    for (const r of rows) {
      const ex = await c.query("SELECT id FROM qa_items WHERE ado_wi = $1 LIMIT 1", [r.adoWi]);
      if (ex.rows[0]) {
        await c.query(
          `UPDATE qa_items SET title = $2, assignee = COALESCE(NULLIF($3, ''), assignee), type = $4,
             ado_type = $5, ado_state = $6, ado_url = $7, source = 'ado', ado_synced_at = now(), updated_at = now()
           WHERE id = $1`,
          [ex.rows[0].id, r.title, r.assignee, r.localType, r.adoType, r.adoState, r.url],
        );
        updated++;
      } else {
        await c.query(
          `INSERT INTO qa_items(id, title, status, priority, type, assignee, ado_wi, source, ado_type, ado_state, ado_url, ado_synced_at, position)
           VALUES($1, $2, 'todo', 'media', $3, $4, $5, 'ado', $6, $7, $8, now(), 0)
           ON CONFLICT (tenant_id, id) DO NOTHING`,
          [`ado-${r.adoWi}`, r.title, r.localType, r.assignee, r.adoWi, r.adoType, r.adoState, r.url],
        );
        created++;
      }
    }
    return { created, updated };
  });
}

// Elimina TODOS los pendientes importados de ADO (source='ado'). Los locales NO se tocan. Devuelve
// cuántos borró. El borrado por registro individual usa deleteQaItem (el botón «Borrar» de la tarjeta).
export async function deleteAdoItems(): Promise<number> {
  return withTenant(async (c) => {
    const r = await c.query("DELETE FROM qa_items WHERE source = 'ado'");
    return r.rowCount ?? 0;
  });
}

// Los ado_wi de los pendientes que vinieron de ADO (para «Actualizar desde ADO»).
export async function listAdoWorkItemIds(): Promise<string[]> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT ado_wi FROM qa_items WHERE source = 'ado' AND ado_wi <> ''");
    return r.rows.map((x) => x.ado_wi as string);
  });
}
