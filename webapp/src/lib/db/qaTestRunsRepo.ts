import crypto from "node:crypto";
import { withTenant } from "./tx";
import type { TestStep } from "./qaTestCasesRepo";

// DAL de EJECUCIONES de casos de prueba (Fase 2). Una corrida toma los casos de una suite (o todos) y
// guarda el resultado por caso y por paso, con SNAPSHOT del caso al momento de correr → inmutable.
// Dato del tenant → withTenant → RLS forzada.

export type ResultStatus = "untested" | "pass" | "fail" | "blocked" | "skipped";

export interface TestRunRow {
  id: string; name: string; suite_id: string | null; status: string;
  started_by: string; started_at: string; finished_at: string | null;
  total: number; passed: number; failed: number; blocked: number; untested: number;
}
export interface TestResultRow {
  id: string; run_id: string; case_id: string; case_title: string; ado_wi: string;
  steps: TestStep[]; step_results: ResultStatus[]; status: ResultStatus;
  actual_result: string; notes: string; executed_by: string; executed_at: string | null; position: number;
}

// Crea la corrida y una fila de resultado por CASO (snapshot de título/HU/pasos; estado 'untested').
export async function createRun(args: { name: string; suiteId: string | null; startedBy: string }): Promise<string> {
  return withTenant(async (c) => {
    const runId = crypto.randomUUID();
    await c.query(
      "INSERT INTO qa_test_runs(id, name, suite_id, status, started_by) VALUES($1, $2, NULLIF($3, '')::text, 'running', $4)",
      [runId, args.name, args.suiteId ?? "", args.startedBy],
    );
    const cases = (await c.query(
      "SELECT id, title, ado_wi, steps FROM qa_test_cases WHERE ($1 = '' OR suite_id = $1) ORDER BY position, created_at",
      [args.suiteId ?? ""],
    )).rows as Array<{ id: string; title: string; ado_wi: string; steps: TestStep[] }>;
    let pos = 0;
    for (const cs of cases) {
      const steps = Array.isArray(cs.steps) ? cs.steps : [];
      const stepResults = steps.map(() => "untested");
      await c.query(
        `INSERT INTO qa_test_results(id, run_id, case_id, case_title, ado_wi, steps, step_results, status, position)
         VALUES($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'untested', $8)`,
        [crypto.randomUUID(), runId, cs.id, cs.title, cs.ado_wi, JSON.stringify(steps), JSON.stringify(stepResults), pos++],
      );
    }
    return runId;
  });
}

const RUN_COLS =
  "r.id, r.name, r.suite_id, r.status, r.started_by, r.started_at, r.finished_at, " +
  "count(res.*)::int AS total, " +
  "count(res.*) FILTER (WHERE res.status = 'pass')::int AS passed, " +
  "count(res.*) FILTER (WHERE res.status = 'fail')::int AS failed, " +
  "count(res.*) FILTER (WHERE res.status = 'blocked')::int AS blocked, " +
  "count(res.*) FILTER (WHERE res.status = 'untested')::int AS untested";

export async function listRuns(): Promise<TestRunRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(
      `SELECT ${RUN_COLS} FROM qa_test_runs r LEFT JOIN qa_test_results res ON res.run_id = r.id
       GROUP BY r.tenant_id, r.id ORDER BY r.started_at DESC`,
    );
    return r.rows as TestRunRow[];
  });
}

export async function getRun(id: string): Promise<{ run: TestRunRow | null; results: TestResultRow[] }> {
  return withTenant(async (c) => {
    const rr = await c.query(
      `SELECT ${RUN_COLS} FROM qa_test_runs r LEFT JOIN qa_test_results res ON res.run_id = r.id
       WHERE r.id = $1 GROUP BY r.tenant_id, r.id`,
      [id],
    );
    const run = (rr.rows[0] as TestRunRow) ?? null;
    if (!run) return { run: null, results: [] };
    const res = await c.query(
      "SELECT id, run_id, case_id, case_title, ado_wi, steps, step_results, status, actual_result, notes, executed_by, executed_at, position FROM qa_test_results WHERE run_id = $1 ORDER BY position",
      [id],
    );
    return { run, results: res.rows as TestResultRow[] };
  });
}

export interface ResultUpdate {
  id: string; status: ResultStatus; stepResults: ResultStatus[]; actualResult: string; notes: string; executedBy: string;
}
export async function updateResult(u: ResultUpdate): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `UPDATE qa_test_results SET status = $2, step_results = $3::jsonb, actual_result = $4, notes = $5,
         executed_by = $6, executed_at = now() WHERE id = $1`,
      [u.id, u.status, JSON.stringify(u.stepResults ?? []), u.actualResult, u.notes, u.executedBy],
    );
  });
}

export async function finishRun(id: string, done: boolean): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      "UPDATE qa_test_runs SET status = $2, finished_at = CASE WHEN $2 = 'done' THEN now() ELSE NULL END WHERE id = $1",
      [id, done ? "done" : "running"],
    );
  });
}

export async function deleteRun(id: string): Promise<void> {
  await withTenant(async (c) => { await c.query("DELETE FROM qa_test_runs WHERE id = $1", [id]); });
}
