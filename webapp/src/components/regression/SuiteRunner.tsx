"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { AppConfig } from "@/lib/types";
import { DIAGNOSIS, type FailureKind } from "@/lib/qa/regressionSteps";
import { RegressionHistory } from "./RegressionHistory";

// Corre una suite COMPLETA o una PRUEBA puntual y muestra el resultado por prueba y por paso, más un
// visor de EVIDENCIA (reporte HTML autocontenido con capturas por paso + video) y —con tracker
// Azure— un botón para PUBLICAR EN ADO (una HU por prueba con su evidencia). Llama a
// /api/regression/run y /api/regression/publish (abren el navegador / crean la HU en el server). No
// maneja credenciales en el cliente.

interface StepResult { name: string; status: "pass" | "fail"; message?: string | null; kind?: FailureKind }
interface TestRunResult { id: string; name: string; status: "pass" | "fail"; steps: number; warnings: string[]; cases: StepResult[]; attempts?: number; flaky?: boolean }
interface SuiteRunResult { suite: string; tests: TestRunResult[]; passed: number; failed: number; flaky?: number; reportPath?: string; runId?: string }
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
  const [retries, setRetries] = useState(1); // anti-flaky: reintentos por prueba si falla
  const [histKey, setHistKey] = useState(0); // sube tras cada corrida de suite completa → recarga el histórico

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
        body: JSON.stringify({ targetId, suiteId, ...(testId ? { testId } : {}), retries }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo correr.");
      setResult(j.result);
      const firstFail = j.result.tests.find((t: TestRunResult) => t.status === "fail");
      setOpenTest(firstFail?.id ?? j.result.tests[0]?.id ?? null);
      if (!testId) setHistKey((k) => k + 1); // corrida de suite completa → refrescá la tendencia
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
          {running === ALL ? <span className="flex items-center gap-2"><Spinner /> Corriendo toda la suite…</span> : "Correr toda la suite"}
        </button>
        <label className="text-[11px] text-muted flex items-center gap-1" title="Si una prueba falla, se re-corre enseguida en una sesión limpia hasta esta cantidad de veces. Si pasa en un reintento, queda verde pero marcada «inestable» (no se esconde). Sirve para distinguir un fallo real de un parpadeo por tiempos. No es «correr la suite N veces».">
          Reintentos por prueba si falla
          <select className="input h-7 text-[12px] py-0" value={retries} onChange={(e) => setRetries(Number(e.target.value))} disabled={busy}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        {disabled && <span className="text-[11px] text-muted">Guardá los cambios para poder correr.</span>}
        {err && <span className="text-[11px] text-red-300">No se pudo correr: {err}</span>}
        {result && (
          <span className={`text-[12px] font-medium ${result.failed ? "text-red-300" : "text-green-300"}`}>
            {result.failed ? `Falló ${result.failed} de ${result.tests.length} prueba(s)` : `Pasaron las ${result.tests.length} prueba(s)`}
            {result.flaky ? <span className="text-warn"> · {result.flaky} inestable(s)</span> : null}
          </span>
        )}
        {reportUrl && (
          <a className="btn-primary text-[12px]" href={reportUrl} target="_blank" rel="noreferrer" title="Abre la evidencia (capturas + reproducción paso a paso) en una pestaña nueva">Abrir evidencia (capturas + reproducción)</a>
        )}
      </div>
      <p className="text-[11px] text-muted">El histórico registra solo las corridas de <b>toda la suite</b>. Correr una prueba suelta sirve para probar mientras armás, pero no suma a la tendencia.</p>

      {/* Publicar en ADO (solo con tracker Azure y una corrida con evidencia) */}
      {result?.runId && (
        <div className="rounded-md border border-border bg-panel2/20 px-3 py-2 space-y-1.5">
          {isAzure ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-primary text-[12px]" onClick={publish} disabled={busy}>
                  {publishing ? <span className="flex items-center gap-2"><Spinner /> Publicando…</span> : "Publicar en ADO"}
                </button>
                <span className="text-[11px] text-muted">Crea una HU por prueba en el sprint en curso, con las capturas por paso en el cuerpo (Description + Evidences).</span>
              </div>
              {pubErr && <p className="text-[11px] text-red-300">No se pudo publicar: {pubErr}</p>}
              {published && (
                <ul className="space-y-0.5 pt-1">
                  {published.map((p) => (
                    <li key={p.testId} className="text-[11px] flex items-start gap-2">
                      <span className={p.ok ? "text-green-300" : "text-red-300"}>{p.ok ? "✓" : "✗"}</span>
                      <span className="flex-1">
                        <b>{p.testName}</b>{" "}
                        {p.ok ? (
                          <>
                            {p.url ? <a className="text-accent underline" href={p.url} target="_blank" rel="noreferrer">HU #{p.id} creada — abrir en ADO</a> : <span>HU #{p.id} creada</span>}
                            {p.shots ? <span className="text-muted"> · {p.shots} captura(s) en el cuerpo</span> : null}
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
                  {running === t.id ? <Spinner /> : "Correr"}
                </button>
                <button className="flex items-center gap-2 flex-1 text-left" onClick={() => res && setOpenTest(open ? null : t.id)}>
                  <span className="text-[12px] font-medium flex-1">{t.name}</span>
                  {res ? (
                    <span className={`text-[11px] font-medium ${bad ? "text-red-300" : res.flaky ? "text-warn" : "text-green-300"}`}>
                      {bad ? "Falló" : res.flaky ? `Pasó, inestable (reintento ${res.attempts})` : "Pasó"} · {okSteps}/{res.cases.length} pasos
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
                  {/* Diagnóstico accionable de la causa del fallo → qué reportar a devs / corregir en la suite */}
                  {(Array.from(new Set(res.cases.filter((c) => c.status === "fail" && c.kind).map((c) => c.kind))) as FailureKind[]).map((k) => (
                    <div key={k} className="text-[11px] rounded border border-warn/40 bg-warn/10 px-2 py-1.5">
                      <span className="font-medium text-warn">{DIAGNOSIS[k].label}</span>
                      <span className="text-muted"> — {DIAGNOSIS[k].action}</span>
                    </div>
                  ))}
                  <ol className="space-y-0.5">
                    {res.cases.map((c, i) => (
                      <li key={i} className="text-[11px] flex items-start gap-2">
                        <span className={c.status === "pass" ? "text-green-300" : "text-red-300"}>{c.status === "pass" ? "✓" : "✗"}</span>
                        <span className="flex-1">
                          {c.name}
                          {c.message && <span className="text-red-300"> — {c.message}</span>}
                          {c.kind && <span className="text-warn" title={DIAGNOSIS[c.kind].action}> · {DIAGNOSIS[c.kind].label}</span>}
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

      {/* Histórico y tendencia (últimas corridas de suite completa) */}
      <RegressionHistory targetId={targetId} suiteId={suiteId} refreshKey={histKey} />
    </div>
  );
}
