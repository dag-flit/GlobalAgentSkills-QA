// openapi-diff-suite.mjs — breaking-change de contrato OpenAPI en el modo PR (E2E). Verifica OFFLINE
// (objetos parseados; readFile/parseYaml inyectables; sin red ni binarios): (1) diffOpenapi detecta las
// rupturas (path/operación eliminada, parámetro a obligatorio, campo de respuesta quitado) y no marca
// nada si no hay cambios; (2) parseSpec JSON nativo / YAML inyectado; (3) isOpenapiSpecPath; (4)
// analyzeApiBreaking sobre archivos cambiados (ignora no-specs, added=nota); (5) el brief plasma la
// sección en MD/HTML/comentario y queda SILENCIOSO sin apiDiff.
import assert from "node:assert";
import { diffOpenapi, parseSpec, isOpenapiSpecPath, analyzeApiBreaking } from "../pr/openapi-diff.mjs";
import { generateBrief, briefComment } from "../pr/brief.mjs";

const OLD = {
  paths: {
    "/users": {
      get: {
        parameters: [{ name: "q", in: "query", required: false, schema: { type: "string" } }],
        responses: { 200: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } }, required: ["id"] } } } } },
      },
      post: { responses: { 201: {} } },
    },
    "/legacy": { get: { responses: { 200: {} } } },
  },
};
const NEW = {
  paths: {
    "/users": {
      get: {
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } } } },
      },
      // post eliminado; /legacy eliminado
    },
  },
};

export async function run(ctx) {
  const { ok } = ctx;

  // (1) diffOpenapi: rupturas detectadas + sin cambios = vacío.
  const d = diffOpenapi(OLD, NEW);
  const kinds = d.breaking.map((b) => b.kind);
  assert.ok(kinds.includes("path-removed"), "detecta el endpoint eliminado (/legacy)");
  assert.ok(kinds.includes("operation-removed"), "detecta la operación eliminada (POST /users)");
  assert.ok(kinds.includes("param-now-required"), "detecta el parámetro que pasó a obligatorio");
  assert.ok(kinds.includes("response-prop-removed"), "detecta el campo de respuesta quitado (name)");
  assert.ok(d.breaking.every((b) => b.method && b.path && b.detail), "cada ruptura trae método+ruta+detalle");
  assert.strictEqual(diffOpenapi(OLD, OLD).breaking.length, 0, "sin cambios → ninguna ruptura");
  ok("OpenAPI diff: detecta path/operación eliminada, parámetro a obligatorio y campo de respuesta quitado (y 0 si no cambia)");

  // (2) parseSpec: JSON nativo; YAML con parser inyectado; null si es YAML sin parser.
  assert.deepStrictEqual(parseSpec('{"a":1}'), { a: 1 }, "JSON se parsea nativo");
  assert.deepStrictEqual(parseSpec("openapi: 3", { parseYaml: () => ({ openapi: "3" }) }), { openapi: "3" }, "YAML con parser inyectado");
  assert.strictEqual(parseSpec("openapi: 3"), null, "YAML sin parser → null (el llamador avisa)");
  // (3) isOpenapiSpecPath.
  assert.ok(isOpenapiSpecPath("contracts/openapi/core-api.v1.yaml"), "reconoce un contrato en carpeta openapi/");
  assert.ok(isOpenapiSpecPath("openapi.json"), "reconoce openapi.json");
  assert.ok(!isOpenapiSpecPath("src/app/page.tsx"), "un componente no es un contrato");
  ok("OpenAPI diff: parseSpec (JSON/YAML inyectado) e isOpenapiSpecPath");

  // (4) analyzeApiBreaking: lee base/head (inyectado), ignora no-specs, marca 'added' como nota.
  const changedFiles = [
    { filename: "contracts/openapi/core-api.v1.yaml", status: "modified" },
    { filename: "src/x.tsx", status: "modified" },
    { filename: "contracts/openapi/new.yaml", status: "added" },
  ];
  const readFile = async (_path, ref) => JSON.stringify(ref === "base" ? OLD : NEW);
  const res = await analyzeApiBreaking({ changedFiles, readFile });
  assert.strictEqual(res.checked, 2, "analiza los 2 specs (ignora el .tsx)");
  assert.ok(res.anyBreaking && res.totals.breaking > 0, "reporta rupturas del spec modificado");
  assert.ok(res.specs.find((s) => s.status === "added" && s.note), "un spec nuevo se marca como nota (sin versión previa)");
  const empty = await analyzeApiBreaking({ changedFiles: [{ filename: "src/x.tsx", status: "modified" }], readFile });
  assert.strictEqual(empty.checked, 0, "sin specs OpenAPI → checked 0 (silencioso)");
  ok("OpenAPI diff: analyzeApiBreaking lee base/head inyectado, ignora no-specs, added=nota, silencioso sin specs");

  // (5) Brief: la sección aparece en MD/HTML/comentario; SIN apiDiff queda en silencio.
  const pr = { number: 5, title: "cambio API", author: "dev", branch: "agent/1-x", state: "open", merged: false, changedFiles: [], feature: null, hus: [], primaryHu: null };
  const withDiff = generateBrief({ pr, husWithAcs: [], apiDiff: res });
  assert.ok(/ROMPEN el contrato/.test(withDiff.markdown) && /\/legacy/.test(withDiff.markdown), "MD: sección de contrato con la ruptura");
  assert.ok(/Contrato de API/.test(withDiff.html) && /\/legacy/.test(withDiff.html), "HTML: tarjeta de contrato con la ruptura");
  const comment = briefComment({ pr, hus: [], apiDiff: res });
  assert.ok(/ROMPEN el contrato/.test(comment) && /\/legacy/.test(comment), "comentario ADO: incluye las rupturas");
  const noDiff = generateBrief({ pr, husWithAcs: [] });
  assert.ok(!/Contrato de API/.test(noDiff.markdown) && !/Contrato de API/.test(noDiff.html), "sin apiDiff → NINGUNA sección de contrato (silencio; QA de código nunca la ve)");
  ok("OpenAPI diff: el brief plasma la sección en MD/HTML/comentario (coherente) y queda silencioso sin apiDiff");
}
