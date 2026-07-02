import { fmtTime } from "@/components/ui";
import type { RunRecord } from "@/lib/types";

/** Tarjeta de metadatos de la corrida (modo, tracker, tiempos, URL explorada). */
export function RunMeta({ record }: { record: RunRecord }) {
  return (
    <div className="card grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      <div>
        <div className="label">Modo</div>
        {record.mode}
      </div>
      <div>
        <div className="label">Tracker</div>
        {record.tracker}
      </div>
      <div>
        <div className="label">Inicio</div>
        {fmtTime(record.startedAt)}
      </div>
      <div>
        <div className="label">Fin</div>
        {fmtTime(record.finishedAt)}
      </div>
      {record.appUrl && (
        <div className="col-span-2 md:col-span-4">
          <div className="label">URL</div>
          <span className="font-mono text-xs break-all">{record.appUrl}</span>
        </div>
      )}
    </div>
  );
}
