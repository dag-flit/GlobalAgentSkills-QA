// runtime/smoke/regression-walk-suite.mjs — WALK-THROUGH de Recorridos (asistentes multi-pantalla).
// Verifica OFFLINE (navegador FALSO): el escáner camina un Recorrido etapa por etapa (cosecha → avanza
// → cosecha), heredando lo previo sin reescribirlo; nombra cada página como breadcrumb «Recorrido ›
// Etapa»; se detiene con motivo si una etapa no tiene avance o el avance falla; e inicia sesión antes
// de caminar si el sistema lo requiere. El launcher es inyectable → todo offline-testable.
import assert from "node:assert";
import { walkRecorrido, stageName, stagePrefix } from "../regression/walk.mjs";
import { compileTest } from "../regression/compile.mjs";
import { STEPS } from "../runners/explore-steps.mjs";

// Nodos crudos (lo que devolvería page.evaluate) por ETAPA del asistente Matrícula Inicial.
const STAGE_NODES = [
  [ // 0 · Consulta RUNT
    { role: "textbox", field: true, label: "Documento", visible: true },
    { role: "button", field: false, name: "Consultar RUNT", text: "Consultar RUNT", visible: true },
  ],
  [ // 1 · Resultado RUNT
    { role: "heading", field: false, name: "Resultado de la consulta", text: "Resultado de la consulta", visible: true },
    { role: "button", field: false, name: "Continuar", text: "Continuar", visible: true },
  ],
  [ // 2 · Organismo de Tránsito (última etapa)
    { role: "heading", field: false, name: "Organismo de Tránsito", text: "Organismo de Tránsito", visible: true },
    { role: "combobox", field: true, label: "Organismo", visible: true },
  ],
];
const LOGIN_NODES = [
  { role: "textbox", field: true, label: "Usuario", visible: true },
  { role: "textbox", field: true, label: "Contraseña", visible: true },
  { role: "button", field: false, name: "Ingresar", text: "Ingresar", visible: true },
];

// Catálogo YA guardado (para resolver los ALIAS de los avances). Contiene documento/consultar_runt/continuar.
const SAVED_CATALOG = {
  baseUrl: "https://app.test",
  pages: [
    { name: "Matrícula Inicial › Consulta RUNT", route: "/mi", elements: [
      { alias: "documento", by: "label", value: "Documento" },
      { alias: "consultar_runt", by: "role", role: "button", name: "Consultar RUNT" },
    ] },
    { name: "Matrícula Inicial › Resultado RUNT", route: "/mi", elements: [
      { alias: "continuar", by: "role", role: "button", name: "Continuar" },
    ] },
  ],
};

const MI_STAGES = [
  { name: "Consulta RUNT", advance: [{ op: "escribir", alias: "documento", valor: "12345" }, { op: "clic", alias: "consultar_runt" }] },
  { name: "Resultado RUNT", advance: [{ op: "clic", alias: "continuar" }] },
  { name: "Organismo de Tránsito" },
];

// Locator falso: existe (count 1), acciones resuelven; click() invoca onClick para avanzar de etapa.
function fakeLocator(onClick, throwOnClick) {
  const loc = {
    count: async () => 1,
    first: () => loc,
    fill: async () => {},
    async click() { if (throwOnClick) throw new Error("elemento no accionable (timeout)"); onClick(); },
    press: async () => {},
    waitFor: async () => {},
    isVisible: async () => true,
    isEnabled: async () => true,
  };
  return loc;
}

// Página falsa parametrizada: en fase "prelogin" muestra el formulario de acceso; el primer click lo
// pasa a "walking". En "walking", cada click avanza el índice de etapa → evaluate() devuelve los nodos
// de la etapa vigente. Modela un asistente que avanza pantalla a pantalla al pulsar el botón.
function makeWalkPage(track, { login, throwOnClick }) {
  const state = { phase: login ? "prelogin" : "walking", stage: 0 };
  const advance = () => {
    if (state.phase === "prelogin") { state.phase = "walking"; track.loggedIn = true; }
    else state.stage++;
  };
  return {
    setDefaultTimeout() {},
    async goto(u) { track.gotos.push(u); return { status: () => 200 }; },
    async evaluate() { return state.phase === "prelogin" ? LOGIN_NODES : STAGE_NODES[Math.min(state.stage, STAGE_NODES.length - 1)]; },
    getByLabel() { return fakeLocator(advance, false); },
    getByRole() { return fakeLocator(advance, throwOnClick); },
    getByText() { return fakeLocator(advance, false); },
    locator() { return fakeLocator(advance, false); },
    async title() { return ""; },
  };
}
function makeWalkBrowser(track, opts = {}) {
  return { async newPage() { return makeWalkPage(track, opts); }, async close() { track.closed = true; } };
}

export async function run(ctx) {
  console.log("\n-- regression-walk-suite (recorridos multi-pantalla) --");

  // 0) helpers puros de nombre (breadcrumb).
  assert.strictEqual(stageName("Matrícula Inicial", "Consulta RUNT"), "Matrícula Inicial › Consulta RUNT");
  assert.strictEqual(stagePrefix("Matrícula Inicial"), "Matrícula Inicial › ");
  ctx.ok("walk.stageName/stagePrefix: breadcrumb «Recorrido › Etapa»");

  // 1) Recorrido feliz de 3 etapas (sin login): cosecha cada pantalla avanzando por el asistente.
  const t1 = { gotos: [], closed: false };
  const r1 = await walkRecorrido({
    name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "none" },
    entry: "/tramites/nuevo/matricula_inicial", stages: MI_STAGES, catalog: SAVED_CATALOG,
    launchBrowser: async () => makeWalkBrowser(t1), timeout: 500,
  });
  assert.strictEqual(r1.ok, true, r1.message || "");
  assert.strictEqual(r1.pages.length, 3, "cataloga las 3 etapas");
  assert.strictEqual(r1.reached, 3);
  assert.strictEqual(r1.total, 3);
  assert.strictEqual(r1.stalledAt, null, "no se atasca");
  assert.strictEqual(r1.pages[0].name, "Matrícula Inicial › Consulta RUNT");
  assert.strictEqual(r1.pages[1].name, "Matrícula Inicial › Resultado RUNT");
  assert.strictEqual(r1.pages[2].name, "Matrícula Inicial › Organismo de Tránsito");
  // La etapa 2 (Resultado RUNT) trae selectores DISTINTOS a la etapa 1 → se caminó de verdad, no se
  // recatalogó la misma pantalla (el UUID de la URL nunca se navegó).
  assert.ok(r1.pages[1].elements.some((e) => e.alias === "continuar"), "la 2ª pantalla tiene su botón Continuar");
  assert.ok(r1.pages[2].elements.some((e) => e.by === "label" && e.value === "Organismo"), "la 3ª pantalla tiene el campo Organismo");
  assert.strictEqual(r1.prefix, "Matrícula Inicial › ");
  assert.strictEqual(t1.closed, true, "cierra el navegador");
  ctx.ok("walkRecorrido: camina 3 etapas heredando el avance, breadcrumb por etapa, selectores distintos");

  // 2) Etapa intermedia SIN pasos de avance → se detiene ahí con motivo accionable (cataloga hasta ella).
  const t2 = { gotos: [], closed: false };
  const r2 = await walkRecorrido({
    name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "none" }, entry: "/mi",
    stages: [MI_STAGES[0], { name: "Resultado RUNT" }, { name: "Organismo de Tránsito" }],
    catalog: SAVED_CATALOG, launchBrowser: async () => makeWalkBrowser(t2), timeout: 500,
  });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.pages.length, 2, "cataloga hasta la etapa sin avance (incluida)");
  assert.strictEqual(r2.reached, 2);
  assert.strictEqual(r2.stalledAt, "Resultado RUNT");
  assert.strictEqual(r2.stallReason, "no_advance", "el corte por falta de avance es el checkpoint normal");
  assert.match(r2.message, /no tiene pasos de avance/);
  ctx.ok("walkRecorrido: etapa sin avance → checkpoint (no_advance) con motivo (define cómo avanzar e itera)");

  // 3) El avance FALLA (botón no accionable) → se detiene con el motivo del paso.
  const t3 = { gotos: [], closed: false };
  const r3 = await walkRecorrido({
    name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "none" }, entry: "/mi",
    stages: MI_STAGES, catalog: SAVED_CATALOG,
    launchBrowser: async () => makeWalkBrowser(t3, { throwOnClick: true }), timeout: 500,
  });
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(r3.reached, 1, "alcanzó a catalogar la 1ª etapa antes de fallar el avance");
  assert.strictEqual(r3.stalledAt, "Consulta RUNT");
  assert.strictEqual(r3.stallReason, "advance_failed", "el avance que falla es un problema a revisar, no un checkpoint");
  assert.match(r3.message, /No se pudo avanzar/);
  ctx.ok("walkRecorrido: avance que falla → se detiene (advance_failed) con el motivo del paso");

  // 4) CON login: inicia sesión ANTES de caminar; la 1ª página catalogada ya es la etapa (no el login).
  const t4 = { gotos: [], closed: false, loggedIn: false };
  const r4 = await walkRecorrido({
    name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "login" }, entry: "/mi",
    stages: MI_STAGES, catalog: SAVED_CATALOG, vars: { QA_USER: "qa@test", QA_PASS: "secret" },
    launchBrowser: async () => makeWalkBrowser(t4, { login: true }), timeout: 500,
  });
  assert.strictEqual(r4.ok, true, r4.message || "");
  assert.strictEqual(t4.loggedIn, true, "inició sesión antes de caminar");
  assert.strictEqual(r4.reached, 3);
  assert.ok(r4.pages[0].elements.some((e) => e.alias === "consultar_runt"), "la 1ª página es la etapa (post-login), no el formulario de acceso");
  ctx.ok("walkRecorrido (con login): autentica antes de caminar; cataloga las etapas, no el login");

  // 5) PREPARE: acciones para revelar elementos que aparecen al interactuar (checkbox tras «Consultar»)
  // → la cosecha ocurre DESPUÉS de prepare y los incluye (no deja nada suelto).
  const BASE = STAGE_NODES[0]; // documento + consultar_runt
  const CHECKBOX = { role: "checkbox", field: true, nameAttr: "apalancado", visible: true };
  function makePrepPage(track) {
    let revealed = false;
    const loc = () => ({ count: async () => 1, first() { return this; }, fill: async () => {}, async click() { revealed = true; }, press: async () => {}, waitFor: async () => {}, isVisible: async () => true, isEnabled: async () => true });
    return {
      setDefaultTimeout() {},
      async goto(u) { track.gotos.push(u); return { status: () => 200 }; },
      async evaluate() { return revealed ? [...BASE, CHECKBOX] : BASE; },
      getByLabel: loc, getByRole: loc, getByText: loc, locator: loc,
      async title() { return ""; },
    };
  }
  const t5 = { gotos: [] };
  const r5 = await walkRecorrido({
    name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "none" }, entry: "/mi",
    stages: [{ name: "Consulta RUNT", prepare: [{ op: "escribir", alias: "documento", valor: "123" }, { op: "clic", alias: "consultar_runt" }] }],
    catalog: SAVED_CATALOG, launchBrowser: async () => ({ async newPage() { return makePrepPage(t5); }, async close() {} }), timeout: 500,
  });
  assert.strictEqual(r5.ok, true, r5.message || "");
  assert.strictEqual(r5.pages.length, 1);
  // El checkbox revelado por «Consultar» quedó catalogado (por su atributo name = colchón).
  assert.ok(r5.pages[0].elements.some((e) => e.alias === "apalancado"), "el checkbox revelado tras preparar se capturó");
  assert.ok(r5.pages[0].elements.some((e) => e.alias === "consultar_runt"), "también los elementos iniciales de la pantalla");
  ctx.ok("walkRecorrido (prepare): revela y captura los elementos que aparecen al interactuar (checkbox)");

  // 6) subir_archivo (Fase 2): op de ELEMENTO con `ruta` = ${QA_FILES}/<nombre>. Compila a localizador +
  // ruta; el motor resuelve ${QA_FILES} al dir de archivos del tenant. Guarda anti-traversal: `..` se rechaza.
  const c8 = compileTest({ test: { steps: [{ op: "subir_archivo", alias: "documento", ruta: "${QA_FILES}/factura.pdf" }] }, catalog: SAVED_CATALOG });
  const up = c8.flow.find((f) => f.op === "subir_archivo");
  assert.deepStrictEqual(up, { op: "subir_archivo", por: "etiqueta", en: "Documento", ruta: "${QA_FILES}/factura.pdf" });
  assert.ok(STEPS["subir_archivo"], "el motor tiene el paso subir_archivo");
  let setTo = null;
  const fakeUpPage = { getByLabel: () => ({ setInputFiles: async (r) => { setTo = r; } }) };
  const okUp = await STEPS.subir_archivo({ page: fakeUpPage, args: { por: "etiqueta", en: "Documento", ruta: "${QA_FILES}/factura.pdf" }, env: {}, vars: { QA_FILES: "/data/t/files" } });
  assert.strictEqual(okUp.ok, true);
  assert.strictEqual(setTo, "/data/t/files/factura.pdf", "resuelve ${QA_FILES} y sube el archivo real");
  const badUp = await STEPS.subir_archivo({ page: fakeUpPage, args: { por: "etiqueta", en: "Documento", ruta: "${QA_FILES}/../secreto" }, env: {}, vars: { QA_FILES: "/data/t/files" } });
  assert.strictEqual(badUp.ok, false, "una ruta con .. se rechaza (no escapa del dir del tenant)");
  ctx.ok("subir_archivo: compila alias+ruta, resuelve ${QA_FILES} y bloquea path traversal");

  // 7) ETAPA CONDICIONAL (F3): una etapa con guardia se cataloga solo si su texto aparece; si no, se SALTA.
  // getByText(texto).waitFor RECHAZA cuando el texto de la guardia no debería estar presente.
  function makeGuardBrowser(track, guardPresent) {
    let stage = 0;
    const clickLoc = () => ({ count: async () => 1, first() { return this; }, fill: async () => {}, async click() { stage++; }, press: async () => {}, waitFor: async () => {}, isVisible: async () => true, isEnabled: async () => true });
    const textLoc = (t) => ({ first() { return this; }, async waitFor() { if (/Validación/.test(String(t)) && !guardPresent) throw new Error("no visible"); } });
    const page = {
      setDefaultTimeout() {},
      async goto(u) { track.gotos.push(u); return { status: () => 200 }; },
      async evaluate() { return STAGE_NODES[Math.min(stage, STAGE_NODES.length - 1)]; },
      getByLabel: clickLoc, getByRole: clickLoc, locator: clickLoc, getByText: (t) => textLoc(t),
      async title() { return ""; },
    };
    return { async newPage() { return page; }, async close() {} };
  }
  const GUARD_STAGES = [
    { name: "Consulta RUNT", advance: [{ op: "clic", alias: "consultar_runt" }] },
    { name: "Validación identidad", guardText: "Validación de identidad", advance: [{ op: "clic", alias: "continuar" }] },
    { name: "Organismo de Tránsito" },
  ];
  const common = { name: "Matrícula Inicial", baseUrl: "https://app.test", auth: { mode: "none" }, entry: "/mi", stages: GUARD_STAGES, catalog: SAVED_CATALOG, timeout: 500 };
  const gYes = await walkRecorrido({ ...common, launchBrowser: async () => makeGuardBrowser({ gotos: [] }, true) });
  assert.strictEqual(gYes.cataloged, 3, "guardia presente → la etapa condicional se cataloga");
  assert.strictEqual(gYes.skipped.length, 0);
  const gNo = await walkRecorrido({ ...common, launchBrowser: async () => makeGuardBrowser({ gotos: [] }, false) });
  assert.strictEqual(gNo.cataloged, 2, "guardia ausente → la etapa condicional se salta");
  assert.deepStrictEqual(gNo.skipped, ["Validación identidad"]);
  assert.ok(!gNo.pages.some((p) => /Validación/.test(p.name)), "la etapa saltada no queda en el catálogo");
  ctx.ok("walkRecorrido (condicional): cataloga la etapa si su guardia aparece; si no, la salta");
}

export default { run };
