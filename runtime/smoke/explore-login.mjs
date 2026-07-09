// runtime/smoke/explore-login.mjs — caso del "login automático": cuando la corrida trae URL +
// credenciales (QA_USER/QA_PASS) pero NINGÚN guion, el motor sintetiza un guion mínimo de login
// (ir_a → login) y captura por paso (pantalla de login + estado post-login). Sin credenciales,
// sigue el URL-smoke. Offline: launcher de navegador falso. Extraído de explore-suite para no
// pasar el presupuesto de 400 líneas del motor.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { runExplore } from "../runners/explore.mjs";

export async function runLoginSynthesis(ok) {
  const repoLogin = fs.mkdtempSync(path.join(os.tmpdir(), "qa-login-"));
  // Página falsa con formulario de login: todo localizador existe (count>0) y first() da un
  // handle con fill/click/waitFor. No expone waitForLoadState → settleSpa se omite (offline).
  const loginLaunch = () => ({
    async newPage() {
      const inner = { async fill() {}, async click() {}, async press() {}, async waitFor() {}, async isVisible() { return true; } };
      const mkLoc = () => ({ async count() { return 1; }, first() { return inner; } });
      return {
        on() {},
        async goto() { return { status: () => 200 }; },
        getByLabel() { return mkLoc(); },
        getByRole() { return mkLoc(); },
        getByPlaceholder() { return mkLoc(); },
        getByText() { return { async count() { return 0; }, first() { return inner; } }; },
        locator() { return mkLoc(); },
        async screenshot({ path: p }) { fs.writeFileSync(p, "PNG"); },
        async close() {},
      };
    },
    async close() {},
  });
  // Con QA_USER/QA_PASS y sin flow: se sintetiza [ir_a → login]; dos pasos, dos capturas.
  const loginEv = await runExplore({ repoRoot: repoLogin, appUrl: "https://app.test/", vars: { QA_USER: "ana", QA_PASS: "s3cr3t" }, launchBrowser: loginLaunch });
  assert.strictEqual(loginEv.length, 1);
  assert.strictEqual(loginEv[0].status, "pass");
  assert.strictEqual(loginEv[0].metrics.steps, 2); // guion sintetizado: ir_a + login (no URL-smoke)
  assert.strictEqual(loginEv[0].cases.length, 2);
  assert.ok(/ir_a/.test(loginEv[0].cases[0].name));
  assert.ok(/login/.test(loginEv[0].cases[1].name));
  assert.strictEqual(loginEv[0].files.length, 2); // captura por paso: login + post-login
  // Sin credenciales → NO sintetiza login: sigue el URL-smoke (una URL, sin `steps`).
  const smokeEv = await runExplore({ repoRoot: repoLogin, appUrl: "https://app.test/", launchBrowser: loginLaunch });
  assert.strictEqual(smokeEv[0].metrics.urls, 1);
  assert.ok(!smokeEv[0].metrics.steps);
  fs.rmSync(repoLogin, { recursive: true, force: true });
  ok("URL + credenciales sin guion: sintetiza login (ir_a → login) con captura por paso; sin credenciales → URL-smoke");
}
