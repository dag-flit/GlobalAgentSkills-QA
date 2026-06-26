// runtime/smoke/resolver.mjs — fundamentos: deep-merge, resolución de perfil, factory + sink local.
// Casos 1-6. Fija en ctx los valores compartidos (tmp/pDefault/pFlit/res) que usan otros módulos.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { resolveProfile, deepMerge } from "../profile/resolve-profile.mjs";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";

export async function run(ctx) {
  const { ok } = ctx;

  // 1. deep-merge
  const m = deepMerge({ a: { x: 1, y: 2 }, l: [1] }, { a: { y: 9, z: 3 }, l: [2] });
  assert.deepStrictEqual(m, { a: { x: 1, y: 9, z: 3 }, l: [2] });
  ok("deep-merge: objetos se funden, listas/escalares override");

  // 2. resolver: repo sin perfil -> default local-first
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-repo-"));
  const { profile: pDefault, chain: cDefault } = resolveProfile({ repoRoot: tmp });
  assert.strictEqual(pDefault.tracker, "local");
  assert.strictEqual(pDefault.testing.layers_enabled, "auto");
  assert.deepStrictEqual(cDefault, ["default"]);
  ok("resolver: repo sin config -> tracker=local, layers=auto");

  // 3. resolver: proyecto pide perfil flit -> cadena default<-azure-devops<-flit
  const projDir = path.join(tmp, ".qa");
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, "qa-project.profile.yaml"),
    "profile: flit\nproject:\n  name: \"mi-proyecto\"\n");
  const { profile: pFlit, chain: cFlit } = resolveProfile({ repoRoot: tmp });
  assert.strictEqual(pFlit.tracker, "azure-devops");                 // heredado del preset
  assert.strictEqual(pFlit.azure.work_item.certified_tag, "QA_PDN"); // del overlay flit
  assert.strictEqual(pFlit.locale.timezone, "America/Bogota");        // del overlay flit
  assert.strictEqual(pFlit.project.name, "mi-proyecto");              // override del proyecto
  assert.ok(cFlit.includes("default") && cFlit.includes("azure-devops") && cFlit.includes("flit"));
  ok("resolver: overlay flit hereda azure-devops y default (deep-merge correcto)");

  // 4. factory: tracker local -> LocalAdapter; preflight OK sin red
  const adapter = getAdapter({ profile: pDefault, env: {}, repoRoot: tmp });
  assert.strictEqual(adapter.name, "local");
  const pf = await adapter.preflight();
  assert.strictEqual(pf.ok, true);
  assert.strictEqual(adapter.capabilities().network, false);
  ok("factory+local: preflight OK sin red; capabilities.network=false");

  // 5. work item stub (no hay archivo) y evidencia local md+html
  const wi = await adapter.getWorkItem("123");
  assert.strictEqual(wi.stub, true);
  const res = await adapter.publishEvidence(
    { work_item_id: "123" },
    { results: [
      { layer: "static", status: "pass", narrative: "lint sin críticos" },
      { layer: "unit", tc_id: "TC-01", status: "pass" },
      { layer: "e2e", tc_id: "TC-02", status: "fail", narrative: "login redirect roto" },
    ] }
  );
  assert.ok(fs.existsSync(res.mdPath) && fs.existsSync(res.htmlPath));
  const md = fs.readFileSync(res.mdPath, "utf8");
  assert.ok(md.includes("TC-02") && md.includes("❌ fail"));
  ok("local sink: reporte md+html escrito en qa-evidence/");

  // 6. factory: tracker azure-devops -> AzureDevOpsAdapter; preflight falla sin env
  const ado = getAdapter({ profile: pFlit, env: {}, repoRoot: tmp });
  assert.strictEqual(ado.name, "azure-devops");
  const adoPf = await ado.preflight();
  assert.strictEqual(adoPf.ok, false); // faltan variables
  assert.strictEqual(ado.capabilities().custom_fields, true);
  ok("factory+ado: stub selecciona ADO; preflight exige env; caps.custom_fields=true");

  // Exponer a los demás módulos los valores compartidos.
  ctx.tmp = tmp;
  ctx.pDefault = pDefault;
  ctx.pFlit = pFlit;
  ctx.res = res;
}
