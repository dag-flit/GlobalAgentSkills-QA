import { withTenant } from "./tx";
import type { RegressionRecorrido, RegressionStage } from "@/lib/types";

// Repositorio de RECORRIDOS de regresión (walk-through de asistentes multi-pantalla), POR TENANT (RLS
// por withTenant). Mismo patrón que regressionSuitesRepo: el árbol etapas→avances vive en jsonb. Los
// avances referencian alias del catálogo → sin secretos.

function rowToRecorrido(r: Record<string, unknown>): RegressionRecorrido {
  return {
    id: String(r.id),
    targetId: String(r.target_id),
    name: String(r.name),
    entryRoute: String(r.entry_route ?? ""),
    stages: (r.stages as RegressionStage[]) ?? [],
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ""),
  };
}

/** Todos los recorridos de un sistema. */
export async function listRecorridos(targetId: string): Promise<RegressionRecorrido[]> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_recorridos WHERE target_id = $1 ORDER BY name", [targetId]);
    return r.rows.map(rowToRecorrido);
  });
}

/** Un recorrido puntual por (target, id), o null. */
export async function getRecorrido(targetId: string, id: string): Promise<RegressionRecorrido | null> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_recorridos WHERE target_id = $1 AND id = $2", [targetId, id]);
    return r.rows[0] ? rowToRecorrido(r.rows[0]) : null;
  });
}

/** Crea/actualiza un recorrido (upsert por (tenant_id, target_id, id)). */
export async function saveRecorrido(r: RegressionRecorrido): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO regression_recorridos (target_id, id, name, entry_route, stages, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, target_id, id) DO UPDATE
         SET name = $3, entry_route = $4, stages = $5, updated_at = now()`,
      [r.targetId, r.id, r.name, r.entryRoute ?? "", JSON.stringify(r.stages ?? [])],
    );
  });
}

/** Elimina un recorrido. */
export async function deleteRecorrido(targetId: string, id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM regression_recorridos WHERE target_id = $1 AND id = $2", [targetId, id]);
  });
}

/** Elimina TODOS los recorridos de un sistema (al borrarlo → sin huérfanos). */
export async function deleteRecorridosForTarget(targetId: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM regression_recorridos WHERE target_id = $1", [targetId]);
  });
}

/** Cuántos recorridos tiene un sistema (para avisar antes de borrarlo). */
export async function countRecorridosForTarget(targetId: string): Promise<number> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT count(*)::int AS n FROM regression_recorridos WHERE target_id = $1", [targetId]);
    return Number(r.rows[0]?.n ?? 0);
  });
}
