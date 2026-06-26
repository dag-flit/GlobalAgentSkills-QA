// runtime/smoke/adapters.mjs — contrato de los trackers (offline, transporte inyectable).
// Casos 11 (ADO), 12 (tc-match+adjuntos), 13 (ciclo dual), 18 (GitHub), 19 (Jira).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { resolveProfile } from "../profile/resolve-profile.mjs";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { runQaCycle } from "../orchestrator.mjs";

export async function run(ctx) {
  const { ok, creds, pFlit, makeFakeAdo } = ctx;

  // 11. adapter ADO real con transporte INYECTABLE (offline): contrato completo
  const repoAdo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ado-"));
  const fake = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 55 } })],
    [(r) => r.method === "GET" && r.url.includes("/wit/workitems/123"), () => ({
      status: 200,
      json: { fields: {
        "System.Title": "Login",
        "System.State": "Resolved",
        "Microsoft.VSTS.Common.AcceptanceCriteria": "<div>Scenario: login ok</div><br>- [ ] valida sesión",
      } },
    })],
    [(r) => r.method === "POST" && r.url.includes("/wit/workitems/$Bug"), () => ({ status: 200, json: { id: 999 } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/77"), () => ({ status: 200, json: { id: 77 } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/123"), () => ({ status: 200, json: { id: 123 } })],
  ]);
  const adoReal = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAdo, http: fake.http });

  // 11a. preflight: con env + proyecto accesible → ok (valida vía REST, no solo presencia)
  const pfOk = await adoReal.preflight();
  assert.strictEqual(pfOk.ok, true);
  assert.ok(fake.find("GET", "/_apis/projects/Proj"));

  // 11b. getWorkItem: mapea título/estado y normaliza AC (HTML → criterios {title,detail})
  const wiReal = await adoReal.getWorkItem("123");
  const critStr = (a) => (typeof a === "string" ? a : a.title || "");
  assert.strictEqual(wiReal.title, "Login");
  assert.strictEqual(wiReal.state, "Resolved");
  assert.ok(wiReal.acceptance_criteria.some((a) => /login ok/i.test(critStr(a))));
  assert.ok(wiReal.acceptance_criteria.some((a) => /valida sesión/i.test(critStr(a))));

  // 11c. publishEvidence dual: resumen en Discussion del padre + reporte local md/html
  const pubAdo = await adoReal.publishEvidence(
    { work_item_id: "123" },
    { results: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto" }] }
  );
  assert.strictEqual(pubAdo.sink, "dual");
  assert.strictEqual(pubAdo.parentCommentId, 55);
  assert.ok(fs.existsSync(pubAdo.local.mdPath) && fs.existsSync(pubAdo.local.htmlPath));
  assert.strictEqual(pubAdo.attachments.uploaded, 0); // sin files[] en este resultado
  const commentReq = fake.find("POST", "/workItems/123/comments");
  assert.ok(JSON.parse(commentReq.body).text.includes("Resumen QA"));

  // 11d. createDefect: crea Bug con el tag de la org (del overlay flit) y enlace al padre
  const bugId = await adoReal.createDefect({ title: "Falla login", description: "pasos", parent_id: "123" });
  assert.strictEqual(bugId, "999");
  const bugOps = JSON.parse(fake.find("POST", "/wit/workitems/$Bug").body);
  assert.ok(bugOps.some((o) => o.path === "/fields/System.Tags" && o.value === "QA_NOVEDAD"));
  assert.ok(bugOps.some((o) => o.path === "/relations/-"));

  // 11e. updateCycle: mapea clave lógica → ref Custom.* del perfil
  const upd = await adoReal.updateCycle("123", { test_start_date: "2026-06-18" });
  assert.strictEqual(upd.ok, true);
  const updOps = JSON.parse(fake.find("PATCH", "/wit/workitems/123").body);
  assert.ok(updOps.some((o) => o.path === "/fields/Custom.TestStartDate"));

  // 11f. closeArtifact: TC aprobado → estado pass del perfil (Closed)
  const closed = await adoReal.closeArtifact("77", { type: "tc", passed: true });
  assert.strictEqual(closed.ok, true);
  assert.strictEqual(closed.state, "Closed");

  // 11g. preflight degrada sin red real: 203 (PAT inválido) → ok:false con detalle
  const fake203 = makeFakeAdo([[(r) => r.url.includes("/_apis/projects/"), () => ({ status: 203, json: null })]]);
  const adoBadPat = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAdo, http: fake203.http });
  const pfBad = await adoBadPat.preflight();
  assert.strictEqual(pfBad.ok, false);
  assert.ok(/PAT/.test(pfBad.detail));

  fs.rmSync(repoAdo, { recursive: true, force: true });
  ok("adapter ADO: preflight REST, getWorkItem/AC, publishEvidence dual, createDefect, updateCycle, closeArtifact");

  // 12. tc-match + adjuntos: el png se sube y se enlaza al Task hijo resuelto por mapping_file
  const repoAtt = fs.mkdtempSync(path.join(os.tmpdir(), "qa-att-"));
  fs.mkdirSync(path.join(repoAtt, ".qa", "mappings"), { recursive: true });
  fs.writeFileSync(path.join(repoAtt, ".qa", "mappings", "wi-123.json"), JSON.stringify({ "TC-1": 4567 }));
  const shot = path.join(repoAtt, "shot.png");
  fs.writeFileSync(shot, "PNGDATA");
  const fakeAtt = makeFakeAdo([
    [(r) => r.method === "POST" && r.url.includes("/wit/attachments"), () => ({ status: 201, json: { id: "att1", url: "https://dev.azure.com/acme/_apis/wit/attachments/att1" } })],
    [(r) => r.method === "PATCH" && r.url.includes("/wit/workitems/4567"), () => ({ status: 200, json: { id: 4567 } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 1 } })],
  ]);
  const adoAtt = getAdapter({ profile: pFlit, env: creds, repoRoot: repoAtt, http: fakeAtt.http });
  const pubAtt = await adoAtt.publishEvidence(
    { work_item_id: "123" },
    { results: [
      { layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "login roto", files: [shot] },
      { layer: "e2e", tc_id: "TC-9", status: "fail", narrative: "sin task", files: [shot] }, // no mapeado → warn
    ] }
  );
  assert.strictEqual(pubAtt.attachments.uploaded, 1);
  assert.strictEqual(pubAtt.attachments.linked[0].taskId, "4567");
  assert.strictEqual(pubAtt.attachments.linked[0].strategy, "mapping_file");
  assert.strictEqual(pubAtt.attachments.unmatched.length, 1);   // TC-9 degrada con aviso, no aborta
  assert.ok(fakeAtt.find("POST", "/wit/attachments"));
  const linkOps = JSON.parse(fakeAtt.find("PATCH", "/wit/workitems/4567").body);
  assert.ok(linkOps.some((o) => o.value && o.value.rel === "AttachedFile"));
  fs.rmSync(repoAtt, { recursive: true, force: true });
  ok("tc-match + adjuntos: png subido y enlazado al Task hijo (mapping_file); no-match degrada con aviso");

  // 13. ciclo dual end-to-end: orquestador con tracker ADO publica resumen en el padre (offline)
  const repoDual = fs.mkdtempSync(path.join(os.tmpdir(), "qa-dual-"));
  fs.writeFileSync(path.join(repoDual, "package.json"), JSON.stringify({ name: "demo", devDependencies: { eslint: "9" } }));
  fs.writeFileSync(path.join(repoDual, ".eslintrc.json"), "{}");
  const fakeDual = makeFakeAdo([
    [(r) => r.method === "GET" && r.url.includes("/_apis/projects/Proj"), () => ({ status: 200, json: { id: "p1" } })],
    [(r) => r.method === "POST" && r.url.includes("/workItems/123/comments"), () => ({ status: 201, json: { id: 77 } })],
  ]);
  const cycleDual = await runQaCycle({
    repoRoot: repoDual, env: creds, profile: pFlit, workItemId: "123", featureId: "10118", developer: "Dev Ñoño Pérez",
    exec: () => ({ code: 0, stdout: "", stderr: "" }), http: fakeDual.http,
  });
  assert.strictEqual(cycleDual.ok, true);
  assert.strictEqual(cycleDual.tracker, "azure-devops");
  assert.ok(cycleDual.preflight && cycleDual.preflight.ok);          // preflight REST corrió y pasó
  assert.strictEqual(cycleDual.report.sink, "dual");
  assert.strictEqual(cycleDual.report.parentCommentId, 77);          // resumen publicado en el padre
  assert.ok(fakeDual.find("POST", "/workItems/123/comments"));
  // FT/dev se propagan al reporte local también con tracker remoto (carpeta unificada con local)
  assert.strictEqual(path.basename(cycleDual.report.local.dir), "FT-10118__Dev-Nono-Perez");
  const staticDual = cycleDual.results.find((r) => r.layer === "static");
  assert.ok(staticDual && staticDual.status === "pass");
  fs.rmSync(repoDual, { recursive: true, force: true });
  ok("ciclo dual: orquestador ADO corre preflight REST + runners y publica resumen en el WI padre");

  // 18. adapter GitHub con transporte inyectable (offline): contrato sobre Issues
  const repoGh = fs.mkdtempSync(path.join(os.tmpdir(), "qa-gh-"));
  fs.mkdirSync(path.join(repoGh, ".qa"), { recursive: true });
  fs.writeFileSync(path.join(repoGh, ".qa", "qa-project.profile.yaml"), "profile: github\n");
  const { profile: pGithub } = resolveProfile({ repoRoot: repoGh });
  assert.strictEqual(pGithub.tracker, "github");
  const ghEnv = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };
  const fakeGh = makeFakeAdo([
    [(r) => r.method === "GET" && /\/repos\/o\/r\/issues\/5$/.test(r.url), () => ({ status: 200, json: { title: "Bug X", state: "open", body: "Scenario: login\n- [ ] valida sesión" } })],
    [(r) => r.method === "GET" && /\/repos\/o\/r$/.test(r.url), () => ({ status: 200, json: { full_name: "o/r" } })],
    [(r) => r.method === "POST" && /\/issues\/5\/comments$/.test(r.url), () => ({ status: 201, json: { id: 88 } })],
    [(r) => r.method === "POST" && /\/repos\/o\/r\/issues$/.test(r.url), () => ({ status: 201, json: { number: 321 } })],
    [(r) => r.method === "PATCH" && /\/issues\/5$/.test(r.url), () => ({ status: 200, json: { number: 5, state: "closed" } })],
  ]);
  const gh = getAdapter({ profile: pGithub, env: ghEnv, repoRoot: repoGh, http: fakeGh.http });
  assert.strictEqual(gh.name, "github");
  assert.strictEqual(gh.capabilities().custom_fields, false);
  assert.ok((await gh.preflight()).ok);
  const ghWi = await gh.getWorkItem("5");
  assert.strictEqual(ghWi.title, "Bug X");
  assert.ok(ghWi.acceptance_criteria.some((a) => /valida sesión/.test(a)));
  const ghPub = await gh.publishEvidence({ work_item_id: "5" }, { results: [{ layer: "e2e", tc_id: "TC-1", status: "fail", narrative: "roto" }] });
  assert.strictEqual(ghPub.commentId, 88);
  assert.ok(fs.existsSync(ghPub.local.mdPath));
  const ghBug = await gh.createDefect({ title: "Falla", description: "pasos" });
  assert.strictEqual(ghBug, "321");
  const ghCreateBody = JSON.parse(fakeGh.calls.find((c) => c.method === "POST" && /\/repos\/o\/r\/issues$/.test(c.url)).body);
  assert.ok(ghCreateBody.labels.includes("qa-defect"));
  assert.strictEqual((await gh.closeArtifact("5", { passed: true })).state, "closed");
  assert.deepStrictEqual(await gh.updateCycle("5", { test_start_date: "x" }), { ok: true, noop: true, reason: "github: sin custom fields (usa labels)" });
  fs.rmSync(repoGh, { recursive: true, force: true });
  ok("adapter GitHub: preflight, getWorkItem/AC, comentario, createDefect+label, closeArtifact; updateCycle no-op");

  // 19. adapter Jira con transporte inyectable (offline): contrato sobre API v3
  const repoJira = fs.mkdtempSync(path.join(os.tmpdir(), "qa-jira-"));
  fs.mkdirSync(path.join(repoJira, ".qa"), { recursive: true });
  fs.writeFileSync(path.join(repoJira, ".qa", "qa-project.profile.yaml"), "profile: jira\n");
  const { profile: pJira } = resolveProfile({ repoRoot: repoJira });
  assert.strictEqual(pJira.tracker, "jira");
  const jiraEnv = { JIRA_BASE_URL: "https://acme.atlassian.net", JIRA_EMAIL: "qa@acme.io", JIRA_TOKEN: "t", JIRA_PROJECT_KEY: "QA" };
  const fakeJira = makeFakeAdo([
    [(r) => r.method === "GET" && /\/rest\/api\/3\/myself$/.test(r.url), () => ({ status: 200, json: { accountId: "a1" } })],
    [(r) => r.method === "GET" && /\/issue\/QA-5$/.test(r.url), () => ({ status: 200, json: { fields: { summary: "Login", status: { name: "In Progress" }, description: "- [ ] valida login" } } })],
    [(r) => r.method === "POST" && /\/issue\/QA-5\/comment$/.test(r.url), () => ({ status: 201, json: { id: "c9" } })],
    [(r) => r.method === "POST" && /\/issue\/QA-5\/transitions$/.test(r.url), () => ({ status: 204, json: null })],
    [(r) => r.method === "PUT" && /\/issue\/QA-5$/.test(r.url), () => ({ status: 204, json: null })],
    [(r) => r.method === "POST" && /\/rest\/api\/3\/issue$/.test(r.url), () => ({ status: 201, json: { key: "QA-42" } })],
  ]);
  const jira = getAdapter({ profile: pJira, env: jiraEnv, repoRoot: repoJira, http: fakeJira.http });
  assert.strictEqual(jira.name, "jira");
  assert.strictEqual(jira.capabilities().custom_fields, true);
  assert.ok((await jira.preflight()).ok);
  const jWi = await jira.getWorkItem("QA-5");
  assert.strictEqual(jWi.title, "Login");
  assert.strictEqual(jWi.state, "In Progress");
  assert.ok(jWi.acceptance_criteria.some((a) => /valida login/.test(a)));
  const jPub = await jira.publishEvidence({ work_item_id: "QA-5" }, { results: [{ layer: "unit", status: "pass" }] });
  assert.strictEqual(jPub.commentId, "c9");
  const jBug = await jira.createDefect({ title: "Falla", description: "pasos" });
  assert.strictEqual(jBug, "QA-42");
  const jBugFields = JSON.parse(fakeJira.calls.find((c) => c.method === "POST" && /\/rest\/api\/3\/issue$/.test(c.url)).body).fields;
  assert.strictEqual(jBugFields.project.key, "QA");
  assert.strictEqual(jBugFields.issuetype.name, "Bug");
  const jUpd = await jira.updateCycle("QA-5", { test_start_date: "2026-06-18" });
  assert.strictEqual(jUpd.ok, true);
  const jUpdFields = JSON.parse(fakeJira.find("PUT", "/issue/QA-5").body).fields;
  assert.ok(Object.prototype.hasOwnProperty.call(jUpdFields, "customfield_10010"));
  const jClose = await jira.closeArtifact("QA-5", { passed: true });
  assert.strictEqual(jClose.transitionId, "31");
  fs.rmSync(repoJira, { recursive: true, force: true });
  ok("adapter Jira: preflight, getWorkItem/AC, comentario ADF, createDefect, updateCycle (customfield), transición");
}
