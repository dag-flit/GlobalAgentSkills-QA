// recon.mjs — RECON opcional para el planner con IA. Abre el navegador, va a la URL, OPCIONALMENTE
// inicia sesión (paso `login` heurístico, reutilizado del registro) y CAPTURA un resumen del DOM:
// los elementos VISIBLES e interactivos de la pantalla (campos con su etiqueta, botones, enlaces,
// títulos). Ese resumen alimenta a `planFlow({dom})` para que el modelo local deduzca localizadores
// REALES en vez de adivinarlos. Sin recon el planner sigue funcionando (IA desde solo-AC, o el
// determinista). Launcher INYECTABLE → offline-testable (el smoke pasa una página falsa).
//
// Nota: captura UNA pantalla (la de la URL, ya autenticada si hay login). Es un buen punto de
// partida compartible entre las HU de un Feature; una HU que navega a otra vista igual se apoya en
// el match por subcadena de los localizadores. Best-effort: si algo falla, devuelve dom vacío.

import { STEPS } from "../runners/explore-steps.mjs";

// Función que corre EN EL NAVEGADOR (page.evaluate). DEBE ser autocontenida (se serializa y evalúa
// en el contexto de la página): solo usa globals del navegador (document/window), sin scope externo.
function extractDom() {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const isVisible = (el) => {
    try {
      const s = window.getComputedStyle(el);
      if (s && (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return true;
    }
  };
  const labelOf = (el) => {
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    if (el.id) {
      const l = document.querySelector('label[for="' + el.id + '"]');
      if (l) return clean(l.textContent);
    }
    const wrap = el.closest && el.closest("label");
    if (wrap) return clean(wrap.textContent);
    if (el.placeholder) return clean(el.placeholder);
    return clean(el.name || el.id || "");
  };
  const take = (arr, n) => Array.prototype.slice.call(arr, 0, n);

  const fields = [];
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "hidden" || !isVisible(el)) return;
    const name = labelOf(el);
    if (name) fields.push('- campo "' + name + '" (' + t + ")");
  });
  const buttons = [];
  document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((el) => {
    if (!isVisible(el)) return;
    const label = clean(el.textContent) || clean(el.value) || clean(el.getAttribute("aria-label"));
    if (label) buttons.push('- botón "' + label + '"');
  });
  const links = [];
  document.querySelectorAll("a[href]").forEach((el) => {
    if (!isVisible(el)) return;
    const t = clean(el.textContent);
    if (t) links.push('- enlace "' + t + '"');
  });
  const heads = [];
  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    const t = clean(el.textContent);
    if (t) heads.push("- " + el.tagName.toLowerCase() + ': "' + t + '"');
  });

  const out = [];
  if (heads.length) out.push("TÍTULOS:", ...take(heads, 10));
  if (fields.length) out.push("CAMPOS:", ...take(fields, 30));
  if (buttons.length) out.push("BOTONES:", ...take(buttons, 30));
  if (links.length) out.push("ENLACES:", ...take(links, 40));
  return out.join("\n");
}

/**
 * Abre la URL, opcionalmente inicia sesión, y captura el resumen del DOM.
 * @param {object} p
 * @param {string} p.appUrl        URL viva
 * @param {boolean} [p.login]      iniciar sesión antes de capturar (usa ${QA_USER}/${QA_PASS})
 * @param {object} [p.env]         entorno (para interpolar credenciales)
 * @param {object} [p.vars]        variables de la corrida (precedencia sobre env)
 * @param {Function} p.launchBrowser  launcher inyectable () -> browser (API tipo Playwright)
 * @param {number} [p.timeout]
 * @returns {Promise<{ok:boolean, dom:string, message:string|null}>}
 */
export async function captureDom({ appUrl, login = false, env = {}, vars = {}, launchBrowser, timeout = 30000 } = {}) {
  if (!appUrl || typeof launchBrowser !== "function") {
    return { ok: false, dom: "", message: "recon omitido (sin URL o sin launcher)" };
  }
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(appUrl, { waitUntil: "load", timeout });
    if (login && typeof STEPS.login === "function") {
      // login best-effort: si falla (creds ausentes/campo no hallado) seguimos con el DOM que haya.
      try {
        await STEPS.login({ page, args: {}, env, vars, timeout });
      } catch {
        /* seguimos sin sesión */
      }
    }
    let dom = "";
    if (typeof page.evaluate === "function") {
      dom = await page.evaluate(extractDom);
    }
    if (typeof page.close === "function") await page.close();
    return { ok: true, dom: String(dom || ""), message: null };
  } catch (e) {
    return { ok: false, dom: "", message: String((e && e.message) || e) };
  } finally {
    try {
      if (browser && typeof browser.close === "function") await browser.close();
    } catch {
      /* noop */
    }
  }
}

export default { captureDom };
