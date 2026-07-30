import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { tenantDir } from "@/lib/paths";
import { getSuite } from "@/lib/db/regressionSuitesRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mismo slug que usa el runner para nombrar las carpetas de evidencia (regressionRun.slug).
function slug(s: string): string {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

// GET /api/regression/evidence?targetId&suiteId&runId → sirve el report.html de UNA corrida pasada.
// El cliente manda solo ids opacos; ESTE server reconstruye la ruta (aislada por tenant) y valida que
// quede dentro de la carpeta de evidencia del tenant. `runId` se valida como dígitos.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId") ?? "";
  const suiteId = url.searchParams.get("suiteId") ?? "";
  const runId = url.searchParams.get("runId") ?? "";
  if (!targetId || !suiteId || !/^\d+$/.test(runId)) {
    return NextResponse.json({ ok: false, error: "Parámetros inválidos." }, { status: 400 });
  }
  return withTenantScope(async (auth) => {
    const suite = await getSuite(targetId, suiteId);
    if (!suite) return NextResponse.json({ ok: false, error: "No existe la suite." }, { status: 404 });

    const base = path.join(tenantDir(auth.tenantId), "regression-evidence");
    const file = path.join(base, slug(targetId), slug(suite.name), runId, "report.html");
    // Blindaje: el archivo resuelto debe quedar DENTRO de la carpeta de evidencia del tenant.
    if (!path.resolve(file).startsWith(path.resolve(base))) {
      return NextResponse.json({ ok: false, error: "Ruta no permitida." }, { status: 400 });
    }
    if (!fs.existsSync(file)) {
      return NextResponse.json({ ok: false, error: "La evidencia de esa corrida ya no está en disco." }, { status: 404 });
    }
    const html = fs.readFileSync(file, "utf8");
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  });
}
