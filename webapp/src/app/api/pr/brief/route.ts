import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { prBriefSchema } from "@/lib/validation/schemas";
import { buildPrBrief } from "@/lib/qa/prBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pr/brief { prUrl } → brief de validación PR-driven (markdown + HTML + metadatos).
// Determinista: lee el PR de GitHub + los AC de Azure. El token de GitHub vive en el server.
export async function POST(req: Request) {
  const parsed = await parseJson(req, prBriefSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    try {
      const result = await buildPrBrief(parsed.data.prUrl);
      return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "No se pudo generar el brief." }, { status: 400 });
    }
  });
}
