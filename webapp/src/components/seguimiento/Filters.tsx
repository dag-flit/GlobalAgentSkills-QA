"use client";

import { Select } from "@/components/Select";
import { type QaType, type QaStatus, type QaPriority, STATUS_LABELS, PRIORITY_LABELS, TYPE_META } from "./types";

export interface FilterState {
  q: string;
  type: QaType | "all";
  status: QaStatus | "all";
  priority: QaPriority | "all";
  assignee: string; // "" = todos
}
export const EMPTY_FILTER: FilterState = { q: "", type: "all", status: "all", priority: "all", assignee: "" };

// Barra de filtros + búsqueda + toggle de vista (tablero / tabla). Los filtros activos se muestran como
// chips removibles debajo, con un botón para limpiar todo → más claro «qué estoy filtrando».
export function Filters({
  value, onChange, view, onView, assignees,
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  view: "board" | "table";
  onView: (v: "board" | "table") => void;
  assignees: string[];
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const typeOpts = [{ value: "all", label: "Tipo: todos" }, ...(Object.keys(TYPE_META) as QaType[]).map((k) => ({ value: k, label: TYPE_META[k].label }))];
  const statusOpts = [{ value: "all", label: "Estado: todos" }, ...(Object.keys(STATUS_LABELS) as QaStatus[]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))];
  const prioOpts = [{ value: "all", label: "Prioridad: todas" }, ...(Object.keys(PRIORITY_LABELS) as QaPriority[]).map((k) => ({ value: k, label: PRIORITY_LABELS[k] }))];
  const assigneeOpts = [{ value: "", label: "Responsable: todos" }, ...assignees.map((a) => ({ value: a, label: a }))];

  // Chips activos: [clave, etiqueta legible, cómo limpiar ese filtro].
  const chips: [string, string, () => void][] = [];
  if (value.q.trim()) chips.push(["q", `«${value.q.trim()}»`, () => set({ q: "" })]);
  if (value.type !== "all") chips.push(["type", `Tipo: ${TYPE_META[value.type].label}`, () => set({ type: "all" })]);
  if (value.status !== "all") chips.push(["status", `Estado: ${STATUS_LABELS[value.status]}`, () => set({ status: "all" })]);
  if (value.priority !== "all") chips.push(["priority", `Prioridad: ${PRIORITY_LABELS[value.priority]}`, () => set({ priority: "all" })]);
  if (value.assignee) chips.push(["assignee", `Responsable: ${value.assignee}`, () => set({ assignee: "" })]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Buscar por título, notas o etiqueta…"
          className="min-w-[14rem] flex-1 rounded-lg border border-border bg-panel2 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
        />
        <Select value={value.type} onChange={(v) => set({ type: v as FilterState["type"] })} options={typeOpts} ariaLabel="Filtrar por tipo" className="text-xs" />
        <Select value={value.status} onChange={(v) => set({ status: v as FilterState["status"] })} options={statusOpts} ariaLabel="Filtrar por estado" className="text-xs" />
        <Select value={value.priority} onChange={(v) => set({ priority: v as FilterState["priority"] })} options={prioOpts} ariaLabel="Filtrar por prioridad" className="text-xs" />
        <Select value={value.assignee} onChange={(v) => set({ assignee: v })} options={assigneeOpts} ariaLabel="Filtrar por responsable" className="text-xs" />

        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-border">
          <button onClick={() => onView("board")} className={`px-3 py-1.5 text-xs ${view === "board" ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel2"}`}>Tablero</button>
          <button onClick={() => onView("table")} className={`px-3 py-1.5 text-xs ${view === "table" ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel2"}`}>Tabla</button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Filtros:</span>
          {chips.map(([key, label, clear]) => (
            <button key={key} onClick={clear}
              className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent hover:bg-accent/20">
              {label} <span className="text-accent/70">×</span>
            </button>
          ))}
          <button onClick={() => onChange(EMPTY_FILTER)} className="text-xs text-muted underline hover:text-white">Limpiar todo</button>
        </div>
      )}
    </div>
  );
}
