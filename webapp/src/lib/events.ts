import { EventEmitter } from "node:events";
import { appendEvent, readEvents as repoReadEvents } from "./db/eventsRepo";
import type { LogLevel, RunEvent } from "./types";

// Bus en memoria por run (globalThis para sobrevivir al HMR): `event` por cada línea
// de log y `end` al terminar el ciclo (cierra los SSE abiertos). La DURABILIDAD va a
// la tabla run_events vía una cola serializada por run (no bloquea el hot-path síncrono
// del ejecutor): emitEvent encola la escritura y publica al bus al instante.
const g = globalThis as any;
const buses: Map<string, EventEmitter> = g.__qofBuses ?? (g.__qofBuses = new Map());
const queues: Map<string, Promise<void>> = g.__qofEvQueues ?? (g.__qofEvQueues = new Map());

function bus(runId: string): EventEmitter {
  let b = buses.get(runId);
  if (!b) {
    b = new EventEmitter();
    b.setMaxListeners(0);
    buses.set(runId, b);
  }
  return b;
}

// Encola el append durable manteniendo el orden (cada run drena en serie). Un fallo de
// escritura se registra pero NO rompe la corrida ni el stream en vivo.
function enqueue(runId: string, ev: RunEvent): void {
  const prev = queues.get(runId) ?? Promise.resolve();
  const next = prev
    .then(() => appendEvent(runId, ev))
    .catch((e) => console.error(`[run_events ${runId}]`, e?.message ?? e));
  queues.set(runId, next);
}

/** Emite un evento: lo publica al SSE al instante y encola su persistencia durable. */
export function emitEvent(runId: string, level: LogLevel, msg: string): RunEvent {
  const ev: RunEvent = { ts: Date.now(), level, msg };
  enqueue(runId, ev);
  bus(runId).emit("event", ev);
  return ev;
}

/** Espera a que la cola durable del run termine (readEvents verá todo lo emitido). */
export async function flushEvents(runId: string): Promise<void> {
  await (queues.get(runId) ?? Promise.resolve());
}

/** Señala el fin del run a los SSE: primero asegura que todo quedó persistido. */
export async function endRun(runId: string): Promise<void> {
  await flushEvents(runId);
  bus(runId).emit("end");
  queues.delete(runId);
}

/** Suscribe a eventos en vivo de un run. Devuelve la función para desuscribir. */
export function onEvent(runId: string, onEv: (ev: RunEvent) => void, onEnd: () => void): () => void {
  const b = bus(runId);
  b.on("event", onEv);
  b.on("end", onEnd);
  return () => {
    b.off("event", onEv);
    b.off("end", onEnd);
  };
}

/** Lee los eventos ya persistidos de un run (para reproducir al abrir el detalle). */
export async function readEvents(runId: string): Promise<RunEvent[]> {
  return repoReadEvents(runId);
}
