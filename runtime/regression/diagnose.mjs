// diagnose.mjs — clasifica POR QUÉ falló un paso de una prueba de regresión, para decirle al humano
// qué reportar a los devs o qué corregir en su suite. PURO/offline. Es una PISTA honesta (no un
// veredicto): una misma falla puede tener varias causas, así que cada categoría nombra las posibles.
//   selector  → un paso intentó USAR un elemento (clic/escribir/…) que no apareció → el elemento pudo
//               cambiar, o un paso anterior no dejó la pantalla esperada.
//   assertion → una VERIFICACIÓN no se cumplió (un texto/valor/estado/pantalla no apareció) → cambio en
//               la app, valor esperado desactualizado, o un paso anterior falló (p.ej. login con datos
//               incorrectos).
//   other     → corte por tiempo de carga / entorno / navegación.

// Verificaciones. Nota: al compilar, «verificar que se ve» → `esperar` y «verificar texto» →
// `esperar_texto` (tolerancia a SPA); por eso ambos cuentan como verificación, no como acción.
const ASSERTION_OPS = new Set([
  "esperar", "esperar_texto",
  "verificar_texto", "verificar_valor", "verificar_url", "verificar_titulo",
  "verificar_atributo", "verificar_cantidad", "verificar_habilitado", "verificar_marcado",
]);
// Acciones que TOCAN un elemento: si el elemento no aparece para actuar, apunta a un cambio de selector.
const ACTION_OPS = new Set([
  "clic", "escribir", "seleccionar", "marcar", "desmarcar", "limpiar", "subir_archivo", "tecla",
]);

// Operación del caso: viene en `op` (lo agrega el ejecutor); si no, se saca del nombre "N. <op> …".
function opOf(c) {
  if (c && c.op) return c.op;
  const m = /^\s*\d+\.\s*(\S+)/.exec(String((c && c.name) || ""));
  return m ? m[1] : "";
}

// Devuelve "selector" | "assertion" | "other" para un caso en FALLO (null si no falló).
export function classifyCase(c) {
  if (!c || c.status !== "fail") return null;
  const msg = String(c.message || "");
  // Alias ausente del catálogo (paso centinela del compilador) → cambio de selector, sin ambigüedad.
  if (/selector-ausente|ya no est|reasign/i.test(msg)) return "selector";
  const op = opOf(c);
  if (ASSERTION_OPS.has(op)) return "assertion";
  if (ACTION_OPS.has(op)) return "selector";
  return "other";
}

// Categorías presentes entre los casos en fallo de una prueba (para el resumen accionable por prueba).
export function diagnoseKinds(cases = []) {
  const set = new Set();
  for (const c of cases) {
    const k = classifyCase(c);
    if (k) set.add(k);
  }
  return [...set];
}

export const DIAGNOSIS = {
  selector: {
    label: "No se encontró un elemento",
    action:
      "Un paso intentó usar un elemento que no apareció. Puede que la app haya cambiado ese elemento (reportalo a los devs si no debía cambiar, o reasignalo re-escaneando el catálogo del sistema), o que un paso anterior no dejara la pantalla esperada.",
  },
  assertion: {
    label: "Una verificación no se cumplió",
    action:
      "Lo que se esperaba (un texto, un valor, un estado o una pantalla) no apareció. Puede ser un cambio en la app (reportalo a los devs), un valor esperado desactualizado en tu prueba (actualizalo), o que un paso anterior fallara (por ejemplo, un login con datos incorrectos).",
  },
  other: {
    label: "Corte por tiempo o entorno",
    action:
      "Pudo ser tiempo de carga, conectividad o navegación. Probá subir los reintentos, agregar una espera o revisar el paso.",
  },
};

export default { classifyCase, diagnoseKinds, DIAGNOSIS };
