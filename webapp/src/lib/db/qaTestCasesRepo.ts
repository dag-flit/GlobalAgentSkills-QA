import { withTenant } from "./tx";

// DAL del módulo «Casos de Prueba» (dato del tenant → withTenant → RLS forzada). Suites (carpetas) y
// casos con pasos (acción/esperado). El tenant sale del contexto (runInTenant), nunca del input.

export interface TestStep { action: string; expected: string }
export type TestPriority = "alta" | "media" | "baja";

export interface TestSuiteRow {
  id: string; name: string; description: string; position: number; created_at: string; updated_at: string;
}
export interface TestCaseRow {
  id: string; suite_id: string | null; title: string; preconditions: string; priority: TestPriority;
  tags: string[]; ado_wi: string; steps: TestStep[]; position: number; created_at: string; updated_at: string;
}

// ── Suites ─────────────────────────────────────────────────────────────────
export async function listSuites(): Promise<TestSuiteRow[]> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT id, name, description, position, created_at, updated_at FROM qa_test_suites ORDER BY position, name");
    return r.rows as TestSuiteRow[];
  });
}
export async function upsertSuite(s: { id: string; name: string; description: string; position: number }): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO qa_test_suites(id, name, description, position, updated_at) VALUES($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, position = EXCLUDED.position, updated_at = now()`,
      [s.id, s.name, s.description, s.position],
    );
  });
}
export async function deleteSuite(id: string): Promise<void> {
  // Los casos de la suite quedan SIN archivar (suite_id → NULL por la FK), no se borran.
  await withTenant(async (c) => { await c.query("DELETE FROM qa_test_suites WHERE id = $1", [id]); });
}

// ── Casos ──────────────────────────────────────────────────────────────────
const CASE_COLS = "id, suite_id, title, preconditions, priority, tags, ado_wi, steps, position, created_at, updated_at";

export async function listCases(): Promise<TestCaseRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(`SELECT ${CASE_COLS} FROM qa_test_cases ORDER BY suite_id, position, created_at`);
    return r.rows as TestCaseRow[];
  });
}

export interface TestCaseInput {
  id: string; suiteId: string | null; title: string; preconditions: string; priority: TestPriority;
  tags: string[]; adoWi: string; steps: TestStep[]; position: number;
}
export async function upsertCase(i: TestCaseInput): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO qa_test_cases(id, suite_id, title, preconditions, priority, tags, ado_wi, steps, position, updated_at)
       VALUES($1, NULLIF($2, '')::text, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, now())
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         suite_id = EXCLUDED.suite_id, title = EXCLUDED.title, preconditions = EXCLUDED.preconditions,
         priority = EXCLUDED.priority, tags = EXCLUDED.tags, ado_wi = EXCLUDED.ado_wi, steps = EXCLUDED.steps,
         position = EXCLUDED.position, updated_at = now()`,
      [i.id, i.suiteId ?? "", i.title, i.preconditions, i.priority, JSON.stringify(i.tags ?? []), i.adoWi,
        JSON.stringify(i.steps ?? []), i.position],
    );
  });
}
export async function deleteCase(id: string): Promise<void> {
  await withTenant(async (c) => { await c.query("DELETE FROM qa_test_cases WHERE id = $1", [id]); });
}
