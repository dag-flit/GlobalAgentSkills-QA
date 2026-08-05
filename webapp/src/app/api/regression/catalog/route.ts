import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { getTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import type { SelectorCatalog } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/regression/catalog?id=<id>&page=<nombre>  → quita ESA pantalla (y sus selectores) del catálogo.
// DELETE /api/regression/catalog?id=<id>&all=1          → vacía TODO el catálogo (empezar de cero).
// Sirve cuando el front del sistema cambió y los selectores escaneados quedaron obsoletos: se borran y se
// vuelven a escanear frescos. Solo toca el catálogo (selectores); no borra suites, recorridos ni histórico.
// Ojo: las pruebas que referencien un alias borrado lo marcarán como regresión hasta re-escanear la pantalla.
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() || "";
  const page = url.searchParams.get("page");
  const all = url.searchParams.get("all") === "1";
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });
  if (!all && !page) return NextResponse.json({ ok: false, error: "Indicá 'page' o 'all=1'." }, { status: 400 });

  return withTenantScope(async () => {
    const target = await getTarget(id);
    if (!target) return NextResponse.json({ ok: false, error: `No existe el sistema «${id}».` }, { status: 404 });

    const cat = target.catalog as SelectorCatalog | null | undefined;
    const before = cat?.pages ?? [];
    const pages = all ? [] : before.filter((p) => p.name !== page);
    const removed = before.length - pages.length;
    const merged: SelectorCatalog = { baseUrl: cat?.baseUrl, authMode: cat?.authMode, pages };
    await saveCatalog(id, merged);
    const count = pages.reduce((n, p) => n + p.elements.length, 0);
    return NextResponse.json({ ok: true, catalog: merged, count, removedPages: removed });
  });
}
