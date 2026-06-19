// smoke-test.mjs — verifica el plumbing F0 de punta a punta, sin red.
// Corre con: node runtime/smoke-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { resolveProfile, deepMerge } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "./detect/qa-detect.mjs";
import { runStaticAnalysis } from "./runners/static-analysis.mjs";
import { runUnitTests } from "./runners/unit.mjs";
import { runE2eTests } from "./runners/e2e.mjs";
import { runQaCycle } from "./orchestrator.mjs";

let passed = 0;
function ok(name) { console.log(`  ✅ ${name}`); passed++; }

console.log("== F0 smoke test ==\n");

// 1. deep-merge
const m = deepMerge({ a: { x: 1, y: 2 }, l: [1] }, { a: { y: 9, z: 3 }, l: [2] });
assert.deepStrictEqual(m, { a: { x: 1, y: 9, z: 3 }, l: [2] });
ok("deep-merge: objetos se funden, listas/escalares override");

// 2. resolver: repo sin perfil -> default local-first
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-repo-"));
const { profile: pDefault, chain: cDefault } = resolveProfile({ repoRoot: tmp });
assert.strictEqual(pDefault.tracker, "local");
assert.strictEqual(pDefault.testing.layers_enabled, "auto");
assert.deepStrictEqual(cDefault, ["default"]);
ok("resolver: repo sin config -> tracker=local, layers=auto");

// 3. resolver: proyecto pide perfil flit -> cadena default<-azure-devops<-flit
const projDir = path.join(tmp, ".qa");
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "qa-project.profile.yaml"),
  "profile: flit\nproject:\n  name: \"mi-proyecto\"\n");
const { profile: pFlit, chain: cFlit } = resolveProfile({ repoRoot: tmp });
assert.strictEqual(pFlit.tracker, "azure-devops");                 // heredado del preset
assert.strictEqual(pFlit.azure.work_item.certified_tag, "QA_PDN"); // del overlay flit
assert.strictEqual(pFlit.locale.timezone, "America/Bogota");        // del overlay flit
assert.strictEqual(pFlit.project.name, "mi-proyecto");              // override del proyecto
assert.ok(cFlit.includes("default") && cFlit.includes("azure-devops") && cFlit.includes("flit"));
ok("resolver: overlay flit hereda azure-devops y default (deep-merge correcto)");

// 4. factory: tracker local -> LocalAdapter; preflight OK sin red
const adapter = getAdapter({ profile: pDefault, env: {}, repoRoot: tmp });
assert.strictEqual(adapter.name, "local");
const pf = await adapter.preflight();
assert.strictEqual(pf.ok, true);
assert.strictEqual(adapter.capabilities().network, false);
ok("factory+local: preflight OK sin red; capabilities.network=false");

// 5. work item stub (no hay archivo) y evidencia local md+html
const wi = await adapter.getWorkItem("123");
assert.strictEqual(wi.stub, true);
const res = await adapter.publishEvidence(
  { work_item_id: "123" },
  { results: [
    { layer: "static", status: "pass", narrative: "lint sin críticos" },
    { layer: "unit", tc_id: "TC-01", status: "pass" },
    { layer: "e2e", tc_id: "TC-02", status: "fail", narrative: "login redirect roto" },
  ] }
);
assert.ok(fs.existsSync(res.mdPath) && fs.existsSync(res.htmlPath));
const md = fs.readFileSync(res.mdPath, "utf8");
assert.ok(md.includes("TC-02") && md.includes("❌ fail"));
ok("local sink: reporte md+html escrito en qa-evidence/");

// 6. factory: tracker azure-devops -> AzureDevOpsAdapter; preflight falla sin env
const ado = getAdapter({ profile: pFlit, env: {}, repoRoot: tmp });
assert.strictEqual(ado.name, "azure-devops");
const adoPf = await ado.preflight();
assert.strictEqual(adoPf.ok, false); // faltan variables
assert.strictEqual(ado.capabilities().custom_fields, true);
ok("factory+ado: stub selecciona ADO; preflight exige env; caps.custom_fields=true");

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
assert.deepStrictEqual(det.enabled, ["static", "unit", "e2e"]);
assert.strictEqual(det.layers.e2e.tool, "playwright");
assert.strictEqual(det.stack.frontend, "react");
assert.strictEqual(det.stack.db, "postgres");
const skippedLayers = det.skipped.map((s) => s.layer);
assert.deepStrictEqual(skippedLayers, ["api", "db", "security"]);
assert.ok(det.skipped.every((s) => typeof s.reason === "string" && s.reason.length));
// override explícito en el perfil gana sobre la detección
const autoSel = resolveEnabledLayers({ testing: { layers_enabled: "auto" } }, det);
assert.deepStrictEqual(autoSel, { enabled: ["static", "unit", "e2e"], source: "auto" });
const fixedSel = resolveEnabledLayers({ testing: { layers_enabled: ["static"] } }, det);
assert.deepStrictEqual(fixedSel, { enabled: ["static"], source: "profile" });
fs.rmSync(repoDet, { recursive: true, force: true });
ok("qa-detect: auto enciende static/unit/e2e y omite api/db/security con razón; perfil explícito gana");

// 8. static-analysis-gate end-to-end: detecta tool, ejecuta (exec inyectado) y publica al sink local
const repoStatic = fs.mkdtempSync(path.join(os.tmpdir(), "qa-static-"));
fs.writeFileSync(path.join(repoStatic, "package.json"), JSON.stringify({ name: "demo", devDependencies: { eslint: "9" } }));
fs.writeFileSync(path.join(repoStatic, ".eslintrc.json"), "{}");

// 8a. lint limpio → pass
const evPass = runStaticAnalysis({ repoRoot: repoStatic, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
assert.strictEqual(evPass.layer, "static");
assert.strictEqual(evPass.status, "pass");
assert.strictEqual(evPass.metrics.tool, "eslint");

// 8b. lint con hallazgos → fail con narrativa
const evFail = runStaticAnalysis({
  repoRoot: repoStatic,
  exec: () => ({ code: 1, stdout: "/src/a.ts: 'x' is defined but never used", stderr: "" }),
});
assert.strictEqual(evFail.status, "fail");
assert.ok(evFail.narrative.includes("eslint") && evFail.narrative.includes("never used"));

// 8c. binario no instalable → skip con aviso, no aborta
const evSkipBin = runStaticAnalysis({ repoRoot: repoStatic, exec: () => ({ code: 127, stdout: "", stderr: "" }) });
assert.strictEqual(evSkipBin.status, "skip");

// 8d. repo sin linter → skip con razón de detección
const repoNoStatic = fs.mkdtempSync(path.join(os.tmpdir(), "qa-nostatic-"));
const evSkip = runStaticAnalysis({ repoRoot: repoNoStatic });
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

fs.rmSync(repoCycle, { recursive: true, force: true });
ok("orquestador: local arranca directo sin preflight; ADO sin env se detiene en preflight");

// 10. runners unit + e2e y ciclo completo static/unit/e2e local (criterio de salida F1)
const repoFull = fs.mkdtempSync(path.join(os.tmpdir(), "qa-full-"));
fs.writeFileSync(path.join(repoFull, "package.json"), JSON.stringify({
  name: "demo", devDependencies: { eslint: "9", vitest: "1", "@playwright/test": "1" },
}));
fs.writeFileSync(path.join(repoFull, ".eslintrc.json"), "{}");
fs.writeFileSync(path.join(repoFull, "vitest.config.ts"), "export default {}");
fs.writeFileSync(path.join(repoFull, "playwright.config.ts"), "export default {}");

// 10a. unit con fallos → fail; e2e limpio → pass (cada runner detecta su herramienta)
const evUnitFail = runUnitTests({ repoRoot: repoFull, exec: () => ({ code: 1, stdout: "2 failed", stderr: "" }) });
assert.strictEqual(evUnitFail.layer, "unit");
assert.strictEqual(evUnitFail.status, "fail");
assert.strictEqual(evUnitFail.metrics.tool, "vitest");
assert.ok(evUnitFail.narrative.includes("vitest") && evUnitFail.narrative.includes("2 failed"));
const evE2ePass = runE2eTests({ repoRoot: repoFull, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
assert.strictEqual(evE2ePass.layer, "e2e");
assert.strictEqual(evE2ePass.status, "pass");
assert.strictEqual(evE2ePass.metrics.tool, "playwright");

// 10b. repo sin tests → unit/e2e se omiten con aviso (no abortan)
const repoEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "qa-empty-"));
assert.strictEqual(runUnitTests({ repoRoot: repoEmpty }).status, "skip");
assert.strictEqual(runE2eTests({ repoRoot: repoEmpty }).status, "skip");

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

console.log(`\n== ${passed}/10 OK ==`);
console.log("Reporte de ejemplo:", res.dir);
fs.rmSync(tmp, { recursive: true, force: true });
