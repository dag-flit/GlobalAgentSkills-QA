import { NextResponse } from "next/server";
import { requestStop, isActive } from "@/lib/procRegistry";
import { emitEvent, endRun } from "@/lib/events";
import { getRun } from "@/lib/runStore";
import { markStopRequested, finalizeRun } from "@/lib/db/runsRepo";
import { withTenantScope } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORPHAN_STOP =
  "Detenida: el proceso que la ejecutaba ya no está activo (p.ej. un reinicio del servidor), así que no había ejecución que cortar. Se cerró la corrida; volvé a ejecutarla.";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenantScope(async () => {
    // getRun ya reconcilia huérfanas vencidas → si esta lo estaba, vuelve como terminada.
    const record = await getRun(id);
    if (!record) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
    if (record.status !== "running" && record.status !== "pending") {
      return NextResponse.json({ ok: true, alreadyFinished: true });
    }
    if (isActive(id)) {
      // Este proceso la ejecuta: corte COOPERATIVO (el hot-path lee el flag y para tras la herramienta).
      requestStop(id);
      await markStopRequested(id);
      emitEvent(id, "system", "Solicitud de detención recibida (se detendrá tras la herramienta actual).");
      return NextResponse.json({ ok: true });
    }
    // No la ejecuta este proceso (huérfana de un proceso anterior, aún dentro del margen de heartbeat):
    // prender la bandera no serviría —nadie la leería— así que se finaliza directamente en la base.
    const closed = await finalizeRun(id, "error", ORPHAN_STOP);
    if (closed) {
      emitEvent(id, "system", ORPHAN_STOP);
      await endRun(id);
    }
    return NextResponse.json({ ok: true, finalized: closed });
  });
}
