// layer-explain.mjs — traduce el resultado de una capa de QA del código a lenguaje claro para el
// REPORTE (local-sink). Dos piezas: qué HACE la herramienta ejecutada (por comando, no por capa) y
// qué SIGNIFICÓ su resultado. Así, cuando algo dice "pasó/falló", se entiende por qué. Puro/offline.

// Qué hace cada herramienta concreta (no la capa): si el comando cambia, cambia la descripción.
const TOOL_DESC = {
  eslint: "linter de JS/TS: revisa estilo, errores y malas prácticas SIN ejecutar el código",
  tsc: "chequeo de tipos de TypeScript: verifica que los tipos sean correctos (no genera archivos)",
  ruff: "linter de Python: detecta errores y malas prácticas",
  mypy: "chequeo de tipos de Python (anotaciones de tipo)",
  vitest: "corre las pruebas unitarias del proyecto con Vitest",
  jest: "corre las pruebas unitarias del proyecto con Jest",
  pytest: "corre las pruebas unitarias de Python con pytest",
  "dotnet-test": "corre las pruebas unitarias de .NET (dotnet test)",
  postman: "ejecuta la colección Postman contra la API (newman)",
  openapi: "valida el contrato OpenAPI contra la especificación (redocly lint), sin servidor vivo",
  pgtap: "corre pruebas de base de datos con pgTAP (pg_prove)",
  prisma: "verifica el estado de las migraciones de Prisma",
  semgrep: "escáner de seguridad: busca patrones de vulnerabilidad (reglas tipo OWASP) en el código",
  bandit: "escáner de seguridad para Python: detecta usos inseguros comunes",
};

// Descripción de respaldo por capa cuando la herramienta no está en el mapa.
const LAYER_DESC = {
  static: "revisa el código sin ejecutarlo (linter / chequeo de tipos)",
  unit: "corre las pruebas unitarias del proyecto",
  api: "valida el contrato de la API",
  db: "verificaciones de base de datos",
  security: "escáner de seguridad del código",
  explore: "explora una URL viva (estado HTTP, consola, captura)",
};

/** Qué hace el comando ejecutado (por herramienta; cae a la capa si la herramienta es desconocida). */
export function toolDescription(tool, layer) {
  if (tool && TOOL_DESC[tool]) return TOOL_DESC[tool];
  return LAYER_DESC[layer] || "";
}

/** Qué significó el resultado, en lenguaje claro (findings/pass/fail/advertencias/fallo-sin-detalle). */
export function interpretLayer(r) {
  const layer = r.layer;
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c) => c.status === "pass").length;
  const f = cases.filter((c) => c.status === "fail").length;
  const other = cases.length - p - f; // advertencias (static) / saltados o pendientes (unit)

  if (r.status === "skip") {
    return `No se ejecutó: ${r.narrative || "no aplicaba o la herramienta no está en el proyecto"}.`;
  }
  // Falló pero sin desglose por caso (tsc, pytest, dotnet, redocly… no emiten JSON por caso).
  if (r.status === "fail" && cases.length === 0) {
    return "La herramienta terminó en ERROR (código ≠ 0) pero no listó las pruebas una por una. El motivo exacto está en «Capas con fallo (sin desglose)» y en el detalle técnico.";
  }
  if (layer === "static") {
    return f > 0
      ? `Encontró ${f} error(es) que hay que corregir${other ? ` y ${other} advertencia(s) menor(es)` : ""}.`
      : other > 0
        ? `PASÓ porque el linter NO encontró errores (los errores son lo único que bloquea). Lo que ves como “saltados” son ${other} ADVERTENCIA(s): avisos de estilo o buenas prácticas, de severidad baja (p. ej. usar el componente de imagen optimizado, o una variable declarada y no usada). No rompen ni bloquean la app, pero conviene revisarlas — están listadas abajo.`
        : "PASÓ: el linter no encontró ni errores ni advertencias. Código limpio.";
  }
  if (layer === "security") {
    return f > 0
      ? `Encontró ${f} posible(s) hallazgo(s) de seguridad — revisá el detalle.`
      : "No encontró patrones de vulnerabilidad conocidos. Es un escaneo automático: reduce riesgo, no garantiza seguridad total.";
  }
  if (cases.length) {
    return f > 0
      ? `De ${cases.length} caso(s): ${f} fallaron y ${p} pasaron${other ? `, ${other} saltado(s)` : ""}.`
      : `Los ${p} caso(s) ejecutados pasaron${other ? ` (${other} saltado[s]/pendiente[s])` : ""}.`;
  }
  return r.status === "pass"
    ? "Se ejecutó sin errores: la herramienta no reportó problemas."
    : "Falló — revisá el detalle / el reporte.";
}

export default { toolDescription, interpretLayer };
