import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { prPublishSchema } from "@/lib/validation/schemas";
import { publishPrBrief } from "@/lib/qa/prBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pr/publish { prUrl, workItemId } → publica el brief como comentario en la HU (Azure).
export async function POST(req: Request) {
  const parsed = await parseJson(req, prPublishSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    try {
      const result = await publishPrBrief(parsed.data.prUrl, parsed.data.workItemId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    } catch (e: any) {
      return NextResponse.json({ ok: false, reason: e?.message ?? "No se pudo publicar el brief." }, { status: 400 });
    }
  });
}
