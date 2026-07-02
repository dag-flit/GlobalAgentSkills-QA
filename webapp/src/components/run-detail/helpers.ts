import type { LogLevel } from "@/lib/types";

// Constantes y utilidades del detalle de corrida (RunDetail). Extraídas para repartir el
// componente en archivos bajo el límite de líneas.

export const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-blue-300",
  stdout: "text-gray-300",
  stderr: "text-amber-300",
  agent: "text-green-300",
  tool: "text-violet-300",
  result: "text-cyan-300",
  error: "text-red-300",
  system: "text-muted",
};

// Descripción en lenguaje claro de la capa de exploración.
export const LAYER_INFO: Record<string, { label: string; desc: string }> = {
  explore: { label: "Exploración de URL", desc: "Abre la app en un navegador: revisa estado HTTP, errores de consola y guarda una captura." },
};

export const STATUS_TXT: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASÓ", cls: "bg-green-900 text-green-300" },
  fail: { label: "FALLÓ", cls: "bg-red-900 text-red-300" },
  skip: { label: "OMITIDA", cls: "bg-panel2 text-muted" },
};

/** Frase clara según el resultado y sus casos. */
export function statusSentence(r: any): string {
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c: any) => c.status === "pass").length;
  const f = cases.filter((c: any) => c.status === "fail").length;
  if (r.status === "pass") {
    return cases.length
      ? `Sin problemas — ${p} verificación(es) pasaron.`
      : "Ejecutado sin errores (la herramienta no reportó problemas).";
  }
  if (r.status === "fail") {
    return f ? `Se encontraron ${f} problema(s) — revisa el detalle.` : "Falló — revisa el detalle / el reporte.";
  }
  return "Capa omitida (no aplicaba o faltó la herramienta).";
}

export const artifactUrl = (p: string) => `/api/artifacts?path=${encodeURIComponent(p)}`;
