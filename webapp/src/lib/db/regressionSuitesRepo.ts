import { withTenant } from "./tx";
import type { RegressionSuite, RegressionTest } from "@/lib/types";

// Repositorio de SUITES de regresión, POR TENANT (RLS por withTenant). Reusa el patrón flowsRepo:
// el árbol prueba→pasos vive en jsonb. Sin secretos (los pasos referencian alias del catálogo).

function rowToSuite(r: Record<string, unknown>): RegressionSuite {
  return {
    id: String(r.id),
    targetId: String(r.target_id),
    name: String(r.name),
    tests: (r.tests as RegressionTest[]) ?? [],
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ""),
  };
}

/** Todas las suites de un sistema. */
export async function listSuites(targetId: string): Promise<RegressionSuite[]> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_suites WHERE target_id = $1 ORDER BY name", [targetId]);
    return r.rows.map(rowToSuite);
  });
}

/** Una suite puntual por (target, id), o null. */
export async function getSuite(targetId: string, id: string): Promise<RegressionSuite | null> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_suites WHERE target_id = $1 AND id = $2", [targetId, id]);
    return r.rows[0] ? rowToSuite(r.rows[0]) : null;
  });
}

/** Crea/actualiza una suite (upsert por (tenant_id, target_id, id)). */
export async function saveSuite(s: RegressionSuite): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO regression_suites (target_id, id, name, tests, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, target_id, id) DO UPDATE
         SET name = $3, tests = $4, updated_at = now()`,
      [s.targetId, s.id, s.name, JSON.stringify(s.tests ?? [])],
    );
  });
}

/** Elimina una suite. */
export async function deleteSuite(targetId: string, id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM regression_suites WHERE target_id = $1 AND id = $2", [targetId, id]);
  });
}
