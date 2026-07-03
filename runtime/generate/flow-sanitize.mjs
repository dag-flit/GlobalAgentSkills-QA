// flow-sanitize.mjs — validación/saneo ESTRICTO de un guion producido por la IA (Ollama) antes de
// que se convierta en pasos EJECUTABLES. La salida de un modelo NO es de confianza: se filtra
// contra el registro real de pasos (`STEPS` de explore-steps.mjs, fuente única de ops válidos),
// se descartan ops/campos desconocidos, se acotan longitudes y se exigen los campos mínimos. Puro
// y offline. Objetivo: que un modelo comprometido/errático NUNCA inyecte un paso arbitrario.

import { STEPS, normalizeStep } from "../runners/explore-steps.mjs";

// Ops válidos = los del registro real (single source of truth). Si el modelo nombra otro → se cae.
const VALID_OPS = new Set(Object.keys(STEPS));

// Estrategias de localizador amigables admitidas (`por`). Cualquier otra → se descarta el campo
// (evita que el modelo cuele CSS arbitrario disfrazado; el runner sin `por` cae a css con `en`).
const VALID_POR = new Set(["etiqueta", "label", "placeholder", "texto", "text", "boton", "rol", "role", "css"]);

// Campos permitidos por op (whitelist). Lo que no esté aquí se descarta silenciosamente.
const ARGS = {
  ir_a: ["url"],
  login: ["usuario", "clave"],
  escribir: ["por", "en", "rol", "valor"],
  clic: ["por", "en", "rol"],
  tecla: ["tecla", "por", "en", "rol"],
  seleccionar: ["por", "en", "rol", "valor"],
  marcar: ["por", "en", "rol"],
  desmarcar: ["por", "en", "rol"],
  subir_archivo: ["por", "en", "rol", "ruta", "valor"],
  limpiar: ["por", "en", "rol"],
  esperar: ["por", "en", "rol", "estado"],
  esperar_texto: ["texto"],
  verificar_visible: ["por", "en", "rol", "ac"],
  verificar_texto: ["texto", "ac"],
  verificar_valor: ["por", "en", "rol", "valor", "ac"],
  verificar_cantidad: ["por", "en", "rol", "numero", "valor", "ac"],
  verificar_url: ["texto", "ac"],
  verificar_titulo: ["texto", "ac"],
  verificar_atributo: ["por", "en", "rol", "nombre", "valor", "ac"],
  verificar_habilitado: ["por", "en", "rol", "ac"],
  verificar_marcado: ["por", "en", "rol", "ac"],
  captura: ["nombre"],
};

// Campo(s) mínimos obligatorios: sin ellos el paso no es accionable → se descarta.
const REQUIRES = {
  escribir: ["en"],
  clic: ["en"],
  tecla: ["tecla"],
  seleccionar: ["en", "valor"],
  marcar: ["en"],
  desmarcar: ["en"],
  subir_archivo: ["en"],
  limpiar: ["en"],
  esperar: ["en"],
  esperar_texto: ["texto"],
  verificar_visible: ["en"],
  verificar_texto: ["texto"],
  verificar_valor: ["en"],
  verificar_cantidad: ["en"],
  verificar_url: ["texto"],
  verificar_titulo: ["texto"],
  verificar_atributo: ["en", "nombre"],
  verificar_habilitado: ["en"],
  verificar_marcado: ["en"],
  ir_a: ["url"],
};

const MAX_LEN = 300; // longitud máxima de cualquier valor de texto (corta ruido del modelo)
const MAX_STEPS = 60; // tope de pasos por guion (evita salidas desbocadas)

function clean(value) {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

// ¿El valor de `en` parece un selector CSS (y no un texto visible)? Si lo parece, se respeta el
// modo css; si no, se puede inferir un localizador amigable (etiqueta/boton).
function looksCss(s) {
  return /^[.#\[]/.test(s) || /[>~]|\s\.[a-z]|::|\]$/.test(s);
}

/**
 * Sanea UN paso de guion producido por el modelo. Robusto a la VARIANZA de forma del LLM:
 * primero normaliza con `normalizeStep` (acepta {op,...}, la forma abreviada {clic:{...}} y el
 * atajo "url"), luego valida el op contra el registro y filtra los campos a la whitelist. Si un
 * paso con localizador trae un `por` inválido/ausente pero un `en` que parece texto visible,
 * infiere un localizador AMIGABLE (boton para clic, etiqueta para el resto) → match por subcadena
 * en el runner, en vez de caer a un css roto. Devuelve el paso saneado o null.
 */
export function sanitizeStep(raw) {
  if (!raw || (typeof raw !== "object" && typeof raw !== "string")) return null;
  const norm = normalizeStep(raw); // → { op, args }
  const op = typeof norm.op === "string" ? norm.op.trim() : "";
  if (!VALID_OPS.has(op)) return null;
  const src = norm.args || {};
  const allowed = ARGS[op] || [];
  const out = { op };
  for (const field of allowed) {
    const v = clean(src[field]);
    if (v === undefined) continue;
    if (field === "por" && !VALID_POR.has(String(v))) continue; // estrategia desconocida → se ignora
    if (field === "numero") {
      const n = Number(v);
      if (Number.isFinite(n)) out.numero = n;
      continue;
    }
    out[field] = v;
  }
  // Inferir un localizador amigable cuando el op lo usa (`por` en su whitelist), quedó sin `por`
  // válido, hay `en` y no parece CSS. Rescata los pasos con `por` inventado por el modelo.
  if (allowed.includes("por") && out.por === undefined && typeof out.en === "string" && !looksCss(out.en)) {
    out.por = op === "clic" ? "boton" : "etiqueta";
  }
  for (const req of REQUIRES[op] || []) {
    if (out[req] === undefined) return null; // falta un campo mínimo → paso inservible
  }
  return out;
}

/** Sanea un guion completo (array). Descarta pasos inválidos y recorta al tope. */
export function sanitizeFlow(rawFlow) {
  if (!Array.isArray(rawFlow)) return [];
  const out = [];
  for (const raw of rawFlow) {
    const s = sanitizeStep(raw);
    if (s) out.push(s);
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

export default { sanitizeStep, sanitizeFlow, VALID_OPS };
