"use client";

import Link from "next/link";
import { StatusBadge, Spinner } from "@/components/ui";
import { useRunDetail } from "@/components/run-detail/useRunDetail";
import { RunMeta } from "@/components/run-detail/RunMeta";
import { RunConsole } from "@/components/run-detail/RunConsole";
import { RunResults } from "@/components/run-detail/RunResults";

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
      <RunResults results={results} report={report} shots={shots} />
      {record?.error && <div className="card text-sm text-red-300">Error: {record.error}</div>}
    </div>
  );
}
