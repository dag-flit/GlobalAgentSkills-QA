import { NextResponse } from "next/server";
import { startRun } from "@/lib/qa/runner";
import { listRuns } from "@/lib/runStore";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { runInputSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withTenantScope(async () => NextResponse.json({ runs: await listRuns() }));
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, runInputSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return withTenantScope(async () => {
    const record = await startRun(body);
    return NextResponse.json({ id: record.id, record });
  });
}
