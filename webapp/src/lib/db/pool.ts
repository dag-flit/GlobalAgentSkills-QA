import { Pool } from "pg";

// Pool al CONTROL-PLANE: el Postgres del SERVICIO (config, conexiones, runs, eventos).
// ⚠ NUNCA usa DATABASE_URL — esa es la BD del CLIENTE que el runner `db` prueba (otro
// plano). El control-plane vive SOLO en CONTROL_PLANE_URL. Falla ruidoso si falta.

let pool: Pool | null = null;

function controlPlaneUrl(): string {
  const url = process.env.CONTROL_PLANE_URL;
  if (!url) {
    throw new Error(
      "CONTROL_PLANE_URL no está definida. La webapp necesita el Postgres del servicio " +
        "(control-plane). Crea webapp/.env.local con CONTROL_PLANE_URL=postgresql://usuario:clave@host:puerto/base",
    );
  }
  return url;
}

/** Pool compartido (cacheado en globalThis para sobrevivir al HMR de Next en dev). */
export function getPool(): Pool {
  if (pool) return pool;
  const g = globalThis as any;
  if (g.__qofPool) {
    pool = g.__qofPool as Pool;
    return pool;
  }
  pool = new Pool({ connectionString: controlPlaneUrl(), max: 10 });
  pool.on("error", (e) => console.error("[control-plane pool]", e.message));
  g.__qofPool = pool;
  return pool;
}

/** Atajo para consultas sueltas (sin transacción). Para transacciones usa tx.ts. */
export async function query<T = any>(
  text: string,
  params?: any[],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}
