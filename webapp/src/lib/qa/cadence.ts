// cadence.ts — PURO: cálculo de la próxima corrida de un horario. Sin dependencias externas
// (usa Intl para la zona horaria). La cadencia se guarda como {kind, ...} y aquí se traduce a un
// instante UTC (next_run_at). El disparador externo es periódico; el tick corre lo vencido y llama
// a computeNextRun para avanzar el turno.

export type Cadence =
  | { kind: "hourly"; everyHours: number }
  | { kind: "daily"; time: string; tz?: string }
  | { kind: "weekly"; weekday: number; time: string; tz?: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Offset (ms) de una zona IANA en un instante dado (truco estándar formatToParts).
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(date)) p[x.type] = x.value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - date.getTime();
}

// Instante UTC de una hora de PARED (y-m-d h:mi) en una zona IANA.
function zonedWallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - tzOffsetMs(tz, new Date(guess)));
}

// Fecha de pared (y,mo,d + día de semana) de un instante visto en una zona.
function wallParts(date: Date, tz: string): { y: number; mo: number; d: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, weekday: WEEKDAYS.indexOf(p.weekday) };
}

function parseHM(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [0, 0];
}

const mod7 = (n: number): number => ((n % 7) + 7) % 7;

/** Próxima corrida ESTRICTAMENTE posterior a `from`. */
export function computeNextRun(cadence: Cadence, from: Date = new Date()): Date {
  if (cadence.kind === "hourly") {
    const hrs = Math.max(1, Math.floor(cadence.everyHours || 1));
    return new Date(from.getTime() + hrs * 3600_000);
  }
  const tz = cadence.tz || "UTC";
  const [h, mi] = parseHM(cadence.time);
  // Busca hasta 8 días adelante el primer instante válido posterior a `from` (cubre DST y semana).
  for (let add = 0; add <= 8; add++) {
    const base = new Date(from.getTime() + add * 86400_000);
    const w = wallParts(base, tz);
    if (cadence.kind === "weekly" && w.weekday !== mod7(cadence.weekday)) continue;
    const cand = zonedWallToUtc(w.y, w.mo, w.d, h, mi, tz);
    if (cand.getTime() > from.getTime()) return cand;
  }
  return new Date(from.getTime() + 86400_000); // fallback defensivo (no debería alcanzarse)
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Descripción legible de la cadencia (para la UI). */
export function describeCadence(c: Cadence): string {
  if (c.kind === "hourly") return `cada ${c.everyHours} h`;
  const tz = c.tz && c.tz !== "UTC" ? ` (${c.tz})` : " (UTC)";
  if (c.kind === "daily") return `diario a las ${c.time}${tz}`;
  return `cada ${DIAS[mod7(c.weekday)]} a las ${c.time}${tz}`;
}
