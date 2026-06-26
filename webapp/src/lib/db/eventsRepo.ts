import { withTenant } from "./tx";
import type { RunEvent } from "@/lib/types";

// Repositorio de eventos POR TENANT (append-only). Corre en withTenant → RLS aísla; tenant_id
// se llena por DEFAULT desde el GUC. appendEvent se llama desde la cola durable del runner,
// que corre dentro de runInTenant (snapshot del tenant de la corrida).

export async function appendEvent(runId: string, ev: RunEvent): Promise<void> {
  await withTenant((c) =>
    c.query("INSERT INTO run_events (run_id, ts, level, msg) VALUES ($1, $2, $3, $4)", [
      runId,
      ev.ts,
      ev.level,
      ev.msg,
    ]),
  );
}

export async function readEvents(runId: string): Promise<RunEvent[]> {
  return withTenant(async (c) => {
    const res = await c.query(
      "SELECT ts, level, msg FROM run_events WHERE run_id = $1 ORDER BY seq",
      [runId],
    );
    return res.rows.map((r: any) => ({ ts: Number(r.ts), level: r.level, msg: r.msg }));
  });
}
