// Catálogo de TIPOS DE PASO del constructor de suites de regresión (subconjunto amigable del
// vocabulario del motor, explore-steps.STEPS). `needsElement` → el paso apunta a un elemento del
// catálogo (se elige por ALIAS). `field` → un campo de texto libre extra (valor/texto/ruta/nombre).
// El login es AUTOMÁTICO para sistemas con login (lo antepone el runner en la Fase 3): no es un paso.

export interface StepType {
  op: string;
  label: string;
  needsElement?: boolean;
  field?: "valor" | "texto" | "ruta" | "nombre";
  placeholder?: string;
  hint?: string;
}

export const STEP_TYPES: StepType[] = [
  { op: "ir_a", label: "Ir a una ruta", field: "ruta", placeholder: "/?m=reportes", hint: "Navega a una ruta del sistema (se une a la URL base)." },
  { op: "clic", label: "Clic en un elemento", needsElement: true, hint: "Hace clic en el elemento elegido del catálogo." },
  { op: "escribir", label: "Escribir en un campo", needsElement: true, field: "valor", placeholder: "texto a escribir", hint: "Escribe el valor en el campo elegido." },
  { op: "seleccionar", label: "Seleccionar una opción", needsElement: true, field: "valor", placeholder: "opción", hint: "Elige una opción en una lista desplegable." },
  { op: "verificar_visible", label: "Verificar que se ve", needsElement: true, hint: "Falla si el elemento no está visible." },
  { op: "verificar_texto", label: "Verificar texto en pantalla", field: "texto", placeholder: "Total trámites", hint: "Falla si ese texto no aparece en la página." },
  { op: "verificar_url", label: "Verificar que la URL contiene", field: "texto", placeholder: "/reportes", hint: "Falla si la URL no contiene ese fragmento." },
  { op: "captura", label: "Captura de pantalla", field: "nombre", placeholder: "nombre (opcional)", hint: "Guarda una captura como evidencia." },
];

export const stepType = (op: string): StepType | undefined => STEP_TYPES.find((s) => s.op === op);

// Aplana el catálogo de un sistema a opciones de alias para el selector (agrupadas por página).
// `kind` clasifica el elemento (campo/botón/enlace/título/test-id/texto) para mostrarlo con ícono y
// tipo → el usuario distingue elementos con el MISMO texto (p.ej. el título «Iniciar Sesión» vs el
// botón «Iniciar Sesión») sin tener que adivinar. `name` es el texto/etiqueta visible del elemento.
export type ElementKind = "campo" | "boton" | "enlace" | "titulo" | "testid" | "texto";
export interface AliasOption {
  alias: string;
  page: string;
  hint: string;
  kind: ElementKind;
  name: string;
}

const CLICKABLE = new Set(["button", "checkbox", "radio", "switch", "tab", "menuitem", "option"]);
const FIELDLIKE = new Set(["textbox", "combobox", "searchbox", "spinbutton", "listbox", "slider"]);

function kindOf(e: { by: string; role?: string }): ElementKind {
  if (e.by === "label" || e.by === "placeholder") return "campo";
  if (e.by === "testid") return "testid";
  if (e.by === "role") {
    if (e.role && CLICKABLE.has(e.role)) return "boton";
    if (e.role === "link") return "enlace";
    if (e.role === "heading") return "titulo";
    if (e.role && FIELDLIKE.has(e.role)) return "campo";
  }
  return "texto";
}

export function aliasOptions(catalog: { pages?: Array<{ name: string; elements: Array<{ alias: string; by: string; role?: string; name?: string; value?: string }> }> } | null | undefined): AliasOption[] {
  const out: AliasOption[] = [];
  for (const p of catalog?.pages ?? []) {
    for (const e of p.elements ?? []) {
      const ref = e.by === "role" ? `${e.role}: ${e.name}` : `${e.by}: ${e.value}`;
      const name = (e.by === "role" ? e.name : e.value) || e.alias;
      out.push({ alias: e.alias, page: p.name, hint: ref, kind: kindOf(e), name });
    }
  }
  return out;
}

export const KIND_META: Record<ElementKind, { icon: string; label: string }> = {
  campo: { icon: "✏️", label: "Campo" },
  boton: { icon: "🔘", label: "Botón" },
  enlace: { icon: "🔗", label: "Enlace" },
  titulo: { icon: "📄", label: "Título" },
  testid: { icon: "🏷️", label: "Test-id" },
  texto: { icon: "•", label: "Texto" },
};
