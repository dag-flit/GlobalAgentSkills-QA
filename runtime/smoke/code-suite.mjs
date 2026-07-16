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
import { runDbTests } from "../runners/db.mjs";
import { runDbProbeCases } from "./db-probe-suite.mjs";
import { explainExecFailure } from "../runners/_runner-core.mjs";
import { parseDotnet } from "../runners/parse-cases.mjs";
import { runCodeCycle } from "../orchestrator/code-cycle.mjs";
import { explainFailure, explainLayerFailure } from "../evidence/failure-explain.mjs";
import { culpritRef, attributeFailures } from "../source/git-blame.mjs";
import { runFindingsCases } from "./findings-suite.mjs";
import { decodeOutput } from "../runners/_runner-core.mjs";
import { validateProjectPath, looksLikeProject } from "../source/validate-project.mjs";
import { buildDbEnv } from "../source/db-env.mjs";
import { AzureDevOpsAdapter } from "../../adapters/trackers/azure-devops/azure-devops-adapter.mjs";

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
    // Las herramientas de SCA (security) deben estar en la allowlist, o el SCA se saltaría en la webapp.
    for (const scaBin of ["npm", "pnpm", "pip-audit", "dotnet"]) {
      assert.ok(sbx(scaBin, ["audit"], {}).code !== 127, `la allowlist del sandbox permite '${scaBin}' (SCA)`);
    }
    ok("QA de código: sandbox de exec (deja pasar vitest+SCA npm/pnpm/pip-audit/dotnet con timeout; bloquea curl)");

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
    const unitEv = await runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 1, stdout: vitestJson, stderr: "" }) });
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
    const ev0 = await runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 0, stdout: vitest0Fail, stderr: "" }) });
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
    const evSuite = await runUnitTests({ repoRoot: repo, detection: det, exec: () => ({ code: 1, stdout: suiteFail, stderr: "" }) });
    assert.strictEqual(evSuite[0].status, "fail");
    const failed = evSuite[0].cases.filter((c) => c.status === "fail");
    assert.strictEqual(failed.length, 1, "el archivo/suite que no cargó aparece como 1 caso fallido");
    assert.ok(failed[0].name.includes("roto.test.ts") && /Cannot find module/.test(failed[0].message), "surface el archivo + su error");
    assert.ok(evSuite[0].cases.some((c) => c.status === "pass"), "las aserciones que sí corrieron siguen visibles");
    ok("QA de código: una suite que no carga (import roto) se surface como caso fallido, no queda invisible");

    // (4e) razón ACCIONABLE ante un fallo de lanzamiento: timeout / maxBuffer / allowlist / ausente
    // se distinguen (antes TODO decía "no instalado / fuera de PATH", ocultando el timeout real de un
    // `dotnet test` en frío). El runner de unit propaga la razón precisa en la narrativa del skip.
    const timedOut = { code: 127, stdout: "", stderr: "", spawnError: { code: "ETIMEDOUT" }, timeout: 600000 };
    assert.ok(/se agot.*tiempo.*600s/i.test(explainExecFailure(timedOut, "dotnet")), "ETIMEDOUT → 'se agotó el tiempo (timeout 600s)', no 'no instalado'");
    assert.ok(/maxBuffer/.test(explainExecFailure({ code: 127, stderr: "", spawnError: { code: "ENOBUFS" } }, "dotnet")), "ENOBUFS → menciona maxBuffer");
    assert.ok(/allowlist/.test(explainExecFailure({ code: 127, stderr: "comando 'curl' fuera de la allowlist", spawnError: null }, "curl")), "127 con stderr de allowlist → esa razón");
    assert.ok(/no instalado/.test(explainExecFailure({ code: 127, stderr: "", spawnError: null }, "zzz-binario-inexistente")), "127 real (binario ausente) → 'no instalado / fuera de PATH'");
    const evTO = await runUnitTests({ repoRoot: repo, detection: det, exec: () => timedOut });
    assert.strictEqual(evTO[0].status, "skip", "timeout → capa omitida (no rompe el ciclo)");
    assert.ok(/se agot.*tiempo/i.test(evTO[0].narrative), "la narrativa del skip lleva la razón real (timeout), no 'no instalado'");
    ok("QA de código: fallo de lanzamiento se explica con precisión (timeout/maxBuffer/allowlist/ausente ya no se confunden)");

    // (4f) capa db con conexión inyectada pero repo solo con migrations/: el skip ACLARA que la
    // conexión alimenta las pruebas de integración (capa unit), no una capa db aparte.
    fs.mkdirSync(path.join(repo, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(repo, "migrations", "0001_init.sql"), "CREATE TABLE t();", "utf8");
    const detDb = detectRepo({ repoRoot: repo });
    assert.strictEqual(detDb.layers.db.enabled, true, "migrations/ enciende la capa db (tool=migrations)");
    const dbNoConn = await runDbTests({ repoRoot: repo, detection: detDb, exec: () => ({ code: 0, stdout: "", stderr: "" }), env: {} });
    assert.ok(/sin runner db standalone/.test(dbNoConn[0].narrative), "sin conexión → mensaje clásico (añade pgtap/prisma)");
    const dbConn = await runDbTests({ repoRoot: repo, detection: detDb, exec: () => ({ code: 0, stdout: "", stderr: "" }), env: { DATABASE_URL: "postgres://u:p@localhost/db" } });
    assert.strictEqual(dbConn[0].status, "skip");
    assert.ok(/integraci.n de la capa unit/.test(dbConn[0].narrative), "con conexión (pero sin sonda pg) → aclara que va a las pruebas de integración (capa unit)");
    fs.rmSync(path.join(repo, "migrations"), { recursive: true, force: true });
    ok("QA de código: capa db con conexión pero solo migrations/ → el skip aclara dónde se usa la conexión (capa unit)");

    // (4f') SONDA DIRECTA a Postgres (conectividad + estructura + migraciones código↔base). En su propio
    // archivo para no pasar el guardrail de 400 líneas de esta suite (patrón explore-login).
    await runDbProbeCases(ctx);

    // (4g) sin .sln, la capa unit corre TODOS los proyectos de test .NET (no solo el primero): antes
    // se saltaban en silencio los demás (pérdida de cobertura). Cada proyecto → un objetivo etiquetado.
    const dnetBase = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dotnet-multi-"));
    fs.mkdirSync(path.join(dnetBase, "svc", "A.Tests"), { recursive: true });
    fs.mkdirSync(path.join(dnetBase, "svc", "B.Tests"), { recursive: true });
    fs.writeFileSync(path.join(dnetBase, "svc", "A.Tests", "A.Tests.csproj"), "<Project></Project>", "utf8");
    fs.writeFileSync(path.join(dnetBase, "svc", "B.Tests", "B.Tests.csproj"), "<Project></Project>", "utf8");
    const detMulti = detectRepo({ repoRoot: dnetBase });
    assert.strictEqual(detMulti.layers.unit.enabled, true);
    assert.strictEqual(detMulti.layers.unit.tool, "dotnet-test", "repo .NET puro → unit=dotnet-test");
    const seenProj = [];
    const evMulti = await runUnitTests({
      repoRoot: dnetBase, detection: detMulti,
      exec: (cmd, args) => { seenProj.push(args.find((a) => /\.csproj$/i.test(a))); return { code: 0, stdout: "Passed! - Failed: 0, Passed: 1", stderr: "" }; },
    });
    assert.strictEqual(evMulti.length, 2, "un objetivo por proyecto de test (corre los 2, no solo 1)");
    assert.ok(evMulti.every((e) => e.layer === "unit"));
    const narrMulti = evMulti.map((e) => e.narrative);
    assert.ok(narrMulti.some((n) => /@ A\.Tests/.test(n)) && narrMulti.some((n) => /@ B\.Tests/.test(n)), "cada objetivo se etiqueta con su proyecto");
    assert.strictEqual(new Set(seenProj).size, 2, "dotnet test se invocó con cada .csproj por separado");
    fs.rmSync(dnetBase, { recursive: true, force: true });
    ok("QA de código: sin .sln, la capa unit corre TODOS los proyectos de test .NET (no solo el primero)");

    // (5) runCodeCycle end-to-end con tracker LOCAL + exec fake → reporte + capas corridas.
    const passExec = () => ({ code: 0, stdout: "", stderr: "" });
    const cycle = await runCodeCycle({ sourcePath: "myrepo", baseDir: base, env: {}, workItemId: "local", exec: passExec });
    assert.strictEqual(cycle.ok, true);
    assert.strictEqual(cycle.tracker, "local");
    assert.deepStrictEqual(cycle.layersRun, ["static", "unit", "security"], "corre las capas detectadas en alcance");
    // Exit 0 en todas → SIN fallos. La seguridad emite varios objetos (SAST + secretos + SCA): con un exec
    // fake vacío, SCA/secretos pueden quedar en `skip` accionable (p.ej. sin lockfile), lo que es correcto.
    assert.ok(cycle.results.every((r) => r.status !== "fail"), "exit 0 en todas → ningún fallo");
    assert.ok(["static", "unit"].every((l) => cycle.results.find((r) => r.layer === l)?.status === "pass"), "las capas static y unit pasan con exit 0");
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
    const evRun = await runUnitTests({ repoRoot: repo, detection: det2, exec: () => ({ code: 1, stdout: dotnetCompile, stderr: "" }) });
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

    // (7) HU de hallazgos — render PURO. Extraído a findings-suite.mjs (guardrail de 400 líneas).
    runFindingsCases(ctx);

    // (7b) encoding: la salida de herramientas de Windows (dotnet en español) viene en cp1252/latin1;
    // decodeOutput la arregla (UTF-8 válido se respeta; bytes latin1 → acentos y « » correctos).
    const latin1 = Buffer.from([0x61, 0x75, 0x74, 0x65, 0x6e, 0x74, 0x69, 0x63, 0x61, 0x63, 0x69, 0xf3, 0x6e]); // "autenticación" (ó=0xF3)
    assert.strictEqual(decodeOutput(latin1), "autenticación", "cp1252/latin1 → acentos correctos");
    assert.strictEqual(decodeOutput(Buffer.from("autenticación", "utf8")), "autenticación", "UTF-8 válido se respeta");
    assert.strictEqual(decodeOutput(Buffer.from([0xab, 0x70, 0x6f, 0x73, 0x74, 0x67, 0x72, 0x65, 0x73, 0xbb])), "«postgres»", "« » de Windows se decodifican bien");
    assert.strictEqual(decodeOutput("ya string"), "ya string", "un string ya decodificado pasa igual");
    // U+FFFD ya presente en UTF-8 válido (la herramienta perdió el acento aguas arriba, p.ej. Npgsql
    // pre-auth) → se normaliza a "?" para no mostrar cuadros rotos en el reporte/HU.
    assert.strictEqual(decodeOutput(Buffer.from("autenticaci�n", "utf8")), "autenticaci?n", "U+FFFD irrecuperable → '?'");
    ok("QA de código: decodeOutput arregla el mojibake (cp1252/latin1 de Windows → texto correcto; UTF-8 intacto; U+FFFD→?)");

    // (8) adapter azure createFindingsWorkItem con cliente FALSO: cuenta #N (2 existentes → #3),
    // resuelve el sprint en curso y crea la User Story con Title/Description/Tags/IterationPath.
    let created = null;
    const fakeClient = {
      queryByWiql: async () => ({ status: 200, json: { workItems: [{ id: 1 }, { id: 2 }] } }),
      currentIteration: async () => ({ status: 200, json: { value: [{ path: "Proj\\Sprint 5" }] } }),
      createWorkItem: async (type, ops) => { created = { type, ops }; return { status: 200, json: { id: 777 } }; },
      uploadAttachment: async () => ({ status: 201, json: { url: "http://att/1" } }),
      patchWorkItem: async () => ({ status: 200, json: {} }),
      workItemWebUrl: (id) => `http://web/${id}`,
    };
    const az = new AzureDevOpsAdapter({ profile: {}, env: {}, adoClient: fakeClient });
    const fwi = await az.createFindingsWorkItem({ makeTitle: (seq) => `T #${seq}`, descriptionHtml: "<p>x</p>", tags: "QualityOps; Hallazgos-QA", countTag: "QualityOps" });
    assert.strictEqual(fwi.ok, true);
    assert.strictEqual(fwi.seq, 3, "cuenta las 2 existentes → #3");
    assert.strictEqual(fwi.id, "777");
    assert.strictEqual(fwi.iterationPath, "Proj\\Sprint 5", "usa el sprint en curso");
    assert.strictEqual(created.type, "User Story", "crea una HU (User Story)");
    const byPath = Object.fromEntries(created.ops.map((o) => [o.path, o.value]));
    assert.strictEqual(byPath["/fields/System.Title"], "T #3", "el título lleva el #N");
    assert.ok(byPath["/fields/System.IterationPath"] === "Proj\\Sprint 5" && /Hallazgos-QA/.test(byPath["/fields/System.Tags"]), "setea sprint + tags");
    ok("QA de código: adapter azure crea la HU de hallazgos (conteo #N + sprint en curso + User Story con tags/iteración)");

    // (8b) degradación de campos con permiso especial: si crear CON tags da 403 (TF401289 «create tag
    // definition», el caso REAL de FLIT) pero SIN tags funciona, la HU se crea igual, SIN tags y
    // CONSERVANDO el sprint. Marca `tagsSkipped` y deja `iterationSkipped=false`.
    let attempts = 0;
    const fakeClientTag = {
      queryByWiql: async () => ({ status: 200, json: { workItems: [] } }),
      currentIteration: async () => ({ status: 200, json: { value: [{ path: "Proj\\Sprint 9" }] } }),
      createWorkItem: async (_type, ops) => {
        attempts++;
        const hasTags = ops.some((o) => o.path === "/fields/System.Tags");
        return hasTags ? { status: 403, json: { message: "TF401289: create tags" } } : { status: 200, json: { id: 888 } };
      },
      uploadAttachment: async () => ({ status: 201, json: { url: "u" } }),
      patchWorkItem: async () => ({ status: 200, json: {} }),
      workItemWebUrl: (id) => `http://web/${id}`,
    };
    const az2 = new AzureDevOpsAdapter({ profile: {}, env: {}, adoClient: fakeClientTag });
    const fwi2 = await az2.createFindingsWorkItem({ makeTitle: (s) => `T #${s}`, descriptionHtml: "<p>x</p>", tags: "QualityOps; Hallazgos-QA" });
    assert.strictEqual(fwi2.ok, true, "con tags 403 pero sin tags OK → la HU se crea igual");
    assert.strictEqual(fwi2.id, "888");
    assert.strictEqual(fwi2.tagsSkipped, true, "marca que se creó sin tags (falta permiso de crear tags)");
    assert.strictEqual(fwi2.iterationSkipped, false, "conserva el sprint (no fue el problema)");
    assert.strictEqual(fwi2.iterationPath, "Proj\\Sprint 9", "el sprint se mantiene");
    assert.strictEqual(attempts, 2, "intentó con tags y reintentó sin ellos (conservando el sprint)");
    ok("QA de código: HU de hallazgos degrada campos con permiso especial (tags TF401289 → crea sin tags, conserva sprint)");

    // (9) validación de la ruta: un proyecto real (con package.json) pasa; un texto cualquiera o una
    // carpeta vacía NO → el asistente no deja avanzar (fix: antes cualquier string dejaba continuar).
    assert.strictEqual(validateProjectPath({ sourcePath: repo, baseDir: "", env: {} }).ok, true, "carpeta con package.json → es un proyecto");
    assert.strictEqual(validateProjectPath({ sourcePath: "X-no-existe-zzz", baseDir: "", env: {} }).ok, false, "un texto que no es ruta → rechazado");
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-empty-"));
    assert.strictEqual(looksLikeProject(emptyDir).ok, false, "carpeta vacía no parece un proyecto");
    fs.rmSync(emptyDir, { recursive: true, force: true });
    ok("QA de código: validación de ruta (proyecto real pasa; texto inválido o carpeta vacía no deja avanzar)");

    // (10) buildDbEnv: arma las vars de conexión desde la BD configurada (URL para la capa db +
    // ConnectionStrings__Core en formato Npgsql para las pruebas .NET; cita el password especial).
    const dbe = buildDbEnv({ engine: "postgres", host: "localhost", port: 5432, database: "flit_dev", user: "postgres", password: "p@ss w;ord" });
    assert.strictEqual(dbe.DATABASE_URL, "postgresql://postgres:p%40ss%20w%3Bord@localhost:5432/flit_dev", "DATABASE_URL con user/pass URL-encoded");
    assert.ok(/Host=localhost;Port=5432;Database=flit_dev;Username=postgres;Password='p@ss w;ord'/.test(dbe.ConnectionStrings__Core), "Npgsql cita el password con ; y espacio");
    const dbeSsl = buildDbEnv({ engine: "postgres", host: "h", port: 5432, database: "d", user: "u", password: "x", ssl: true, sslAllowSelfSigned: true });
    assert.ok(/sslmode=require/.test(dbeSsl.DATABASE_URL) && /SSL Mode=Require;Trust Server Certificate=true/.test(dbeSsl.ConnectionStrings__Core), "SSL se refleja en URL y Npgsql");
    assert.deepStrictEqual(buildDbEnv({ host: "", user: "" }), {}, "sin host/user → no inyecta nada");
    ok("QA de código: buildDbEnv arma DATABASE_URL + ConnectionStrings__Core (Npgsql) desde la BD configurada");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
