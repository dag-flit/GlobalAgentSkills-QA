// runtime/smoke/explore-suite.mjs — el kit quedó acotado a EXPLORACIÓN de una URL viva (E2E)
// con tracker local o azure-devops. Cubre: contrato del adapter azure (destino de la evidencia
// E2E) + adjuntos, el runner explore, runQaCycle (local + azure, offline), la guarda remoto
// sin -w, el transporte HTTP con reintento y el guardrail de 400 líneas del motor.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { runQaCycle } from "../orchestrator.mjs";
import { runExplore } from "../runners/explore.mjs";
import { defaultHttp as retryHttp, isTransientNetworkError } from "../../adapters/_shared/http-retry.mjs";
import { analyze as analyzeLineBudget } from "../../scripts/check-line-budget.mjs";

// Launcher de navegador FALSO (offline): una URL ok (200) y las que contienen "bad" → 500.
const fakeLaunch = () => ({
  async newPage() {
    return {
      on() {},
      async goto(url) {
        return { status: () => (/bad/.test(url) ? 500 : 200) };
      },
      async screenshot() {},
      async close() {},
    };
  },
  async close() {},
});

export async function run(ctx) {
  const { ok, creds, pFlit, makeFakeAdo } = ctx;

  // A. adapter azure (destino de la evidencia E2E): contrato con transporte inyectable (offline).
  const repoAdo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ado-"));
  const fake = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 55 } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { fields: { "System.Title": "Login", "System.State": "Active", "Microsoft.VSTS.Common.AcceptanceCriteria": "" } } })],
  ]);
  const ado = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAdo, http: fake.http });
  assert.strictEqual(ado.name, "azure-devops");
  assert.strictEqual((await ado.preflight()).ok, true);
  assert.ok(fake.find("GET", "/_apis/projects/Proj"));
  const wi = await ado.getWorkItem("123");
  assert.strictEqual(wi.title, "Login");
  const pub = await ado.publishEvidence(
    { work_item_id: "123" },
    { results: [{ layer: "explore", tc_id: "URL-1", status: "fail", narrative: "HTTP 500" }] }
  );
  assert.strictEqual(pub.sink, "dual");
  assert.strictEqual(pub.parentCommentId, 55);
  assert.ok(fs.existsSync(pub.local.mdPath) && fs.existsSync(pub.local.htmlPath));
  assert.ok(JSON.parse(fake.find("POST", "/workItems/123/comments").body).text.includes("Resumen QA"));
  fs.rmSync(repoAdo, { recursive: true, force: true });
  ok("adapter azure: preflight REST, getWorkItem, publishEvidence dual (comentario + reporte local) para evidencia E2E");

  // B. adjuntos: la captura de la exploración se sube y se enlaza al Task hijo (mapping_file).
  const repoAtt = fs.mkdtempSync(path.join(os.tmpdir(), "qa-att-"));
  fs.mkdirSync(path.join(repoAtt, ".qa", "mappings"), { recursive: true });
  fs.writeFileSync(path.join(repoAtt, ".qa", "mappings", "wi-123.json"), JSON.stringify({ "URL-1": 4567 }));
  const shot = path.join(repoAtt, "explore-1.png");
  fs.writeFileSync(shot, "PNGDATA");
  const fakeAtt = makeFakeAdo([
    [(r) => r.method === "POST" && r.url.includes("/wit/attachments"), () => ({ status: 201, json: { id: "att1", url: "https://dev.azure.com/acme/_apis/wit/attachments/att1" } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/4567"), () => ({ status: 200, json: { id: 4567 } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 1 } })],
  ]);
  const adoAtt = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAtt, http: fakeAtt.http });
  const pubAtt = await adoAtt.publishEvidence(
    { work_item_id: "123" },
    { results: [{ layer: "explore", tc_id: "URL-1", status: "fail", narrative: "HTTP 500", files: [shot] }] }
  );
  assert.strictEqual(pubAtt.attachments.uploaded, 1);
  assert.strictEqual(pubAtt.attachments.linked[0].taskId, "4567");
  assert.strictEqual(pubAtt.attachments.linked[0].strategy, "mapping_file");
  fs.rmSync(repoAtt, { recursive: true, force: true });
  ok("adjuntos azure: la captura de exploración se sube y se enlaza al Task hijo (mapping_file)");

  // C. runner explore: launcher inyectable (offline); pass/fail por URL; skip sin Playwright; gating sin URL.
  const repoExp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-exp-"));
  const expEv = await runExplore({ repoRoot: repoExp, appUrl: "https://app.test/", paths: ["https://app.test/bad"], launchBrowser: fakeLaunch });
  assert.strictEqual(expEv.length, 1);
  assert.strictEqual(expEv[0].layer, "explore");
  assert.strictEqual(expEv[0].status, "fail"); // una URL "mala" (500) → la capa falla
  assert.strictEqual(expEv[0].cases.length, 2);
  assert.strictEqual(expEv[0].cases[0].status, "pass"); // 200
  assert.strictEqual(expEv[0].cases[1].status, "fail"); // 500
  assert.ok(/HTTP 500/.test(expEv[0].cases[1].message));
  assert.deepStrictEqual(await runExplore({ appUrl: "" }), []); // gating: sin URL, no participa
  const expSkip = await runExplore({ repoRoot: repoExp, appUrl: "https://x/" }); // sin launcher ni Playwright
  assert.strictEqual(expSkip[0].status, "skip");
  assert.ok(/Playwright/.test(expSkip[0].narrative));
  fs.rmSync(repoExp, { recursive: true, force: true });
  ok("runner explore: launcher inyectable (offline), pass/fail por URL, skip sin Playwright, gating sin URL");

  // D. runQaCycle (local): explora la URL y deja SOLO reporte local (sin red).
  const repoLoc = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cyc-loc-"));
  const cycLoc = await runQaCycle({ repoRoot: repoLoc, profile: { tracker: "local" }, appUrl: "https://app.test/", launchBrowser: fakeLaunch });
  assert.strictEqual(cycLoc.ok, true);
  assert.ok(cycLoc.results.some((r) => r.layer === "explore" && r.status === "pass"));
  assert.strictEqual(cycLoc.report.sink, "local");
  assert.ok(fs.existsSync(cycLoc.report.mdPath));
  fs.rmSync(repoLoc, { recursive: true, force: true });
  ok("runQaCycle local: explora la URL y deja reporte local (sin red)");

  // E. runQaCycle (azure, offline): corre preflight REST y publica la evidencia E2E en la HU.
  const repoCyc = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cyc-ado-"));
  const fakeCyc = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 77 } })],
  ]);
  const cycAdo = await runQaCycle({ repoRoot: repoCyc, env: creds, profile: pFlit, workItemId: "123", featureId: "10118", developer: "Dev Ñoño Pérez", appUrl: "https://app.test/", launchBrowser: fakeLaunch, http: fakeCyc.http });
  assert.strictEqual(cycAdo.ok, true);
  assert.strictEqual(cycAdo.tracker, "azure-devops");
  assert.ok(cycAdo.preflight && cycAdo.preflight.ok);
  assert.strictEqual(cycAdo.report.sink, "dual");
  assert.strictEqual(cycAdo.report.parentCommentId, 77);
  assert.ok(cycAdo.results.some((r) => r.layer === "explore"));
  assert.strictEqual(path.basename(cycAdo.report.local.dir), "FT-10118__Dev-Nono-Perez"); // FT/dev en la carpeta
  fs.rmSync(repoCyc, { recursive: true, force: true });
  ok("runQaCycle azure: preflight REST + explora + publica la evidencia E2E en la HU (offline)");

  // F. guarda online: tracker remoto SIN -w (workItemId="local") no comenta sobre una HU inexistente.
  const repoGuard = fs.mkdtempSync(path.join(os.tmpdir(), "qa-guard-"));
  const fakeGuard = makeFakeAdo([[(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })]]);
  const cycGuard = await runQaCycle({ repoRoot: repoGuard, env: creds, profile: pFlit, appUrl: "https://app.test/", launchBrowser: fakeLaunch, http: fakeGuard.http });
  assert.ok(Array.isArray(cycGuard.warnings) && cycGuard.warnings.some((w) => /-w/.test(w)));
  assert.ok(!fakeGuard.calls.some((c) => c.method === "POST" && /\/comments/.test(c.url)));
  assert.ok(cycGuard.report && cycGuard.report.local && fs.existsSync(cycGuard.report.local.mdPath));
  fs.rmSync(repoGuard, { recursive: true, force: true });
  ok("guarda online: tracker remoto sin -w no comenta HU inexistente; degrada a reporte local + aviso");

  // G. transporte HTTP con reintento ante fallos de red transitorios (usado por ado-rest).
  {
    const econnreset = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET", message: "read ECONNRESET" } });
    assert.ok(isTransientNetworkError(econnreset));
    assert.ok(!isTransientNetworkError(new TypeError("Invalid URL")));
    const realFetch = globalThis.fetch;
    try {
      let calls = 0;
      globalThis.fetch = async () => { calls++; if (calls === 1) throw econnreset; return { status: 200, text: async () => '{"ok":true}' }; };
      const r = await retryHttp({ url: "https://x/y", method: "POST", body: "{}" }, { baseDelayMs: 1 });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(calls, 2);
      let calls3 = 0;
      globalThis.fetch = async () => { calls3++; return { status: 500, text: async () => "boom" }; };
      const r5 = await retryHttp({ url: "https://x", method: "GET" }, { baseDelayMs: 1 });
      assert.strictEqual(r5.status, 500);
      assert.strictEqual(calls3, 1); // un 500 es respuesta válida → no se reintenta
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  ok("transporte HTTP: reintenta fallos de red transitorios (ECONNRESET/fetch failed), no status HTTP");

  // H. guardrail de 400 líneas: el motor no tiene archivos por encima del límite.
  {
    const { violations } = analyzeLineBudget("engine");
    assert.strictEqual(violations.length, 0, `archivos del motor > 400: ${violations.map((v) => `${v.rel} (${v.lines})`).join(", ")}`);
  }
  ok("guardrail: el motor no tiene archivos > 400 líneas (presupuesto de líneas)");
}
