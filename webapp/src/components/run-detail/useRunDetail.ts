"use client";

import { useEffect, useRef, useState } from "react";
import type { RunEvent, RunRecord } from "@/lib/types";
import { useAction } from "@/components/ActionFeedback";

// Estado en vivo del detalle de corrida: metadata inicial + stream SSE de eventos +
// auto-scroll + detener. Comportamiento idéntico al componente original.
export function useRunDetail(id: string) {
  const action = useAction();
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [live, setLive] = useState(true);
  const [autoscroll, setAutoscroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // metadata inicial
  useEffect(() => {
    fetch(`/api/runs/${id}`)
      .then((r) => r.json())
      .then((d) => d.record && setRecord(d.record))
      .catch(() => {});
  }, [id]);

  // stream de eventos en vivo (reproduce los previos + transmite los nuevos)
  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.addEventListener("log", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as RunEvent;
        setEvents((prev) => [...prev, ev]);
      } catch {
        /* noop */
      }
    });
    es.addEventListener("done", () => {
      setLive(false);
      es.close();
      fetch(`/api/runs/${id}`)
        .then((r) => r.json())
        .then((d) => d.record && setRecord(d.record))
        .catch(() => {});
    });
    es.onerror = () => {
      setLive(false);
      es.close();
    };
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (autoscroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, autoscroll]);

  async function stop() {
    await action
      .run({ loading: "Deteniendo la corrida…", success: "Corrida detenida" }, async () => {
        const r = await fetch(`/api/runs/${id}/stop`, { method: "POST" });
        if (!r.ok) throw new Error("No se pudo detener la corrida");
      })
      .catch(() => {});
  }

  return { record, events, live, autoscroll, setAutoscroll, logRef, stop };
}

export type RunDetailCtl = ReturnType<typeof useRunDetail>;
