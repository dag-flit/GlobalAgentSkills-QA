// runtime/smoke/planner-suite.mjs — planner de guion con IA local (Ollama), OFF-by-default y con
// FALLBACK DETERMINISTA. Verifica offline (http inyectable, sin red ni Ollama real):
//   (1) IA encendida y respondiendo → guion saneado + scaffold (ir_a/login deterministas); la
//       salida del modelo se FILTRA contra el registro (op inválido / paso incompleto se descartan).
//   (2) IA encendida pero el transporte falla → fallback al generador determinista (no rompe).
//   (3) IA apagada → ni siquiera llama a Ollama; usa el determinista.
import assert from "node:assert";
import { planFlow } from "../generate/flow-planner.mjs";
import { sanitizeStep } from "../generate/flow-sanitize.mjs";
import { captureDom } from "../generate/recon.mjs";

const ACS = [
  {
    title: "AC1",
    detail:
      "Dado que estoy en la página de login\n" +
      "Cuando ingreso mi usuario y contraseña\n" +
      'Y presiono el botón "Iniciar Sesión"\n' +
      'Entonces veo el mensaje "Bienvenido"',
  },
];
const AI_ON = { enabled: true, endpoint: "http://localhost:11434/", model: "llama3.1" };

export async function run(ctx) {
  const { ok } = ctx;

  // (1) IA responde con un guion; incluye un op inválido y un paso incompleto que DEBEN descartarse.
  const modelOut = {
    flow: [
      { op: "ir_a", url: "http://no-debe-colarse" }, // el scaffold pone la navegación → se descarta
      { op: "escribir", por: "etiqueta", en: "Usuario Corporativo", valor: "${QA_USER}" },
      { op: "clic", por: "boton", en: "Entrar" },
      { op: "verificar_texto", texto: "Bienvenido", ac: "AC1" },
      { op: "malicioso", en: "rm -rf" }, // op fuera del registro → se descarta
      { op: "clic" }, // sin 'en' (campo mínimo) → se descarta
      { op: "escribir", por: "hack", en: "X", valor: "1" }, // 'por' inválido → se limpia ese campo
    ],
    notes: ["deduje los localizadores desde la pantalla"],
  };
  let seenUrl = "";
  let seenBody = "";
  const httpOk = async (req) => {
    seenUrl = req.url;
    seenBody = String(req.body || "");
    return { status: 200, json: { response: JSON.stringify(modelOut) } };
  };
  const DOM = 'CAMPOS:\n- campo "Usuario Corporativo" (text)\nBOTONES:\n- botón "Entrar"';
  const r1 = await planFlow({ acs: ACS, appUrl: "https://app.test/login", title: "[FRONTEND] login", login: true, dom: DOM, ai: AI_ON, http: httpOk });
  assert.strictEqual(r1.origin, "ia");
  assert.strictEqual(seenUrl, "http://localhost:11434/api/generate", "debe llamar al endpoint de Ollama (sin doble slash)");
  assert.ok(seenBody.includes("Usuario Corporativo"), "el DOM del recon debe viajar en el prompt del modelo");
  assert.deepStrictEqual(r1.flow[0], { op: "ir_a", url: "https://app.test/login" }); // scaffold determinista
  assert.deepStrictEqual(r1.flow[1], { op: "login" });
  assert.deepStrictEqual(r1.flow[2], { op: "escribir", por: "etiqueta", en: "Usuario Corporativo", valor: "${QA_USER}" });
  assert.deepStrictEqual(r1.flow[3], { op: "clic", por: "boton", en: "Entrar" });
  assert.deepStrictEqual(r1.flow[4], { op: "verificar_texto", texto: "Bienvenido", ac: "AC1" });
  assert.ok(!r1.flow.some((s) => s.op === "malicioso"), "op inválido debe descartarse");
  assert.ok(!r1.flow.some((s) => s.op === "ir_a" && s.url === "http://no-debe-colarse"), "el ir_a del modelo se descarta");
  // el 'escribir' con por inválido ("hack"): se limpia y, como `en` no parece CSS, se INFIERE
  // un localizador amigable ("etiqueta") en vez de caer a css roto.
  const escConPorMalo = r1.flow.find((s) => s.op === "escribir" && s.en === "X");
  assert.ok(escConPorMalo && escConPorMalo.por === "etiqueta", "un 'por' inválido se rescata infiriendo 'etiqueta'");
  ok("planner IA: guion del modelo saneado contra el registro (op/campo inválido descartado) + scaffold ir_a/login determinista");

  // (2) IA encendida pero el transporte falla → fallback determinista (nunca rompe la corrida).
  const httpFail = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  };
  const r2 = await planFlow({ acs: ACS, appUrl: "https://app.test/login", title: "[FRONTEND] login", ai: AI_ON, http: httpFail });
  assert.strictEqual(r2.origin, "determinista");
  assert.ok(r2.flow.length >= 4, "el fallback determinista debe deducir pasos del Gherkin");
  assert.ok(String(r2.notes[0]).includes("IA no disponible"), "la nota debe explicar el fallback");

  // (3) IA apagada → NO debe llamar a Ollama; usa el determinista directamente.
  let called = false;
  const httpSpy = async () => {
    called = true;
    return { status: 200, json: { response: "{}" } };
  };
  const r3 = await planFlow({ acs: ACS, appUrl: "https://app.test/login", title: "[FRONTEND] login", ai: { enabled: false, endpoint: "", model: "x" }, http: httpSpy });
  assert.strictEqual(r3.origin, "determinista");
  assert.strictEqual(called, false, "con la IA apagada no se debe llamar a Ollama");

  // saneo directo: número coaccionado, ac válido; op desconocido → null.
  assert.strictEqual(sanitizeStep({ op: "no_existe" }), null);
  assert.deepStrictEqual(sanitizeStep({ op: "verificar_cantidad", en: ".fila", numero: "3", basura: "x" }), { op: "verificar_cantidad", en: ".fila", numero: 3 });
  // FORMA ABREVIADA del modelo ({op-como-clave}) → normalizeStep la reconoce (antes se descartaba
  // TODO el guion y caía al determinista). Esta fue la causa raíz de la intermitencia con Ollama real.
  assert.deepStrictEqual(sanitizeStep({ clic: { por: "boton", en: "Enviar" } }), { op: "clic", por: "boton", en: "Enviar" });
  // `por` inválido del modelo → se infiere amigable (boton en clic, etiqueta en el resto); css se respeta.
  assert.deepStrictEqual(sanitizeStep({ op: "clic", por: "opcion", en: "Enviar invitación" }), { op: "clic", por: "boton", en: "Enviar invitación" });
  assert.deepStrictEqual(sanitizeStep({ op: "escribir", por: "campo", en: "Correo", valor: "x" }), { op: "escribir", por: "etiqueta", en: "Correo", valor: "x" });
  assert.deepStrictEqual(sanitizeStep({ op: "clic", en: "#btn-enviar" }), { op: "clic", en: "#btn-enviar" }); // css → no se infiere
  ok("planner IA: fallback determinista cuando Ollama falla y cuando la IA está apagada (sin llamada); saneo directo (forma abreviada + inferencia de localizador)");

  // (4) RECON: abre la app (launcher inyectable), inicia sesión y captura el DOM (campos/botones
  // reales) que alimenta al planner. Todo offline (page.evaluate devuelve un DOM canned).
  const rec = { fills: [], clicks: 0, goto: "" };
  const reconLaunch = () => ({
    async newPage() {
      const loc = {
        async fill(v) { rec.fills.push(v); },
        async click() { rec.clicks++; },
        first() { return loc; },
        async count() { return 1; },
      };
      return {
        async goto(u) { rec.goto = u; return { status: () => 200 }; },
        getByLabel() { return loc; },
        getByRole() { return loc; },
        locator() { return loc; },
        async evaluate() { return 'TÍTULOS:\n- h1: "Panel"\nCAMPOS:\n- campo "Usuario Corporativo" (text)\nBOTONES:\n- botón "Entrar"'; },
        async close() {},
      };
    },
    async close() {},
  });
  const rc = await captureDom({ appUrl: "https://app.test/login", login: true, env: { QA_USER: "ana", QA_PASS: "s3cr3t" }, vars: {}, launchBrowser: reconLaunch });
  assert.strictEqual(rc.ok, true);
  assert.ok(rc.dom.includes("Usuario Corporativo"), "el recon debe capturar los campos reales de la pantalla");
  assert.strictEqual(rec.goto, "https://app.test/login", "el recon debe navegar a la URL");
  assert.ok(rec.fills.includes("ana") && rec.fills.includes("s3cr3t"), "el recon debe iniciar sesión antes de capturar");
  const rc2 = await captureDom({ appUrl: "https://app.test", launchBrowser: null });
  assert.strictEqual(rc2.ok, false);
  assert.strictEqual(rc2.dom, "");
  ok("recon: abre la app, inicia sesión y captura el DOM (campos/botones reales) para el planner IA; sin launcher se omite");
}
