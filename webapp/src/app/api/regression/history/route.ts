import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { listHistoryRuns } from "@/lib/db/regressionHistoryRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/history?targetId&suiteId&limit → últimas corridas de una suite (para la
// tendencia). Solo lectura, acotada al tenant por RLS (withTenantScope + listHistoryRuns).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId") ?? "";
  const suiteId = url.searchParams.get("suiteId") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "15") || 15;
  if (!targetId || !suiteId) {
    return NextResponse.json({ ok: false, error: "Faltan targetId y suiteId." }, { status: 400 });
  }
  return withTenantScope(async () => {
    const runs = await listHistoryRuns(targetId, suiteId, limit);
    return NextResponse.json({ ok: true, runs });
  });
}
