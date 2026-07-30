import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { countSuitesForTarget } from "@/lib/db/regressionSuitesRepo";
import { countRunsForTarget } from "@/lib/db/regressionHistoryRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/usage?id=<targetId> → { suites, runs }: qué se borraría con el sistema.
// Sirve para avisar al usuario antes de eliminarlo. Solo lectura, acotado al tenant.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });
  return withTenantScope(async () => {
    const [suites, runs] = await Promise.all([countSuitesForTarget(id), countRunsForTarget(id)]);
    return NextResponse.json({ ok: true, suites, runs });
  });
}
