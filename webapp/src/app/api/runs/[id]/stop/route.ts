import { NextResponse } from "next/server";
import { requestStop } from "@/lib/procRegistry";
import { emitEvent } from "@/lib/events";
import { getRun } from "@/lib/runStore";
import { markStopRequested } from "@/lib/db/runsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getRun(id);
  if (!record) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  requestStop(id); // flag en memoria: el hot-path síncrono del ejecutor lo lee al instante
  await markStopRequested(id); // copia durable en el control-plane
  emitEvent(id, "system", "Solicitud de detención recibida (se detendrá tras la herramienta actual).");
  return NextResponse.json({ ok: true });
}
