// runtime/smoke/layers.mjs — runners db/security/api + monorepos + ruta con espacios + detalle TC.
// Casos 14 (db/security/api), 20 (monorepo pnpm), 21 (stack mixto), 22 (espacios), 23 (detalle TC).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { detectRepo } from "../detect/qa-detect.mjs";
import { runUnitTests } from "../runners/unit.mjs";
import { runDbTests } from "../runners/db.mjs";
import { runSecurityTests } from "../runners/security.mjs";
import { runApiTests } from "../runners/api.mjs";
import { defaultExec } from "../runners/_runner-core.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

export async function run(ctx) {
  const { ok, capturingExec } = ctx;

  // 14. runners db/security/api: argv dinámico desde env/profile/archivos
  // db: pgtap sin conexión → skip; con DATABASE_URL → corre con la conexión de env
  const repoDb = fs.mkdtempSync(path.join(os.tmpdir(), "qa-db-"));
  fs.writeFileSync(path.join(repoDb, "schema.pgtap"), "-- tests");
  const dbSkip = runDbTests({ repoRoot: repoDb, env: {} })[0];
  assert.strictEqual(dbSkip.status, "skip");
  assert.ok(/DATABASE_URL/.test(dbSkip.narrative)); // conexión nunca cableada
  const capDb = capturingExec(0);
  const dbPass = runDbTests({ repoRoot: repoDb, env: { DATABASE_URL: "postgres://u@h/db" }, exec: capDb.exec })[0];
  assert.strictEqual(dbPass.status, "pass");
  assert.strictEqual(dbPass.metrics.tool, "pgtap");
  assert.ok(capDb.calls[0].args.includes("postgres://u@h/db"));
  fs.rmSync(repoDb, { recursive: true, force: true });
  // prisma: guarda igual que pgtap → sin conexión skip; con conexión (de cualquier var
  // soportada) corre `prisma migrate status`. Cablear a un proyecto futuro = exportar la var.
  const repoPrisma = fs.mkdtempSync(path.join(os.tmpdir(), "qa-prisma-"));
  fs.mkdirSync(path.join(repoPrisma, "prisma"));
  fs.writeFileSync(path.join(repoPrisma, "prisma", "schema.prisma"), "datasource db {}");
  const prismaSkip = runDbTests({ repoRoot: repoPrisma, env: {} })[0];
  assert.strictEqual(prismaSkip.status, "skip");
  assert.strictEqual(prismaSkip.metrics.tool, "prisma");
  const capPrisma = capturingExec(0);
  const prismaPass = runDbTests({ repoRoot: repoPrisma, env: { PG_CONNECTION: "postgres://u@h/db" }, exec: capPrisma.exec })[0];
  assert.strictEqual(prismaPass.status, "pass");
  assert.deepStrictEqual(capPrisma.calls[0].args, ["migrate", "status"]);
  fs.rmSync(repoPrisma, { recursive: true, force: true });

  // F2. Guardrail anti-producción del runner db: pgtap ejecuta SQL arbitrario (posible DDL/DML).
  // Host de producción → skip SIN tocar la BD; con override (QA_DB_ALLOW_WRITE) o host no-prod →
  // ejecuta; profile.db.production_hosts también marca un host como prod.
  const repoGuard = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dbguard-"));
  fs.writeFileSync(path.join(repoGuard, "schema.pgtap"), "-- tests");
  let touchedProd = false;
  const prodSkip = runDbTests({
    repoRoot: repoGuard,
    env: { DATABASE_URL: "postgres://u@db.prod.acme.com/db" },
    exec: () => { touchedProd = true; return { code: 0, stdout: "", stderr: "" }; },
  })[0];
  assert.strictEqual(prodSkip.status, "skip");
  assert.ok(/PRODUCCIÓN/.test(prodSkip.narrative));
  assert.strictEqual(touchedProd, false); // jamás invocó pg_prove contra el host de prod
  const capAllow = capturingExec(0);
  const prodAllow = runDbTests({
    repoRoot: repoGuard,
    env: { DATABASE_URL: "postgres://u@db.prod.acme.com/db", QA_DB_ALLOW_WRITE: "1" },
    exec: capAllow.exec,
  })[0];
  assert.strictEqual(prodAllow.status, "pass"); // override explícito permite ejecutar
  const profSkip = runDbTests({
    repoRoot: repoGuard,
    env: { DATABASE_URL: "postgres://u@dbx.internal/db" },
    profile: { db: { production_hosts: ["dbx.internal"] } },
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
  })[0];
  assert.strictEqual(profSkip.status, "skip"); // host marcado prod por el perfil
  fs.rmSync(repoGuard, { recursive: true, force: true });
  ok("guardrail anti-producción (db): host prod → skip sin tocar la BD; QA_DB_ALLOW_WRITE/host no-prod → ejecuta; profile.db.production_hosts respetado");

  // security: ZERO-CONFIG. Con .semgrep.yml usa esa config + target_profile; SIN config corre
  // igual (semgrep `auto`); hallazgos → fail; escáner no instalado → skip.
  const repoSec = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sec-"));
  fs.writeFileSync(path.join(repoSec, ".semgrep.yml"), "rules: []");
  const capSec = capturingExec(0);
  const secPass = runSecurityTests({ repoRoot: repoSec, profile: { security: { target_profile: "api" } }, exec: capSec.exec })[0];
  assert.strictEqual(secPass.status, "pass");
  assert.strictEqual(secPass.metrics.tool, "semgrep");
  assert.ok(capSec.calls[0].args.includes("p/owasp-top-ten")); // target_profile=api
  const secFail = runSecurityTests({ repoRoot: repoSec, exec: capturingExec(1, { stdout: "1 finding" }).exec })[0];
  assert.strictEqual(secFail.status, "fail");                 // exit 1 = hallazgo real → fail
  // exit 2 = error de escáner (config/red), NO un hallazgo → skip, no rompe el ciclo
  const secErr = runSecurityTests({ repoRoot: repoSec, exec: capturingExec(2, { stderr: "could not reach registry" }).exec })[0];
  assert.strictEqual(secErr.status, "skip");
  assert.strictEqual(secErr.metrics.exitCode, 2);
  fs.rmSync(repoSec, { recursive: true, force: true });
  // zero-config: repo SIN ninguna config de seguridad → la capa corre igual con semgrep auto
  const repoSecZero = fs.mkdtempSync(path.join(os.tmpdir(), "qa-seczero-"));
  fs.writeFileSync(path.join(repoSecZero, "package.json"), JSON.stringify({ name: "z" }));
  const capSecZero = capturingExec(0);
  const secZero = runSecurityTests({ repoRoot: repoSecZero, exec: capSecZero.exec })[0];
  assert.strictEqual(secZero.status, "pass");
  assert.strictEqual(secZero.metrics.tool, "semgrep");
  assert.ok(capSecZero.calls[0].args.includes("auto")); // ruleset por defecto sin config
  // escáner no instalado (127) → skip, nunca aborta
  const secNoBin = runSecurityTests({ repoRoot: repoSecZero, exec: capturingExec(127).exec })[0];
  assert.strictEqual(secNoBin.status, "skip");
  fs.rmSync(repoSecZero, { recursive: true, force: true });
  // bandit (stack Python): escanea recursivo PERO excluye directorios de test → `assert` en
  // pytest (B101) no es un hallazgo de seguridad y no debe romper el gate por ruido.
  const repoBandit = fs.mkdtempSync(path.join(os.tmpdir(), "qa-bandit-"));
  fs.writeFileSync(path.join(repoBandit, "pyproject.toml"), "[project]\nname='x'");
  const capBandit = capturingExec(0);
  const banditRun = runSecurityTests({ repoRoot: repoBandit, exec: capBandit.exec })[0];
  assert.strictEqual(banditRun.metrics.tool, "bandit");            // python → bandit
  const banditArgs = capBandit.calls[0].args;
  assert.ok(banditArgs.includes("--exclude"));
  assert.ok(banditArgs.some((a) => /\*\/tests\/\*/.test(a)));      // tests fuera del scan
  fs.rmSync(repoBandit, { recursive: true, force: true });

  // api: postman → newman run <colección>; openapi → redocly lint (validación offline)
  const repoApi = fs.mkdtempSync(path.join(os.tmpdir(), "qa-api-"));
  fs.writeFileSync(path.join(repoApi, "smoke.postman_collection.json"), "{}");
  const capApi = capturingExec(0);
  const apiPass = runApiTests({ repoRoot: repoApi, exec: capApi.exec })[0];
  assert.strictEqual(apiPass.status, "pass");
  assert.strictEqual(apiPass.metrics.tool, "postman");
  assert.strictEqual(capApi.calls[0].args[0], "run");
  assert.ok(/postman_collection/.test(capApi.calls[0].args[1]));
  fs.rmSync(repoApi, { recursive: true, force: true });
  // openapi: corre `redocly lint` (validación de contrato offline). Ruleset por defecto
  // `minimal`; el perfil puede sobreescribirlo. Exit 0 inyectado → pass.
  const repoOas = fs.mkdtempSync(path.join(os.tmpdir(), "qa-oas-"));
  fs.mkdirSync(path.join(repoOas, "docs"));
  fs.writeFileSync(path.join(repoOas, "docs", "openapi.yaml"), "openapi: 3.1.0");
  const capOas = capturingExec(0);
  const oasRun = runApiTests({ repoRoot: repoOas, exec: capOas.exec })[0];
  assert.strictEqual(oasRun.status, "pass");
  assert.strictEqual(oasRun.metrics.tool, "openapi");
  assert.ok(capOas.calls[0].args.includes("lint"));
  assert.ok(capOas.calls[0].args.some((a) => /openapi\.yaml$/.test(a))); // spec localizada en subcarpeta
  assert.ok(capOas.calls[0].args.includes("--extends=minimal")); // ruleset por defecto
  // el perfil sobreescribe el ruleset
  const capOasStrict = capturingExec(0);
  runApiTests({ repoRoot: repoOas, profile: { api: { openapi_ruleset: "recommended" } }, exec: capOasStrict.exec });
  assert.ok(capOasStrict.calls[0].args.includes("--extends=recommended"));
  // exit ≠ 0 (errores de contrato) → fail
  const oasFail = runApiTests({ repoRoot: repoOas, exec: capturingExec(1, { stdout: "Validation failed" }).exec })[0];
  assert.strictEqual(oasFail.status, "fail");
  fs.rmSync(repoOas, { recursive: true, force: true });
  // openapi versionado en carpeta `openapi/` (p.ej. contracts/openapi/core-api.v1.yaml): un
  // contrato real no siempre se llama openapi.yaml. qa-detect debe ENCENDER la capa por la ruta,
  // y el runner debe LOCALIZAR el spec aunque esté 2+ niveles abajo y con nombre propio.
  const repoOasV = fs.mkdtempSync(path.join(os.tmpdir(), "qa-oasv-"));
  fs.mkdirSync(path.join(repoOasV, "contracts", "openapi"), { recursive: true });
  fs.writeFileSync(path.join(repoOasV, "contracts", "openapi", "core-api.v1.yaml"), "openapi: 3.1.0");
  const detOasV = detectRepo({ repoRoot: repoOasV });
  assert.ok(detOasV.enabled.includes("api"));                       // detección por carpeta openapi/
  assert.strictEqual(detOasV.layers.api.tool, "openapi");
  const capOasV = capturingExec(0);
  const oasVRun = runApiTests({ repoRoot: repoOasV, exec: capOasV.exec })[0];
  assert.strictEqual(oasVRun.status, "pass");                       // spec localizada 2 niveles abajo
  assert.ok(capOasV.calls[0].args.some((a) => /core-api\.v1\.yaml$/.test(a)));
  fs.rmSync(repoOasV, { recursive: true, force: true });
  ok("runners db/security/api: conexión desde env, target_profile ruleset, newman; openapi → redocly lint offline (incl. contrato versionado en openapi/)");

  // 20. monorepo pnpm: herramientas en un subpaquete (frontend/), NO en la raíz.
  // qa-detect debe ubicar la cwd de cada capa en el subpaquete y el runner debe
  // resolver el binario de frontend/node_modules/.bin y EJECUTAR ahí (no en la raíz).
  const repoMono = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mono-"));
  // raíz: solo workspace manifest, SIN deps de test ni node_modules
  fs.writeFileSync(path.join(repoMono, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["frontend"] }));
  fs.writeFileSync(path.join(repoMono, "pnpm-workspace.yaml"), "packages:\n  - frontend\n");
  // subpaquete frontend/ con vitest + playwright + tsconfig y sus binarios locales
  const feDir = path.join(repoMono, "frontend");
  fs.mkdirSync(feDir, { recursive: true });
  fs.writeFileSync(path.join(feDir, "package.json"), JSON.stringify({
    name: "@app/frontend", devDependencies: { vitest: "1", "@playwright/test": "1", typescript: "5" },
  }));
  fs.writeFileSync(path.join(feDir, "vitest.config.ts"), "export default {}");
  fs.writeFileSync(path.join(feDir, "playwright.config.ts"), "export default {}");
  fs.writeFileSync(path.join(feDir, "tsconfig.json"), "{}");
  // binarios "instalados" SOLO en frontend/node_modules/.bin (layout pnpm)
  const feBin = path.join(feDir, "node_modules", ".bin");
  fs.mkdirSync(feBin, { recursive: true });
  for (const b of ["vitest", "playwright", "tsc"]) fs.writeFileSync(path.join(feBin, b + (process.platform === "win32" ? ".cmd" : "")), "");

  // 20a. detección: capas encendidas con cwd = "frontend" (no la raíz). security es
  // zero-config → siempre presente (no afecta la ubicación de las capas con tooling).
  const monoDet = detectRepo({ repoRoot: repoMono });
  assert.deepStrictEqual(monoDet.enabled.sort(), ["e2e", "security", "static", "unit"]);
  assert.strictEqual(monoDet.layers.unit.cwd, "frontend");
  assert.strictEqual(monoDet.layers.e2e.cwd, "frontend");
  assert.strictEqual(monoDet.layers.static.cwd, "frontend");

  // 20b. el runner ejecuta en frontend/ y resuelve el bin del subpaquete (no cae a PATH)
  const monoCalls = [];
  const monoExec = (cmd, args, ctx2) => { monoCalls.push({ cmd, args, cwd: ctx2.cwd }); return { code: 0, stdout: "", stderr: "" }; };
  const monoUnit = runUnitTests({ repoRoot: repoMono, detection: monoDet, exec: monoExec })[0];
  assert.strictEqual(monoUnit.status, "pass");
  assert.strictEqual(monoUnit.metrics.tool, "vitest");
  assert.strictEqual(monoCalls[0].cwd, feDir);                       // corrió EN frontend/
  assert.ok(monoCalls[0].cmd.includes(path.join("frontend", "node_modules", ".bin", "vitest"))); // bin del subpaquete
  fs.rmSync(repoMono, { recursive: true, force: true });
  ok("monorepo pnpm: qa-detect ubica cwd en el subpaquete y el runner resuelve/ejecuta el bin local de frontend/");

  // 21. monorepo de STACK MIXTO: una misma capa con DOS herramientas en dos paquetes.
  // unit = vitest (frontend, bin local) + dotnet-test (backend .NET, vía PATH). El kit debe
  // correr AMBAS (no solo la de mayor prioridad) → dos EvidenceObjects para la capa unit.
  const repoMix = fs.mkdtempSync(path.join(os.tmpdir(), "qa-mix-"));
  fs.writeFileSync(path.join(repoMix, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["frontend"] }));
  const mxFe = path.join(repoMix, "frontend");
  fs.mkdirSync(path.join(mxFe, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(mxFe, "package.json"), JSON.stringify({ name: "@app/web", devDependencies: { vitest: "1" } }));
  fs.writeFileSync(path.join(mxFe, "vitest.config.ts"), "export default {}");
  fs.writeFileSync(path.join(mxFe, "node_modules", ".bin", "vitest" + (process.platform === "win32" ? ".cmd" : "")), "");
  // backend .NET SIN package.json → su csproj de test pertenece al scope raíz
  const mxBe = path.join(repoMix, "backend", "Api.Tests");
  fs.mkdirSync(mxBe, { recursive: true });
  fs.writeFileSync(path.join(mxBe, "Api.Tests.csproj"), "<Project/>");

  const mixDet = detectRepo({ repoRoot: repoMix });
  const unitTools = mixDet.layers.unit.targets.map((t) => `${t.tool}@${t.cwd}`).sort();
  assert.deepStrictEqual(unitTools, ["dotnet-test@", "vitest@frontend"]); // DOS objetivos
  const mixCalls = [];
  const mixExec = (cmd, args, ctx2) => { mixCalls.push({ cmd, args, cwd: ctx2.cwd }); return { code: 0, stdout: "", stderr: "" }; };
  const mixUnit = runUnitTests({ repoRoot: repoMix, detection: mixDet, exec: mixExec });
  assert.strictEqual(mixUnit.length, 2);                                  // corre AMBOS
  assert.ok(mixUnit.every((r) => r.status === "pass"));
  const byTool = Object.fromEntries(mixUnit.map((r) => [r.metrics.tool, r]));
  assert.strictEqual(byTool.vitest.metrics.cwd, "frontend");
  assert.strictEqual(byTool["dotnet-test"].metrics.cwd, "");
  // vitest resuelto al bin del subpaquete y ejecutado ahí; dotnet vía PATH desde la raíz
  const vitestCall = mixCalls.find((c) => c.cmd.includes("vitest"));
  assert.ok(vitestCall.cmd.includes(path.join("frontend", "node_modules", ".bin", "vitest")));
  assert.strictEqual(vitestCall.cwd, mxFe);
  const dotnetCall = mixCalls.find((c) => c.cmd === "dotnet");
  assert.strictEqual(dotnetCall.cwd, repoMix);
  fs.rmSync(repoMix, { recursive: true, force: true });
  ok("monorepo mixto: la capa unit corre vitest@frontend Y dotnet-test@backend (N objetivos por capa)");

  // 22. ejecución con RUTA CON ESPACIOS (regresión Windows real): un binario en una carpeta
  // con espacios debe EJECUTARSE, no partirse en el shell ("C:\FLIT\TEST no se reconoce…").
  const spRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa sp-"));
  const spDir = path.join(spRoot, "with space");
  fs.mkdirSync(spDir, { recursive: true });
  const spOutExpected = "hello-kit";
  let spBin;
  if (process.platform === "win32") {
    spBin = path.join(spDir, "hello.cmd");
    fs.writeFileSync(spBin, `@echo ${spOutExpected}\r\n`);
  } else {
    spBin = path.join(spDir, "hello.sh");
    fs.writeFileSync(spBin, `#!/bin/sh\necho ${spOutExpected}\n`);
    fs.chmodSync(spBin, 0o755);
  }
  const spRes = defaultExec(spBin, [], { cwd: spDir });
  assert.strictEqual(spRes.code, 0, "binario en ruta con espacios debe ejecutar (no 'no se reconoce')");
  assert.ok(spRes.stdout.includes(spOutExpected));
  // binario INEXISTENTE → code 127 (→ skip), cross-platform: ENOENT en POSIX, 9009/"is not
  // recognized" en Windows. Garantiza que un escáner ausente se OMITA, no se reporte fail.
  assert.strictEqual(defaultExec("qa-bin-inexistente-zzz", [], { cwd: spDir }).code, 127);
  fs.rmSync(spRoot, { recursive: true, force: true });
  ok("ejecución robusta: binario en ruta con espacios se ejecuta citado (regresión Windows)");

  // 23. detalle por TC: el reporter JSON de la herramienta se parsea a casos estructurados
  // (nombre/estado/duración/error) y se plasma bajo cada capa en la evidencia (local + remoto).
  // 23a. el runner pide el reporter JSON y mapea su salida a `cases`.
  const repoCases = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cases-"));
  fs.writeFileSync(path.join(repoCases, "package.json"), JSON.stringify({ name: "c", devDependencies: { vitest: "1" } }));
  fs.writeFileSync(path.join(repoCases, "vitest.config.ts"), "export default {}");
  const vitestJson = JSON.stringify({
    testResults: [{
      assertionResults: [
        { ancestorTitles: ["auth"], title: "login redirige al dashboard", status: "passed", duration: 45, failureMessages: [] },
        { ancestorTitles: ["cart"], title: "aplica cupón de descuento", status: "failed", duration: 88, failureMessages: ["AssertionError: expected 90 to be 80"] },
      ],
    }],
  });
  let casesArgs = null;
  const evCases = runUnitTests({ repoRoot: repoCases, exec: (cmd, args) => { casesArgs = args; return { code: 1, stdout: vitestJson, stderr: "" }; } })[0];
  assert.ok(casesArgs.includes("--reporter=json"));               // pidió el reporter JSON nativo
  assert.ok(Array.isArray(evCases.cases) && evCases.cases.length === 2);
  assert.deepStrictEqual(evCases.cases.map((c) => c.status), ["pass", "fail"]);
  assert.strictEqual(evCases.cases[0].name, "auth › login redirige al dashboard");
  assert.strictEqual(evCases.cases[0].duration, 45);
  assert.ok(/AssertionError/.test(evCases.cases[1].message));     // mensaje de error del TC fallido
  assert.ok(/2 TC/.test(evCases.narrative));                      // narrativa derivada de los casos
  // salida que NO es el JSON esperado → degrada a null (resumen de texto), nunca rompe
  const evNoCases = runUnitTests({ repoRoot: repoCases, exec: () => ({ code: 1, stdout: "2 failed", stderr: "" }) })[0];
  assert.strictEqual(evNoCases.cases, undefined);
  assert.ok(/2 failed/.test(evNoCases.narrative));
  fs.rmSync(repoCases, { recursive: true, force: true });
  // 23b. el sink local plasma el detalle de TC bajo cada capa en md y html.
  const repoSink = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sink-cases-"));
  const sinkOut = writeLocalReport({
    repoRoot: repoSink, profile: {}, workItemId: "TCDETAIL",
    results: [{ layer: "unit", status: "fail", narrative: "vitest: exit 1", metrics: { tool: "vitest" }, cases: [
      { name: "auth › login", status: "pass", duration: 45, message: null },
      { name: "cart › cupón", status: "fail", duration: 88, message: "AssertionError: expected 90 to be 80" },
    ] }],
  });
  const sinkMd = fs.readFileSync(sinkOut.mdPath, "utf8");
  assert.ok(/Detalle de pruebas \(TC ejecutados\)/.test(sinkMd));
  assert.ok(/auth › login/.test(sinkMd) && /cart › cupón/.test(sinkMd) && /AssertionError/.test(sinkMd));
  const sinkHtml = fs.readFileSync(sinkOut.htmlPath, "utf8");
  assert.ok(/Detalle de pruebas/.test(sinkHtml) && /<details/.test(sinkHtml));
  fs.rmSync(repoSink, { recursive: true, force: true });
  ok("detalle por TC: runner mapea el reporter JSON a `cases` (degrada a resumen si no hay JSON) y el sink lo plasma en md/html");
}
