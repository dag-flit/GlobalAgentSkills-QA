// world.mjs — World (estado compartido) + hooks para los step-definitions del kit (Ruta B / BDD).
// Lo carga Cucumber.js EN EL PROYECTO bajo prueba (donde viven @cucumber/cucumber y playwright);
// el kit lo materializa en qa-generated/bdd/steps/. CERO literales de dominio.

import { setWorldConstructor, After, setDefaultTimeout } from "@cucumber/cucumber";

setDefaultTimeout(60 * 1000);

class QaWorld {
  constructor() {
    // baseURL la inyecta el orquestador (BASE_URL/PLAYWRIGHT_BASE_URL) cuando se pasa appUrl.
    this.baseUrl = process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || process.env.CYPRESS_BASE_URL || "";
    this.apiBaseUrl = process.env.API_BASE_URL || this.baseUrl || "";
    this.browser = null;
    this.page = null;
    this.response = null;     // última respuesta HTTP (steps api)
    this.responseText = null;
  }

  // Abre el navegador de forma perezosa (solo si un step web lo necesita). Playwright se resuelve
  // en el node_modules del PROYECTO; si no está, el step falla con un error claro (no rompe el kit).
  async openBrowser() {
    if (this.page) return this.page;
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch();
    this.page = await this.browser.newPage();
    return this.page;
  }

  webUrl(p) {
    if (/^https?:\/\//i.test(p)) return p;
    return (this.baseUrl || "").replace(/\/+$/, "") + "/" + String(p).replace(/^\/+/, "");
  }

  apiUrl(p) {
    if (/^https?:\/\//i.test(p)) return p;
    return (this.apiBaseUrl || "").replace(/\/+$/, "") + "/" + String(p).replace(/^\/+/, "");
  }
}

setWorldConstructor(QaWorld);

After(async function () {
  if (this.browser) {
    await this.browser.close();
    this.browser = null;
    this.page = null;
  }
});
