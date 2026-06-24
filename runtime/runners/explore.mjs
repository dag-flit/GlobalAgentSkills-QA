// explore.mjs — runner OPCIONAL de exploración de una URL viva (smoke + screenshot),
// SIN depender del repo. Es la única capa que NO se detecta del código: corre solo cuando
// el ciclo recibe `appUrl` (igual que db/api se omiten sin conexión/contrato → aquí: sin URL,
// la capa no aparece). Local-first intacto: una corrida local normal nunca da URL.
//
// El launcher del navegador es INYECTABLE (`launchBrowser`), para no acoplar el kit a
// Playwright y poder probarlo offline con un launcher falso (igual que `exec`/`http`). Si no
// se inyecta, intenta `import('playwright')`; si no está instalado → skip accionable.
// Emite EvidenceObject(s) normalizados al sink, como el resto de capas.

import fs from "node:fs";
import path from "node:path";

async function resolveLaunch(injected) {
  if (injected) return injected;
  try {
    const pw = await import("playwright");
    const chromium = (pw.default && pw.default.chromium) || pw.chromium;
    if (chromium) return () => chromium.launch();
  } catch {
    /* playwright no instalado en este entorno */
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.env]            EXPLORE_TIMEOUT_MS opcional
 * @param {string} [opts.appUrl]         URL viva a explorar (gate: sin esto → [])
 * @param {string[]} [opts.paths]        rutas adicionales relativas/absolutas a visitar
 * @param {function} [opts.launchBrowser] launcher inyectable () -> browser (API tipo Playwright)
 * @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>}
 */
export async function runExplore({
  repoRoot = process.cwd(),
  env = {},
  appUrl,
  paths = [],
  launchBrowser,
} = {}) {
  if (!appUrl) return []; // gated: sin URL, la capa no participa del ciclo

  const launch = await resolveLaunch(launchBrowser);
  if (!launch) {
    return [
      {
        layer: "explore",
        status: "skip",
        narrative:
          "exploración de URL omitida: Playwright no está disponible (instálalo o inyecta launchBrowser).",
        metrics: { tool: "playwright" },
      },
    ];
  }

  const timeout = Number(env.EXPLORE_TIMEOUT_MS) || 30000;
  const targets = [appUrl, ...(Array.isArray(paths) ? paths : [])].filter(Boolean);
  const evidenceDir = path.join(repoRoot, "qa-evidence", ".explore");
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
  } catch {
    /* noop */
  }

  const cases = [];
  const files = [];
  let browser;
  try {
    browser = await launch();
    let i = 0;
    for (const url of targets) {
      i += 1;
      const started = Date.now();
      let status = null;
      let errText = null;
      const consoleErrors = [];
      try {
        const page = await browser.newPage();
        if (typeof page.on === "function") {
          page.on("console", (m) => {
            try {
              if (m && typeof m.type === "function" && m.type() === "error") {
                consoleErrors.push(typeof m.text === "function" ? m.text() : "");
              }
            } catch {
              /* noop */
            }
          });
          page.on("pageerror", (e) => consoleErrors.push(String((e && e.message) || e)));
        }
        const resp = await page.goto(url, { waitUntil: "load", timeout });
        status =
          resp && typeof resp.status === "function" ? resp.status() : (resp && resp.status) || null;
        const shot = path.join(evidenceDir, `explore-${i}.png`);
        try {
          await page.screenshot({ path: shot, fullPage: true });
          if (fs.existsSync(shot)) files.push(shot);
        } catch {
          /* screenshot best-effort */
        }
        if (typeof page.close === "function") await page.close();
      } catch (e) {
        errText = String((e && e.message) || e);
      }
      const httpOk = status != null && status < 400;
      const okCase = errText == null && httpOk && consoleErrors.length === 0;
      const parts = [];
      if (errText) parts.push(errText);
      if (status != null) parts.push(`HTTP ${status}`);
      if (consoleErrors.length) parts.push(`${consoleErrors.length} error(es) de consola`);
      cases.push({
        name: url,
        status: okCase ? "pass" : "fail",
        duration: Date.now() - started,
        message: okCase ? null : parts.join(" · ") || "fallo",
      });
    }
  } finally {
    try {
      if (browser && typeof browser.close === "function") await browser.close();
    } catch {
      /* noop */
    }
  }

  const failed = cases.filter((c) => c.status === "fail").length;
  return [
    {
      layer: "explore",
      status: failed ? "fail" : "pass",
      files,
      narrative: `exploración de ${cases.length} URL(s): ${cases.length - failed} ok, ${failed} con problemas`,
      metrics: { tool: "playwright", urls: cases.length },
      cases,
    },
  ];
}

export default { runExplore };
