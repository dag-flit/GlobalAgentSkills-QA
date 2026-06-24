import { onEvent, readEvents } from "@/lib/events";
import { getRun } from "@/lib/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 1) reproducir lo ya ocurrido (al abrir/recargar el detalle)
      for (const ev of readEvents(id)) send("log", ev);

      // si el run ya terminó, cierra de una vez
      const rec = getRun(id);
      if (rec && rec.status !== "running") {
        send("done", { status: rec.status });
        controller.close();
        return;
      }

      // 2) transmitir en vivo
      const unsub = onEvent(
        id,
        (ev) => send("log", ev),
        () => {
          const r = getRun(id);
          send("done", { status: r?.status ?? "passed" });
          try {
            controller.close();
          } catch {
            /* noop */
          }
          unsub();
        }
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
