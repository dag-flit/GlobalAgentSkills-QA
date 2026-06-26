import { NextResponse } from "next/server";
import { importKit } from "@/lib/qa/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → catálogo de plantillas BDD (id + parámetros) para los casos adicionales (Ruta B / B3.5). */
export async function GET() {
  try {
    const { listTemplates } = await importKit("runtime/generate/template-applier.mjs");
    return NextResponse.json({ ok: true, templates: listTemplates() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e), templates: [] }, { status: 500 });
  }
}
