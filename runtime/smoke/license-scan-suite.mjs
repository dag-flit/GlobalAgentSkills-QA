// license-scan-suite.mjs — cumplimiento de licencias (capa security). Verifica OFFLINE (listInstalled/
// projectLicense inyectables; fixtures en disco solo para la integración): (1) clasificación SPDX
// (permissive/weak/strong/unknown, con doble licencia OR → la menos restrictiva); (2) autonomía: proyecto
// PROPIETARIO + copyleft fuerte → falla (conflicto objetivo), postura no clara → sugerencia; (3) escape
// hatch off/deny/allow/ignore; (4) sin node_modules → skip accionable; (5) integración en runSecurityTests;
// (6) coherencia HU/MD/HTML (hallazgo con action, sin "Sin responsable", con el nombre de la dependencia).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLicenses, classifyLicense } from "../runners/license-scan.mjs";
import { runSecurityTests } from "../runners/security.mjs";
import { renderFindingsDescription } from "../evidence/findings-workitem.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

function renderReport(results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lic-"));
  try {
    const r = writeLocalReport({ repoRoot: dir, profile: {}, workItemId: "local", results });
    return { md: fs.readFileSync(r.mdPath, "utf8"), html: fs.readFileSync(r.htmlPath, "utf8") };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const installed = (list) => (list.length ? () => list : () => list); // helper legible
const proj = (posture) => () => posture;

export async function run(ctx) {
  const { ok } = ctx;

  // (1) Clasificación SPDX de alta confianza.
  assert.strictEqual(classifyLicense("MIT"), "permissive", "MIT es permisiva");
  assert.strictEqual(classifyLicense("Apache-2.0"), "permissive", "Apache-2.0 es permisiva");
  assert.strictEqual(classifyLicense("LGPL-3.0"), "weak", "LGPL es copyleft débil");
  assert.strictEqual(classifyLicense("MPL-2.0"), "weak", "MPL es copyleft débil");
  assert.strictEqual(classifyLicense("GPL-3.0"), "strong", "GPL es copyleft fuerte");
  assert.strictEqual(classifyLicense("AGPL-3.0"), "strong", "AGPL es copyleft fuerte");
  assert.strictEqual(classifyLicense("GPL-3.0 OR MIT"), "permissive", "doble licencia → se elige la permisiva (MIT)");
  assert.strictEqual(classifyLicense("UNLICENSED"), "unknown", "UNLICENSED = sin licencia reconocible");
  assert.strictEqual(classifyLicense(""), "unknown", "sin campo de licencia = desconocida");
  ok("Licencias: clasificación SPDX (permissive/weak/strong/unknown, doble licencia OR)");

  const deps = [
    { name: "left-pad", version: "1.0.0", license: "MIT" },
    { name: "copyleftlib", version: "2.1.0", license: "GPL-3.0" },
    { name: "weaklib", version: "1.2.0", license: "LGPL-2.1" },
    { name: "customlib", version: "0.1.0", license: "" },
  ];

  // (2) Autonomía: proyecto PROPIETARIO + copyleft fuerte → conflicto (fail); postura no clara → sugerencia.
  const asProprietary = await scanLicenses("/r", { listInstalled: installed(deps), projectLicense: proj({ private: true }) });
  const strongCase = asProprietary.cases.find((c) => /copyleft fuerte/i.test(c.name));
  assert.ok(asProprietary.status === "fail" && strongCase.status === "fail", "propietario + GPL → falla (conflicto objetivo)");
  assert.ok(/copyleftlib@2\.1\.0/.test(strongCase.message) && strongCase.plain && strongCase.action, "nombra la dependencia y trae plain/action");
  assert.ok(asProprietary.cases.some((c) => /copyleft débil/i.test(c.name) && c.status === "skip"), "LGPL → sugerencia (skip)");
  assert.ok(asProprietary.cases.some((c) => /no declarada/i.test(c.name) && c.status === "skip"), "sin licencia → sugerencia (skip)");

  const asPermissive = await scanLicenses("/r", { listInstalled: installed(deps), projectLicense: proj({ license: "MIT" }) });
  const strong2 = asPermissive.cases.find((c) => /copyleft fuerte/i.test(c.name));
  assert.ok(asPermissive.status !== "fail" && strong2.status === "skip", "postura no propietaria → el copyleft fuerte es sugerencia, no falla (no imponemos postura)");
  ok("Licencias: autónomo — propietario+GPL falla (conflicto), postura no clara = sugerencia (invariante 9)");

  // (3) Escape hatch: off / deny / allow / ignore.
  assert.strictEqual((await scanLicenses("/r", { listInstalled: installed(deps), profile: { security: { licenses: { off: true } } } })).cases.length, 0, "off desactiva");
  const denied = await scanLicenses("/r", { listInstalled: installed(deps), projectLicense: proj({ license: "MIT" }), profile: { security: { licenses: { deny: ["gpl"] } } } });
  assert.strictEqual(denied.status, "fail", "deny=[gpl] fuerza el fallo aunque el proyecto no sea propietario");
  const allowed = await scanLicenses("/r", { listInstalled: installed([{ name: "copyleftlib", version: "2.1.0", license: "GPL-3.0" }]), projectLicense: proj({ private: true }), profile: { security: { licenses: { allow: ["gpl-3.0"] } } } });
  assert.strictEqual(allowed.status, "pass", "allow=[gpl-3.0] la deja pasar → objetivo limpio");
  const ignored = await scanLicenses("/r", { listInstalled: installed([{ name: "copyleftlib", version: "2.1.0", license: "GPL-3.0" }]), projectLicense: proj({ private: true }), profile: { security: { licenses: { ignore: ["copyleftlib"] } } } });
  assert.strictEqual(ignored.status, "pass", "ignore=[copyleftlib] descarta la dependencia por nombre");
  ok("Licencias: escape hatch off / deny / allow / ignore respetado");

  // (4) Sin dependencias instaladas → skip accionable (las licencias son artefacto del repo, no del kit).
  const noNm = await scanLicenses("/r", { listInstalled: () => [] });
  assert.ok(noNm.status === "skip" && /node_modules/i.test(noNm.cases[0].plain) && noNm.cases[0].action, "sin node_modules → skip que pide instalar dependencias");
  ok("Licencias: sin node_modules → skip accionable, nunca rompe el ciclo");

  // (5) Integración con fs real: runSecurityTests emite el objeto license-scan junto al secret-scan.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-licint-"));
  try {
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "app", private: true }), "utf8");
    fs.mkdirSync(path.join(repo, "node_modules", "gpllib"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "gpllib", "package.json"), JSON.stringify({ name: "gpllib", version: "1.0.0", license: "AGPL-3.0" }), "utf8");
    fs.mkdirSync(path.join(repo, "node_modules", "mitlib"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "mitlib", "package.json"), JSON.stringify({ name: "mitlib", version: "2.0.0", license: "MIT" }), "utf8");
    const results = await runSecurityTests({ repoRoot: repo, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    const lic = results.find((r) => r.metrics?.tool === "license-scan");
    assert.ok(lic && lic.status === "fail", "runSecurityTests corre el escáner de licencias y detecta el conflicto AGPL");
    assert.ok(results.find((r) => r.metrics?.tool === "secret-scan"), "sigue emitiendo el secret-scan");
    ok("Licencias: runSecurityTests emite el objeto license-scan junto al secret-scan y el SAST");

    // (6) Coherencia HU/MD/HTML: el hallazgo aparece, con su acción y SIN "Sin responsable" (como la HU).
    const hu = renderFindingsDescription({ results, layersRun: ["security"], when: "w" });
    const rep = renderReport(results);
    for (const [route, s] of [["HU", hu], ["MD", rep.md], ["HTML", rep.html]]) {
      assert.ok(s.includes("gpllib"), `${route}: nombra la dependencia con licencia conflictiva`);
      assert.ok(/copyleft/i.test(s), `${route}: explica en lenguaje llano qué es (copyleft)`);
      assert.ok(!/Sin responsable/.test(s), `${route}: un hallazgo de licencia NO muestra "Sin responsable" (coherente con la HU)`);
    }
    ok("Licencias: HU/MD/HTML muestran el conflicto de licencia coherente (con acción, sin 'Sin responsable')");
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
}
