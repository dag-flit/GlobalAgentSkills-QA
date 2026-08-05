// recorder.mjs — GRABADOR semi-automático de recorridos (núcleo PURO / offline-testable). El navegador
// HEADED lo maneja el puente de la webapp (local, en la máquina del usuario); acá vive lo determinista:
//   (1) RECORDER_SCRIPT: el script que se INYECTA en la página para describir cada elemento con el que
//       el usuario interactúa (clic / cambio) y reportarlo al proceso (window.__qaRecord).
//   (2) describeToStep: traduce una interacción a un PASO del recorrido, resolviendo el ALIAS del
//       catálogo de la pantalla (reusa el mismo anclaje robusto que el escáner). SIN IA.
//   (3) buildRecordedRecorrido: ensambla las pantallas grabadas → recorrido (etapas+avances) + catálogo.
// Así, mientras el usuario USA la app, cada pantalla se cataloga completa y sus clics/escrituras quedan
// como el guion — sin elegir alias a mano ni dejar selectores sueltos.

import { pickStrategy, buildElements } from "./harvest.mjs";

// Clave de una estrategia (para parear un elemento accionado con su alias del catálogo de la pantalla).
export function strategyKey(st) {
  if (!st) return "";
  return st.by === "role" ? `role|${st.role}|${st.name}` : `${st.by}|${st.value}`;
}

/**
 * Traduce una interacción grabada (descriptor del elemento + tipo de acción) a un paso del recorrido.
 * Resuelve el alias contra el mapa clave→alias del catálogo de esa pantalla. Devuelve null si no hay
 * ancla estable o si es un secreto (campo password → nunca se graba el valor).
 */
export function describeToStep(a = {}, keyToAlias = new Map()) {
  const st = pickStrategy(a);
  const alias = st ? keyToAlias.get(strategyKey(st)) : null;
  if (!alias) return null;
  if (a.kind === "change") {
    if (a.inputType === "file") return { op: "subir_archivo", alias, ruta: "" }; // el usuario completa el archivo luego
    if (a.inputType === "password") return null; // no se graban secretos (el login ya se hizo aparte)
    if (a.tag === "select") return { op: "seleccionar", alias, valor: a.value ?? "" };
    return { op: "escribir", alias, valor: a.value ?? "" };
  }
  return { op: "clic", alias }; // clic (incluye checkbox/radio)
}

/**
 * Ensambla las pantallas grabadas en un recorrido + páginas de catálogo (una por pantalla).
 * @param {{name:string, entryRoute?:string, screens:Array<{name?:string, nodes:Array<object>, actions:Array<object>}>}} o
 * @returns {{recorrido:{name:string, entryRoute:string, stages:Array<object>}, catalogPages:Array<object>}}
 */
export function buildRecordedRecorrido({ name, entryRoute = "", screens = [] } = {}) {
  const stages = [];
  const catalogPages = [];
  screens.forEach((sc, i) => {
    const stageName = sc.name || `Pantalla ${i + 1}`;
    // Unión de lo cosechado + lo accionado → nada usado queda fuera del catálogo (alias garantizado).
    const nodes = [...(sc.nodes || []), ...(sc.actions || [])];
    const elements = buildElements(nodes);
    const keyToAlias = new Map();
    for (const el of elements) keyToAlias.set(strategyKey(el), el.alias);
    const advance = [];
    for (const a of sc.actions || []) {
      const step = describeToStep(a, keyToAlias);
      if (step) advance.push(step);
    }
    stages.push({ name: stageName, advance });
    catalogPages.push({ route: entryRoute || "/", name: `${name} › ${stageName}`, elements });
  });
  return { recorrido: { name, entryRoute, stages }, catalogPages };
}

// Script INYECTADO en cada navegación (addInitScript). Describe el elemento accionado con los MISMOS
// campos que la cosecha (harvest) para que pickStrategy elija el mismo ancla, y lo reporta por el
// binding window.__qaRecord. No graba el valor de campos password. Idempotente (no se instala 2 veces).
export const RECORDER_SCRIPT = `(() => {
  if (window.__qaRecorderInstalled) return; window.__qaRecorderInstalled = true;
  const roleFromTag = (el) => { const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button') return 'button';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') { const ty = (el.getAttribute('type')||'text').toLowerCase();
      if (ty === 'checkbox') return 'checkbox'; if (ty === 'radio') return 'radio';
      if (ty === 'submit' || ty === 'button') return 'button'; if (ty === 'hidden') return ''; return 'textbox'; }
    return ''; };
  const labelText = (el) => { if (el.id) { const l = document.querySelector('label[for="'+el.id+'"]'); if (l) return (l.textContent||'').trim(); }
    const w = el.closest ? el.closest('label') : null; return w ? (w.textContent||'').trim() : ''; };
  const describe = (el) => { const role = el.getAttribute('role') || roleFromTag(el);
    const field = /^(input|select|textarea)$/i.test(el.tagName);
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '';
    const ariaLabel = el.getAttribute('aria-label') || ''; const label = field ? labelText(el) : '';
    const text = ((el.innerText || el.textContent || '')+'').trim();
    const name = ariaLabel || (role && role !== 'textbox' && role !== 'combobox' ? text : '') || label;
    return { role, field, name: (name||'').slice(0,80), label: (label||'').slice(0,80), text: text.slice(0,80),
      placeholder: el.getAttribute('placeholder')||'', testid, nameAttr: el.getAttribute('name')||'', id: el.id||'' }; };
  const send = (kind, el, extra) => { try { if (!window.__qaRecord) return; const d = describe(el); window.__qaRecord(Object.assign({kind}, d, extra||{})); } catch(e){} };
  const CLICK = 'button, a[href], [role=button], input[type=submit], input[type=button], input[type=checkbox], input[type=radio]';
  document.addEventListener('click', (e) => { const el = e.target.closest(CLICK); if (el) send('click', el); }, true);
  document.addEventListener('change', (e) => { const el = e.target; if (!el || !/^(input|select|textarea)$/i.test(el.tagName)) return;
    const type = (el.getAttribute('type')||'').toLowerCase();
    var value;
    if (el.tagName.toLowerCase() === 'select') {
      // Para un <select> guardamos el TEXTO VISIBLE de la opción elegida (no su value interno, que suele
      // ser un UUID/código frágil entre ambientes e ilegible). selectOption matchea por texto o value.
      var opt = el.options && el.options[el.selectedIndex];
      value = opt ? ((opt.label||opt.text||'').trim() || opt.value || '') : (el.value||'');
    } else { value = type === 'password' ? '' : (el.value||''); }
    send('change', el, { tag: el.tagName.toLowerCase(), inputType: type, value: value }); }, true);
})();`;

export default { RECORDER_SCRIPT, describeToStep, buildRecordedRecorrido, strategyKey };
