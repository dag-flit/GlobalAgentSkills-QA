"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui";

// Histórico y TENDENCIA de una suite: una grilla prueba × corrida con las últimas corridas (más
// antigua a la izquierda, más nueva a la derecha) + una señal por prueba (tasa de éxito, «inestable»,
// «recurrente»). Solo lectura (GET /api/regression/history). Se recarga sola tras cada corrida de suite.

interface HistoryTest { id: string; name: string; status: "pass" | "fail"; flaky?: boolean; attempts?: number; kinds?: string[] }
interface HistoryRun { runId: string; ranAt: string; total: number; passed: number; failed: number; flaky: number; tests: HistoryTest[] }

// Fecha/hora en la ZONA HORARIA del navegador (antes se cortaba el ISO en UTC → hora corrida).
function localWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Mark({ t }: { t: HistoryTest | undefined }) {
  if (!t) return <span className="text-muted/50" title="Esta prueba no existía en esa corrida">–</span>;
  if (t.status === "fail") return <span className="text-red-300" title="Falló">✗</span>;
  if (t.flaky) return <span className="text-warn" title={`Pasó pero inestable (pasó en el intento ${t.attempts ?? "?"})`}>*</span>;
  return <span className="text-green-300" title="Pasó">✓</span>;
}

export function RegressionHistory({ targetId, suiteId, refreshKey }: { targetId: string; suiteId: string; refreshKey: number }) {
  const [runs, setRuns] = useState<HistoryRun[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/regression/history?targetId=${encodeURIComponent(targetId)}&suiteId=${encodeURIComponent(suiteId)}`);
      const j = await r.json();
      setRuns(j.ok ? j.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [targetId, suiteId]);

  useEffect(() => {
    if (open) load();
  }, [open, refreshKey, load]);

  const ordered = runs ? [...runs].reverse() : []; // más antigua → más nueva (izquierda → derecha)
  const testMap = new Map<string, string>();
  for (const run of runs ?? []) for (const t of run.tests) if (!testMap.has(t.id)) testMap.set(t.id, t.name);
  const testIds = [...testMap.keys()];

  return (
    <div className="rounded-md border border-border bg-panel2/20">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="text-muted w-4">{open ? "▾" : "▸"}</span>
        <span className="text-[12px] font-medium">Histórico y tendencia</span>
        <span className="text-[11px] text-muted">{runs ? `· ${runs.length} corrida(s) registradas` : ""}</span>
        {loading && <Spinner />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {runs && runs.length === 0 && (
            <p className="text-[11px] text-muted">Todavía no hay corridas registradas. Corré <b>toda la suite</b> para empezar a ver la tendencia (las corridas de una sola prueba no se registran).</p>
          )}
          {runs && runs.length > 0 && (
            <>
              <p className="text-[11px] text-muted">
                Cada columna es una corrida de la suite completa (la más antigua a la izquierda, la más reciente a la
                derecha). Cada celda muestra cómo salió esa prueba en esa corrida.
              </p>
              <p className="text-[11px] text-muted">
                Leyenda: <span className="text-green-300">✓</span> pasó · <span className="text-red-300">✗</span> falló ·{" "}
                <span className="text-warn">*</span> pasó pero inestable · <span className="text-muted">–</span> no existía aún.
              </p>
              <div className="overflow-x-auto">
                <table className="text-[11px] border-collapse">
                  <thead>
                    <tr className="text-muted">
                      <th className="text-left font-medium pr-3 py-1 sticky left-0 bg-panel2/40">Prueba</th>
                      {ordered.map((run, i) => (
                        <th key={i} className="px-2 py-1 font-normal whitespace-nowrap text-center">
                          <a
                            className="text-accent hover:underline"
                            href={`/api/regression/evidence?targetId=${encodeURIComponent(targetId)}&suiteId=${encodeURIComponent(suiteId)}&runId=${encodeURIComponent(run.runId)}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Ver la evidencia (capturas) de esta corrida"
                          >
                            {localWhen(run.ranAt)}
                          </a>
                        </th>
                      ))}
                      <th className="pl-3 py-1 text-left font-medium">Señal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testIds.map((id) => {
                      const appears = ordered.filter((run) => run.tests.some((t) => t.id === id));
                      const fails = appears.filter((run) => run.tests.find((t) => t.id === id)?.status === "fail").length;
                      const flakies = appears.filter((run) => run.tests.find((t) => t.id === id)?.flaky).length;
                      const rate = appears.length ? Math.round(((appears.length - fails) / appears.length) * 100) : 0;
                      return (
                        <tr key={id} className="border-t border-border/40">
                          <td className="pr-3 py-1 sticky left-0 bg-panel2/40 max-w-[200px] truncate" title={testMap.get(id)}>{testMap.get(id)}</td>
                          {ordered.map((run, i) => (
                            <td key={i} className="px-2 py-1 text-center"><Mark t={run.tests.find((t) => t.id === id)} /></td>
                          ))}
                          <td className="pl-3 py-1 whitespace-nowrap">
                            <span className={rate === 100 ? "text-green-300" : rate >= 60 ? "text-warn" : "text-red-300"} title="Porcentaje de corridas en las que esta prueba pasó">{rate}% éxito</span>
                            {flakies > 0 && <span className="text-warn" title="Pasó tras reintentar en alguna corrida: conviene estabilizarla"> · inestable</span>}
                            {fails >= 2 && <span className="text-red-300" title="Falló en 2 o más corridas recientes: candidata a revisar/reportar"> · recurrente</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <button className="btn-ghost text-[11px]" onClick={load} disabled={loading}>Actualizar</button>
        </div>
      )}
    </div>
  );
}
