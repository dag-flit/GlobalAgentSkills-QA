// ac-to-flow.mjs — generador DETERMINISTA de un guion E2E a partir de los criterios de aceptación
// (AC) de una HU. SIN IA: mapea Gherkin (Dado/Cuando/Entonces) a los pasos del guion con un
// diccionario de verbos y extractores de localizadores amigables. Es un BORRADOR: la resolución
// fina del localizador la hace el runner contra la app viva (getByLabel/getByRole hacen match por
// subcadena → cubren la mayoría de los casos). Puro y offline-testable: no toca red ni disco.
//
// Contrato: generateFlowFromAc({ acs, appUrl }) → { flow, notes, e2eable, reason }
//   - acs:    [{ title, detail }]  (como los entrega parseAc del adapter azure)
//   - appUrl: URL viva a probar (primer paso ir_a). Opcional.
//   - flow:   [{ op, ... }]  pasos válidos del registro (explore-steps.mjs)
//   - notes:  avisos de mapeos ambiguos/inferidos (transparencia, no errores)
//   - e2eable/reason: si la HU NO es probable por navegador (backend/migración/API), e2eable=false
//
// Secretos: los campos de login se referencian como ${QA_USER}/${QA_PASS} (efímeros, NUNCA el valor).

// ── diccionarios (es/en) ──────────────────────────────────────────────────────
const KW_GIVEN = /^(dado|dada|given)\b/i;
const KW_WHEN = /^(cuando|when)\b/i;
const KW_THEN = /^(entonces|then)\b/i;
const KW_AND = /^(y|e|and|but|pero)\b/i;
const SKIP_LINE = /^(escenario|scenario|feature|caracter[íi]stica|antecedentes|background|esquema)\b/i;

const RE_INPUT = /\b(ingreso|ingresa|escribo|escribe|digito|digita|relleno|rellena|lleno|llena|introduzco|introduce|capturo|captura|completo|completa)\b/i;
const RE_CLICK = /\b(hago clic|doy clic|clic|clico|presiono|presiona|pulso|pulsa|oprimo|oprime|selecciono|selecciona|marco|activo|env[íi]o|env[íi]a)\b/i;
const RE_VERIFY = /\b(veo|ve|aparece|aparecen|se muestra|se muestran|muestra|muestran|deber[íi]a\s+(?:ver|mostrar)|debe\s+(?:ver|mostrar)|visualizo|observo|obtengo|recibo|confirma|valida)\b/i;
const RE_NAV = /\b(voy a|navego|navega|accedo|ingreso a|entro a|abro|redirig|redirecciona|me lleva)\b/i;

const RE_USER = /\b(usuario|correo|e-?mail|user(?:name)?|login|c[ée]dula|documento)\b/i;
const RE_PASS = /\b(contrase[ñn]a|clave|password|pass)\b/i;

// HU no probable por navegador (E2E) → se salta. Señales en el título/tipo.
const RE_NOT_E2E = /\b(\[?backend\]?|migraci[óo]n|migrar|base de datos|schema|esquema|\bapi\b|endpoint|servicio|job|batch|cron|env[íi]o de (?:email|correo)|webhook|integraci[óo]n|repositorio|stored procedure)\b/i;

// ── extractores de texto ──────────────────────────────────────────────────────
// Primer entrecomillado ("x", 'x', «x», “x”) del texto, o null.
function quoted(s) {
  const m = String(s).match(/["'«“](.+?)["'»”]/);
  return m ? m[1].trim() : null;
}

// Nombre del elemento tras una palabra ancla (botón/enlace/campo/…). Corta en puntuación/keyword.
function afterAnchor(s, anchor) {
  const re = new RegExp(`${anchor}\\s+(?:de\\s+|para\\s+)?(.+)$`, "i");
  const m = String(s).match(re);
  if (!m) return null;
  // recorta conectores finales típicos ("... y veo", "... para continuar") y desenvuelve comillas.
  const raw = m[1].replace(/\s+(y|e|para|con|entonces|luego|,|\.).*$/i, "").replace(/[.:;]+$/, "").trim();
  return unquote(raw) || null;
}

// Quita comillas envolventes ("x" / 'x' / «x» / “x”) si las hay.
function unquote(s) {
  return String(s).replace(/^["'«“]+|["'»”]+$/g, "").trim();
}

// Frase objetivo de una verificación: entrecomillado, o el texto tras el verbo de ver/mostrar.
function verifyTarget(s) {
  const q = quoted(s);
  if (q) return q;
  const m = String(s).match(/\b(?:veo|ve|aparece|aparecen|muestra|muestran|visualizo|observo|obtengo|recibo|el mensaje|el texto)\s+(?:el|la|los|las|un|una|de\s+)?\s*(.+)$/i);
  if (!m) return null;
  return m[1].replace(/\s+(y|e|entonces|luego|,|\.).*$/i, "").replace(/[.:;]+$/, "").trim() || null;
}

// Ruta/URL objetivo de una navegación o redirección (token /ruta, entrecomillado, o tras "a").
function navTarget(s) {
  const q = quoted(s);
  if (q) return q;
  const slash = String(s).match(/(https?:\/\/\S+|\/[A-Za-z0-9\-_/]+)/);
  if (slash) return slash[1];
  const m = String(s).match(/\b(?:voy a|navego a|accedo a|entro a|redirig\w* a|me lleva a)\s+(?:la\s+|el\s+)?(?:p[áa]gina\s+(?:de\s+)?)?(.+)$/i);
  return m ? m[1].replace(/[.:;]+$/, "").trim() : null;
}

// ── mapeo de UNA cláusula Gherkin a 0..n pasos ────────────────────────────────
function clauseToSteps(clause, acTitle, isThen, notes) {
  const text = clause.trim();
  if (!text) return [];

  // Navegación explícita (Cuando/Y voy a X, o Entonces me redirige a X).
  if (RE_NAV.test(text) && !RE_INPUT.test(text)) {
    const t = navTarget(text);
    if (isThen || /redirig|me lleva/i.test(text)) {
      // en un Entonces, "me redirige a /x" es una verificación de URL, no una navegación.
      if (t) return [{ op: "verificar_url", texto: cleanPath(t), ac: acTitle }];
    } else if (t) {
      return [{ op: "ir_a", url: t }];
    }
    notes.push(`Navegación sin destino claro: "${text}" — se omitió.`);
    return [];
  }

  // Entrada de datos (Cuando/Y ingreso ...).
  if (RE_INPUT.test(text)) {
    const steps = [];
    const hasUser = RE_USER.test(text);
    const hasPass = RE_PASS.test(text);
    if (hasUser) steps.push({ op: "escribir", por: "etiqueta", en: fieldLabel(text, "user"), valor: "${QA_USER}" });
    if (hasPass) steps.push({ op: "escribir", por: "etiqueta", en: fieldLabel(text, "pass"), valor: "${QA_PASS}" });
    if (!hasUser && !hasPass) {
      const field = afterAnchor(text, "campo") || quoted(text) || "campo";
      const val = valueAfterCon(text);
      steps.push({ op: "escribir", por: "etiqueta", en: field, valor: val });
      if (!val) notes.push(`Entrada sin valor explícito: "${text}" — se dejó el valor vacío para completar.`);
    }
    return steps;
  }

  // Clic / envío (Cuando/Y presiono el botón X).
  if (RE_CLICK.test(text)) {
    const name = afterAnchor(text, "bot[óo]n") || afterAnchor(text, "enlace") || afterAnchor(text, "link") || afterAnchor(text, "opci[óo]n") || quoted(text);
    if (name) return [{ op: "clic", por: "boton", en: name }];
    notes.push(`Clic sin elemento claro: "${text}" — se omitió (indica el botón/enlace).`);
    return [];
  }

  // Verificación (Entonces veo / se muestra X).
  if (isThen || RE_VERIFY.test(text)) {
    if (/\bt[íi]tulo\b/i.test(text)) {
      const t = verifyTarget(text) || quoted(text);
      if (t) return [{ op: "verificar_titulo", texto: t, ac: acTitle }];
    }
    if (/\burl\b|redirig|me lleva/i.test(text)) {
      const t = navTarget(text);
      if (t) return [{ op: "verificar_url", texto: cleanPath(t), ac: acTitle }];
    }
    const t = verifyTarget(text);
    if (t) return [{ op: "verificar_texto", texto: t, ac: acTitle }];
    notes.push(`Verificación sin texto claro: "${text}" — se omitió (di qué debe verse).`);
    return [];
  }

  notes.push(`Paso no reconocido: "${text}" — se omitió.`);
  return [];
}

function fieldLabel(text, kind) {
  const q = quoted(text);
  if (q) return q;
  return kind === "pass" ? "Contraseña" : "Usuario";
}
function valueAfterCon(text) {
  const m = String(text).match(/\bcon\s+(?:el\s+|la\s+|valor\s+)?(.+)$/i);
  if (!m) return "";
  return (quoted(m[1]) || m[1]).replace(/[.:;]+$/, "").trim();
}
function cleanPath(t) {
  const m = String(t).match(/(https?:\/\/\S+|\/[A-Za-z0-9\-_/]+)/);
  return m ? m[1] : t;
}

// ── Gherkin: parte el detalle en cláusulas con su tipo (given/when/then) ───────
function parseGherkin(detail) {
  const out = [];
  let cur = "given";
  for (const raw of String(detail || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || SKIP_LINE.test(line)) continue;
    let m;
    if ((m = line.match(KW_GIVEN))) { cur = "given"; out.push({ kind: cur, text: strip(line, m) }); }
    else if ((m = line.match(KW_WHEN))) { cur = "when"; out.push({ kind: cur, text: strip(line, m) }); }
    else if ((m = line.match(KW_THEN))) { cur = "then"; out.push({ kind: cur, text: strip(line, m) }); }
    else if ((m = line.match(KW_AND))) { out.push({ kind: cur, text: strip(line, m) }); }
    else out.push({ kind: cur, text: line }); // línea suelta → hereda el tipo actual
  }
  return out;
}
function strip(line, m) {
  return line.slice(m[0].length).replace(/^\s*que\s+/i, "").replace(/^\s+/, "").trim();
}

// ── clasificación E2E-able ─────────────────────────────────────────────────────
// ¿El título sugiere una HU de backend/no-UI (no probable por navegador)? Fuente única de
// RE_NOT_E2E — el planner con IA la usa como ÚNICO filtro (no exige Gherkin, que es justo lo
// que la IA cubre para AC narrativos).
export function titleLooksBackend(title = "") {
  return RE_NOT_E2E.test(String(title));
}

export function classifyE2eable(title = "", acs = []) {
  if (RE_NOT_E2E.test(String(title))) {
    return { e2eable: false, reason: `El título sugiere backend/no-UI ("${String(title).slice(0, 60)}").` };
  }
  const anyGherkin = (acs || []).some((a) => parseGherkin(a && a.detail).length > 0);
  if (!anyGherkin) return { e2eable: false, reason: "Ningún AC trae pasos Gherkin (Dado/Cuando/Entonces)." };
  return { e2eable: true, reason: "" };
}

// ── entrada principal ──────────────────────────────────────────────────────────
export function generateFlowFromAc({ acs = [], appUrl = "", title = "", login = false } = {}) {
  const cls = classifyE2eable(title, acs);
  if (!cls.e2eable) return { flow: [], notes: [cls.reason], e2eable: false, reason: cls.reason };

  const notes = [];
  const flow = [];
  if (appUrl) flow.push({ op: "ir_a", url: appUrl });
  // Login automático: cuando la corrida trae credenciales, se antepone el paso `login` (heurístico)
  // tras el ir_a → las HU autenticadas se prueban navegando ya con sesión iniciada.
  if (login) {
    flow.push({ op: "login" });
    notes.push("Login automático inyectado (usa ${QA_USER}/${QA_PASS} de la corrida).");
  }

  for (const ac of acs) {
    const acTitle = (ac && ac.title) || "";
    const clauses = parseGherkin(ac && ac.detail);
    if (!clauses.length) {
      notes.push(`AC "${acTitle}" sin pasos Gherkin — no se generaron pasos para él.`);
      continue;
    }
    for (const c of clauses) {
      // un Given que solo describe "estoy en la página" es precondición → cubierto por ir_a; se omite.
      if (c.kind === "given" && !RE_NAV.test(c.text) && !RE_INPUT.test(c.text)) continue;
      const steps = clauseToSteps(c.text, acTitle, c.kind === "then", notes);
      for (const s of steps) flow.push(s);
    }
  }

  const actionable = flow.filter((s) => s.op !== "ir_a").length;
  if (!actionable) notes.push("No se dedujo ningún paso accionable de los AC — revisá que el Gherkin describa acciones/verificaciones.");
  return { flow, notes, e2eable: true, reason: "" };
}

export default { generateFlowFromAc, classifyE2eable, titleLooksBackend };
