import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { testSuiteSchema, testSuiteDeleteSchema } from "@/lib/validation/schemas";
import { listSuites, upsertSuite, deleteSuite } from "@/lib/db/qaTestCasesRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });

// Suites (carpetas) de casos de prueba, por proyecto (RLS). GET lista; PUT crea/actualiza; DELETE
// elimina (sus casos quedan sin archivar, no se borran). Escrituras: member+.
export async function GET() {
  return withTenantScope(async () => NextResponse.json({ ok: true, suites: await listSuites() }));
}
export async function PUT(req: Request) {
  const parsed = await parseJson(req, testSuiteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await upsertSuite({ id: d.id, name: d.name, description: d.description, position: d.position });
    return NextResponse.json({ ok: true });
  });
}
export async function DELETE(req: Request) {
  const parsed = await parseJson(req, testSuiteDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await deleteSuite(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
