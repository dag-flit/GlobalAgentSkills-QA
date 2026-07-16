import { runInTenant } from "@/lib/db/tenantContext";
import { touchHeartbeat } from "@/lib/db/runsRepo";

// Heartbeat de una corrida en curso: cada BEAT_MS escribe heartbeat_at = now() en la base. Así, si el
// proceso muere, el heartbeat deja de avanzar y la reconciliación perezosa la detecta como HUÉRFANA.
// Corre en el contexto de tenant capturado (runInTenant) → withTenant fija el GUC y RLS aísla. El
// ejecutor usa exec ASÍNCRONO (spawn), así que el event loop late aunque una herramienta tarde minutos.
const BEAT_MS = 15_000;

export function startHeartbeat(id: string, tenantId: string): NodeJS.Timeout {
  const beat = () => {
    // best-effort: un fallo de escritura no debe tumbar la corrida (se registra y se ignora).
    void runInTenant(tenantId, () => touchHeartbeat(id)).catch(() => {});
  };
  beat(); // un latido inmediato al arrancar
  const t = setInterval(beat, BEAT_MS);
  t.unref?.(); // no mantiene vivo el proceso solo por el intervalo
  return t;
}

export function stopHeartbeat(t: NodeJS.Timeout | null | undefined): void {
  if (t) clearInterval(t);
}
