"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import type { TestSuite } from "./types";

interface AdoPlan { id: string; name: string }

// Modal para IMPORTAR test cases de Azure Test Plans (con sus pasos) al módulo local. Elegís plan →
// suite de ADO → suite local destino → importar. Una vía (solo lectura de ADO). Upsert por work item.
export function TestPlanImport({ localSuites, onClose, onDone }: { localSuites: TestSuite[]; onClose: () => void; onDone: () => void }) {
  const [plans, setPlans] = useState<AdoPlan[]>([]);
  const [suites, setSuites] = useState<AdoPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [targetSuiteId, setTargetSuiteId] = useState("");
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fetched: number; created: number; updated: number } | null>(null);

  useEffect(() => {
    fetch("/api/test-cases/ado-plans").then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error || "No se pudieron cargar los planes."); setPlans(j.plans ?? []); })
      .catch((e) => setError(e?.message ?? "Error de red. ¿Azure DevOps configurado en Ajustes?"))
      .finally(() => setLoadingPlans(false));
  }, []);

  useEffect(() => {
    if (!planId) { setSuites([]); setSuiteId(""); return; }
    setSuiteId("");
    fetch(`/api/test-cases/ado-suites?planId=${encodeURIComponent(planId)}`).then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error || "No se pudieron cargar las suites."); setSuites(j.suites ?? []); })
      .catch((e) => setError(e?.message ?? "Error de red."));
  }, [planId]);

  async function run() {
    if (!planId || !suiteId) { setError("Elegí un plan y una suite de ADO."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/test-cases/ado-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, suiteId, targetSuiteId: targetSuiteId || null }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || `No se pudo importar (HTTP ${r.status}).`);
      setResult({ fetched: j.fetched, created: j.created, updated: j.updated });
      onDone();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">Importar de Azure Test Plans</h2>
        <p className="mt-1 text-xs text-muted">Trae los test cases de una suite de ADO CON sus pasos. Solo lectura de ADO; upsert por work item (refresca sin moverlos de suite).</p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="label">Plan de ADO</span>
            <Select value={planId} onChange={setPlanId} className="w-full" placeholder={loadingPlans ? "Cargando…" : "— elegí un plan —"}
              options={plans.map((p) => ({ value: p.id, label: p.name }))} />
          </label>
          <label className="block text-sm">
            <span className="label">Suite de ADO</span>
            <Select value={suiteId} onChange={setSuiteId} className="w-full" disabled={!planId} placeholder="— elegí una suite —"
              options={suites.map((s) => ({ value: s.id, label: s.name }))} />
          </label>
          <label className="block text-sm">
            <span className="label">Suite local destino</span>
            <Select value={targetSuiteId} onChange={setTargetSuiteId} className="w-full"
              options={[{ value: "", label: "Sin suite" }, ...localSuites.map((s) => ({ value: s.id, label: s.name }))]} />
          </label>

          {error && <p className="text-sm text-red-300">{error}</p>}
          {result && (
            <p className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-sm text-accent">
              {result.fetched} caso(s) de ADO · {result.created} nuevo(s) · {result.updated} actualizado(s).
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cerrar</button>
          <button onClick={run} disabled={busy || !suiteId} className="btn-primary">{busy ? "Importando…" : "Importar"}</button>
        </div>
      </div>
    </div>
  );
}
