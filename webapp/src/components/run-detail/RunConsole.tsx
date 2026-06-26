import type { RunEvent } from "@/lib/types";
import { LEVEL_COLOR } from "./helpers";
import type { RunDetailCtl } from "./useRunDetail";

/** Consola en vivo: lista de eventos del run + toggle de auto-scroll. */
export function RunConsole({
  events,
  autoscroll,
  setAutoscroll,
  logRef,
}: {
  events: RunEvent[];
  autoscroll: boolean;
  setAutoscroll: (b: boolean) => void;
  logRef: RunDetailCtl["logRef"];
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm">Registro de ejecución</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div
        ref={logRef}
        className="h-[360px] overflow-y-auto rounded-lg bg-bg border border-border p-3 font-mono text-xs space-y-0.5"
      >
        {events.length === 0 && <div className="text-muted">Esperando eventos…</div>}
        {events.map((ev, i) => (
          <div key={i} className={LEVEL_COLOR[ev.level] || "text-gray-300"}>
            {ev.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
