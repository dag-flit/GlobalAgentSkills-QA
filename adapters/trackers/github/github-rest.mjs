// github-rest.mjs — cliente REST mínimo de GitHub Issues. Único lugar con rutas/auth.
// Transporte HTTP inyectable (fetch por defecto) → offline-testable. owner/repo y token
// salen de env. Cross-platform (Node 18+).

const API = "https://api.github.com";

export async function defaultHttp(req) {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON */
  }
  return { status: res.status, json, text };
}

export function createClient({ env = {}, http = defaultHttp } = {}) {
  const [owner, repo] = String(env.GITHUB_REPOSITORY || env.GITHUB_REPO || "/").split("/");
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  const base = (env.GITHUB_API_URL || API).replace(/\/+$/, "");
  const repoBase = `${base}/repos/${owner}/${repo}`;
  const headers = (extra = {}) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "qa-kit",
    ...extra,
  });

  return {
    owner,
    repo,
    getRepo() {
      return http({ method: "GET", url: repoBase, headers: headers() });
    },
    getIssue(n) {
      return http({ method: "GET", url: `${repoBase}/issues/${n}`, headers: headers() });
    },
    addComment(n, body) {
      return http({
        method: "POST",
        url: `${repoBase}/issues/${n}/comments`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ body }),
      });
    },
    createIssue(payload) {
      return http({
        method: "POST",
        url: `${repoBase}/issues`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
    updateIssue(n, payload) {
      return http({
        method: "PATCH",
        url: `${repoBase}/issues/${n}`,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
  };
}

export default { createClient, defaultHttp };
