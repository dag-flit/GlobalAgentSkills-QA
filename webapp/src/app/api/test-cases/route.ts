import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { testCaseSchema, testCaseDeleteSchema } from "@/lib/validation/schemas";
import { listCases, upsertCase, deleteCase } from "@/lib/db/qaTestCasesRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });

// Casos de prueba (con pasos acción/esperado) por proyecto (RLS). GET lista todos; PUT crea/actualiza;
// DELETE elimina. Escrituras: member+.
export async function GET() {
  return withTenantScope(async () => NextResponse.json({ ok: true, cases: await listCases() }));
}
export async function PUT(req: Request) {
  const parsed = await parseJson(req, testCaseSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await upsertCase({
      id: d.id, suiteId: d.suiteId, title: d.title, preconditions: d.preconditions, priority: d.priority,
      tags: d.tags, adoWi: d.adoWi, steps: d.steps, position: d.position,
    });
    return NextResponse.json({ ok: true });
  });
}
export async function DELETE(req: Request) {
  const parsed = await parseJson(req, testCaseDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await deleteCase(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
