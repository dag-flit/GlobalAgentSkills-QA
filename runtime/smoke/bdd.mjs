// runtime/smoke/bdd.mjs — Ruta B (BDD ejecutable + plantillas) + guardrail de líneas del motor.
// Casos 34 (feature-writer), 35 (parseCucumber), 36 (runner bdd), 37 (librería de steps),
// 38 (runtime on-demand), 39 (catálogo+applier), 40 (wiring plantilla→TC), 41 (guardrail 400).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { detectRepo } from "../detect/qa-detect.mjs";
import { runQaCycle } from "../orchestrator.mjs";
import { analyze as analyzeLineBudget } from "../../scripts/check-line-budget.mjs";

export async function run(ctx) {
  const { ok, creds, pFlit, makeFakeAdo } = ctx;

  // 34. feature-writer: AC → `.feature` (un Scenario por AC, etiquetado @HU/@TC, pasos del Gherkin).
  {
    const { generateFeaturesForRequirement } = await import("../generate/feature-writer.mjs");
    const feats = generateFeaturesForRequirement({
      requirement: { id: "103", title: "Checkout" },
      criteria: [
        { title: "Modal verde con raya azul", detail: "Given estoy en checkout\nWhen abro el modal\nThen el modal es verde" },
        "Token expira a las 24h", // string sin Gherkin → escenario pendiente honesto
      ],
      options: { tcTitlePrefix: "TC-" },
    });
    assert.strictEqual(feats.length, 2, "2 criterios → 2 .feature");
    assert.ok(feats[0].relPath.endsWith(".feature"), "emite archivos .feature");
    assert.ok(/Feature: \[HU-103\] Checkout/.test(feats[0].code), "Feature etiquetada con la HU");
    assert.ok(/@HU-103 @TC-AC1/.test(feats[0].code), "Scenario etiquetado @HU-### @TC-AC<n>");
    assert.ok(/Scenario:/.test(feats[0].code) && /Then el modal es verde/.test(feats[0].code), "los pasos salen del Gherkin del AC");
    assert.ok(/TODO: definir los pasos/.test(feats[1].code), "AC sin Gherkin → escenario pendiente honesto");
    assert.strictEqual(feats[0].key, "TC-AC1", "misma clave TC-AC<n> del sistema");
  }
  ok("Ruta B (BDD) feature-writer: AC → .feature con Feature/Scenario/tags y pasos del Gherkin");

  // 35. parse-cases: parseCucumber extrae los Scenarios (pass/fail/pendiente) del JSON clásico.
  {
    const { parseCucumber } = await import("../runners/parse-cases.mjs");
    const cuke = JSON.stringify([
      { name: "Login", elements: [
        { type: "scenario", name: "ok", steps: [ { result: { status: "passed", duration: 2000000 } } ] },
        { type: "scenario", name: "falla", steps: [ { result: { status: "passed", duration: 1000000 } }, { result: { status: "failed", duration: 500000, error_message: "expected 200" } } ] },
        { type: "scenario", name: "pendiente", steps: [ { result: { status: "undefined" } } ] },
      ] },
    ]);
    const cases = parseCucumber({ code: 1, stdout: cuke, stderr: "" });
    assert.strictEqual(cases.length, 3, "3 scenarios → 3 casos");
    assert.deepStrictEqual(cases.map((c) => c.status), ["pass", "fail", "skip"]);
    assert.ok(cases[1].name.includes("Login") && cases[1].name.includes("falla"));
    assert.ok(/expected 200/.test(cases[1].message), "el mensaje viene del paso fallido");
    assert.strictEqual(cases[0].duration, 2, "duración ns → ms");
  }
  ok("Ruta B (BDD) parse-cases: parseCucumber extrae los Scenarios (pass/fail/pendiente) del JSON");

  // 36. runner bdd: qa-detect enciende la capa `bdd` (.feature + cucumber) y el runner ejecuta los
  // .feature (Cucumber.js, exec inyectado offline) → un caso por Scenario.
  {
    const { runBddTests } = await import("../runners/bdd.mjs");
    const repoB = fs.mkdtempSync(path.join(os.tmpdir(), "qa-bdd-"));
    fs.writeFileSync(path.join(repoB, "package.json"), JSON.stringify({ name: "b", devDependencies: { "@cucumber/cucumber": "10" } }));
    fs.mkdirSync(path.join(repoB, "features"), { recursive: true });
    fs.writeFileSync(path.join(repoB, "features", "login.feature"), "@HU-103\nFeature: Login\n\n  Scenario: ok\n    Given x\n    Then y\n");
    const detB = detectRepo({ repoRoot: repoB });
    assert.ok(detB.enabled.includes("bdd"), "qa-detect enciende la capa bdd (.feature + cucumber)");
    assert.strictEqual(detB.layers.bdd.tool, "cucumber");
    const cuke = JSON.stringify([{ name: "Login", elements: [
      { type: "scenario", name: "ok", steps: [ { result: { status: "passed", duration: 1000000 } } ] },
      { type: "scenario", name: "rota", steps: [ { result: { status: "failed", duration: 1000000, error_message: "boom" } } ] },
    ] }]);
    const evs = runBddTests({ repoRoot: repoB, detection: detB, exec: () => ({ code: 1, stdout: cuke, stderr: "" }) });
    assert.strictEqual(evs.length, 1, "un EvidenceObject para la capa bdd");
    assert.strictEqual(evs[0].layer, "bdd");
    assert.strictEqual(evs[0].status, "fail", "exit 1 → fail");
    assert.ok(Array.isArray(evs[0].cases) && evs[0].cases.length === 2, "Scenarios como casos individuales");
    assert.strictEqual(evs[0].metrics.tool, "cucumber", "metrics.tool = cucumber");
    fs.rmSync(repoB, { recursive: true, force: true });
  }
  ok("Ruta B (BDD) runner: detecta capa bdd y ejecuta .feature (Cucumber.js) → casos por Scenario, offline");

  // 37. Ruta B (BDD) B2: la librería de steps (web/api/db/world) se MATERIALIZA en qa-generated/bdd/
  // steps y el runner la carga con `--import`; los steps PROPIOS del proyecto también se incluyen.
  {
    const { runBddTests } = await import("../runners/bdd.mjs");
    const repoS = fs.mkdtempSync(path.join(os.tmpdir(), "qa-bdd2-"));
    fs.writeFileSync(path.join(repoS, "package.json"), JSON.stringify({ name: "s", devDependencies: { "@cucumber/cucumber": "10", playwright: "1" } }));
    fs.mkdirSync(path.join(repoS, "features"), { recursive: true });
    fs.writeFileSync(path.join(repoS, "features", "x.feature"), "Feature: X\n\n  Scenario: y\n    Given z\n");

    let args1 = null;
    runBddTests({ repoRoot: repoS, detection: detectRepo({ repoRoot: repoS }), exec: (_b, a) => { args1 = a; return { code: 0, stdout: "[]", stderr: "" }; } });
    const stepsDir = path.join(repoS, "qa-generated", "bdd", "steps");
    assert.ok(
      fs.existsSync(path.join(stepsDir, "web.steps.mjs")) && fs.existsSync(path.join(stepsDir, "api.steps.mjs")) &&
      fs.existsSync(path.join(stepsDir, "db.steps.mjs")) && fs.existsSync(path.join(stepsDir, "world.mjs")),
      "se materializó la librería de steps (web/api/db/world)"
    );
    assert.ok(/estoy en/.test(fs.readFileSync(path.join(stepsDir, "web.steps.mjs"), "utf8")), "los steps web traen frases reutilizables");
    assert.ok(args1.includes("--import") && args1.some((a) => a.includes("qa-generated") && a.includes("steps")), "el runner carga los steps del kit con --import");

    // steps PROPIOS del proyecto también se cargan (convención bdd/steps)
    fs.mkdirSync(path.join(repoS, "bdd", "steps"), { recursive: true });
    fs.writeFileSync(path.join(repoS, "bdd", "steps", "custom.mjs"), "// step propio del proyecto\n");
    let args2 = null;
    runBddTests({ repoRoot: repoS, detection: detectRepo({ repoRoot: repoS }), exec: (_b, a) => { args2 = a; return { code: 0, stdout: "[]", stderr: "" }; } });
    assert.ok(args2.filter((a) => a === "--import").length >= 2, "incluye steps del kit + steps propios del proyecto");
    fs.rmSync(repoS, { recursive: true, force: true });
  }
  ok("Ruta B (BDD) B2: librería de steps (web/api/db) materializada y cargada (--import) + steps propios del proyecto");

  // 38. Ruta B (BDD) B2.5: el proyecto NO tiene que preinstalar nada. Sin cucumber en el proyecto → el
  // kit lo trae on-demand (npx) + NODE_PATH puente; con cucumber instalado → usa el del proyecto.
  {
    const { runBddTests } = await import("../runners/bdd.mjs");
    const repoN = fs.mkdtempSync(path.join(os.tmpdir(), "qa-bdd25-"));
    fs.writeFileSync(path.join(repoN, "package.json"), JSON.stringify({ name: "n", devDependencies: { "@cucumber/cucumber": "10" } }));
    fs.mkdirSync(path.join(repoN, "features"), { recursive: true });
    fs.writeFileSync(path.join(repoN, "features", "x.feature"), "Feature: X\n\n  Scenario: y\n    Given z\n");

    // sin node_modules → modo GESTIONADO: el kit trae cucumber on-demand (npx)
    let cap = null;
    runBddTests({ repoRoot: repoN, detection: detectRepo({ repoRoot: repoN }), exec: (b, a, o) => { cap = { bin: b, args: a, opts: o }; return { code: 0, stdout: "[]", stderr: "" }; } });
    assert.ok(
      cap.args.includes("--package") &&
        cap.args.some((a) => /^@cucumber\/cucumber@/.test(a) && a !== "@cucumber/cucumber@latest"),
      "sin cucumber en el proyecto → el kit lo trae on-demand con versión PINEADA (npx --package @cucumber/cucumber@<pin>, nunca @latest)",
    );
    assert.ok(cap.opts && cap.opts.env && /node_modules/.test(cap.opts.env.NODE_PATH || ""), "NODE_PATH puente para resolver los imports de los steps");

    // con cucumber instalado en el proyecto → usa el del proyecto (no npx)
    fs.mkdirSync(path.join(repoN, "node_modules", "@cucumber", "cucumber"), { recursive: true });
    fs.writeFileSync(path.join(repoN, "node_modules", "@cucumber", "cucumber", "package.json"), "{}");
    let cap2 = null;
    runBddTests({ repoRoot: repoN, detection: detectRepo({ repoRoot: repoN }), exec: (b, a) => { cap2 = { bin: b, args: a }; return { code: 0, stdout: "[]", stderr: "" }; } });
    assert.ok(!cap2.args.includes("@cucumber/cucumber@latest"), "con cucumber en el proyecto → usa el del proyecto, sin npx");
    fs.rmSync(repoN, { recursive: true, force: true });
  }
  ok("Ruta B (BDD) B2.5: el kit trae el runtime on-demand (npx) si el proyecto no lo tiene; usa el del proyecto si está");

  // 39. Ruta B (BDD) B3.5: catálogo de plantillas + applier. Rellena parámetros, usa las frases de los
  // steps del kit y etiqueta por HU; params faltantes → marca pendiente con `missing`.
  {
    const { listTemplates, applyTemplate } = await import("../generate/template-applier.mjs");
    const cat = listTemplates();
    assert.ok(cat.length >= 3, "el catálogo de plantillas tiene entradas");
    assert.ok(cat.every((t) => Array.isArray(t.params) && t.params.every((p) => p.name !== "tag" && typeof p.required === "boolean")), "params declaran name/required");
    // api-health: único OBLIGATORIO = endpoint (service/status tienen default → opcionales, sin sesgo)
    const apiTpl = cat.find((t) => t.id === "api-health");
    assert.strictEqual(apiTpl.params.filter((p) => p.required).map((p) => p.name).join(), "endpoint", "api-health: único obligatorio = endpoint");

    // generar con SOLO el obligatorio → soportada (los cosméticos usan su default)
    const applied = applyTemplate({ template: "api-health", params: { endpoint: "/health" }, huId: "103" });
    assert.strictEqual(applied.supported, true, "con solo el obligatorio → soportada");
    assert.ok(/Feature: Salud de API — API/.test(applied.code), "service usa su default 'API'");
    assert.ok(/hago GET "\/health"/.test(applied.code) && /el estado es 200/.test(applied.code), "usa steps del kit + status default 200");
    assert.ok(/@HU-103/.test(applied.code) && applied.relPath.endsWith(".feature"), "etiqueta HU + relPath .feature");

    // sin el obligatorio → pendiente; missing = [endpoint] (status NO, tiene default)
    const partial = applyTemplate({ template: "api-health", params: {} });
    assert.ok(partial.missing.includes("endpoint") && !partial.missing.includes("status"), "solo los params SIN default son obligatorios");
    assert.strictEqual(partial.supported, false, "falta el obligatorio → pendiente");
  }
  ok("Ruta B (BDD) B3.5: catálogo + applier con params opcionales (default) — solo lo funcional es obligatorio");

  // 40. Ruta B (BDD) B3.5 wiring: un caso de plantilla se materializa y se crea como TC EXTRA bajo la
  // HU elegida (decisión #1). planOnly para no ejecutar runners.
  {
    const repoT = fs.mkdtempSync(path.join(os.tmpdir(), "qa-tpl-"));
    fs.writeFileSync(path.join(repoT, "package.json"), JSON.stringify({ name: "t", devDependencies: { vitest: "1" } }));
    fs.writeFileSync(path.join(repoT, "vitest.config.ts"), "export default {}");
    const items = new Map([["900", { title: "HU" }], ["800", { title: "Feature" }]]);
    const kids = new Map();
    let seq = 700;
    const idOf = (url) => (url.match(/workitems\/(\d+)\?/) || [])[1];
    const fakeT = makeFakeAdo([
      [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
      [(r) => r.method === "GET" && /\$expand=relations/.test(r.url), (r) => ({ status: 200, json: { relations: (kids.get(idOf(r.url)) || []).map((cid) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: `https://x/_apis/wit/workItems/${cid}` })) } })],
      [(r) => r.method === "GET" && /\$expand=fields/.test(r.url), (r) => ({ status: 200, json: { fields: { "System.Title": (items.get(idOf(r.url)) || {}).title || `WI ${idOf(r.url)}`, "Microsoft.VSTS.Common.AcceptanceCriteria": "" } } })],
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
      repoRoot: repoT, env: creds, profile: pFlit, http: fakeT.http,
      workItemId: "800", featureId: "800", huIds: ["900"],
      templateCases: [{ template: "api-health", params: { service: "Core", endpoint: "/health", status: "200" }, huId: "900" }],
      planOnly: true,
      exec: () => { throw new Error("planOnly NO ejecuta runners"); },
    });
    assert.strictEqual(summary.stopped, "planOnly");
    const tcCreate = fakeT.calls.find((c) => c.method === "POST" && c.url.includes("$Task") && /PLANTILLA/.test(c.body) && /workItems\/900/.test(c.body));
    assert.ok(tcCreate, "el caso de plantilla se crea como TC bajo la HU 900");
    assert.ok(fs.existsSync(path.join(repoT, "qa-generated", "HU-900")), "se materializó el .feature de la plantilla");
    const featFile = fs.readdirSync(path.join(repoT, "qa-generated", "HU-900")).find((f) => /plantilla.*\.feature$/.test(f));
    assert.ok(featFile, "archivo .feature de plantilla presente");
    const feat = fs.readFileSync(path.join(repoT, "qa-generated", "HU-900", featFile), "utf8");
    assert.ok(/\[HU-900\]/.test(feat) && /hago GET "\/health"/.test(feat), "el .feature está etiquetado [HU-900] y usa los params");
    fs.rmSync(repoT, { recursive: true, force: true });
  }
  ok("Ruta B (BDD) B3.5 wiring: caso de plantilla → TC extra bajo la HU elegida + .feature materializado");

  // 41. F0: guardrail de 400 líneas — el MOTOR (core/runtime/adapters/bdd) no introduce
  // archivos NUEVOS por encima del límite. La deuda conocida vive en la allowlist del checker
  // y se vacía fase a fase; esta aserción protege el invariante de tamaño del motor.
  {
    const { violations } = analyzeLineBudget("engine");
    assert.strictEqual(
      violations.length, 0,
      `archivos del motor > 400 líneas fuera de allowlist: ${violations.map((v) => `${v.rel} (${v.lines})`).join(", ")}`,
    );
  }
  ok("F0 guardrail: el motor no tiene archivos nuevos > 400 líneas (presupuesto de líneas)");
}
