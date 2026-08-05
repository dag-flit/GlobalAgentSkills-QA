import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { recordStartSchema } from "@/lib/validation/schemas";
import { getTarget } from "@/lib/db/regressionTargetsRepo";
import { startRecording } from "@/lib/qa/recorderSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/record/start { targetId, entryRoute, name } → abre un navegador REAL (headed,
// en la máquina donde corre el sistema = local), inicia sesión y queda grabando. Devuelve el id de la
// grabación. Las credenciales se resuelven en el server (descifradas) y no vuelven al navegador.
export async function POST(req: Request) {
  const parsed = await parseJson(req, recordStartSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { targetId, entryRoute, name, username, password } = parsed.data;
  return withTenantScope(async (auth) => {
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${targetId}».` }, { status: 404 });
    const res = await startRecording({ tenantId: auth.tenantId, target, entryRoute, name, overrideUser: username, overridePass: password });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
    return NextResponse.json({ ok: true, id: res.id });
  });
}
