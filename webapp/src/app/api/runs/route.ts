import { NextResponse } from "next/server";
import { startRun } from "@/lib/qa/runner";
import { listRuns } from "@/lib/runStore";
import { parseJson } from "@/lib/validation/parse";
import { runInputSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: await listRuns() });
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, runInputSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.mode !== "explore" && !body.repoRoot) {
    return NextResponse.json({ error: "Falta 'repoRoot' (detecta el proyecto primero)." }, { status: 400 });
  }
  const record = await startRun(body);
  return NextResponse.json({ id: record.id, record });
}
