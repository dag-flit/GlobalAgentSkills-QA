import path from "node:path";
import fs from "node:fs";

/** Raíz de la app web (donde corre Next): qa-kit/webapp. */
export const PROJECT_ROOT = process.cwd();

/** Raíz del qa-kit (un nivel arriba de webapp/). Aquí viven runtime/, core/, adapters/. */
export const KIT_ROOT = path.resolve(PROJECT_ROOT, "..");

/** Carpeta de datos locales (gitignored): repos clonados y evidencia por tenant.
 *  La config, runs y eventos viven en Postgres (control-plane), ya NO en archivos. */
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** Raíz en disco de los artefactos de un tenant (repos clonados + evidencia). Aísla por
 *  tenant en el filesystem (defensa en profundidad; la API ya la acota por RLS). */
export function tenantDir(tenantId: string): string {
  return path.join(DATA_DIR, "tenants", tenantId);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Ruta absoluta a un módulo del motor del kit (p.ej. "runtime/orchestrator.mjs"). */
export function kitModule(rel: string): string {
  return path.join(KIT_ROOT, rel);
}
