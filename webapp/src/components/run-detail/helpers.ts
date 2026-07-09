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

// Descripción en lenguaje claro de cada capa (exploración E2E + capas de QA del código).
export const LAYER_INFO: Record<string, { label: string; desc: string }> = {
  explore: { label: "Exploración de URL", desc: "Abre la app en un navegador: revisa estado HTTP, errores de consola y guarda una captura." },
  static: { label: "Análisis estático", desc: "Linter / type-checker: revisa estilo, tipos y reglas del código (eslint, tsc, ruff, mypy)." },
  unit: { label: "Pruebas unitarias", desc: "Corre la suite de tests del repo (vitest, jest, pytest, dotnet test)." },
  api: { label: "Contrato de API", desc: "Valida el contrato OpenAPI (redocly) o corre colecciones Postman (newman)." },
  db: { label: "Base de datos", desc: "Checks de BD (pgTAP / prisma) usando la conexión del entorno." },
  security: { label: "Seguridad", desc: "Escáner SAST (semgrep / bandit): patrones de vulnerabilidad en el código." },
};

export const STATUS_TXT: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASÓ", cls: "bg-green-900 text-green-300" },
  fail: { label: "FALLÓ", cls: "bg-red-900 text-red-300" },
  skip: { label: "OMITIDA", cls: "bg-panel2 text-muted" },
};

// Explicación en lenguaje claro de una capa: QUÉ hace la herramienta (para qué sirve) y QUÉ significó
// su resultado. Pensado para alguien NO técnico: nada de "exit 0", sí "no encontró problemas". Así,
// cuando algo dice "pasó", queda claro POR QUÉ pasó.
export function layerNarrative(r: any): { what: string; result: string } {
  const layer = r.layer as string;
  const tool = r.metrics?.tool as string | undefined;
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c: any) => c.status === "pass").length;
  const f = cases.filter((c: any) => c.status === "fail").length;
  const other = cases.length - p - f; // advertencias (static) / saltados o pendientes (unit)

  // Descripción POR HERRAMIENTA (no por capa): si el comando cambia, cambia la descripción.
  const TOOL_WHAT: Record<string, string> = {
    eslint: "Linter de JS/TS: revisa estilo, errores y malas prácticas SIN ejecutar el código.",
    tsc: "Chequeo de tipos de TypeScript: verifica que los tipos sean correctos (no genera archivos).",
    ruff: "Linter de Python: detecta errores y malas prácticas.",
    mypy: "Chequeo de tipos de Python (anotaciones de tipo).",
    vitest: "Corre las pruebas unitarias del proyecto con Vitest.",
    jest: "Corre las pruebas unitarias del proyecto con Jest.",
    pytest: "Corre las pruebas unitarias de Python con pytest.",
    "dotnet-test": "Corre las pruebas unitarias de .NET (dotnet test).",
    postman: "Ejecuta la colección Postman contra la API (newman).",
    openapi: "Valida el contrato OpenAPI contra la especificación (redocly), sin servidor vivo.",
    pgtap: "Corre pruebas de base de datos con pgTAP.",
    prisma: "Verifica el estado de las migraciones de Prisma.",
    semgrep: "Escáner de seguridad: busca patrones de vulnerabilidad (OWASP) en el código.",
    bandit: "Escáner de seguridad para Python: detecta usos inseguros comunes.",
  };
  const WHAT: Record<string, string> = {
    static: "Revisa el código SIN ejecutarlo, buscando errores de tipos, estilo y malas prácticas.",
    unit: "Ejecuta las pruebas unitarias del proyecto: comprueba que cada parte haga lo que debe.",
    api: "Valida que la API cumpla el contrato que declara, sin necesitar el servidor corriendo.",
    db: "Corre verificaciones sobre la base de datos usando la conexión del entorno.",
    security: "Escanea el código en busca de patrones de vulnerabilidad conocidos, estilo OWASP.",
  };
  const what = (tool && TOOL_WHAT[tool]) || WHAT[layer] || (tool ? `Herramienta ejecutada: ${tool}.` : "");

  if (r.status === "skip") {
    return { what, result: `No se ejecutó — ${r.narrative || "no aplicaba o la herramienta no está en el proyecto"}.` };
  }
  // Falló sin desglose por caso (tsc/pytest/dotnet/redocly no emiten JSON por caso).
  if (r.status === "fail" && cases.length === 0) {
    return { what, result: "La herramienta terminó en ERROR (código ≠ 0) pero no listó las pruebas una por una. El motivo está en «Qué pasó» aquí abajo y en el detalle técnico." };
  }
  let result: string;
  if (layer === "static") {
    result = f > 0
      ? `Encontró ${f} error(es) que hay que corregir${other ? ` y ${other} advertencia(s) menor(es)` : ""}.`
      : other > 0
        ? `PASÓ porque el linter NO encontró errores (los errores son lo único que bloquea). Lo que aparece como “saltados” son ${other} ADVERTENCIA(s): avisos de estilo o buenas prácticas, de severidad baja (p. ej. usar el componente de imagen optimizado, o una variable declarada y sin usar). No rompen ni bloquean la app, pero conviene revisarlas — están listadas abajo.`
        : `PASÓ: el linter no encontró ni errores ni advertencias. Código limpio.`;
  } else if (layer === "security") {
    result = f > 0
      ? `Encontró ${f} posible(s) hallazgo(s) de seguridad — revisá el detalle abajo.`
      : `No encontró patrones de vulnerabilidad conocidos. Es un escaneo automático: reduce riesgo, no garantiza seguridad total.`;
  } else if (cases.length) {
    result = f > 0
      ? `De ${cases.length} caso(s): ❌ ${f} fallaron y ✅ ${p} pasaron${other ? `, ⏭ ${other} saltado(s)` : ""}.`
      : `Los ${p} caso(s) ejecutados pasaron${other ? ` (⏭ ${other} saltado[s]/pendiente[s])` : ""}.`;
  } else {
    result = r.status === "pass"
      ? `Se ejecutó sin errores: la herramienta no reportó problemas.`
      : `Falló — revisá el detalle / el reporte.`;
  }
  return { what, result };
}

export const artifactUrl = (p: string) => `/api/artifacts?path=${encodeURIComponent(p)}`;
