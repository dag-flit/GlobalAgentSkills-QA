import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { schedulerTokenCreateSchema, scheduleDeleteSchema } from "@/lib/validation/schemas";
import { createSchedulerToken, listSchedulerTokens, revokeSchedulerToken } from "@/lib/db/schedulerTokensRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () =>
  NextResponse.json({ ok: false, error: "Solo un admin/owner administra tokens de servicio." }, { status: 403 });

// GET → lista los tokens vigentes (sin el secreto). POST → genera uno y lo devuelve EN CLARO una
// única vez. DELETE → revoca. Administrar tokens = credencial de servicio → rol admin+.
export async function GET() {
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "admin")) return forbidden();
    return NextResponse.json({ ok: true, tokens: await listSchedulerTokens() });
  });
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, schedulerTokenCreateSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "admin")) return forbidden();
    const { id, token } = await createSchedulerToken(parsed.data.label);
    // El token viaja UNA vez; el cliente debe copiarlo ya (no se vuelve a mostrar).
    return NextResponse.json({ ok: true, id, token, tenantId: auth.tenantId });
  });
}

export async function DELETE(req: Request) {
  const parsed = await parseJson(req, scheduleDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "admin")) return forbidden();
    await revokeSchedulerToken(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
