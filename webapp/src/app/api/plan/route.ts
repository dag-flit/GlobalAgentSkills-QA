import { NextResponse } from "next/server";
import { publishPlanOnly } from "@/lib/qa/runner";
import { parseJson } from "@/lib/validation/parse";
import { planInputSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: RunInput (con featureId + huIds). Publica el Plan + TC en el tracker, SIN ejecutar. */
export async function POST(req: Request) {
  const parsed = await parseJson(req, planInputSchema, "ok");
  if (!parsed.ok) return parsed.response;
  try {
    const res = await publishPlanOnly(parsed.data);
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
