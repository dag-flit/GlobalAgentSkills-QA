// smoke-test.mjs — verifica el plumbing del kit de punta a punta, sin red.
// Corre con: node runtime/smoke-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProfile, deepMerge } from "./profile/resolve-profile.mjs";
import { getAdapter } from "../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "./detect/qa-detect.mjs";
import { runStaticAnalysis } from "./runners/static-analysis.mjs";
import { runUnitTests } from "./runners/unit.mjs";
import { runE2eTests } from "./runners/e2e.mjs";
import { runDbTests } from "./runners/db.mjs";
import { runSecurityTests } from "./runners/security.mjs";
import { runApiTests } from "./runners/api.mjs";
import { runQaCycle } from "./orchestrator.mjs";
import { buildTarget, TARGETS } from "./delivery/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // runtime/
const REPO_ROOT = path.resolve(HERE, "..");

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

// 11. adapter ADO real con transporte INYECTABLE (offline): contrato completo
const repoAdo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ado-"));
const creds = {
  AZURE_ORG_URL: "https://dev.azure.com/acme",
  AZURE_PROJECT_NAME: "Proj",
  AZURE_PAT: "secret",
  USER_REAL_EMAIL: "qa@acme.io",
};
function makeFakeAdo(routes) {
  const calls = [];
  const http = async (req) => {
    calls.push(req);
    for (const [match, respond] of routes) if (match(req)) return respond(req);
    return { status: 200, json: {}, text: "{}" };
  };
  const find = (method, sub) => calls.find((c) => c.method === method && c.url.includes(sub));
  return { http, calls, find };
}
const fake = makeFakeAdo([
  [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
  [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 55 } })],
  [(r) => r.method === "GET" && r.url.includes("/wit/workitems/123"), () => ({
    status: 200,
    json: { fields: {
      "System.Title": "Login",
      "System.State": "Resolved",
      "Microsoft.VSTS.Common.AcceptanceCriteria": "<div>Scenario: login ok</div><br>- [ ] valida sesión",
    } },
  })],
  [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 999 } })],
  [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/77"), () => ({ status: 200, json: { id: 77 } })],
  [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
]);
const adoReal = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAdo, http: fake.http });

// 11a. preflight: con env + proyecto accesible → ok (valida vía REST, no solo presencia)
const pfOk = await adoReal.preflight();
assert.strictEqual(pfOk.ok, true);
assert.ok(fake.find("GET", "/_apis/projects/Proj"));

// 11b. getWorkItem: mapea título/estado y normaliza AC (HTML → líneas)
const wiReal = await adoReal.getWorkItem("123");
assert.strictEqual(wiReal.title, "Login");
assert.strictEqual(wiReal.state, "Resolved");
assert.ok(wiReal.acceptance_criteria.some((a) => /login ok/i.test(a)));
assert.ok(wiReal.acceptance_criteria.some((a) => /valida sesión/i.test(a)));

// 11c. publishEvidence dual: resumen en Discussion del padre + reporte local md/html
const pubAdo = await adoReal.publishEvidence(
  { work_item_id: "123" },
  { results: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto" }] }
);
assert.strictEqual(pubAdo.sink, "dual");
assert.strictEqual(pubAdo.parentCommentId, 55);
assert.ok(fs.existsSync(pubAdo.local.mdPath) && fs.existsSync(pubAdo.local.htmlPath));
assert.strictEqual(pubAdo.attachments.uploaded, 0); // sin files[] en este resultado
const commentReq = fake.find("POST", "/workItems/123/comments");
assert.ok(JSON.parse(commentReq.body).text.includes("Resumen QA"));

// 11d. createDefect: crea Bug con el tag de la org (del overlay flit) y enlace al padre
const bugId = await adoReal.createDefect({ title: "Falla login", description: "pasos", parent_id: "123" });
assert.strictEqual(bugId, "999");
const bugOps = JSON.parse(fake.find("POST", "/wit/workitems/$Bug").body);
assert.ok(bugOps.some((o) => o.path === "/fields/System.Tags" && o.value === "QA_NOVEDAD"));
assert.ok(bugOps.some((o) => o.path === "/relations/-"));

// 11e. updateCycle: mapea clave lógica → ref Custom.* del perfil
const upd = await adoReal.updateCycle("123", { test_start_date: "2026-06-18" });
assert.strictEqual(upd.ok, true);
const updOps = JSON.parse(fake.find("PATCH", "/wit/workitems/123").body);
assert.ok(updOps.some((o) => o.path === "/fields/Custom.TestStartDate"));

// 11f. closeArtifact: TC aprobado → estado pass del perfil (Closed)
const closed = await adoReal.closeArtifact("77", { type: "tc", passed: true });
assert.strictEqual(closed.ok, true);
assert.strictEqual(closed.state, "Closed");

// 11g. preflight degrada sin red real: 203 (PAT inválido) → ok:false con detalle
const fake203 = makeFakeAdo([[(r) => r.url.includes("/_apis/projects/"), () => ({ status: 203, json: null })]]);
const adoBadPat = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAdo, http: fake203.http });
const pfBad = await adoBadPat.preflight();
assert.strictEqual(pfBad.ok, false);
assert.ok(/PAT/.test(pfBad.detail));

fs.rmSync(repoAdo, { recursive: true, force: true });
ok("adapter ADO: preflight REST, getWorkItem/AC, publishEvidence dual, createDefect, updateCycle, closeArtifact");

// 12. tc-match + adjuntos: el png se sube y se enlaza al Task hijo resuelto por mapping_file
const repoAtt = fs.mkdtempSync(path.join(os.tmpdir(), "qa-att-"));
fs.mkdirSync(path.join(repoAtt, ".qa", "mappings"), { recursive: true });
fs.writeFileSync(path.join(repoAtt, ".qa", "mappings", "wi-123.json"), JSON.stringify({ "TC-1": 4567 }));
const shot = path.join(repoAtt, "shot.png");
fs.writeFileSync(shot, "PNGDATA");
const fakeAtt = makeFakeAdo([
  [(r) => r.method === "POST" && r.url.includes("/wit/attachments"), () => ({ status: 201, json: { id: "att1", url: "https://dev.azure.com/acme/_apis/wit/attachments/att1" } })],
  [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/4567"), () => ({ status: 200, json: { id: 4567 } })],
  [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 1 } })],
]);
const adoAtt = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAtt, http: fakeAtt.http });
const pubAtt = await adoAtt.publishEvidence(
  { work_item_id: "123" },
  { results: [
    { layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto", files: [shot] },
    { layer: "e2e", tc_id: "TC-9", status: "fail", narrative: "sin task", files: [shot] }, // no mapeado → warn
  ] }
);
assert.strictEqual(pubAtt.attachments.uploaded, 1);
assert.strictEqual(pubAtt.attachments.linked[0].taskId, "4567");
assert.strictEqual(pubAtt.attachments.linked[0].strategy, "mapping_file");
assert.strictEqual(pubAtt.attachments.unmatched.length, 1);   // TC-9 degrada con aviso, no aborta
assert.ok(fakeAtt.find("POST", "/wit/attachments"));
const linkOps = JSON.parse(fakeAtt.find("PATCH", "/wit/workitems/4567").body);
assert.ok(linkOps.some((o) => o.value && o.value.rel === "AttachedFile"));
fs.rmSync(repoAtt, { recursive: true, force: true });
ok("tc-match + adjuntos: png subido y enlazado al Task hijo (mapping_file); no-match degrada con aviso");

// 13. ciclo dual end-to-end: orquestador con tracker ADO publica resumen en el padre (offline)
const repoDual = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dual-"));
fs.writeFileSync(path.join(repoDual, "package.json"), JSON.stringify({ name: "demo", devDependencies: { eslint: "9" } }));
fs.writeFileSync(path.join(repoDual, ".eslintrc.json"), "{}");
const fakeDual = makeFakeAdo([
  [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
  [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 77 } })],
]);
const cycleDual = await runQaCycle({
  repoRoot: repoDual, env: creds, profile: pFlit, workItemId: "123",
  exec: () => ({ code: 0, stdout: "", stderr: "" }), http: fakeDual.http,
});
assert.strictEqual(cycleDual.ok, true);
assert.strictEqual(cycleDual.tracker, "azure-devops");
assert.ok(cycleDual.preflight && cycleDual.preflight.ok);          // preflight REST corrió y pasó
assert.strictEqual(cycleDual.report.sink, "dual");
assert.strictEqual(cycleDual.report.parentCommentId, 77);          // resumen publicado en el padre
assert.ok(fakeDual.find("POST", "/workItems/123/comments"));
const staticDual = cycleDual.results.find((r) => r.layer === "static");
assert.ok(staticDual && staticDual.status === "pass");
fs.rmSync(repoDual, { recursive: true, force: true });
ok("ciclo dual: orquestador ADO corre preflight REST + runners y publica resumen en el WI padre");

// helper: ejecutor que captura los argv (para verificar conexión/ruleset/colección)
function capturingExec(code, out = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    return { code, stdout: out.stdout || "", stderr: out.stderr || "" };
  };
  return { exec, calls };
}

// 14. runners db/security/api: argv dinámico desde env/profile/archivos
// db: pgtap sin conexión → skip; con DATABASE_URL → corre con la conexión de env
const repoDb = fs.mkdtempSync(path.join(os.tmpdir(), "qa-db-"));
fs.writeFileSync(path.join(repoDb, "schema.pgtap"), "-- tests");
const dbSkip = runDbTests({ repoRoot: repoDb, env: {} });
assert.strictEqual(dbSkip.status, "skip");
assert.ok(/DATABASE_URL/.test(dbSkip.narrative)); // conexión nunca cableada
const capDb = capturingExec(0);
const dbPass = runDbTests({ repoRoot: repoDb, env: { DATABASE_URL: "postgres://u@h/db" }, exec: capDb.exec });
assert.strictEqual(dbPass.status, "pass");
assert.strictEqual(dbPass.metrics.tool, "pgtap");
assert.ok(capDb.calls[0].args.includes("postgres://u@h/db"));
fs.rmSync(repoDb, { recursive: true, force: true });

// security: semgrep; target_profile ajusta el ruleset; hallazgos → fail
const repoSec = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sec-"));
fs.writeFileSync(path.join(repoSec, ".semgrep.yml"), "rules: []");
const capSec = capturingExec(0);
const secPass = runSecurityTests({ repoRoot: repoSec, profile: { security: { target_profile: "api" } }, exec: capSec.exec });
assert.strictEqual(secPass.status, "pass");
assert.strictEqual(secPass.metrics.tool, "semgrep");
assert.ok(capSec.calls[0].args.includes("p/owasp-top-ten")); // target_profile=api
const secFail = runSecurityTests({ repoRoot: repoSec, exec: capturingExec(1, { stdout: "1 finding" }).exec });
assert.strictEqual(secFail.status, "fail");
fs.rmSync(repoSec, { recursive: true, force: true });

// api: postman → newman run <colección>; openapi solo → skip con aviso
const repoApi = fs.mkdtempSync(path.join(os.tmpdir(), "qa-api-"));
fs.writeFileSync(path.join(repoApi, "smoke.postman_collection.json"), "{}");
const capApi = capturingExec(0);
const apiPass = runApiTests({ repoRoot: repoApi, exec: capApi.exec });
assert.strictEqual(apiPass.status, "pass");
assert.strictEqual(apiPass.metrics.tool, "postman");
assert.strictEqual(capApi.calls[0].args[0], "run");
assert.ok(/postman_collection/.test(capApi.calls[0].args[1]));
fs.rmSync(repoApi, { recursive: true, force: true });
const repoOas = fs.mkdtempSync(path.join(os.tmpdir(), "qa-oas-"));
fs.writeFileSync(path.join(repoOas, "openapi.yaml"), "openapi: 3.0.0");
const oasSkip = runApiTests({ repoRoot: repoOas, exec: capturingExec(0).exec });
assert.strictEqual(oasSkip.status, "skip");
assert.strictEqual(oasSkip.metrics.tool, "openapi");
fs.rmSync(repoOas, { recursive: true, force: true });
ok("runners db/security/api: conexión desde env, target_profile ruleset, newman; openapi degrada con aviso");

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
for (const l of ["static", "unit", "e2e", "db", "security"]) {
  assert.strictEqual(byLayer[l], "pass", `capa ${l} debería pasar en el ciclo completo`);
}
assert.strictEqual(byLayer.api, "skip"); // openapi sin runner estándar
fs.rmSync(repoAll, { recursive: true, force: true });
ok("orquestador: cobertura de las 6 capas (static/unit/e2e/db/security pass, api openapi skip)");

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

console.log(`\n== ${passed}/17 OK ==`);
console.log("Reporte de ejemplo:", res.dir);
fs.rmSync(tmp, { recursive: true, force: true });
