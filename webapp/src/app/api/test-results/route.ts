import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { testResultUpdateSchema } from "@/lib/validation/schemas";
import { updateResult } from "@/lib/db/qaTestRunsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Actualiza el resultado de UN caso dentro de una corrida: estado del caso + estado por paso + resultado
// real + notas (el ejecutor sale de la sesión). member+.
export async function PUT(req: Request) {
  const parsed = await parseJson(req, testResultUpdateSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    await updateResult({ id: d.id, status: d.status, stepResults: d.stepResults, actualResult: d.actualResult, notes: d.notes, executedBy: auth.email });
    return NextResponse.json({ ok: true });
  });
}
