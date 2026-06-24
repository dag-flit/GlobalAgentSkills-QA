import { NextResponse } from "next/server";
import { startRun, type RunInput } from "@/lib/qa/runner";
import { listRuns } from "@/lib/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(req: Request) {
  let body: RunInput;
  try {
    body = (await req.json()) as RunInput;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body?.mode) return NextResponse.json({ error: "Falta 'mode'." }, { status: 400 });
  if (body.mode !== "explore" && !body.repoRoot) {
    return NextResponse.json({ error: "Falta 'repoRoot' (detecta el proyecto primero)." }, { status: 400 });
  }
  const record = startRun(body);
  return NextResponse.json({ id: record.id, record });
}
