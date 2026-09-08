import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { adoTestImportSchema } from "@/lib/validation/schemas";
import { importAdoTestPlan } from "@/lib/qa/adoTestImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Importa los TEST CASES de un plan/suite de Azure Test Plans (con sus pasos) al módulo local. Una vía
// (solo lectura de ADO). Upsert por ado_wi (refresca sin mover de suite). member+.
export async function POST(req: Request) {
  const parsed = await parseJson(req, adoTestImportSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    const res = await importAdoTestPlan(parsed.data);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  });
}
