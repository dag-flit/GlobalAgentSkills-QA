// explore-steps.mjs — registro de PASOS del guion E2E (núcleo). Cada paso es un handler chico
// que devuelve { ok, message?, file? }. El motor (explore-flow.mjs) los despacha en orden sobre
// una MISMA página, para que la sesión (p.ej. el login) se arrastre. Núcleo: navegación +
// entrada + clic + tecla + esperas + verificaciones + captura. Se crece por categorías en tandas
// siguientes agregando entradas a STEPS (cada una con su caso de smoke); la página/launcher
// siguen inyectables → todo offline-testable.
//
// Interpolación de secretos/variables: cualquier string admite `${VAR}` → vars[VAR] ?? env[VAR].
// Los secretos del login (usuario/clave) NUNCA van en texto plano en el guion: se referencian
// como ${QA_USER}/${QA_PASS} y el valor real llega por env/vars (cifrado aguas arriba, en la webapp).

import fs from "node:fs";
import path from "node:path";

/** Reemplaza `${VAR}` por vars[VAR] ?? env[VAR] (string vacío si no existe). */
export function interpolate(value, { env = {}, vars = {} } = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    const v = vars[name] ?? env[name];
    return v == null ? "" : String(v);
  });
}

// Normaliza un paso a { op, args }. Acepta tres formas (la UX produce {op,...}; las otras son
// atajos cómodos para escribir a mano / en el smoke):
//   "https://x"                          → { op:"ir_a",     args:{ url } }
//   { op:"escribir", en:"#u", valor:"x" } → { op:"escribir", args:{ en, valor } }
//   { clic:"#btn" } / { ir_a:{url:"…"} }  → { op:"clic"|"ir_a", args }
export function normalizeStep(step) {
  if (typeof step === "string") return { op: "ir_a", args: { url: step } };
  if (step && typeof step.op === "string") {
    const { op, ...args } = step;
    return { op, args };
  }
  const keys = Object.keys(step || {});
  if (keys.length === 1) {
    const op = keys[0];
    const val = step[op];
    return { op, args: val && typeof val === "object" ? val : shorthandArg(op, val) };
  }
  return { op: "__desconocido__", args: {} };
}

function shorthandArg(op, val) {
  if (op === "ir_a") return { url: val };
  if (op === "clic" || op === "esperar" || op === "verificar_visible") return { en: val };
  if (op === "esperar_texto" || op === "verificar_texto") return { texto: val };
  if (op === "tecla") return { tecla: val };
  if (op === "captura") return { nombre: val };
  return { valor: val };
}

/** Etiqueta legible del paso para el caso de evidencia. */
export function stepLabel(step, idx) {
  const a = step.args || {};
  const hint = a.url || a.ruta || a.en || a.selector || a.texto || a.tecla || a.nombre || "";
  return `${idx + 1}. ${step.op}${hint ? ` ${hint}` : ""}`;
}

// Resuelve un Locator de Playwright a partir de una estrategia AMIGABLE (`por`) + el valor (`en`),
// para no depender de selectores CSS técnicos. Determinista. Estrategias:
//   etiqueta → getByLabel · placeholder → getByPlaceholder · texto → getByText ·
//   boton/role → getByRole(rol|button, {name}) · testid → getByTestId ·
//   css (default) → locator(css)  ← compat con lo previo.
// El vocabulario espeja el `by` del catálogo de regresión (harvest.mjs) → el catálogo se enchufa al
// runner sin traducción.
function resolveLocator(page, args, ctx) {
  const value = interpolate(args.en ?? args.selector ?? "", ctx);
  if (!value) return null;
  switch (args.por) {
    case "etiqueta":
    case "label":
      return page.getByLabel(value);
    case "placeholder":
      return page.getByPlaceholder(value);
    case "texto":
    case "text":
      return page.getByText(value);
    case "boton":
    case "rol":
    case "role":
      return page.getByRole(args.rol || "button", { name: value });
    case "testid":
    case "test-id":
      return page.getByTestId(value);
    default:
      return page.locator(value); // css (o sin `por`) → compatibilidad hacia atrás
  }
}

// ── Handlers del núcleo ───────────────────────────────────────────────────────

/** Pausa breve, offline-safe (no depende de la API de la página; el fake del smoke no la usa). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deja "asentar" una app client-rendered (SPA) tras navegar: al evento `load` el HTML llegó pero el
// framework aún no pintó el DOM (login/dashboard vacíos → capturas en blanco y localizadores que no
// existen todavía). Espera —best-effort— a que la red quede en reposo para que el cliente termine de
// renderizar. GUARDADO: si el launcher/fake no expone waitForLoadState, se omite (no rompe offline).
export async function settleSpa(page, timeout = 30000) {
  if (!page || typeof page.waitForLoadState !== "function") return;
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(Math.max(0, timeout), 8000) });
  } catch {
    /* networkidle no llegó (app con polling/streaming) → seguimos con lo que haya */
  }
}

async function stepIrA({ page, args, env, vars, timeout }) {
  const url = interpolate(args.url || args.ruta || "", { env, vars });
  if (!url) return { ok: false, message: "ir_a sin url" };
  const resp = await page.goto(url, { waitUntil: "load", timeout });
  await settleSpa(page, timeout); // deja pintar a la SPA antes de capturar / seguir con los pasos
  const status = resp && typeof resp.status === "function" ? resp.status() : (resp && resp.status) || null;
  const ok = status == null || status < 400;
  return { ok, message: status != null ? `HTTP ${status}` : null };
}

async function stepEscribir({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "escribir sin campo destino ('en')" };
  await loc.fill(interpolate(args.valor ?? "", { env, vars }));
  return { ok: true };
}

async function stepClic({ page, args, env, vars, timeout }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "clic sin destino ('en')" };
  await loc.click({ timeout });
  return { ok: true };
}

async function stepTecla({ page, args, env, vars }) {
  const key = args.tecla || args.key;
  if (!key) return { ok: false, message: "tecla sin 'tecla'" };
  const loc = resolveLocator(page, args, { env, vars });
  if (loc) await loc.press(key);
  else await page.keyboard.press(key);
  return { ok: true };
}

async function stepEsperar({ page, args, env, vars, timeout }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "esperar sin destino ('en')" };
  await loc.first().waitFor({ state: args.estado || "visible", timeout });
  return { ok: true };
}

async function stepEsperarTexto({ page, args, env, vars, timeout }) {
  const texto = interpolate(args.texto || "", { env, vars });
  if (!texto) return { ok: false, message: "esperar_texto sin 'texto'" };
  await page.getByText(texto).first().waitFor({ state: "visible", timeout });
  return { ok: true };
}

async function stepVerificarVisible({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_visible sin destino ('en')" };
  const visible = await loc.first().isVisible();
  return { ok: !!visible, message: visible ? null : `no visible: ${interpolate(args.en ?? "", { env, vars })}` };
}

async function stepVerificarTexto({ page, args, env, vars }) {
  const texto = interpolate(args.texto || "", { env, vars });
  if (!texto) return { ok: false, message: "verificar_texto sin 'texto'" };
  const n = await page.getByText(texto).count();
  return { ok: n > 0, message: n > 0 ? null : `texto no encontrado: "${texto}"` };
}

async function stepCaptura({ page, args, env, vars, evidenceDir, index }) {
  const raw = interpolate(args.nombre || `captura-${index}`, { env, vars });
  const base = raw.replace(/[^\w.-]+/g, "-") || `captura-${index}`;
  const shot = path.join(evidenceDir, `${base}.png`);
  try {
    await page.screenshot({ path: shot, fullPage: true });
    if (fs.existsSync(shot)) return { ok: true, file: shot };
  } catch {
    /* captura best-effort: no tumba el paso */
  }
  return { ok: true };
}

// ── Login automático (heurístico y GENÉRICO, sin sesgo de app) ─────────────────
// Devuelve el PRIMER localizador candidato que existe en la página (count>0). Determinista.
async function firstPresent(page, makers) {
  for (const mk of makers) {
    try {
      const loc = mk();
      if (loc && (await loc.count()) > 0) return typeof loc.first === "function" ? loc.first() : loc;
    } catch {
      /* candidato inválido → siguiente */
    }
  }
  return null;
}

// Como firstPresent, pero ESPERA (hasta `timeout`) a que aparezca el primer candidato, sondeando
// con reintentos cortos. Necesario en SPAs: al `load` el formulario aún no existe y count() mira el
// DOM UNA sola vez (devolvía 0 → "no se encontró el campo" en ~30 ms → el login moría y, por
// fail-fast, tumbaba TODA la corrida). Respeta el orden de prioridad de los makers. No depende de
// que el fake exponga waitFor (usa count() como firstPresent), así el smoke sigue verde offline.
async function firstPresentWait(page, makers, timeout = 30000) {
  const deadline = Date.now() + Math.max(0, timeout);
  let loc = await firstPresent(page, makers);
  while (!loc && Date.now() < deadline) {
    await sleep(250);
    loc = await firstPresent(page, makers);
  }
  return loc;
}

// Inicia sesión sin depender de una app concreta: usuario por etiqueta/heurística (usuario/correo/
// email/user), clave por input[type=password] (señal fiable), enviar por botón submit o con texto
// de acceso. Credenciales SIEMPRE por ${QA_USER}/${QA_PASS} (interpoladas de vars/env; nunca en el
// guion). Se inyecta al inicio del guion autogenerado cuando la corrida trae credenciales, para
// navegar autenticado. Si no encuentra un campo, falla con mensaje accionable (no adivina a ciegas).
async function stepLogin({ page, args, env, vars, timeout }) {
  const user = interpolate(args.usuario ?? "${QA_USER}", { env, vars });
  const pass = interpolate(args.clave ?? "${QA_PASS}", { env, vars });
  if (!user || !pass) return { ok: false, message: "login sin credenciales (define ${QA_USER}/${QA_PASS} en la corrida)" };

  // Espera a que la SPA pinte el formulario (hasta `timeout`) antes de sondear los campos: en apps
  // client-rendered el <input> no existe al `load`. Sin esta espera el login fallaba en ~30 ms.
  const userLoc = await firstPresentWait(page, [
    () => page.getByLabel(/usuario|correo|e-?mail|user/i),
    () => page.locator('input[type="email"]'),
    () => page.locator('input[name*="user" i], input[id*="user" i], input[name*="email" i]'),
    () => page.locator('input[type="text"]'),
  ], timeout);
  if (!userLoc)
    return { ok: false, message: "login: no se encontró el campo de usuario (la página no mostró un formulario tras esperar; ¿es una SPA que no renderizó, o requiere otra URL/paso previo?)" };
  await userLoc.fill(user);

  // Usuario ya presente → los demás campos del mismo formulario deberían estar; espera corta por si
  // aparecen con leve retraso.
  const short = Math.min(timeout, 5000);
  const passLoc = await firstPresentWait(page, [() => page.locator('input[type="password"]')], short);
  if (!passLoc) return { ok: false, message: "login: no se encontró el campo de contraseña" };
  await passLoc.fill(pass);

  const btn = await firstPresentWait(page, [
    () => page.getByRole("button", { name: /iniciar|ingres|entrar|acceder|log\s?in|sign\s?in/i }),
    () => page.locator('button[type="submit"], input[type="submit"]'),
    () => page.getByRole("button"),
  ], short);
  if (!btn) return { ok: false, message: "login: no se encontró el botón de acceso" };
  await btn.click({ timeout });

  // Espera a que el login CIERRE antes de devolver: el formulario desaparece (campo de clave
  // oculto/desmontado) y/o la SPA navega al dashboard. Sin esto el paso volvía en ~250 ms mientras
  // seguíamos en la pantalla de login → el recon capturaba el LOGIN (no el dashboard) y la IA
  // generaba guiones a ciegas; y en la ejecución los pasos siguientes corrían sobre el login.
  try {
    await passLoc.waitFor({ state: "hidden", timeout: short });
  } catch {
    /* el form no se ocultó (login SPA in-place o credenciales inválidas) → el settle da margen */
  }
  await settleSpa(page, timeout);
  return { ok: true };
}

// ── Entrada avanzada ──────────────────────────────────────────────────────────
async function stepSeleccionar({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "seleccionar sin lista destino ('en')" };
  await loc.selectOption(interpolate(args.valor ?? "", { env, vars }));
  return { ok: true };
}
async function stepMarcar({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "marcar sin destino ('en')" };
  await loc.check();
  return { ok: true };
}
async function stepDesmarcar({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "desmarcar sin destino ('en')" };
  await loc.uncheck();
  return { ok: true };
}
async function stepSubirArchivo({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "subir_archivo sin campo destino ('en')" };
  const ruta = interpolate(args.ruta ?? args.valor ?? "", { env, vars });
  if (!ruta) return { ok: false, message: "subir_archivo sin 'ruta' del archivo" };
  await loc.setInputFiles(ruta);
  return { ok: true };
}
async function stepLimpiar({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "limpiar sin campo destino ('en')" };
  await loc.fill("");
  return { ok: true };
}

// ── Verificaciones ricas (asserts) ────────────────────────────────────────────
async function stepVerificarValor({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_valor sin campo destino ('en')" };
  const actual = await loc.inputValue();
  const exp = interpolate(args.valor ?? "", { env, vars });
  return { ok: actual === exp, message: actual === exp ? null : `valor "${actual}" ≠ esperado "${exp}"` };
}
async function stepVerificarCantidad({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_cantidad sin selector ('en')" };
  const n = await loc.count();
  const exp = Number(interpolate(args.numero ?? args.valor ?? "", { env, vars }));
  return { ok: n === exp, message: n === exp ? null : `cantidad ${n} ≠ esperada ${exp}` };
}
async function stepVerificarUrl({ page, args, env, vars }) {
  const u = typeof page.url === "function" ? page.url() : "";
  const needle = interpolate(args.texto ?? "", { env, vars });
  return { ok: u.includes(needle), message: u.includes(needle) ? null : `la URL "${u}" no contiene "${needle}"` };
}
async function stepVerificarTitulo({ page, args, env, vars }) {
  const t = typeof page.title === "function" ? await page.title() : "";
  const needle = interpolate(args.texto ?? "", { env, vars });
  return { ok: t.includes(needle), message: t.includes(needle) ? null : `el título "${t}" no contiene "${needle}"` };
}
async function stepVerificarAtributo({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_atributo sin destino ('en')" };
  const attr = interpolate(args.nombre ?? "", { env, vars });
  if (!attr) return { ok: false, message: "verificar_atributo sin 'nombre' del atributo" };
  const actual = await loc.getAttribute(attr);
  const exp = interpolate(args.valor ?? "", { env, vars });
  return { ok: (actual ?? "") === exp, message: (actual ?? "") === exp ? null : `atributo ${attr}="${actual}" ≠ "${exp}"` };
}
async function stepVerificarHabilitado({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_habilitado sin destino ('en')" };
  const e = await loc.isEnabled();
  return { ok: !!e, message: e ? null : "el elemento está deshabilitado" };
}
async function stepVerificarMarcado({ page, args, env, vars }) {
  const loc = resolveLocator(page, args, { env, vars });
  if (!loc) return { ok: false, message: "verificar_marcado sin destino ('en')" };
  const c = await loc.isChecked();
  return { ok: !!c, message: c ? null : "el elemento no está marcado" };
}

/** Registro nombre→handler. Crecer aquí (por categorías) en las tandas siguientes. */
export const STEPS = {
  ir_a: stepIrA,
  login: stepLogin,
  escribir: stepEscribir,
  clic: stepClic,
  tecla: stepTecla,
  seleccionar: stepSeleccionar,
  marcar: stepMarcar,
  desmarcar: stepDesmarcar,
  subir_archivo: stepSubirArchivo,
  limpiar: stepLimpiar,
  esperar: stepEsperar,
  esperar_texto: stepEsperarTexto,
  verificar_visible: stepVerificarVisible,
  verificar_texto: stepVerificarTexto,
  verificar_valor: stepVerificarValor,
  verificar_cantidad: stepVerificarCantidad,
  verificar_url: stepVerificarUrl,
  verificar_titulo: stepVerificarTitulo,
  verificar_atributo: stepVerificarAtributo,
  verificar_habilitado: stepVerificarHabilitado,
  verificar_marcado: stepVerificarMarcado,
  captura: stepCaptura,
};

export default { STEPS, normalizeStep, stepLabel, interpolate };
