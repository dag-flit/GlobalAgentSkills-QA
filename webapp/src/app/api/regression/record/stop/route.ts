import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { recordStopSchema } from "@/lib/validation/schemas";
import { getTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import { saveRecorrido } from "@/lib/db/regressionRecorridosRepo";
import { mergeRecorridoPages } from "@/lib/qa/regressionScan";
import { stopRecording } from "@/lib/qa/recorderSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/regression/record/stop { id } → cierra el navegador de grabación, guarda el recorrido
// grabado y FUSIONA el catálogo de cada pantalla capturada. Devuelve el id del recorrido creado (para
// abrirlo y afinar nombres de etapas). Reusa el merge por prefijo del walk.
export async function POST(req: Request) {
  const parsed = await parseJson(req, recordStopSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;
  return withTenantScope(async (auth) => {
    const res = await stopRecording(auth.tenantId, id);
    if (!res.ok || !res.recorrido) return NextResponse.json({ ok: false, error: res.error || "No se pudo terminar la grabación." }, { status: 502 });

    const recId = randomUUID();
    const recorrido = { ...res.recorrido, id: recId, targetId: res.targetId! };
    await saveRecorrido(recorrido);

    // Fusiona las páginas capturadas en el catálogo del sistema (reemplaza solo el bloque del recorrido).
    let count = 0;
    const target = await getTarget(res.targetId!);
    if (target && res.catalogPages?.length) {
      const prefix = `${recorrido.name} › `;
      const merged = mergeRecorridoPages(target.catalog, prefix, res.catalogPages, new Date().toISOString());
      await saveCatalog(res.targetId!, merged);
      count = merged.pages.reduce((n, p) => n + p.elements.length, 0);
    }
    return NextResponse.json({ ok: true, recorridoId: recId, screens: res.screens, actions: res.actions, count });
  });
}
