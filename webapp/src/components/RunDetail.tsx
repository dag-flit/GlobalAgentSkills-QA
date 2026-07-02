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
      <RunConsole events={events} autoscroll={autoscroll} setAutoscroll={setAutoscroll} logRef={logRef} />
      <RunResults results={results} report={report} shots={shots} />
      {record?.error && <div className="card text-sm text-red-300">Error: {record.error}</div>}
    </div>
  );
}
