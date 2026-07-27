import path from "node:path";
import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { tenantDir } from "@/lib/paths";
import { parseJson } from "@/lib/validation/parse";
import { regressionPublishSchema } from "@/lib/validation/schemas";
import { getTarget } from "@/lib/db/regressionTargetsRepo";
import { getSuite } from "@/lib/db/regressionSuitesRepo";
import { loadConfig } from "@/lib/config";
import { buildProfile, buildEnv } from "@/lib/qa/runner";
import { importKit } from "@/lib/qa/kit";
import { publishRun } from "@/lib/qa/regressionPublish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/publish { targetId, suiteId, runId, testId? } → crea en ADO una HU por cada
// prueba de la corrida con su evidencia adjunta. Solo con tracker Azure. Las credenciales (PAT) se
// resuelven en el server (config del tenant, descifrada) y NUNCA vuelven al navegador.
export async function POST(req: Request) {
  const parsed = await parseJson(req, regressionPublishSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { targetId, suiteId, runId, testId } = parsed.data;
  return withTenantScope(async (auth) => {
    const cfg = await loadConfig();
    if (cfg.tracker.selected !== "azure-devops") {
      return NextResponse.json({ ok: false, error: "Para publicar en ADO elegí Azure DevOps como tracker en Ajustes." }, { status: 400 });
    }
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${targetId}».` }, { status: 404 });
    const suite = await getSuite(targetId, suiteId);
    if (!suite) return NextResponse.json({ ok: false, error: `No existe la suite «${suiteId}».` }, { status: 404 });

    const evidenceBase = path.join(tenantDir(auth.tenantId), "regression-evidence");
    const profile = await buildProfile("azure-devops");
    const env = await buildEnv(cfg);
    const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
    const adapter = getAdapter({ profile, env, repoRoot: evidenceBase });

    const result = await publishRun({ target, suite, runId, testId, evidenceBase, adapter });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message || "No se pudo crear ninguna HU.", published: result.published }, { status: 502 });
    }
    return NextResponse.json({ ok: true, published: result.published });
  });
}
