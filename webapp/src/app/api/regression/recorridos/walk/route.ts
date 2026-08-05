import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionWalkSchema } from "@/lib/validation/schemas";
import { getTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import { getRecorrido } from "@/lib/db/regressionRecorridosRepo";
import { walkTargetRecorrido } from "@/lib/qa/regressionWalk";
import { mergeRecorridoPages } from "@/lib/qa/regressionScan";
import { filesDir } from "@/lib/qa/regressionFiles";
import type { SelectorCatalogPage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/recorridos/walk { targetId, recorridoId } → camina el recorrido (login si
// aplica), cataloga cada etapa alcanzada y FUSIONA el resultado en el catálogo del sistema (reemplaza
// solo el bloque del recorrido). Devuelve el catálogo actualizado y hasta dónde se llegó (para iterar).
export async function POST(req: Request) {
  const parsed = await parseJson(req, regressionWalkSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { targetId, recorridoId } = parsed.data;
  return withTenantScope(async (auth) => {
    const target = await getTarget(targetId);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${targetId}».` }, { status: 404 });
    const recorrido = await getRecorrido(targetId, recorridoId);
    if (!recorrido) return NextResponse.json({ ok: false, error: `No existe el recorrido «${recorridoId}».` }, { status: 404 });
    if (!recorrido.stages?.length) return NextResponse.json({ ok: false, error: "El recorrido no tiene etapas." }, { status: 400 });

    const res = await walkTargetRecorrido(target, recorrido, { filesDir: filesDir(auth.tenantId) });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.message || "El recorrido no se pudo caminar." }, { status: 502 });

    // Reemplaza el bloque del recorrido en el catálogo (por prefijo) y persiste.
    const prefix = res.prefix || `${recorrido.name} › `;
    const merged = mergeRecorridoPages(target.catalog, prefix, (res.pages ?? []) as unknown as SelectorCatalogPage[], new Date().toISOString());
    await saveCatalog(targetId, merged);
    const count = merged.pages.reduce((n, p) => n + p.elements.length, 0);
    return NextResponse.json({
      ok: true,
      catalog: merged,
      count,
      reached: res.reached,
      cataloged: res.cataloged,
      skipped: res.skipped ?? [],
      total: res.total,
      stalledAt: res.stalledAt ?? null,
      stallReason: res.stallReason ?? null,
      message: res.message ?? null,
    });
  });
}
