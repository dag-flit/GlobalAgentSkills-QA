// parse-cases.mjs — extrae los TC (test cases) individuales de la salida de cada herramienta.
// Estrategia: reporter JSON nativo (donde la herramienta lo soporta sin instalar nada) →
// lista estructurada de casos; si la salida no es el JSON esperado, devuelve `null` y el
// runner DEGRADA al resumen de texto de siempre (nunca rompe el ciclo).
//
// Forma de un caso (TC):  { name, status: "pass"|"fail"|"skip", duration: ms|null, message: string|null }
// Forma de la entrada:    out = { code, stdout, stderr }   (la que produce el ejecutor del runner)
//
// CERO literales de dominio. Cross-platform. Sin dependencias.

import path from "node:path";

// Localiza y parsea el primer objeto/array JSON dentro de un texto (las herramientas a veces
// intercalan avisos antes/después del JSON). Devuelve null si no hay JSON válido.
function pickJson(text) {
  if (!text) return null;
  const t = String(text);
  try {
    return JSON.parse(t);
  } catch {
    /* sigue con la extracción acotada */
  }
  const a = t.indexOf("{");
  const b = t.indexOf("[");
  const start = a === -1 ? b : b === -1 ? a : Math.min(a, b);
  if (start === -1) return null;
  const close = t[start] === "{" ? "}" : "]";
  const end = t.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// Normaliza un mensaje de error: sin ANSI, recortado, acotado (evita volcar stacks enteros).
function cleanMsg(s) {
  if (!s) return null;
  const t = stripAnsi(String(s)).trim();
  return t ? t.slice(0, 600) : null;
}

// Ruta relativa al repo cuando es posible (más legible en la evidencia); si no, la original.
function rel(repoRoot, p) {
  if (!p) return "";
  if (!repoRoot) return String(p);
  try {
    const r = path.relative(repoRoot, p);
    return r && !r.startsWith("..") ? r : String(p);
  } catch {
    return String(p);
  }
}

function dur(d) {
  return typeof d === "number" && isFinite(d) ? Math.round(d) : null;
}

// Resumen compacto de una lista de casos para narrativas/encabezados.
export function casesSummary(cases) {
  const c = (s) => cases.filter((x) => x.status === s).length;
  return `${cases.length} TC · ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`;
}

// ── Parsers por herramienta ───────────────────────────────────────────────────

// vitest (`--reporter=json`) y jest (`--json`) comparten el formato Jest:
// { testResults: [ { assertionResults: [ { ancestorTitles, title, status, duration, failureMessages } ] } ] }
export function parseJestLike(out) {
  const j = pickJson(out.stdout) || pickJson(out.stderr);
  if (!j || !Array.isArray(j.testResults)) return null;
  const cases = [];
  for (const file of j.testResults) {
    const ars = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const a of ars) {
      const name = [...(a.ancestorTitles || []), a.title].filter(Boolean).join(" › ") || a.fullName || "(test)";
      const status = a.status === "passed" ? "pass" : a.status === "failed" ? "fail" : "skip";
      cases.push({ name, status, duration: dur(a.duration), message: cleanMsg((a.failureMessages || []).join("\n")) });
    }
  }
  return cases;
}

// playwright (`--reporter=json`): suites anidadas → specs → tests → results.
export function parsePlaywright(out) {
  const j = pickJson(out.stdout) || pickJson(out.stderr);
  if (!j || !Array.isArray(j.suites)) return null;
  const cases = [];
  const mapStatus = (s) => (s === "passed" || s === "expected" ? "pass" : s === "skipped" ? "skip" : "fail");
  const walk = (suites, prefix) => {
    for (const s of suites || []) {
      const title = [prefix, s.title].filter(Boolean).join(" › ");
      for (const spec of s.specs || []) {
        const name = [title, spec.title].filter(Boolean).join(" › ") || "(spec)";
        let status = "skip";
        let duration = null;
        let message = null;
        for (const test of spec.tests || []) {
          const results = test.results || [];
          const r = results[results.length - 1];
          if (!r) continue;
          status = mapStatus(r.status);
          if (typeof r.duration === "number") duration = dur(r.duration);
          if (r.error) message = cleanMsg(r.error.message || r.error.stack || "");
        }
        cases.push({ name, status, duration, message });
      }
      walk(s.suites, title);
    }
  };
  walk(j.suites, "");
  return cases;
}

// eslint (`-f json`): [ { filePath, messages: [ { ruleId, message, severity, line, column } ] } ]
// severity 2 = error (fail), 1 = warning (skip, no bloquea).
export function parseEslint(out, { repoRoot } = {}) {
  const j = pickJson(out.stdout);
  if (!Array.isArray(j)) return null;
  const cases = [];
  for (const f of j) {
    for (const m of f.messages || []) {
      cases.push({
        name: `${rel(repoRoot, f.filePath)}:${m.line ?? "?"}:${m.column ?? "?"} ${m.ruleId || ""}`.trim(),
        status: m.severity === 2 ? "fail" : "skip",
        duration: null,
        message: cleanMsg(m.message),
      });
    }
  }
  return cases;
}

// ruff (`--output-format=json`): [ { code, message, filename, location: { row } } ]
export function parseRuff(out, { repoRoot } = {}) {
  const j = pickJson(out.stdout);
  if (!Array.isArray(j)) return null;
  return j.map((d) => ({
    name: `${rel(repoRoot, d.filename)}:${d.location?.row ?? "?"} ${d.code || ""}`.trim(),
    status: "fail",
    duration: null,
    message: cleanMsg(d.message),
  }));
}

// semgrep (`--json`): { results: [ { check_id, path, start: { line }, extra: { message } } ] }
export function parseSemgrep(out, { repoRoot } = {}) {
  const j = pickJson(out.stdout);
  if (!j || !Array.isArray(j.results)) return null;
  return j.results.map((r) => ({
    name: `${r.check_id || "rule"} @ ${rel(repoRoot, r.path)}:${r.start?.line ?? "?"}`,
    status: "fail",
    duration: null,
    message: cleanMsg(r.extra?.message || ""),
  }));
}

// bandit (`-f json`): { results: [ { test_id, issue_text, issue_severity, filename, line_number } ] }
export function parseBandit(out, { repoRoot } = {}) {
  const j = pickJson(out.stdout);
  if (!j || !Array.isArray(j.results)) return null;
  return j.results.map((r) => ({
    name: `${r.test_id || "B?"} ${rel(repoRoot, r.filename)}:${r.line_number ?? "?"}`,
    status: "fail",
    duration: null,
    message: cleanMsg(`[${r.issue_severity || ""}] ${r.issue_text || ""}`),
  }));
}

export default {
  casesSummary,
  parseJestLike,
  parsePlaywright,
  parseEslint,
  parseRuff,
  parseSemgrep,
  parseBandit,
};
