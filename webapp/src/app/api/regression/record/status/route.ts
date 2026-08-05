import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { recordingStatus } from "@/lib/qa/recorderSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/record/status?id=<grabación> → progreso en vivo (pantallas / acciones / URL).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ ok: false, error: "Falta «id»." }, { status: 400 });
  return withTenantScope(async (auth) => {
    const st = recordingStatus(auth.tenantId, id);
    return NextResponse.json(st, { status: st.ok ? 200 : 404 });
  });
}
