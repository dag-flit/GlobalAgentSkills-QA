// runtime/pr/pr-reader.mjs — lector DETERMINISTA de Pull Requests de GitHub (sin IA). Dado un PR
// (o una HU/Feature), lee de la API pública de GitHub: metadatos, archivos cambiados, el "test plan"
// que escribió el dev y los work items (HU/Feature de Azure) vinculados por rama/título/cuerpo.
//
// Es la FUENTE de "qué cambió y a qué HU pertenece" del enfoque PR-driven: el dev despliega, abre su
// PR, y de ahí sacamos qué validar. Todo es texto/entidad (regex + paths), NO hay IA ni heurística
// borrosa. El transporte HTTP es INYECTABLE (`http`) → offline-testable; en producción usa el
// `defaultHttp` compartido (fetch real con reintento). Token opcional (GITHUB_TOKEN): sin él, la API
// pública da 60 req/h; con él, 5000/h y acceso a repos privados.

import { defaultHttp } from "../../adapters/_shared/http-retry.mjs";

const GH_API = "https://api.github.com";

/** Cabeceras estándar de la API REST de GitHub (v2022-11-28). El token va como Bearer si existe. */
function ghHeaders(token) {
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "qa-kit-pr-reader",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** GET a la API de GitHub con mensajes de error accionables (rate-limit / 404 privado). */
async function ghGet(http, url, token) {
  const res = await http({ url, method: "GET", headers: ghHeaders(token) });
  if (res.status === 403 && /rate limit/i.test(`${res.text || ""}`)) {
    throw new Error("GitHub: límite de tasa alcanzado (60/h sin token). Configurá GITHUB_TOKEN para 5000/h.");
  }
  if (res.status === 404) {
    throw new Error(`GitHub 404: ${url} — ¿repo/PR correcto? Si el repo es privado, hace falta GITHUB_TOKEN con acceso.`);
  }
  if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
  return res.json;
}

/** Acepta "https://github.com/owner/repo(.git)" o "owner/repo" → { owner, repo } (o null). */
export function parseRepoUrl(url = "") {
  const s = String(url).trim();
  const m = s.match(/github\.com[/:]([^/]+)\/([^/#?.]+)/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

/** Todas las HU (nº ADO) nombradas explícitamente en un texto ("HU #NNNN", "US NNNN", …). */
function collectHu(s = "") {
  const out = [];
  const re = /(?:Historia de Usuario|User Story|HU|US)\s*[:#]?\s*#?(\d{3,7})/gi;
  let m;
  while ((m = re.exec(s))) out.push(Number(m[1]));
  return out;
}

/**
 * Extrae los CANDIDATOS a work item de Azure vinculados a un PR, SOLO de fuentes confiables — NO
 * adivina raspando números sueltos del título/cuerpo (eso metía el nº del propio PR y referencias
 * ajenas). Fuentes: la RAMA (`agent/10618-slug`, `feature/AB-10618-slug`) y marcadores EXPLÍCITOS
 * (`HU #N`, `US #N`, `User Story #N`, `Feature #N`). El nº del PROPIO PR (`prNumber`) se excluye.
 *
 * Devuelve los candidatos SIN clasificar HU vs Feature: eso lo decide ADO por el `type` real
 * (`prBrief` consulta `getWorkItem` de cada candidato). `featureHint`/`branchWid` orientan la UI y
 * el modo best-effort SIN ADO. Un PR de ajuste en caliente puede no tener ningún candidato → válido.
 * @returns { candidates:number[], featureHint:number|null, branchWid:number|null }
 */
export function extractWorkItems({ title = "", body = "", branch = "", prNumber = null }) {
  const text = `${title}\n${body}`;
  const nums = new Set();

  // Feature explícito (pista de tipo; ADO lo confirma).
  let featureHint = null;
  const fm = text.match(/Feature\s*[:#]?\s*#?(\d{3,7})/i);
  if (fm) {
    featureHint = Number(fm[1]);
    nums.add(featureHint);
  }

  // HU/US explícitas (marcadores, no números sueltos).
  for (const n of collectHu(text)) nums.add(n);

  // Rama: el dev la nombra tras el work item (fuente confiable).
  const bm = String(branch).match(/(?:^|[/_-])(\d{3,7})(?:[-_/]|$)/);
  const branchWid = bm ? Number(bm[1]) : null;
  if (branchWid) nums.add(branchWid);

  // El nº del PROPIO PR NUNCA es un work item (era la causa del "#150 como HU").
  if (prNumber != null) nums.delete(Number(prNumber));

  return { candidates: [...nums].sort((a, b) => a - b), featureHint, branchWid };
}

/**
 * Best-effort SIN ADO (tracker local o preview): separa candidatos en Feature (por el `featureHint`)
 * y HU (el resto), con la primaria = la de la rama si no es el Feature. NO es autoritativo: la webapp
 * con Azure clasifica por el `type` real. Se usa solo para que el brief renderice sin ADO.
 */
export function splitBestEffort({ candidates = [], featureHint = null, branchWid = null }) {
  const feature = featureHint;
  const hus = candidates.filter((n) => n !== feature);
  const primaryHu = branchWid && branchWid !== feature ? branchWid : hus[0] ?? null;
  return { hus, feature, primaryHu };
}

/**
 * Extrae una sección markdown por su encabezado (p.ej. "## Test plan"). Devuelve el texto entre ese
 * encabezado y el siguiente encabezado (de cualquier nivel), sin el encabezado. "" si no existe.
 */
export function extractSection(body = "", headingRe) {
  const lines = String(body).split(/\r?\n/);
  const out = [];
  let capturing = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (capturing) break; // el próximo encabezado cierra la sección
      capturing = headingRe.test(line);
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

/** Líneas del cuerpo que declaran cobertura de criterios ("AC1 …", "Criterio …"). Best-effort. */
export function extractAcClaims(body = "") {
  return String(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && /\b(AC\s*\d+|criterio(?:s)?\b)/i.test(l));
}

/** Lee los archivos cambiados del PR (paginado, 100/pág). Devuelve {filename,status,additions,deletions}. */
export async function readPrFiles({ owner, repo, number, http = defaultHttp, token = "", maxPages = 10 }) {
  const files = [];
  let truncated = false;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${GH_API}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const batch = await ghGet(http, url, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const f of batch) {
      files.push({ filename: f.filename, status: f.status, additions: f.additions ?? 0, deletions: f.deletions ?? 0 });
    }
    if (batch.length < 100) break;
    if (page === maxPages) truncated = true; // GitHub tope 3000 archivos; avisamos si cortamos
  }
  files.truncated = truncated;
  return files;
}

/**
 * Lee el contenido de un archivo en un REF concreto (rama/sha) vía la Contents API. Devuelve el texto
 * decodificado, o null si no existe en ese ref (p.ej. un archivo agregado no existe en la base). Se usa
 * para comparar un contrato OpenAPI entre la base y el head del PR (ver openapi-diff.mjs).
 */
export async function readFileAtRef({ owner, repo, path, ref, http = defaultHttp, token = "" }) {
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  const res = await http({ url, method: "GET", headers: ghHeaders(token) });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`GitHub ${res.status}: contenido de ${path}@${ref}`);
  const j = res.json || {};
  if (typeof j.content === "string" && /base64/i.test(j.encoding || "base64")) {
    return Buffer.from(j.content, "base64").toString("utf8");
  }
  if (typeof j.content === "string") return j.content;
  return null;
}

/**
 * Lee un PR completo (metadatos + archivos + work items vinculados + test plan del dev).
 * @returns { number, title, branch, author, state, merged, body, url, hus, feature, changedFiles,
 *            testPlan, acClaims, baseSha, headSha }
 */
export async function readPr({ owner, repo, number, http = defaultHttp, token = "" }) {
  const pr = await ghGet(http, `${GH_API}/repos/${owner}/${repo}/pulls/${number}`, token);
  const files = await readPrFiles({ owner, repo, number, http, token });
  const branch = pr.head?.ref || "";
  const title = pr.title || "";
  const body = pr.body || "";
  const wi = extractWorkItems({ title, body, branch, prNumber: pr.number });
  const best = splitBestEffort(wi);
  return {
    number: pr.number,
    title,
    branch,
    author: pr.user?.login || "",
    state: pr.state,
    merged: !!pr.merged,
    body,
    url: pr.html_url || "",
    // Candidatos SIN clasificar (fuente confiable) → ADO decide el tipo. Ver prBrief.
    candidates: wi.candidates,
    featureHint: wi.featureHint,
    branchWid: wi.branchWid,
    // Best-effort SIN ADO (para preview/local): NO autoritativo.
    hus: best.hus,
    feature: best.feature,
    primaryHu: best.primaryHu,
    changedFiles: files,
    filesTruncated: !!files.truncated,
    testPlan: extractSection(body, /test\s*plan|plan de prueba/i),
    acClaims: extractAcClaims(body),
    // SHA de base y head → leer el contrato OpenAPI en ambas versiones y diffear (openapi-diff.mjs).
    baseSha: pr.base?.sha || pr.base?.ref || "",
    headSha: pr.head?.sha || pr.head?.ref || branch,
  };
}

/**
 * Busca PRs que mencionan una HU/Feature (nº de work item) vía la Search API de GitHub. Útil para
 * ir de "quiero validar la HU 10511" → los PRs que la desplegaron. Devuelve {number,title,url,state}.
 */
export async function findPrsForWorkItem({ owner, repo, wid, http = defaultHttp, token = "", perPage = 50 }) {
  const q = encodeURIComponent(`repo:${owner}/${repo} type:pr ${wid}`);
  const res = await ghGet(http, `${GH_API}/search/issues?q=${q}&per_page=${perPage}`, token);
  return (res?.items || []).map((it) => ({ number: it.number, title: it.title, url: it.html_url || "", state: it.state }));
}

export default { parseRepoUrl, extractWorkItems, splitBestEffort, extractSection, extractAcClaims, readPrFiles, readPr, readFileAtRef, findPrsForWorkItem };
