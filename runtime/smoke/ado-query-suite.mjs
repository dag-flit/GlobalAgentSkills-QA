// runtime/smoke/ado-query-suite.mjs — caso extraído de explore-suite (guardrail 400): el adapter azure
// `queryWorkItems(wiql)` corre un WIQL y normaliza los work items para IMPORTAR al tablero de
// Seguimiento (id/título/tipo/estado/asignado/url). Offline (transporte HTTP inyectable).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";

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
}
