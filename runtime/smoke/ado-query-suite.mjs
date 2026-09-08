// runtime/smoke/ado-query-suite.mjs — caso extraído de explore-suite (guardrail 400): el adapter azure
// `queryWorkItems(wiql)` corre un WIQL y normaliza los work items para IMPORTAR al tablero de
// Seguimiento (id/título/tipo/estado/asignado/url). Offline (transporte HTTP inyectable).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { parseTestSteps } from "../../adapters/trackers/azure-devops/ado-teststeps.mjs";

export async function runAdoQuery({ ok, creds, pFlit, makeFakeAdo }) {
  const repoQ = fs.mkdtempSync(path.join(os.tmpdir(), "qa-query-"));
  const fakeQ = makeFakeAdo([
    [(r) => r.method === "POST" && r.url.includes("/wit/wiql"), () => ({ status: 200, json: { workItems: [{ id: 301 }, { id: 302 }] } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/301"), () => ({ status: 200, json: { fields: { "System.Title": "Bug login", "System.State": "Active", "System.WorkItemType": "Bug", "System.AssignedTo": { uniqueName: "ana@flit.com", displayName: "Ana" } } } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/302"), () => ({ status: 200, json: { fields: { "System.Title": "Tarea X", "System.State": "New", "System.WorkItemType": "Task" } } })],
  ]);
  const adoQ = getAdapter({ profile: pFlit, env: creds, repoRoot: repoQ, http: fakeQ.http });
  const wis = await adoQ.queryWorkItems("SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'");
  assert.strictEqual(wis.length, 2);
  assert.deepStrictEqual(wis.map((w) => w.id), ["301", "302"]);
  assert.strictEqual(wis[0].type, "Bug");
  assert.strictEqual(wis[0].assignee, "ana@flit.com", "asignado desde System.AssignedTo.uniqueName");
  assert.strictEqual(wis[1].assignee, "", "sin asignado → cadena vacía");
  assert.ok(wis[0].url.includes("/_workitems/edit/301"), "url directa al work item");
  fs.rmSync(repoQ, { recursive: true, force: true });
  ok("azure: queryWorkItems normaliza los work items del WIQL (import a Seguimiento)");

  // parseTestSteps (PURO): XML de Azure Test Plans → [{action, expected}] (decodifica + quita HTML).
  const stepsXml = '<steps id="0" last="1"><step id="2" type="ActionStep"><parameterizedString isformatted="true">&lt;DIV&gt;Abrir login&lt;/DIV&gt;</parameterizedString><parameterizedString isformatted="true">&lt;DIV&gt;Se muestra el form&lt;/DIV&gt;</parameterizedString></step></steps>';
  assert.deepStrictEqual(parseTestSteps(stepsXml), [{ action: "Abrir login", expected: "Se muestra el form" }]);
  assert.deepStrictEqual(parseTestSteps(""), []);
  ok("azure: parseTestSteps convierte el XML de Test Plans a pasos acción/esperado");

  // importTestCases: lista los test cases de una suite + trae sus pasos (parsea Steps del work item).
  const repoTP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-tp-"));
  const fakeTP = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/testplan/Plans/5/Suites/9/TestCase"), () => ({ status: 200, json: { value: [{ workItem: { id: 401 } }] } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/401"), () => ({ status: 200, json: { fields: { "System.Title": "Login OK", "System.State": "Design", "System.WorkItemType": "Test Case", "Microsoft.VSTS.TCM.Steps": stepsXml } } })],
  ]);
  const adoTP = getAdapter({ profile: pFlit, env: creds, repoRoot: repoTP, http: fakeTP.http });
  const tcs = await adoTP.importTestCases({ planId: "5", suiteId: "9" });
  assert.strictEqual(tcs.length, 1);
  assert.strictEqual(tcs[0].id, "401");
  assert.strictEqual(tcs[0].title, "Login OK");
  assert.deepStrictEqual(tcs[0].steps, [{ action: "Abrir login", expected: "Se muestra el form" }]);
  fs.rmSync(repoTP, { recursive: true, force: true });
  ok("azure: importTestCases trae los test cases de una suite CON sus pasos");
}
