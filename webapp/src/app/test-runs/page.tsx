"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
import { fmtTime } from "@/components/ui";
import type { TestRun } from "@/components/testcases/runTypes";
import type { TestSuite } from "@/components/testcases/types";

// Página «Corridas de prueba» (Fase 2): lista de ejecuciones con su avance (pasó/falló/sin probar) y
// alta de una corrida nueva (elegís una suite o todos los casos). El detalle/ejecución vive en [id].
export default function TestRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [ruRes, suRes] = await Promise.all([fetch("/api/test-runs"), fetch("/api/test-suites")]);
      if (!ruRes.ok) throw new Error(`No se pudieron cargar las corridas (HTTP ${ruRes.status}). ¿Aplicaste las migraciones de BD?`);
      const ru = await ruRes.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
      const su = await suRes.json().catch(() => ({ suites: [] }));
      if (!ru.ok) throw new Error(ru.error || "No se pudieron cargar las corridas.");
      setRuns(ru.runs ?? []);
      setSuites(su.suites ?? []);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const suiteName = useMemo(() => Object.fromEntries(suites.map((s) => [s.id, s.name])), [suites]);
  const agg = useMemo(() => {
    let total = 0, passed = 0, failed = 0, done = 0;
    for (const r of runs) { total += r.total; passed += r.passed; failed += r.failed; done += r.total - r.untested; }
    return { runs: runs.length, executed: done, passed, failed, rate: done ? Math.round((passed / done) * 100) : 0 };
  }, [runs]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/test-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), suiteId: suiteId || null }) });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo crear la corrida.");
      router.push(`/test-runs/${j.id}`);
    } catch (e: any) { setError(e?.message ?? "Error de red."); setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("¿Eliminar esta corrida y sus resultados?")) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/test-runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo eliminar.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Corridas de prueba</h1>
          <p className="mt-1 text-sm text-muted">Ejecutá una suite y registrá el resultado por caso y por paso. Cada corrida guarda un snapshot de los casos.</p>
        </div>
        {!creating && <button onClick={() => setCreating(true)} className="btn-primary">Nueva corrida</button>}
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {creating && (
        <div className="card space-y-3">
          <div className="text-sm font-medium text-white">Nueva corrida</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="label">Nombre</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej: Regresión sprint 12" className="input" autoFocus />
            </label>
            <label className="block text-sm">
              <span className="label">Suite a ejecutar</span>
              <Select value={suiteId} onChange={setSuiteId} className="w-full"
                options={[{ value: "", label: "Todos los casos" }, ...suites.map((s) => ({ value: s.id, label: s.name }))]} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={busy || !name.trim()} className="btn-primary">{busy ? "Creando…" : "Crear y ejecutar"}</button>
            <button onClick={() => { setCreating(false); setName(""); }} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pt-6"><Spinner /></div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay corridas. Creá una con «Nueva corrida».</p>
      ) : (
        <>
        <div className="flex flex-wrap gap-2">
          {[["Corridas", agg.runs, "text-white"], ["Casos ejecutados", agg.executed, "text-white"], ["Pasó", agg.passed, "text-green-300"], ["Falló", agg.failed, "text-red-300"], ["% pasó (global)", `${agg.rate}%`, agg.rate >= 80 ? "text-green-300" : "text-warn"]].map(([label, val, tone]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-panel2 px-3 py-2 min-w-[100px]">
              <div className={`text-2xl font-bold ${tone}`}>{val}</div>
              <div className="text-[11px] text-muted">{label}</div>
            </div>
          ))}
        </div>
        <ul className="mt-2 space-y-2">
          {runs.map((r) => {
            const done = r.total - r.untested;
            const pct = r.total ? Math.round((done / r.total) * 100) : 0;
            return (
              <li key={r.id} className="card flex flex-wrap items-center gap-3">
                <Link href={`/test-runs/${r.id}`} className="min-w-0 flex-1">
                  <div className="font-medium text-white truncate">{r.name}</div>
                  <div className="text-[11px] text-muted">
                    {r.suite_id ? suiteName[r.suite_id] ?? "suite" : "Todos los casos"} · {r.started_by || "—"} · {fmtTime(r.started_at)}
                  </div>
                </Link>
                <div className="flex items-center gap-2 text-xs">
                  <span className="badge bg-green-900 text-green-300">{r.passed} ok</span>
                  {r.failed > 0 && <span className="badge bg-red-900 text-red-300">{r.failed} falló</span>}
                  {r.blocked > 0 && <span className="badge bg-amber-900 text-amber-300">{r.blocked} bloq.</span>}
                  <span className="text-muted">{done}/{r.total} ({pct}%)</span>
                  <span className={`badge ${r.status === "done" ? "bg-panel2 text-muted" : "bg-blue-900 text-blue-300"}`}>{r.status === "done" ? "Terminada" : "En curso"}</span>
                </div>
                <button onClick={() => remove(r.id)} disabled={busy} className="rounded-lg border border-border px-2 py-1 text-xs text-red-300 hover:bg-panel2 disabled:opacity-50">Eliminar</button>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </div>
  );
}
