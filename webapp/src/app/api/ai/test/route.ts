import { NextResponse } from "next/server";
import { testAi } from "@/lib/qa/ai-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prueba la conexión con el proveedor de IA configurado (o por variable de entorno). */
export async function POST() {
  try {
    const res = await testAi();
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
