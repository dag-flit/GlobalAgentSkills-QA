// explore-flow.mjs — ejecutor del GUION E2E: corre una lista de pasos EN ORDEN sobre una MISMA
// página (la sesión se arrastra: el login abre el resto del flujo). Emite un caso por paso
// (nombre, status, duración, mensaje) y CAPTURA POR PASO (siempre, pase o falle) para dejar
// evidencia visual del flujo completo — ésa es la razón de ser del kit. Por defecto es FAIL-FAST:
// si un paso falla, corta (los siguientes dependen del anterior). `continueOnFail:true` permite
// baterías de chequeos independientes sobre una sola página.
//
// No conoce Playwright directamente: recibe la `page` (real o falsa) → offline-testable.

import fs from "node:fs";
import path from "node:path";
import { STEPS, normalizeStep, stepLabel } from "./explore-steps.mjs";

/**
 * @param {object} opts
 * @param {object} opts.page            página tipo Playwright (inyectable)
 * @param {Array}  opts.steps           pasos del guion (crudos; se normalizan)
 * @param {string} opts.evidenceDir     carpeta donde caen las capturas
 * @param {object} [opts.env]           variables/secretos para `${VAR}`
 * @param {object} [opts.vars]          variables de la corrida (precedencia sobre env)
 * @param {number} [opts.timeout]
 * @param {boolean} [opts.continueOnFail]
 * @returns {Promise<{cases:object[], files:string[], consoleErrors:string[]}>}
 */
export async function runFlow({
  page,
  steps = [],
  evidenceDir,
  env = {},
  vars = {},
  timeout = 30000,
  continueOnFail = false,
}) {
  const cases = [];
  const files = [];
  const consoleErrors = [];

  // Todas las acciones de Playwright (fill/click/getBy…) heredan ESTE timeout en vez del default
  // global de 30 s → un localizador equivocado del guion falla en `timeout`, no en 30 s. Guardado
  // por si la página es falsa (offline). El `goto`/las esperas explícitas ya reciben `timeout` aparte.
  if (page && typeof page.setDefaultTimeout === "function") page.setDefaultTimeout(timeout);

  if (page && typeof page.on === "function") {
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

  for (let idx = 0; idx < steps.length; idx++) {
    const step = normalizeStep(steps[idx]);
    const handler = STEPS[step.op];
    const started = Date.now();

    let res;
    if (!handler) {
      res = { ok: false, message: `paso desconocido: ${step.op}` };
    } else {
      try {
        res = await handler({ page, args: step.args, env, vars, timeout, evidenceDir, index: idx + 1 });
      } catch (e) {
        res = { ok: false, message: String((e && e.message) || e) };
      }
    }

    // Evidencia: la captura explícita del handler (paso "captura"), o una AUTOMÁTICA por paso
    // (siempre) — así el flujo entero queda documentado, no solo los fallos.
    let file = res.file || null;
    if (!file && evidenceDir) file = await stepShot(page, evidenceDir, idx + 1, step.op, res.ok);
    if (file) files.push(file);

    // `ac` (opcional): qué criterio de aceptación PRUEBA este paso (solo tiene sentido en pasos de
    // verificación). Viaja en el caso para que el reporte arme la matriz de cobertura de AC.
    const ac = step.args && step.args.ac != null ? String(step.args.ac).trim() : "";
    cases.push({
      name: stepLabel(step, idx),
      op: step.op, // qué operación fue (clic/verificar_*/…): permite diagnosticar la causa del fallo
      status: res.ok ? "pass" : "fail",
      duration: Date.now() - started,
      message: res.ok ? null : res.message || "fallo",
      ...(ac ? { ac } : {}),
      ...(file ? { file } : {}), // captura del paso → el reporte la muestra junto al paso
    });

    if (!res.ok && !continueOnFail) break; // fail-fast
  }

  return { cases, files, consoleErrors };
}

// Captura del paso: nombre trazable `paso-<n>-<op>.png` (o `fallo-…` si el paso falló).
async function stepShot(page, evidenceDir, n, op, ok) {
  try {
    const prefix = ok ? "paso" : "fallo-paso";
    const shot = path.join(evidenceDir, `${prefix}-${n}-${op}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    if (fs.existsSync(shot)) return shot;
  } catch {
    /* best-effort */
  }
  return null;
}

export default { runFlow };
