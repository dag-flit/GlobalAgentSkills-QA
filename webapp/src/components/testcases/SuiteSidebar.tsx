"use client";

import { useState } from "react";
import type { TestSuite } from "./types";

// Barra lateral de SUITES: «Todas», cada suite (con conteo), «Sin suite». Permite seleccionar, crear,
// renombrar y eliminar (al eliminar, los casos quedan sin archivar). `selected` = "all" | "none" | id.
export function SuiteSidebar({
  suites, selected, counts, onSelect, onCreate, onRename, onDelete,
}: {
  suites: TestSuite[];
  selected: string;
  counts: { total: number; none: number; bySuite: Record<string, number> };
  onSelect: (v: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const row = (val: string, label: string, count: number) => (
    <button onClick={() => onSelect(val)}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${selected === val ? "bg-accent/15 text-accent" : "text-gray-300 hover:bg-panel2"}`}>
      <span className="truncate">{label}</span>
      <span className="ml-2 shrink-0 text-xs text-muted">{count}</span>
    </button>
  );

  return (
    <div className="w-56 shrink-0 space-y-1">
      {row("all", "Todas", counts.total)}
      {suites.map((s) => (
        <div key={s.id}>
          {renaming === s.id ? (
            <div className="flex gap-1">
              <input value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && renameText.trim()) { onRename(s.id, renameText.trim()); setRenaming(null); } }}
                className="input py-1 text-xs" />
              <button onClick={() => { if (renameText.trim()) { onRename(s.id, renameText.trim()); setRenaming(null); } }} className="btn-primary py-1 text-xs">OK</button>
            </div>
          ) : (
            <div className="group flex items-center gap-1">
              {row(s.id, s.name, counts.bySuite[s.id] ?? 0)}
              <button onClick={() => { setRenaming(s.id); setRenameText(s.name); }} className="hidden shrink-0 rounded px-1 text-xs text-muted hover:bg-panel2 group-hover:block" title="Renombrar">✎</button>
              <button onClick={() => { if (confirm(`¿Eliminar la suite «${s.name}»? Sus casos quedan sin archivar.`)) onDelete(s.id); }} className="hidden shrink-0 rounded px-1 text-xs text-red-300 hover:bg-panel2 group-hover:block" title="Eliminar">✕</button>
            </div>
          )}
        </div>
      ))}
      {row("none", "Sin suite", counts.none)}

      {creating ? (
        <div className="flex gap-1 pt-1">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la suite" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreate(newName.trim()); setNewName(""); setCreating(false); } }}
            className="input py-1 text-xs" />
          <button onClick={() => { if (newName.trim()) { onCreate(newName.trim()); setNewName(""); setCreating(false); } }} className="btn-primary py-1 text-xs">Crear</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:bg-panel2">+ Nueva suite</button>
      )}
    </div>
  );
}
