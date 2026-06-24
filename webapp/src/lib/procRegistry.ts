// Registro mínimo de "stop solicitado" por run. El ejecutor inyectado consulta este flag
// antes de lanzar cada herramienta y corta si el usuario pidió detener.
const g = globalThis as any;
const stops: Set<string> = g.__qofStops ?? (g.__qofStops = new Set());

export function requestStop(runId: string): void {
  stops.add(runId);
}
export function isStopRequested(runId: string): boolean {
  return stops.has(runId);
}
export function clearStop(runId: string): void {
  stops.delete(runId);
}
