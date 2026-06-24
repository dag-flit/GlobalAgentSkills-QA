import { NextResponse } from "next/server";
import { previewGeneratedTests } from "@/lib/qa/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { huIds: string[], unitTool?: string } → previsualización de TC por HU para revisión. */
export async function POST(req: Request) {
  let body: { huIds?: string[]; unitTool?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const huIds = Array.isArray(body.huIds) ? body.huIds.map(String) : [];
  if (!huIds.length) return NextResponse.json({ ok: true, previews: [], ai: { enabled: false } });
  try {
    const { previews, ai } = await previewGeneratedTests({ huIds, unitTool: body.unitTool ?? null });
    return NextResponse.json({ ok: true, previews, ai });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
