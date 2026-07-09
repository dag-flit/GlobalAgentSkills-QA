// runtime/pr/scaffold.mjs — ANDAMIAJE determinista de guion (puro, sin IA). Desde los AC de una HU
// (+ la URL) produce un ESQUELETO de guion: un punto de partida que el humano COMPLETA con los
// localizadores/valores reales. NO es un guion listo para correr ni "adivina" cómo navegar — eso
// era la IA/"teatro" que se retiró. Es un molde honesto: ir_a → login → una verificación por AC
// (con placeholders explícitos «completar: …» y el `ac` ya etiquetado para la matriz de cobertura).
//
// Las pruebas negativas/RBAC/límite del brief NO se andamian como pasos (no se pueden deducir a
// ciegas): quedan como NOTAS para que el humano las agregue. Así el andamiaje ahorra tecleo sin
// inventar validaciones falsas.

const PH = (t) => `«completar: ${t}»`;

/**
 * Genera el esqueleto de guion de una HU.
 * @param {object} p
 * @param {string} [p.appUrl]  URL inicial (si falta → placeholder).
 * @param {Array}  [p.acs]     AC de la HU ([{title,detail}] o [string]).
 * @param {boolean}[p.login]   anteponer el paso de login automático.
 * @param {string} [p.title]   título de la HU (para las notas).
 * @returns { flow: Array<object>, notes: string[] }
 */
export function scaffoldFlow({ appUrl = "", acs = [], login = false, title = "" } = {}) {
  const flow = [{ op: "ir_a", url: appUrl || PH("URL de la pantalla a validar") }];
  if (login) flow.push({ op: "login" });

  const notes = [
    "Esqueleto: completá los «placeholders» con lo que se VE en pantalla (textos/localizadores reales).",
    "Es el camino feliz por AC. Agregá a mano los escenarios del brief (negativa, límites, RBAC, error).",
  ];
  if (title) notes.unshift(`Andamiaje para: ${title}`);

  if (!acs.length) {
    flow.push({ op: "verificar_texto", texto: PH("texto que confirma que la pantalla cargó OK") });
  }
  for (const ac of acs) {
    const acTitle = typeof ac === "string" ? ac : ac?.title || "";
    // Una verificación placeholder por AC, ya etiquetada con `ac` → llena la matriz de cobertura.
    flow.push({
      op: "verificar_texto",
      texto: PH(`qué se ve cuando se cumple: ${acTitle}`),
      ac: acTitle,
    });
  }
  flow.push({ op: "captura", nombre: "resultado" });
  return { flow, notes };
}

export default { scaffoldFlow };
