"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { ResultRow } from "@/components/testcases/ResultRow";
import { type TestRun, type TestResult, RESULT_META } from "@/components/testcases/runTypes";

// Detalle de una CORRIDA: resumen (pasó/falló/sin probar + cobertura de HU) y la ejecución caso por caso
// (ResultRow), con snapshot de los pasos. «Marcar terminada» cierra la corrida.
export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [run, setRun] = useState<TestRun | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ado, setAdo] = useState<{ orgUrl: string; project: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rj, cfg] = await Promise.all([
        fetch(`/api/test-runs/${id}`).then((r) => r.json()),
        fetch("/api/config").then((r) => r.json()).catch(() => null),
      ]);
      if (!rj.ok) throw new Error(rj.error || "No se pudo cargar la corrida.");
      setRun(rj.run); setResults(rj.results ?? []);
      const az = cfg?.tracker?.azure;
      setAdo(az?.orgUrl && az?.project ? { orgUrl: az.orgUrl, project: az.project } : null);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const adoUrl = useCallback((wi: string): string | null => {
    if (!ado || !wi) return null;
    return `${ado.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(ado.project)}/_workitems/edit/${encodeURIComponent(wi)}`;
  }, [ado]);

  // Cobertura: HU distintas con al menos un caso en 'pass'.
  const coverage = useMemo(() => {
    const withHu = new Set(results.filter((r) => r.ado_wi).map((r) => r.ado_wi));
    const passed = new Set(results.filter((r) => r.ado_wi && r.status === "pass").map((r) => r.ado_wi));
    return { total: withHu.size, passed: passed.size };
  }, [results]);

  async function toggleDone() {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const done = run.status !== "done";
      const r = await fetch("/api/test-runs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done }) });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo actualizar.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); } finally { setBusy(false); }
  }

  if (loading) return <div className="pt-10"><Spinner /></div>;
  if (!run) return <p className="text-sm text-red-300">{error || "Corrida no encontrada."} <Link href="/test-runs" className="text-accent">Volver</Link></p>;

  const done = run.total - run.untested;
  const pct = run.total ? Math.round((done / run.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/test-runs" className="text-xs text-muted hover:text-white">← Corridas</Link>
          <h1 className="text-xl font-bold text-white">{run.name}</h1>
          <p className="mt-1 text-sm text-muted">Iniciada por {run.started_by || "—"}. Cada caso guarda un snapshot de sus pasos.</p>
        </div>
        <button onClick={toggleDone} disabled={busy} className={run.status === "done" ? "btn-ghost" : "btn-primary"}>
          {run.status === "done" ? "Reabrir" : "Marcar terminada"}
        </button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`badge ${RESULT_META.pass.cls}`}>{run.passed} pasó</span>
        <span className={`badge ${RESULT_META.fail.cls}`}>{run.failed} falló</span>
        <span className={`badge ${RESULT_META.blocked.cls}`}>{run.blocked} bloqueado</span>
        <span className="badge bg-panel2 text-muted">{run.untested} sin probar</span>
        <span className="text-muted">Avance {done}/{run.total} ({pct}%)</span>
        {coverage.total > 0 && <span className="text-muted">· Cobertura HU {coverage.passed}/{coverage.total}</span>}
        <span className={`badge ${run.status === "done" ? "bg-panel2 text-muted" : "bg-blue-900 text-blue-300"}`}>{run.status === "done" ? "Terminada" : "En curso"}</span>
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-muted">Esta corrida no tiene casos (la suite estaba vacía al crearla).</p>
      ) : (
        <div className="space-y-2">
          {results.map((r) => <ResultRow key={r.id} result={r} adoUrl={adoUrl} onSaved={load} />)}
        </div>
      )}
    </div>
  );
}
