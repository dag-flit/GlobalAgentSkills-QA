// flow-planner.mjs — planificador de guion E2E con IA LOCAL opcional (Ollama), detrás de una
// interfaz y con FALLBACK DETERMINISTA. El núcleo NUNCA depende de la IA:
//   · IA apagada / sin modelo / sin transporte  → generador determinista (ac-to-flow.mjs).
//   · IA encendida pero falla / responde vacío   → generador determinista (nunca rompe la corrida).
//   · IA encendida y responde bien               → guion saneado + scaffold (ir_a/login deterministas).
//
// Por qué IA aquí: los AC de FLIT suelen ser NARRATIVOS (no Gherkin con nombres de UI); el
// determinista los cubre mal. Un modelo local (los datos no salen de la máquina) lee AC + una
// captura del DOM y deduce los localizadores reales. La navegación y el login se mantienen
// DETERMINISTAS (los inyecta el planner), así la IA solo aporta acciones/verificaciones.
//
// Transporte HTTP INYECTABLE (`http`) → offline-testable: en el smoke se pasa un http falso.
// Contrato del http: async ({url, method, headers, body}) → { status, json, text }.

import { generateFlowFromAc, titleLooksBackend } from "./ac-to-flow.mjs";
import { sanitizeFlow } from "./flow-sanitize.mjs";

// ── prompt ──────────────────────────────────────────────────────────────────────
// Catálogo compacto que el modelo DEBE respetar. Se le pide SOLO acciones/verificaciones (sin
// ir_a/login: los pone el planner). Localizadores AMIGABLES por lo visible, credenciales por
// ${QA_USER}/${QA_PASS} (nunca valores reales), y `ac` en cada verificación (llena la cobertura).
const CATALOG = [
  'escribir  {por, en, valor}   — por: etiqueta|placeholder|texto|boton; en: texto visible del campo',
  'clic      {por:"boton", en}  — en: texto visible del botón/enlace',
  'seleccionar {por, en, valor} · marcar/desmarcar {por, en} · limpiar {por, en}',
  'esperar_texto {texto} · esperar {por, en}',
  'verificar_texto {texto, ac} · verificar_url {texto, ac} · verificar_titulo {texto, ac}',
  'verificar_visible {por, en, ac} · verificar_valor {por, en, valor, ac} · verificar_habilitado {por, en, ac}',
].join("\n");

function acsToText(acs) {
  return (acs || [])
    .map((a, i) => {
      const t = (a && a.title) || `AC ${i + 1}`;
      const d = (a && a.detail) || "";
      return `- ${t}${d ? `: ${d}` : ""}`;
    })
    .join("\n");
}

/** Recorta el volcado del DOM a lo útil (elementos interactivos), acotado en tamaño. */
function trimDom(dom, max = 6000) {
  if (!dom) return "";
  const s = String(dom);
  return s.length > max ? s.slice(0, max) + "\n…(recortado)" : s;
}

export function buildPrompt({ acs = [], title = "", dom = "" } = {}) {
  const domBlock = dom ? `\n\nPANTALLA (elementos visibles/interactivos de la app):\n${trimDom(dom)}` : "";
  return [
    "Eres un asistente de QA que arma un guion de prueba E2E para una app web.",
    "Devuelve SOLO un JSON con la forma: {\"flow\":[{op,...}], \"notes\":[\"...\"]}.",
    "Cada paso es un OBJETO con un campo \"op\" y sus campos. NO uses el nombre del paso como clave.",
    'Ejemplo EXACTO de forma: {"op":"escribir","por":"etiqueta","en":"Correo electrónico","valor":"ana@x.com"}',
    "Usa EXCLUSIVAMENTE estos pasos (no inventes ops ni campos):",
    CATALOG,
    "Reglas:",
    '- El campo "por" SOLO puede valer: etiqueta, placeholder, texto o boton (nada más).',
    "- NO incluyas navegación (ir_a) ni login: se agregan aparte.",
    "- Apunta por texto VISIBLE (etiqueta/placeholder/texto del botón), nunca por CSS técnico.",
    "- Para credenciales usa literalmente ${QA_USER} y ${QA_PASS} (jamás valores reales).",
    "- En cada verificación agrega el campo \"ac\" con el título del criterio que prueba.",
    "- Solo pasos accionables y verificaciones derivables de los criterios.",
    `\nHISTORIA: ${title}`,
    `\nCRITERIOS DE ACEPTACIÓN:\n${acsToText(acs)}${domBlock}`,
  ].join("\n");
}

// ── proveedor Ollama ─────────────────────────────────────────────────────────────
// POST {endpoint}/api/generate con format:"json" y stream:false → { response: "<json string>" }.
async function callOllama({ ai, prompt, http, signal }) {
  const endpoint = String(ai.endpoint || "").replace(/\/+$/, "");
  const res = await http({
    url: `${endpoint}/api/generate`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // temperature 0 → salida estable y apegada a las instrucciones (extracción estructurada).
    body: JSON.stringify({ model: ai.model, prompt, stream: false, format: "json", options: { temperature: 0 } }),
    signal,
  });
  if (!res || res.status < 200 || res.status >= 300) {
    throw new Error(`Ollama respondió HTTP ${res ? res.status : "?"}`);
  }
  // La respuesta de Ollama es { response: "<texto json>" }; el json real viene DENTRO de `response`.
  const outer = res.json || (res.text ? JSON.parse(res.text) : null);
  const inner = outer && typeof outer.response === "string" ? outer.response : "";
  if (!inner) throw new Error("Ollama no devolvió contenido en 'response'");
  return inner;
}

/** Parsea el JSON del modelo (tolerante a texto alrededor) → { flow, notes }. */
export function parseModelJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/); // rescata el primer objeto {...} si vino con ruido
    if (!m) throw new Error("La IA no devolvió JSON válido");
    obj = JSON.parse(m[0]);
  }
  const flow = Array.isArray(obj.flow) ? obj.flow : Array.isArray(obj.steps) ? obj.steps : [];
  const notes = Array.isArray(obj.notes) ? obj.notes.map(String) : [];
  return { flow, notes };
}

// ── scaffold: navegación + login deterministas alrededor de los pasos de la IA ────
function scaffold({ appUrl, login, body }) {
  const flow = [];
  if (appUrl) flow.push({ op: "ir_a", url: appUrl });
  if (login) flow.push({ op: "login" });
  flow.push(...body);
  return flow;
}

function actionable(flow) {
  return flow.some((s) => s.op !== "ir_a" && s.op !== "login");
}

// ── entrada principal ────────────────────────────────────────────────────────────
/**
 * Planifica el guion de una HU. Devuelve { flow, notes, e2eable, reason, origin }.
 * origin: "ia" (Ollama) | "determinista" (fallback/IA off).
 * @param {object} p
 * @param {Array}  p.acs      criterios [{title, detail}]
 * @param {string} p.appUrl   URL viva (primer paso ir_a)
 * @param {string} p.title    título de la HU
 * @param {boolean} p.login   anteponer login automático
 * @param {string} p.dom      volcado del DOM (recon) — opcional; mejora los localizadores
 * @param {object} p.ai       { enabled, endpoint, model }
 * @param {Function} p.http   transporte inyectable (default: http-retry). Si falta → sin IA.
 */
export async function planFlow({ acs = [], appUrl = "", title = "", login = false, dom = "", ai = null, http = null } = {}) {
  const det = () => {
    const r = generateFlowFromAc({ acs, appUrl, title, login });
    return { ...r, origin: "determinista" };
  };

  const aiOn = !!(ai && ai.enabled && ai.model && typeof http === "function");
  if (!aiOn) return det();

  // HU claramente backend/no-UI → ni IA ni intento; el determinista la marca no-E2E con su razón.
  if (titleLooksBackend(title)) return det();

  try {
    const prompt = buildPrompt({ acs, title, dom });
    const text = await callOllama({ ai, prompt, http });
    const { flow: rawFlow, notes: aiNotes } = parseModelJson(text);
    // La IA solo aporta acciones/verificaciones: se descartan ir_a/login (los pone el scaffold).
    const body = sanitizeFlow(rawFlow).filter((s) => s.op !== "ir_a" && s.op !== "login");
    if (!body.length) throw new Error("La IA no produjo pasos accionables tras el saneo");
    const flow = scaffold({ appUrl, login, body });
    if (!actionable(flow)) throw new Error("Guion sin pasos accionables");
    const notes = ["Guion generado con IA local (Ollama).", ...aiNotes.slice(0, 8)];
    return { flow, notes, e2eable: true, reason: "", origin: "ia" };
  } catch (e) {
    // Cualquier fallo de la IA → fallback determinista (nunca rompe la corrida).
    const fb = det();
    fb.notes = [`IA no disponible o inválida (${e && e.message ? e.message : e}); se usó el generador determinista.`, ...fb.notes];
    return fb;
  }
}

export default { planFlow, buildPrompt, parseModelJson };
