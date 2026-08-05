import { importKit } from "./kit";
import type { RegressionTarget, RegressionRecorrido, SelectorCatalogPage } from "@/lib/types";

// Sesión de GRABACIÓN semi-automática (headed, LOCAL). Mantiene un navegador REAL abierto entre
// requests HTTP mientras el usuario navega la app: inicia sesión solo, cosecha cada pantalla completa
// y registra los clics/escrituras como el guion. Al terminar arma el recorrido + catálogo. El registro
// vive en memoria del proceso (una grabación es corta); se aísla por tenant. Solo en el servidor.

interface Screen { name: string; nodes: any[]; actions: any[] }
interface Session {
  id: string; tenantId: string; targetId: string; name: string; entryRoute: string;
  browser: any; page: any; screens: Screen[]; ready: boolean; harvesting: boolean;
  error: string | null; closed: boolean;
}

// El registro DEBE vivir en globalThis: Next.js (dev) compila cada ruta por separado y NO comparte el
// estado a nivel de módulo entre start/status/stop → cada ruta vería un Map distinto (la sesión "se
// perdía" y el stop no guardaba nada). globalThis es único por proceso y sobrevive a la recompilación.
const SESSIONS: Map<string, Session> = ((globalThis as any).__qaRecorderSessions ??= new Map<string, Session>());

function rid(): string {
  // id opaco sin depender de crypto del cliente; único por proceso.
  return `rec_${Date.now().toString(36)}_${SESSIONS.size}_${Math.floor(performance.now())}`;
}

async function loadChromium(): Promise<any> {
  try {
    const pw: any = await import("playwright");
    return pw.chromium ?? pw.default?.chromium;
  } catch {
    return null;
  }
}

// Cierra y descarta CUALQUIER grabación previa de este tenant. Se llama al iniciar una nueva: garantiza
// una sola grabación activa por tenant y mata navegadores "zombis" que hubieran quedado en segundo plano.
async function closeTenantSessions(tenantId: string) {
  for (const [id, s] of SESSIONS) {
    if (s.tenantId !== tenantId) continue;
    s.closed = true;
    try { await s.browser.close(); } catch { /* best-effort */ }
    SESSIONS.delete(id);
  }
}

// Cosecha la pantalla actual (best-effort) y la deja como nodos de la pantalla en curso. Se llama al
// llegar a una pantalla y tras cada acción (para captar elementos revelados al interactuar).
async function harvestCurrent(s: Session, readVisibleNodes: any, timeout: number) {
  if (s.harvesting || s.closed || !s.screens.length) return;
  s.harvesting = true;
  try {
    const nodes = await readVisibleNodes(s.page, timeout);
    if (Array.isArray(nodes) && nodes.length) s.screens[s.screens.length - 1].nodes = nodes;
  } catch {
    /* cosecha best-effort */
  } finally {
    s.harvesting = false;
  }
}

export async function startRecording(opts: { tenantId: string; target: RegressionTarget; entryRoute: string; name: string; overrideUser?: string; overridePass?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const chromium = await loadChromium();
  if (!chromium) return { ok: false, error: "Playwright (chromium) no está disponible en el servidor." };

  // Una sola grabación activa por tenant: cerrar cualquier previa (evita navegadores en segundo plano).
  await closeTenantSessions(opts.tenantId);

  const { readVisibleNodes, joinUrl } = await importKit("runtime/regression/scan.mjs");
  const { RECORDER_SCRIPT } = await importKit("runtime/regression/recorder.mjs");
  const { STEPS, settleSpa } = await importKit("runtime/runners/explore-steps.mjs");

  const timeout = 20000;
  // Credenciales del login: por defecto las del sistema; si se pasa un override efímero (grabar con
  // otra cuenta), gana ese (no se persiste — vive solo en esta sesión de grabación).
  const vars: Record<string, string> = {};
  if (opts.target.authMode === "login") {
    vars.QA_USER = opts.overrideUser?.trim() ? opts.overrideUser : opts.target.username;
    vars.QA_PASS = opts.overridePass ? opts.overridePass : opts.target.password;
  }

  let browser: any;
  try {
    browser = await chromium.launch({ headless: false }); // HEADED: se abre en la máquina del usuario (local)
    const context = await browser.newContext();
    const page = await context.newPage();
    const s: Session = { id: rid(), tenantId: opts.tenantId, targetId: opts.target.id, name: opts.name, entryRoute: opts.entryRoute || "", browser, page, screens: [], ready: false, harvesting: false, error: null, closed: false };

    // Binding: cada interacción del usuario en la página llega acá y se guarda en la pantalla en curso.
    await page.exposeBinding("__qaRecord", (_src: any, d: any) => {
      if (!s.ready || s.closed || !s.screens.length) return;
      s.screens[s.screens.length - 1].actions.push(d);
      harvestCurrent(s, readVisibleNodes, timeout); // re-cosecha: capta lo que la acción revele
    });
    await page.addInitScript(RECORDER_SCRIPT);

    // Nueva navegación del frame principal = nueva pantalla (cuando ya estamos grabando).
    page.on("framenavigated", async (f: any) => {
      if (!s.ready || s.closed || f !== page.mainFrame()) return;
      try {
        await settleSpa(page, timeout);
        s.screens.push({ name: `Pantalla ${s.screens.length + 1}`, nodes: [], actions: [] });
        await harvestCurrent(s, readVisibleNodes, timeout);
      } catch {
        /* best-effort */
      }
    });
    browser.on("disconnected", () => { s.closed = true; });

    // Entrar + login, LUEGO empezar a grabar (así la navegación del login no crea pantallas espurias).
    await page.goto(joinUrl(opts.target.baseUrl, opts.entryRoute || ""), { waitUntil: "load", timeout });
    await settleSpa(page, timeout);
    if (opts.target.authMode === "login") {
      const r = await STEPS.login({ page, args: {}, env: process.env, vars, timeout });
      if (!r.ok) { await browser.close().catch(() => {}); return { ok: false, error: `No se pudo iniciar sesión: ${r.message}` }; }
      await settleSpa(page, timeout);
    }
    s.screens.push({ name: "Pantalla 1", nodes: [], actions: [] });
    await harvestCurrent(s, readVisibleNodes, timeout);
    s.ready = true;

    SESSIONS.set(s.id, s);
    return { ok: true, id: s.id };
  } catch (e: any) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, error: e?.message ?? "No se pudo iniciar la grabación." };
  }
}

// Descarta una grabación SIN guardar: cierra el navegador y borra la sesión. Idempotente (si ya no
// existe, devuelve ok). Sirve para abandonar y arrancar de nuevo (p.ej. con otra cuenta).
export async function cancelRecording(tenantId: string, id: string): Promise<{ ok: boolean }> {
  const s = SESSIONS.get(id);
  if (!s || s.tenantId !== tenantId) return { ok: true };
  SESSIONS.delete(id);
  s.closed = true;
  try { await s.browser.close(); } catch { /* best-effort */ }
  return { ok: true };
}

export function recordingStatus(tenantId: string, id: string): { ok: boolean; closed?: boolean; screens?: number; actions?: number; url?: string; error?: string } {
  const s = SESSIONS.get(id);
  if (!s || s.tenantId !== tenantId) return { ok: false, error: "La grabación no existe o ya terminó." };
  const actions = s.screens.reduce((n, sc) => n + sc.actions.length, 0);
  // Navegador cerrado a mano: seguimos con lo capturado (el usuario puede guardarlo o descartarlo).
  if (s.closed) return { ok: true, closed: true, screens: s.screens.length, actions, url: "" };
  let url = "";
  try { url = s.page.url(); } catch { /* */ }
  return { ok: true, screens: s.screens.length, actions, url };
}

export async function stopRecording(tenantId: string, id: string): Promise<{ ok: boolean; targetId?: string; recorrido?: RegressionRecorrido; catalogPages?: SelectorCatalogPage[]; screens?: number; actions?: number; error?: string }> {
  const s = SESSIONS.get(id);
  if (!s || s.tenantId !== tenantId) return { ok: false, error: "La grabación no existe o ya terminó." };
  SESSIONS.delete(id);
  const { readVisibleNodes } = await importKit("runtime/regression/scan.mjs");
  const { buildRecordedRecorrido } = await importKit("runtime/regression/recorder.mjs");
  try {
    if (!s.closed) await harvestCurrent(s, readVisibleNodes, 20000); // cosecha final de la pantalla activa
  } catch { /* */ }
  const built = buildRecordedRecorrido({ name: s.name, entryRoute: s.entryRoute, screens: s.screens });
  const actions = s.screens.reduce((n, sc) => n + sc.actions.length, 0);
  try { await s.browser.close(); } catch { /* */ }
  s.closed = true;
  return { ok: true, targetId: s.targetId, recorrido: { ...built.recorrido, id: "", targetId: s.targetId } as RegressionRecorrido, catalogPages: built.catalogPages as SelectorCatalogPage[], screens: s.screens.length, actions };
}
