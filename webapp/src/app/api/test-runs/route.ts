import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { testRunCreateSchema, testRunFinishSchema, testRunDeleteSchema } from "@/lib/validation/schemas";
import { listRuns, createRun, finishRun, deleteRun } from "@/lib/db/qaTestRunsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });

// Corridas de ejecución de casos de prueba, por proyecto (RLS). GET lista (con conteos); POST crea (una
// fila de resultado por caso de la suite); PATCH cierra/reabre; DELETE elimina. Escrituras: member+.
export async function GET() {
  return withTenantScope(async () => NextResponse.json({ ok: true, runs: await listRuns() }));
}
export async function POST(req: Request) {
  const parsed = await parseJson(req, testRunCreateSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    const id = await createRun({ name: parsed.data.name, suiteId: parsed.data.suiteId, startedBy: auth.email });
    return NextResponse.json({ ok: true, id });
  });
}
export async function PATCH(req: Request) {
  const parsed = await parseJson(req, testRunFinishSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await finishRun(parsed.data.id, parsed.data.done);
    return NextResponse.json({ ok: true });
  });
}
export async function DELETE(req: Request) {
  const parsed = await parseJson(req, testRunDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await deleteRun(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
