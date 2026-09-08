import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { deleteAdoItems } from "@/lib/db/qaItemsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elimina TODOS los pendientes importados de ADO (source='ado') del proyecto. Los pendientes LOCALES no
// se tocan. member+. (El borrado individual usa DELETE /api/qa-items con el id.)
export async function POST() {
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    const deleted = await deleteAdoItems();
    return NextResponse.json({ ok: true, deleted });
  });
}
