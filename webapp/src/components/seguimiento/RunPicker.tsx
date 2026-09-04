"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";

// Selector de una CORRIDA del historial (del kit + de regresión) para vincular a un pendiente. Lee
// /api/qa-items/runs (acotado por RLS). Al elegir, devuelve la opción; el editor guarda un snapshot
// (título/enlace) en el pendiente, así el chip se ve aunque la corrida se purgue después.

export interface RunOption {
  kind: "run" | "regression";
  id: string; title: string; sub: string; status: string; when: string; href: string | null;
}

export function RunPicker({ onPick }: { onPick: (o: RunOption) => void }) {
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

  const shown = runs.filter((r) => !q.trim() || `${r.title} ${r.sub}`.toLowerCase().includes(q.toLowerCase()));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
        + Vincular corrida del historial
      </button>
    );
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar corrida…"
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs" autoFocus />
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500">Cerrar</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 max-h-48 overflow-y-auto">
        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-neutral-400">Sin corridas en el historial.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {shown.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <button type="button" onClick={() => { onPick(r); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left hover:bg-white">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-neutral-800">
                      <span className="mr-1 rounded bg-neutral-200 px-1 text-[10px] text-neutral-600">{r.kind === "run" ? "kit" : "regresión"}</span>
                      {r.title}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-400">{r.sub} · {new Date(r.when).toLocaleString()}</span>
                  </span>
                  <span className={`shrink-0 text-[10px] ${r.status === "failed" ? "text-red-600" : "text-green-600"}`}>{r.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
