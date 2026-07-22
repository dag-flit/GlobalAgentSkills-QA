"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui";

// Corre una suite COMPLETA o una PRUEBA puntual y muestra el veredicto por prueba y por paso, más un
// visor de EVIDENCIA (reporte HTML autocontenido con capturas por paso + video). Llama a
// /api/regression/run (abre el navegador en el server). No maneja credenciales en el cliente.

interface StepResult { name: string; status: "pass" | "fail"; message?: string | null }
interface TestRunResult { id: string; name: string; status: "pass" | "fail"; steps: number; warnings: string[]; cases: StepResult[] }
interface SuiteRunResult { suite: string; tests: TestRunResult[]; passed: number; failed: number; reportPath?: string }

const ALL = "__all__";

export function SuiteRunner({ targetId, suiteId, tests, disabled }: { targetId: string; suiteId: string; tests: Array<{ id: string; name: string }>; disabled?: boolean }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<SuiteRunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [viewer, setViewer] = useState(false);

  async function run(testId?: string) {
    setRunning(testId ?? ALL);
    setErr(null);
    try {
      const r = await fetch("/api/regression/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, suiteId, ...(testId ? { testId } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo correr.");
      setResult(j.result);
      const firstFail = j.result.tests.find((t: TestRunResult) => t.status === "fail");
      setOpenTest(firstFail?.id ?? j.result.tests[0]?.id ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setRunning(null);
    }
  }

  const byId = new Map((result?.tests ?? []).map((t) => [t.id, t]));
  const reportUrl = result?.reportPath ? `/api/artifacts?path=${encodeURIComponent(result.reportPath)}` : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary text-[12px]" onClick={() => run()} disabled={!!running || disabled}>
          {running === ALL ? <span className="flex items-center gap-2"><Spinner /> Corriendo…</span> : "▶ Correr toda la suite"}
        </button>
        {disabled && <span className="text-[11px] text-muted">Guardá los cambios para poder correr.</span>}
        {err && <span className="text-[11px] text-red-300">⚠ {err}</span>}
        {result && (
          <span className={`text-[12px] font-medium ${result.failed ? "text-red-300" : "text-green-300"}`}>
            {result.failed ? `✗ ${result.failed} en rojo` : "✓ Todo verde"} · {result.passed}/{result.tests.length} OK
          </span>
        )}
        {reportUrl && <button className="btn-ghost text-[12px]" onClick={() => setViewer(true)}>📄 Ver evidencia</button>}
      </div>

      {/* Lista de pruebas con corrida individual + resultado */}
      <div className="space-y-1">
        {tests.map((t) => {
          const res = byId.get(t.id);
          const open = openTest === t.id;
          const bad = res?.status === "fail";
          const border = !res ? "border-border" : bad ? "border-red-400/50" : "border-green-500/40";
          const bg = !res ? "" : bad ? "bg-red-500/10" : "bg-green-500/10";
          return (
            <div key={t.id} className={`rounded-md border overflow-hidden ${border}`}>
              <div className={`flex items-center gap-2 px-2.5 py-1.5 ${bg}`}>
                <button className="text-[12px] shrink-0" title="Correr solo esta prueba" onClick={() => run(t.id)} disabled={!!running}>
                  {running === t.id ? <Spinner /> : "▶"}
                </button>
                <button className="flex items-center gap-2 flex-1 text-left" onClick={() => res && setOpenTest(open ? null : t.id)}>
                  <span>{res ? (bad ? "✗" : "✓") : "•"}</span>
                  <span className="text-[12px] font-medium flex-1">{t.name}</span>
                  {res && <span className="text-[11px] text-muted">{res.cases.filter((c) => c.status === "pass").length}/{res.cases.length} pasos</span>}
                </button>
                {res && <span className="text-muted text-[11px]">{open ? "▾" : "▸"}</span>}
              </div>
              {res && open && (
                <div className="px-3 py-2 space-y-1 bg-panel2/20">
                  {res.warnings.map((w, i) => (
                    <p key={`w${i}`} className="text-[11px] text-warn">⚠ {w}</p>
                  ))}
                  <ol className="space-y-0.5">
                    {res.cases.map((c, i) => (
                      <li key={i} className="text-[11px] flex items-start gap-2">
                        <span className={c.status === "pass" ? "text-green-300" : "text-red-300"}>{c.status === "pass" ? "✓" : "✗"}</span>
                        <span className="flex-1">
                          {c.name}
                          {c.message && <span className="text-red-300"> — {c.message}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Visor de evidencia (reporte autocontenido: capturas + video) */}
      {viewer && reportUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setViewer(false)}>
          <div className="bg-panel rounded-lg border border-border w-full max-w-5xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-[13px] font-medium">Evidencia — {result?.suite}</span>
              <div className="flex items-center gap-2">
                <a className="btn-ghost text-[12px]" href={reportUrl} target="_blank" rel="noreferrer">Abrir en pestaña</a>
                <button className="btn-ghost text-[12px]" onClick={() => setViewer(false)}>Cerrar ✕</button>
              </div>
            </div>
            <iframe src={reportUrl} className="flex-1 w-full rounded-b-lg bg-white" title="Evidencia de regresión" />
          </div>
        </div>
      )}
    </div>
  );
}
