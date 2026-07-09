// runtime/pr/classify-files.mjs — clasificador DETERMINISTA de archivos cambiados en un PR (puro,
// sin red ni IA). Responde: ¿este cambio es VISIBLE en la app (probable por navegador/E2E) o es
// backend/infra/docs que un E2E no puede validar directamente?
//
// El monorepo de FLIT mezcla frontend (React/Next bajo `frontend/`), backend (.NET bajo `services/`,
// `api/`), contratos (`contracts/openapi`), migraciones y docs. Clasificar por RUTA + extensión nos
// dice qué HU/PR tiene superficie E2E y en qué ÁREA (usuarios, login, reportes…) — insumo del brief
// y del emparejamiento con guiones guardados. Es la separación QUÉ-se-puede-probar-por-navegador.

const TEST_RE = /(__tests__|__mocks__|\.(test|spec|stories)\.|(^|\/)(tests?|e2e|cypress|playwright)\/)/i;
const FRONTEND_ROOT = [
  /^frontend\//i,
  /^web(app)?\//i,
  /^client\//i,
  /(^|\/)ui\//i,
  /(^|\/)src\/(app|pages|components|views|screens|routes)\//i,
];
const VISIBLE_EXT = /\.(tsx|jsx|vue|svelte)$/i;
// Segmentos de frontend que NO son UI visible (lógica/estilos/tipos) → soporte, no objetivo E2E.
const NONVISUAL_SEG = /(^|\/)(lib|utils?|helpers?|types?|hooks?|store|stores|context|constants?|config|api|services?|models?|schemas?|assets?|i18n|locales?|styles?)\//i;
const BACKEND_RE = /\.(cs|java|go|py|rb|php|kt|scala)$|(^|\/)(api|services?|server|backend|controllers?|migrations?|domain|infrastructure)\//i;
const INFRA_RE = /(^|\/)(contracts?|\.github|infra|deploy|terraform|k8s|helm)\/|\.(ya?ml|yml|tf)$|(^|\/)dockerfile$/i;
const DOCS_RE = /\.(md|mdx|txt|adoc)$|(^|\/)docs?\//i;

/** Área funcional del archivo (usuarios, login, reportes…) para agrupar el brief y matchear guiones. */
export function areaOf(filename = "") {
  const parts = String(filename).split("/").filter(Boolean);
  if (!parts.length) return "";
  let base = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  // Nombres genéricos de Next/routing → usa el directorio contenedor (más significativo).
  if (/^(page|index|route|layout|main|app|default)$/i.test(base) && parts.length >= 2) {
    base = parts[parts.length - 2];
  }
  return base.toLowerCase();
}

/**
 * Clasifica UN archivo por su ruta. Categorías:
 *   frontend-visible  → UI que se ve en pantalla (.tsx/.jsx/… bajo frontend, no test ni soporte) → E2E
 *   frontend-support  → lógica/estilos/tipos del frontend (no objetivo directo de E2E)
 *   backend | infra | docs | test | other
 * @returns { filename, category, e2e:boolean, area:string }
 */
export function classifyFile(filename = "") {
  const f = String(filename);
  const area = areaOf(f);
  const inFrontend = FRONTEND_ROOT.some((re) => re.test(f));

  if (TEST_RE.test(f)) return { filename: f, category: "test", e2e: false, area };
  if (inFrontend) {
    if (VISIBLE_EXT.test(f) && !NONVISUAL_SEG.test(f)) return { filename: f, category: "frontend-visible", e2e: true, area };
    return { filename: f, category: "frontend-support", e2e: false, area };
  }
  if (BACKEND_RE.test(f)) return { filename: f, category: "backend", e2e: false, area };
  if (INFRA_RE.test(f)) return { filename: f, category: "infra", e2e: false, area };
  if (DOCS_RE.test(f)) return { filename: f, category: "docs", e2e: false, area };
  return { filename: f, category: "other", e2e: false, area };
}

/**
 * Clasifica la lista de archivos cambiados de un PR y resume la superficie E2E.
 * @param files  [{ filename, ... }] (de readPr().changedFiles) o [string]
 * @returns { classified, e2eFiles, e2eAreas, counts, hasE2eSurface }
 */
export function classifyChangedFiles(files = []) {
  const classified = files.map((f) => classifyFile(typeof f === "string" ? f : f?.filename || ""));
  const e2eFiles = classified.filter((c) => c.e2e);
  const e2eAreas = [...new Set(e2eFiles.map((c) => c.area).filter(Boolean))].sort();
  const counts = classified.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
  return { classified, e2eFiles, e2eAreas, counts, hasE2eSurface: e2eFiles.length > 0 };
}

export default { areaOf, classifyFile, classifyChangedFiles };
