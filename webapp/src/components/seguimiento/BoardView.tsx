"use client";

import { useMemo, useState } from "react";
import {
  type QaItem, type QaStatus, COLUMNS, PRIO_STYLE, TYPE_META, SEVERITY_LABELS, SEVERITY_STYLE, isOverdue, typeLabel,
} from "./types";

// Tablero (kanban) de 5 columnas del Seguimiento QA. Recibe los items YA filtrados y las acciones.
// Se ARRASTRA una tarjeta a otra columna → cambia su estado (onMove); soltar sobre la misma columna no
// hace nada. La columna destino se resalta al pasar por encima. El estado también se puede cambiar desde
// el editor (alternativa sin arrastrar). Cada tarjeta muestra tipo, prioridad, severidad, etiquetas,
// responsable, fecha límite (vencida en rojo), HU de ADO (navegable) y la corrida vinculada.

export function BoardView({
  items, adoUrl, onEdit, onMove, onRemove, saving,
}: {
  items: QaItem[];
  adoUrl: (wi: string) => string | null;
  onEdit: (i: QaItem) => void;
  onMove: (i: QaItem, status: QaStatus) => void;
  onRemove: (id: string) => void;
  saving: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<QaStatus | null>(null);

  const byStatus = useMemo(() => {
    const m: Record<string, QaItem[]> = { todo: [], doing: [], blocked: [], review: [], done: [] };
    for (const i of items) (m[i.status] ?? m.todo).push(i);
    return m;
  }, [items]);

  function drop(col: QaStatus) {
    const it = items.find((x) => x.id === dragId);
    if (it && it.status !== col) onMove(it, col);
    setDragId(null); setOverCol(null);
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === col.key ? null : c)); }}
          onDrop={(e) => { e.preventDefault(); drop(col.key); }}
          className={`rounded-xl border border-t-4 ${col.accent} bg-panel/60 p-2 transition-colors ${overCol === col.key ? "border-accent ring-1 ring-accent/40" : "border-border"}`}
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-sm font-semibold text-gray-200">{col.label}</h2>
            <span className="text-xs text-muted">{byStatus[col.key]?.length ?? 0}</span>
          </div>
          <div className="min-h-[2rem] space-y-2">
            {(byStatus[col.key] ?? []).map((i) => {
              const url = adoUrl(i.ado_wi);
              const overdue = isOverdue(i);
              const t = TYPE_META[i.type];
              return (
                <div
                  key={i.id}
                  draggable={!saving}
                  onDragStart={() => setDragId(i.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  className={`cursor-grab rounded-lg border border-border bg-panel2 p-3 text-sm active:cursor-grabbing ${dragId === i.id ? "opacity-40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-gray-100">{i.title}</p>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${PRIO_STYLE[i.priority]}`}>{i.priority}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${t.cls}`}>{typeLabel(i)}</span>
                    {i.source === "ado" && i.ado_state && (
                      <span className="rounded bg-blue-900 px-1.5 py-0.5 text-[10px] text-blue-300" title={`Estado en ADO${i.ado_type ? ` · ${i.ado_type}` : ""}`}>ADO: {i.ado_state}</span>
                    )}
                    {i.severity && <span className={`text-[10px] ${SEVERITY_STYLE[i.severity]}`}>{SEVERITY_LABELS[i.severity]}</span>}
                    {(i.labels ?? []).map((l) => (
                      <span key={l} className="rounded bg-border px-1.5 py-0.5 text-[10px] text-gray-300">{l}</span>
                    ))}
                  </div>
                  {i.notes && <p className="mt-1 line-clamp-3 text-xs text-muted">{i.notes}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {i.assignee && <span>{i.assignee}</span>}
                    {i.due_date && <span className={overdue ? "text-red-300 font-medium" : ""}>Vence {i.due_date}{overdue ? " (vencido)" : ""}</span>}
                    {i.ado_wi && (url
                      ? <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">HU #{i.ado_wi}</a>
                      : <span>HU #{i.ado_wi}</span>)}
                    {(i.link_runs ?? []).map((r) => (
                      r.href
                        ? <a key={`${r.kind}:${r.id}`} href={r.href} className="text-accent hover:underline" title={r.sub}>{r.title}</a>
                        : <span key={`${r.kind}:${r.id}`} title={r.sub || "corrida de regresión (sin página propia)"}>{r.title}</span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                    <button onClick={() => onEdit(i)} className="rounded-lg px-1.5 py-0.5 text-xs text-muted hover:bg-panel">Editar</button>
                    <button onClick={() => onRemove(i.id)} disabled={saving} className="ml-auto rounded-lg px-1.5 py-0.5 text-xs text-red-300 hover:bg-panel">Borrar</button>
                  </div>
                </div>
              );
            })}
            {(byStatus[col.key] ?? []).length === 0 && (
              <p className="px-1 py-3 text-center text-xs text-muted/50">{overCol === col.key ? "Soltá acá" : "—"}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
