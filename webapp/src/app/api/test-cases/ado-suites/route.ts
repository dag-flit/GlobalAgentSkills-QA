import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { listAdoTestSuites } from "@/lib/qa/adoTestImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suites de un plan de Azure Test Plans (para elegir en el import). Solo lectura de ADO.
export async function GET(req: Request) {
  const planId = new URL(req.url).searchParams.get("planId") ?? "";
  if (!/^\d+$/.test(planId)) return NextResponse.json({ ok: false, error: "planId inválido." }, { status: 400 });
  return withTenantScope(async () => {
    const res = await listAdoTestSuites(planId);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  });
}
