import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/context";
import { listMemberships } from "@/lib/db/authRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado de sesión: usuario, tenant activo, rol y tenants disponibles. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }
  const memberships = await listMemberships(auth.userId);
  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: { id: auth.userId, email: auth.email },
    tenantId: auth.tenantId,
    role: auth.role,
    tenants: memberships.map((m) => ({ id: m.tenant_id, name: m.tenant_name, role: m.role })),
  });
}
