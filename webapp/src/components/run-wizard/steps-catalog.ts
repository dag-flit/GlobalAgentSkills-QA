// Catálogo de operaciones del constructor visual de guiones E2E (para no técnicos).
// Es DATO: el constructor (StepsStep) renderiza los campos de cada paso a partir de aquí, así
// se mantiene chico y crecer el vocabulario es agregar entradas (espejo del registro del motor
// en runtime/runners/explore-steps.mjs). El primer campo de cada op es el "principal" (obligatorio).

export type OpId =
  | "ir_a"
  | "escribir"
  | "clic"
  | "tecla"
  | "seleccionar"
  | "marcar"
  | "desmarcar"
  | "subir_archivo"
  | "limpiar"
  | "esperar"
  | "esperar_texto"
  | "verificar_visible"
  | "verificar_texto"
  | "verificar_valor"
  | "verificar_cantidad"
  | "verificar_url"
  | "verificar_titulo"
  | "verificar_atributo"
  | "verificar_habilitado"
  | "verificar_marcado"
  | "captura";

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  /** "valor" → atajos de credenciales (👤/🔑). "locator" → elige CÓMO encontrar el elemento
   * (etiqueta/texto/placeholder/botón) en vez de un selector CSS técnico. */
  kind?: "text" | "valor" | "locator";
}
export interface OpDef {
  id: OpId;
  label: string;
  hint: string;
  fields: FieldDef[];
  /** Grupo para organizar el desplegable (optgroup). */
  group: string;
  /** Estrategia de localización por defecto cuando el op tiene un campo "locator". */
  defaultPor?: LocatorId;
}

export type LocatorId = "etiqueta" | "placeholder" | "texto" | "boton" | "css";

/** Estrategias amigables para encontrar un elemento sin escribir CSS. */
export const LOCATORS: { id: LocatorId; label: string; hint: string }[] = [
  { id: "etiqueta", label: "Etiqueta del campo", hint: "el texto de la etiqueta (ej. Usuario)" },
  { id: "placeholder", label: "Texto de ejemplo", hint: "el texto gris dentro del campo" },
  { id: "texto", label: "Texto visible", hint: "un texto que se ve en pantalla" },
  { id: "boton", label: "Botón / enlace por nombre", hint: "el texto del botón (ej. Ingresar)" },
  { id: "css", label: "Selector CSS (avanzado)", hint: "#id, .clase, button[type=submit]…" },
];

/** Un paso del guion: la operación + sus campos (todos strings; `por` = estrategia del locator). */
export type FlowStep = { op: OpId } & Record<string, string | undefined>;

const G_NAV = "Navegación";
const G_IN = "Entrada";
const G_WAIT = "Espera";
const G_CHECK = "Verificación";
const G_EV = "Evidencia";

export const OPS: OpDef[] = [
  { id: "ir_a", group: G_NAV, label: "Ir a (navegar)", hint: "Abre otra URL o ruta", fields: [{ name: "url", label: "URL o ruta", placeholder: "/facturas  o  https://…" }] },

  {
    id: "escribir",
    group: G_IN,
    label: "Escribir en un campo",
    hint: "Llena un input (usuario, clave, búsqueda…)",
    defaultPor: "etiqueta",
    fields: [
      { name: "en", label: "Campo", placeholder: "Usuario", kind: "locator" },
      { name: "valor", label: "Valor", placeholder: "texto a escribir", kind: "valor" },
    ],
  },
  { id: "clic", group: G_IN, label: "Hacer clic", hint: "Clic en un botón/enlace", defaultPor: "boton", fields: [{ name: "en", label: "Elemento", placeholder: "Ingresar", kind: "locator" }] },
  {
    id: "seleccionar",
    group: G_IN,
    label: "Seleccionar de una lista",
    hint: "Elige una opción de un desplegable (select)",
    defaultPor: "etiqueta",
    fields: [
      { name: "en", label: "Lista", placeholder: "País", kind: "locator" },
      { name: "valor", label: "Opción", placeholder: "texto o valor de la opción" },
    ],
  },
  { id: "marcar", group: G_IN, label: "Marcar (checkbox/radio)", hint: "Tilda un checkbox o radio", defaultPor: "etiqueta", fields: [{ name: "en", label: "Elemento", placeholder: "Acepto los términos", kind: "locator" }] },
  { id: "desmarcar", group: G_IN, label: "Desmarcar (checkbox)", hint: "Destilda un checkbox", defaultPor: "etiqueta", fields: [{ name: "en", label: "Elemento", placeholder: "Recordarme", kind: "locator" }] },
  {
    id: "subir_archivo",
    group: G_IN,
    label: "Subir archivo",
    hint: "Carga un archivo en un input file",
    defaultPor: "etiqueta",
    fields: [
      { name: "en", label: "Campo de archivo", placeholder: "Adjuntar", kind: "locator" },
      { name: "ruta", label: "Ruta del archivo", placeholder: "C:\\ruta\\documento.pdf" },
    ],
  },
  { id: "limpiar", group: G_IN, label: "Limpiar campo", hint: "Borra el contenido de un input", defaultPor: "etiqueta", fields: [{ name: "en", label: "Campo", placeholder: "Búsqueda", kind: "locator" }] },
  { id: "tecla", group: G_IN, label: "Presionar tecla", hint: "Enter, Tab, Escape…", fields: [{ name: "tecla", label: "Tecla", placeholder: "Enter" }] },

  { id: "esperar", group: G_WAIT, label: "Esperar elemento", hint: "Hasta que aparezca un elemento", defaultPor: "texto", fields: [{ name: "en", label: "Elemento", placeholder: "Panel principal", kind: "locator" }] },
  { id: "esperar_texto", group: G_WAIT, label: "Esperar texto", hint: "Hasta que aparezca un texto", fields: [{ name: "texto", label: "Texto", placeholder: "Bienvenido" }] },

  { id: "verificar_visible", group: G_CHECK, label: "Verificar que se ve", hint: "Falla si el elemento no está visible", defaultPor: "texto", fields: [{ name: "en", label: "Elemento", placeholder: "Operación exitosa", kind: "locator" }] },
  { id: "verificar_texto", group: G_CHECK, label: "Verificar texto", hint: "Falla si el texto no aparece", fields: [{ name: "texto", label: "Texto", placeholder: "Operación exitosa" }] },
  {
    id: "verificar_valor",
    group: G_CHECK,
    label: "Verificar valor de un campo",
    hint: "El input contiene exactamente ese valor",
    defaultPor: "etiqueta",
    fields: [
      { name: "en", label: "Campo", placeholder: "Total", kind: "locator" },
      { name: "valor", label: "Valor esperado", placeholder: "1000" },
    ],
  },
  {
    id: "verificar_cantidad",
    group: G_CHECK,
    label: "Verificar cantidad de elementos",
    hint: "Cuántos elementos coinciden (ej. filas)",
    defaultPor: "css",
    fields: [
      { name: "en", label: "Elementos", placeholder: "tabla tr, .item", kind: "locator" },
      { name: "numero", label: "Cantidad esperada", placeholder: "3" },
    ],
  },
  { id: "verificar_url", group: G_CHECK, label: "Verificar URL", hint: "La URL actual contiene…", fields: [{ name: "texto", label: "La URL contiene", placeholder: "/dashboard" }] },
  { id: "verificar_titulo", group: G_CHECK, label: "Verificar título de página", hint: "El título contiene…", fields: [{ name: "texto", label: "El título contiene", placeholder: "Inicio" }] },
  {
    id: "verificar_atributo",
    group: G_CHECK,
    label: "Verificar atributo",
    hint: "Un atributo del elemento vale…",
    defaultPor: "texto",
    fields: [
      { name: "en", label: "Elemento", placeholder: "Descargar", kind: "locator" },
      { name: "nombre", label: "Atributo", placeholder: "href, value, class…" },
      { name: "valor", label: "Valor esperado", placeholder: "/archivo.pdf" },
    ],
  },
  { id: "verificar_habilitado", group: G_CHECK, label: "Verificar habilitado", hint: "El elemento no está deshabilitado", defaultPor: "boton", fields: [{ name: "en", label: "Elemento", placeholder: "Guardar", kind: "locator" }] },
  { id: "verificar_marcado", group: G_CHECK, label: "Verificar marcado (checkbox)", hint: "El checkbox está tildado", defaultPor: "etiqueta", fields: [{ name: "en", label: "Elemento", placeholder: "Acepto", kind: "locator" }] },

  { id: "captura", group: G_EV, label: "Tomar captura", hint: "Screenshot con un nombre", fields: [{ name: "nombre", label: "Nombre", placeholder: "dashboard" }] },
];

/** OPS agrupadas por categoría, en el orden de aparición (para los optgroups del desplegable). */
export function opsByGroup(): { group: string; ops: OpDef[] }[] {
  const order: string[] = [];
  const map = new Map<string, OpDef[]>();
  for (const o of OPS) {
    if (!map.has(o.group)) {
      map.set(o.group, []);
      order.push(o.group);
    }
    map.get(o.group)!.push(o);
  }
  return order.map((group) => ({ group, ops: map.get(group)! }));
}

/** ¿El op localiza un elemento (tiene un campo "locator")? */
export function hasLocator(op: OpId): boolean {
  return (OP_BY_ID[op]?.fields ?? []).some((f) => f.kind === "locator");
}

/** ¿El op PRUEBA un criterio de aceptación? Solo las verificaciones (asserts) → pueden etiquetar
 * un AC. Así la matriz de cobertura solo cuenta pasos que realmente comprueban algo. */
export function provesAc(op: OpId): boolean {
  return op.startsWith("verificar");
}

/** Criterio de aceptación declarado de la HU (título + detalle opcional). Lo trae AcPanel de Azure
 * y se usa para poblar el desplegable «¿Qué AC prueba?» de los pasos de verificación. */
export interface DeclaredAc {
  title: string;
  detail?: string;
}

export const OP_BY_ID: Record<OpId, OpDef> = Object.fromEntries(OPS.map((o) => [o.id, o])) as Record<OpId, OpDef>;

/** ¿El paso tiene lleno su campo principal? (los vacíos se descartan al ejecutar). */
export function stepFilled(step: FlowStep): boolean {
  const def = OP_BY_ID[step.op];
  const primary = def?.fields[0]?.name;
  return Boolean(primary && String(step[primary] ?? "").trim());
}

/** Normaliza a strings (quita undefined) para enviar al backend. Incluye `por` si el op localiza,
 * y `ac` (qué criterio prueba) si es una verificación con AC elegido. */
export function cleanStep(step: FlowStep): Record<string, string> {
  const out: Record<string, string> = { op: step.op };
  const def = OP_BY_ID[step.op];
  for (const f of def?.fields ?? []) {
    const v = step[f.name];
    if (v != null && String(v).trim() !== "") out[f.name] = String(v);
  }
  if (hasLocator(step.op)) out.por = step.por || def?.defaultPor || "css";
  if (provesAc(step.op) && step.ac != null && String(step.ac).trim() !== "") out.ac = String(step.ac).trim();
  return out;
}
