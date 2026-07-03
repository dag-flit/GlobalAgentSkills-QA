import { withTenant } from "./tx";

// Repositorio de GUIONES E2E por HU (work item), POR TENANT. Toda lectura/escritura corre en
// withTenant → RLS aísla por tenant a nivel de BD; tenant_id se llena por DEFAULT desde el GUC
// (no se inserta a mano). Los pasos son objetos { op, ... } (strings); NO contienen credenciales.

export type StoredStep = Record<string, string>;

/** Guion guardado para una HU, o null si no tiene. */
export async function getFlow(workItemId: string): Promise<StoredStep[] | null> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT steps FROM flows WHERE work_item_id = $1 LIMIT 1", [workItemId]);
    return r.rows[0] ? (r.rows[0].steps as StoredStep[]) : null;
  });
}

/** Crea o reemplaza el guion de una HU (upsert por (tenant_id, work_item_id)). */
export async function saveFlow(workItemId: string, steps: StoredStep[]): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO flows (work_item_id, steps, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id, work_item_id) DO UPDATE SET steps = $2, updated_at = now()`,
      [workItemId, JSON.stringify(steps)],
    );
  });
}
