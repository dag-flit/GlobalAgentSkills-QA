import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionScanSchema } from "@/lib/validation/schemas";
import { getTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import { scanTarget, mergeCatalog } from "@/lib/qa/regressionScan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/scan { id, routes? } → escanea el sistema (login si aplica), guarda el
// catálogo resultante y lo devuelve. Las credenciales se resuelven en el server (descifradas) y no
// vuelven al navegador; el catálogo son solo selectores. El escaneo abre un navegador real y puede
// tardar unos segundos por página.
export async function POST(req: Request) {
  const parsed = await parseJson(req, regressionScanSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { id, routes, mode } = parsed.data;
  return withTenantScope(async () => {
    const target = await getTarget(id);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${id}».` }, { status: 404 });

    const res = await scanTarget(target, routes ?? []);
    if (!res.ok || !res.catalog) {
      return NextResponse.json({ ok: false, error: res.message || "El escaneo no produjo catálogo." }, { status: 502 });
    }
    // Catálogo incremental: por defecto se FUSIONA con lo ya catalogado (agrega/actualiza páginas sin
    // perder las demás). `mode:"replace"` empieza de cero. La marca de tiempo se pone en el server.
    const merged = mergeCatalog(target.catalog, res.catalog, mode ?? "merge", new Date().toISOString());
    await saveCatalog(id, merged);
    const count = merged.pages.reduce((n, p) => n + p.elements.length, 0);
    return NextResponse.json({ ok: true, catalog: merged, count });
  });
}
