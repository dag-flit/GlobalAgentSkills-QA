import { NextResponse } from "next/server";
import { requireTenant, type AuthContext } from "./context";
import { AuthError } from "./context";
import { runInTenant } from "@/lib/db/tenantContext";

// Envuelve un handler que toca datos del tenant: resuelve el tenant activo (requireTenant),
// abre el contexto (runInTenant → la DAL queda scoping por RLS) y traduce AuthError a 401/403.
// El tenant viene SIEMPRE de la sesión, nunca del input.
export async function withTenantScope(
  fn: (auth: AuthContext & { tenantId: string }) => Promise<NextResponse>,
): Promise<NextResponse> {
  let auth: AuthContext & { tenantId: string };
  try {
    auth = await requireTenant();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
  return runInTenant(auth.tenantId, () => fn(auth));
}
