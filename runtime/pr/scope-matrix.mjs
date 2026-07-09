// runtime/pr/scope-matrix.mjs — EXPANSOR DE ALCANCE de pruebas (puro, sin IA). Convierte los AC de
// una HU + las áreas de UI que cambió el PR en una MATRIZ de escenarios de prueba que va MÁS ALLÁ
// del "camino feliz" que suele cubrir el dev.
//
// Por qué: los "test plan" de los devs son happy-path (o directamente CI: lint/build/test). El valor
// de QA está en lo que el dev NO probó. Aplicamos técnicas clásicas de diseño de pruebas (ISTQB):
// partición de equivalencia, valores límite, pruebas negativas, permisos/RBAC, estados de error,
// regresión adyacente y chequeo no-funcional. Todo DETERMINISTA: reglas por palabra clave del AC +
// del área, sin inventar afirmaciones. Cada escenario se marca dev-cubierto (si el test plan del dev
// lo toca) o GAP-QA (lo que falta probar). Esto NO ejecuta nada: describe QUÉ probar (el brief).

export const TECHNIQUES = {
  camino_feliz: "Camino feliz",
  validacion_negativa: "Validación negativa",
  valor_limite: "Valores límite",
  particion_equivalencia: "Partición de equivalencia",
  permisos_rbac: "Permisos / RBAC",
  estado_error: "Estados de error del sistema",
  regresion_adyacente: "Regresión adyacente",
  no_funcional: "No funcional (consola/carga)",
};

const STOP = new Set(
  ("dado cuando entonces pero que este esta esto para con por los las una unos unas del las como debe puede " +
    "sistema usuario cuenta desde hacia sobre entre cada todo toda cual quien donde")
    .split(/\s+/),
);

/** Minúsculas sin tildes (para comparar AC ↔ texto del dev sin que las tildes rompan el match). */
export function deaccent(text = "") {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Palabras salientes (≥4 letras, sin tildes, sin stopwords) de un texto → para medir solapamiento. */
export function keywords(text = "") {
  return [...new Set(deaccent(text).match(/[a-z]{4,}/g) || [])].filter((w) => !STOP.has(w));
}

/** ¿El texto del dev cubre este AC? (solapamiento de ≥2 palabras salientes, o todas si el AC tiene <2). */
function devTouchesAc(acText, devText) {
  const kw = keywords(acText);
  if (!kw.length || !devText) return false;
  const hits = kw.filter((w) => devText.includes(w)).length;
  return hits >= Math.min(2, kw.length);
}

// Reglas negativas/limite/etc. condicionadas por palabras clave del AC. Cada una aporta un escenario
// que el happy path NO cubre. `marker` = señales de que el dev SÍ lo probó (para no marcarlo gap).
const RULES = [
  {
    re: /correo|email|e-?mail/i,
    tech: "validacion_negativa",
    title: (s) => `Correo con formato inválido → se rechaza con mensaje claro (${s})`,
    marker: /inv[aá]lid|formato|correo mal/i,
    priority: "alta",
  },
  {
    re: /fecha|vigenc|rango|periodo|per[ií]odo|desde|hasta/i,
    tech: "valor_limite",
    title: (s) => `Fechas límite / rango invertido (desde > hasta) → validación (${s})`,
    marker: /fecha inv|rango/i,
    priority: "media",
  },
  {
    re: /obligatori|requerid|complet|ingres|registr|formulario|campo/i,
    tech: "validacion_negativa",
    title: (s) => `Campos obligatorios vacíos → no permite guardar, muestra el error (${s})`,
    marker: /obligatori|vac[ií]o|requerid/i,
    priority: "alta",
  },
  {
    re: /cantidad|monto|valor|n[uú]mero|importe|precio|stock/i,
    tech: "valor_limite",
    title: (s) => `Valores límite (0 / negativo / máximo) y no numérico (${s})`,
    marker: /l[ií]mite|negativ|m[aá]ximo|cero/i,
    priority: "media",
  },
  {
    re: /permiso|rol|acceso|autoriz|rbac|habilitad|desactivad|deshabilit/i,
    tech: "permisos_rbac",
    title: (s) => `Acceso SIN el rol/permiso → se bloquea (no se ve / no se puede) (${s})`,
    marker: /rol|permiso|sin acceso|rbac/i,
    priority: "alta",
  },
  {
    re: /duplicad|repetid|[uú]nic|existent|ya\s|mismo/i,
    tech: "validacion_negativa",
    title: (s) => `Registro duplicado / repetido → se impide con mensaje (${s})`,
    marker: /duplicad|repetid|ya exist/i,
    priority: "alta",
  },
  {
    // Solo acciones destructivas reales (no "rol desactivado", que es un estado → lo cubre RBAC).
    re: /elimin|borrar|anular\b|cancelar (la|el|una|un)\b|dar de baja/i,
    tech: "validacion_negativa",
    title: (s) => `Cancelar la acción destructiva y repetir sobre algo ya eliminado (${s})`,
    marker: /cancel|confirm|elimin/i,
    priority: "media",
  },
  {
    // Colecciones (lista/tabla/reporte), no un simple "se muestra un mensaje".
    re: /\blista\b|tabla|grid|listad|resultado|reporte|export|paginac/i,
    tech: "particion_equivalencia",
    title: (s) => `Estado vacío / sin resultados y con muchos elementos (${s})`,
    marker: /vac[ií]o|sin resultado|paginac/i,
    priority: "media",
  },
];

/**
 * Genera los escenarios de UN AC: siempre el camino feliz + los que apliquen por palabra clave +
 * un estado de error del sistema. Marca dev-cubierto según el test plan del dev (`devText`, en minúsculas).
 */
export function generateAcScenarios(ac, devText = "") {
  const title = typeof ac === "string" ? ac : ac?.title || "";
  const detail = typeof ac === "string" ? "" : ac?.detail || "";
  const acText = `${title} ${detail}`;
  const short = title.length > 60 ? title.slice(0, 57) + "…" : title;
  const dt = deaccent(devText); // texto del dev normalizado (sin tildes) para el match y los markers
  const touched = devTouchesAc(acText, dt);

  const scenarios = [
    { technique: "camino_feliz", title: `Camino feliz: ${short}`, priority: "alta", devCovered: touched },
  ];

  for (const r of RULES) {
    if (!r.re.test(acText)) continue;
    const devCovered = touched && r.marker.test(dt);
    scenarios.push({ technique: r.tech, title: r.title(short), priority: r.priority, devCovered });
  }

  scenarios.push({
    technique: "estado_error",
    title: `Error del sistema (500 / sin red / timeout) → mensaje amigable, sin romper la pantalla (${short})`,
    priority: "media",
    devCovered: false,
  });
  return scenarios;
}

/** Escenarios base por ÁREA de UI que cambió (independientes de los AC): carga, regresión, consola. */
export function generateAreaScenarios(area) {
  return [
    { technique: "camino_feliz", title: `La pantalla «${area}» carga y renderiza tras el cambio`, priority: "alta", devCovered: false },
    { technique: "regresion_adyacente", title: `Regresión: pantallas/flujos que reutilizan «${area}» siguen funcionando`, priority: "media", devCovered: false },
    { technique: "no_funcional", title: `Sin errores de consola ni recursos rotos en «${area}»`, priority: "baja", devCovered: false },
  ];
}

/**
 * Arma la matriz de alcance completa de una HU a partir de sus AC y las áreas de UI que cambió el PR.
 * @param {object} p
 * @param {Array}  p.acs        AC declarados de la HU ([{title,detail}] o [string])
 * @param {string[]} p.e2eAreas áreas de UI cambiadas (de classifyChangedFiles)
 * @param {string} p.testPlan   test plan del dev (readPr().testPlan)
 * @param {string[]} p.acClaims afirmaciones de AC del dev (readPr().acClaims)
 * @returns { acScenarios, areaScenarios, summary }
 */
export function buildScopeMatrix({ acs = [], e2eAreas = [], testPlan = "", acClaims = [] } = {}) {
  const devText = `${testPlan}\n${(acClaims || []).join("\n")}`.toLowerCase();

  const acScenarios = acs.map((ac) => ({
    ac: typeof ac === "string" ? ac : ac?.title || "",
    scenarios: generateAcScenarios(ac, devText),
  }));
  const areaScenarios = e2eAreas.map((area) => ({ area, scenarios: generateAreaScenarios(area) }));

  const all = [
    ...acScenarios.flatMap((a) => a.scenarios),
    ...areaScenarios.flatMap((a) => a.scenarios),
  ];
  const byTechnique = all.reduce((acc, s) => {
    acc[s.technique] = (acc[s.technique] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    total: all.length,
    devCovered: all.filter((s) => s.devCovered).length,
    gaps: all.filter((s) => !s.devCovered).length,
    byTechnique,
  };
  return { acScenarios, areaScenarios, summary };
}

export default { TECHNIQUES, keywords, generateAcScenarios, generateAreaScenarios, buildScopeMatrix };
