// runtime/smoke/regression-suite.mjs — ESCÁNER de selectores (módulo "Test de Regresión").
// Verifica OFFLINE (navegador FALSO, sin red ni Playwright real): (1) la lógica pura de elección de
// selector (harvest: role+nombre > etiqueta > testid > texto, alias sin acentos, dedup); (2) el
// escáner sin login recorre 2 rutas y arma el catálogo por página; (3) el escáner con login invoca
// el login genérico antes de catalogar. El launcher es inyectable → todo offline-testable.
import assert from "node:assert";
import { pickStrategy, buildElements, slugAlias } from "../regression/harvest.mjs";
import { scanSelectors } from "../regression/scan.mjs";
import { compileTest } from "../regression/compile.mjs";
import { buildRegressionReport } from "../regression/report.mjs";
import { STEPS } from "../runners/explore-steps.mjs";

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

  // 12) buildRegressionReport: HTML autocontenido con capturas (data-URI) y video; lector inyectado.
  const reader = (f) => Buffer.from(/\.webm$/i.test(f) ? "VIDEOBYTES" : "PNGBYTES");
  const html = buildRegressionReport({
    system: "Flit Dev",
    suite: "Login",
    stamp: "2026-07-22 10:00:00",
    reader,
    tests: [
      { name: "Logueo Correcto", status: "pass", warnings: [], video: "/x/video.webm", cases: [{ name: "1. clic Ingresar", status: "pass", file: "/x/paso-1.png" }] },
      { name: "Logueo Fallido", status: "fail", warnings: ["el elemento «x» ya no está"], video: "", cases: [{ name: "2. verificar", status: "fail", message: "no visible", file: "" }] },
    ],
  });
  assert.match(html, /Logueo Correcto/);
  assert.match(html, /✗ 1 en rojo · 1\/2 OK/); // veredicto
  assert.match(html, /data:image\/png;base64,/); // captura embebida
  assert.match(html, /data:video\/webm;base64,/); // video embebido
  assert.match(html, /ya no está/); // warning de regresión
  ctx.ok("buildRegressionReport: HTML autocontenido con capturas+video embebidos y veredicto");
}

export default { run };
