import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionRecorridoSchema } from "@/lib/validation/schemas";
import { listRecorridos, getRecorrido, saveRecorrido, deleteRecorrido } from "@/lib/db/regressionRecorridosRepo";
import { getTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import { mergeRecorridoPages } from "@/lib/qa/regressionScan";
import type { RegressionRecorrido, SelectorCatalogPage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/recorridos?targetId=<id> → { recorridos } (los recorridos de ese sistema).
export async function GET(req: Request) {
  const targetId = new URL(req.url).searchParams.get("targetId")?.trim() || "";
  if (!targetId) return NextResponse.json({ ok: false, error: "Falta 'targetId'." }, { status: 400 });
  return withTenantScope(async () => NextResponse.json({ recorridos: await listRecorridos(targetId) }));
}

// PUT /api/regression/recorridos → crea/actualiza un recorrido (upsert, RLS por tenant).
export async function PUT(req: Request) {
  const parsed = await parseJson(req, regressionRecorridoSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    await saveRecorrido(parsed.data as RegressionRecorrido);
    return NextResponse.json({ ok: true });
  });
}

// DELETE /api/regression/recorridos?targetId=<id>&id=<recorrido>[&purgeCatalog=1] → elimina un
// recorrido. Con `purgeCatalog=1` quita ADEMÁS del catálogo las pantallas que ese recorrido capturó
// (bloque «<nombre> › …»). Por defecto NO las toca (los selectores son compartidos: pueden estar en
// uso por pruebas — borrarlos las dejaría sin esos elementos).
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId")?.trim() || "";
  const id = url.searchParams.get("id")?.trim() || "";
  const purge = url.searchParams.get("purgeCatalog") === "1";
  if (!targetId || !id) return NextResponse.json({ ok: false, error: "Faltan 'targetId'/'id'." }, { status: 400 });
  return withTenantScope(async () => {
    // Si se va a purgar, necesitamos el nombre ANTES de borrarlo (para el prefijo del bloque).
    const rec = purge ? await getRecorrido(targetId, id) : null;
    await deleteRecorrido(targetId, id);
    let purged = 0;
    if (purge && rec) {
      const target = await getTarget(targetId);
      if (target?.catalog?.pages?.length) {
        const before = target.catalog.pages.length;
        // Fusionar con CERO páginas nuevas bajo el prefijo = quitar ese bloque, conservando el resto.
        const merged = mergeRecorridoPages(target.catalog, `${rec.name} › `, [] as SelectorCatalogPage[], new Date().toISOString());
        purged = before - merged.pages.length;
        await saveCatalog(targetId, merged);
      }
    }
    return NextResponse.json({ ok: true, purged });
  });
}
