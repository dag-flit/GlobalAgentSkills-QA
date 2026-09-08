import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { listAdoTestPlans } from "@/lib/qa/adoTestImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Planes de Azure Test Plans del proyecto configurado (para elegir en el import). Solo lectura de ADO.
export async function GET() {
  return withTenantScope(async () => {
    const res = await listAdoTestPlans();
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  });
}
