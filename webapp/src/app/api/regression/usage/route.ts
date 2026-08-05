import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { countSuitesForTarget } from "@/lib/db/regressionSuitesRepo";
import { countRecorridosForTarget } from "@/lib/db/regressionRecorridosRepo";
import { countRunsForTarget } from "@/lib/db/regressionHistoryRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/usage?id=<targetId> → { suites, recorridos, runs }: qué se borraría con el
// sistema. Sirve para avisar al usuario antes de eliminarlo. Solo lectura, acotado al tenant.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });
  return withTenantScope(async () => {
    const [suites, recorridos, runs] = await Promise.all([
      countSuitesForTarget(id),
      countRecorridosForTarget(id),
      countRunsForTarget(id),
    ]);
    return NextResponse.json({ ok: true, suites, recorridos, runs });
  });
}
