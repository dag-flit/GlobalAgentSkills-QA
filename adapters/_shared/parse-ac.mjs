// parse-ac.mjs — normaliza criterios de aceptación desde texto plano / markdown
// (checklist `- [ ]`, viñetas, líneas Gherkin) a un array de strings. Compartido por los
// adapters cuyo campo de requisitos es texto (github issue body, jira description).
// El adapter ADO tiene el suyo aparte porque su campo es HTML.

export function parseAcText(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^- \[.?\]/.test(t)) out.push(t.replace(/^- \[.?\]\s*/, ""));
    else if (/^[-*]\s+/.test(t)) out.push(t.replace(/^[-*]\s+/, ""));
    else out.push(t); // incluye líneas Gherkin (Scenario/Given/When/Then)
  }
  return out;
}

export default { parseAcText };
