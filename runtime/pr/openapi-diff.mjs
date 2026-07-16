// runtime/pr/openapi-diff.mjs — detector DETERMINISTA de cambios que ROMPEN el contrato de una API
// OpenAPI, para el modo PR (E2E). PURO/offline-testable: opera sobre objetos ya parseados; el YAML se
// parsea con un parser INYECTADO (`parseYaml`, lo provee la webapp desde su node_modules) y el contenido
// de los specs (base vs head) llega por un lector INYECTADO (`readFile`, ligado al http de pr-reader).
// SIN binarios externos, SIN red propia, SIN IA → encaja con el resto de runtime/pr/.
//
// SOLO se usa en el modo PR (parte del E2E): la QA de código nunca lo invoca. Silencioso si el PR no
// cambia ningún contrato OpenAPI.
//
// Enfoque "consumidor del API": marcamos ROMPE lo que obliga a cambiar a quien YA consume el endpoint
// (endpoint/operación que desaparece, parámetro/propiedad requerida nueva, respuesta o campo que se
// quita, tipo que cambia). Lo dudoso va como "info" (revisar), no como ruptura.

// Un archivo es un contrato OpenAPI si se llama openapi/swagger.(ya?ml|json) o vive en una carpeta
// openapi/ (alinea con la detección de la capa `api`). Cubre contracts/openapi/core-api.v1.yaml de FLIT.
export function isOpenapiSpecPath(p = "") {
  const s = String(p).toLowerCase();
  return /(^|\/)(openapi|swagger)\.(ya?ml|json)$/.test(s) || /(^|\/)openapi\/[^/]+\.(ya?ml|json)$/.test(s);
}

/** Parsea un spec: JSON nativo; si no es JSON, YAML con el parser inyectado. null si no se puede. */
export function parseSpec(text, { parseYaml } = {}) {
  if (text == null || text === "") return null;
  const t = String(text);
  try { return JSON.parse(t); } catch { /* no es JSON → probamos YAML */ }
  if (typeof parseYaml === "function") {
    try { const o = parseYaml(t); return o && typeof o === "object" ? o : null; } catch { return null; }
  }
  return null; // es YAML y no hay parser inyectado → el llamador avisa (instalar el parser)
}

// Sigue un $ref local (#/components/schemas/X) dentro del mismo documento. Acotado (depth) por si hay ciclo.
function deref(schema, root, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 6) return schema || {};
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/")) {
    const segs = schema.$ref.slice(2).split("/");
    let cur = root;
    for (const s of segs) cur = cur && cur[s];
    return deref(cur, root, depth + 1);
  }
  return schema;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const opsOf = (pathItem) => METHODS.filter((m) => pathItem && pathItem[m] && typeof pathItem[m] === "object");

// Parámetros de una operación (heredando los del path-item) → mapa `${in}:${name}` → {required,type}.
function paramMap(pathItem, op, root) {
  const out = new Map();
  const all = [...(pathItem.parameters || []), ...((op && op.parameters) || [])];
  for (const raw of all) {
    const p = deref(raw, root);
    if (!p || !p.name || !p.in) continue;
    const type = (deref(p.schema || {}, root) || {}).type || "";
    out.set(`${p.in}:${p.name}`, { required: p.in === "path" ? true : !!p.required, type, name: p.name, in: p.in });
  }
  return out;
}

// Esquema del cuerpo/respuesta JSON (primer content type si no hay application/json).
function jsonSchema(bodyOrResp, root) {
  const content = bodyOrResp && bodyOrResp.content;
  if (!content || typeof content !== "object") return null;
  const media = content["application/json"] || content[Object.keys(content)[0]];
  return media && media.schema ? deref(media.schema, root) : null;
}

// Propiedades de un esquema objeto → {name: type} + set de requeridas.
function schemaProps(schema, root) {
  const s = deref(schema || {}, root);
  const props = {};
  const req = new Set(Array.isArray(s.required) ? s.required : []);
  for (const [k, v] of Object.entries(s.properties || {})) props[k] = (deref(v, root) || {}).type || "";
  return { props, req };
}

/**
 * Compara dos documentos OpenAPI y devuelve los cambios que ROMPEN el contrato + los "info" (a revisar).
 * @returns {{ breaking: Array<{kind,method,path,detail}>, info: Array<{kind,method,path,detail}> }}
 */
export function diffOpenapi(oldObj, newObj) {
  const breaking = [];
  const info = [];
  const at = (method, p) => ({ method: method.toUpperCase(), path: p });
  const B = (kind, method, p, detail) => breaking.push({ kind, ...at(method, p), detail });
  const I = (kind, method, p, detail) => info.push({ kind, ...at(method, p), detail });

  const oldPaths = (oldObj && oldObj.paths) || {};
  const newPaths = (newObj && newObj.paths) || {};

  for (const [p, oldItem] of Object.entries(oldPaths)) {
    const newItem = newPaths[p];
    if (!newItem) { B("path-removed", "*", p, "El endpoint completo ya no existe; quien lo llame recibirá 404."); continue; }
    for (const m of opsOf(oldItem)) {
      const oldOp = oldItem[m];
      const newOp = newItem[m];
      if (!newOp) { B("operation-removed", m, p, `Se quitó el método ${m.toUpperCase()} de ${p}.`); continue; }

      // Parámetros.
      const oldP = paramMap(oldItem, oldOp, oldObj);
      const newP = paramMap(newItem, newOp, newObj);
      for (const [key, np] of newP) {
        const op2 = oldP.get(key);
        if (!op2 && np.required) B("param-new-required", m, p, `Nuevo parámetro obligatorio «${np.name}» (${np.in}): las llamadas actuales que no lo envían fallarán.`);
        else if (op2 && !op2.required && np.required) B("param-now-required", m, p, `El parámetro «${np.name}» (${np.in}) pasó a obligatorio.`);
        else if (op2 && np.type && op2.type && np.type !== op2.type) B("param-type-changed", m, p, `El parámetro «${np.name}» cambió de tipo ${op2.type} → ${np.type}.`);
      }
      for (const [key, op2] of oldP) if (!newP.has(key) && op2.required) I("param-removed", m, p, `Se quitó el parámetro obligatorio «${op2.name}» (${op2.in}) — revisá si algún cliente lo envía.`);

      // Cuerpo de la petición: obligatoriedad + propiedades requeridas nuevas.
      const oldBody = oldOp.requestBody;
      const newBody = newOp.requestBody;
      if (newBody) {
        if ((!oldBody || !oldBody.required) && newBody.required) B("body-now-required", m, p, "El cuerpo de la petición pasó a ser obligatorio.");
        const os = schemaProps(jsonSchema(oldBody, oldObj) || {}, oldObj);
        const ns = schemaProps(jsonSchema(newBody, newObj) || {}, newObj);
        for (const r of ns.req) if (!os.req.has(r)) B("request-prop-required", m, p, `El cuerpo exige una propiedad nueva obligatoria «${r}».`);
        for (const [k, nt] of Object.entries(ns.props)) if (os.props[k] && nt && os.props[k] !== nt) B("request-prop-type", m, p, `La propiedad del cuerpo «${k}» cambió de tipo ${os.props[k]} → ${nt}.`);
      }

      // Respuestas: código quitado + propiedades del esquema de respuesta quitadas o con otro tipo.
      const oldResp = oldOp.responses || {};
      const newResp = newOp.responses || {};
      for (const [code, oldR] of Object.entries(oldResp)) {
        if (!newResp[code]) { B("response-removed", m, p, `Se quitó la respuesta ${code}: los clientes que la manejan dejan de recibirla.`); continue; }
        const os = schemaProps(jsonSchema(oldR, oldObj) || {}, oldObj);
        const ns = schemaProps(jsonSchema(newResp[code], newObj) || {}, newObj);
        for (const k of Object.keys(os.props)) if (!(k in ns.props)) B("response-prop-removed", m, p, `La respuesta ${code} ya no incluye el campo «${k}» que los clientes podían estar usando.`);
        for (const [k, ot] of Object.entries(os.props)) if (ns.props[k] && ot && ns.props[k] !== ot) B("response-prop-type", m, p, `El campo «${k}» de la respuesta ${code} cambió de tipo ${ot} → ${ns.props[k]}.`);
      }
    }
  }
  return { breaking, info };
}

/**
 * Orquesta el análisis para todos los specs cambiados del PR. `readFile(path, ref)` (ref="base"|"head")
 * y `parseYaml` inyectados → puro/offline-testable. Silencioso si el PR no cambia ningún contrato.
 * @returns {Promise<{specs:object[], totals:{breaking:number,info:number}, anyBreaking:boolean, checked:number}>}
 */
export async function analyzeApiBreaking({ changedFiles = [], readFile, parseYaml } = {}) {
  const specs = [];
  for (const f of changedFiles) {
    const filename = typeof f === "string" ? f : (f && f.filename) || "";
    const status = typeof f === "string" ? "modified" : (f && f.status) || "modified";
    if (!isOpenapiSpecPath(filename)) continue;
    if (status === "added") { specs.push({ file: filename, status, breaking: [], info: [], note: "contrato NUEVO (no hay versión previa que comparar)." }); continue; }
    if (status === "removed") { specs.push({ file: filename, status, breaking: [{ kind: "spec-removed", method: "*", path: filename, detail: "Se eliminó el contrato completo." }], info: [] }); continue; }
    if (typeof readFile !== "function") { specs.push({ file: filename, status, breaking: [], info: [], error: "no se pudo leer el contenido del spec (lector no disponible)." }); continue; }
    let oldText, newText;
    try { oldText = await readFile(filename, "base"); newText = await readFile(filename, "head"); }
    catch (e) { specs.push({ file: filename, status, breaking: [], info: [], error: `no se pudo leer el spec: ${(e && e.message) || e}` }); continue; }
    const oldObj = parseSpec(oldText, { parseYaml });
    const newObj = parseSpec(newText, { parseYaml });
    if (!oldObj || !newObj) { specs.push({ file: filename, status, breaking: [], info: [], error: "no se pudo interpretar el spec (¿YAML sin parser? instalá el parser en la webapp)." }); continue; }
    const d = diffOpenapi(oldObj, newObj);
    specs.push({ file: filename, status, breaking: d.breaking, info: d.info });
  }
  const totals = {
    breaking: specs.reduce((n, s) => n + (s.breaking ? s.breaking.length : 0), 0),
    info: specs.reduce((n, s) => n + (s.info ? s.info.length : 0), 0),
  };
  return { specs, totals, anyBreaking: totals.breaking > 0, checked: specs.length };
}

export default { isOpenapiSpecPath, parseSpec, diffOpenapi, analyzeApiBreaking };
