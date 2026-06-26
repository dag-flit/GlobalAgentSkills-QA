import { AsyncLocalStorage } from "node:async_hooks";

// Contexto de tenant por petición (y por corrida en background). El tenantId se establece
// en la frontera (rutas: requireTenant→runInTenant; runner: snapshot→runInTenant) y NUNCA
// viene del input del usuario. `withTenant` (tx.ts) lo lee para hacer SET LOCAL
// app.current_tenant, que es lo que las policies RLS usan para aislar a nivel de BD.
const als = new AsyncLocalStorage<{ tenantId: string }>();

/** Ejecuta `fn` con el tenant activo. Toda operación de datos dentro queda scoping a él. */
export function runInTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

/** Tenant activo; lanza si no hay contexto (uso de DAL fuera de runInTenant = bug). */
export function currentTenantId(): string {
  const store = als.getStore();
  if (!store) {
    throw new Error(
      "Operación de datos sin contexto de tenant: envuélvela en runInTenant(tenantId, …).",
    );
  }
  return store.tenantId;
}

/** Tenant activo o null (para código que tolera ausencia de contexto). */
export function maybeTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}
