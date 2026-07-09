// runtime/smoke/pr-suite.mjs — lector determinista de PRs de GitHub (runtime/pr/pr-reader.mjs).
// Verifica OFFLINE (http inyectable, sin red ni GitHub real): (1) readPr arma el PR completo y
// vincula HU/Feature + test plan + archivos; (2) los extractores de work items cubren rama/título/
// cuerpo/fallback; (3) parseRepoUrl; (4) findPrsForWorkItem mapea la búsqueda.
import assert from "node:assert";
import {
  readPr,
  extractWorkItems,
  splitBestEffort,
  extractSection,
  extractAcClaims,
  parseRepoUrl,
  findPrsForWorkItem,
} from "../pr/pr-reader.mjs";
import { classifyFile, classifyChangedFiles, areaOf } from "../pr/classify-files.mjs";
import { buildScopeMatrix } from "../pr/scope-matrix.mjs";
import { generateBrief, briefComment } from "../pr/brief.mjs";
import { scaffoldFlow } from "../pr/scaffold.mjs";
import { AzureDevOpsAdapter } from "../../adapters/trackers/azure-devops/azure-devops-adapter.mjs";

// PR de ejemplo estilo FLIT: frontend + backend, con "## Test plan" y vínculo a HU/Feature de ADO.
const PR_BODY = [
  "## Descripción",
  "Implementa la invitación de usuarios corporativos.",
  "",
  "Historia de Usuario: #10511 (Feature #10504) — proyecto ADO FLIT",
  "",
  "## Test plan",
  "- [x] Login con usuario válido",
  "- [x] Enviar invitación y ver el toast de éxito",
  "- AC1: el usuario invitado aparece en la lista",
  "- Criterio 2: no se puede invitar dos veces el mismo correo",
  "",
  "## Notas",
  "Sin migraciones destructivas.",
].join("\n");

const PR_FILES = [
  { filename: "src/pages/Usuarios.tsx", status: "modified", additions: 40, deletions: 5 },
  { filename: "src/components/Login.tsx", status: "modified", additions: 3, deletions: 1 },
  { filename: "api/Controllers/UsersController.cs", status: "modified", additions: 60, deletions: 2 },
  { filename: "api/Migrations/20260701_invites.cs", status: "added", additions: 120, deletions: 0 },
];

function fakeHttp({ pr = {}, files = PR_FILES, search = [] } = {}) {
  return async (req) => {
    const url = req.url;
    if (/\/pulls\/\d+\/files/.test(url)) {
      // segunda página vacía → corta la paginación
      const page = Number((url.match(/[?&]page=(\d+)/) || [])[1] || 1);
      return { status: 200, json: page === 1 ? files : [], text: "" };
    }
    if (/\/pulls\/\d+$/.test(url)) return { status: 200, json: pr, text: "" };
    if (/\/search\/issues/.test(url)) return { status: 200, json: { items: search }, text: "" };
    return { status: 404, json: null, text: "not found" };
  };
}

export async function run(ctx) {
  const { ok } = ctx;

  // (1) readPr: ensambla el PR completo desde metadatos + archivos + cuerpo.
  const pr = {
    number: 110,
    title: "feat(usuarios): invitación corporativa",
    head: { ref: "agent/10511-invitacion-usuarios" },
    user: { login: "dev-juan" },
    state: "closed",
    merged: true,
    html_url: "https://github.com/flitsas/flit/pull/110",
    body: PR_BODY,
  };
  const http = fakeHttp({ pr });
  const r = await readPr({ owner: "flitsas", repo: "flit", number: 110, http, token: "" });
  assert.strictEqual(r.number, 110);
  assert.strictEqual(r.author, "dev-juan");
  assert.strictEqual(r.branch, "agent/10511-invitacion-usuarios");
  assert.deepStrictEqual(r.candidates, [10504, 10511], "candidatos: Feature + HU (fuentes confiables)");
  assert.deepStrictEqual(r.hus, [10511], "best-effort: HU (sin el Feature)");
  assert.strictEqual(r.primaryHu, 10511, "best-effort: HU primaria = la de la rama");
  assert.strictEqual(r.feature, 10504, "detecta el Feature del cuerpo");
  assert.strictEqual(r.changedFiles.length, 4);
  assert.ok(r.testPlan.includes("Enviar invitación"), "extrae el 'Test plan' del dev");
  assert.ok(!r.testPlan.includes("Sin migraciones"), "el test plan corta en el próximo encabezado");
  assert.ok(r.acClaims.some((l) => /AC1/.test(l)) && r.acClaims.some((l) => /Criterio 2/.test(l)), "captura las afirmaciones de AC del dev");
  ok("lector de PR: ensambla metadatos + archivos + test plan del dev y vincula HU/Feature de ADO (rama/cuerpo)");

  // (2) extractWorkItems: CANDIDATOS solo de fuentes confiables (NO adivina por números sueltos).
  assert.deepStrictEqual(extractWorkItems({ title: "HU 10542 y HU #10543" }).candidates, [10542, 10543], "marcadores HU explícitos");
  assert.strictEqual(extractWorkItems({ body: "cierra Feature #10534" }).featureHint, 10534, "pista de Feature");
  // el nº del PROPIO PR se excluye (era el bug "#150 como HU").
  const wi150 = extractWorkItems({ title: "fix: ajustes QA del Feature #10618 #150", branch: "agent/frontend/10618-fix", prNumber: 150 });
  assert.ok(!wi150.candidates.includes(150), "el nº del propio PR NO es candidato");
  assert.deepStrictEqual(wi150.candidates, [10618], "solo el work item de la rama/marcador (Feature 10618)");
  // números SUELTOS del cuerpo (sin marcador ni rama) NO se raspan.
  assert.deepStrictEqual(extractWorkItems({ body: "ver también #10777 y el ticket 12345" }).candidates, [], "no adivina por números sueltos");
  // la rama es fuente confiable.
  assert.deepStrictEqual(extractWorkItems({ branch: "feature/10600-x" }).candidates, [10600], "candidato de la rama");
  // splitBestEffort (sin ADO): Feature aparte, resto HU, primaria = rama si no es el Feature.
  const be = splitBestEffort(extractWorkItems({ title: "Feature #10534 (HU 10542)", branch: "feature/AB-10534-x" }));
  assert.deepStrictEqual(be.hus, [10542], "best-effort: el nº del Feature en la rama no es HU");
  assert.strictEqual(be.feature, 10534);
  // extractSection y acClaims aislados
  assert.strictEqual(extractSection("## Test plan\nA\nB\n## Otro\nC", /test plan/i), "A\nB");
  assert.deepStrictEqual(extractAcClaims("hola\nAC1 vale\nnada"), ["AC1 vale"]);
  ok("lector de PR: candidatos SOLO de rama+marcadores (excluye el nº del PR, no raspa sueltos), sección markdown y AC");

  // (3) parseRepoUrl y (4) findPrsForWorkItem.
  assert.deepStrictEqual(parseRepoUrl("https://github.com/flitsas/flit"), { owner: "flitsas", repo: "flit" });
  assert.deepStrictEqual(parseRepoUrl("flitsas/flit.git"), { owner: "flitsas", repo: "flit" });
  assert.strictEqual(parseRepoUrl("no es una url"), null);
  const httpSearch = fakeHttp({ search: [{ number: 118, title: "feat: actores", html_url: "u", state: "open" }] });
  const found = await findPrsForWorkItem({ owner: "flitsas", repo: "flit", wid: "10542", http: httpSearch });
  assert.deepStrictEqual(found, [{ number: 118, title: "feat: actores", url: "u", state: "open" }]);
  ok("lector de PR: parseRepoUrl (url/slug) y findPrsForWorkItem (Search API → PRs que mencionan la HU)");

  // (5) classify-files: separa la superficie E2E (paths REALES del PR #110 de flitsas/flit).
  assert.strictEqual(classifyFile("frontend/app/empresa/usuarios/page.tsx").category, "frontend-visible");
  assert.strictEqual(classifyFile("frontend/app/empresa/usuarios/page.tsx").area, "usuarios", "usa el dir cuando el archivo es page.tsx");
  assert.strictEqual(classifyFile("frontend/components/atom/Login.tsx").e2e, true);
  assert.strictEqual(classifyFile("frontend/components/atom/Login.tsx").area, "login");
  assert.strictEqual(classifyFile("frontend/components/atom/__tests__/Login.test.tsx").category, "test", "los tests no son objetivo E2E");
  assert.strictEqual(classifyFile("frontend/lib/api/types/procedure-runtime.ts").category, "frontend-support", "lógica/tipos del front no es UI visible");
  assert.strictEqual(classifyFile("services/core-api/src/Flit.Infrastructure/Migrations/x.cs").category, "backend");
  assert.strictEqual(classifyFile("contracts/openapi/core-api.v1.yaml").category, "infra");
  assert.strictEqual(classifyFile("docs/plan-implementacion.md").category, "docs");
  assert.strictEqual(areaOf("frontend/components/operacion/ActorsForm.tsx"), "actorsform");
  ok("clasificador E2E: frontend-visible vs support/backend/infra/docs/test por ruta+extensión, con área funcional");

  // (6) classifyChangedFiles: resume la superficie E2E de un PR mixto.
  const cc = classifyChangedFiles(PR_FILES.map((f) => f.filename));
  assert.strictEqual(cc.hasE2eSurface, true);
  assert.deepStrictEqual(cc.e2eAreas, ["login", "usuarios"], "áreas E2E únicas y ordenadas");
  assert.strictEqual(cc.e2eFiles.length, 2, "solo Usuarios.tsx y Login.tsx son objetivo E2E");
  assert.strictEqual(cc.counts.backend, 2, "el controller y la migración .cs son backend");
  ok("clasificador E2E: classifyChangedFiles resume la superficie E2E (áreas + conteos) de un PR mixto");

  // (7) scope-matrix: expande un AC narrativo en escenarios MÁS ALLÁ del happy path.
  const acs = [
    { title: "El administrador invita a un usuario por correo", detail: "Solo con el rol adecuado; no se puede invitar dos veces el mismo correo" },
  ];
  const m = buildScopeMatrix({ acs, e2eAreas: ["usuarios"], testPlan: "lint, build, test 539/541", acClaims: [] });
  const techs = m.acScenarios[0].scenarios.map((s) => s.technique);
  assert.ok(techs.includes("camino_feliz"));
  assert.ok(techs.includes("permisos_rbac"), "detecta RBAC por 'rol'");
  assert.ok(techs.includes("validacion_negativa"), "correo/duplicado → validación negativa");
  assert.ok(techs.includes("estado_error"));
  assert.deepStrictEqual(
    m.areaScenarios[0].scenarios.map((s) => s.technique),
    ["camino_feliz", "regresion_adyacente", "no_funcional"],
  );
  // El dev corrió CI (lint/build/test) → NO cubre nada funcional → TODO es gap-QA.
  assert.strictEqual(m.summary.devCovered, 0, "un test plan de CI no cubre escenarios funcionales");
  assert.strictEqual(m.summary.gaps, m.summary.total);
  ok("scope-matrix: expande cada AC (negativa/límite/RBAC/error) + área (carga/regresión/consola); CI del dev = 0 cubierto");

  // (8) dev-cubierto: un test plan que describe el happy path marca camino_feliz cubierto, pero los
  // negativos siguen siendo gap (el dev no probó lo inválido). Las tildes no rompen el match.
  const m2 = buildScopeMatrix({ acs, e2eAreas: [], testPlan: "El administrador invita al usuario por correo y ve el éxito", acClaims: [] });
  const feliz = m2.acScenarios[0].scenarios.find((s) => s.technique === "camino_feliz");
  assert.strictEqual(feliz.devCovered, true, "el happy path descrito por el dev queda cubierto (aun con tildes)");
  const neg = m2.acScenarios[0].scenarios.find((s) => s.technique === "validacion_negativa");
  assert.strictEqual(neg.devCovered, false, "el dev no probó lo inválido → sigue siendo gap de QA");
  ok("scope-matrix: marca dev-cubierto el happy path del dev, pero deja negativos/límite como gap de QA");

  // (9) brief: ensambla PR + clasificación + AC → markdown + HTML auto-contenido accionable.
  const brief = generateBrief({
    pr: {
      number: 110, title: "feat: rol desactivado en login", author: "dev-juan",
      branch: "feature/10511-x", state: "closed", merged: true, feature: 10504, primaryHu: 10511,
      changedFiles: [{ filename: "frontend/components/atom/Login.tsx" }, { filename: "api/x.cs" }],
      testPlan: "lint, build, test", acClaims: [], filesTruncated: false,
    },
    husWithAcs: [{ id: 10511, title: "Aviso de rol desactivado", acs: [{ title: "Si el rol está desactivado, muestra un aviso en el login", detail: "" }] }],
  });
  assert.ok(brief.markdown.includes("Brief de validación QA — PR #110"));
  assert.ok(brief.markdown.includes("HU 10511") && brief.markdown.includes("⭐ primaria"), "marca la HU primaria");
  assert.ok(brief.markdown.includes("🔺 QA"), "el brief lista gaps de QA");
  assert.ok(brief.html.includes("<title>Brief QA — PR #110</title>"), "el HTML es auto-contenido con título");
  assert.deepStrictEqual(brief.data.classification.e2eAreas, ["login"], "la superficie E2E sale de los archivos");
  ok("brief: ensambla PR + superficie E2E + matriz por HU en markdown y HTML auto-contenido (qué validar)");

  // (10) briefComment (fragmento ADO, sin <style>/<html>) + adapter.commentWorkItem lo postea.
  const frag = briefComment({
    pr: { number: 110, title: "rol desactivado", author: "dev", branch: "b", changedFiles: [{ filename: "frontend/components/Login.tsx" }], testPlan: "", acClaims: [] },
    hus: [{ id: "10511", title: "HU", acs: [{ title: "El correo corporativo inválido se rechaza" }] }],
  });
  assert.ok(frag.includes("Brief de validación QA — PR #110"));
  assert.ok(!/<style|<html/i.test(frag), "el fragmento para ADO no lleva <style>/<html>");
  assert.ok(/gap\(s\) de QA/.test(frag), "lista los gaps de QA de la HU");
  let posted = null;
  const fakeClient = { addComment: async (id, text) => { posted = { id, text }; return { status: 200, json: { id: 7 } }; } };
  const adapter = new AzureDevOpsAdapter({ env: {}, profile: {}, adoClient: fakeClient });
  const rc = await adapter.commentWorkItem("10511", frag);
  assert.strictEqual(rc.ok, true);
  assert.strictEqual(posted.id, "10511");
  assert.ok(posted.text.includes("PR #110"), "el comentario que se postea contiene el brief");
  ok("brief PR-driven: fragmento HTML para ADO (sin <style>) + adapter.commentWorkItem lo publica en la HU");

  // (11) scaffold: esqueleto de guion determinista (ir_a → login → 1 verificación por AC → captura),
  // con placeholders y `ac` etiquetado. Ops VÁLIDAS del registro; el humano completa los localizadores.
  const sc = scaffoldFlow({ appUrl: "https://app.test/login", login: true, title: "Login rol", acs: [{ title: "Muestra aviso si el rol está desactivado" }, "El login válido entra"] });
  assert.deepStrictEqual(sc.flow[0], { op: "ir_a", url: "https://app.test/login" });
  assert.deepStrictEqual(sc.flow[1], { op: "login" });
  const verifs = sc.flow.filter((s) => s.op === "verificar_texto");
  assert.strictEqual(verifs.length, 2, "una verificación placeholder por AC");
  assert.strictEqual(verifs[0].ac, "Muestra aviso si el rol está desactivado", "cada verificación etiqueta su AC (cobertura)");
  assert.ok(verifs[0].texto.includes("«completar"), "el texto es un placeholder a completar (no inventa)");
  assert.deepStrictEqual(sc.flow[sc.flow.length - 1], { op: "captura", nombre: "resultado" });
  assert.ok(sc.notes.some((n) => /negativa|RBAC|límites/i.test(n)), "las notas recuerdan agregar los escenarios del brief");
  ok("scaffold: esqueleto de guion determinista (ir_a/login/verificación por AC/captura) con placeholders, sin IA");
}
