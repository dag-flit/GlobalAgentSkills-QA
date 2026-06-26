// runtime/smoke/orchestrator.mjs — novedades, guarda online, explore, trazabilidad por-HU, retry.
// Casos 24 (novedad+reactivación), 25 (guarda sin -w), 26 (runner explore), 27 (trazabilidad
// por-HU), 28 (transporte HTTP con reintento).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { deepMerge } from "../profile/resolve-profile.mjs";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { runQaCycle } from "../orchestrator.mjs";
import { runExplore } from "../runners/explore.mjs";
import { defaultHttp as retryHttp, isTransientNetworkError } from "../../adapters/_shared/http-retry.mjs";

export async function run(ctx) {
  const { ok, creds, pFlit, pDefault, makeFakeAdo } = ctx;

  // 24. Novedad → Bug enlazado a la HU + reactivación de la HU + trazabilidad en su comentario.
  // 24a. reactivateRequirement (ADO, unit): PATCH estado a "Active" + comentario con enlace al Bug.
  const repoNov = fs.mkdtempSync(path.join(os.tmpdir(), "qa-nov-"));
  const fakeNov = makeFakeAdo([
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 77 } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
  ]);
  const adoNov = getAdapter({ profile: pFlit, env: creds, repoRoot: repoNov, http: fakeNov.http });
  const react = await adoNov.reactivateRequirement("123", {
    bugId: "999",
    items: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto", metrics: { tool: "playwright" } }],
  });
  assert.strictEqual(react.ok, true);
  assert.strictEqual(react.state, "Active");                       // on_defect_reactivate_state del preset
  const reactPatch = JSON.parse(fakeNov.find("PATCH", "/wit/workitems/123").body);
  assert.ok(reactPatch.some((o) => o.path === "/fields/System.State" && o.value === "Active"));
  const reactComment = JSON.parse(fakeNov.find("POST", "/workItems/123/comments").body);
  assert.ok(/Novedad QA/.test(reactComment.text));
  assert.ok(/_workitems\/edit\/999/.test(reactComment.text));      // enlace de trazabilidad al Bug
  assert.ok(/login roto/.test(reactComment.text));                 // hallazgo listado en la HU

  // 24b. ciclo completo (runQaCycle, ADO offline): una falla dispara createDefect + reactivación.
  fs.writeFileSync(path.join(repoNov, "package.json"), JSON.stringify({ name: "nov", devDependencies: { vitest: "1" } }));
  fs.writeFileSync(path.join(repoNov, "vitest.config.ts"), "export default {}");
  const pNov = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });   // acota la corrida a unit
  const fakeCycle = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 1 } })],
    [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 999 } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
  ]);
  const novCycle = await runQaCycle({
    repoRoot: repoNov, env: creds, profile: pNov, workItemId: "123", http: fakeCycle.http,
    exec: () => ({ code: 1, stdout: "1 failed", stderr: "" }),
  });
  assert.ok(Array.isArray(novCycle.novelties) && novCycle.novelties.length === 1);
  assert.strictEqual(novCycle.novelties[0].work_item_id, "123");
  assert.strictEqual(novCycle.novelties[0].bugId, "999");
  assert.strictEqual(novCycle.novelties[0].reactivation.state, "Active");
  const bugPayload = JSON.parse(fakeCycle.find("POST", "/wit/workitems/$Bug").body);
  assert.ok(bugPayload.some((o) => o.path === "/relations/-"));    // Bug enlazado a la HU padre
  fs.rmSync(repoNov, { recursive: true, force: true });
  ok("novedad: crea Bug enlazado a la HU, la reactiva (Active) y deja trazabilidad en su comentario");

  // 25. Guarda online: tracker remoto SIN -w (workItemId="local") NO comenta sobre una HU
  // inexistente (evitaría un 404 online); degrada a solo reporte local + aviso.
  const repoGuard = fs.mkdtempSync(path.join(os.tmpdir(), "qa-guard-"));
  fs.writeFileSync(path.join(repoGuard, "package.json"), JSON.stringify({ name: "g", devDependencies: { vitest: "1" } }));
  fs.writeFileSync(path.join(repoGuard, "vitest.config.ts"), "export default {}");
  const pGuard = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });
  const fakeGuard = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
  ]);
  const guardCycle = await runQaCycle({
    repoRoot: repoGuard, env: creds, profile: pGuard, http: fakeGuard.http,   // SIN workItemId → "local"
    exec: () => ({ code: 1, stdout: "1 failed", stderr: "" }),
  });
  assert.ok(Array.isArray(guardCycle.warnings) && guardCycle.warnings.some((w) => /-w/.test(w)));
  assert.ok(!fakeGuard.calls.some((c) => c.method === "POST" && /\/comments/.test(c.url)));   // NO comentó en la HU
  assert.ok(!fakeGuard.calls.some((c) => /\$Bug/.test(c.url)));                                // NO creó Bug (sin HU real)
  assert.ok(guardCycle.report && guardCycle.report.local && fs.existsSync(guardCycle.report.local.mdPath)); // sí dejó reporte local
  fs.rmSync(repoGuard, { recursive: true, force: true });
  ok("guarda online: tracker remoto sin -w no comenta sobre HU inexistente; degrada a reporte local + aviso");

  // 26. Runner `explore` (capa de exploración de URL viva): gated por appUrl, launcher de
  // navegador INYECTABLE (offline), emite evidencia normalizada; el ciclo lo incluye con appUrl.
  // 26a. launcher falso: una URL ok (200) y una "mala" (500) → un EvidenceObject con 2 casos.
  const fakeLaunch = () => ({
    async newPage() {
      return {
        on() {},
        async goto(url) {
          return { status: () => (/bad/.test(url) ? 500 : 200) };
        },
        async screenshot() {
          /* no-op: en el fake no se escribe archivo */
        },
        async close() {},
      };
    },
    async close() {},
  });
  const repoExp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-exp-"));
  const expEv = await runExplore({
    repoRoot: repoExp,
    appUrl: "https://app.test/",
    paths: ["https://app.test/bad"],
    launchBrowser: fakeLaunch,
  });
  assert.strictEqual(expEv.length, 1);
  assert.strictEqual(expEv[0].layer, "explore");
  assert.strictEqual(expEv[0].status, "fail"); // una URL "mala" (500) → la capa falla
  assert.strictEqual(expEv[0].cases.length, 2);
  assert.strictEqual(expEv[0].cases[0].status, "pass"); // 200
  assert.strictEqual(expEv[0].cases[1].status, "fail"); // 500
  assert.ok(/HTTP 500/.test(expEv[0].cases[1].message));
  // 26b. gating: sin appUrl → no participa (capa ausente)
  assert.deepStrictEqual(await runExplore({ appUrl: "" }), []);
  // 26c. sin launcher y sin Playwright instalado en el kit → skip accionable (no rompe)
  const expSkip = await runExplore({ repoRoot: repoExp, appUrl: "https://x/" });
  assert.strictEqual(expSkip[0].status, "skip");
  assert.ok(/Playwright/.test(expSkip[0].narrative));
  // 26d. ciclo completo (local) con appUrl + launcher falso → la capa explore entra al reporte
  const expCycle = await runQaCycle({
    repoRoot: repoExp,
    profile: pDefault, // local, sin red
    appUrl: "https://app.test/",
    explore: true, // pide explícitamente el crawler (appUrl por sí solo solo da baseURL)
    launchBrowser: fakeLaunch,
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  });
  assert.ok(expCycle.results.some((r) => r.layer === "explore" && r.status === "pass"));
  fs.rmSync(repoExp, { recursive: true, force: true });
  ok("runner explore: gated por URL, launcher inyectable (offline), skip sin Playwright; el ciclo incluye la capa");

  // 27. Trazabilidad por-HU: una corrida cuyo Feature paraguas es 100, pero cuyas pruebas
  // declaran su HU dueña con la etiqueta [HU-###], registra el Bug en ESA HU (103/104), NO en 100.
  // Lo no etiquetado caería al Feature (aquí todas las fallas van etiquetadas).
  const repoHu = fs.mkdtempSync(path.join(os.tmpdir(), "qa-hu-"));
  fs.writeFileSync(path.join(repoHu, "package.json"), JSON.stringify({ name: "hu", devDependencies: { vitest: "1" } }));
  fs.writeFileSync(path.join(repoHu, "vitest.config.ts"), "export default {}");
  const pHu = deepMerge(pFlit, { testing: { layers_enabled: ["unit"] } });
  const huVitestJson = JSON.stringify({
    testResults: [{
      assertionResults: [
        { ancestorTitles: ["[HU-103] Checkout"], title: "flujo completo falla", status: "failed", duration: 10, failureMessages: ["AssertionError: boom 103"] },
        { ancestorTitles: ["[HU-104] Pago"], title: "tarjeta rechazada falla", status: "failed", duration: 12, failureMessages: ["AssertionError: boom 104"] },
        { ancestorTitles: ["[HU-103] Checkout"], title: "caso ok", status: "passed", duration: 5, failureMessages: [] },
      ],
    }],
  });
  const fakeHu = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 900 } })],
    [(r) => r.method === "PATCH" && /\/wit\/workitems\/\d+/.test(r.url), () => ({ status: 200, json: { id: 1 } })],
    [(r) => r.method === "POST" && /\/workItems\/\d+\/comments/.test(r.url), () => ({ status: 201, json: { id: 1 } })],
  ]);
  const huCycle = await runQaCycle({
    repoRoot: repoHu, env: creds, profile: pHu, workItemId: "100", http: fakeHu.http,   // Feature paraguas = 100
    exec: () => ({ code: 1, stdout: huVitestJson, stderr: "" }),
  });
  const huIds = (huCycle.novelties || []).map((n) => String(n.work_item_id)).sort();
  assert.deepStrictEqual(huIds, ["103", "104"]);                       // Bugs en las HUs etiquetadas…
  assert.ok(!huIds.includes("100"));                                   // …NO en el Feature paraguas
  assert.ok(huCycle.novelties.every((n) => n.bugId === 900 || n.bugId === "900")); // se creó Bug por HU
  // el Bug de la HU 103 enlaza a la 103 como padre (no a 100)
  const bug103 = fakeHu.calls.find((c) => c.method === "POST" && /\$Bug/.test(c.url) && /103/.test(c.body));
  assert.ok(bug103, "el Bug debe enlazar a la HU 103 como padre");
  fs.rmSync(repoHu, { recursive: true, force: true });
  ok("trazabilidad por-HU: la etiqueta [HU-###] registra el Bug en esa HU, no en el Feature paraguas");

  // 28. Transporte HTTP con reintento ante fallos de RED transitorios (socket keep-alive
  // obsoleto → "fetch failed"/ECONNRESET). Reintenta y se recupera; NO reintenta errores
  // no-transitorios; NUNCA reintenta por status HTTP (un 500 es respuesta válida).
  {
    // a) clasificación de errores
    const econnreset = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET", message: "read ECONNRESET" } });
    assert.ok(isTransientNetworkError(econnreset), "ECONNRESET es transitorio");
    assert.ok(isTransientNetworkError(new Error("fetch failed")), "'fetch failed' es transitorio");
    assert.ok(!isTransientNetworkError(new TypeError("Invalid URL")), "Invalid URL NO es transitorio");

    const realFetch = globalThis.fetch;
    try {
      // b) falla transitoria en el 1er intento → se recupera en el 2º
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) throw econnreset;
        return { status: 200, text: async () => '{"ok":true}' };
      };
      const r = await retryHttp({ url: "https://x/y", method: "POST", body: "{}" }, { baseDelayMs: 1 });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json, { ok: true });
      assert.strictEqual(calls, 2, "debe reintentar exactamente una vez tras el fallo transitorio");

      // c) error NO transitorio → no reintenta (un solo intento) y propaga
      let calls2 = 0;
      globalThis.fetch = async () => { calls2++; throw new TypeError("Invalid URL"); };
      await assert.rejects(() => retryHttp({ url: "bad", method: "GET" }, { baseDelayMs: 1 }), /Invalid URL/);
      assert.strictEqual(calls2, 1, "un error no-transitorio no se reintenta");

      // d) status HTTP de error (500) NO se reintenta: es una respuesta válida
      let calls3 = 0;
      globalThis.fetch = async () => { calls3++; return { status: 500, text: async () => "boom" }; };
      const r5 = await retryHttp({ url: "https://x", method: "GET" }, { baseDelayMs: 1 });
      assert.strictEqual(r5.status, 500);
      assert.strictEqual(calls3, 1, "un 500 no se reintenta");
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  ok("transporte HTTP: reintenta fallos de red transitorios (ECONNRESET/fetch failed), no el resto");
}
