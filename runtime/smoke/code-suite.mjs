// runtime/smoke/code-suite.mjs — modo aditivo "QA del código" (capas static/unit/api/db/security).
// Verifica OFFLINE (exec inyectable, sin lanzar procesos ni red): (1) sandbox de exec (allowlist +
// timeout); (2) confinamiento de la ruta local + gate CODE_QA_BASE_DIR; (3) detección de capas;
// (4) runner de capa mapea exit→estado y extrae TC; (5) runCodeCycle de punta a punta con tracker
// local; (6) filtro de capas pedidas. No toca la espina E2E.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeSandboxedExec, commandName } from "../source/exec-sandbox.mjs";
import { resolveLocalSource } from "../source/local-source.mjs";
import { detectRepo } from "../detect/qa-detect.mjs";
import { runUnitTests } from "../runners/unit.mjs";
import { parseDotnet } from "../runners/parse-cases.mjs";
import { runCodeCycle } from "../orchestrator/code-cycle.mjs";
import { explainFailure, explainLayerFailure } from "../evidence/failure-explain.mjs";
import { culpritRef, attributeFailures } from "../source/git-blame.mjs";

// Crea un repo de juguete (Node con eslint + vitest) dentro de un directorio base efímero.
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "qa-code-base-"));
  const repo = path.join(base, "myrepo");
  fs.mkdirSync(repo);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "myrepo", devDependencies: { eslint: "^9", vitest: "^2" } }),
    "utf8"
  );
  return { base, repo };
}

export async function run(ctx) {
  const { ok } = ctx;
  const { base, repo } = makeFixture();

  try {
    // (1) exec-sandbox: allowlist deja pasar la herramienta conocida al base; bloquea el resto.
    let baseCalls = 0;
    const fakeBase = (cmd, args, o) => { baseCalls++; return { code: 0, stdout: "", stderr: "", spawnError: null, _timeout: o?.timeout }; };
    const sbx = makeSandboxedExec({ base: fakeBase, timeoutMs: 12345, env: {} });
    assert.strictEqual(commandName("C:/repo/node_modules/.bin/vitest.cmd"), "vitest", "nombre lógico ignora ruta y extensión .cmd");
    const okRun = sbx("vitest", ["run"], {});
    assert.strictEqual(okRun.code, 0);
    assert.strictEqual(okRun._timeout, 12345, "el sandbox inyecta el timeout por comando");
    assert.strictEqual(baseCalls, 1, "la herramienta permitida se ejecuta");
    const blocked = sbx("curl", ["http://evil"], {});
    assert.strictEqual(blocked.code, 127, "comando fuera de la allowlist → 127 (se omite, no rompe)");
    assert.ok(/allowlist/.test(blocked.stderr));
    assert.strictEqual(baseCalls, 1, "el comando bloqueado NUNCA llega al ejecutor real");
    ok("QA de código: sandbox de exec (allowlist deja pasar vitest con timeout; bloquea curl sin ejecutarlo)");

    // (2) local-source: base OPT-IN. Sin base → ruta directa (acepta la carpeta real tecleada);
    // con base → confinamiento (acepta subdir, rechaza traversal).
    const direct = resolveLocalSource({ sourcePath: repo, baseDir: "", env: {} });
    assert.strictEqual(direct.ok, true, "sin base → ruta directa (como el antiguo)");
    assert.strictEqual(direct.confined, false, "sin base → no confinada");
    assert.strictEqual(direct.repoRoot, fs.realpathSync(repo), "resuelve la ruta directa tecleada");
    const missing = resolveLocalSource({ sourcePath: path.join(base, "no-existe"), baseDir: "", env: {} });
    assert.strictEqual(missing.ok, false, "ruta directa inexistente → error claro");
    const inside = resolveLocalSource({ sourcePath: "myrepo", baseDir: base, env: {} });
    assert.strictEqual(inside.ok, true);
    assert.strictEqual(inside.confined, true, "con base → confinada");
    assert.strictEqual(inside.repoRoot, fs.realpathSync(repo), "resuelve la ruta real del repo dentro de la base");
    const traversal = resolveLocalSource({ sourcePath: path.join("..", ".."), baseDir: base, env: {} });
    assert.strictEqual(traversal.ok, false, "../.. escapa de la base → rechazado (confinamiento)");
    ok("QA de código: ruta local base OPT-IN (sin base=directa; con base=confinada + rechazo de traversal)");

    // (3) detectRepo: enciende static (eslint) y unit (vitest); security es zero-config.
    const det = detectRepo({ repoRoot: repo });
    assert.strictEqual(det.layers.static.enabled, true);
    assert.strictEqual(det.layers.static.tool, "eslint");
    assert.strictEqual(det.layers.unit.enabled, true);
    assert.strictEqual(det.layers.unit.tool, "vitest");
    assert.strictEqual(det.layers.security.enabled, true, "security corre zero-config en cualquier repo con código");
    assert.strictEqual(det.layers.api.enabled, false, "sin contrato API → api apagada");
    ok("QA de código: detección de capas (static=eslint, unit=vitest, security zero-config; api/db apagadas)");

    // (4) runner de capa: mapea exit→estado y extrae TC del reporter JSON (parseJestLike).
    const vitestJson = JSON.stringify({
      testResults: [{ assertionResults: [
        { title: "suma", status: "passed", duration: 3, ancestorTitles: ["calc"] },
        { title: "resta", status: "failed", duration: 5, ancestorTitles: ["calc"], failureMessages: ["esperaba 2"] },
      ] }],
    });
    const unitEv = runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 1, stdout: vitestJson, stderr: "" }) });
    assert.strictEqual(unitEv.length, 1);
    assert.strictEqual(unitEv[0].layer, "unit");
    assert.strictEqual(unitEv[0].status, "fail", "exit 1 → fail");
    assert.strictEqual(unitEv[0].cases.length, 2, "extrae los 2 TC del JSON de vitest");
    assert.strictEqual(unitEv[0].cases.find((c) => c.name.includes("resta")).status, "fail");
    ok("QA de código: runner de capa (unit) mapea exit→estado y extrae los TC del reporter JSON");

    // (4b) veredicto por CASOS: si un TC está en rojo, la capa FALLA aunque la herramienta salga 0
    // (algunos setups de vitest/jest no propagan el exit). Antes esto marcaba "pass" — bug corregido.
    const vitest0Fail = JSON.stringify({
      testResults: [{ assertionResults: [
        { title: "ok", status: "passed", ancestorTitles: ["s"] },
        { title: "roto", status: "failed", ancestorTitles: ["s"], failureMessages: ["boom"] },
      ] }],
    });
    const ev0 = runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 0, stdout: vitest0Fail, stderr: "" }) });
    assert.strictEqual(ev0[0].status, "fail", "exit 0 con un TC en rojo → la capa FALLA, no 'pass'");
    ok("QA de código: veredicto por casos (un TC en rojo hace fallar la capa aunque el exit sea 0)");

    // (4c) suite que NO carga (import roto/no compila): vitest sale ≠0 pero las aserciones que
    // corrieron pasan. El parser surfacea el archivo caído como caso fallido → deja de ser invisible.
    const suiteFail = JSON.stringify({
      testResults: [
        { status: "passed", assertionResults: [{ title: "ok", status: "passed", ancestorTitles: ["A"] }] },
        { status: "failed", name: "src/roto.test.ts", message: "Cannot find module './missing'", assertionResults: [] },
      ],
    });
    const evSuite = runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 1, stdout: suiteFail, stderr: "" }) });
    assert.strictEqual(evSuite[0].status, "fail");
    const failed = evSuite[0].cases.filter((c) => c.status === "fail");
    assert.strictEqual(failed.length, 1, "el archivo/suite que no cargó aparece como 1 caso fallido");
    assert.ok(failed[0].name.includes("roto.test.ts") && /Cannot find module/.test(failed[0].message), "surface el archivo + su error");
    assert.ok(evSuite[0].cases.some((c) => c.status === "pass"), "las aserciones que sí corrieron siguen visibles");
    ok("QA de código: una suite que no carga (import roto) se surface como caso fallido, no queda invisible");

    // (5) runCodeCycle end-to-end con tracker LOCAL + exec fake → reporte + capas corridas.
    const passExec = () => ({ code: 0, stdout: "", stderr: "" });
    const cycle = await runCodeCycle({ sourcePath: "myrepo", baseDir: base, env: {}, workItemId: "local", exec: passExec });
    assert.strictEqual(cycle.ok, true);
    assert.strictEqual(cycle.tracker, "local");
    assert.deepStrictEqual(cycle.layersRun, ["static", "unit", "security"], "corre las capas detectadas en alcance");
    assert.ok(cycle.results.every((r) => r.status === "pass"), "exit 0 en todas → pass");
    assert.ok(fs.existsSync(cycle.report.htmlPath), "el sink local escribe el reporte html");
    assert.ok(cycle.warnings.some((w) => /api|db/.test(w)), "avisa las capas no detectadas (api/db)");
    ok("QA de código: runCodeCycle de punta a punta (fuente confinada → detección → capas → sink local)");

    // (5b) humanizador de fallos: traduce el mensaje técnico a lenguaje llano (qué pasó / qué hacer).
    // Determinista; patrón no reconocido → null (la superficie muestra el crudo).
    const impEx = explainFailure(
      { name: "biometric-step.test.tsx › (la suite no se ejecutó / error al cargar)", message: 'Failed to resolve import "qrcode.react" from "BiometricStep.tsx".' },
      { layer: "unit", tool: "vitest" },
    );
    assert.strictEqual(impEx?.category, "missing-import", "reconoce el import faltante");
    assert.ok(/qrcode\.react/.test(impEx.plain) && /instalar/i.test(impEx.action), "nombra la dependencia y qué hacer");
    const domEx = explainFailure(
      { name: "Usuarios › bloquear usuario", message: 'TestingLibraryElementError: Unable to find an accessible element with the role "button" and name `/bloquear usuario ana torres/i`' },
      { layer: "unit", tool: "vitest" },
    );
    assert.strictEqual(domEx?.category, "element-not-found", "reconoce el elemento no encontrado");
    const secEx = explainFailure(
      { name: "B608 seed.py:140", message: "[MEDIUM] Possible SQL injection vector through string-based query construction." },
      { layer: "security", tool: "bandit" },
    );
    assert.strictEqual(secEx?.category, "security-sqli", "reconoce la inyección SQL de seguridad");
    assert.strictEqual(explainFailure({ name: "algo raro", message: "error no clasificado xyz" }, { layer: "unit" }), null, "patrón desconocido → null (muestra el crudo)");
    ok("QA de código: humanizador de fallos (import faltante, elemento no hallado, SQLi; desconocido → null)");

    // (4d) parser de dotnet test (salida de consola): errores de compilación + pruebas fallidas,
    // cada uno con su archivo:línea real (antes dotnet quedaba "caseless" y sin detalle atribuible).
    const dotnetCompile = "Determinando los proyectos que se van a restaurar...\nC:\\proj\\src\\Foo.cs(12,34): error CS1002: ; expected [C:\\proj\\src\\Foo.csproj]\nBuild FAILED.";
    const evC = parseDotnet({ code: 1, stdout: dotnetCompile, stderr: "" }, { repoRoot: "C:\\proj" });
    assert.ok(evC && evC.length === 1, "extrae el error de compilación como 1 caso");
    assert.ok(/Foo\.cs:12/.test(evC[0].name) && /CS1002/.test(evC[0].name), "el caso trae archivo:línea + código CS");
    const dotnetFail = [
      "Passed! algo",
      "  Failed Flit.Admin.Tests.UserServiceTests.Crea_Throws [15 ms]",
      "  Error Message:",
      "   System.NullReferenceException : Object reference not set.",
      "  Stack Trace:",
      "     at Flit.Admin.UserService.Crea() in C:\\proj\\src\\UserService.cs:line 30",
      "Failed!  - Failed:     1, Passed:   120, Skipped:     0, Total:   121",
    ].join("\n");
    const evF = parseDotnet({ code: 1, stdout: dotnetFail, stderr: "" }, { repoRoot: "C:\\proj" });
    assert.ok(evF && evF.length === 1, "extrae la prueba fallida (sin confundir 'Failed!' del resumen)");
    assert.ok(/UserServiceTests\.Crea_Throws/.test(evF[0].name), "nombre del test fallido");
    assert.ok(/UserService\.cs:30/.test(evF[0].message), "normaliza el archivo:línea del stack para atribución");
    assert.strictEqual(parseDotnet({ code: 0, stdout: "Passed!  - Failed: 0, Passed: 121", stderr: "" }), null, "todo verde → null (sin casos)");
    // vía runner: exit 1 + salida dotnet → capa unit con casos reales (ya no caseless).
    fs.writeFileSync(path.join(repo, "Foo.Tests.csproj"), "<Project></Project>", "utf8"); // destino localizable
    const det2 = { layers: { unit: { enabled: true, tool: "dotnet-test", cwd: "", targets: [{ tool: "dotnet-test", cwd: "" }] } } };
    const evRun = runUnitTests({ repoRoot: repo, detection: det2, exec: () => ({ code: 1, stdout: dotnetCompile, stderr: "" }) });
    assert.strictEqual(evRun[0].status, "fail");
    assert.ok(Array.isArray(evRun[0].cases) && evRun[0].cases.length === 1, "el runner de unit cuelga el caso de dotnet (ya no queda mudo)");
    ok("QA de código: parser de dotnet test (compilación + prueba fallida con archivo:línea; runner ya no queda caseless)");

    // (5b') explicación a NIVEL DE CAPA para fallos SIN desglose por caso (dotnet-test/tsc/redocly).
    const caseless = explainLayerFailure({ layer: "unit", status: "fail", narrative: "dotnet-test: exit 1 — Determinando los proyectos…", metrics: { tool: "dotnet-test" } });
    assert.strictEqual(caseless?.category, "layer-caseless", "capa que falla sin casos → explicación genérica de capa");
    assert.ok(/dotnet-test/.test(caseless.plain), "menciona la herramienta");
    assert.strictEqual(explainLayerFailure({ layer: "api", status: "pass" }), null, "capa que NO falla → null");
    // si la narrativa trae un patrón conocido, lo reconoce en vez del genérico.
    const caselessImp = explainLayerFailure({ layer: "unit", status: "fail", narrative: 'Cannot find module "foo"', metrics: { tool: "vitest" } });
    assert.strictEqual(caselessImp.category, "missing-import", "capa caseless con patrón conocido usa el humanizador específico");
    ok("QA de código: explicación a nivel de capa para fallos sin desglose (caseless) + reconoce patrón en la narrativa");

    // (5c) atribución a desarrollador (git blame) — git INYECTADO (offline, sin repo ni procesos).
    // culpritRef extrae el archivo:línea del error; attributeFailures cuelga tc.blame por caso fallido.
    assert.strictEqual(culpritRef({ name: "x", message: 'Failed to resolve import "qrcode.react" from "components/BiometricStep.tsx".' }).file, "components/BiometricStep.tsx", "extrae el archivo fuente del import roto");
    const semRef = culpritRef({ name: "unsafe-formatstring @ lib\\telemetry.ts:158", message: "Detected string concatenation" });
    assert.deepStrictEqual(semRef, { file: "lib/telemetry.ts", line: 158 }, "extrae archivo:línea del nombre (semgrep)");
    assert.strictEqual(culpritRef({ name: "algo", message: "boom sin archivo" }), null, "sin archivo → null");
    // git falso: rev-parse=true, ls-files resuelve el path, blame -L devuelve porcelain con autor.
    const calls = [];
    const fakeGit = (root, args) => {
      calls.push(args[0]);
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "ls-files") return { code: 0, stdout: "frontend/lib/telemetry.ts\n", stderr: "" };
      if (args[0] === "blame") return { code: 0, stdout: "abc123 158 158\nauthor Laura García\nauthor-mail <laura@flit.io>\nauthor-time 1751500000\n\tcode();\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "" };
    };
    const secResults = [{ layer: "security", metrics: { cwd: "frontend", tool: "semgrep" }, cases: [
      { name: "unsafe-formatstring @ lib/telemetry.ts:158", status: "fail", message: "Detected string concatenation" },
      { name: "ok", status: "pass" },
    ] }];
    const attr = attributeFailures("/repo", secResults, { git: fakeGit });
    assert.strictEqual(attr.gitRepo, true);
    assert.strictEqual(attr.attributed, 1, "atribuye el único caso fallido");
    const blame = secResults[0].cases[0].blame;
    assert.strictEqual(blame.author, "Laura García", "captura el autor de la línea");
    assert.strictEqual(blame.line, 158);
    assert.ok(!secResults[0].cases[1].blame, "no toca los casos que pasaron");
    assert.strictEqual(attributeFailures("/repo", secResults, { git: () => ({ code: 1, stdout: "", stderr: "" }) }).gitRepo, false, "repo no-git → no atribuye (best-effort)");
    ok("QA de código: atribución por git blame (extrae archivo:línea, resuelve path y cuelga el autor; no-git → se omite)");

    // (6) filtro de capas pedidas: solo se corre el subconjunto solicitado.
    const onlyUnit = await runCodeCycle({ sourcePath: "myrepo", baseDir: base, env: {}, layers: ["unit"], exec: passExec });
    assert.deepStrictEqual(onlyUnit.layersRun, ["unit"], "layers=['unit'] corre solo unit");
    assert.ok(onlyUnit.results.every((r) => r.layer === "unit"), "ninguna otra capa se ejecutó");
    ok("QA de código: runCodeCycle respeta el subconjunto de capas pedido (solo unit)");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
