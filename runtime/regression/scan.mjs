// scan.mjs — ESCÁNER de selectores de un sistema vivo (base del módulo "Test de Regresión").
// Abre la app con el navegador INYECTADO (launchBrowser → offline-testable), opcionalmente inicia
// sesión (reusa el login GENÉRICO de explore-steps, sin sesgo de app), visita una o más rutas y lee
// el árbol de elementos VISIBLES del DOM (role, nombre accesible, etiqueta, testid, texto) → un
// catálogo de selectores por página. Determinista y SIN IA: solo INVENTARÍA lo que hay en pantalla;
// nunca decide qué probar ni inventa verificaciones (eso lo hace el humano). La elección de selector
// vive en harvest.mjs (pura). Leer del sistema vivo es más fiable que del código (el nombre
// accesible real solo existe en el árbol de accesibilidad en runtime).

import { STEPS, settleSpa } from "../runners/explore-steps.mjs";
import { buildCatalogPage } from "./harvest.mjs";

const DEFAULT_TIMEOUT = 20000;

// Función que corre DENTRO del navegador (page.evaluate) para describir cada elemento anclable.
// No se ejecuta en Node: en el smoke el page.evaluate falso devuelve nodos canónicos (patrón recon/axe).
function browserExtract() {
  const roleFromTag = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button") return "button";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      if (ty === "checkbox") return "checkbox";
      if (ty === "radio") return "radio";
      if (ty === "submit" || ty === "button") return "button";
      if (ty === "hidden") return "";
      return "textbox";
    }
    return "";
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const labelText = (el) => {
    if (el.id) {
      const lab = document.querySelector('label[for="' + el.id + '"]');
      if (lab) return (lab.textContent || "").trim();
    }
    const wrap = el.closest ? el.closest("label") : null;
    return wrap ? (wrap.textContent || "").trim() : "";
  };
  const nodes = [];
  const sel = "button, a[href], input, select, textarea, [role], h1,h2,h3,h4,h5,h6, [data-testid],[data-test],[data-cy]";
  document.querySelectorAll(sel).forEach((el) => {
    if (!visible(el)) return;
    const role = el.getAttribute("role") || roleFromTag(el);
    const field = /^(input|select|textarea)$/i.test(el.tagName);
    const testid = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const label = field ? labelText(el) : "";
    const text = ((el.innerText || el.textContent || "") + "").trim();
    const name = ariaLabel || (role && role !== "textbox" && role !== "combobox" ? text : "") || label;
    nodes.push({
      role,
      field,
      name: (name || "").slice(0, 80),
      label: (label || "").slice(0, 80),
      text: text.slice(0, 80),
      placeholder: el.getAttribute("placeholder") || "",
      testid,
      visible: true,
    });
  });
  return nodes;
}

async function extractNodes(page) {
  if (typeof page.evaluate !== "function") return [];
  try {
    const r = await page.evaluate(browserExtract);
    return Array.isArray(r) ? r : [];
  } catch {
    return []; // best-effort: una página que no deja evaluar no tumba el escaneo
  }
}

// Sondea hasta que el DOM tiene elementos (SPA: al `load` el DOM está vacío; React pinta después).
async function extractWhenReady(page, timeout) {
  const deadline = Date.now() + Math.max(0, timeout);
  let nodes = await extractNodes(page);
  while (nodes.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    nodes = await extractNodes(page);
  }
  return nodes;
}

function joinUrl(base, route) {
  if (!route) return base;
  if (/^https?:\/\//i.test(route)) return route;
  return String(base).replace(/\/+$/, "") + "/" + String(route).replace(/^\/+/, "");
}

/**
 * Escanea un sistema y produce su catálogo de selectores.
 * @param {object} o
 * @param {string} o.baseUrl                     URL base del sistema
 * @param {{mode?:"login"|"none"}} [o.auth]      con login (usa ${QA_USER}/${QA_PASS}) o sin login
 * @param {Array<{route:string, name?:string}>} [o.routes]  rutas a catalogar (default: solo la base)
 * @param {object} [o.vars]                       secretos efímeros (QA_USER/QA_PASS)
 * @param {object} [o.env]
 * @param {() => Promise<any>} o.launchBrowser    launcher inyectable (Playwright real o fake)
 * @param {number} [o.timeout]
 * @returns {Promise<{ok:boolean, catalog?:object, count?:number, message?:string}>}
 */
export async function scanSelectors({ baseUrl, auth = {}, routes, vars = {}, env = {}, launchBrowser, timeout = DEFAULT_TIMEOUT } = {}) {
  if (!baseUrl) return { ok: false, message: "escaneo sin baseUrl (falta la URL del sistema)" };
  if (typeof launchBrowser !== "function") return { ok: false, message: "escaneo sin navegador (launchBrowser no disponible)" };
  const wantLogin = auth.mode === "login";
  const targets = Array.isArray(routes) && routes.length ? routes : [{ route: "", name: "Inicio" }];

  const browser = await launchBrowser();
  const pages = [];
  try {
    const page = typeof browser.newPage === "function" ? await browser.newPage() : browser;
    if (typeof page.setDefaultTimeout === "function") page.setDefaultTimeout(timeout);

    // 1) Navegar a la URL base (primera ruta).
    await page.goto(joinUrl(baseUrl, targets[0].route), { waitUntil: "load", timeout });
    await settleSpa(page, timeout);

    // 1b) Sistema con login → catalogar PRIMERO la pantalla de acceso (usuario/clave/botón), que
    // desaparece al autenticarse, y RECIÉN DESPUÉS iniciar sesión. Así el catálogo tiene los
    // selectores del login (para probar el login) Y los de la app (post-login). Sin esto, el
    // escaneo se logueaba y solo veía el dashboard → no había con qué armar una prueba de login.
    if (wantLogin) {
      const loginNodes = await extractWhenReady(page, timeout);
      pages.push(buildCatalogPage(loginNodes, { route: targets[0].route || "/", name: "Acceso (pantalla de login)" }));
      const res = await STEPS.login({ page, args: {}, env, vars, timeout });
      if (!res.ok) return { ok: false, message: `no se pudo iniciar sesión para escanear: ${res.message}` };
      await settleSpa(page, timeout);
    }

    // 2) Catalogar cada ruta (ya autenticado si aplica). La primera ya está abierta; navegar el resto.
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (i > 0) {
        await page.goto(joinUrl(baseUrl, t.route), { waitUntil: "load", timeout });
        await settleSpa(page, timeout);
      }
      const nodes = await extractWhenReady(page, timeout);
      pages.push(buildCatalogPage(nodes, { route: t.route || "/", name: t.name || t.route || "/" }));
    }
  } finally {
    if (browser && typeof browser.close === "function") {
      try {
        await browser.close();
      } catch {
        /* cierre best-effort */
      }
    }
  }

  const count = pages.reduce((n, p) => n + p.elements.length, 0);
  return { ok: true, catalog: { baseUrl, authMode: wantLogin ? "login" : "none", pages }, count };
}

export default { scanSelectors };
