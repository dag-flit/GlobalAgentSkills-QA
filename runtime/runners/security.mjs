// security.mjs — runner de la capa `security`. Ejecuta el escáner detectado
// (semgrep/bandit) y emite el EvidenceObject normalizado al sink.
// `security.target_profile` (api|web|generic|auto) ajusta el ruleset: OWASP API deja de
// ser el único modo. Hallazgos (exit != 0) → fail; sin escáner → skip con aviso.

import { runLayer } from "./_runner-core.mjs";

// target_profile → config de semgrep. `generic`/`auto` usan el ruleset por defecto.
function semgrepConfig(profile) {
  const tp = (profile.security && profile.security.target_profile) || "auto";
  if (tp === "api") return "p/owasp-top-ten";
  if (tp === "web") return "p/owasp-top-ten";
  return "auto";
}

const TOOLS = {
  semgrep: ({ profile }) => ["semgrep", "--error", "--quiet", "--config", semgrepConfig(profile)],
  bandit: () => ["bandit", "-r", "."],
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runSecurityTests(opts = {}) {
  return runLayer({ layer: "security", tools: TOOLS, ...opts });
}

export default { runSecurityTests };
