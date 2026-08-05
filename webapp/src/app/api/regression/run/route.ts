import path from "node:path";
import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { tenantDir } from "@/lib/paths";
import { filesDir } from "@/lib/qa/regressionFiles";
import { parseJson } from "@/lib/validation/parse";
import { regressionRunSchema } from "@/lib/validation/schemas";
import { getTarget } from "@/lib/db/regressionTargetsRepo";
import { getSuite } from "@/lib/db/regressionSuitesRepo";
import { saveHistoryRun } from "@/lib/db/regressionHistoryRepo";
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
  const { targetId, suiteId, testId, retries } = parsed.data;
  return withTenantScope(async (auth) => {
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${targetId}».` }, { status: 404 });
    const suite = await getSuite(targetId, suiteId);
    if (!suite) return NextResponse.json({ ok: false, error: `No existe la suite «${suiteId}».` }, { status: 404 });

    const evidenceBase = path.join(tenantDir(auth.tenantId), "regression-evidence");
    const result = await runSuite(target, suite, { evidenceBase, only: testId, retries, filesDir: filesDir(auth.tenantId) });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.message || "La corrida no se pudo ejecutar." }, { status: 502 });

    // Histórico: solo se registra la corrida de SUITE COMPLETA (no las de una prueba suelta), para que
    // la tendencia sea comparable corrida a corrida. Best-effort: un fallo al guardar no tumba la corrida.
    if (!testId && result.runId) {
      const histTests = result.tests.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        flaky: t.flaky,
        attempts: t.attempts,
        kinds: Array.from(new Set((t.cases ?? []).filter((c) => c.status === "fail" && c.kind).map((c) => c.kind!))),
      }));
      await saveHistoryRun({
        targetId, suiteId, suiteName: suite.name, systemName: target.name, runId: result.runId,
        total: result.tests.length, passed: result.passed, failed: result.failed, flaky: result.flaky ?? 0, tests: histTests,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, result });
  });
}
