// sca-suite.mjs — SCA (dependencias vulnerables), Paso 2 · Incremento 2. Verifica OFFLINE (exec y
// detección inyectables, sin red ni procesos): (1) detección de manifiestos → objetivos; (2) parsers
// npm/dotnet/pip con mapeo de severidad (bloquea vs sugerencia); (3) skips accionables (sin lockfile,
// sin restore, herramienta ausente); (4) escape hatch off/fail_on/ignore; (5) integración en
// runSecurityTests junto al SAST y secret-scan; (6) coherencia HU/MD/HTML.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectScaTargets, runSca } from "../runners/sca.mjs";
import { parseNpmAudit, parseDotnetVulnerable, parsePipAudit } from "../runners/parse-sca.mjs";
import { runSecurityTests } from "../runners/security.mjs";
import { renderFindingsDescription } from "../evidence/findings-workitem.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";
import { suggestionCases, notVerifiedCases } from "../evidence/layer-explain.mjs";

function renderReport(results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sca-"));
  try {
    const r = writeLocalReport({ repoRoot: dir, profile: {}, workItemId: "local", results });
    return { md: fs.readFileSync(r.mdPath, "utf8"), html: fs.readFileSync(r.htmlPath, "utf8") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// Detección falsa: árbol de archivos en memoria {dir: [{name,dir}]} + set de archivos existentes.
function fakeDetect(tree, existSet) {
  return (repoRoot, opts) => detectScaTargets(repoRoot, {
    listDir: (abs) => tree[path.relative(repoRoot, abs) || "."] || [],
    exists: (abs) => existSet.has(path.relative(repoRoot, abs).replace(/\\/g, "/")),
    ...opts,
  });
}
const FAIL = { failOn: new Set(["critical", "high"]) };

export async function run(ctx) {
  const { ok } = ctx;

  // (1) Detección de manifiestos → objetivos con su herramienta.
  const tree = {
    ".": [{ name: "frontend", dir: true }, { name: "Api.csproj", dir: false }, { name: "node_modules", dir: true }],
    frontend: [{ name: "package.json", dir: false }, { name: "package-lock.json", dir: false }],
    node_modules: [{ name: "junk", dir: false }], // se salta (SKIP_DIRS)
  };
  const targets = fakeDetect(tree, new Set(["frontend/package-lock.json"]))("/repo");
  const tools = targets.map((t) => t.tool).sort();
  assert.deepStrictEqual(tools, ["dotnet-vulnerable", "npm-audit"], "detecta npm (con lockfile) y NuGet; ignora node_modules");
  assert.ok(targets.find((t) => t.tool === "npm-audit").hasLock, "reconoce el lockfile de npm");
  ok("SCA: detecta manifiestos (npm + NuGet) y arma un objetivo por gestor, saltando node_modules");

  // (1b) Workspace pnpm (como FLIT): pnpm-lock.yaml en la raíz + frontend/package.json SIN lock propio →
  // UN objetivo pnpm-audit en la raíz (cubre el workspace); el sub-paquete NO emite npm-audit (sin ruido).
  const pnpmTree = {
    ".": [{ name: "frontend", dir: true }, { name: "package.json", dir: false }, { name: "pnpm-lock.yaml", dir: false }],
    frontend: [{ name: "package.json", dir: false }],
  };
  const pnpmTargets = fakeDetect(pnpmTree, new Set([]))("/repo");
  assert.deepStrictEqual(pnpmTargets.map((t) => t.tool), ["pnpm-audit"], "un workspace pnpm → un solo pnpm-audit en la raíz; los sub-paquetes no emiten npm-audit");
  assert.strictEqual(pnpmTargets[0].cwd, "", "el pnpm-audit corre en la raíz del workspace");
  // pnpm audit --json usa el formato `advisories` (estilo npm v6) → parseNpmAudit lo entiende.
  const pnpm = parseNpmAudit({ stdout: JSON.stringify({ advisories: { "1179": { module_name: "minimist", severity: "high", title: "Prototype Pollution", url: "https://x/GHSA-3", vulnerable_versions: "<1.2.6", patched_versions: ">=1.2.6" } } }) }, FAIL);
  assert.ok(pnpm.length === 1 && pnpm[0].status === "fail" && /minimist/.test(pnpm[0].name) && pnpm[0].plain && pnpm[0].action, "parser reutilizado lee la salida de pnpm audit (advisories) con plain/action");
  ok("SCA: workspace pnpm → un pnpm-audit en la raíz (sin ruido en sub-paquetes) y su salida se parsea");

  // (1c) Workspace npm (como flito): package-lock.json SOLO en la raíz + apps/api, apps/web SIN lock propio
  // → UN npm-audit en la raíz (que audita todo el árbol); los sub-paquetes NO emiten un falso "necesita lockfile".
  const npmWsTree = {
    ".": [{ name: "apps", dir: true }, { name: "package.json", dir: false }, { name: "package-lock.json", dir: false }],
    apps: [{ name: "api", dir: true }, { name: "web", dir: true }],
    "apps/api": [{ name: "package.json", dir: false }],
    "apps/web": [{ name: "package.json", dir: false }],
  };
  const npmWs = fakeDetect(npmWsTree, new Set(["package-lock.json"]))("/repo");
  assert.deepStrictEqual(npmWs.map((t) => t.tool), ["npm-audit"], "un workspace npm → un solo npm-audit (raíz); apps/api y apps/web NO emiten objetivo");
  assert.ok(npmWs[0].cwd === "" && npmWs[0].hasLock, "el npm-audit corre en la raíz con su lockfile");
  ok("SCA: workspace npm → un npm-audit en la raíz cubre los sub-paquetes (sin falso «necesita lockfile» en apps/api, apps/web)");

  // (2) Parsers: severidad → bloquea (fail) vs sugerencia (skip).
  const npm = parseNpmAudit({ stdout: JSON.stringify({ vulnerabilities: {
    lodash: { severity: "high", via: [{ title: "Prototype Pollution", url: "https://x/GHSA-1" }], range: "<4.17.21", fixAvailable: true },
    ms: { severity: "low", via: [{ title: "ReDoS", url: "https://x/GHSA-2" }], range: "<2.0.0" },
  } }) }, FAIL);
  assert.strictEqual(npm.find((c) => c.name.startsWith("lodash")).status, "fail", "high bloquea");
  assert.strictEqual(npm.find((c) => c.name.startsWith("ms")).status, "skip", "low es sugerencia");
  assert.strictEqual(npm.find((c) => c.name.startsWith("ms")).kind, "suggestion", "la vuln menor se marca kind:suggestion (va a «Sugerencias», no a «No verificado»)");
  assert.ok(!npm.find((c) => c.name.startsWith("lodash")).kind, "la vuln que bloquea NO se marca como sugerencia (es un hallazgo)");
  assert.ok(npm.every((c) => c.plain && c.action), "cada dependencia vulnerable trae plain + action");
  const dotnet = parseDotnetVulnerable({ stdout: "Project `Api` has vulnerable packages\n   [net8.0]:\n   > Newtonsoft.Json   12.0.1   12.0.1   High   https://github.com/advisories/GHSA-x\n" }, FAIL);
  assert.ok(dotnet.length === 1 && dotnet[0].status === "fail" && /Newtonsoft/.test(dotnet[0].name), "parser dotnet lee la fila `>` con severidad y URL");
  const pip = parsePipAudit({ stdout: JSON.stringify({ dependencies: [{ name: "flask", version: "0.5", vulns: [{ id: "PYSEC-1", severity: "critical", fix_versions: ["2.3.2"], description: "RCE" }] }] }) }, FAIL);
  assert.ok(pip.length === 1 && pip[0].status === "fail" && /flask/.test(pip[0].name), "parser pip-audit lee vulns de una dependencia");
  ok("SCA: parsers npm/dotnet/pip mapean severidad (crítica/alta bloquean, menor = sugerencia) con plain/action");

  // (3) Skips accionables: sin lockfile (npm), sin restore (dotnet), herramienta ausente.
  const noLock = await runSca({ repoRoot: "/repo", exec: () => ({ code: 0, stdout: "", stderr: "" }),
    detect: () => [{ tool: "npm-audit", cwd: "web", label: "web (npm)", hasLock: false }] });
  assert.ok(noLock[0].status === "skip" && /lockfile|npm install/i.test(noLock[0].narrative), "sin lockfile → skip que pide `npm install`");
  const noRestore = await runSca({ repoRoot: "/repo", exec: () => ({ code: 1, stdout: "", stderr: "No assets file was found. Run a restore." }),
    detect: () => [{ tool: "dotnet-vulnerable", cwd: "", arg: "Api.csproj", label: "Api.csproj (NuGet)" }] });
  assert.ok(noRestore[0].status === "skip" && /restore/i.test(noRestore[0].narrative), "sin assets → skip que pide `dotnet restore`");
  const missing = await runSca({ repoRoot: "/repo", exec: () => ({ code: 127, stdout: "", stderr: "" }),
    detect: () => [{ tool: "pip-audit", cwd: "", label: "raíz (pip)" }] });
  assert.strictEqual(missing[0].status, "skip", "herramienta ausente (127) → skip, no rompe");
  ok("SCA: skips accionables (sin lockfile / sin restore / herramienta ausente) — nunca rompe el ciclo");

  // (4) Escape hatch: off desactiva; fail_on ajusta el umbral; ignore descarta una dependencia.
  const auditOut = { code: 1, stdout: JSON.stringify({ vulnerabilities: { lodash: { severity: "moderate", via: [{ title: "x", url: "u" }], range: "<1" } } }) };
  const npmTarget = () => [{ tool: "npm-audit", cwd: "", label: "raíz (npm)", hasLock: true }];
  assert.strictEqual((await runSca({ repoRoot: "/r", exec: () => auditOut, detect: npmTarget, profile: { security: { sca: { off: true } } } })).length, 0, "off desactiva SCA");
  const strict = await runSca({ repoRoot: "/r", exec: () => auditOut, detect: npmTarget, profile: { security: { sca: { fail_on: ["moderate", "high", "critical"] } } } });
  assert.strictEqual(strict[0].status, "fail", "fail_on=moderate hace que un moderate bloquee");
  const ignored = await runSca({ repoRoot: "/r", exec: () => auditOut, detect: npmTarget, profile: { security: { sca: { ignore: ["lodash"] } } } });
  assert.strictEqual(ignored[0].status, "pass", "ignore descarta la dependencia y el objetivo queda en verde");
  ok("SCA: escape hatch off / fail_on / ignore respetado");

  // (5) Integración: runSecurityTests incluye los objetos SCA junto al secret-scan y el SAST.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-scaint-"));
  try {
    fs.writeFileSync(path.join(repo, "package.json"), "{}", "utf8");
    fs.writeFileSync(path.join(repo, "package-lock.json"), "{}", "utf8");
    const exec = (cmd, args) => args.includes("audit")
      ? { code: 1, stdout: JSON.stringify({ vulnerabilities: { lodash: { severity: "critical", via: [{ title: "RCE", url: "u" }], range: "<1", fixAvailable: true } } }) }
      : { code: 0, stdout: "", stderr: "" };
    const results = await runSecurityTests({ repoRoot: repo, exec });
    const scaObj = results.find((r) => r.metrics?.tool === "npm-audit");
    assert.ok(scaObj && scaObj.status === "fail", "runSecurityTests corre SCA y reporta la dependencia crítica");
    assert.ok(results.find((r) => r.metrics?.tool === "secret-scan"), "sigue emitiendo el secret-scan");
    ok("SCA: runSecurityTests emite los objetos SCA junto al secret-scan y el SAST");

    // (6) Coherencia en 4 rutas: HU + MD + HTML nombran la dependencia con su explicación.
    const hu = renderFindingsDescription({ results, layersRun: ["security"], when: "w" });
    const rep = renderReport(results);
    for (const [route, s] of [["HU", hu], ["MD", rep.md], ["HTML", rep.html]]) {
      assert.ok(s.includes("lodash"), `${route}: nombra la dependencia vulnerable`);
      assert.ok(/vulnerabilidad conocida/i.test(s), `${route}: explica en lenguaje llano qué es`);
    }
    ok("SCA: HU/MD/HTML muestran la dependencia vulnerable con su explicación (coherente en las 4 rutas)");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }

  // (7) COHERENCIA de security en los 3 escenarios (hallazgo / omitido / limpio) — HU/MD/HTML idénticos:
  //   - un hallazgo (secreto/vuln, sin blame) NO muestra "Sin responsable" en NINGUNA ruta (igual que la HU);
  //   - un skip de SCA (pip-audit ausente) cae en «No verificado» en las 3;
  //   - un objetivo limpio cae en «Evidencia» en las 3.
  const mixed = [
    { layer: "security", status: "fail", metrics: { tool: "secret-scan" }, cases: [
      { name: "Contraseña en una cadena de conexión", status: "fail", message: "src/db.ts:12 → •••", plain: "Se encontró la contraseña de la base en el código.", action: "Rotala y movela a una variable de entorno." } ] },
    { layer: "security", status: "fail", metrics: { tool: "pnpm-audit", label: "raíz (pnpm)" }, cases: [
      { name: "shell-quote (crítica)", status: "fail", message: "https://x/GHSA", plain: "La dependencia «shell-quote» tiene una vulnerabilidad conocida de severidad crítica.", action: "Actualizá la dependencia." } ] },
    { layer: "security", status: "skip", metrics: { tool: "pip-audit", label: "services/python-ml (pip)" }, cases: [
      { name: "Dependencias — services/python-ml (pip)", status: "skip", plain: "No se analizaron las dependencias de «services/python-ml (pip)»: pip-audit no está instalada.", action: "Instalá pip-audit." } ] },
    { layer: "security", status: "pass", metrics: { tool: "dotnet-vulnerable", label: "Api.csproj (NuGet)" }, cases: [
      { name: "Dependencias sin vulnerabilidades conocidas", status: "pass", plain: "Se revisaron las dependencias de «Api.csproj (NuGet)» y ninguna tiene vulnerabilidad conocida." } ] },
  ];
  const hu2 = renderFindingsDescription({ results: mixed, layersRun: ["security"], when: "w" });
  const rep2 = renderReport(mixed);
  for (const [route, s] of [["HU", hu2], ["MD", rep2.md], ["HTML", rep2.html]]) {
    assert.ok(s.includes("shell-quote (crítica)") && s.includes("Contraseña en una cadena de conexión"), `${route}: los hallazgos de security aparecen`);
    assert.ok(!/Sin responsable/.test(s), `${route}: un hallazgo de security NO muestra "Sin responsable" (coherente con la HU)`);
    assert.ok(/No verificado/.test(s) && s.includes("services/python-ml (pip)"), `${route}: el skip de SCA (pip-audit) cae en «No verificado»`);
    assert.ok(/Evidencia/.test(s) && s.includes("Api.csproj (NuGet)"), `${route}: el objetivo limpio cae en «Evidencia»`);
  }
  ok("Security: hallazgo/omitido/limpio COHERENTES en HU/MD/HTML (sin 'Sin responsable', skip→No verificado, pass→Evidencia)");

  // (8) Separación SUGERENCIAS vs NO VERIFICADO: una vuln MEDIA detectada (skip + kind:suggestion) va a
  // «💡 Sugerencias de seguridad», NO a «No verificado» (para que 14 vulns medias no se lean como
  // pruebas saltadas). Un skip por herramienta AUSENTE (pip-audit) sí cae en «No verificado».
  const sep = [
    { layer: "security", status: "fail", metrics: { tool: "npm-audit", label: "raíz (npm)" }, cases: [
      { name: "lodash (alta)", status: "fail", plain: "La dependencia «lodash» tiene una vulnerabilidad de severidad alta.", action: "Actualizá lodash.", message: "https://x/GHSA-1" },
      { name: "postcss (media)", status: "skip", kind: "suggestion", plain: "La dependencia «postcss» tiene una vulnerabilidad conocida de severidad media.", action: "Actualizá postcss.", message: "https://x/GHSA-2" } ] },
    { layer: "security", status: "skip", metrics: { tool: "pip-audit", label: "svc (pip)" }, cases: [
      { name: "Dependencias — svc (pip)", status: "skip", plain: "No se analizaron las dependencias de «svc (pip)»: pip-audit no está instalada.", action: "Instalá pip-audit.", message: "pip-audit" } ] },
  ];
  // Lógica: la vuln media cae en sugerencias (no en no-verificado); el skip por herramienta ausente al revés.
  assert.ok(suggestionCases(sep).some(({ c }) => c.name === "postcss (media)"), "la vuln media es una SUGERENCIA");
  assert.ok(!notVerifiedCases(sep).some(({ c }) => c.name === "postcss (media)"), "la vuln media NO cae en «No verificado»");
  assert.ok(notVerifiedCases(sep).some(({ c }) => /svc \(pip\)/.test(c.name)), "el skip por herramienta ausente SÍ cae en «No verificado»");
  // Render: las 3 rutas muestran la sección propia con la vuln media, y el skip de pip en «No verificado».
  const huSep = renderFindingsDescription({ results: sep, layersRun: ["security"], when: "w" });
  const repSep = renderReport(sep);
  for (const [route, s] of [["HU", huSep], ["MD", repSep.md], ["HTML", repSep.html]]) {
    assert.ok(/Sugerencias de seguridad/.test(s) && s.includes("postcss (media)"), `${route}: la vuln media va a «Sugerencias de seguridad»`);
    assert.ok(/No verificado/.test(s) && s.includes("svc (pip)"), `${route}: el skip por herramienta ausente va a «No verificado»`);
  }
  // La vuln media NO debe aparecer dentro del BLOQUE «No verificado» del md (quedó en la sección de
  // arriba). Se acota a esa sección (hasta el siguiente encabezado «## …»); «Detalle por capa» que viene
  // después SÍ lista todos los casos, por eso no se incluye en la comprobación.
  const rest = repSep.md.slice(repSep.md.indexOf("## ⏭ No verificado") + 4);
  const nextSec = rest.indexOf("\n## ");
  const novBlock = nextSec >= 0 ? rest.slice(0, nextSec) : rest;
  assert.ok(!novBlock.includes("postcss (media)"), "MD: la vuln media NO está en la sección «No verificado»");
  ok("SCA: las vulns medias/bajas (detectadas, no bloquean) van a «💡 Sugerencias de seguridad», separadas de «⏭ No verificado» — no se leen como pruebas saltadas");
}
