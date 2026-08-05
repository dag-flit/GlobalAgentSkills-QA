// harvest.mjs — construye el CATÁLOGO de selectores a partir de nodos crudos del DOM (que el
// escáner lee en runtime). PURO / offline / SIN IA: recibe descriptores de elementos y elige, para
// cada uno, la estrategia de localización MÁS ROBUSTA (role+nombre > etiqueta > testid > texto >
// placeholder), genera un alias legible y deduplica. No toca el navegador.
//
// El vocabulario `by` espeja el de explore-steps.resolveLocator (role|label|text|placeholder) +
// `testid` (getByTestId): así el catálogo se enchufa al runner de pasos sin traducción. Este módulo
// solo INVENTARÍA lo que hay; jamás decide qué probar (eso lo hace el humano en el módulo).

// Roles cuyo ancla natural es el NOMBRE accesible (getByRole{name}) — legible para no técnicos.
const NAMED_ROLES = new Set(["button", "link", "heading", "tab", "menuitem", "radio", "checkbox", "option", "switch"]);
// Roles de campo de formulario → se anclan por su etiqueta (getByLabel) o placeholder.
const FIELD_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton", "listbox", "slider"]);
const MAX_TEXT = 60; // un texto más largo no es un ancla útil (párrafos, celdas enormes)

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** Alias legible y estable a partir de un texto humano (sin acentos, kebab con guion bajo). */
export function slugAlias(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Un id que parece ESTABLE (escrito por el equipo, no auto-generado). Los ids de React/frameworks
// (`:r0:`, `«…»`, uuids largos) cambian entre renders → no sirven de ancla. Aceptamos ids "de a pie".
function stableId(id) {
  return /^[A-Za-z][\w-]*$/.test(id) && id.length <= 40;
}

/**
 * Elige la estrategia de localización de un nodo del DOM, o null si no hay ancla estable.
 * Prioridad (robusto/legible → frágil): role+nombre > etiqueta > testid > placeholder > texto >
 * atributo `name` > `id` estable. Los dos últimos son el "colchón" para no dejar suelto ningún
 * control accionable (checkbox/inputs que aparecen sin etiqueta) — ancla CSS por atributo, estable.
 * @param {{role?:string, field?:boolean, name?:string, label?:string, testid?:string, placeholder?:string, text?:string, nameAttr?:string, id?:string}} node
 * @returns {{by:string, role?:string, name?:string, value?:string, seed?:string}|null}
 */
export function pickStrategy(node = {}) {
  const role = node.role || "";
  const name = clean(node.name);
  const label = clean(node.label);
  const testid = clean(node.testid);
  const placeholder = clean(node.placeholder);
  const text = clean(node.text);
  const nameAttr = clean(node.nameAttr);
  const idAttr = clean(node.id);
  const isField = !!node.field || FIELD_ROLES.has(role);

  if (NAMED_ROLES.has(role) && name) return { by: "role", role, name };
  if (isField && label) return { by: "label", value: label };
  if (testid) return { by: "testid", value: testid };
  if (isField && placeholder) return { by: "placeholder", value: placeholder };
  if (role && name) return { by: "role", role, name };
  if (text && text.length <= MAX_TEXT) return { by: "text", value: text };
  // Colchón para controles sin ancla legible (checkbox/inputs revelados): atributo `name`, luego `id`
  // estable. Ancla CSS por atributo (soportada por el runner); `seed` da un alias legible.
  if (nameAttr) return { by: "css", value: `[name="${nameAttr}"]`, seed: nameAttr };
  if (idAttr && stableId(idAttr)) return { by: "css", value: `#${idAttr}`, seed: idAttr };
  return null;
}

function keyOf(st) {
  return st.by === "role" ? `role|${st.role}|${st.name}` : `${st.by}|${st.value}`;
}

/**
 * Nodos crudos del DOM → elementos del catálogo, con alias único y sin duplicados.
 * @param {Array<object>} rawNodes
 * @returns {Array<{alias:string, by:string, role?:string, name?:string, value?:string}>}
 */
export function buildElements(rawNodes = []) {
  const out = [];
  const seen = new Set();
  const aliases = new Set();
  for (const node of rawNodes) {
    if (node && node.visible === false) continue;
    const st = pickStrategy(node);
    if (!st) continue;
    const k = keyOf(st);
    if (seen.has(k)) continue;
    seen.add(k);
    const human = st.seed || (st.by === "role" ? st.name : st.value);
    let base = slugAlias(human) || `${st.role || st.by}_${out.length + 1}`;
    let alias = base;
    let n = 2;
    while (aliases.has(alias)) alias = `${base}_${n++}`;
    aliases.add(alias);
    const { seed, ...strategy } = st; // `seed` solo alimenta el alias; no se guarda en el elemento
    out.push({ alias, ...strategy });
  }
  return out;
}

/** Página del catálogo: { route, name, elements[] }. */
export function buildCatalogPage(rawNodes, { route = "/", name = "" } = {}) {
  return { route: route || "/", name: name || route || "/", elements: buildElements(rawNodes) };
}

export default { slugAlias, pickStrategy, buildElements, buildCatalogPage };
