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
import { runFlow } from "./explore-flow.mjs";
import { computeCoverage } from "../evidence/ac-coverage.mjs";
import { scanPageAccessibility, buildAxeEvidence, loadAxeSource } from "./axe-scan.mjs";

// ¿La corrida trae credenciales de login? (mismo criterio de resolución que interpolate:
// vars gana a env). Con ambas presentes, una corrida de URL sin guion inicia sesión y captura.
function hasCreds(vars = {}, env = {}) {
  const pick = (k) => vars[k] ?? env[k];
  return Boolean(pick("QA_USER") && pick("QA_PASS"));
}

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
 * @param {object} [opts.env]            EXPLORE_TIMEOUT_MS opcional; y `${VAR}` para el guion
 * @param {string} [opts.appUrl]         URL viva a explorar (modo URL-smoke)
 * @param {string[]} [opts.paths]        rutas adicionales a visitar (modo URL-smoke)
 * @param {Array} [opts.flow]            GUION de pasos (modo flujo E2E); gate: sin appUrl ni flow → []
 * @param {object} [opts.vars]           variables de la corrida para `${VAR}` del guion. Con
 *                                        `QA_USER`+`QA_PASS` y URL sin guion → login automático
 *                                        (sintetiza `ir_a → login`, captura por paso).
 * @param {string} [opts.tcId]           id del caso/HU para trazar la evidencia (attach en ADO)
 * @param {string[]} [opts.declaredAcs]  AC declarados de la HU (para la matriz de cobertura)
 * @param {function} [opts.launchBrowser] launcher inyectable () -> browser (API tipo Playwright)
 * @param {object} [opts.profile]        perfil resuelto (se lee `profile.explore.accessibility`)
 * @param {string} [opts.axeSource]      fuente de axe-core INYECTADA (la webapp la provee desde su
 *                                        node_modules); sin ella la accesibilidad no corre (queda en silencio).
 * @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>}
 */
export async function runExplore({
  repoRoot = process.cwd(),
  env = {},
  appUrl,
  paths = [],
  flow,
  vars = {},
  tcId,
  declaredAcs = [],
  launchBrowser,
  profile = {},
  axeSource,
} = {}) {
  const hasFlow = Array.isArray(flow) && flow.length > 0;
  if (!appUrl && !hasFlow) return []; // gated: sin URL ni guion, la capa no participa del ciclo

  // Accesibilidad (axe): SOLO en la exploración de URL. Corre únicamente si hay una fuente de axe-core
  // disponible (inyectada por la webapp, o importable en CLI) y no está apagada en el perfil. Sin axe →
  // queda en silencio (no aparece en el reporte) → la QA de código nunca la ve.
  const axeSrc = axeSource || (await loadAxeSource());
  const doAxe = Boolean(axeSrc) && !((profile.explore && profile.explore.accessibility && profile.explore.accessibility.off) === true);

  const launch = await resolveLaunch(launchBrowser);
  if (!launch) {
    return [
      {
        layer: "explore",
        status: "skip",
        narrative:
          "exploración omitida: Playwright no está disponible (instálalo o inyecta launchBrowser).",
        metrics: { tool: "playwright" },
      },
    ];
  }

  // 15 s por paso (antes 30 s, el default de Playwright): un localizador equivocado del guion
  // autogenerado falla rápido en vez de colgar la corrida 30 s. Ajustable por env si un sitio es lento.
  const timeout = Number(env.EXPLORE_TIMEOUT_MS) || 15000;

  // Sin guion explícito, pero con URL + credenciales → sintetiza un guion MÍNIMO de login
  // (`ir_a` → `login`). El ejecutor de flujo captura una imagen por paso, así queda evidencia
  // visual de la pantalla de login y del estado post-login (autenticado). Es el caso "mandé la
  // URL y quiero que inicie sesión y capture". Sin credenciales → sigue el URL-smoke de abajo.
  let effFlow = flow;
  let effHasFlow = hasFlow;
  if (!hasFlow && appUrl && hasCreds(vars, env)) {
    effFlow = [{ op: "ir_a", url: appUrl }, { op: "login" }];
    effHasFlow = true;
  }

  // ── Modo GUION (E2E de un flujo): pasos en orden sobre una misma sesión ───────
  if (effHasFlow) {
    return runFlowMode({ repoRoot, env, flow: effFlow, vars, tcId, declaredAcs, timeout, launch, profile, axeSrc: doAxe ? axeSrc : null });
  }
  const targets = [appUrl, ...(Array.isArray(paths) ? paths : [])].filter(Boolean);
  const evidenceDir = path.join(repoRoot, "qa-evidence", ".explore");
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
  } catch {
    /* noop */
  }

  const cases = [];
  const files = [];
  const axePages = [];
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
        // Accesibilidad de esta página (solo si hay axe disponible) — antes de cerrarla.
        if (doAxe) {
          const a = await scanPageAccessibility(page, { axeSource: axeSrc });
          axePages.push({ url, ran: a.ran, violations: a.violations });
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
  const results = [
    {
      layer: "explore",
      status: failed ? "fail" : "pass",
      files,
      narrative: `exploración de ${cases.length} URL(s): ${cases.length - failed} ok, ${failed} con problemas`,
      metrics: { tool: "playwright", urls: cases.length },
      cases,
    },
  ];
  // Objeto de accesibilidad (axe): se anexa SOLO si axe analizó alguna página (si no, queda en silencio).
  if (doAxe) {
    const axeObj = buildAxeEvidence(axePages, { profile, tcId });
    if (axeObj) results.push(axeObj);
  }
  return results;
}

// Modo GUION: abre una sesión, corre los pasos (explore-flow) y normaliza el EvidenceObject
// (un caso por paso, capturas juntas). Mismo contrato que el modo URL-smoke → sink/adapter igual.
async function runFlowMode({ repoRoot, env, flow, vars, tcId, declaredAcs = [], timeout, launch, profile = {}, axeSrc = null }) {
  const evidenceDir = path.join(repoRoot, "qa-evidence", ".explore");
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
  } catch {
    /* noop */
  }

  let browser;
  let cases = [];
  let files = [];
  let consoleErrors = [];
  const axePages = [];
  try {
    browser = await launch();
    const page = await browser.newPage();
    ({ cases, files, consoleErrors } = await runFlow({ page, steps: flow, evidenceDir, env, vars, timeout }));
    // Accesibilidad del estado FINAL del flujo (autenticado, ya navegado) — antes de cerrar la página.
    if (axeSrc) {
      const first = flow.find((s) => s && (s.op === "ir_a" || s.url || (s.args && s.args.url))) || {};
      const url = first.url || (first.args && first.args.url) || "flujo E2E";
      const a = await scanPageAccessibility(page, { axeSource: axeSrc });
      axePages.push({ url, ran: a.ran, violations: a.violations });
    }
    if (typeof page.close === "function") await page.close();
  } finally {
    try {
      if (browser && typeof browser.close === "function") await browser.close();
    } catch {
      /* noop */
    }
  }

  const failed = cases.filter((c) => c.status === "fail").length;
  const consoleNote = consoleErrors.length ? ` · ${consoleErrors.length} error(es) de consola` : "";
  // Matriz de cobertura de AC: cruza los pasos que declaran `ac` con los AC declarados de la HU.
  const coverage = computeCoverage(cases, declaredAcs);
  const results = [
    {
      layer: "explore",
      ...(tcId ? { tc_id: tcId } : {}),
      status: failed ? "fail" : "pass",
      files,
      narrative: `flujo de ${cases.length} paso(s): ${cases.length - failed} ok, ${failed} con problemas${consoleNote}`,
      metrics: { tool: "playwright", steps: cases.length, consoleErrors: consoleErrors.length },
      ...(coverage ? { coverage } : {}),
      cases,
    },
  ];
  if (axeSrc) {
    const axeObj = buildAxeEvidence(axePages, { profile, tcId });
    if (axeObj) results.push(axeObj);
  }
  return results;
}

export default { runExplore };
