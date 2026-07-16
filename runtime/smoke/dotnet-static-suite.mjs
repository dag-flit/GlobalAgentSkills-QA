// dotnet-static-suite.mjs — análisis estático de .NET en la capa `static`. Verifica OFFLINE (exec
// inyectable, fixtures en disco temporal; sin lanzar dotnet): (1) el parser de `dotnet build` mapea
// warning→skip (advertencia) y error→fail y deduplica; (2) qa-detect ENCIENDE static por .csproj/.sln;
// (3) el fan-out expande a la solución (uno) o a un objetivo por proyecto de aplicación (sin .sln,
// excluyendo los de test) y CONSERVA los objetivos no-dotnet (eslint); (4) runStaticAnalysis corre el
// objetivo .NET: warning no bloquea (pass), error de compilación bloquea (fail).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDotnetBuild } from "../runners/parse-cases.mjs";
import { scanDotnetProjects, expandDotnetStaticTargets } from "../runners/dotnet-static.mjs";
import { runStaticAnalysis } from "../runners/static-analysis.mjs";
import { detectRepo } from "../detect/qa-detect.mjs";

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dnstatic-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

export async function run(ctx) {
  const { ok } = ctx;

  // (1) Parser: warning (CA)→skip, error (CS)→fail, con archivo:línea+regla; deduplica el aviso repetido.
  const line = (f, s) => `${f}(12,34): ${s} [C:\\src\\Proj.csproj]`;
  const out = { stdout: [
    line("C:\\src\\Foo.cs", "warning CA1822: Member 'X' does not access instance data"),
    line("C:\\src\\Foo.cs", "warning CA1822: Member 'X' does not access instance data"), // duplicado
    "C:\\src\\Bar.cs(5,10): error CS0103: The name 'foo' does not exist in the current context [C:\\src\\Proj.csproj]",
  ].join("\n") };
  const cases = parseDotnetBuild(out, { repoRoot: "C:\\src" });
  assert.strictEqual(cases.length, 2, "deduplica el warning repetido → 2 casos");
  const warn = cases.find((c) => /CA1822/.test(c.name));
  const err = cases.find((c) => /CS0103/.test(c.name));
  assert.ok(warn && warn.status === "skip", "warning CA → skip (advertencia, no bloquea)");
  assert.ok(err && err.status === "fail", "error CS → fail (no compila)");
  assert.ok(/:12 /.test(warn.name) && /:5 /.test(err.name), "cada caso guarda archivo:línea+regla");
  ok("static/.NET: parseDotnetBuild mapea warning→skip y error→fail (con archivo:línea+regla, deduplicado)");

  // (2) qa-detect enciende `static` por .NET (repo backend-only, sin eslint/tsc).
  const dnRepo = mkrepo({ "src/Api/Api.csproj": "<Project/>", "src/Api/Program.cs": "class P{}" });
  try {
    const det = detectRepo({ repoRoot: dnRepo });
    assert.ok(det.layers.static.enabled, "static se enciende con solo un .csproj");
    assert.strictEqual(det.layers.static.tool, "dotnet-build", "la herramienta primaria es dotnet-build en repo .NET puro");
    ok("static/.NET: qa-detect enciende la capa static por .csproj/.sln (repos backend-only)");
  } finally { fs.rmSync(dnRepo, { recursive: true, force: true }); }

  // (3a) Fan-out con .sln → UN objetivo (la solución cubre todo), conservando el objetivo eslint.
  const slnRepo = mkrepo({ "App.sln": "", "src/Core/Core.csproj": "<Project/>", "src/Core.Tests/Core.Tests.csproj": "<Project/>" });
  try {
    const base = { layers: { static: { enabled: true, tool: "eslint", targets: [{ tool: "eslint", cwd: "frontend" }] } } };
    const expanded = expandDotnetStaticTargets(base, slnRepo);
    const t = expanded.layers.static.targets;
    const dn = t.filter((x) => x.tool === "dotnet-build");
    assert.strictEqual(dn.length, 1, "con .sln → un solo objetivo dotnet-build");
    assert.ok(/App\.sln$/.test(dn[0].project), "el objetivo apunta a la solución");
    assert.ok(t.some((x) => x.tool === "eslint" && x.cwd === "frontend"), "conserva el objetivo eslint del frontend (monorepo mixto)");
    ok("static/.NET: fan-out con .sln → un objetivo, conserva eslint (frontend JS + backend .NET conviven)");
  } finally { fs.rmSync(slnRepo, { recursive: true, force: true }); }

  // (3b) Sin .sln → un objetivo por proyecto de APLICACIÓN; los de test los cubre `unit`.
  const multiRepo = mkrepo({ "src/A/A.csproj": "<Project/>", "src/B/B.csproj": "<Project/>", "src/A.Tests/A.Tests.csproj": "<Project/>" });
  try {
    const expanded = expandDotnetStaticTargets({ layers: { static: { enabled: false, targets: [] } } }, multiRepo);
    const dn = expanded.layers.static.targets.filter((x) => x.tool === "dotnet-build");
    assert.deepStrictEqual(dn.map((x) => x.label).sort(), ["A", "B"], "un objetivo por proyecto de app (A, B); el .Tests se excluye");
    assert.ok(expanded.layers.static.enabled, "enciende la capa aunque venía apagada (backend-only)");
    ok("static/.NET: sin .sln → un objetivo por proyecto de aplicación (excluye los de test)");
  } finally { fs.rmSync(multiRepo, { recursive: true, force: true }); }

  // (4) runStaticAnalysis corre el objetivo .NET con exec inyectado: warning no bloquea, error sí.
  const runRepo = mkrepo({ "src/Api/Api.csproj": "<Project/>", "src/Api/Program.cs": "class P{}" });
  try {
    const detection = detectRepo({ repoRoot: runRepo });
    // Build solo con warning → exit 0 (no bloquea).
    const warnExec = () => ({ code: 0, stdout: `${path.join(runRepo, "src/Api/Program.cs")}(3,9): warning CA1822: ... [Api.csproj]`, stderr: "" });
    const okRes = await runStaticAnalysis({ repoRoot: runRepo, detection, exec: warnExec });
    const dnOk = okRes.find((r) => r.metrics?.tool === "dotnet-build");
    assert.ok(dnOk && dnOk.status === "pass", "build con solo advertencias → la capa PASA");
    assert.ok(dnOk.cases.some((c) => c.status === "skip"), "las advertencias quedan listadas como skip (sugerencias)");
    // Build con error de compilación → exit 1 (bloquea).
    const errExec = () => ({ code: 1, stdout: `${path.join(runRepo, "src/Api/Program.cs")}(3,9): error CS0103: The name 'x' does not exist [Api.csproj]`, stderr: "" });
    const badRes = await runStaticAnalysis({ repoRoot: runRepo, detection, exec: errExec });
    const dnBad = badRes.find((r) => r.metrics?.tool === "dotnet-build");
    assert.ok(dnBad && dnBad.status === "fail" && dnBad.cases.some((c) => c.status === "fail"), "error de compilación → la capa FALLA");
    ok("static/.NET: runStaticAnalysis corre dotnet build (warning→pass, error→fail) vía exec inyectable");
  } finally { fs.rmSync(runRepo, { recursive: true, force: true }); }
}
