"use client";

import Link from "next/link";
import { StatusBadge, Spinner } from "@/components/ui";
import { useRunDetail } from "@/components/run-detail/useRunDetail";
import { RunMeta } from "@/components/run-detail/RunMeta";
import { RunConsole } from "@/components/run-detail/RunConsole";
import { RunResults } from "@/components/run-detail/RunResults";
import { AcContext } from "@/components/run-detail/AcContext";

export function RunDetail({ id }: { id: string }) {
  const { record, events, live, autoscroll, setAutoscroll, logRef, stop } = useRunDetail(id);

  const summary = record?.summary;
  const results: any[] = summary?.results || [];
  const report = summary?.report?.local || summary?.report;
  const shots: string[] = results
    .flatMap((r) => (Array.isArray(r.files) ? r.files : []))
    .filter((f) => /\.(png|jpe?g)$/i.test(f));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/runs" className="text-sm text-muted hover:text-white">
          ← Historial
        </Link>
        <h1 className="text-xl font-bold text-white">{record?.title || id}</h1>
        {record && <StatusBadge status={record.status} />}
        {live && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <Spinner /> en vivo
          </span>
        )}
        {record?.status === "running" && (
          <button className="btn-danger ml-auto text-xs px-2 py-1" onClick={stop}>
            Detener
          </button>
        )}
      </div>

      {record && <RunMeta record={record} />}

      {record?.mode === "code" && summary?.findingsWorkItem && (
        <FindingsWorkItemCard fw={summary.findingsWorkItem} />
      )}

      {summary?.fanout && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Fan-out del Feature {summary.feature}</h2>
          <ul className="text-sm space-y-1">
            {(summary.hus || []).map((h: any) => (
              <li key={h.id}>
                <span className={h.status === "passed" ? "text-green-300" : h.status === "failed" ? "text-red-300" : "text-muted"}>
                  {h.status === "passed" ? "✅" : h.status === "failed" ? "❌" : "⏭"}
                </span>{" "}
                HU {h.id}{h.title ? ` — ${h.title}` : ""} <span className="text-muted">({h.status})</span>
                {h.origen && (
                  <span className={`badge text-[10px] ml-1 ${/IA/.test(h.origen) ? "bg-accent/20 text-accent" : "bg-panel2 text-muted"}`}>
                    {/IA/.test(h.origen) ? "🤖 " : ""}guion {h.origen}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {Array.isArray(summary.warnings) && summary.warnings.length > 0 && (
            <div className="text-[11px] text-warn">{summary.warnings.length} aviso(s): HU sin guion guardado se saltaron.</div>
          )}
        </div>
      )}

      {results.some((r) => r.coverage) && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Cobertura de criterios de aceptación</h2>
          {results
            .filter((r) => r.coverage)
            .map((r, idx) => {
              const cov = r.coverage;
              return (
                <div key={idx} className="space-y-1">
                  {r.hu_id && <div className="text-xs text-muted">HU {r.hu_id}</div>}
                  <div className="text-xs text-muted">
                    ✅ {cov.passed} cubierto(s) · ❌ {cov.failed} con fallo · ⚠ {cov.uncovered} sin cubrir
                  </div>
                  <ul className="text-sm space-y-0.5">
                    {cov.rows.map((row: any, k: number) => (
                      <li key={k}>
                        <span className={row.status === "pass" ? "text-green-300" : row.status === "fail" ? "text-red-300" : "text-warn"}>
                          {row.status === "pass" ? "✅" : row.status === "fail" ? "❌" : "⚠"}
                        </span>{" "}
                        {row.ac}{" "}
                        <span className="text-muted">
                          ({row.status === "pass" ? "cubierto" : row.status === "fail" ? "con fallo" : "sin cubrir"})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>
      )}

      <RunConsole events={events} autoscroll={autoscroll} setAutoscroll={setAutoscroll} logRef={logRef} />

      {/* QA del código: criterios del Feature/HU como CONTEXTO, junto a los resultados (nivel 1: sin
          cruce automático AC↔prueba). Solo con WI de Azure. */}
      {record?.mode === "code" && (
        <AcContext wid={record.workItemId} tracker={record.tracker} />
      )}

      <RunResults results={results} report={report} shots={shots} />
      {record?.error && <div className="card text-sm text-red-300">Error: {record.error}</div>}
    </div>
  );
}

// Tarjeta de la HU de hallazgos (modo QA de código). La publicación en ADO es AUTOMÁTICA al terminar
// (paso 7 del ciclo): crea una User Story en el sprint en curso con el reporte adjunto. Esta tarjeta
// deja visible el resultado (enlace + sprint + reporte) o, si falló, el motivo (el reporte local igual
// quedó). Antes solo salía como un mensaje efímero en la consola en vivo.
function FindingsWorkItemCard({ fw }: { fw: any }) {
  if (fw.ok) {
    return (
      <div className="card space-y-2 border-accent/40">
        <h2 className="font-semibold text-sm text-white">Evidencias publicadas en Azure DevOps</h2>
        <div className="text-sm">
          <a href={fw.url} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
            HU #{fw.id} — {fw.title}
          </a>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {fw.iterationPath ? (
            <span className="badge bg-panel2 text-muted">Sprint: {fw.iterationPath}</span>
          ) : (
            <span className="badge bg-amber-900 text-amber-300">Backlog (no se resolvió el sprint en curso)</span>
          )}
          <span className={`badge ${fw.attached ? "bg-green-900 text-green-300" : "bg-panel2 text-muted"}`}>
            {fw.attached ? "Reporte adjunto" : "Sin adjunto"}
          </span>
          {fw.tagsSkipped && (
            <span className="badge bg-panel2 text-muted">Sin tags (falta el permiso «create tag definition» en ADO)</span>
          )}
        </div>
        <p className="text-[11px] text-muted">
          La publicación es automática al finalizar el análisis; cada corrida crea su propia HU de hallazgos.
        </p>
      </div>
    );
  }
  return (
    <div className="card space-y-1 border-red-500/40">
      <h2 className="font-semibold text-sm text-white">Publicación en Azure DevOps</h2>
      <p className="text-sm text-red-300">No se pudo crear la HU de hallazgos: {fw.reason || "motivo desconocido"}.</p>
      <p className="text-[11px] text-muted">Los hallazgos igual quedaron en el reporte local (ver abajo).</p>
    </div>
  );
}
