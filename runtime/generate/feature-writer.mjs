// feature-writer.mjs — generador DETERMINISTA de especificaciones ejecutables (Ruta B, BDD/Gherkin).
//
// Paradigma: el AC ES el test. Por cada criterio de aceptación (AC) de una HU emite un archivo
// `.feature` con UN Scenario, etiquetado `@HU-### @TC-AC<n>` para trazabilidad. Los pasos salen del
// propio Gherkin del AC (Given/When/Then). Sin IA → cero alucinación.
//
// Mismo CONTRATO DE SALIDA que el generador de esqueletos (`skeleton-generator`) → es una
// ESTRATEGIA inyectable (`generateTests`) intercambiable: el orquestador la materializa igual
// (escribe `relPath` con `code`). No escribe en disco. Cross-platform, sin deps, CERO literales
// de dominio.

import { slug, tcKey, tcTitle } from "./skeleton-generator.mjs";

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Un criterio puede venir como string (línea) u objeto { title, detail } (AC por encabezado:
// title = AC, detail = Gherkin/pasos).
function critTitle(c) {
  return oneLine(typeof c === "string" ? c : (c && c.title) || "");
}
function critDetail(c) {
  return typeof c === "string" ? "" : oneLine((c && c.detail) || "");
}

// Nombre corto y legible para el Scenario (a partir del título del criterio).
function shortLabel(s, max = 80) {
  const t = oneLine(s).replace(/^AC\s*\d+\s*[—–\-:.)]\s*/i, "");
  if (!t) return "criterio sin texto";
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

// Palabras clave Gherkin (en + es) para partir el detalle en pasos individuales.
const STEP_KW = "\\b(?:Given|When|Then|And|But|Dado|Cuando|Entonces|Y|Pero)\\b";
function splitSteps(detail) {
  if (!detail) return [];
  return String(detail)
    .split(new RegExp(`(?=${STEP_KW})`, "i"))
    .map((s) => oneLine(s))
    .filter(Boolean);
}

// ¿el detalle usa palabras clave en español? → añade la cabecera `# language: es` que Cucumber
// necesita para reconocer Dado/Cuando/Entonces.
function isSpanishGherkin(detail) {
  return /\b(?:Dado|Cuando|Entonces)\b/i.test(detail || "");
}

// Sanea un tag Gherkin: `@` inicial, sin espacios.
function tag(s) {
  return "@" + String(s).replace(/^@/, "").replace(/\s+/g, "-");
}

// Cuerpo del `.feature`: una Feature por archivo con UN Scenario, etiquetado para trazabilidad.
// Sin Gherkin en el AC → un paso "pendiente" (Cucumber lo reporta como undefined/pending, no como
// pasa/falla). Honesto, igual que el `it.todo` del esqueleto.
function featureCode({ huId, huTitle, acIndex, criterionTitle, detail, key }) {
  const lines = [];
  if (isSpanishGherkin(detail)) lines.push("# language: es");
  lines.push(`${tag("HU-" + huId)} ${tag(key)}`);
  lines.push(`Feature: [HU-${huId}] ${huTitle || `HU ${huId}`}`);
  lines.push("");
  lines.push(`  # Criterio AC${acIndex}: ${criterionTitle}`);
  lines.push(`  Scenario: ${shortLabel(criterionTitle)}`);
  const steps = splitSteps(detail);
  if (steps.length) {
    for (const s of steps) lines.push(`    ${s}`);
  } else {
    lines.push(`    Given el criterio "${criterionTitle}" está definido`);
    lines.push(`    # TODO: definir los pasos (el AC no aportó Gherkin Given/When/Then)`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Genera los `.feature` (un Scenario por AC) de una HU a partir de sus criterios.
 * @param {object} opts
 * @param {{id: string, title?: string}} opts.requirement  la HU
 * @param {(string|{title:string,detail?:string})[]} opts.criteria  criterios de aceptación (AC)
 * @param {object} [opts.options]  { tcTitlePrefix }
 * @returns {Array<{huId, acIndex, criterion, detail, title, key, summary, framework, relPath, code,
 *           supported, status, reason}>}  (mismo contrato que skeleton-generator)
 */
export function generateFeaturesForRequirement({ requirement = {}, criteria = [], options = {} } = {}) {
  const huId = String(requirement.id || "");
  const huTitle = oneLine(requirement.title || "");
  const prefix = options.tcTitlePrefix || "TC-";
  return (criteria || []).map((c, i) => {
    const acIndex = i + 1;
    const cTitle = critTitle(c);
    const detail = critDetail(c);
    const key = tcKey({ prefix, acIndex });                 // "TC-AC1" — misma clave del sistema
    const title = tcTitle({ prefix, acIndex, criterion: cTitle });
    const code = featureCode({ huId, huTitle, acIndex, criterionTitle: cTitle, detail, key });
    return {
      huId,
      acIndex,
      criterion: cTitle,
      detail,
      title,
      key,
      summary: `Especificación ejecutable (BDD) que valida que: ${cTitle}`,
      framework: "cucumber",
      relPath: `qa-generated/HU-${huId}/AC${acIndex}-${slug(cTitle)}.feature`,
      code,
      supported: true,   // Gherkin es agnóstico de stack: siempre se puede emitir
      status: "pending", // pendiente de ejecutar (honesto)
      reason: null,
    };
  });
}

export default { generateFeaturesForRequirement };
