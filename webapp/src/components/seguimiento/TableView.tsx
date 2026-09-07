"use client";

import { useMemo, useState } from "react";
import {
  type QaItem, STATUS_LABELS, PRIORITY_LABELS, PRIO_STYLE, TYPE_META, SEVERITY_LABELS, SEVERITY_STYLE, isOverdue,
} from "./types";

// Vista TABLA del Seguimiento QA (además del tablero): ordenable por columna, densa, para revisar
// muchos pendientes de un vistazo. Recibe los items YA filtrados. Clic en una fila → editar.

type SortKey = "title" | "type" | "status" | "priority" | "severity" | "assignee" | "due_date";
const PRIO_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2 };
const SEV_RANK: Record<string, number> = { critica: 0, mayor: 1, menor: 2, trivial: 3, "": 4 };
const STATUS_RANK: Record<string, number> = { todo: 0, doing: 1, blocked: 2, review: 3, done: 4 };

function rankOf(i: QaItem, key: SortKey): string | number {
  if (key === "priority") return PRIO_RANK[i.priority] ?? 9;
  if (key === "severity") return SEV_RANK[i.severity] ?? 9;
  if (key === "status") return STATUS_RANK[i.status] ?? 9;
  if (key === "due_date") return i.due_date ?? "9999-99-99";
  if (key === "type") return i.type;
  if (key === "assignee") return i.assignee.toLowerCase();
  return i.title.toLowerCase();
}

export function TableView({
  items, adoUrl, onEdit,
}: {
  items: QaItem[];
  adoUrl: (wi: string) => string | null;
  onEdit: (i: QaItem) => void;
}) {
  const [sort, setSort] = useState<SortKey>("status");
  const [dir, setDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const ra = rankOf(a, sort); const rb = rankOf(b, sort);
      if (ra < rb) return -1 * dir;
      if (ra > rb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [items, sort, dir]);

  function head(key: SortKey, label: string) {
    const active = sort === key;
    return (
      <th
        onClick={() => { if (active) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(key); setDir(1); } }}
        className="cursor-pointer select-none px-2 py-2 text-left font-semibold text-muted hover:text-white whitespace-nowrap"
      >
        {label}{active ? (dir === 1 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  if (items.length === 0) return <p className="text-sm text-muted">No hay pendientes que coincidan con el filtro.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-panel2">
          <tr>
            {head("title", "Título")}
            {head("type", "Tipo")}
            {head("status", "Estado")}
            {head("priority", "Prioridad")}
            {head("severity", "Severidad")}
            {head("assignee", "Responsable")}
            <th className="px-2 py-2 text-left font-semibold text-muted whitespace-nowrap">Etiquetas</th>
            {head("due_date", "Vence")}
            <th className="px-2 py-2 text-left font-semibold text-muted whitespace-nowrap">ADO</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((i) => {
            const url = adoUrl(i.ado_wi);
            const overdue = isOverdue(i);
            const t = TYPE_META[i.type];
            return (
              <tr key={i.id} onClick={() => onEdit(i)} className="cursor-pointer border-t border-border hover:bg-panel2">
                <td className="max-w-xs truncate px-2 py-2 text-gray-100" title={i.title}>{i.title}</td>
                <td className="px-2 py-2 whitespace-nowrap"><span className={`rounded px-1.5 py-0.5 text-[10px] ${t.cls}`}>{t.label}</span></td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-300">{STATUS_LABELS[i.status]}</td>
                <td className="px-2 py-2 whitespace-nowrap"><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${PRIO_STYLE[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span></td>
                <td className={`px-2 py-2 whitespace-nowrap text-xs ${SEVERITY_STYLE[i.severity]}`}>{SEVERITY_LABELS[i.severity]}</td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-300">{i.assignee || "—"}</td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {(i.labels ?? []).length === 0 ? <span className="text-muted">—</span> : i.labels.map((l) => (
                      <span key={l} className="rounded bg-border px-1.5 py-0.5 text-[10px] text-gray-300">{l}</span>
                    ))}
                  </span>
                </td>
                <td className={`px-2 py-2 whitespace-nowrap text-xs ${overdue ? "text-red-300 font-medium" : "text-gray-300"}`}>{i.due_date ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {i.ado_wi ? (url
                    ? <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">#{i.ado_wi}</a>
                    : <span className="text-gray-300">#{i.ado_wi}</span>) : <span className="text-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
