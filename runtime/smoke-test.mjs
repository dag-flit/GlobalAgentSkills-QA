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
import { runExplore } from "./runners/explore.mjs";
import { defaultExec } from "./runners/_runner-core.mjs";
import { writeLocalReport } from "./evidence/local-sink.mjs";
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
// security es ZERO-CONFIG: enciende en cualquier repo con código (aquí, semgrep por stack).
assert.deepStrictEqual(det.enabled, ["static", "unit", "e2e", "security"]);
assert.strictEqual(det.layers.e2e.tool, "playwright");
assert.strictEqual(det.layers.security.tool, "semgrep");      // node/react → semgrep
assert.ok(det.layers.security.signals.includes("zero-config")); // sin .semgrep.yml
assert.strictEqual(det.stack.frontend, "react");
assert.strictEqual(det.stack.db, "postgres");
const skippedLayers = det.skipped.map((s) => s.layer);
assert.deepStrictEqual(skippedLayers, ["api", "db"]);          // security ya no se omite
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
  repoRoot: repoDual, env: creds, profile: pFlit, workItemId: "123", featureId: "10118", developer: "Dev Ñoño Pérez",
  exec: () => ({ code: 0, stdout: "", stderr: "" }), http: fakeDual.http,
});
assert.strictEqual(cycleDual.ok, true);
assert.strictEqual(cycleDual.tracker, "azure-devops");
assert.ok(cycleDual.preflight && cycleDual.preflight.ok);          // preflight REST corrió y pasó
assert.strictEqual(cycleDual.report.sink, "dual");
assert.strictEqual(cycleDual.report.parentCommentId, 77);          // resumen publicado en el padre
assert.ok(fakeDual.find("POST", "/workItems/123/comments"));
// FT/dev se propagan al reporte local también con tracker remoto (carpeta unificada con local)
assert.strictEqual(path.basename(cycleDual.report.local.dir), "FT-10118__Dev-Nono-Perez");
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
const dbSkip = runDbTests({ repoRoot: repoDb, env: {} })[0];
assert.strictEqual(dbSkip.status, "skip");
assert.ok(/DATABASE_URL/.test(dbSkip.narrative)); // conexión nunca cableada
const capDb = capturingExec(0);
const dbPass = runDbTests({ repoRoot: repoDb, env: { DATABASE_URL: "postgres://u@h/db" }, exec: capDb.exec })[0];
assert.strictEqual(dbPass.status, "pass");
assert.strictEqual(dbPass.metrics.tool, "pgtap");
assert.ok(capDb.calls[0].args.includes("postgres://u@h/db"));
fs.rmSync(repoDb, { recursive: true, force: true });
// prisma: guarda igual que pgtap → sin conexión skip; con conexión (de cualquier var
// soportada) corre `prisma migrate status`. Cablear a un proyecto futuro = exportar la var.
const repoPrisma = fs.mkdtempSync(path.join(os.tmpdir(), "qa-prisma-"));
fs.mkdirSync(path.join(repoPrisma, "prisma"));
fs.writeFileSync(path.join(repoPrisma, "prisma", "schema.prisma"), "datasource db {}");
const prismaSkip = runDbTests({ repoRoot: repoPrisma, env: {} })[0];
assert.strictEqual(prismaSkip.status, "skip");
assert.strictEqual(prismaSkip.metrics.tool, "prisma");
const capPrisma = capturingExec(0);
const prismaPass = runDbTests({ repoRoot: repoPrisma, env: { PG_CONNECTION: "postgres://u@h/db" }, exec: capPrisma.exec })[0];
assert.strictEqual(prismaPass.status, "pass");
assert.deepStrictEqual(capPrisma.calls[0].args, ["migrate", "status"]);
fs.rmSync(repoPrisma, { recursive: true, force: true });

// security: ZERO-CONFIG. Con .semgrep.yml usa esa config + target_profile; SIN config corre
// igual (semgrep `auto`); hallazgos → fail; escáner no instalado → skip.
const repoSec = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sec-"));
fs.writeFileSync(path.join(repoSec, ".semgrep.yml"), "rules: []");
const capSec = capturingExec(0);
const secPass = runSecurityTests({ repoRoot: repoSec, profile: { security: { target_profile: "api" } }, exec: capSec.exec })[0];
assert.strictEqual(secPass.status, "pass");
assert.strictEqual(secPass.metrics.tool, "semgrep");
assert.ok(capSec.calls[0].args.includes("p/owasp-top-ten")); // target_profile=api
const secFail = runSecurityTests({ repoRoot: repoSec, exec: capturingExec(1, { stdout: "1 finding" }).exec })[0];
assert.strictEqual(secFail.status, "fail");                 // exit 1 = hallazgo real → fail
// exit 2 = error de escáner (config/red), NO un hallazgo → skip, no rompe el ciclo
const secErr = runSecurityTests({ repoRoot: repoSec, exec: capturingExec(2, { stderr: "could not reach registry" }).exec })[0];
assert.strictEqual(secErr.status, "skip");
assert.strictEqual(secErr.metrics.exitCode, 2);
fs.rmSync(repoSec, { recursive: true, force: true });
// zero-config: repo SIN ninguna config de seguridad → la capa corre igual con semgrep auto
const repoSecZero = fs.mkdtempSync(path.join(os.tmpdir(), "qa-seczero-"));
fs.writeFileSync(path.join(repoSecZero, "package.json"), JSON.stringify({ name: "z" }));
const capSecZero = capturingExec(0);
const secZero = runSecurityTests({ repoRoot: repoSecZero, exec: capSecZero.exec })[0];
assert.strictEqual(secZero.status, "pass");
assert.strictEqual(secZero.metrics.tool, "semgrep");
assert.ok(capSecZero.calls[0].args.includes("auto")); // ruleset por defecto sin config
// escáner no instalado (127) → skip, nunca aborta
const secNoBin = runSecurityTests({ repoRoot: repoSecZero, exec: capturingExec(127).exec })[0];
assert.strictEqual(secNoBin.status, "skip");
fs.rmSync(repoSecZero, { recursive: true, force: true });
// bandit (stack Python): escanea recursivo PERO excluye directorios de test → `assert` en
// pytest (B101) no es un hallazgo de seguridad y no debe romper el gate por ruido.
const repoBandit = fs.mkdtempSync(path.join(os.tmpdir(), "qa-bandit-"));
fs.writeFileSync(path.join(repoBandit, "pyproject.toml"), "[project]\nname='x'");
const capBandit = capturingExec(0);
const banditRun = runSecurityTests({ repoRoot: repoBandit, exec: capBandit.exec })[0];
assert.strictEqual(banditRun.metrics.tool, "bandit");            // python → bandit
const banditArgs = capBandit.calls[0].args;
assert.ok(banditArgs.includes("--exclude"));
assert.ok(banditArgs.some((a) => /\*\/tests\/\*/.test(a)));      // tests fuera del scan
fs.rmSync(repoBandit, { recursive: true, force: true });

// api: postman → newman run <colección>; openapi → redocly lint (validación offline)
const repoApi = fs.mkdtempSync(path.join(os.tmpdir(), "qa-api-"));
fs.writeFileSync(path.join(repoApi, "smoke.postman_collection.json"), "{}");
const capApi = capturingExec(0);
const apiPass = runApiTests({ repoRoot: repoApi, exec: capApi.exec })[0];
assert.strictEqual(apiPass.status, "pass");
assert.strictEqual(apiPass.metrics.tool, "postman");
assert.strictEqual(capApi.calls[0].args[0], "run");
assert.ok(/postman_collection/.test(capApi.calls[0].args[1]));
fs.rmSync(repoApi, { recursive: true, force: true });
// openapi: corre `redocly lint` (validación de contrato offline). Ruleset por defecto
// `minimal`; el perfil puede sobreescribirlo. Exit 0 inyectado → pass.
const repoOas = fs.mkdtempSync(path.join(os.tmpdir(), "qa-oas-"));
fs.mkdirSync(path.join(repoOas, "docs"));
fs.writeFileSync(path.join(repoOas, "docs", "openapi.yaml"), "openapi: 3.1.0");
const capOas = capturingExec(0);
const oasRun = runApiTests({ repoRoot: repoOas, exec: capOas.exec })[0];
assert.strictEqual(oasRun.status, "pass");
assert.strictEqual(oasRun.metrics.tool, "openapi");
assert.ok(capOas.calls[0].args.includes("lint"));
assert.ok(capOas.calls[0].args.some((a) => /openapi\.yaml$/.test(a))); // spec localizada en subcarpeta
assert.ok(capOas.calls[0].args.includes("--extends=minimal")); // ruleset por defecto
// el perfil sobreescribe el ruleset
const capOasStrict = capturingExec(0);
runApiTests({ repoRoot: repoOas, profile: { api: { openapi_ruleset: "recommended" } }, exec: capOasStrict.exec });
assert.ok(capOasStrict.calls[0].args.includes("--extends=recommended"));
// exit ≠ 0 (errores de contrato) → fail
const oasFail = runApiTests({ repoRoot: repoOas, exec: capturingExec(1, { stdout: "Validation failed" }).exec })[0];
assert.strictEqual(oasFail.status, "fail");
fs.rmSync(repoOas, { recursive: true, force: true });
// openapi versionado en carpeta `openapi/` (p.ej. contracts/openapi/core-api.v1.yaml): un
// contrato real no siempre se llama openapi.yaml. qa-detect debe ENCENDER la capa por la ruta,
// y el runner debe LOCALIZAR el spec aunque esté 2+ niveles abajo y con nombre propio.
const repoOasV = fs.mkdtempSync(path.join(os.tmpdir(), "qa-oasv-"));
fs.mkdirSync(path.join(repoOasV, "contracts", "openapi"), { recursive: true });
fs.writeFileSync(path.join(repoOasV, "contracts", "openapi", "core-api.v1.yaml"), "openapi: 3.1.0");
const detOasV = detectRepo({ repoRoot: repoOasV });
assert.ok(detOasV.enabled.includes("api"));                       // detección por carpeta openapi/
assert.strictEqual(detOasV.layers.api.tool, "openapi");
const capOasV = capturingExec(0);
const oasVRun = runApiTests({ repoRoot: repoOasV, exec: capOasV.exec })[0];
assert.strictEqual(oasVRun.status, "pass");                       // spec localizada 2 niveles abajo
assert.ok(capOasV.calls[0].args.some((a) => /core-api\.v1\.yaml$/.test(a)));
fs.rmSync(repoOasV, { recursive: true, force: true });
ok("runners db/security/api: conexión desde env, target_profile ruleset, newman; openapi → redocly lint offline (incl. contrato versionado en openapi/)");

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

// 18. adapter GitHub con transporte inyectable (offline): contrato sobre Issues
const repoGh = fs.mkdtempSync(path.join(os.tmpdir(), "qa-gh-"));
fs.mkdirSync(path.join(repoGh, ".qa"), { recursive: true });
fs.writeFileSync(path.join(repoGh, ".qa", "qa-project.profile.yaml"), "profile: github\n");
const { profile: pGithub } = resolveProfile({ repoRoot: repoGh });
assert.strictEqual(pGithub.tracker, "github");
const ghEnv = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };
const fakeGh = makeFakeAdo([
  [(r) => r.method === "GET" && /\/repos\/o\/r\/issues\/5$/.test(r.url), () => ({ status: 200, json: { title: "Bug X", state: "open", body: "Scenario: login\n- [ ] valida sesión" } })],
  [(r) => r.method === "GET" && /\/repos\/o\/r$/.test(r.url), () => ({ status: 200, json: { full_name: "o/r" } })],
  [(r) => r.method === "POST" && /\/issues\/5\/comments$/.test(r.url), () => ({ status: 201, json: { id: 88 } })],
  [(r) => r.method === "POST" && /\/repos\/o\/r\/issues$/.test(r.url), () => ({ status: 201, json: { number: 321 } })],
  [(r) => r.method === "PATCH" && /\/issues\/5$/.test(r.url), () => ({ status: 200, json: { number: 5, state: "closed" } })],
]);
const gh = getAdapter({ profile: pGithub, env: ghEnv, repoRoot: repoGh, http: fakeGh.http });
assert.strictEqual(gh.name, "github");
assert.strictEqual(gh.capabilities().custom_fields, false);
assert.ok((await gh.preflight()).ok);
const ghWi = await gh.getWorkItem("5");
assert.strictEqual(ghWi.title, "Bug X");
assert.ok(ghWi.acceptance_criteria.some((a) => /valida sesión/.test(a)));
const ghPub = await gh.publishEvidence({ work_item_id: "5" }, { results: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "roto" }] });
assert.strictEqual(ghPub.commentId, 88);
assert.ok(fs.existsSync(ghPub.local.mdPath));
const ghBug = await gh.createDefect({ title: "Falla", description: "pasos" });
assert.strictEqual(ghBug, "321");
const ghCreateBody = JSON.parse(fakeGh.calls.find((c) => c.method === "POST" && /\/repos\/o\/r\/issues$/.test(c.url)).body);
assert.ok(ghCreateBody.labels.includes("qa-defect"));
assert.strictEqual((await gh.closeArtifact("5", { passed: true })).state, "closed");
assert.deepStrictEqual(await gh.updateCycle("5", { test_start_date: "x" }), { ok: true, noop: true, reason: "github: sin custom fields (usa labels)" });
fs.rmSync(repoGh, { recursive: true, force: true });
ok("adapter GitHub: preflight, getWorkItem/AC, comentario, createDefect+label, closeArtifact; updateCycle no-op");

// 19. adapter Jira con transporte inyectable (offline): contrato sobre API v3
const repoJira = fs.mkdtempSync(path.join(os.tmpdir(), "qa-jira-"));
fs.mkdirSync(path.join(repoJira, ".qa"), { recursive: true });
fs.writeFileSync(path.join(repoJira, ".qa", "qa-project.profile.yaml"), "profile: jira\n");
const { profile: pJira } = resolveProfile({ repoRoot: repoJira });
assert.strictEqual(pJira.tracker, "jira");
const jiraEnv = { JIRA_BASE_URL: "https://acme.atlassian.net", JIRA_EMAIL: "qa@acme.io", JIRA_TOKEN: "t", JIRA_PROJECT_KEY: "QA" };
const fakeJira = makeFakeAdo([
  [(r) => r.method === "GET" && /\/rest\/api\/3\/myself$/.test(r.url), () => ({ status: 200, json: { accountId: "a1" } })],
  [(r) => r.method === "GET" && /\/issue\/QA-5$/.test(r.url), () => ({ status: 200, json: { fields: { summary: "Login", status: { name: "In Progress" }, description: "- [ ] valida login" } } })],
  [(r) => r.method === "POST" && /\/issue\/QA-5\/comment$/.test(r.url), () => ({ status: 201, json: { id: "c9" } })],
  [(r) => r.method === "POST" && /\/issue\/QA-5\/transitions$/.test(r.url), () => ({ status: 204, json: null })],
  [(r) => r.method === "PUT" && /\/issue\/QA-5$/.test(r.url), () => ({ status: 204, json: null })],
  [(r) => r.method === "POST" && /\/rest\/api\/3\/issue$/.test(r.url), () => ({ status: 201, json: { key: "QA-42" } })],
]);
const jira = getAdapter({ profile: pJira, env: jiraEnv, repoRoot: repoJira, http: fakeJira.http });
assert.strictEqual(jira.name, "jira");
assert.strictEqual(jira.capabilities().custom_fields, true);
assert.ok((await jira.preflight()).ok);
const jWi = await jira.getWorkItem("QA-5");
assert.strictEqual(jWi.title, "Login");
assert.strictEqual(jWi.state, "In Progress");
assert.ok(jWi.acceptance_criteria.some((a) => /valida login/.test(a)));
const jPub = await jira.publishEvidence({ work_item_id: "QA-5" }, { results: [{ layer: "unit", status: "pass" }] });
assert.strictEqual(jPub.commentId, "c9");
const jBug = await jira.createDefect({ title: "Falla", description: "pasos" });
assert.strictEqual(jBug, "QA-42");
const jBugFields = JSON.parse(fakeJira.calls.find((c) => c.method === "POST" && /\/rest\/api\/3\/issue$/.test(c.url)).body).fields;
assert.strictEqual(jBugFields.project.key, "QA");
assert.strictEqual(jBugFields.issuetype.name, "Bug");
const jUpd = await jira.updateCycle("QA-5", { test_start_date: "2026-06-18" });
assert.strictEqual(jUpd.ok, true);
const jUpdFields = JSON.parse(fakeJira.find("PUT", "/issue/QA-5").body).fields;
assert.ok(Object.prototype.hasOwnProperty.call(jUpdFields, "customfield_10010"));
const jClose = await jira.closeArtifact("QA-5", { passed: true });
assert.strictEqual(jClose.transitionId, "31");
fs.rmSync(repoJira, { recursive: true, force: true });
ok("adapter Jira: preflight, getWorkItem/AC, comentario ADF, createDefect, updateCycle (customfield), transición");

// 20. monorepo pnpm: herramientas en un subpaquete (frontend/), NO en la raíz.
// qa-detect debe ubicar la cwd de cada capa en el subpaquete y el runner debe
// resolver el binario de frontend/node_modules/.bin y EJECUTAR ahí (no en la raíz).
const repoMono = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mono-"));
// raíz: solo workspace manifest, SIN deps de test ni node_modules
fs.writeFileSync(path.join(repoMono, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["frontend"] }));
fs.writeFileSync(path.join(repoMono, "pnpm-workspace.yaml"), "packages:\n  - frontend\n");
// subpaquete frontend/ con vitest + playwright + tsconfig y sus binarios locales
const feDir = path.join(repoMono, "frontend");
fs.mkdirSync(feDir, { recursive: true });
fs.writeFileSync(path.join(feDir, "package.json"), JSON.stringify({
  name: "@app/frontend", devDependencies: { vitest: "1", "@playwright/test": "1", typescript: "5" },
}));
fs.writeFileSync(path.join(feDir, "vitest.config.ts"), "export default {}");
fs.writeFileSync(path.join(feDir, "playwright.config.ts"), "export default {}");
fs.writeFileSync(path.join(feDir, "tsconfig.json"), "{}");
// binarios "instalados" SOLO en frontend/node_modules/.bin (layout pnpm)
const feBin = path.join(feDir, "node_modules", ".bin");
fs.mkdirSync(feBin, { recursive: true });
for (const b of ["vitest", "playwright", "tsc"]) fs.writeFileSync(path.join(feBin, b + (process.platform === "win32" ? ".cmd" : "")), "");

// 20a. detección: capas encendidas con cwd = "frontend" (no la raíz). security es
// zero-config → siempre presente (no afecta la ubicación de las capas con tooling).
const monoDet = detectRepo({ repoRoot: repoMono });
assert.deepStrictEqual(monoDet.enabled.sort(), ["e2e", "security", "static", "unit"]);
assert.strictEqual(monoDet.layers.unit.cwd, "frontend");
assert.strictEqual(monoDet.layers.e2e.cwd, "frontend");
assert.strictEqual(monoDet.layers.static.cwd, "frontend");

// 20b. el runner ejecuta en frontend/ y resuelve el bin del subpaquete (no cae a PATH)
const monoCalls = [];
const monoExec = (cmd, args, ctx) => { monoCalls.push({ cmd, args, cwd: ctx.cwd }); return { code: 0, stdout: "", stderr: "" }; };
const monoUnit = runUnitTests({ repoRoot: repoMono, detection: monoDet, exec: monoExec })[0];
assert.strictEqual(monoUnit.status, "pass");
assert.strictEqual(monoUnit.metrics.tool, "vitest");
assert.strictEqual(monoCalls[0].cwd, feDir);                       // corrió EN frontend/
assert.ok(monoCalls[0].cmd.includes(path.join("frontend", "node_modules", ".bin", "vitest"))); // bin del subpaquete
fs.rmSync(repoMono, { recursive: true, force: true });
ok("monorepo pnpm: qa-detect ubica cwd en el subpaquete y el runner resuelve/ejecuta el bin local de frontend/");

// 21. monorepo de STACK MIXTO: una misma capa con DOS herramientas en dos paquetes.
// unit = vitest (frontend, bin local) + dotnet-test (backend .NET, vía PATH). El kit debe
// correr AMBAS (no solo la de mayor prioridad) → dos EvidenceObjects para la capa unit.
const repoMix = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mix-"));
fs.writeFileSync(path.join(repoMix, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["frontend"] }));
const mxFe = path.join(repoMix, "frontend");
fs.mkdirSync(path.join(mxFe, "node_modules", ".bin"), { recursive: true });
fs.writeFileSync(path.join(mxFe, "package.json"), JSON.stringify({ name: "@app/web", devDependencies: { vitest: "1" } }));
fs.writeFileSync(path.join(mxFe, "vitest.config.ts"), "export default {}");
fs.writeFileSync(path.join(mxFe, "node_modules", ".bin", "vitest" + (process.platform === "win32" ? ".cmd" : "")), "");
// backend .NET SIN package.json → su csproj de test pertenece al scope raíz
const mxBe = path.join(repoMix, "backend", "Api.Tests");
fs.mkdirSync(mxBe, { recursive: true });
fs.writeFileSync(path.join(mxBe, "Api.Tests.csproj"), "<Project/>");

const mixDet = detectRepo({ repoRoot: repoMix });
const unitTools = mixDet.layers.unit.targets.map((t) => `${t.tool}@${t.cwd}`).sort();
assert.deepStrictEqual(unitTools, ["dotnet-test@", "vitest@frontend"]); // DOS objetivos
const mixCalls = [];
const mixExec = (cmd, args, ctx) => { mixCalls.push({ cmd, args, cwd: ctx.cwd }); return { code: 0, stdout: "", stderr: "" }; };
const mixUnit = runUnitTests({ repoRoot: repoMix, detection: mixDet, exec: mixExec });
assert.strictEqual(mixUnit.length, 2);                                  // corre AMBOS
assert.ok(mixUnit.every((r) => r.status === "pass"));
const byTool = Object.fromEntries(mixUnit.map((r) => [r.metrics.tool, r]));
assert.strictEqual(byTool.vitest.metrics.cwd, "frontend");
assert.strictEqual(byTool["dotnet-test"].metrics.cwd, "");
// vitest resuelto al bin del subpaquete y ejecutado ahí; dotnet vía PATH desde la raíz
const vitestCall = mixCalls.find((c) => c.cmd.includes("vitest"));
assert.ok(vitestCall.cmd.includes(path.join("frontend", "node_modules", ".bin", "vitest")));
assert.strictEqual(vitestCall.cwd, mxFe);
const dotnetCall = mixCalls.find((c) => c.cmd === "dotnet");
assert.strictEqual(dotnetCall.cwd, repoMix);
fs.rmSync(repoMix, { recursive: true, force: true });
ok("monorepo mixto: la capa unit corre vitest@frontend Y dotnet-test@backend (N objetivos por capa)");

// 22. ejecución con RUTA CON ESPACIOS (regresión Windows real): un binario en una carpeta
// con espacios debe EJECUTARSE, no partirse en el shell ("C:\FLIT\TEST no se reconoce…").
const spRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa sp-"));
const spDir = path.join(spRoot, "with space");
fs.mkdirSync(spDir, { recursive: true });
const spOutExpected = "hello-kit";
let spBin;
if (process.platform === "win32") {
  spBin = path.join(spDir, "hello.cmd");
  fs.writeFileSync(spBin, `@echo ${spOutExpected}\r\n`);
} else {
  spBin = path.join(spDir, "hello.sh");
  fs.writeFileSync(spBin, `#!/bin/sh\necho ${spOutExpected}\n`);
  fs.chmodSync(spBin, 0o755);
}
const spRes = defaultExec(spBin, [], { cwd: spDir });
assert.strictEqual(spRes.code, 0, "binario en ruta con espacios debe ejecutar (no 'no se reconoce')");
assert.ok(spRes.stdout.includes(spOutExpected));
// binario INEXISTENTE → code 127 (→ skip), cross-platform: ENOENT en POSIX, 9009/"is not
// recognized" en Windows. Garantiza que un escáner ausente se OMITA, no se reporte fail.
assert.strictEqual(defaultExec("qa-bin-inexistente-zzz", [], { cwd: spDir }).code, 127);
fs.rmSync(spRoot, { recursive: true, force: true });
ok("ejecución robusta: binario en ruta con espacios se ejecuta citado (regresión Windows)");

// 23. detalle por TC: el reporter JSON de la herramienta se parsea a casos estructurados
// (nombre/estado/duración/error) y se plasma bajo cada capa en la evidencia (local + remoto).
// 23a. el runner pide el reporter JSON y mapea su salida a `cases`.
const repoCases = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cases-"));
fs.writeFileSync(path.join(repoCases, "package.json"), JSON.stringify({ name: "c", devDependencies: { vitest: "1" } }));
fs.writeFileSync(path.join(repoCases, "vitest.config.ts"), "export default {}");
const vitestJson = JSON.stringify({
  testResults: [{
    assertionResults: [
      { ancestorTitles: ["auth"], title: "login redirige al dashboard", status: "passed", duration: 45, failureMessages: [] },
      { ancestorTitles: ["cart"], title: "aplica cupón de descuento", status: "failed", duration: 88, failureMessages: ["AssertionError: expected 90 to be 80"] },
    ],
  }],
});
let casesArgs = null;
const evCases = runUnitTests({ repoRoot: repoCases, exec: (cmd, args) => { casesArgs = args; return { code: 1, stdout: vitestJson, stderr: "" }; } })[0];
assert.ok(casesArgs.includes("--reporter=json"));               // pidió el reporter JSON nativo
assert.ok(Array.isArray(evCases.cases) && evCases.cases.length === 2);
assert.deepStrictEqual(evCases.cases.map((c) => c.status), ["pass", "fail"]);
assert.strictEqual(evCases.cases[0].name, "auth › login redirige al dashboard");
assert.strictEqual(evCases.cases[0].duration, 45);
assert.ok(/AssertionError/.test(evCases.cases[1].message));     // mensaje de error del TC fallido
assert.ok(/2 TC/.test(evCases.narrative));                      // narrativa derivada de los casos
// salida que NO es el JSON esperado → degrada a null (resumen de texto), nunca rompe
const evNoCases = runUnitTests({ repoRoot: repoCases, exec: () => ({ code: 1, stdout: "2 failed", stderr: "" }) })[0];
assert.strictEqual(evNoCases.cases, undefined);
assert.ok(/2 failed/.test(evNoCases.narrative));
fs.rmSync(repoCases, { recursive: true, force: true });
// 23b. el sink local plasma el detalle de TC bajo cada capa en md y html.
const repoSink = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sink-cases-"));
const sinkOut = writeLocalReport({
  repoRoot: repoSink, profile: {}, workItemId: "TCDETAIL",
  results: [{ layer: "unit", status: "fail", narrative: "vitest: exit 1", metrics: { tool: "vitest" }, cases: [
    { name: "auth › login", status: "pass", duration: 45, message: null },
    { name: "cart › cupón", status: "fail", duration: 88, message: "AssertionError: expected 90 to be 80" },
  ] }],
});
const sinkMd = fs.readFileSync(sinkOut.mdPath, "utf8");
assert.ok(/Detalle de pruebas \(TC ejecutados\)/.test(sinkMd));
assert.ok(/auth › login/.test(sinkMd) && /cart › cupón/.test(sinkMd) && /AssertionError/.test(sinkMd));
const sinkHtml = fs.readFileSync(sinkOut.htmlPath, "utf8");
assert.ok(/Detalle de pruebas/.test(sinkHtml) && /<details/.test(sinkHtml));
fs.rmSync(repoSink, { recursive: true, force: true });
ok("detalle por TC: runner mapea el reporter JSON a `cases` (degrada a resumen si no hay JSON) y el sink lo plasma en md/html");

// 24. Novedad → Bug enlazado a la HU + reactivación de la HU + trazabilidad en su comentario.
// 24a. reactivateRequirement (ADO, unit): PATCH estado a "Active" + comentario con enlace al Bug.
const repoNov = fs.mkdtempSync(path.join(os.tmpdir(), "qa-nov-"));
const fakeNov = makeFakeAdo([
  [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 77 } })],
  [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
]);
const adoNov = getAdapter({ profile: pFlit, env: creds, repoRoot: repoNov, http: fakeNov.http });
const react = await adoNov.reactivateRequirement("123", {
  bugId: "999",
  items: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto", metrics: { tool: "playwright" } }],
});
assert.strictEqual(react.ok, true);
assert.strictEqual(react.state, "Active");                       // on_defect_reactivate_state del preset
const reactPatch = JSON.parse(fakeNov.find("PATCH", "/wit/workitems/123").body);
assert.ok(reactPatch.some((o) => o.path === "/fields/System.State" && o.value === "Active"));
const reactComment = JSON.parse(fakeNov.find("POST", "/workItems/123/comments").body);
assert.ok(/Novedad QA/.test(reactComment.text));
assert.ok(/_workitems\/edit\/999/.test(reactComment.text));      // enlace de trazabilidad al Bug
assert.ok(/login roto/.test(reactComment.text));                 // hallazgo listado en la HU

// 24b. ciclo completo (runQaCycle, ADO offline): una falla dispara createDefect + reactivación.
fs.writeFileSync(path.join(repoNov, "package.json"), JSON.stringify({ name: "nov", devDependencies: { vitest: "1" } }));
fs.writeFileSync(path.join(repoNov, "vitest.config.ts"), "export default {}");
const pNov = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });   // acota la corrida a unit
const fakeCycle = makeFakeAdo([
  [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
  [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 1 } })],
  [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 999 } })],
  [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
]);
const novCycle = await runQaCycle({
  repoRoot: repoNov, env: creds, profile: pNov, workItemId: "123", http: fakeCycle.http,
  exec: () => ({ code: 1, stdout: "1 failed", stderr: "" }),
});
assert.ok(Array.isArray(novCycle.novelties) && novCycle.novelties.length === 1);
assert.strictEqual(novCycle.novelties[0].work_item_id, "123");
assert.strictEqual(novCycle.novelties[0].bugId, "999");
assert.strictEqual(novCycle.novelties[0].reactivation.state, "Active");
const bugPayload = JSON.parse(fakeCycle.find("POST", "/wit/workitems/$Bug").body);
assert.ok(bugPayload.some((o) => o.path === "/relations/-"));    // Bug enlazado a la HU padre
fs.rmSync(repoNov, { recursive: true, force: true });
ok("novedad: crea Bug enlazado a la HU, la reactiva (Active) y deja trazabilidad en su comentario");

// 25. Guarda online: tracker remoto SIN -w (workItemId="local") NO comenta sobre una HU
// inexistente (evitaría un 404 online); degrada a solo reporte local + aviso.
const repoGuard = fs.mkdtempSync(path.join(os.tmpdir(), "qa-guard-"));
fs.writeFileSync(path.join(repoGuard, "package.json"), JSON.stringify({ name: "g", devDependencies: { vitest: "1" } }));
fs.writeFileSync(path.join(repoGuard, "vitest.config.ts"), "export default {}");
const pGuard = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });
const fakeGuard = makeFakeAdo([
  [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
]);
const guardCycle = await runQaCycle({
  repoRoot: repoGuard, env: creds, profile: pGuard, http: fakeGuard.http,   // SIN workItemId → "local"
  exec: () => ({ code: 1, stdout: "1 failed", stderr: "" }),
});
assert.ok(Array.isArray(guardCycle.warnings) && guardCycle.warnings.some((w) => /-w/.test(w)));
assert.ok(!fakeGuard.calls.some((c) => c.method === "POST" && /\/comments/.test(c.url)));   // NO comentó en la HU
assert.ok(!fakeGuard.calls.some((c) => /\$Bug/.test(c.url)));                                // NO creó Bug (sin HU real)
assert.ok(guardCycle.report && guardCycle.report.local && fs.existsSync(guardCycle.report.local.mdPath)); // sí dejó reporte local
fs.rmSync(repoGuard, { recursive: true, force: true });
ok("guarda online: tracker remoto sin -w no comenta sobre HU inexistente; degrada a reporte local + aviso");

// 26. Runner `explore` (capa de exploración de URL viva): gated por appUrl, launcher de
// navegador INYECTABLE (offline), emite evidencia normalizada; el ciclo lo incluye con appUrl.
// 26a. launcher falso: una URL ok (200) y una "mala" (500) → un EvidenceObject con 2 casos.
const fakeLaunch = () => ({
  async newPage() {
    return {
      on() {},
      async goto(url) {
        return { status: () => (/bad/.test(url) ? 500 : 200) };
      },
      async screenshot() {
        /* no-op: en el fake no se escribe archivo */
      },
      async close() {},
    };
  },
  async close() {},
});
const repoExp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-exp-"));
const expEv = await runExplore({
  repoRoot: repoExp,
  appUrl: "https://app.test/",
  paths: ["https://app.test/bad"],
  launchBrowser: fakeLaunch,
});
assert.strictEqual(expEv.length, 1);
assert.strictEqual(expEv[0].layer, "explore");
assert.strictEqual(expEv[0].status, "fail"); // una URL "mala" (500) → la capa falla
assert.strictEqual(expEv[0].cases.length, 2);
assert.strictEqual(expEv[0].cases[0].status, "pass"); // 200
assert.strictEqual(expEv[0].cases[1].status, "fail"); // 500
assert.ok(/HTTP 500/.test(expEv[0].cases[1].message));
// 26b. gating: sin appUrl → no participa (capa ausente)
assert.deepStrictEqual(await runExplore({ appUrl: "" }), []);
// 26c. sin launcher y sin Playwright instalado en el kit → skip accionable (no rompe)
const expSkip = await runExplore({ repoRoot: repoExp, appUrl: "https://x/" });
assert.strictEqual(expSkip[0].status, "skip");
assert.ok(/Playwright/.test(expSkip[0].narrative));
// 26d. ciclo completo (local) con appUrl + launcher falso → la capa explore entra al reporte
const expCycle = await runQaCycle({
  repoRoot: repoExp,
  profile: pDefault, // local, sin red
  appUrl: "https://app.test/",
  explore: true, // pide explícitamente el crawler (appUrl por sí solo solo da baseURL)
  launchBrowser: fakeLaunch,
  exec: () => ({ code: 0, stdout: "", stderr: "" }),
});
assert.ok(expCycle.results.some((r) => r.layer === "explore" && r.status === "pass"));
fs.rmSync(repoExp, { recursive: true, force: true });
ok("runner explore: gated por URL, launcher inyectable (offline), skip sin Playwright; el ciclo incluye la capa");

// 27. Trazabilidad por-HU: una corrida cuyo Feature paraguas es 100, pero cuyas pruebas
// declaran su HU dueña con la etiqueta [HU-###], registra el Bug en ESA HU (103/104), NO en 100.
// Lo no etiquetado caería al Feature (aquí todas las fallas van etiquetadas).
const repoHu = fs.mkdtempSync(path.join(os.tmpdir(), "qa-hu-"));
fs.writeFileSync(path.join(repoHu, "package.json"), JSON.stringify({ name: "hu", devDependencies: { vitest: "1" } }));
fs.writeFileSync(path.join(repoHu, "vitest.config.ts"), "export default {}");
const pHu = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });
const huVitestJson = JSON.stringify({
  testResults: [{
    assertionResults: [
      { ancestorTitles: ["[HU-103] Checkout"], title: "flujo completo falla", status: "failed", duration: 10, failureMessages: ["AssertionError: boom 103"] },
      { ancestorTitles: ["[HU-104] Pago"], title: "tarjeta rechazada falla", status: "failed", duration: 12, failureMessages: ["AssertionError: boom 104"] },
      { ancestorTitles: ["[HU-103] Checkout"], title: "caso ok", status: "passed", duration: 5, failureMessages: [] },
    ],
  }],
});
const fakeHu = makeFakeAdo([
  [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
  [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 900 } })],
  [(r) => r.method === "PATCH" && /\/wit\/workitems\/\d+/.test(r.url), () => ({ status: 200, json: { id: 1 } })],
  [(r) => r.method === "POST" && /\/workItems\/\d+\/comments/.test(r.url), () => ({ status: 201, json: { id: 1 } })],
]);
const huCycle = await runQaCycle({
  repoRoot: repoHu, env: creds, profile: pHu, workItemId: "100", http: fakeHu.http,   // Feature paraguas = 100
  exec: () => ({ code: 1, stdout: huVitestJson, stderr: "" }),
});
const huIds = (huCycle.novelties || []).map((n) => String(n.work_item_id)).sort();
assert.deepStrictEqual(huIds, ["103", "104"]);                       // Bugs en las HUs etiquetadas…
assert.ok(!huIds.includes("100"));                                   // …NO en el Feature paraguas
assert.ok(huCycle.novelties.every((n) => n.bugId === 900 || n.bugId === "900")); // se creó Bug por HU
// el Bug de la HU 103 enlaza a la 103 como padre (no a 100)
const bug103 = fakeHu.calls.find((c) => c.method === "POST" && /\$Bug/.test(c.url) && /103/.test(c.body));
assert.ok(bug103, "el Bug debe enlazar a la HU 103 como padre");
fs.rmSync(repoHu, { recursive: true, force: true });
ok("trazabilidad por-HU: la etiqueta [HU-###] registra el Bug en esa HU, no en el Feature paraguas");

console.log(`\n== ${passed}/27 OK ==`);
console.log("Reporte de ejemplo:", res.dir);
fs.rmSync(tmp, { recursive: true, force: true });
