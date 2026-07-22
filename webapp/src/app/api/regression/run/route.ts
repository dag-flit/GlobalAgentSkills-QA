import path from "node:path";
import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { tenantDir } from "@/lib/paths";
import { parseJson } from "@/lib/validation/parse";
import { regressionRunSchema } from "@/lib/validation/schemas";
import { getTarget } from "@/lib/db/regressionTargetsRepo";
import { getSuite } from "@/lib/db/regressionSuitesRepo";
import { runSuite } from "@/lib/qa/regressionRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/run { targetId, suiteId, testId? } → corre la suite (o una prueba) guardada.
// Abre un navegador real (puede tardar según nº de pruebas/pasos). Deja la evidencia en disco bajo la
// carpeta del tenant (aislada) y devuelve el veredicto + la ruta del reporte HTML. Las credenciales se
// resuelven en el server (descifradas) y no vuelven al navegador.
export async function POST(req: Request) {
  const parsed = await parseJson(req, regressionRunSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { targetId, suiteId, testId } = parsed.data;
  return withTenantScope(async (auth) => {
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${targetId}».` }, { status: 404 });
    const suite = await getSuite(targetId, suiteId);
    if (!suite) return NextResponse.json({ ok: false, error: `No existe la suite «${suiteId}».` }, { status: 404 });

    const evidenceBase = path.join(tenantDir(auth.tenantId), "regression-evidence");
    const result = await runSuite(target, suite, { evidenceBase, only: testId });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.message || "La corrida no se pudo ejecutar." }, { status: 502 });
    return NextResponse.json({ ok: true, result });
  });
}
