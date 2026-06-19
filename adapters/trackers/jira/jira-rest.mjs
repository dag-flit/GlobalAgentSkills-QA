// jira-rest.mjs — cliente REST mínimo de Jira Cloud (API v3). Único lugar con rutas/auth.
// Transporte HTTP inyectable (fetch por defecto) → offline-testable. base/email/token y
// project key salen de env. Auth Basic email:token. Cross-platform (Node 18+).

import { Buffer } from "node:buffer";

const V = "3";

export async function defaultHttp(req) {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON (p.ej. 204 sin cuerpo) */
  }
  return { status: res.status, json, text };
}

// Documento ADF mínimo a partir de texto plano (Jira v3 exige ADF en body/description).
export function adf(text) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: String(text || "") }] }] };
}

export function createClient({ env = {}, http = defaultHttp } = {}) {
  const base = String(env.JIRA_BASE_URL || "").replace(/\/+$/, "");
  const rest = `${base}/rest/api/${V}`;
  const auth = "Basic " + Buffer.from(`${env.JIRA_EMAIL || ""}:${env.JIRA_TOKEN || ""}`).toString("base64");
  const headers = (extra = {}) => ({ Authorization: auth, Accept: "application/json", ...extra });

  return {
    base,
    project: env.JIRA_PROJECT_KEY || "",
    myself() {
      return http({ method: "GET", url: `${rest}/myself`, headers: headers() });
    },
    getIssue(key) {
      return http({ method: "GET", url: `${rest}/issue/${key}`, headers: headers() });
    },
    addComment(key, body) {
      return http({
        method: "POST",
        url: `${rest}/issue/${key}/comment`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ body }),
      });
    },
    createIssue(fields) {
      return http({
        method: "POST",
        url: `${rest}/issue`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ fields }),
      });
    },
    updateIssue(key, fields) {
      return http({
        method: "PUT",
        url: `${rest}/issue/${key}`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ fields }),
      });
    },
    transition(key, transitionId) {
      return http({
        method: "POST",
        url: `${rest}/issue/${key}/transitions`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ transition: { id: String(transitionId) } }),
      });
    },
  };
}

export default { createClient, defaultHttp, adf };
