import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { recordStopSchema } from "@/lib/validation/schemas";
import { cancelRecording } from "@/lib/qa/recorderSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/record/cancel { id } → descarta la grabación SIN guardar: cierra el navegador y
// borra la sesión. Idempotente. Sirve para abandonar y arrancar de nuevo (p.ej. con otra cuenta).
export async function POST(req: Request) {
  const parsed = await parseJson(req, recordStopSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    await cancelRecording(auth.tenantId, parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
