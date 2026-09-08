import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { adoImportSchema } from "@/lib/validation/schemas";
import { runAdoImport } from "@/lib/qa/adoImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Importa work items de Azure DevOps al tablero de Seguimiento (una vía, solo lectura de ADO). El PAT
// vive en el server (config del tenant). Acotado al proyecto por RLS y por el endpoint de ADO. member+.
export async function POST(req: Request) {
  const parsed = await parseJson(req, adoImportSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    const res = await runAdoImport(parsed.data);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  });
}
