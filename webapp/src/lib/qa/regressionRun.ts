import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import type { RegressionTarget, RegressionSuite, RegressionTest } from "@/lib/types";

// Puente entre la ruta API y el runner del motor: corre una SUITE (o una sola PRUEBA) de regresión.
// Por cada prueba compila sus pasos (alias → localizador) contra el catálogo VIGENTE y la ejecuta en
// un contexto de navegador AISLADO (sesión limpia) que además GRABA VIDEO; las capturas por paso las
// hace el ejecutor de flujo. Deja la evidencia en disco (carpeta por corrida, aislada por tenant) y
// arma un reporte HTML autocontenido. Solo en el servidor: las credenciales (cifradas) se resuelven
// acá como ${QA_USER}/${QA_PASS} y JAMÁS van al navegador.
//
// Login automático DETERMINISTA (sin config): una prueba que escribe las credenciales ES la del login
// → no se antepone login; cualquier otra prueba de un sistema con login corre ya autenticada.

export interface StepResult { name: string; status: "pass" | "fail"; message?: string | null; duration?: number }
export interface TestRunResult { id: string; name: string; status: "pass" | "fail"; steps: number; warnings: string[]; cases: StepResult[] }
export interface SuiteRunResult { ok: boolean; suite: string; tests: TestRunResult[]; passed: number; failed: number; reportPath?: string; runId?: string; message?: string }

interface RunOpts { evidenceBase?: string; only?: string }

function slug(s: string): string {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}
function usesCredentials(test: RegressionTest): boolean {
  return (test.steps ?? []).some((s) => s.valor === "${QA_USER}" || s.valor === "${QA_PASS}");
}
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function runSuite(target: RegressionTarget, suite: RegressionSuite, opts: RunOpts = {}): Promise<SuiteRunResult> {
  const empty = (message: string): SuiteRunResult => ({ ok: false, suite: suite.name, tests: [], passed: 0, failed: 0, message });

  const catalog = target.catalog;
  if (!catalog?.pages?.length) return empty("El sistema no tiene catálogo. Escaneá el sistema antes de correr las pruebas.");
  const chosen = (suite.tests ?? []).filter((t) => !opts.only || t.id === opts.only);
  if (!chosen.length) return empty(opts.only ? "No se encontró la prueba a correr." : "La suite no tiene pruebas.");

  const { compileTest } = await importKit("runtime/regression/compile.mjs");
  const { runFlow } = await importKit("runtime/runners/explore-flow.mjs");
  const { buildRegressionReport } = await importKit("runtime/regression/report.mjs");

  let chromium: any;
  try {
    const pw: any = await import("playwright");
    chromium = pw.chromium ?? pw.default?.chromium;
  } catch {
    /* playwright no instalado */
  }
  if (!chromium) return empty("Playwright (chromium) no está disponible en el servidor; no se pueden correr las pruebas.");

  const vars: Record<string, string> = {};
  if (target.authMode === "login") {
    vars.QA_USER = target.username;
    vars.QA_PASS = target.password; // descifrada en el repo; se queda en el proceso, nunca al cliente
  }

  // Carpeta de evidencia de ESTA corrida (aislada por tenant vía evidenceBase). Subcarpeta por prueba.
  // El basename (Date.now) es el `runId`: identifica la corrida para el «Publicar en ADO» sin exponer
  // rutas al cliente (el server reconstruye la carpeta desde tenant + target + suite + runId).
  const runId = `${Date.now()}`;
  const ranAt = stamp();
  const runDir = opts.evidenceBase ? path.join(opts.evidenceBase, slug(target.id), slug(suite.name), runId) : "";
  if (runDir) fs.mkdirSync(runDir, { recursive: true });

  const browser = await chromium.launch();
  const tests: TestRunResult[] = [];
  const forReport: any[] = [];
  const manifestTests: any[] = []; // por prueba: qué se corrió + dónde quedó su reporte (para publicar)
  try {
    for (const test of chosen) {
      const login = target.authMode === "login" && !usesCredentials(test);
      const { flow, warnings } = compileTest({ test, catalog, login });
      const warnMsgs: string[] = (warnings ?? []).map((w: any) => w.message);

      const testSlug = slug(test.name);
      const testDir = runDir ? path.join(runDir, testSlug) : "";
      if (testDir) fs.mkdirSync(testDir, { recursive: true });

      // Sin grabación de video: en headless salía en blanco de forma intermitente (el dashboard
      // post-login no pinta en el compositor). La evidencia visual es la captura por paso (siempre
      // funciona) y el reporte arma con ellas una reproducción paso a paso. Sesión limpia por prueba.
      const context = await browser.newContext();
      const page = await context.newPage();
      let cases: any[] = [];
      try {
        const r = await runFlow({ page, steps: flow, evidenceDir: testDir || undefined, env: process.env, vars, timeout: 15000 });
        cases = r.cases ?? [];
      } catch (e: any) {
        cases = [{ name: "corrida", status: "fail", message: String(e?.message ?? e) }];
      } finally {
        await context.close().catch(() => {});
      }

      const failed = warnMsgs.length > 0 || cases.some((c) => c.status === "fail");
      const status = failed ? "fail" : "pass";
      const simpleCases = cases.map((c) => ({ name: c.name, status: c.status, message: c.message ?? null, duration: c.duration }));
      tests.push({ id: test.id, name: test.name, status, steps: flow.length, warnings: warnMsgs, cases: simpleCases });
      const reportEntry = { name: test.name, status, warnings: warnMsgs, cases };
      forReport.push(reportEntry);

      // Reporte autocontenido POR PRUEBA (para adjuntarlo a su HU al publicar en ADO — el destino es
      // «por prueba individual»). Best-effort: si falla, la publicación adjunta lo que haya.
      let reportRel = "";
      if (testDir) {
        try {
          const html = buildRegressionReport({ system: target.name, suite: suite.name, tests: [reportEntry], stamp: ranAt });
          fs.writeFileSync(path.join(testDir, "report.html"), html, "utf8");
          reportRel = `${testSlug}/report.html`;
        } catch {
          /* el reporte por prueba es best-effort */
        }
      }
      manifestTests.push({ id: test.id, name: test.name, status, steps: flow.length, warnings: warnMsgs, cases: simpleCases, dir: testSlug, report: reportRel });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  let reportPath = "";
  if (runDir) {
    try {
      const html = buildRegressionReport({ system: target.name, suite: suite.name, tests: forReport, stamp: ranAt });
      reportPath = path.join(runDir, "report.html");
      fs.writeFileSync(reportPath, html, "utf8");
    } catch {
      /* el reporte es best-effort: el veredicto igual se devuelve */
    }
    // Manifiesto de la corrida: lo lee «Publicar en ADO» para crear una HU por prueba con su evidencia.
    try {
      const manifest = { system: target.name, suite: suite.name, stamp: ranAt, tests: manifestTests };
      fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest), "utf8");
    } catch {
      /* sin manifiesto no se podrá publicar, pero el veredicto + reporte igual se devuelven */
    }
  }

  const passed = tests.filter((t) => t.status === "pass").length;
  return { ok: true, suite: suite.name, tests, passed, failed: tests.length - passed, reportPath: reportPath || undefined, runId: runDir ? runId : undefined };
}
