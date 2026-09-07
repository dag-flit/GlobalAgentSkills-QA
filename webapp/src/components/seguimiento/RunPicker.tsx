"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";

// Selector de CORRIDAS del historial (del kit + de regresión) para vincular a un pendiente. Lee
// /api/qa-items/runs (acotado por RLS). Permite AGREGAR VARIAS (queda abierto tras elegir) y OCULTA las
// ya vinculadas (`exclude`). Se guarda un snapshot (título/resultado/enlace) en el pendiente → el chip
// se ve aunque la corrida se purgue después.

export interface RunOption {
  kind: "run" | "regression";
  id: string; title: string; sub: string; status: string; when: string; href: string | null;
}

export function RunPicker({ onPick, exclude }: { onPick: (o: RunOption) => void; exclude?: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || runs.length) return;
    setLoading(true); setError(null);
    fetch("/api/qa-items/runs")
      .then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error || "No se pudo cargar el historial."); setRuns(j.runs ?? []); })
      .catch((e) => setError(e?.message ?? "Error de red."))
      .finally(() => setLoading(false));
  }, [open, runs.length]);

  const shown = runs.filter((r) => {
    if (exclude?.has(`${r.kind}:${r.id}`)) return false;
    return !q.trim() || `${r.title} ${r.sub}`.toLowerCase().includes(q.toLowerCase());
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-panel2">
        Vincular una corrida
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-panel2 p-2">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por sistema, suite o modo…"
          className="flex-1 rounded-lg border border-border bg-panel px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent" autoFocus />
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-white">Listo</button>
      </div>
      <p className="mt-1 px-1 text-[10px] text-muted">Elegí una o varias. Se agregan al pendiente; cerrá con «Listo».</p>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted">{q.trim() ? "Nada coincide con la búsqueda." : "No quedan corridas para vincular."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((r) => {
              const failed = r.status === "failed" || r.status === "error";
              return (
                <li key={`${r.kind}:${r.id}`}>
                  <button type="button" onClick={() => onPick(r)}
                    className="flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left hover:bg-panel">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-border px-1 text-[10px] text-gray-200">{r.kind === "run" ? "kit" : "regresión"}</span>
                        <span className="truncate text-xs font-medium text-gray-100">{r.title}</span>
                      </span>
                      <span className="block truncate text-[11px] text-muted">{r.sub}{r.when ? ` · ${new Date(r.when).toLocaleString()}` : ""}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${failed ? "bg-red-900 text-red-300" : "bg-green-900 text-green-300"}`}>
                      {r.status || "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
