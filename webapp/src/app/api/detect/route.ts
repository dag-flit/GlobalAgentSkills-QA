import { NextResponse } from "next/server";
import { detectProject } from "@/lib/qa/detect";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { projectSourceSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: ProjectSource
 *   { kind: "local", localPath }  ó  { kind: "git", gitUrl, branch? }
 * Devuelve { ok, repoRoot, detection } o { ok:false, error }.
 */
export async function POST(req: Request) {
  const parsed = await parseJson(req, projectSourceSchema, "ok");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    try {
      const { repoRoot, detection } = await detectProject(parsed.data);
      return NextResponse.json({ ok: true, repoRoot, detection });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? String(e) });
    }
  });
}
