import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { EVENTS_DIR, ensureDataDirs } from "./paths";
import type { LogLevel, RunEvent } from "./types";

// Bus en memoria por run (globalThis para sobrevivir al HMR). Cada run tiene su EventEmitter:
// `event` para cada línea de log y `end` cuando el ciclo termina (cierra los SSE abiertos).
const g = globalThis as any;
const buses: Map<string, EventEmitter> = g.__qofBuses ?? (g.__qofBuses = new Map());

function bus(runId: string): EventEmitter {
  let b = buses.get(runId);
  if (!b) {
    b = new EventEmitter();
    b.setMaxListeners(0);
    buses.set(runId, b);
  }
  return b;
}

function fileFor(runId: string): string {
  return path.join(EVENTS_DIR, `${runId}.jsonl`);
}

/** Emite un evento: lo persiste (append-only) y lo publica a los SSE suscritos. */
export function emitEvent(runId: string, level: LogLevel, msg: string): RunEvent {
  const ev: RunEvent = { ts: Date.now(), level, msg };
  try {
    ensureDataDirs();
    fs.appendFileSync(fileFor(runId), JSON.stringify(ev) + "\n");
  } catch {
    /* el log en disco es best-effort */
  }
  bus(runId).emit("event", ev);
  return ev;
}

/** Señala el fin del run a los SSE suscritos. */
export function endRun(runId: string): void {
  bus(runId).emit("end");
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
export function readEvents(runId: string): RunEvent[] {
  try {
    const raw = fs.readFileSync(fileFor(runId), "utf-8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RunEvent);
  } catch {
    return [];
  }
}
