import { NextResponse } from "next/server";
import { runInTenant } from "@/lib/db/tenantContext";
import { parseJson } from "@/lib/validation/parse";
import { scheduleTickSchema } from "@/lib/validation/schemas";
import { consumeSchedulerToken } from "@/lib/db/schedulerTokensRepo";
import { runDueSchedules } from "@/lib/qa/scheduleTick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/schedule/tick — disparador de SERVICIO (sin sesión de usuario). Público en el
// middleware; la credencial es el par {tenantId, token}. Se abre el contexto del tenant reclamado y
// el token se valida DENTRO de su RLS (un token solo existe en su propio tenant) → tenantId/token que
// no casan ⇒ 401, sin lectura cruzada. Lo llama un cron externo (VPS o GitHub Actions programado).
export async function POST(req: Request) {
  const parsed = await parseJson(req, scheduleTickSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { tenantId, token } = parsed.data;

  return runInTenant(tenantId, async () => {
    const tokenId = await consumeSchedulerToken(token);
    if (!tokenId) {
      return NextResponse.json({ ok: false, error: "Token de servicio inválido." }, { status: 401 });
    }
    const result = await runDueSchedules(tenantId);
    return NextResponse.json({ ok: true, result });
  });
}
