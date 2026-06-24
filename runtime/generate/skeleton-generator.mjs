// skeleton-generator.mjs — generador DETERMINISTA de pruebas (Fase A, SIN IA).
//
// Por cada criterio de aceptación (AC) de una HU produce:
//   - un TÍTULO de TC descriptivo según el criterio:  "TC-AC1 - Verificación de <resumen>",
//   - un RESUMEN en lenguaje claro (para revisión por NO técnicos),
//   - un archivo de prueba ESQUELETO (pendiente de implementar), etiquetado [HU-###] para que
//     su resultado se atribuya a la HU sin que nadie etiquete a mano.
//
// El generador es INYECTABLE (igual que exec/http/launchBrowser): éste es el default offline y
// determinista. La Fase B lo reemplaza por un generador con IA que escribe el cuerpo real del
// test. El esqueleto reporta "pendiente" (it.todo) — honesto: no finge verde ni rojo.
//
// Cross-platform, sin deps. No escribe en disco: devuelve {relPath, code} y el orquestador
// decide dónde materializarlo.

// ── utilidades de texto ──────────────────────────────────────────────────────

// Colapsa saltos/espacios a una sola línea.
function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Quita palabras clave Gherkin del inicio (es/en) para un resumen más natural.
function stripGherkin(s) {
  return oneLine(s).replace(/^(scenario|given|when|then|and|but|feature|dado|cuando|entonces|y|pero|escenario)\b[:\s]*/i, "");
}

// Etiqueta CORTA orientada al OBJETIVO del criterio, para el título del TC. Determinista
// (Fase A): toma el resultado esperado (cláusula "entonces/then" en Gherkin) o la cláusula
// principal, y la acota. La versión realmente "inteligente" la produce la IA en Fase B.
function conciseLabel(criterion, max = 42) {
  // Quita un prefijo "AC1 —"/"AC2 -" del propio criterio: el título ya lleva "TC-AC<n> -",
  // así no se duplica ("TC-AC1 - AC1 — …" → "TC-AC1 - …").
  let t = stripGherkin(criterion).replace(/^AC\s*\d+\s*[—–\-:.)]\s*/i, "");
  // En Gherkin el objetivo suele estar tras "entonces/then" (el resultado esperado).
  const then = t.match(/\b(?:entonces|then)\b[:\s]+(.+)$/i);
  if (then) {
    t = then[1];
  } else {
    // si no, corta en el primer límite de cláusula para quedarse con lo esencial.
    const cut = t.search(/[,;]| y no | para que | de modo que /i);
    if (cut > 12) t = t.slice(0, cut);
  }
  t = oneLine(t);
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "criterio sin texto";
}

// slug ASCII-safe para nombres de archivo.
export function slug(s) {
  return oneLine(s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "criterio";
}

// Título del TC: "TC-AC1 - <objetivo corto del criterio>".
export function tcTitle({ prefix = "TC-", acIndex, criterion }) {
  return `${prefix}AC${acIndex} - ${conciseLabel(criterion)}`;
}

// Prefijo estable para idempotencia (independiente del texto del criterio): "TC-AC1".
export function tcKey({ prefix = "TC-", acIndex }) {
  return `${prefix}AC${acIndex}`;
}

// ── selección de framework ───────────────────────────────────────────────────
// Fase A soporta los frameworks JS/TS (vitest/jest). Otros stacks se marcan "no soportado
// aún" (honesto) — la estructura/plan/TC se crean igual, pero sin archivo ejecutable.
function pickFramework(unitTool) {
  const t = String(unitTool || "").toLowerCase();
  if (t.includes("vitest")) return "vitest";
  if (t.includes("jest")) return "jest";
  return null;
}

// Título y detalle de un criterio, que puede venir como string (línea) u objeto {title, detail}
// (cuando el AC trae encabezados: title = AC, detail = Gherkin/pasos).
function critTitle(c) {
  return oneLine(typeof c === "string" ? c : (c && c.title) || "");
}
function critDetail(c) {
  return typeof c === "string" ? "" : oneLine((c && c.detail) || "");
}

// Cuerpo esqueleto del test. it.todo → la herramienta lo reporta como "pendiente", no como
// pasa/falla (no fingimos resultado). Etiqueta [HU-###] en el describe para la atribución.
// El detalle (Gherkin) se deja como comentario para que la Fase B (IA) escriba el cuerpo real.
function skeletonCode({ framework, huId, acIndex, title, criterionTitle, detail }) {
  if (framework !== "vitest" && framework !== "jest") return null;
  const name = `[HU-${huId}] AC${acIndex}: ${criterionTitle}`;
  const imp = framework === "vitest" ? `import { describe, it } from "vitest";\n` : "";
  const detailLines = detail
    ? detail.split(/(?=\b(?:Given|When|Then|And|But|Dado|Cuando|Entonces|Y|Pero)\b)/i).map((l) => `  //   ${l.trim()}`).filter((l) => l.trim() !== "//").join("\n") + "\n"
    : "";
  return (
    `// ${title}\n` +
    `// Auto-generado (esqueleto) desde el criterio de aceptación AC${acIndex} de la HU ${huId}.\n` +
    `// Pendiente de implementar — la Fase B (IA) o un humano escriben el cuerpo real.\n` +
    imp +
    `\ndescribe(${JSON.stringify(`[HU-${huId}] Validación de criterios`)}, () => {\n` +
    `  // Criterio (${criterionTitle})\n` +
    detailLines +
    `  it.todo(${JSON.stringify(name)});\n` +
    `});\n`
  );
}

/**
 * Genera los TC (esqueletos) de una HU a partir de sus criterios de aceptación.
 * @param {object} opts
 * @param {{id: string, title?: string}} opts.requirement  la HU
 * @param {string[]} opts.criteria                          criterios de aceptación (AC) de la HU
 * @param {object} [opts.options]  { unitTool, tcTitlePrefix }
 * @returns {Array<{huId, acIndex, criterion, title, key, summary, framework, relPath, code,
 *           supported, status, reason}>}
 */
export function generateTestsForRequirement({ requirement = {}, criteria = [], options = {} } = {}) {
  const huId = String(requirement.id || "");
  const prefix = options.tcTitlePrefix || "TC-";
  const framework = pickFramework(options.unitTool);
  const ext = framework ? "ts" : "txt";
  return (criteria || []).map((c, i) => {
    const acIndex = i + 1;
    const cTitle = critTitle(c);      // texto del criterio (AC), sin el Gherkin
    const detail = critDetail(c);     // Gherkin/pasos (detalle), si vino estructurado
    const title = tcTitle({ prefix, acIndex, criterion: cTitle });
    const code = skeletonCode({ framework, huId, acIndex, title, criterionTitle: cTitle, detail });
    return {
      huId,
      acIndex,
      criterion: cTitle,
      detail,
      title,
      key: tcKey({ prefix, acIndex }), // "TC-AC1" — clave de idempotencia
      summary: `Verifica que: ${cTitle}`,
      framework: framework || null,
      relPath: `qa-generated/HU-${huId}/AC${acIndex}-${slug(cTitle)}.test.${ext}`,
      code,
      supported: !!code,
      status: "pending", // esqueleto: pendiente de implementar (honesto)
      reason: code ? null : `generación de código no soportada aún para este stack (unit: ${options.unitTool || "?"})`,
    };
  });
}

export default { generateTestsForRequirement, tcTitle, tcKey, slug };
