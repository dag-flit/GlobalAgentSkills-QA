"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RunRecord } from "@/lib/types";
import { StatusBadge, fmtTime } from "@/components/ui";

export function RunsList() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/runs")
        .then((r) => r.json())
        .then((d) => {
          if (alive) setRuns(d.runs || []);
        })
        .catch(() => {});
    load();
    // refresco mientras haya corridas en ejecución
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!runs) return <p className="text-sm text-muted">Cargando…</p>;
  if (runs.length === 0)
    return (
      <p className="text-sm text-muted">
        Aún no hay corridas. Ve a <Link href="/" className="text-accent">Ejecutar</Link> para lanzar una.
      </p>
    );

  return (
    <ul className="space-y-2">
      {runs.map((r) => (
        <li key={r.id}>
          <Link
            href={`/runs/${r.id}`}
            className="card flex items-center gap-3 hover:border-accent transition-colors"
          >
            <StatusBadge status={r.status} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{r.title}</div>
              <div className="text-[11px] text-muted">
                {r.mode} · {r.tracker} · {fmtTime(r.createdAt)}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
