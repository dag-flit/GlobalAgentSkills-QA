"use client";

import { useMemo } from "react";
import { type QaItem, COLUMNS, PRIORITY_LABELS, type QaPriority, isOverdue } from "./types";

// Panel de métricas del Seguimiento QA (dashboard compacto sobre TODOS los pendientes del proyecto):
// total, vencidos, conteo por estado y por prioridad. Solo lectura.

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 px-3 py-2 min-w-[92px]">
      <div className={`text-2xl font-bold ${tone ?? "text-white"}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

export function Metrics({ items }: { items: QaItem[] }) {
  const m = useMemo(() => {
    const byStatus: Record<string, number> = { todo: 0, doing: 0, blocked: 0, review: 0, done: 0 };
    const byPrio: Record<string, number> = { alta: 0, media: 0, baja: 0 };
    let overdue = 0;
    for (const i of items) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      byPrio[i.priority] = (byPrio[i.priority] ?? 0) + 1;
      if (isOverdue(i)) overdue++;
    }
    return { byStatus, byPrio, overdue };
  }, [items]);

  return (
    <div className="flex flex-wrap gap-2">
      <Tile label="Total" value={items.length} />
      <Tile label="Vencidos" value={m.overdue} tone={m.overdue ? "text-red-300" : "text-white"} />
      {COLUMNS.map((c) => <Tile key={c.key} label={c.label} value={m.byStatus[c.key] ?? 0} />)}
      {(Object.keys(PRIORITY_LABELS) as QaPriority[]).map((p) => (
        <Tile key={p} label={`Prioridad ${PRIORITY_LABELS[p].toLowerCase()}`} value={m.byPrio[p] ?? 0} />
      ))}
    </div>
  );
}
