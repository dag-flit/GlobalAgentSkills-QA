// http-retry.mjs — transporte HTTP por defecto con reintento ante errores de RED transitorios,
// compartido por los adapters remotos (azure-devops / github / jira).
//
// POR QUÉ: con `fetch` (undici) y keep-alive activo (Node 18+), un socket que quedó ocioso
// puede ser cerrado por el servidor (balanceador de ADO/GitHub/Jira) tras unos segundos. Si
// luego se reusa ese socket muerto, `fetch` lanza al instante con un error de conexión que
// undici reporta como un escueto "fetch failed" (causa real `ECONNRESET` / "other side closed"
// / `UND_ERR_SOCKET`). Pasa típicamente tras una pausa larga sin llamadas al tracker (p.ej. el
// preflight al inicio y la publicación al final, con minutos de runners en medio). Un reintento
// descarta el socket obsoleto y abre conexión nueva.
//
// SOLO reintenta ERRORES DE RED (el `fetch` lanza). NUNCA reintenta por el status HTTP: una
// respuesta 4xx/5xx es una respuesta válida del servidor y se devuelve tal cual al adapter.
//
// Idempotencia: los errores objetivo ocurren al ESTABLECER/escribir en un socket muerto, es
// decir ANTES de que el servidor procese la petición → reintentar un POST/PATCH es seguro
// (la petición original nunca llegó). Por eso el reintento aplica a cualquier método.

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const TRANSIENT_MSG = /fetch failed|other side closed|socket hang up|terminated|network|connreset|econnrefused/i;

/** ¿El error lanzado por `fetch` es un fallo de red transitorio (reintentable)? */
export function isTransientNetworkError(err) {
  if (!err) return false;
  const codes = [err.code, err.errno, err.cause?.code, err.cause?.errno].filter(Boolean).map(String);
  if (codes.some((c) => TRANSIENT_CODES.has(c))) return true;
  const msg = `${err.message || ""} ${err.cause?.message || ""}`;
  return TRANSIENT_MSG.test(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Transporte por defecto compartido: fetch real con reintento ante fallos de red.
 * Devuelve { status, json, text } (igual que los defaultHttp originales).
 * @param {object} req  { url, method, headers, body }
 * @param {object} [opts] { retries=2, baseDelayMs=300 }
 */
export async function defaultHttp(req, { retries = 2, baseDelayMs = 300 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* respuesta no-JSON (p.ej. 204 sin cuerpo, o página de login si el token es inválido) */
      }
      return { status: res.status, json, text };
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isTransientNetworkError(e)) throw e;
      await sleep(baseDelayMs * 2 ** attempt); // 300ms, 600ms
    }
  }
  throw lastErr;
}

export default { defaultHttp, isTransientNetworkError };
