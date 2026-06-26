import { NextResponse } from "next/server";
import { previewGeneratedTests } from "@/lib/qa/generate";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { generatePreviewSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { huIds, unitTool?, repoRoot? } → previsualización de TC (Gherkin) por HU para revisión. */
export async function POST(req: Request) {
  const parsed = await parseJson(req, generatePreviewSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const huIds = Array.isArray(body.huIds) ? body.huIds.map(String) : [];
  if (!huIds.length) return NextResponse.json({ ok: true, previews: [] });
  return withTenantScope(async () => {
    try {
      const { previews } = await previewGeneratedTests({
        huIds,
        unitTool: body.unitTool ?? null,
        repoRoot: body.repoRoot ?? null,
      });
      return NextResponse.json({ ok: true, previews });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
    }
  });
}
