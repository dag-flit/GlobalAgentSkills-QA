import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { flowSaveSchema } from "@/lib/validation/schemas";
import { getFlow, saveFlow } from "@/lib/db/flowsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/flows?wid=<id> → { steps } (guion guardado de esa HU, o [] si no tiene).
export async function GET(req: Request) {
  const wid = new URL(req.url).searchParams.get("wid")?.trim() || "";
  if (!wid) return NextResponse.json({ ok: false, error: "Falta 'wid'." }, { status: 400 });
  return withTenantScope(async () => NextResponse.json({ steps: (await getFlow(wid)) ?? [] }));
}

// PUT /api/flows { wid, steps } → guarda/reemplaza el guion de la HU (upsert, RLS por tenant).
export async function PUT(req: Request) {
  const parsed = await parseJson(req, flowSaveSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { wid, steps } = parsed.data;
  return withTenantScope(async () => {
    await saveFlow(wid, steps);
    return NextResponse.json({ ok: true });
  });
}
