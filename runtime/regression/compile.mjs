// compile.mjs — PURO / offline / SIN IA: traduce una PRUEBA de regresión (pasos que referencian
// ALIAS del catálogo) a un FLOW del motor (explore-steps). Resuelve cada alias contra el catálogo
// vigente del sistema, así los pasos quedan desacoplados del selector concreto (robustez).
//
// Detección de REGRESIÓN de selectores: si un paso referencia un alias que YA NO está en el catálogo
// (el sistema cambió tras un release), se reporta como WARNING accionable y se emite un paso que
// FALLA claramente en la corrida (no se omite en silencio → la prueba se pone en rojo y el humano
// reasigna el elemento). El vocabulario `by` del catálogo espeja el `por` del runner.

const BY_TO_POR = { role: "role", label: "etiqueta", testid: "testid", placeholder: "placeholder", text: "texto" };
const OP_LABELS = { clic: "clic", escribir: "escribir", seleccionar: "seleccionar", verificar_visible: "verificar que se ve" };

function joinUrl(base, route) {
  if (!route) return base || "";
  if (/^https?:\/\//i.test(route)) return route;
  return String(base || "").replace(/\/+$/, "") + "/" + String(route).replace(/^\/+/, "");
}

// alias → estrategia (los alias son únicos por catálogo; la primera aparición gana).
function indexCatalog(catalog) {
  const idx = new Map();
  for (const p of catalog?.pages ?? []) for (const e of p.elements ?? []) if (e && e.alias && !idx.has(e.alias)) idx.set(e.alias, e);
  return idx;
}

// Estrategia del catálogo → args de localización del motor (por/en[/rol]).
function locatorArgs(el) {
  if (el.by === "role") return { por: "role", rol: el.role, en: el.name };
  return { por: BY_TO_POR[el.by] || "css", en: el.value };
}

const needsElement = (op) => op === "clic" || op === "escribir" || op === "seleccionar" || op === "verificar_visible";

function compileStep(s, idx, baseUrl, warnings, i) {
  const n = i + 1;
  switch (s.op) {
    case "ir_a":
      return { op: "ir_a", url: joinUrl(baseUrl, s.ruta || "") };
    // Verificar texto → ESPERA a que el texto aparezca (hasta el timeout) en vez de mirar el DOM una
    // vez: en apps client-rendered (SPA) el contenido se pinta con retraso tras navegar/hacer clic.
    case "verificar_texto":
      return { op: "esperar_texto", texto: s.texto || "" };
    case "verificar_url":
      return { op: "verificar_url", texto: s.texto || "" };
    case "captura":
      return { op: "captura", nombre: s.nombre || `paso-${n}` };
  }
  if (needsElement(s.op)) {
    const el = s.alias ? idx.get(s.alias) : null;
    if (!el) {
      warnings.push({
        step: n,
        alias: s.alias || "",
        message: `El paso ${n} («${OP_LABELS[s.op] || s.op}») usa el elemento «${s.alias || "(sin elemento)"}», que ya no está en el catálogo. Volvé a escanear el sistema y reasigná el elemento en la prueba.`,
      });
      // Paso centinela: no matchea nunca → la corrida marca este paso en rojo (señal de regresión).
      return { op: "verificar_visible", por: "css", en: `[data-selector-ausente="${s.alias || "?"}"]` };
    }
    const loc = locatorArgs(el);
    if (s.op === "escribir" || s.op === "seleccionar") return { op: s.op, ...loc, valor: s.valor ?? "" };
    // Verificar que se ve → ESPERA a que el elemento esté visible (tolerante al render de la SPA).
    if (s.op === "verificar_visible") return { op: "esperar", ...loc };
    return { op: s.op, ...loc }; // clic
  }
  warnings.push({ step: n, message: `Paso ${n}: operación desconocida «${s.op}» (se omite).` });
  return null;
}

/**
 * Compila una prueba de regresión a un flow del motor.
 * @param {object} o
 * @param {{name?:string, steps:Array<object>}} o.test
 * @param {{baseUrl?:string, pages?:Array<{elements:Array<object>}>}} o.catalog
 * @param {boolean} [o.login]  anteponer login automático (suites que NO prueban el login en sí)
 * @returns {{flow:Array<object>, warnings:Array<{step:number, alias?:string, message:string}>}}
 */
export function compileTest({ test, catalog, login = false } = {}) {
  const idx = indexCatalog(catalog);
  const baseUrl = catalog?.baseUrl || "";
  const flow = [];
  const warnings = [];

  if (baseUrl) flow.push({ op: "ir_a", url: baseUrl }); // arrancar en la URL base del sistema
  if (login) flow.push({ op: "login" }); // login automático (credenciales por ${QA_USER}/${QA_PASS})

  (test?.steps ?? []).forEach((s, i) => {
    const step = compileStep(s, idx, baseUrl, warnings, i);
    if (step) flow.push(step);
  });
  return { flow, warnings };
}

export default { compileTest };
