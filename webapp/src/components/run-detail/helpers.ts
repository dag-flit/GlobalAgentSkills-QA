import type { LogLevel, RunRecord } from "@/lib/types";

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

// Descripción en lenguaje claro de cada capa (para que técnicos y no técnicos entiendan igual).
export const LAYER_INFO: Record<string, { label: string; desc: string }> = {
  static: { label: "Análisis estático", desc: "Revisa tipos y errores del código sin ejecutar la app (tsc, eslint, ruff, mypy)." },
  unit: { label: "Pruebas unitarias", desc: "Ejecuta los tests del proyecto (vitest, jest, pytest, dotnet test)." },
  api: { label: "Contrato de API", desc: "Valida la especificación OpenAPI o una colección Postman." },
  e2e: { label: "Pruebas E2E", desc: "Corre los flujos de punta a punta en un navegador (Playwright/Cypress)." },
  db: { label: "Base de datos", desc: "Ejecuta migraciones o tests de datos (pgtap, prisma)." },
  security: { label: "Seguridad", desc: "Escanea el código en busca de vulnerabilidades (semgrep, bandit)." },
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

function huOf(name: string): string | null {
  const m = String(name || "").match(/\bHU[-\s]?(\d+)\b/i);
  return m ? m[1] : null;
}

/** Cobertura de HUs: ¿cada HU seleccionada tiene al menos una prueba etiquetada [HU-###]? */
export function computeCoverage(record: RunRecord | null, results: any[]) {
  const selectedHus = (record?.huIds || []).map(String);
  const showCoverage = record?.mode === "code" && selectedHus.length > 0 && record?.status !== "running";
  const coverageCount: Record<string, number> = {};
  let totalCases = 0;
  for (const r of results) {
    for (const c of Array.isArray(r.cases) ? r.cases : []) {
      totalCases += 1;
      const h = huOf(c.name);
      if (h) coverageCount[h] = (coverageCount[h] || 0) + 1;
    }
  }
  const coveredSet = new Set(Object.keys(coverageCount));
  const gaps = selectedHus.filter((id) => !coveredSet.has(id));
  const extra = [...coveredSet].filter((h) => !selectedHus.includes(h));
  return { selectedHus, showCoverage, coverageCount, totalCases, gaps, extra };
}
