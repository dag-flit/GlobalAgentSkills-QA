// runtime/smoke/evidence.mjs — evidencia y plan por HU/Feature (online + paridad offline).
// Casos 29 (TC por HU idempotente), 30 (Fase A: TC por criterio + Plan), 31 (paridad offline),
// 32 (lógica QA plan/result), 33 (AC por encabezado + planOnly).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { runQaCycle } from "../orchestrator.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

export async function run(ctx) {
  const { ok, creds, pFlit, makeFakeAdo } = ctx;

  // 29. Evidencia y TC por HU: publishRequirementEvidence crea un Task-TC hijo desde los AC
  // (idempotente por título, enlazado a la HU como padre) y comenta el resultado en la HU.
  {
    const prefix = (pFlit.azure && pFlit.azure.work_item && pFlit.azure.work_item.test_case_title_prefix) || "TC-";
    const TC_TITLE = `${prefix}HU-501`;
    const repoHuE = fs.mkdtempSync(path.join(os.tmpdir(), "qa-hue-"));
    let tcExists = false; // simula el estado de ADO entre corridas (idempotencia)
    const fakeE = makeFakeAdo([
      [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
      // relaciones de la HU 501: devuelve el TC hijo (700) solo cuando ya existe
      [(r) => r.method === "GET" && r.url.includes("/wit/workitems/501?$expand=relations"), () => ({
        status: 200,
        json: { relations: tcExists ? [{ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/acme/_apis/wit/workItems/700" }] : [] },
      })],
      // getWorkItem de la HU 501 (con AC) y del TC hijo 700 (con su título)
      [(r) => r.method === "GET" && r.url.includes("/wit/workitems/501?$expand=fields"), () => ({
        status: 200,
        json: { fields: { "System.Title": "Activar invitación", "System.State": "Active",
          "Microsoft.VSTS.Common.AcceptanceCriteria": "<div>Scenario: token válido</div><br>- [ ] expira a las 24h" } },
      })],
      [(r) => r.method === "GET" && r.url.includes("/wit/workitems/700?$expand=fields"), () => ({
        status: 200, json: { fields: { "System.Title": TC_TITLE, "System.State": "New" } },
      })],
      // createWorkItem $Task → crea el TC y pasa a "existir"
      [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Task"), () => { tcExists = true; return { status: 200, json: { id: 700 } }; }],
      // comentario en la HU 501
      [(r) => r.method === "POST" && r.url.includes("/workItems/501/comments"), () => ({ status: 201, json: { id: 88 } })],
    ]);
    const adoE = getAdapter({ profile: pFlit, env: creds, repoRoot: repoHuE, http: fakeE.http });
    const results = [{ layer: "unit", status: "pass", cases: [{ name: "[HU-501] token válido", status: "pass" }] }];

    // 1ª corrida: crea el TC
    const e1 = await adoE.publishRequirementEvidence("501", { criteria: ["token válido", "expira 24h"], results, reportLink: "qa-evidence/x/report.html", huTitle: "Activar invitación" });
    assert.strictEqual(e1.tcCreated, true);
    assert.strictEqual(e1.tcId, "700");
    assert.strictEqual(e1.commentOk, true);
    const tcCreate = fakeE.calls.find((c) => c.method === "POST" && c.url.includes("/wit/workitems/$Task"));
    assert.ok(tcCreate && /Hierarchy-Reverse/.test(tcCreate.body) && /workItems\/501/.test(tcCreate.body), "el TC se enlaza a la HU 501 como padre");
    assert.ok(tcCreate.body.includes(TC_TITLE), "el título del TC referencia la HU");

    // 2ª corrida: idempotente → reusa el TC existente, NO crea otro
    const before = fakeE.calls.filter((c) => c.method === "POST" && c.url.includes("$Task")).length;
    const e2 = await adoE.publishRequirementEvidence("501", { criteria: [], results, reportLink: null });
    assert.strictEqual(e2.tcCreated, false);
    assert.strictEqual(e2.tcId, "700");
    const after = fakeE.calls.filter((c) => c.method === "POST" && c.url.includes("$Task")).length;
    assert.strictEqual(after, before, "no se crea un segundo TC (idempotente)");
    fs.rmSync(repoHuE, { recursive: true, force: true });
  }
  ok("evidencia por HU: crea el TC (Task) desde los AC enlazado a la HU, idempotente + comenta el resultado");

  // 30. Fase A: TC por CRITERIO de la HU (idempotente por clave TC-AC<n>) + Plan de Pruebas del
  // Feature (Task "PLAN PRUEBAS FEATURE…", crea/actualiza). El Feature NO aporta criterios.
  {
    const { generateTestsForRequirement } = await import("../generate/skeleton-generator.mjs");
    const prefix = (pFlit.azure && pFlit.azure.work_item && pFlit.azure.work_item.test_case_title_prefix) || "TC-";
    const repoG = fs.mkdtempSync(path.join(os.tmpdir(), "qa-faseA-"));
    // estado simulado de ADO: títulos por id + hijos por padre
    const items = new Map([["900", { title: "Activar invitación" }], ["800", { title: "Motor de trámites" }]]);
    const kids = new Map();
    let seq = 700;
    const relUrl = (id) => `https://dev.azure.com/acme/_apis/wit/workItems/${id}`;
    const idOf = (url) => (url.match(/workitems\/(\d+)\?/) || [])[1];
    const fakeG = makeFakeAdo([
      [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
      [(r) => r.method === "GET" && /\$expand=relations/.test(r.url), (r) => {
        const id = idOf(r.url);
        return { status: 200, json: { relations: (kids.get(id) || []).map((cid) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: relUrl(cid) })) } };
      }],
      [(r) => r.method === "GET" && /\$expand=fields/.test(r.url), (r) => {
        const id = idOf(r.url);
        const it = items.get(id) || { title: `WI ${id}` };
        const ac = id === "900" ? "<div>Modal de color verde con raya azul</div><br>- El token expira a las 24 horas" : "";
        return { status: 200, json: { fields: { "System.Title": it.title, "System.State": "Active", "Microsoft.VSTS.Common.AcceptanceCriteria": ac } } };
      }],
      [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Task"), (r) => {
        const ops = JSON.parse(r.body);
        const title = (ops.find((o) => o.path === "/fields/System.Title") || {}).value || "";
        const relOp = ops.find((o) => o.path === "/relations/-");
        const parent = relOp ? String(relOp.value.url).split("/").pop() : null;
        const id = String(seq++);
        items.set(id, { title });
        if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(id); }
        return { status: 200, json: { id: Number(id) } };
      }],
      [(r) => r.method === "PATCH" && /\/wit\/workitems\/\d+/.test(r.url), () => ({ status: 200, json: { id: 1 } })],
      [(r) => r.method === "POST" && /\/workItems\/\d+\/comments/.test(r.url), () => ({ status: 201, json: { id: 1 } })],
    ]);
    const adoG = getAdapter({ profile: pFlit, env: creds, repoRoot: repoG, http: fakeG.http });

    const wiHu = await adoG.getWorkItem("900");
    const tcs = generateTestsForRequirement({ requirement: { id: "900", title: wiHu.title }, criteria: wiHu.acceptance_criteria, options: { unitTool: "vitest", tcTitlePrefix: prefix } });
    assert.strictEqual(tcs.length, 2, "2 criterios → 2 TC");
    assert.ok(tcs[0].title.startsWith(`${prefix}AC1 - `) && tcs[1].title.startsWith(`${prefix}AC2 - `));

    // un TC (Task) por criterio, enlazado a la HU
    const e1 = await adoG.publishRequirementEvidence("900", { criteria: wiHu.acceptance_criteria, tcs, results: [{ layer: "unit", status: "pass", cases: [] }] });
    assert.strictEqual(e1.tcs.length, 2);
    assert.ok(e1.tcs.every((t) => t.created && t.tcId), "ambos TC creados");
    const tc1 = fakeG.calls.find((c) => c.method === "POST" && c.url.includes("$Task") && c.body.includes(`${prefix}AC1`));
    assert.ok(tc1 && /Hierarchy-Reverse/.test(tc1.body) && /workItems\/900/.test(tc1.body), "TC enlazado a la HU 900");

    // idempotente: segunda corrida no crea TC nuevos
    const before = fakeG.calls.filter((c) => c.method === "POST" && c.url.includes("$Task")).length;
    const e2 = await adoG.publishRequirementEvidence("900", { criteria: wiHu.acceptance_criteria, tcs, results: [] });
    assert.ok(e2.tcs.every((t) => !t.created), "TC por criterio idempotentes");
    assert.strictEqual(fakeG.calls.filter((c) => c.method === "POST" && c.url.includes("$Task")).length, before);

    // Plan del Feature: crea la Task "PLAN PRUEBAS FEATURE…" colgada del Feature
    const planHus = [{ id: "900", title: wiHu.title, tcs: tcs.map((t) => ({ key: t.key, title: t.title, status: t.status })) }];
    const p1 = await adoG.publishTestPlan("800", { featureTitle: "Motor de trámites", hus: planHus, results: [{ layer: "unit", status: "pass" }] });
    assert.ok(p1.created && p1.planId, "plan creado");
    const planCreate = fakeG.calls.find((c) => c.method === "POST" && c.url.includes("$Task") && /PLAN PRUEBAS FEATURE/.test(c.body));
    assert.ok(planCreate && /workItems\/800/.test(planCreate.body), "plan colgado del Feature 800");
    // idempotente: segunda vez actualiza (no crea)
    const p2 = await adoG.publishTestPlan("800", { featureTitle: "Motor de trámites", hus: [], results: [] });
    assert.ok(!p2.created && p2.planId, "plan idempotente: actualiza, no duplica");
    fs.rmSync(repoG, { recursive: true, force: true });
  }
  ok("Fase A: TC por criterio (idempotente, enlazado a la HU) + Plan de Pruebas del Feature (crea/actualiza)");

  // 31. Paridad OFFLINE: el reporte local (md/html) incluye el Plan de Pruebas del Feature
  // (HUs + TC por criterio), en paridad con la Task del tracker.
  {
    const repoP = fs.mkdtempSync(path.join(os.tmpdir(), "qa-plan-"));
    const out = writeLocalReport({
      repoRoot: repoP,
      profile: {},
      featureId: "800",
      plan: {
        featureId: "800",
        featureTitle: "Motor de trámites",
        hus: [
          { id: "900", title: "Activar invitación", tcs: [
            { key: "TC-AC1", title: "TC-AC1 - Modal verde", status: "pending" },
            { key: "TC-AC2", title: "TC-AC2 - Token expira 24h", status: "pending" },
          ] },
        ],
      },
      results: [{ layer: "unit", status: "pass" }],
    });
    const md = fs.readFileSync(out.mdPath, "utf8");
    const html = fs.readFileSync(out.htmlPath, "utf8");
    assert.ok(/Plan de pruebas del Feature #800/.test(md), "el md incluye el plan del Feature");
    assert.ok(md.includes("TC-AC1 - Modal verde") && md.includes("TC-AC2 - Token expira 24h"), "el md lista los TC por criterio");
    assert.ok(/Plan de pruebas del Feature/.test(html) && html.includes("TC-AC2 - Token expira 24h"), "el html incluye el plan + TC");
    fs.rmSync(repoP, { recursive: true, force: true });
  }
  ok("paridad offline: el reporte local md/html incluye el Plan de Pruebas del Feature (HUs + TC)");

  // 32. Lógica QA: el Plan y los TC se crean en la PLANIFICACIÓN (fase "plan", ANTES de ejecutar,
  // sin resultados) y se ACTUALIZAN con el resultado después (fase "result").
  {
    const { generateTestsForRequirement } = await import("../generate/skeleton-generator.mjs");
    const repoX = fs.mkdtempSync(path.join(os.tmpdir(), "qa-plan2-"));
    const items = new Map([["900", { title: "Activar invitación" }], ["800", { title: "Feature" }]]);
    const kids = new Map();
    let seq = 700;
    const idOf = (url) => (url.match(/workitems\/(\d+)\?/) || [])[1];
    const fakeX = makeFakeAdo([
      [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
      [(r) => r.method === "GET" && /\$expand=relations/.test(r.url), (r) => ({ status: 200, json: { relations: (kids.get(idOf(r.url)) || []).map((cid) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: `https://x/_apis/wit/workItems/${cid}` })) } })],
      [(r) => r.method === "GET" && /\$expand=fields/.test(r.url), (r) => {
        const id = idOf(r.url);
        const ac = id === "900" ? "<div>Modal verde</div><br>- Token expira 24h" : "";
        return { status: 200, json: { fields: { "System.Title": (items.get(id) || {}).title || `WI ${id}`, "Microsoft.VSTS.Common.AcceptanceCriteria": ac } } };
      }],
      [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Task"), (r) => {
        const ops = JSON.parse(r.body);
        const relOp = ops.find((o) => o.path === "/relations/-");
        const parent = relOp ? String(relOp.value.url).split("/").pop() : null;
        const id = String(seq++);
        items.set(id, { title: (ops.find((o) => o.path === "/fields/System.Title") || {}).value });
        if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(id); }
        return { status: 200, json: { id: Number(id) } };
      }],
      [(r) => r.method === "PATCH", () => ({ status: 200, json: { id: 1 } })],
      [(r) => r.method === "POST" && /\/comments/.test(r.url), () => ({ status: 201, json: { id: 1 } })],
    ]);
    const adoX = getAdapter({ profile: pFlit, env: creds, repoRoot: repoX, http: fakeX.http });
    const wi = await adoX.getWorkItem("900");
    const tcs = generateTestsForRequirement({ requirement: { id: "900", title: wi.title }, criteria: wi.acceptance_criteria, options: { unitTool: "vitest", tcTitlePrefix: "TC-" } });

    // PLANIFICACIÓN: crea los TC + comenta el PLAN (no el resultado)
    const planE = await adoX.publishRequirementEvidence("900", { criteria: wi.acceptance_criteria, tcs, phase: "plan" });
    assert.ok(planE.tcs.length === 2 && planE.tcs.every((t) => t.created), "planificación crea los TC");
    const planComment = fakeX.calls.find((c) => c.method === "POST" && /\/workItems\/900\/comments/.test(c.url));
    assert.ok(planComment && /Plan de pruebas/.test(planComment.body) && !/Resultado global/.test(planComment.body), "comenta el PLAN, no el resultado");
    const planTask = await adoX.publishTestPlan("800", { featureTitle: "Feature", hus: [{ id: "900", tcs: [] }], results: [], phase: "plan" });
    const planTaskCreate = fakeX.calls.find((c) => c.method === "POST" && c.url.includes("$Task") && /PLAN PRUEBAS FEATURE/.test(c.body));
    assert.ok(planTask.created && /planificado/.test(planTaskCreate.body), "el Plan del Feature se crea en estado 'planificado'");

    // ACTUALIZACIÓN: reusa los TC (idempotente) + comenta el RESULTADO
    const resE = await adoX.publishRequirementEvidence("900", { criteria: wi.acceptance_criteria, tcs, results: [{ layer: "unit", status: "pass", cases: [] }], phase: "result" });
    assert.ok(resE.tcs.every((t) => !t.created), "la actualización reusa los TC (no recrea)");
    const resultComments = fakeX.calls.filter((c) => c.method === "POST" && /\/workItems\/900\/comments/.test(c.url));
    assert.ok(/Resultado global/.test(resultComments[resultComments.length - 1].body), "el último comentario por HU es el resultado");
    fs.rmSync(repoX, { recursive: true, force: true });
  }
  ok("lógica QA: plan/TC se crean en la planificación (antes), se actualizan con resultados (después)");

  // 33. AC con ENCABEZADOS → 1 TC por AC (no por línea); y modo planOnly: el ciclo PLANIFICA
  // (crea Plan + TC) y termina SIN ejecutar runners.
  {
    const repoPO = fs.mkdtempSync(path.join(os.tmpdir(), "qa-planonly-"));
    fs.writeFileSync(path.join(repoPO, "package.json"), JSON.stringify({ name: "po", devDependencies: { vitest: "1" } }));
    fs.writeFileSync(path.join(repoPO, "vitest.config.ts"), "export default {}");
    const items = new Map([["900", { title: "HU" }], ["800", { title: "Feature" }]]);
    const kids = new Map();
    let seq = 700;
    const idOf = (url) => (url.match(/workitems\/(\d+)\?/) || [])[1];
    const fakePO = makeFakeAdo([
      [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
      [(r) => r.method === "GET" && /\$expand=relations/.test(r.url), (r) => ({ status: 200, json: { relations: (kids.get(idOf(r.url)) || []).map((cid) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: `https://x/_apis/wit/workItems/${cid}` })) } })],
      [(r) => r.method === "GET" && /\$expand=fields/.test(r.url), (r) => {
        const id = idOf(r.url);
        // AC con DOS encabezados <h3> → debe dar 2 criterios (no 5 líneas de Gherkin)
        const ac = id === "900" ? "<h3>AC1 — Crear borrador</h3><pre>Given x\nWhen y\nThen z</pre><h3>AC2 — Validar</h3><pre>Given a\nThen b</pre>" : "";
        return { status: 200, json: { fields: { "System.Title": (items.get(id) || {}).title, "Microsoft.VSTS.Common.AcceptanceCriteria": ac } } };
      }],
      [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Task"), (r) => {
        const ops = JSON.parse(r.body);
        const relOp = ops.find((o) => o.path === "/relations/-");
        const parent = relOp ? String(relOp.value.url).split("/").pop() : null;
        const id = String(seq++);
        items.set(id, { title: (ops.find((o) => o.path === "/fields/System.Title") || {}).value });
        if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(id); }
        return { status: 200, json: { id: Number(id) } };
      }],
      [(r) => r.method === "PATCH", () => ({ status: 200, json: { id: 1 } })],
      [(r) => r.method === "POST" && /\/comments/.test(r.url), () => ({ status: 201, json: { id: 1 } })],
    ]);
    const summary = await runQaCycle({
      repoRoot: repoPO, env: creds, profile: pFlit, http: fakePO.http,
      workItemId: "800", featureId: "800", huIds: ["900"], generate: true, planOnly: true,
      exec: () => { throw new Error("planOnly NO debe ejecutar runners"); },
    });
    assert.strictEqual(summary.stopped, "planOnly", "el ciclo se detiene tras planificar");
    assert.deepStrictEqual(summary.results, [], "planOnly no ejecuta runners");
    assert.ok(summary.testPlan && (summary.testPlan.planId || summary.testPlan.created), "se creó el Plan del Feature");
    // 1 TC por AC (2 encabezados → 2 TC), NO uno por línea de Gherkin. Los TC cuelgan de la HU 900
    // (el Plan cuelga del Feature 800), así que se cuentan por el enlace al padre 900.
    const tcCreates = fakePO.calls.filter((c) => c.method === "POST" && c.url.includes("$Task") && /workItems\/900/.test(c.body));
    assert.strictEqual(tcCreates.length, 2, "2 encabezados AC → 2 TC (no por línea)");
    // se escribió el esqueleto de prueba en qa-generated/
    assert.ok(fs.existsSync(path.join(repoPO, "qa-generated", "HU-900")), "se generaron archivos de prueba");
    fs.rmSync(repoPO, { recursive: true, force: true });
  }
  ok("AC por encabezado → 1 TC por AC; planOnly planifica (Plan+TC) y termina sin ejecutar");
}
