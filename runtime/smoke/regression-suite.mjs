// runtime/smoke/regression-suite.mjs — ESCÁNER de selectores (módulo "Test de Regresión").
// Verifica OFFLINE (navegador FALSO, sin red ni Playwright real): (1) la lógica pura de elección de
// selector (harvest: role+nombre > etiqueta > testid > texto, alias sin acentos, dedup); (2) el
// escáner sin login recorre 2 rutas y arma el catálogo por página; (3) el escáner con login invoca
// el login genérico antes de catalogar. El launcher es inyectable → todo offline-testable.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickStrategy, buildElements, slugAlias } from "../regression/harvest.mjs";
import { scanSelectors } from "../regression/scan.mjs";
import { compileTest } from "../regression/compile.mjs";
import { buildRegressionReport } from "../regression/report.mjs";
import { renderRegressionFindings, regressionTitle } from "../regression/findings.mjs";
import { classifyCase } from "../regression/diagnose.mjs";
import { friendlyStep } from "../regression/step-label.mjs";
import { STEPS } from "../runners/explore-steps.mjs";
import { AzureDevOpsAdapter } from "../../adapters/trackers/azure-devops/azure-devops-adapter.mjs";

// Catálogo de referencia para los casos del compilador (formas reales del harvest).
const COMPILE_CATALOG = {
  baseUrl: "https://app.test",
  pages: [
    { name: "Acceso", route: "/", elements: [
      { alias: "usuario", by: "label", value: "Usuario" },
      { alias: "ingresar", by: "role", role: "button", name: "Ingresar" },
    ] },
    { name: "Inicio", route: "/", elements: [
      { alias: "menu_de_usuario", by: "role", role: "button", name: "Menú de usuario" },
      { alias: "loader", by: "testid", value: "ui-loading" },
    ] },
  ],
};

// Nodos crudos canónicos por página (lo que devolvería page.evaluate en un navegador real).
const LOGIN_NODES = [
  { role: "textbox", field: true, label: "Usuario", name: "", text: "", placeholder: "", testid: "", visible: true },
  { role: "textbox", field: true, label: "Contraseña", name: "", text: "", placeholder: "", testid: "", visible: true },
  { role: "button", field: false, name: "Ingresar", text: "Ingresar", testid: "", visible: true },
];
const REPORTES_NODES = [
  { role: "heading", field: false, name: "Reportes y Analíticas", text: "Reportes y Analíticas", visible: true },
  { role: "textbox", field: true, label: "Desde", name: "", visible: true },
  { role: "button", field: false, name: "Exportar Excel", text: "Exportar Excel", testid: "btn-export", visible: true },
];

// Locator falso: todo "existe" (count 1) y toda acción resuelve → permite recorrer el login genérico.
function fakeLocator() {
  const loc = {
    count: async () => 1,
    first: () => loc,
    fill: async () => {},
    click: async () => {},
    press: async () => {},
    waitFor: async () => {},
    isVisible: async () => true,
  };
  return loc;
}

// Página falsa: page.evaluate devuelve los nodos según la URL actual (login vs reportes). NO expone
// waitForLoadState → settleSpa se omite (offline intacto). Registra si se navegó/logueó.
function makeFakePage(track) {
  let url = "";
  return {
    setDefaultTimeout() {},
    async goto(u) {
      url = u;
      track.gotos.push(u);
      return { status: () => 200 };
    },
    async evaluate() {
      return /reportes/i.test(url) ? REPORTES_NODES : LOGIN_NODES;
    },
    getByLabel() {
      return fakeLocator();
    },
    getByRole() {
      return fakeLocator();
    },
    getByText() {
      return fakeLocator();
    },
    locator() {
      return fakeLocator();
    },
    async title() {
      return "";
    },
  };
}

function makeFakeBrowser(track) {
  return {
    async newPage() {
      return makeFakePage(track);
    },
    async close() {
      track.closed = true;
    },
  };
}

export async function run(ctx) {
  console.log("\n-- regression-suite (escáner de selectores) --");

  // 1) harvest.pickStrategy: prioriza role+nombre para elementos con nombre.
  const st1 = pickStrategy({ role: "button", name: "Ingresar" });
  assert.deepStrictEqual(st1, { by: "role", role: "button", name: "Ingresar" });
  ctx.ok("pickStrategy: botón con nombre → getByRole{name}");

  // 2) harvest.pickStrategy: campo con etiqueta → getByLabel.
  const st2 = pickStrategy({ role: "textbox", field: true, label: "Usuario" });
  assert.deepStrictEqual(st2, { by: "label", value: "Usuario" });
  ctx.ok("pickStrategy: campo con etiqueta → getByLabel");

  // 3) harvest.pickStrategy: sin role nombrado ni etiqueta pero con testid → getByTestId.
  const st3 = pickStrategy({ role: "", field: false, testid: "menu-user" });
  assert.deepStrictEqual(st3, { by: "testid", value: "menu-user" });
  ctx.ok("pickStrategy: elemento con data-testid → getByTestId");

  // 3b) harvest.pickStrategy: control SIN ancla legible (checkbox revelado sin etiqueta) → colchón por
  // atributo `name` (o `id` estable), para no dejar suelto ningún control accionable. Alias legible por seed.
  const stCb = pickStrategy({ role: "checkbox", field: true, name: "", label: "", nameAttr: "acepta_terminos" });
  assert.deepStrictEqual(stCb, { by: "css", value: '[name="acepta_terminos"]', seed: "acepta_terminos" });
  const stId = pickStrategy({ role: "checkbox", field: true, nameAttr: "", id: "chkVehiculo" });
  assert.deepStrictEqual(stId, { by: "css", value: "#chkVehiculo", seed: "chkVehiculo" });
  // id auto-generado (React `:r0:`) NO sirve de ancla → se descarta (no hay otra pista).
  assert.strictEqual(pickStrategy({ role: "checkbox", field: true, id: ":r0:" }), null);
  const cbEls = buildElements([{ role: "checkbox", field: true, nameAttr: "acepta_terminos", visible: true }]);
  assert.strictEqual(cbEls[0].alias, "acepta_terminos", "el alias sale del name (seed), no del selector CSS");
  assert.ok(!("seed" in cbEls[0]), "el seed no se guarda en el elemento");
  ctx.ok("harvest: checkbox sin etiqueta se captura por name/id estable (colchón) con alias legible");

  // 4) harvest.buildElements: alias sin acentos + dedup por (estrategia,valor).
  const els = buildElements([
    { role: "button", name: "Añadir", visible: true },
    { role: "button", name: "Añadir", visible: true }, // duplicado exacto → se descarta
    { role: "heading", name: "Añadir", visible: true }, // mismo alias, otra estrategia → alias_2
  ]);
  assert.strictEqual(els.length, 2, "el duplicado exacto se deduplica");
  assert.strictEqual(slugAlias("Añadir"), "anadir");
  assert.strictEqual(els[0].alias, "anadir");
  assert.strictEqual(els[1].alias, "anadir_2", "colisión de alias → sufijo numérico");
  ctx.ok("buildElements: alias sin acentos, dedup y sufijo por colisión");

  // 5) scanSelectors SIN login: recorre 2 rutas y arma el catálogo por página.
  const track = { gotos: [], closed: false };
  const res = await scanSelectors({
    baseUrl: "https://app.test",
    auth: { mode: "none" },
    routes: [
      { route: "", name: "Login" },
      { route: "/?m=reportes", name: "Reportes" },
    ],
    launchBrowser: async () => makeFakeBrowser(track),
    timeout: 500,
  });
  assert.strictEqual(res.ok, true, res.message);
  assert.strictEqual(res.catalog.pages.length, 2);
  assert.strictEqual(res.catalog.authMode, "none");
  const reportes = res.catalog.pages.find((p) => /reportes/i.test(p.route));
  const exportar = reportes.elements.find((e) => e.alias === "exportar_excel");
  assert.deepStrictEqual(exportar, { alias: "exportar_excel", by: "role", role: "button", name: "Exportar Excel" });
  assert.ok(reportes.elements.some((e) => e.by === "label" && e.value === "Desde"));
  assert.strictEqual(track.closed, true, "el navegador se cierra al terminar");
  ctx.ok("scanSelectors (sin login): catálogo de 2 páginas con selectores robustos");

  // 6) scanSelectors CON login: invoca el login genérico antes de catalogar (usa ${QA_USER}/${QA_PASS}).
  const track2 = { gotos: [], closed: false };
  const res2 = await scanSelectors({
    baseUrl: "https://app.test",
    auth: { mode: "login" },
    routes: [{ route: "", name: "Login" }],
    vars: { QA_USER: "qa@test", QA_PASS: "secret" },
    launchBrowser: async () => makeFakeBrowser(track2),
    timeout: 500,
  });
  assert.strictEqual(res2.ok, true, res2.message);
  assert.strictEqual(res2.catalog.authMode, "login");
  // La PRIMERA página catalogada es la pantalla de acceso (ANTES de loguear) → tiene el formulario
  // de login (usuario/clave/botón). Sin esto no se podría armar una prueba de login.
  assert.ok(/Acceso/i.test(res2.catalog.pages[0].name), "cataloga la pantalla de login antes de entrar");
  assert.ok(res2.catalog.pages[0].elements.some((e) => e.by === "label"), "el login trae campos por etiqueta");
  ctx.ok("scanSelectors (con login): cataloga la pantalla de acceso ANTES de loguear, y luego la app");

  // 7) compileTest: traduce una prueba (pasos con alias) a un flow del motor y arranca en la URL base.
  const c = compileTest({
    test: { name: "T", steps: [
      { op: "escribir", alias: "usuario", valor: "${QA_USER}" },
      { op: "clic", alias: "ingresar" },
      { op: "verificar_texto", texto: "Bienvenido" },
      { op: "captura", nombre: "fin" },
    ] },
    catalog: COMPILE_CATALOG,
  });
  assert.deepStrictEqual(c.flow[0], { op: "ir_a", url: "https://app.test" });
  assert.deepStrictEqual(c.flow[1], { op: "escribir", por: "etiqueta", en: "Usuario", valor: "${QA_USER}" });
  assert.deepStrictEqual(c.flow[2], { op: "clic", por: "role", rol: "button", en: "Ingresar" });
  assert.deepStrictEqual(c.flow[3], { op: "esperar_texto", texto: "Bienvenido" }); // verificar_texto → espera (SPA)
  assert.deepStrictEqual(c.flow[4], { op: "captura", nombre: "fin" });
  assert.strictEqual(c.warnings.length, 0);
  for (const st of c.flow) assert.ok(STEPS[st.op], `la op compilada «${st.op}» existe en el motor`);
  ctx.ok("compileTest: mapea alias→localizador, valor y arranca en la URL base (ops válidas del motor)");

  // 8) compileTest con login → antepone {op:"login"} tras la navegación base.
  const c2 = compileTest({ test: { steps: [{ op: "clic", alias: "menu_de_usuario" }] }, catalog: COMPILE_CATALOG, login: true });
  assert.deepStrictEqual(c2.flow[0], { op: "ir_a", url: "https://app.test" });
  assert.deepStrictEqual(c2.flow[1], { op: "login" });
  assert.strictEqual(c2.flow[2].op, "clic");
  ctx.ok("compileTest (login): antepone el login automático tras ir a la URL base");

  // 9) alias por testid → getByTestId; verificar_visible → `esperar` (tolerante a SPA).
  const c3 = compileTest({ test: { steps: [{ op: "verificar_visible", alias: "loader" }] }, catalog: COMPILE_CATALOG });
  const vis = c3.flow.find((f) => f.op === "esperar");
  assert.deepStrictEqual(vis, { op: "esperar", por: "testid", en: "ui-loading" });
  ctx.ok("compileTest: alias por testid → getByTestId; verificar_visible espera a que aparezca");

  // 10) alias INEXISTENTE en el catálogo → warning accionable + paso centinela que falla (regresión).
  const c4 = compileTest({ test: { steps: [{ op: "clic", alias: "boton_fantasma" }] }, catalog: COMPILE_CATALOG });
  assert.strictEqual(c4.warnings.length, 1);
  assert.match(c4.warnings[0].message, /boton_fantasma/);
  const sentinel = c4.flow[c4.flow.length - 1];
  assert.strictEqual(sentinel.por, "css");
  assert.match(sentinel.en, /boton_fantasma/);
  ctx.ok("compileTest: alias ausente del catálogo → warning de regresión + paso que falla (no se omite)");

  // 11) paso ir_a con ruta relativa → se une a la URL base.
  const c5 = compileTest({ test: { steps: [{ op: "ir_a", ruta: "/?m=reportes" }] }, catalog: COMPILE_CATALOG });
  const navs = c5.flow.filter((f) => f.op === "ir_a");
  assert.strictEqual(navs[1].url, "https://app.test/?m=reportes");
  ctx.ok("compileTest: ir_a con ruta relativa se une a la URL base");

  // 11b) esperar_tiempo → paso de PAUSA del motor (N segundos), para esperar antes/después de un clic.
  const c6 = compileTest({ test: { steps: [{ op: "esperar_tiempo", segundos: "2" }] }, catalog: COMPILE_CATALOG });
  const pause = c6.flow.find((f) => f.op === "esperar_tiempo");
  assert.deepStrictEqual(pause, { op: "esperar_tiempo", segundos: "2" });
  assert.ok(STEPS["esperar_tiempo"], "el motor tiene el paso esperar_tiempo");
  ctx.ok("compileTest: esperar_tiempo → pausa de N segundos (op válida del motor)");

  // 11c) aserciones RICAS (valor/cantidad/habilitado/atributo/título) → ops del motor con localizador
  // + campos. verificar_atributo lleva DOS datos (nombre del atributo + valor esperado).
  const c7 = compileTest({ test: { steps: [
    { op: "verificar_valor", alias: "usuario", valor: "juan" },
    { op: "verificar_cantidad", alias: "ingresar", numero: "3" },
    { op: "verificar_habilitado", alias: "ingresar" },
    { op: "verificar_atributo", alias: "menu_de_usuario", nombre: "aria-disabled", valor: "true" },
    { op: "verificar_titulo", texto: "Inicio" },
  ] }, catalog: COMPILE_CATALOG });
  const byOp = (op) => c7.flow.find((f) => f.op === op);
  assert.deepStrictEqual(byOp("verificar_valor"), { op: "verificar_valor", por: "etiqueta", en: "Usuario", valor: "juan" });
  assert.deepStrictEqual(byOp("verificar_cantidad"), { op: "verificar_cantidad", por: "role", rol: "button", en: "Ingresar", numero: "3" });
  assert.deepStrictEqual(byOp("verificar_habilitado"), { op: "verificar_habilitado", por: "role", rol: "button", en: "Ingresar" });
  assert.deepStrictEqual(byOp("verificar_atributo"), { op: "verificar_atributo", por: "role", rol: "button", en: "Menú de usuario", nombre: "aria-disabled", valor: "true" });
  assert.deepStrictEqual(byOp("verificar_titulo"), { op: "verificar_titulo", texto: "Inicio" });
  for (const f of c7.flow) assert.ok(STEPS[f.op], `op ${f.op} existe en el motor`);
  assert.strictEqual(c7.warnings.length, 0);
  ctx.ok("compileTest: aserciones ricas (valor/cantidad/habilitado/atributo/título) → ops válidas del motor");

  // 12) buildRegressionReport: HTML autocontenido con capturas (data-URI) + reproducción paso a paso
  // (slideshow) construida con ellas; SIN video (salía en blanco en headless). Lector inyectado.
  const reader = (f) => Buffer.from(/\.png$/i.test(f) ? "PNGBYTES" : "");
  const html = buildRegressionReport({
    system: "Flit Dev",
    suite: "Login",
    stamp: "2026-07-22 10:00:00",
    reader,
    tests: [
      { name: "Logueo Correcto", status: "pass", flaky: true, attempts: 2, warnings: [], cases: [{ name: "1. clic Ingresar", status: "pass", file: "/x/paso-1.png" }] },
      { name: "Logueo Fallido", status: "fail", warnings: ["el elemento «x» ya no está"], cases: [{ name: "2. verificar", status: "fail", message: "no visible", file: "" }] },
    ],
  });
  assert.match(html, /Logueo Correcto/);
  assert.match(html, /✗ 1 en rojo · 1\/2 OK/); // veredicto
  assert.match(html, /inestable/); // prueba flaky (pasó al reintentar) marcada, no escondida
  assert.match(html, /data:image\/png;base64,/); // captura embebida
  assert.ok(!/<video/.test(html), "ya no incrusta video (salía en blanco en headless)");
  assert.match(html, /class="player"/); // reproductor paso a paso (para la prueba con capturas)
  assert.match(html, /Reproducir/); // control de reproducción
  assert.match(html, /data-cap=/); // el paso lleva su leyenda para la reproducción
  assert.match(html, /ya no está/); // warning de regresión
  ctx.ok("buildRegressionReport: capturas embebidas + reproducción paso a paso (sin video) y veredicto");

  // 13) renderRegressionFindings: Description de la HU (estilo en línea para ADO) de UNA prueba.
  const okDesc = renderRegressionFindings({
    system: "Flit Dev", suite: "Login", stamp: "2026-07-22 10:00:00", url: "https://dev.flitsas.online",
    test: { name: "Logueo Correcto", status: "pass", flaky: true, attempts: 2, warnings: [], cases: [{ name: "1. clic Ingresar", status: "pass" }] },
  });
  assert.match(okDesc, /La prueba de regresión pasó/);
  assert.match(okDesc, /Logueo Correcto/);
  assert.match(okDesc, /inestable/); // flaky señalado en la HU (pasó, pero conviene estabilizar)
  assert.match(okDesc, /Intentos/);
  assert.match(okDesc, /URL probada/); // la URL de ejecución queda en la Description
  assert.match(okDesc, /dev\.flitsas\.online/);
  assert.ok(/style="[^"]*background/.test(okDesc), "el estilo va EN LÍNEA (ADO descarta hojas de estilo)");
  assert.ok(!/<style/.test(okDesc), "no usa <style> (ADO lo descartaría)");
  const badDesc = renderRegressionFindings({
    system: "Flit Dev", suite: "Login",
    test: { name: "Logueo Fallido", status: "fail", warnings: ["el elemento «x» ya no está"], cases: [{ name: "2. verificar", status: "fail", message: "no visible" }] },
  });
  assert.match(badDesc, /La prueba de regresión falló/);
  assert.match(badDesc, /no visible/); // el mensaje de error del paso
  assert.match(badDesc, /ya no está/); // el aviso de regresión
  ctx.ok("renderRegressionFindings: Description con veredicto, URL, pasos y avisos (estilo en línea, sin <style>)");

  // 14) regressionTitle: prefijo estable propio + suite/prueba + fecha·hora + #N (como QA del código).
  const title = regressionTitle({ suite: "Login", test: "Logueo Correcto", stamp: "2026-07-22 10:00:00", seq: 1 });
  assert.strictEqual(title, "Regresión E2E (QualityOps) — Login / Logueo Correcto — 2026-07-22 10:00:00 #1");
  assert.match(regressionTitle({ suite: "S", test: "T" }), /^Regresión E2E \(QualityOps\) — S \/ T$/); // sin seq → sin #N
  ctx.ok("regressionTitle: marcador propio + fecha·hora + #N (conteo específico, no cuenta ítems ajenos)");

  // 15) createFindingsWorkItem con capturas INLINE: las sube y las incrusta en el CUERPO (Description
  // rotulada «Paso N» + campo Evidences descubierto por nombre), y NO las manda a la lista de adjuntos.
  // Adapter REAL con cliente FALSO que captura las llamadas → offline. Archivos temporales reales.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reg-"));
  const png1 = path.join(tmp, "paso-1-ir_a.png");
  const png2 = path.join(tmp, "fallo-paso-2-verificar.png");
  const report = path.join(tmp, "report.html");
  fs.writeFileSync(png1, "PNG1");
  fs.writeFileSync(png2, "PNG2");
  fs.writeFileSync(report, "<html>reporte</html>");
  const calls = { uploads: [], creates: [], patches: [], fields: 0 };
  const fakeClient = {
    project: "Proj",
    workItemWebUrl: (id) => `https://ado/wi/${id}`,
    async queryByWiql() { return { status: 200, json: { workItems: [] } }; },
    async currentIteration() { return { status: 200, json: { value: [{ path: "Proj\\Sprint 1" }] } }; },
    async uploadAttachment(name) { calls.uploads.push(name); return { status: 201, json: { id: "a", url: `https://ado/att/${name}` } }; },
    async createWorkItem(type, ops) { calls.creates.push({ type, ops }); return { status: 200, json: { id: 7777 } }; },
    async patchWorkItem(id, ops) { calls.patches.push({ id, ops }); return { status: 200, json: {} }; },
    async listFields() { calls.fields++; return { status: 200, json: { value: [{ name: "Evidences", referenceName: "Custom.Evidences" }] } }; },
  };
  const adapter = new AzureDevOpsAdapter({ adoClient: fakeClient, profile: { azure: { fields: {} } }, env: {} });
  const created = await adapter.createFindingsWorkItem({
    makeTitle: (seq) => `Regresión E2E (QualityOps) — Login / T #${seq}`,
    descriptionHtml: "<p>Resumen</p>",
    attachHtml: report,
    inlineImages: [
      { file: png1, label: "Paso 1 — Ir a /login", status: "pass" },
      { file: png2, label: "Paso 2 — verificar", status: "fail" },
    ],
    inlineIntoEvidence: true,
  });
  try {
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.id, "7777");
    assert.strictEqual(created.inlineImages, 2, "subió las 2 capturas para incrustarlas");
    assert.strictEqual(created.evidenceField, "Custom.Evidences", "descubrió el campo por su nombre visible");
    assert.strictEqual(created.evidenceAttached, true, "puso la galería en el campo Evidences");
    // La Description del create lleva SOLO el resumen: las capturas se movieron al campo Evidences.
    const descOp = created && calls.creates[0].ops.find((o) => o.path === "/fields/System.Description");
    assert.match(descOp.value, /Resumen/);
    assert.ok(!/<img/.test(descOp.value), "la Description ya NO lleva capturas (van al campo Evidences)");
    assert.ok(!/Evidencia por paso/.test(descOp.value), "el apartado «Evidencia por paso» se movió a Evidences");
    // El apartado «Evidencia por paso» (título + imágenes inline) se escribe por PATCH en Evidences.
    const evPatch = calls.patches.find((p) => p.ops[0] && p.ops[0].path === "/fields/Custom.Evidences");
    assert.ok(evPatch, "se escribe el campo Evidences");
    assert.match(evPatch.ops[0].value, /Evidencia por paso/);
    assert.match(evPatch.ops[0].value, /Paso 1 — Ir a \/login/);
    assert.match(evPatch.ops[0].value, /<img src="https:\/\/ado\/att\/paso-1-ir_a\.png"/);
    // Las capturas NO se enlazan como AttachedFile (van inline). Solo el reporte HTML se adjunta.
    const attachRels = calls.patches.filter((p) => p.ops[0] && p.ops[0].value && p.ops[0].value.rel === "AttachedFile");
    assert.ok(!attachRels.some((p) => /paso-\d/.test(String(p.ops[0].value.url))), "ningún PNG queda como adjunto");
    assert.ok(attachRels.some((p) => /report\.html/.test(String(p.ops[0].value.url))), "el reporte HTML sí queda adjunto");
    ctx.ok("createFindingsWorkItem: «Evidencia por paso» va al campo Evidences (Description limpia), PNG fuera de adjuntos");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 16) diagnose: clasifica la CAUSA del fallo (selector cambió / valor cambió / entorno) y la plasma
  // en el reporte y la HU → el humano sabe qué reportar a devs o qué corregir en su suite.
  assert.strictEqual(classifyCase({ op: "clic", status: "fail", message: "Timeout" }), "selector");
  assert.strictEqual(classifyCase({ op: "verificar_valor", status: "fail", message: 'valor "a" ≠ esperado "b"' }), "assertion");
  assert.strictEqual(classifyCase({ op: "verificar_visible", status: "fail", message: "no visible: [data-selector-ausente=x]" }), "selector");
  assert.strictEqual(classifyCase({ op: "esperar_texto", status: "fail", message: "texto no aparece" }), "assertion");
  assert.strictEqual(classifyCase({ op: "clic", status: "pass" }), null); // un paso que pasó no se diagnostica
  assert.strictEqual(classifyCase({ name: "3. verificar_titulo Inicio", status: "fail", message: "x" }), "assertion"); // sin `op` → del nombre
  const diagHtml = buildRegressionReport({ system: "S", suite: "L", tests: [{ name: "T", status: "fail", warnings: [], cases: [{ name: "2. clic Guardar", op: "clic", status: "fail", message: "Timeout", file: "" }] }] });
  assert.match(diagHtml, /No se encontró un elemento/);
  const diagDesc = renderRegressionFindings({ system: "S", suite: "L", test: { name: "T", status: "fail", warnings: [], cases: [{ name: "2. verificar_valor Total", op: "verificar_valor", status: "fail", message: 'valor "1" ≠ esperado "2"' }] } });
  assert.match(diagDesc, /Qué hacer con este fallo/);
  assert.match(diagDesc, /Una verificación no se cumplió/);
  ctx.ok("diagnose: clasifica selector/valor/entorno y lo plasma en reporte + HU (qué reportar / corregir)");

  // 17) step-label.friendlyStep: acción LEGIBLE + elemento (sin nº duplicado ni op cruda). Se usa en la
  // galería de Evidences, la tabla «Pasos ejecutados» de la HU y el reporte HTML (fuente única).
  assert.strictEqual(friendlyStep("2. escribir Usuario Corporativo", "escribir"), "Escribir en «Usuario Corporativo»");
  assert.strictEqual(friendlyStep("5. esperar_texto Correo o contraseña incorrectos", "esperar_texto"), "Verificar texto «Correo o contraseña incorrectos»");
  assert.strictEqual(friendlyStep("3. clic Ingresar", "clic"), "Clic en «Ingresar»");
  assert.strictEqual(friendlyStep("1. captura", "captura"), "Captura");
  assert.match(friendlyStep("4. esperar_texto Total", undefined), /^esperar_texto Total$/); // sin op (corrida vieja): al menos quita el nº
  // keepNumber → conserva el «N.» al frente (para «Pasos ejecutados» y el reporte, no para la galería).
  assert.strictEqual(friendlyStep("5. esperar_texto Correo o contraseña incorrectos", "esperar_texto", { keepNumber: true }), "5. Verificar texto «Correo o contraseña incorrectos»");
  const fr = renderRegressionFindings({ system: "S", suite: "L", test: { name: "T", status: "fail", warnings: [], cases: [{ name: "5. esperar_texto Correo o contraseña incorrectos", op: "esperar_texto", status: "fail", message: "x" }] } });
  assert.match(fr, /5\. Verificar texto «Correo o contraseña incorrectos»/); // «Pasos ejecutados» conserva el nº + acción legible
  ctx.ok("step-label: acción legible + elemento; «Pasos ejecutados»/reporte conservan el nº, galería no");
}

export default { run };
