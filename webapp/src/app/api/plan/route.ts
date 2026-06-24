import { NextResponse } from "next/server";
import { publishPlanOnly, type RunInput } from "@/lib/qa/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: RunInput (con featureId + huIds). Publica el Plan + TC en el tracker, SIN ejecutar. */
export async function POST(req: Request) {
  let body: RunInput;
  try {
    body = (await req.json()) as RunInput;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (!body?.featureId) {
    return NextResponse.json({ ok: false, error: "Falta featureId para planificar." }, { status: 400 });
  }
  try {
    const res = await publishPlanOnly(body);
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
