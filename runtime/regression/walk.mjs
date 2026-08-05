// walk.mjs — camina un RECORRIDO (asistente multi-pantalla: Matrícula Inicial, Traspaso…) y cataloga
// CADA etapa en una sola pasada. Modelo: un Recorrido = etapas ORDENADAS; cada etapa dice "cosechá acá"
// (sus selectores) y "cómo avanzo a la siguiente" (sus pasos de avance, que referencian ALIAS ya
// catalogados). El escáner navega a la entrada, inicia sesión si aplica y por cada etapa: cosecha el
// DOM visible → ejecuta el avance → cosecha la siguiente. Así la etapa N hereda TODO lo previo sin
// reescribirlo, y la URL puede ser un hash dinámico (nunca se navega a ella: se LLEGA completando el
// flujo). Determinista, SIN IA; navegador INYECTADO → offline-testable. Si un avance falla o falta,
// se detiene y reporta hasta dónde llegó (para que el humano defina el siguiente tramo e itere).

import { STEPS, settleSpa, normalizeStep } from "../runners/explore-steps.mjs";
import { buildCatalogPage } from "./harvest.mjs";
import { readVisibleNodes, joinUrl } from "./scan.mjs";
import { compileSteps } from "./compile.mjs";

const DEFAULT_TIMEOUT = 20000;

/** Nombre de la página del catálogo para una etapa: «<Recorrido> › <Etapa>» (breadcrumb → jerarquía). */
export function stageName(recorridoName, stage) {
  const r = String(recorridoName || "Recorrido").trim();
  const s = String(stage || "").trim();
  return s ? `${r} › ${s}` : r;
}

/** Prefijo común de todas las páginas de un recorrido (para reemplazar su bloque al re-caminar). */
export function stagePrefix(recorridoName) {
  return `${String(recorridoName || "Recorrido").trim()} › `;
}

// Ejecuta los pasos de AVANCE de una etapa (los que llevan a la siguiente). Los compila contra el
// catálogo (alias→localizador) y los despacha con el registro de pasos del motor (mismos handlers que
// una corrida real). Falla en el primer paso que no cumple → el walk se detiene ahí con el motivo.
// ¿Está visible ese texto en la página? Chequeo NO lanzante (para la guardia de una etapa condicional).
// Espera corto: si en `timeout` no aparece, la etapa condicional no aplica y se salta.
async function guardVisible(page, text, timeout) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function runAdvance(stepsRaw, { page, catalog, baseUrl, env, vars, timeout }) {
  const { flow, warnings } = compileSteps({ steps: stepsRaw, catalog, baseUrl });
  for (const step of flow) {
    const ns = normalizeStep(step);
    const handler = STEPS[ns.op];
    if (typeof handler !== "function") return { ok: false, message: `avance con paso desconocido «${ns.op}»`, warnings };
    let res;
    try {
      res = await handler({ page, args: ns.args, env, vars, timeout, index: 0 });
    } catch (e) {
      // Un handler puede LANZAR (Playwright tira al no hallar/accionar el elemento en el timeout) →
      // se traduce a fallo del avance con el motivo, no tumba el walk.
      return { ok: false, message: e?.message || `error en el paso «${ns.op}»`, warnings };
    }
    if (!res || res.ok === false) return { ok: false, message: res?.message || `falló el paso «${ns.op}»`, warnings };
  }
  await settleSpa(page, timeout);
  return { ok: true, warnings };
}

/**
 * Camina un recorrido y produce sus páginas de catálogo (una por etapa alcanzada).
 * @param {object} o
 * @param {string} o.name                          nombre del recorrido (prefijo del breadcrumb)
 * @param {string} o.baseUrl                        URL base del sistema
 * @param {{mode?:"login"|"none"}} [o.auth]
 * @param {string} [o.entry]                        ruta de entrada del asistente (relativa a baseUrl)
 * @param {Array<{name:string, advance?:Array<object>}>} o.stages   etapas ordenadas
 * @param {object} o.catalog                        catálogo vigente (para resolver los alias del avance)
 * @param {object} [o.vars]  @param {object} [o.env]
 * @param {() => Promise<any>} o.launchBrowser      launcher inyectable (Playwright real o fake)
 * @param {number} [o.timeout]
 * @returns {Promise<{ok:boolean, pages?:Array<object>, count?:number, reached?:number, total?:number,
 *                     stalledAt?:string|null, message?:string|null, warnings?:Array<object>, prefix?:string}>}
 */
export async function walkRecorrido({
  name, baseUrl, auth = {}, entry = "", stages = [], catalog,
  vars = {}, env = {}, launchBrowser, timeout = DEFAULT_TIMEOUT,
} = {}) {
  if (!baseUrl) return { ok: false, message: "recorrido sin baseUrl (falta la URL del sistema)" };
  if (typeof launchBrowser !== "function") return { ok: false, message: "recorrido sin navegador (launchBrowser no disponible)" };
  if (!Array.isArray(stages) || stages.length === 0) return { ok: false, message: "el recorrido no tiene etapas" };

  const browser = await launchBrowser();
  const pages = [];
  const warnings = [];
  const skipped = []; // etapas CONDICIONALES cuya guardia no se cumplió (no aplicaron esta corrida)
  let reached = 0;
  let stalledAt = null;
  let stallMessage = null;
  let stallReason = null; // "no_advance" (checkpoint normal del flujo incremental) | "advance_failed" (a revisar)
  try {
    const page = typeof browser.newPage === "function" ? await browser.newPage() : browser;
    if (typeof page.setDefaultTimeout === "function") page.setDefaultTimeout(timeout);

    // 1) Entrar al asistente (login primero si el sistema lo requiere).
    await page.goto(joinUrl(baseUrl, entry), { waitUntil: "load", timeout });
    await settleSpa(page, timeout);
    if (auth.mode === "login") {
      const res = await STEPS.login({ page, args: {}, env, vars, timeout });
      if (!res.ok) return { ok: false, message: `no se pudo iniciar sesión para el recorrido: ${res.message}` };
      await settleSpa(page, timeout);
    }

    // 2) Etapa por etapa: [preparar] → cosechar → avanzar. Se detiene si un avance falla o no está definido.
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i] || {};
      const label = stage.name || `Etapa ${i + 1}`;

      // 2·0) Etapa CONDICIONAL: si trae guardia y su texto NO está visible al llegar, esta pantalla no
      // aplica (los datos no la activaron) → se salta (no se cataloga ni se avanza; la anterior ya dejó
      // la pantalla en la que sigue el flujo). Determinista: es un chequeo de presencia, no adivinar.
      const guard = stage.guardText ? String(stage.guardText).trim() : "";
      if (guard) {
        const present = await guardVisible(page, guard, Math.min(timeout, 3000));
        if (!present) { skipped.push(label); continue; }
      }

      // 2a) Preparar la pantalla: acciones que revelan elementos que no están al llegar (p.ej.
      // consultar el RUNT habilita checkbox). Best-effort: si falla, se cosecha lo que haya y se avisa
      // (mejor una captura parcial que ninguna). Los alias de estos pasos ya están catalogados.
      const prep = Array.isArray(stage.prepare) ? stage.prepare : [];
      if (prep.length) {
        const pr = await runAdvance(prep, { page, catalog, baseUrl, env, vars, timeout });
        warnings.push(...(pr.warnings || []));
        if (!pr.ok) warnings.push({ stage: label, message: `No se pudo preparar del todo la pantalla «${label}»: ${pr.message}. La captura puede quedar incompleta.` });
      }

      const nodes = await readVisibleNodes(page, timeout);
      pages.push(buildCatalogPage(nodes, { route: entry || "/", name: stageName(name, label) }));
      reached = i + 1;
      if (i >= stages.length - 1) break; // última etapa: no hay a dónde avanzar

      const adv = Array.isArray(stage.advance) ? stage.advance : [];
      if (adv.length === 0) {
        // Checkpoint NORMAL del flujo incremental: se cataloga hasta esta pantalla; el usuario define
        // cómo avanzar desde acá (ahora que ve sus selectores) y vuelve a escanear una pantalla más.
        stalledAt = label;
        stallReason = "no_advance";
        stallMessage = `La etapa «${label}» todavía no tiene pasos de avance. Definí cómo pasar a la siguiente pantalla (p.ej. escribir un dato y hacer clic en el botón que continúa) y volvé a escanear.`;
        break;
      }
      const r = await runAdvance(adv, { page, catalog, baseUrl, env, vars, timeout });
      warnings.push(...(r.warnings || []));
      if (!r.ok) {
        stalledAt = label;
        stallReason = "advance_failed";
        stallMessage = `No se pudo avanzar desde la etapa «${label}»: ${r.message}. Revisá los pasos de avance o el dato de prueba.`;
        break;
      }
    }
  } finally {
    if (browser && typeof browser.close === "function") {
      try { await browser.close(); } catch { /* cierre best-effort */ }
    }
  }

  const count = pages.reduce((n, p) => n + p.elements.length, 0);
  return { ok: true, pages, count, reached, cataloged: pages.length, skipped, total: stages.length, stalledAt, stallReason, message: stallMessage, warnings, prefix: stagePrefix(name) };
}

export default { walkRecorrido, stageName, stagePrefix };
