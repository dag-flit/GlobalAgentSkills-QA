import { NextResponse } from "next/server";
import { onEvent, readEvents } from "@/lib/events";
import { getRun } from "@/lib/runStore";
import { requireTenant, AuthError } from "@/lib/auth/context";
import { runInTenant } from "@/lib/db/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string;
  try {
    tenantId = (await requireTenant()).tenantId;
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }

  // Verifica la PROPIEDAD del run antes de abrir el stream: el bus en vivo es en memoria por
  // runId (no lo cubre RLS), así que sin esto un tenant podría escuchar la corrida de otro.
  const rec0 = await runInTenant(tenantId, () => getRun(id));
  if (!rec0) return NextResponse.json({ ok: false, error: "Run no encontrado" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // El start corre tras devolver la respuesta → reabrimos el contexto de tenant para las
      // lecturas a BD (RLS) con el snapshot capturado.
      for (const ev of await runInTenant(tenantId, () => readEvents(id))) send("log", ev);

      if (rec0.status !== "running") {
        send("done", { status: rec0.status });
        controller.close();
        return;
      }

      const unsub = onEvent(
        id,
        (ev) => send("log", ev),
        () => {
          void (async () => {
            const r = await runInTenant(tenantId, () => getRun(id));
            send("done", { status: r?.status ?? "passed" });
            try {
              controller.close();
            } catch {
              /* noop */
            }
            unsub();
          })();
        },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
