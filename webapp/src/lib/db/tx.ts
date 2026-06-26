import type { PoolClient } from "pg";
import { getPool } from "./pool";

// Helpers de transacción del control-plane. La firma `withTenant` ya queda lista
// para el scoping por tenant de F6 (SET LOCAL app.current_tenant → activa RLS);
// por ahora (single-tenant) delega en una transacción simple.

/** Ejecuta `fn` dentro de una transacción del sistema (sin tenant). BEGIN/COMMIT/ROLLBACK. */
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
      /* la conexión puede estar rota; release igual la descarta */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Ejecuta `fn` dentro de una transacción ligada a un tenant. F6 añadirá aquí
 * `SET LOCAL app.current_tenant = $tenantId` para que RLS filtre a nivel de BD.
 * Hoy (single-tenant) es equivalente a withSystem; el parámetro se conserva para
 * no reescribir los call-sites cuando llegue el aislamiento.
 */
export async function withTenant<T>(
  _tenantId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  return withSystem(async (c) => {
    // F6: await c.query("SELECT set_config('app.current_tenant', $1, true)", [_tenantId]);
    return fn(c);
  });
}
