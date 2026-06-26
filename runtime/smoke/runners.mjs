// runtime/smoke/runners.mjs — detección y runners base + ciclo completo + CLI + delivery.
// Casos 7 (qa-detect), 8 (static-gate), 9 (preflight condicional), 10 (unit/e2e+ciclo),
// 15 (6 capas), 16 (CLI real), 17 (delivery build).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { detectRepo, resolveEnabledLayers } from "../detect/qa-detect.mjs";
import { runStaticAnalysis } from "../runners/static-analysis.mjs";
import { runUnitTests } from "../runners/unit.mjs";
import { runE2eTests } from "../runners/e2e.mjs";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { runQaCycle } from "../orchestrator.mjs";
import { buildTarget, TARGETS } from "../delivery/build.mjs";

export async function run(ctx) {
  const { ok, pDefault, pFlit, HERE, REPO_ROOT } = ctx;

  // 7. qa-detect: enciende solo las capas cuya herramienta existe; omite el resto con razón
  const repoDet = fs.mkdtempSync(path.join(os.tmpdir(), "qa-detect-"));
  fs.writeFileSync(path.join(repoDet, "package.json"), JSON.stringify({
    name: "demo", dependencies: { react: "18", pg: "8" },
    devDependencies: { vitest: "1", "@playwright/test": "1", eslint: "9" },
  }));
  fs.writeFileSync(path.join(repoDet, "playwright.config.ts"), "export default {}");
  fs.writeFileSync(path.join(repoDet, "vitest.config.ts"), "export default {}");
  fs.writeFileSync(path.join(repoDet, ".eslintrc.json"), "{}");
  const det = detectRepo({ repoRoot: repoDet });
  // security es ZERO-CONFIG: enciende en cualquier repo con código (aquí, semgrep por stack).
  assert.deepStrictEqual(det.enabled, ["static", "unit", "e2e", "security"]);
  assert.strictEqual(det.layers.e2e.tool, "playwright");
  assert.strictEqual(det.layers.security.tool, "semgrep");      // node/react → semgrep
  assert.ok(det.layers.security.signals.includes("zero-config")); // sin .semgrep.yml
  assert.strictEqual(det.stack.frontend, "react");
  assert.strictEqual(det.stack.db, "postgres");
  const skippedLayers = det.skipped.map((s) => s.layer);
  assert.deepStrictEqual(skippedLayers, ["api", "bdd", "db"]);   // security ya no se omite; bdd sin .feature
  assert.ok(det.skipped.every((s) => typeof s.reason === "string" && s.reason.length));
  // override explícito en el perfil gana sobre la detección
  const autoSel = resolveEnabledLayers({ testing: { layers_enabled: "auto" } }, det);
  assert.deepStrictEqual(autoSel, { enabled: ["static", "unit", "e2e", "security"], source: "auto" });
  const fixedSel = resolveEnabledLayers({ testing: { layers_enabled: ["static"] } }, det);
  assert.deepStrictEqual(fixedSel, { enabled: ["static"], source: "profile" });
  fs.rmSync(repoDet, { recursive: true, force: true });
  ok("qa-detect: auto enciende static/unit/e2e + security zero-config; omite api/db con razón; perfil explícito gana");

  // 8. static-analysis-gate end-to-end: detecta tool, ejecuta (exec inyectado) y publica al sink local
  const repoStatic = fs.mkdtempSync(path.join(os.tmpdir(), "qa-static-"));
  fs.writeFileSync(path.join(repoStatic, "package.json"), JSON.stringify({ name: "demo", devDependencies: { eslint: "9" } }));
  fs.writeFileSync(path.join(repoStatic, ".eslintrc.json"), "{}");

  // 8a. lint limpio → pass  (los runners devuelven N resultados; repo plano → 1)
  const evPass = runStaticAnalysis({ repoRoot: repoStatic, exec: () => ({ code: 0, stdout: "", stderr: "" }) })[0];
  assert.strictEqual(evPass.layer, "static");
  assert.strictEqual(evPass.status, "pass");
  assert.strictEqual(evPass.metrics.tool, "eslint");

  // 8b. lint con hallazgos → fail con narrativa
  const evFail = runStaticAnalysis({
    repoRoot: repoStatic,
    exec: () => ({ code: 1, stdout: "/src/a.ts: 'x' is defined but never used", stderr: "" }),
  })[0];
  assert.strictEqual(evFail.status, "fail");
  assert.ok(evFail.narrative.includes("eslint") && evFail.narrative.includes("never used"));

  // 8c. binario no instalable → skip con aviso, no aborta
  const evSkipBin = runStaticAnalysis({ repoRoot: repoStatic, exec: () => ({ code: 127, stdout: "", stderr: "" }) })[0];
  assert.strictEqual(evSkipBin.status, "skip");

  // 8d. repo sin linter → skip con razón de detección
  const repoNoStatic = fs.mkdtempSync(path.join(os.tmpdir(), "qa-nostatic-"));
  const evSkip = runStaticAnalysis({ repoRoot: repoNoStatic })[0];
  assert.strictEqual(evSkip.status, "skip");
  assert.ok(/linter|type-checker/.test(evSkip.narrative));

  // 8e. punta a punta: el EvidenceObject llega al sink local (md)
  const localAdapter = getAdapter({ profile: pDefault, env: {}, repoRoot: repoStatic });
  const pub = await localAdapter.publishEvidence({ work_item_id: "S1" }, { results: [evFail] });
  const mdStatic = fs.readFileSync(pub.mdPath, "utf8");
  assert.ok(mdStatic.includes("static") && mdStatic.includes("❌ fail"));

  fs.rmSync(repoStatic, { recursive: true, force: true });
  fs.rmSync(repoNoStatic, { recursive: true, force: true });
  ok("static-analysis-gate: detecta eslint, ejecuta, emite pass/fail/skip y publica al sink local");

  // 9. orquestador: preflight CONDICIONAL (local arranca directo; ADO sin env se detiene)
  const repoCycle = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cycle-"));
  fs.writeFileSync(path.join(repoCycle, "package.json"), JSON.stringify({ name: "demo", devDependencies: { eslint: "9" } }));
  fs.writeFileSync(path.join(repoCycle, ".eslintrc.json"), "{}");

  // 9a. tracker local → SIN preflight, arranca directo, corre static y publica reporte
  const cycleLocal = await runQaCycle({
    repoRoot: repoCycle, env: {}, workItemId: "C1",
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  });
  assert.strictEqual(cycleLocal.ok, true);
  assert.strictEqual(cycleLocal.tracker, "local");
  assert.strictEqual(cycleLocal.preflight, null);            // no se requirió red
  const staticRes = cycleLocal.results.find((r) => r.layer === "static");
  assert.strictEqual(staticRes.status, "pass");
  assert.ok(fs.existsSync(cycleLocal.report.mdPath));
  // capas omitidas por detección llegan al reporte como skip con razón
  assert.ok(cycleLocal.results.some((r) => r.layer === "api" && r.status === "skip"));

  // 9b. tracker azure-devops SIN env → preflight corre y FALLA → ciclo detenido antes de runners
  const cycleAdo = await runQaCycle({ repoRoot: repoCycle, env: {}, profile: pFlit, workItemId: "C2" });
  assert.strictEqual(cycleAdo.ok, false);
  assert.strictEqual(cycleAdo.stopped, "preflight");
  assert.strictEqual(cycleAdo.tracker, "azure-devops");
  assert.strictEqual(cycleAdo.preflight.ok, false);
  assert.deepStrictEqual(cycleAdo.results, []);              // no se corrió ningún runner

  // 9c. trazabilidad: la subcarpeta de evidencia se nombra netamente con el Feature (FT) y el dev
  // (slug), para separar corridas de distintos devs sobre el mismo feature sin pisarse.
  const cycleTrace = await runQaCycle({
    repoRoot: repoCycle, env: {}, workItemId: "10194", featureId: "10118", developer: "Dev Ñoño Pérez",
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  });
  const traceDir = path.basename(cycleTrace.report.dir);
  assert.strictEqual(traceDir, "FT-10118__Dev-Nono-Perez"); // FT + dev (ñ/tildes/espacios saneados)
  const traceMd = fs.readFileSync(cycleTrace.report.mdPath, "utf8");
  assert.ok(/Feature \(FT\):\*\* 10118/.test(traceMd) && /Desarrollador:\*\* Dev/.test(traceMd));

  fs.rmSync(repoCycle, { recursive: true, force: true });
  ok("orquestador: local arranca directo sin preflight; ADO sin env se detiene en preflight; FT+dev trazados en la carpeta");

  // 10. runners unit + e2e y ciclo completo static/unit/e2e local (criterio de salida F1)
  const repoFull = fs.mkdtempSync(path.join(os.tmpdir(), "qa-full-"));
  fs.writeFileSync(path.join(repoFull, "package.json"), JSON.stringify({
    name: "demo", devDependencies: { eslint: "9", vitest: "1", "@playwright/test": "1" },
  }));
  fs.writeFileSync(path.join(repoFull, ".eslintrc.json"), "{}");
  fs.writeFileSync(path.join(repoFull, "vitest.config.ts"), "export default {}");
  fs.writeFileSync(path.join(repoFull, "playwright.config.ts"), "export default {}");

  // 10a. unit con fallos → fail; e2e limpio → pass (cada runner detecta su herramienta)
  const evUnitFail = runUnitTests({ repoRoot: repoFull, exec: () => ({ code: 1, stdout: "2 failed", stderr: "" }) })[0];
  assert.strictEqual(evUnitFail.layer, "unit");
  assert.strictEqual(evUnitFail.status, "fail");
  assert.strictEqual(evUnitFail.metrics.tool, "vitest");
  assert.ok(evUnitFail.narrative.includes("vitest") && evUnitFail.narrative.includes("2 failed"));
  const evE2ePass = runE2eTests({ repoRoot: repoFull, exec: () => ({ code: 0, stdout: "", stderr: "" }) })[0];
  assert.strictEqual(evE2ePass.layer, "e2e");
  assert.strictEqual(evE2ePass.status, "pass");
  assert.strictEqual(evE2ePass.metrics.tool, "playwright");

  // 10b. repo sin tests → unit/e2e se omiten con aviso (no abortan)
  const repoEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "qa-empty-"));
  assert.strictEqual(runUnitTests({ repoRoot: repoEmpty })[0].status, "skip");
  assert.strictEqual(runE2eTests({ repoRoot: repoEmpty })[0].status, "skip");

  // 10c. ciclo completo local: static + unit + e2e corren y publican un solo reporte, sin PAT
  const cycleFull = await runQaCycle({
    repoRoot: repoFull, env: {}, workItemId: "F1",
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  });
  assert.strictEqual(cycleFull.ok, true);
  assert.strictEqual(cycleFull.preflight, null);
  for (const layer of ["static", "unit", "e2e"]) {
    const r = cycleFull.results.find((x) => x.layer === layer);
    assert.ok(r && r.status === "pass", `capa ${layer} debería correr y pasar en el ciclo local`);
  }
  const mdFull = fs.readFileSync(cycleFull.report.mdPath, "utf8");
  assert.ok(mdFull.includes("unit") && mdFull.includes("e2e"));

  fs.rmSync(repoFull, { recursive: true, force: true });
  fs.rmSync(repoEmpty, { recursive: true, force: true });
  ok("unit/e2e runners + ciclo completo: static/unit/e2e corren local y dejan reporte sin PAT");

  // 15. orquestador con cobertura de las 6 capas en un solo reporte
  const repoAll = fs.mkdtempSync(path.join(os.tmpdir(), "qa-all-"));
  fs.writeFileSync(path.join(repoAll, "package.json"), JSON.stringify({
    name: "demo", devDependencies: { eslint: "9", vitest: "1", "@playwright/test": "1" },
  }));
  fs.writeFileSync(path.join(repoAll, ".eslintrc.json"), "{}");
  fs.writeFileSync(path.join(repoAll, "vitest.config.ts"), "export default {}");
  fs.writeFileSync(path.join(repoAll, "playwright.config.ts"), "export default {}");
  fs.writeFileSync(path.join(repoAll, "schema.pgtap"), "-- tests");
  fs.writeFileSync(path.join(repoAll, ".semgrep.yml"), "rules: []");
  fs.writeFileSync(path.join(repoAll, "openapi.yaml"), "openapi: 3.0.0");
  const cycleAll = await runQaCycle({
    repoRoot: repoAll, env: { DATABASE_URL: "postgres://u@h/db" }, workItemId: "ALL",
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  });
  assert.strictEqual(cycleAll.ok, true);
  const byLayer = Object.fromEntries(cycleAll.results.map((r) => [r.layer, r.status]));
  for (const l of ["static", "unit", "e2e", "db", "security", "api"]) {
    assert.strictEqual(byLayer[l], "pass", `capa ${l} debería pasar en el ciclo completo`);
  }
  fs.rmSync(repoAll, { recursive: true, force: true });
  ok("orquestador: cobertura de las 6 capas (static/unit/e2e/db/security/api pass con exec inyectado)");

  // 16. CLI real end-to-end: corre como subproceso sobre un repo vacío (ruta NO inyectada)
  const repoCli = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cli-"));
  const cli = spawnSync(process.execPath, [path.join(HERE, "cli.mjs"), repoCli], { encoding: "utf8" });
  assert.strictEqual(cli.status, 0);                       // repo sin herramientas → todo skip, sin fallos
  assert.ok(/QA \(local\)/.test(cli.stdout));
  assert.ok(/Reporte:/.test(cli.stdout));
  assert.ok(fs.existsSync(path.join(repoCli, "qa-evidence")));
  fs.rmSync(repoCli, { recursive: true, force: true });
  ok("CLI: node cli.mjs <repo> corre el ciclo local y deja qa-evidence/ (exit 0)");

  // 17. empaquetador multi-target: genera plain/claude-code/cursor desde core/
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-delivery-"));
  const built = TARGETS.map((target) => buildTarget({ target, rootDir: REPO_ROOT, outDir: path.join(outRoot, target) }));
  assert.deepStrictEqual(built.map((b) => b.target), ["plain", "claude-code", "cursor"]);
  for (const b of built) {
    assert.ok(b.files.length > 0);
    // motor compartido presente y con imports intactos
    assert.ok(fs.existsSync(path.join(b.outDir, "runtime", "orchestrator.mjs")));
    assert.ok(fs.existsSync(path.join(b.outDir, "core", "tracker-adapter", "tracker-adapter.mjs")));
    assert.ok(fs.existsSync(path.join(b.outDir, "profiles", "default.yaml")));
  }
  // envoltorios específicos por target
  const plain = path.join(outRoot, "plain");
  assert.ok(fs.existsSync(path.join(plain, "bin", "qa.mjs")));
  const cc = path.join(outRoot, "claude-code");
  assert.ok(fs.existsSync(path.join(cc, "skills", "qa-detect", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(cc, "CLAUDE.md")));
  const cur = path.join(outRoot, "cursor");
  const mdc = path.join(cur, ".cursor", "skills", "qa-detect.mdc");
  assert.ok(fs.existsSync(mdc));
  const mdcText = fs.readFileSync(mdc, "utf8");
  assert.ok(/alwaysApply: false/.test(mdcText));           // regla NO global en el kit genérico
  assert.ok(/description: \S/.test(mdcText));               // frontmatter plegado resuelto
  fs.rmSync(outRoot, { recursive: true, force: true });
  ok("delivery build: plain/claude-code/cursor generados desde core/ (motor + envoltorios)");
}
