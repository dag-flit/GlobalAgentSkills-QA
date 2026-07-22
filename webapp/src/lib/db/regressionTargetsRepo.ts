import { withTenant } from "./tx";
import { encryptRegressionTarget, decryptRegressionTarget } from "./secretsMapper";
import type { RegressionTarget, SelectorCatalog } from "@/lib/types";

// Repositorio de SISTEMAS de regresión, POR TENANT. Toda lectura/escritura corre en withTenant →
// RLS aísla por tenant a nivel de BD; tenant_id se llena por DEFAULT desde el GUC (no se inserta a
// mano). La clave se guarda CIFRADA (secretsMapper) y se devuelve DESCIFRADA en memoria (el
// enmascarado hacia el navegador lo hace la ruta, como en config). El catálogo no tiene secretos.

function rowToTarget(r: Record<string, unknown>): RegressionTarget {
  return decryptRegressionTarget({
    id: String(r.id),
    name: String(r.name),
    baseUrl: String(r.base_url),
    authMode: (r.auth_mode === "login" ? "login" : "none"),
    username: String(r.username ?? ""),
    password: String(r.password ?? ""),
    catalog: (r.catalog as SelectorCatalog) ?? null,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ""),
  });
}

/** Todos los sistemas del tenant (clave descifrada en memoria). */
export async function listTargets(): Promise<RegressionTarget[]> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_targets ORDER BY name");
    return r.rows.map(rowToTarget);
  });
}

/** Un sistema por id, o null. */
export async function getTarget(id: string): Promise<RegressionTarget | null> {
  return withTenant(async (c) => {
    const r = await c.query("SELECT * FROM regression_targets WHERE id = $1 LIMIT 1", [id]);
    return r.rows[0] ? rowToTarget(r.rows[0]) : null;
  });
}

/** Crea/actualiza un sistema (upsert). NO toca `catalog` (se guarda aparte con saveCatalog). */
export async function saveTarget(t: RegressionTarget): Promise<void> {
  const e = encryptRegressionTarget(t);
  await withTenant(async (c) => {
    await c.query(
      `INSERT INTO regression_targets (id, name, base_url, auth_mode, username, password, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET name = $2, base_url = $3, auth_mode = $4, username = $5, password = $6, updated_at = now()`,
      [e.id, e.name, e.baseUrl, e.authMode, e.username, e.password],
    );
  });
}

/** Guarda el catálogo del último escaneo (solo selectores). */
export async function saveCatalog(id: string, catalog: SelectorCatalog): Promise<void> {
  await withTenant(async (c) => {
    await c.query("UPDATE regression_targets SET catalog = $2, updated_at = now() WHERE id = $1", [
      id,
      JSON.stringify(catalog),
    ]);
  });
}

/** Elimina un sistema del tenant. */
export async function deleteTarget(id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("DELETE FROM regression_targets WHERE id = $1", [id]);
  });
}
