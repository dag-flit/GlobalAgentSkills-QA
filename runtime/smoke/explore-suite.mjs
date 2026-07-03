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

  // A2. azure: getWorkItem.type + getChildren (fan-out): Feature 100 → HU hijas 201, 202 (WIQL).
  const repoCh = fs.mkdtempSync(path.join(os.tmpdir(), "qa-child-"));
  const fakeCh = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/100"), () => ({ status: 200, json: { fields: { "System.Title": "Feature X", "System.State": "Active", "System.WorkItemType": "Feature" } } })],
    [(r) => r.method === "POST" && r.url.includes("/wit/wiql"), () => ({ status: 200, json: { workItems: [{ id: 201 }, { id: 202 }] } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/201"), () => ({ status: 200, json: { fields: { "System.Title": "HU A", "System.State": "Active", "System.WorkItemType": "User Story" } } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/202"), () => ({ status: 200, json: { fields: { "System.Title": "HU B", "System.State": "New", "System.WorkItemType": "User Story" } } })],
  ]);
  const adoCh = getAdapter({ profile: pFlit, env: creds, repoRoot: repoCh, http: fakeCh.http });
  const feat = await adoCh.getWorkItem("100");
  assert.strictEqual(feat.type, "Feature");
  const kids = await adoCh.getChildren("100");
  assert.strictEqual(kids.length, 2);
  assert.deepStrictEqual(kids.map((k) => k.id), ["201", "202"]);
  assert.deepStrictEqual(kids.map((k) => k.type), ["User Story", "User Story"]);
  assert.strictEqual(kids[0].title, "HU A");
  fs.rmSync(repoCh, { recursive: true, force: true });
  ok("azure: getWorkItem.type + getChildren (Feature → HU hijas por WIQL) para el fan-out");

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

  // D2. orquestador + GUION: runQaCycle acepta `flow` y produce evidencia por paso (local).
  const repoCycFlow = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cyc-flow-"));
  const cycFlow = await runQaCycle({
    repoRoot: repoCycFlow,
    profile: { tracker: "local" },
    flow: [{ ir_a: "https://app.test/" }, { op: "captura", nombre: "home" }],
    launchBrowser: fakeLaunch,
  });
  assert.strictEqual(cycFlow.ok, true);
  const expFlow = cycFlow.results.find((r) => r.layer === "explore");
  assert.ok(expFlow && expFlow.status === "pass");
  assert.strictEqual(expFlow.cases.length, 2); // un caso por paso
  assert.strictEqual(expFlow.metrics.steps, 2);
  assert.strictEqual(cycFlow.report.sink, "local");
  assert.ok(fs.existsSync(cycFlow.report.mdPath));
  fs.rmSync(repoCycFlow, { recursive: true, force: true });
  ok("orquestador + guion: runQaCycle corre el flow y deja evidencia por paso (local)");

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

  // I. guion de pasos (núcleo): ejecuta pasos EN ORDEN sobre una misma sesión, interpola
  //    ${VAR} de secretos (nunca en el guion), captura por paso, y fail-fast + auto-captura.
  {
    const repoFlow = fs.mkdtempSync(path.join(os.tmpdir(), "qa-flow-"));
    const seen = { fills: [], clicks: [] };
    // Página falsa (offline): los locators (css/getByLabel/getByRole/getByText) devuelven un
    // Locator falso; el clic "revela" el texto Bienvenido; screenshot escribe el png.
    const flowLaunch = () => ({
      async newPage() {
        const texts = new Set();
        const mkLoc = (label) => ({
          async fill(v) { seen.fills.push([label, v]); },
          async click() { seen.clicks.push(label); texts.add("Bienvenido"); },
          async press() {},
          first() { return { async isVisible() { return true; }, async waitFor() {} }; },
          async isVisible() { return true; },
          async count() { return 1; },
        });
        return {
          on() {},
          async goto() { return { status: () => 200 }; },
          locator(sel) { return mkLoc(sel); },
          getByLabel(l) { return mkLoc(l); },
          getByPlaceholder(p) { return mkLoc(p); },
          getByRole(r, o) { return mkLoc(`${r}:${o?.name ?? ""}`); },
          getByText(t) {
            return {
              first() { return { async waitFor() { if (!texts.has(t)) throw new Error("timeout"); }, async isVisible() { return texts.has(t); } }; },
              async count() { return texts.has(t) ? 1 : 0; },
            };
          },
          async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
          async close() {},
        };
      },
      async close() {},
    });

    // Flujo con LOCALIZADORES AMIGABLES: por etiqueta y por botón (sin CSS), + un css de compat.
    const flow = [
      { ir_a: "https://app.test/login" },
      { op: "escribir", por: "etiqueta", en: "Usuario", valor: "${QA_USER}" },
      { op: "escribir", en: "#pass", valor: "${QA_PASS}" }, // sin `por` → css (compat)
      { op: "clic", por: "boton", en: "Ingresar" },
      { op: "esperar_texto", texto: "Bienvenido" },
      { op: "verificar_texto", texto: "Bienvenido" },
      { op: "captura", nombre: "dashboard" },
    ];
    const flowEv = await runExplore({ repoRoot: repoFlow, env: { QA_USER: "ana", QA_PASS: "s3cr3t" }, flow, tcId: "HU-42", launchBrowser: flowLaunch });
    assert.strictEqual(flowEv.length, 1);
    assert.strictEqual(flowEv[0].status, "pass");
    assert.strictEqual(flowEv[0].tc_id, "HU-42");
    assert.strictEqual(flowEv[0].cases.length, 7);
    assert.ok(flowEv[0].cases.every((c) => c.status === "pass"));
    // locators amigables: etiqueta→getByLabel, css→locator, botón→getByRole.
    assert.deepStrictEqual(seen.fills, [["Usuario", "ana"], ["#pass", "s3cr3t"]]); // ${VAR} interpolado
    assert.deepStrictEqual(seen.clicks, ["button:Ingresar"]);
    // captura POR PASO (siempre): 6 automáticas + 1 explícita (dashboard); y cada caso trae su file.
    assert.strictEqual(flowEv[0].files.length, 7);
    assert.ok(/dashboard\.png$/.test(flowEv[0].files[6]));
    assert.ok(/paso-1-ir_a\.png$/.test(flowEv[0].files[0]));
    assert.ok(/paso-1-ir_a\.png$/.test(flowEv[0].cases[0].file)); // la captura queda vinculada al paso

    // fail-fast: una verificación incumplida corta el flujo y marca la captura del fallo.
    const flow2 = [{ ir_a: "https://app.test/" }, { op: "verificar_texto", texto: "NoExiste" }, { op: "captura", nombre: "no-llega" }];
    const flowEv2 = await runExplore({ repoRoot: repoFlow, flow: flow2, launchBrowser: flowLaunch });
    assert.strictEqual(flowEv2[0].status, "fail");
    assert.strictEqual(flowEv2[0].cases.length, 2); // corta en el paso 2; el 3º no corre
    assert.ok(/no encontrado/.test(flowEv2[0].cases[1].message));
    assert.strictEqual(flowEv2[0].files.length, 2); // paso-1 (ok) + fallo-paso-2
    assert.ok(/fallo-paso-2-verificar_texto\.png$/.test(flowEv2[0].files[1]));

    // gate: sin appUrl y sin flow → la capa no participa.
    assert.deepStrictEqual(await runExplore({ launchBrowser: flowLaunch }), []);
    fs.rmSync(repoFlow, { recursive: true, force: true });
  }
  ok("guion de pasos: localizadores amigables (etiqueta/botón/css), ${VAR}, captura por paso vinculada, fail-fast");

  // I2. entrada avanzada + verificaciones ricas: seleccionar/marcar/limpiar + verificar
  //     valor/cantidad/url/título/atributo/habilitado/marcado (offline con página falsa).
  {
    const repoAdv = fs.mkdtempSync(path.join(os.tmpdir(), "qa-adv-"));
    const rec = { selected: [], checked: [], cleared: [], uploaded: [] };
    const advLaunch = () => ({
      async newPage() {
        const mkLoc = () => ({
          async selectOption(v) { rec.selected.push(v); },
          async check() { rec.checked.push(true); },
          async uncheck() { rec.checked.push(false); },
          async setInputFiles(p) { rec.uploaded.push(p); },
          async fill(v) { rec.cleared.push(v); },
          async inputValue() { return "1000"; },
          async count() { return 3; },
          async getAttribute(n) { return n === "href" ? "/archivo.pdf" : null; },
          async isEnabled() { return true; },
          async isChecked() { return true; },
        });
        return {
          on() {},
          url() { return "https://app.test/dashboard"; },
          async title() { return "Inicio - App"; },
          locator() { return mkLoc(); },
          getByLabel() { return mkLoc(); },
          getByRole() { return mkLoc(); },
          async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
          async close() {},
        };
      },
      async close() {},
    });
    const advFlow = [
      { op: "seleccionar", en: "#pais", valor: "Argentina" },
      { op: "marcar", en: "#acepto" },
      { op: "limpiar", en: "#busqueda" },
      { op: "verificar_valor", en: "#total", valor: "1000" },
      { op: "verificar_cantidad", en: "tr", numero: "3" },
      { op: "verificar_url", texto: "/dashboard" },
      { op: "verificar_titulo", texto: "Inicio" },
      { op: "verificar_atributo", en: "#link", nombre: "href", valor: "/archivo.pdf" },
      { op: "verificar_habilitado", en: "#guardar" },
      { op: "verificar_marcado", en: "#acepto" },
    ];
    const advEv = await runExplore({ repoRoot: repoAdv, flow: advFlow, launchBrowser: advLaunch });
    assert.strictEqual(advEv[0].status, "pass");
    assert.strictEqual(advEv[0].cases.length, 10);
    assert.ok(advEv[0].cases.every((c) => c.status === "pass"), advEv[0].cases.filter((c) => c.status !== "pass").map((c) => c.message).join(" | "));
    assert.deepStrictEqual(rec.selected, ["Argentina"]);
    assert.deepStrictEqual(rec.checked, [true]);
    assert.deepStrictEqual(rec.cleared, [""]); // limpiar = fill("")

    // negativo: una verificación que no se cumple falla (cantidad esperada distinta).
    const advBad = await runExplore({ repoRoot: repoAdv, flow: [{ op: "verificar_cantidad", en: "tr", numero: "5" }], launchBrowser: advLaunch });
    assert.strictEqual(advBad[0].status, "fail");
    assert.ok(/cantidad 3 ≠ esperada 5/.test(advBad[0].cases[0].message));
    fs.rmSync(repoAdv, { recursive: true, force: true });
  }
  ok("entrada avanzada + verificaciones ricas: seleccionar/marcar/limpiar + verificar valor/cantidad/url/título/atributo/habilitado/marcado");

  // I3. cobertura de AC (matriz): pasos etiquetados con `ac` + AC declarados → cubierto/fallo/sin cubrir.
  {
    const repoCov = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cov-"));
    const covLaunch = () => ({
      async newPage() {
        return {
          on() {},
          async goto() { return { status: () => 200 }; },
          getByText(t) {
            return {
              async count() { return t === "Bienvenido" ? 1 : 0; },
              first() { return { async waitFor() {}, async isVisible() { return true; } }; },
            };
          },
          async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
          async close() {},
        };
      },
      async close() {},
    });
    // Paso 2 prueba AC1 (pasa), paso 3 prueba AC2 (falla → corta); AC3 queda declarado sin cubrir.
    const covFlow = [
      { ir_a: "https://app.test/" },
      { op: "verificar_texto", texto: "Bienvenido", ac: "AC1 ver saludo" },
      { op: "verificar_texto", texto: "NoExiste", ac: "AC2 ver panel" },
    ];
    const declaredAcs = ["AC1 ver saludo", "AC2 ver panel", "AC3 cerrar sesión"];
    const cyc = await runQaCycle({ repoRoot: repoCov, profile: { tracker: "local" }, flow: covFlow, declaredAcs, launchBrowser: covLaunch });
    const cov = cyc.results.find((r) => r.layer === "explore").coverage;
    assert.ok(cov, "el EvidenceObject del flujo debe traer coverage");
    assert.deepStrictEqual([cov.passed, cov.failed, cov.uncovered], [1, 1, 1]);
    assert.deepStrictEqual(cov.rows.map((r) => r.status), ["pass", "fail", "uncovered"]); // orden = AC declarados
    const md = fs.readFileSync(cyc.report.mdPath, "utf8");
    assert.ok(/Cobertura de criterios de aceptación/.test(md));
    assert.ok(/AC3 cerrar sesión/.test(md) && /sin cubrir/.test(md)); // AC declarado sin ningún paso
    fs.rmSync(repoCov, { recursive: true, force: true });
  }
  ok("cobertura de AC: pasos etiquetados + AC declarados → matriz cubierto/fallo/sin cubrir en el reporte");

  // H. guardrail de 400 líneas: el motor no tiene archivos por encima del límite.
  {
    const { violations } = analyzeLineBudget("engine");
    assert.strictEqual(violations.length, 0, `archivos del motor > 400: ${violations.map((v) => `${v.rel} (${v.lines})`).join(", ")}`);
  }
  ok("guardrail: el motor no tiene archivos > 400 líneas (presupuesto de líneas)");
}
