import { NextResponse } from "next/server";
import { detectProject, type ProjectSource } from "@/lib/qa/detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: ProjectSource
 *   { kind: "local", localPath }  ó  { kind: "git", gitUrl, branch? }
 * Devuelve { ok, repoRoot, detection } o { ok:false, error }.
 */
export async function POST(req: Request) {
  let body: ProjectSource;
  try {
    body = (await req.json()) as ProjectSource;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  try {
    const { repoRoot, detection } = await detectProject(body);
    return NextResponse.json({ ok: true, repoRoot, detection });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) });
  }
}
