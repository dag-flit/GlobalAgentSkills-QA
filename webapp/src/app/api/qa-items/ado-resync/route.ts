import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { resyncAdoItems } from "@/lib/qa/adoImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Actualizar desde ADO»: re-lee los work items ya importados y refresca título/estado/asignado SIN
// pisar el estado local del tablero ni escribir en ADO. member+.
export async function POST() {
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    const res = await resyncAdoItems();
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  });
}
