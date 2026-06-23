// ado-rest.mjs — cliente REST mínimo de Azure DevOps. ÚNICO lugar que conoce las rutas
// y la autenticación de ADO. El transporte HTTP es INYECTABLE (`http`) para poder probar
// el adapter offline; por defecto usa `fetch`. Cero literales de organización: org/proyecto
// y PAT salen de `env`. Cross-platform (Node 18+).

import { Buffer } from "node:buffer";

const API = "7.0";
const COMMENTS_API = "7.0-preview.3";

// Cabecera Basic con PAT (usuario vacío, ADO acepta ":PAT").
export function authHeader(pat) {
  return "Basic " + Buffer.from(`:${pat || ""}`).toString("base64");
}

// Transporte por defecto: fetch real. Devuelve { status, json, text }.
export async function defaultHttp(req) {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON (p.ej. página de login si el PAT es inválido) */
  }
  return { status: res.status, json, text };
}

/**
 * Crea un cliente REST de ADO.
 * @param {object} opts
 * @param {object} opts.env   AZURE_ORG_URL, AZURE_PROJECT_NAME, AZURE_PAT
 * @param {function} [opts.http]  transporte inyectable (req) -> {status,json,text}
 */
export function createClient({ env = {}, http = defaultHttp } = {}) {
  const org = (env.AZURE_ORG_URL || "").replace(/\/+$/, "");
  const project = env.AZURE_PROJECT_NAME || "";
  const projBase = `${org}/${encodeURIComponent(project)}/_apis`;
  const headers = (extra = {}) => ({ Authorization: authHeader(env.AZURE_PAT), ...extra });

  return {
    org,
    project,
    // URL REST de un work item (para relaciones padre/hijo).
    workItemUrl: (id) => `${org}/_apis/wit/workItems/${id}`,
    // URL de navegador del work item (para enlaces clicables en comentarios/discussion).
    workItemWebUrl: (id) => `${org}/${encodeURIComponent(project)}/_workitems/edit/${id}`,

    // GET del proyecto — usado por el preflight para validar PAT + acceso.
    getProject() {
      return http({
        method: "GET",
        url: `${org}/_apis/projects/${encodeURIComponent(project)}?api-version=${API}`,
        headers: headers(),
      });
    },

    getWorkItem(id) {
      return http({
        method: "GET",
        url: `${projBase}/wit/workitems/${id}?$expand=fields&api-version=${API}`,
        headers: headers(),
      });
    },

    addComment(id, text) {
      return http({
        method: "POST",
        url: `${projBase}/wit/workItems/${id}/comments?api-version=${COMMENTS_API}`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text }),
      });
    },

    patchWorkItem(id, ops) {
      return http({
        method: "PATCH",
        url: `${projBase}/wit/workitems/${id}?api-version=${API}`,
        headers: headers({ "Content-Type": "application/json-patch+json" }),
        body: JSON.stringify(ops),
      });
    },

    createWorkItem(type, ops) {
      return http({
        method: "POST",
        url: `${projBase}/wit/workitems/$${encodeURIComponent(type)}?api-version=${API}`,
        headers: headers({ "Content-Type": "application/json-patch+json" }),
        body: JSON.stringify(ops),
      });
    },

    // WIQL: consulta de work items. Devuelve { workItems: [{id}], ... }.
    queryByWiql(query) {
      return http({
        method: "POST",
        url: `${projBase}/wit/wiql?api-version=${API}`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query }),
      });
    },

    // Sube un binario y devuelve { id, url } del adjunto (luego se enlaza al WI).
    uploadAttachment(fileName, content) {
      return http({
        method: "POST",
        url: `${projBase}/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=${API}`,
        headers: headers({ "Content-Type": "application/octet-stream" }),
        body: content,
      });
    },
  };
}

export default { createClient, defaultHttp, authHeader };
