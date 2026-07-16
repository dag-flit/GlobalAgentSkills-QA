// Registro mínimo de "stop solicitado" por run. El ejecutor inyectado consulta este flag
// antes de lanzar cada herramienta y corta si el usuario pidió detener.
const g = globalThis as any;
const stops: Set<string> = g.__qofStops ?? (g.__qofStops = new Set());
// Corridas que ESTE proceso está ejecutando ahora mismo (para distinguir una corrida viva de una
// HUÉRFANA de un proceso anterior). Si un id no está aquí, este proceso no la ejecuta: el "Detener"
// no puede cortarla cooperativamente y debe finalizarla en la base directamente.
const active: Set<string> = g.__qofActive ?? (g.__qofActive = new Set());

export function requestStop(runId: string): void {
  stops.add(runId);
}
export function isStopRequested(runId: string): boolean {
  return stops.has(runId);
}
export function clearStop(runId: string): void {
  stops.delete(runId);
}

/** Marca que este proceso empezó a ejecutar la corrida (la "posee"). */
export function markActive(runId: string): void {
  active.add(runId);
}
/** La corrida terminó (o su ejecución se soltó): este proceso ya no la posee. */
export function markDone(runId: string): void {
  active.delete(runId);
}
/** ¿Este proceso está ejecutando la corrida ahora mismo? */
export function isActive(runId: string): boolean {
  return active.has(runId);
}
/** Ids de las corridas que este proceso ejecuta (para excluirlas de la reconciliación de huérfanas). */
export function activeRunIds(): string[] {
  return [...active];
}
