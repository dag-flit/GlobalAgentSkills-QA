"use client";

import { useState } from "react";

// Modal para IMPORTAR work items de Azure DevOps al tablero (una vía). 3 modos: por ID(s), hijos de un
// Feature/HU, o una consulta (asignados a mí / tipo / estado / área / sprint). Los estados y tipos se
// escriben libres (varían por proyecto y tipo en ADO). El estado de ADO queda informativo; el estado
// local del tablero es independiente.

type Mode = "ids" | "children" | "query";
const csv = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function AdoImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("query");
  const [ids, setIds] = useState("");
  const [parentId, setParentId] = useState("");
  const [types, setTypes] = useState("Bug, Task");
  const [states, setStates] = useState("");
  const [areaPath, setAreaPath] = useState("");
  const [iterationPath, setIterationPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fetched: number; created: number; updated: number; capped: boolean } | null>(null);

  function body(): unknown | null {
    if (mode === "ids") {
      const list = csv(ids).filter((x) => /^\d+$/.test(x));
      if (!list.length) { setError("Escribí uno o más números de work item."); return null; }
      return { mode: "ids", ids: list };
    }
    if (mode === "children") {
      if (!/^\d+$/.test(parentId.trim())) { setError("Escribí el número del Feature/HU."); return null; }
      return { mode: "children", parentId: parentId.trim() };
    }
    const req: Record<string, unknown> = { mode: "query" };
    const t = csv(types); if (t.length) req.types = t;
    const s = csv(states); if (s.length) req.states = s;
    if (areaPath.trim()) req.areaPath = areaPath.trim();
    if (iterationPath.trim()) req.iterationPath = iterationPath.trim();
    if (!t.length && !s.length && !areaPath.trim() && !iterationPath.trim()) {
      setError("Elegí al menos un filtro: tipo, estado, área o sprint."); return null;
    }
    return req;
  }

  async function run() {
    setError(null); setResult(null);
    const b = body();
    if (!b) return;
    setBusy(true);
    try {
      const r = await fetch("/api/qa-items/ado-import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
      });
      const j = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida." }));
      if (!r.ok || !j.ok) throw new Error(j.error || `No se pudo importar (HTTP ${r.status}).`);
      setResult({ fetched: j.fetched, created: j.created, updated: j.updated, capped: Boolean(j.capped) });
      onDone();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  const tab = (m: Mode, label: string) => (
    <button onClick={() => { setMode(m); setError(null); setResult(null); }}
      className={`px-3 py-1.5 text-xs ${mode === m ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel2"}`}>{label}</button>
  );
  const input = "w-full rounded-lg border border-border bg-panel2 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">Importar de Azure DevOps</h2>
        <p className="mt-1 text-xs text-muted">Trae work items al tablero (solo lectura de ADO). El estado de ADO queda informativo; el estado del tablero lo manejás vos.</p>

        <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-border">
          {tab("query", "Consulta")}{tab("children", "Hijos de Feature/HU")}{tab("ids", "Por ID")}
        </div>

        <div className="mt-4 space-y-3">
          {mode === "ids" && (
            <label className="block text-sm">
              <span className="label">Números de work item (separados por coma)</span>
              <input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="10618, 10620, 10711" className={input} autoFocus />
            </label>
          )}
          {mode === "children" && (
            <label className="block text-sm">
              <span className="label">Feature o HU (número)</span>
              <input value={parentId} onChange={(e) => setParentId(e.target.value)} placeholder="ej: 10618" className={input} autoFocus />
              <span className="mt-1 block text-[11px] text-muted">Trae sus work items hijos directos.</span>
            </label>
          )}
          {mode === "query" && (
            <>
              <p className="text-[11px] text-muted">Al menos un filtro es obligatorio. Por defecto NO trae work items en estado <b>Closed</b> ni <b>Removed</b> (salvo que los pidas en «Estados»).</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="label">Tipos (coma)</span>
                  <input value={types} onChange={(e) => setTypes(e.target.value)} placeholder="Bug, Task, User Story" className={input} />
                </label>
                <label className="block text-sm">
                  <span className="label">Estados (coma)</span>
                  <input value={states} onChange={(e) => setStates(e.target.value)} placeholder="Active, New" className={input} />
                </label>
                <label className="block text-sm">
                  <span className="label">Área (Area Path)</span>
                  <input value={areaPath} onChange={(e) => setAreaPath(e.target.value)} placeholder="Proyecto\\Equipo" className={input} />
                </label>
                <label className="block text-sm">
                  <span className="label">Sprint (Iteration Path)</span>
                  <input value={iterationPath} onChange={(e) => setIterationPath(e.target.value)} placeholder="Proyecto\\Sprint 12" className={input} />
                </label>
              </div>
              <p className="text-[11px] text-muted">Tipos y estados varían por proyecto en ADO — escribilos como aparecen ahí.</p>
            </>
          )}

          {error && <p className="text-sm text-red-300">{error}</p>}
          {result && (
            <div className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-sm text-accent">
              {result.fetched} traído(s) de ADO · {result.created} nuevo(s) · {result.updated} actualizado(s).
              {result.capped && <div className="mt-1 text-xs text-warn">Se alcanzó el tope de {200} por import — afiná los filtros (tipo/estado/área/sprint) para traer menos.</div>}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cerrar</button>
          <button onClick={run} disabled={busy} className="btn-primary">{busy ? "Importando…" : "Importar"}</button>
        </div>
      </div>
    </div>
  );
}
