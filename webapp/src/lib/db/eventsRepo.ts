import { query } from "./pool";
import type { RunEvent } from "@/lib/types";

// Repositorio de eventos (append-only). Es la fuente de verdad de los logs de un run;
// el SSE en vivo sale del bus en memoria (events.ts), esto es la persistencia durable.

export async function appendEvent(runId: string, ev: RunEvent): Promise<void> {
  await query(
    "INSERT INTO run_events (run_id, ts, level, msg) VALUES ($1, $2, $3, $4)",
    [runId, ev.ts, ev.level, ev.msg],
  );
}

export async function readEvents(runId: string): Promise<RunEvent[]> {
  const res = await query(
    "SELECT ts, level, msg FROM run_events WHERE run_id = $1 ORDER BY seq",
    [runId],
  );
  return res.rows.map((r: any) => ({ ts: Number(r.ts), level: r.level, msg: r.msg }));
}
