"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { AppConfig } from "@/lib/types";

// Corre una suite COMPLETA o una PRUEBA puntual y muestra el resultado por prueba y por paso, más un
// visor de EVIDENCIA (reporte HTML autocontenido con capturas por paso + video) y —con tracker
// Azure— un botón para PUBLICAR EN ADO (una HU por prueba con su evidencia). Llama a
// /api/regression/run y /api/regression/publish (abren el navegador / crean la HU en el server). No
// maneja credenciales en el cliente.

interface StepResult { name: string; status: "pass" | "fail"; message?: string | null }
interface TestRunResult { id: string; name: string; status: "pass" | "fail"; steps: number; warnings: string[]; cases: StepResult[] }
interface SuiteRunResult { suite: string; tests: TestRunResult[]; passed: number; failed: number; reportPath?: string; runId?: string }
interface PublishedItem { testId: string; testName: string; ok: boolean; id?: string; url?: string; shots?: number; reason?: string }

const ALL = "__all__";

export function SuiteRunner({ targetId, suiteId, tests, disabled }: { targetId: string; suiteId: string; tests: Array<{ id: string; name: string }>; disabled?: boolean }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<SuiteRunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [isAzure, setIsAzure] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishedItem[] | null>(null);
  const [pubErr, setPubErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((c: AppConfig) => setIsAzure(c?.tracker?.selected === "azure-devops")).catch(() => setIsAzure(false));
  }, []);

  async function run(testId?: string) {
    setRunning(testId ?? ALL);
    setErr(null);
    setPublished(null);
    setPubErr(null);
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

  async function publish() {
    if (!result?.runId) return;
    setPublishing(true);
    setPubErr(null);
    setPublished(null);
    try {
      const r = await fetch("/api/regression/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, suiteId, runId: result.runId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo publicar.");
      setPublished(j.published ?? []);
    } catch (e: any) {
      setPubErr(e?.message ?? "error");
    } finally {
      setPublishing(false);
    }
  }

  const byId = new Map((result?.tests ?? []).map((t) => [t.id, t]));
  const reportUrl = result?.reportPath ? `/api/artifacts?path=${encodeURIComponent(result.reportPath)}` : null;
  const busy = !!running || publishing;

  return (
    <div className="space-y-3">
      {/* Acción principal + resumen del resultado */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary text-[12px]" onClick={() => run()} disabled={busy || disabled}>
          {running === ALL ? <span className="flex items-center gap-2"><Spinner /> Corriendo toda la suite…</span> : "▶ Correr toda la suite"}
        </button>
        {disabled && <span className="text-[11px] text-muted">Guardá los cambios para poder correr.</span>}
        {err && <span className="text-[11px] text-red-300">No se pudo correr: {err}</span>}
        {result && (
          <span className={`text-[12px] font-medium ${result.failed ? "text-red-300" : "text-green-300"}`}>
            {result.failed ? `Falló ${result.failed} de ${result.tests.length} prueba(s)` : `Pasaron las ${result.tests.length} prueba(s)`}
          </span>
        )}
        {reportUrl && (
          <a className="btn-primary text-[12px]" href={reportUrl} target="_blank" rel="noreferrer" title="Abre la evidencia (capturas + reproducción paso a paso) en una pestaña nueva">Abrir evidencia (capturas + reproducción) ↗</a>
        )}
      </div>

      {/* Publicar en ADO (solo con tracker Azure y una corrida con evidencia) */}
      {result?.runId && (
        <div className="rounded-md border border-border bg-panel2/20 px-3 py-2 space-y-1.5">
          {isAzure ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-primary text-[12px]" onClick={publish} disabled={busy}>
                  {publishing ? <span className="flex items-center gap-2"><Spinner /> Publicando…</span> : "Publicar en ADO"}
                </button>
                <span className="text-[11px] text-muted">Crea una HU por prueba, con su evidencia adjunta, en el sprint en curso.</span>
              </div>
              {pubErr && <p className="text-[11px] text-red-300">No se pudo publicar: {pubErr}</p>}
              {published && (
                <ul className="space-y-0.5 pt-1">
                  {published.map((p) => (
                    <li key={p.testId} className="text-[11px] flex items-start gap-2">
                      <span className={p.ok ? "text-green-300" : "text-red-300"}>{p.ok ? "✔" : "✗"}</span>
                      <span className="flex-1">
                        <b>{p.testName}</b>{" "}
                        {p.ok ? (
                          <>
                            {p.url ? <a className="text-accent underline" href={p.url} target="_blank" rel="noreferrer">HU #{p.id} creada — abrir en ADO</a> : <span>HU #{p.id} creada</span>}
                            {p.shots ? <span className="text-muted"> · {p.shots} captura(s) adjunta(s)</span> : null}
                          </>
                        ) : (
                          <span className="text-red-300">no se creó — {p.reason}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted">Para publicar el resultado en Azure DevOps, elegí <b>Azure</b> como tracker en Ajustes.</p>
          )}
        </div>
      )}

      {/* Pruebas: correr una sola + ver su detalle */}
      <div className="space-y-1">
        {tests.map((t) => {
          const res = byId.get(t.id);
          const open = openTest === t.id;
          const bad = res?.status === "fail";
          const border = !res ? "border-border" : bad ? "border-red-400/50" : "border-green-500/40";
          const bg = !res ? "" : bad ? "bg-red-500/10" : "bg-green-500/10";
          const okSteps = res ? res.cases.filter((c) => c.status === "pass").length : 0;
          return (
            <div key={t.id} className={`rounded-md border overflow-hidden ${border}`}>
              <div className={`flex items-center gap-2 px-2.5 py-1.5 ${bg}`}>
                <button className="btn-ghost text-[11px] shrink-0 px-2" title="Correr solo esta prueba" onClick={() => run(t.id)} disabled={busy}>
                  {running === t.id ? <Spinner /> : "▶ Correr"}
                </button>
                <button className="flex items-center gap-2 flex-1 text-left" onClick={() => res && setOpenTest(open ? null : t.id)}>
                  <span className="text-[12px] font-medium flex-1">{t.name}</span>
                  {res ? (
                    <span className={`text-[11px] font-medium ${bad ? "text-red-300" : "text-green-300"}`}>
                      {bad ? "Falló" : "Pasó"} · {okSteps}/{res.cases.length} pasos
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted">sin correr</span>
                  )}
                </button>
                {res && <span className="text-muted text-[11px]">{open ? "▾" : "▸"}</span>}
              </div>
              {res && open && (
                <div className="px-3 py-2 space-y-1 bg-panel2/20">
                  {res.warnings.map((w, i) => (
                    <p key={`w${i}`} className="text-[11px] text-warn">Aviso de regresión: {w}</p>
                  ))}
                  <ol className="space-y-0.5">
                    {res.cases.map((c, i) => (
                      <li key={i} className="text-[11px] flex items-start gap-2">
                        <span className={c.status === "pass" ? "text-green-300" : "text-red-300"}>{c.status === "pass" ? "✔" : "✗"}</span>
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

    </div>
  );
}
