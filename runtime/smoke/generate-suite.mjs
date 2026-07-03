// runtime/smoke/generate-suite.mjs — generador DETERMINISTA de guion desde los AC (Gherkin→pasos),
// sin IA. Verifica: (1) el mapeo Gherkin → pasos válidos del registro, (2) la clasificación
// E2E-able (backend/migración → no-E2E), y (3) que el guion GENERADO corre de punta a punta en el
// runner (todas las ops son válidas) auto-etiquetando el `ac` para la cobertura. Todo offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { runExplore } from "../runners/explore.mjs";
import { generateFlowFromAc, classifyE2eable } from "../generate/ac-to-flow.mjs";

// launcher falso (offline): getByLabel/getByRole/getByText devuelven un Locator que "pasa".
const genLaunch = () => ({
  async newPage() {
    const loc = {
      async fill() {},
      async click() {},
      async press() {},
      first() { return { async isVisible() { return true; }, async waitFor() {} }; },
      async isVisible() { return true; },
      async count() { return 1; },
    };
    return {
      on() {},
      async goto() { return { status: () => 200 }; },
      getByLabel() { return loc; },
      getByRole() { return loc; },
      getByText() { return loc; },
      async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
      async close() {},
    };
  },
  async close() {},
});

export async function run(ctx) {
  const { ok } = ctx;

  const acs = [
    {
      title: "AC1 Login",
      detail:
        'Dado que estoy en la página de login\n' +
        'Cuando ingreso mi usuario y contraseña\n' +
        'Y presiono el botón "Iniciar Sesión"\n' +
        'Entonces veo el mensaje "Bienvenido"',
    },
  ];

  const gen = generateFlowFromAc({ acs, appUrl: "https://app.test/login", title: "[FRONTEND] login" });
  assert.strictEqual(gen.e2eable, true);
  assert.deepStrictEqual(gen.flow[0], { op: "ir_a", url: "https://app.test/login" });
  assert.deepStrictEqual(gen.flow[1], { op: "escribir", por: "etiqueta", en: "Usuario", valor: "${QA_USER}" });
  assert.deepStrictEqual(gen.flow[2], { op: "escribir", por: "etiqueta", en: "Contraseña", valor: "${QA_PASS}" });
  assert.deepStrictEqual(gen.flow[3], { op: "clic", por: "boton", en: "Iniciar Sesión" });
  assert.deepStrictEqual(gen.flow[4], { op: "verificar_texto", texto: "Bienvenido", ac: "AC1 Login" });

  // clasificación: una HU backend/migración NO es probable por navegador → no-E2E.
  assert.strictEqual(classifyE2eable("[BACKEND] Migración tablas invitaciones", acs).e2eable, false);

  // el guion GENERADO corre de punta a punta (todas las ops son válidas) y cada paso deja su caso.
  const repoGen = fs.mkdtempSync(path.join(os.tmpdir(), "qa-gen-"));
  const genEv = await runExplore({ repoRoot: repoGen, env: { QA_USER: "ana", QA_PASS: "s3cr3t" }, flow: gen.flow, tcId: "HU-1", launchBrowser: genLaunch });
  assert.strictEqual(genEv[0].status, "pass");
  assert.strictEqual(genEv[0].cases.length, gen.flow.length);
  fs.rmSync(repoGen, { recursive: true, force: true });

  ok("generador AC→guion: Gherkin → pasos válidos (login), clasifica backend como no-E2E, y el guion generado corre en el runner");

  // Login automático: con login=true el generador antepone {op:"login"} tras el ir_a; el runner lo
  // ejecuta de forma heurística (usuario + clave + enviar). Las credenciales llegan por ${QA_*}.
  const genL = generateFlowFromAc({ acs, appUrl: "https://app.test/login", title: "[FRONTEND] login", login: true });
  assert.deepStrictEqual(genL.flow[0], { op: "ir_a", url: "https://app.test/login" });
  assert.deepStrictEqual(genL.flow[1], { op: "login" });

  const rec = { fills: [], clicks: 0 };
  const loginLaunch = () => ({
    async newPage() {
      const loc = {
        async fill(v) { rec.fills.push(v); },
        async click() { rec.clicks++; },
        async press() {},
        first() { return loc; },
        async count() { return 1; },
        async isVisible() { return true; },
        async waitFor() {},
      };
      return {
        on() {},
        async goto() { return { status: () => 200 }; },
        getByLabel() { return loc; },
        getByRole() { return loc; },
        getByText() { return loc; },
        locator() { return loc; },
        async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
        async close() {},
      };
    },
    async close() {},
  });
  const repoL = fs.mkdtempSync(path.join(os.tmpdir(), "qa-login-"));
  const evL = await runExplore({ repoRoot: repoL, env: { QA_USER: "ana", QA_PASS: "s3cr3t" }, flow: genL.flow, tcId: "HU-2", launchBrowser: loginLaunch });
  assert.strictEqual(evL[0].status, "pass");
  assert.ok(rec.fills.includes("ana") && rec.fills.includes("s3cr3t"), "el login debe llenar usuario y clave");
  assert.ok(rec.clicks >= 1, "el login debe enviar el formulario");
  fs.rmSync(repoL, { recursive: true, force: true });
  ok("login automático: el generador antepone {op:login} y el runner inicia sesión (usuario+clave+enviar, heurístico y genérico)");
}
