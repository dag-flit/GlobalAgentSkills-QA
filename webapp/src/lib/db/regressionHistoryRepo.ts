import { withTenant } from "./tx";

// Histórico de corridas de regresión (una fila por corrida de SUITE completa), POR TENANT (RLS por
// withTenant). Guarda SOLO el veredicto por prueba + la categoría del fallo (sin credenciales ni
// evidencia). Alimenta la tendencia y la detección de pruebas inestables/recurrentes.

export interface HistoryTest {
  id: string;
  name: string;
  status: "pass" | "fail";
  flaky?: boolean;
  attempts?: number;
  kinds?: string[]; // categorías de fallo presentes (selector/assertion/other)
}
export interface HistoryRun {
  runId: string;
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  tests: HistoryTest[];
}

/** Registra una corrida de suite en el histórico. */
export async function saveHistoryRun(o: {
  targetId: string;
  suiteId: string;
  suiteName: string;
  systemName: string;
  runId: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  tests: HistoryTest[];
}): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO regression_runs (target_id, suite_id, suite_name, system_name, run_id, total, passed, failed, flaky, tests)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [o.targetId, o.suiteId, o.suiteName, o.systemName, o.runId, o.total, o.passed, o.failed, o.flaky, JSON.stringify(o.tests ?? [])],
    );
  });
}

/** Cuántas corridas hay en el histórico de un sistema (para avisar antes de borrarlo). */
export async function countRunsForTarget(targetId: string): Promise<number> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT count(*)::int AS n FROM regression_runs WHERE target_id = $1", [targetId]);
    return Number(r.rows[0]?.n ?? 0);
  });
}

/** Elimina TODO el histórico de un sistema (al borrar el sistema → sin huérfanos). */
export async function deleteRunsForTarget(targetId: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM regression_runs WHERE target_id = $1", [targetId]);
  });
}

/** Últimas corridas de una suite (más reciente primero). */
export async function listHistoryRuns(targetId: string, suiteId: string, limit = 15): Promise<HistoryRun[]> {
  return withTenant(async (c) => {
    const r = await c.query(
      `SELECT run_id, ran_at, total, passed, failed, flaky, tests FROM regression_runs
       WHERE target_id = $1 AND suite_id = $2 ORDER BY ran_at DESC LIMIT $3`,
      [targetId, suiteId, Math.min(50, Math.max(1, limit))],
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      runId: String(row.run_id),
      ranAt: row.ran_at instanceof Date ? row.ran_at.toISOString() : String(row.ran_at ?? ""),
      total: Number(row.total),
      passed: Number(row.passed),
      failed: Number(row.failed),
      flaky: Number(row.flaky),
      tests: (row.tests as HistoryTest[]) ?? [],
    }));
  });
}

export interface RecentRegressionRun {
  runId: string; targetId: string; suiteId: string; systemName: string; suiteName: string;
  ranAt: string; total: number; passed: number; failed: number;
}

/** Últimas corridas de regresión del tenant (TODAS las suites), para el selector de Seguimiento QA. */
export async function listRecentHistoryRuns(limit = 20): Promise<RecentRegressionRun[]> {
  return withTenant(async (c) => {
    const r = await c.query(
      `SELECT run_id, target_id, suite_id, system_name, suite_name, ran_at, total, passed, failed
       FROM regression_runs ORDER BY ran_at DESC LIMIT $1`,
      [Math.min(50, Math.max(1, limit))],
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      runId: String(row.run_id),
      targetId: String(row.target_id),
      suiteId: String(row.suite_id),
      systemName: String(row.system_name ?? ""),
      suiteName: String(row.suite_name ?? ""),
      ranAt: row.ran_at instanceof Date ? row.ran_at.toISOString() : String(row.ran_at ?? ""),
      total: Number(row.total),
      passed: Number(row.passed),
      failed: Number(row.failed),
    }));
  });
}
