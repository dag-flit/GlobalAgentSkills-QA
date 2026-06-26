import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth/context";
import { getMembership } from "@/lib/db/authRepo";
import { switchSessionTenant } from "@/lib/auth/session";
import { parseJson } from "@/lib/validation/parse";
import { switchTenantSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cambia el tenant activo de la sesión (solo si el usuario pertenece a ese tenant). */
export async function POST(req: Request) {
  const parsed = await parseJson(req, switchTenantSchema, "ok");
  if (!parsed.ok) return parsed.response;
  try {
    const auth = await requireAuth();
    const m = await getMembership(auth.userId, parsed.data.tenantId);
    if (!m) {
      return NextResponse.json({ ok: false, error: "No perteneces a ese tenant." }, { status: 403 });
    }
    await switchSessionTenant(parsed.data.tenantId);
    return NextResponse.json({ ok: true, tenantId: parsed.data.tenantId, role: m.role });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
