// step-label.mjs — rótulo LEGIBLE de un paso ejecutado, para la evidencia (galería de Evidences,
// tabla «Pasos ejecutados» de la HU y reporte HTML). PURO/offline. El nombre del caso viene como
// «N. <op> <descripción>» (N y op son técnicos); acá se quita el «N.» y la op cruda, y se antepone la
// ACCIÓN en lenguaje claro, conservando el elemento/descripción. Ej.: «Escribir en «Usuario»»,
// «Verificar texto «Correo o contraseña incorrectos»». Fuente ÚNICA (no duplicar en la webapp).

// Las ops llegan COMPILADAS (p.ej. «verificar texto» → esperar_texto, «verificar que se ve» → esperar).
export const ACTION_VERB = {
  ir_a: "Ir a", login: "Iniciar sesión", escribir: "Escribir en", clic: "Clic en", seleccionar: "Seleccionar en",
  marcar: "Marcar", desmarcar: "Desmarcar", limpiar: "Limpiar", subir_archivo: "Subir archivo a", tecla: "Tecla en",
  esperar: "Verificar que se ve", esperar_texto: "Verificar texto", esperar_tiempo: "Esperar",
  verificar_url: "Verificar URL", verificar_titulo: "Verificar título", verificar_valor: "Verificar el valor de",
  verificar_cantidad: "Verificar la cantidad de", verificar_atributo: "Verificar un atributo de",
  verificar_habilitado: "Verificar que está habilitado", verificar_marcado: "Verificar que está marcado", captura: "Captura",
};

/**
 * @param {string} name  nombre del caso ("N. <op> <descripción>")
 * @param {string} [op]  operación del motor (si falta —corridas viejas—, se muestra la descripción cruda)
 * @param {{keepNumber?:boolean}} [opts]  keepNumber → conserva el «N.» al frente (para listas de pasos
 *   numeradas, como «Pasos ejecutados» o el reporte). En la galería de Evidences NO se usa: ahí el nº ya
 *   lo pone «Paso N» y duplicarlo se veía mal.
 * @returns {string} rótulo legible, o "" si no hay nada que mostrar
 */
export function friendlyStep(name, op, { keepNumber = false } = {}) {
  const raw = String(name || "");
  const num = (/^\s*(\d+)\.\s*/.exec(raw) || [])[1] || "";
  let desc = raw.replace(/^\s*\d+\.\s*/, "");
  if (op) desc = desc.replace(new RegExp("^" + String(op).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "");
  desc = desc.trim();
  const verb = op ? ACTION_VERB[op] ?? op : "";
  const body = verb && desc ? `${verb} «${desc}»` : verb || desc || "";
  return keepNumber && num ? `${num}. ${body}` : body;
}

export default { friendlyStep, ACTION_VERB };
