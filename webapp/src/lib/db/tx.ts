import type { PoolClient } from "pg";
import { getPool } from "./pool";
import { currentTenantId } from "./tenantContext";

// Helpers de transacción del control-plane.
// - withSystem: transacción SIN tenant, para tablas globales (auth: users/sessions/tenants…)
//   y operaciones de sistema. NO activa RLS de tenant.
// - withTenant: transacción ligada al tenant activo (de tenantContext). Hace
//   SET LOCAL app.current_tenant → las policies RLS filtran/validan por ese valor a nivel
//   de BD, aunque la app olvide filtrar en SQL. El tenant viene del contexto, jamás del input.

export async function withSystem<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* conexión posiblemente rota; release la descarta */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function withTenant<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const tenantId = currentTenantId();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL (is_local=true): vive solo en esta transacción → no se filtra entre peticiones
    // que comparten la conexión del pool.
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  } finally {
    client.release();
  }
}
