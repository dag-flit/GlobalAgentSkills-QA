// template-applier.mjs — catálogo de plantillas BDD + aplicador (Ruta B, fase B3.5).
//
// Las plantillas (`templates/bdd/*.feature.tmpl`) son escenarios Gherkin PARAMETRIZADOS con
// `{{placeholders}}` que cubren CASOS ADICIONALES estándar (smoke CRUD, validación de formularios,
// salud de API…), reutilizables entre proyectos/empresas. El aplicador rellena los parámetros y
// devuelve un objeto materializable (mismo contrato que el feature-writer: { relPath, code, … }),
// así el runner `bdd` las ejecuta igual que las generadas desde los AC.
//
// Determinista, sin IA, sin deps. CERO literales de dominio (los datos vienen como parámetros).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // runtime/generate/
const CATALOG_DIR = path.resolve(HERE, "..", "..", "templates", "bdd");

// Extrae los parámetros de una plantilla. Soporta `{{name}}` (obligatorio) y `{{name|default}}`
// (opcional, con valor por defecto). Devuelve [{ name, default, required }] sin duplicados.
function paramsOf(tmpl) {
  const map = new Map();
  for (const m of String(tmpl).matchAll(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g)) {
    const name = m[1];
    const def = m[2] != null ? m[2].trim() : undefined;
    const prev = map.get(name);
    if (!prev) map.set(name, { name, default: def, required: def == null });
    else if (def != null && prev.default == null) map.set(name, { name, default: def, required: false });
  }
  return [...map.values()];
}

/** Lista las plantillas del catálogo con sus parámetros (name/default/required); `tag` es interno. */
export function listTemplates() {
  let files;
  try {
    files = fs.readdirSync(CATALOG_DIR).filter((f) => f.endsWith(".feature.tmpl"));
  } catch {
    return [];
  }
  return files.sort().map((f) => {
    const id = f.replace(/\.feature\.tmpl$/, "");
    let tmpl = "";
    try { tmpl = fs.readFileSync(path.join(CATALOG_DIR, f), "utf8"); } catch { /* ignora */ }
    return { id, file: f, params: paramsOf(tmpl).filter((p) => p.name !== "tag") };
  });
}

// Sustituye `{{name}}` / `{{name|default}}`: usa el valor dado; si no, el default; si no hay ninguno,
// deja el placeholder `{{name}}` para detectar que falta un parámetro OBLIGATORIO.
function render(tmpl, values) {
  return String(tmpl).replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (_, name, def) => {
    const v = values[name];
    if (v != null && v !== "") return String(v);
    if (def != null) return def.trim();
    return `{{${name}}}`;
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plantilla";

/**
 * Aplica una plantilla del catálogo con parámetros → objeto materializable (contrato feature-writer).
 * @param {object} opts
 * @param {string} opts.template  id de la plantilla (nombre sin `.feature.tmpl`)
 * @param {Record<string,string>} [opts.params]  valores de los placeholders
 * @param {string} [opts.huId]  HU dueña (para etiqueta `@HU-###` y trazabilidad); opcional
 * @returns {{template, huId, params, code, relPath, supported, missing, status}}
 */
export function applyTemplate({ template, params = {}, huId = "" } = {}) {
  const file = path.join(CATALOG_DIR, `${template}.feature.tmpl`);
  let tmpl;
  try {
    tmpl = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`plantilla no encontrada: ${template}`);
  }
  const declared = paramsOf(tmpl).filter((p) => p.name !== "tag");
  const required = declared.filter((p) => p.required).map((p) => p.name);
  const missing = required.filter((p) => params[p] == null || params[p] === "");
  const tag = huId ? `HU-${huId}` : "plantilla";
  const code = render(tmpl, { tag, ...params });
  const unresolved = /\{\{\s*\w+\s*\}\}/.test(code); // quedó algún placeholder sin resolver
  return {
    template,
    huId: String(huId || ""),
    params,
    code,
    relPath: huId
      ? `qa-generated/HU-${huId}/plantilla-${slug(template)}.feature`
      : `qa-generated/plantillas/${slug(template)}.feature`,
    supported: !unresolved,
    missing,
    status: "pending", // pendiente de ejecutar (honesto)
  };
}

export default { listTemplates, applyTemplate };
