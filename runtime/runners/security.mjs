// security.mjs — runner de la capa `security`. Ejecuta el escáner detectado
// (semgrep/bandit) y emite el EvidenceObject normalizado al sink.
// `security.target_profile` (api|web|generic|auto) ajusta el ruleset: OWASP API deja de
// ser el único modo. Hallazgos (exit != 0) → fail; sin escáner → skip con aviso.

import { runLayer } from "./_runner-core.mjs";
import { parseSemgrep, parseBandit } from "./parse-cases.mjs";
import { scanSecrets } from "./secret-scan.mjs";
import { runSca } from "./sca.mjs";
import { scanLicenses } from "./license-scan.mjs";

// target_profile → config de semgrep. `generic`/`auto` usan el ruleset por defecto.
function semgrepConfig(profile) {
  const tp = (profile.security && profile.security.target_profile) || "auto";
  if (tp === "api") return "p/owasp-top-ten";
  if (tp === "web") return "p/owasp-top-ten";
  return "auto";
}

// Exit codes que significan "el escáner NO concluyó" (error de config/red/parseo), NO un
// hallazgo de seguridad real: semgrep y bandit usan `2` para esto. El runner los OMITE en vez
// de marcar fail → un `--config auto` sin red, o un repo que el escáner no parsea, no rompe el
// ciclo. Hallazgos reales siguen siendo exit 1 (con `--error` en semgrep) → fail.
const SCANNER_ERROR = [2];

// bandit escanea TODO el árbol, incluido el código de test, donde `assert` (B101) es la forma
// correcta de afirmar en pytest/unittest — no un hallazgo de seguridad. Sin excluir, cualquier
// repo Python con tests rompe el gate de security por puro ruido. Excluimos directorios de test
// (y entornos virtuales) para que bandit reporte la postura del CÓDIGO DE APP, no del andamiaje.
// fnmatch en Windows normaliza `/`→`\`, así que estos globs matchean en ambas plataformas.
const BANDIT_EXCLUDE = "*/tests/*,*/test/*,*/.venv/*,*/venv/*,*/node_modules/*";

// `--json` (semgrep) / `-f json` (bandit) hacen que cada hallazgo se plasme como un TC en la
// evidencia, sin cambiar el mapeo de exit (hallazgo → fail; error de escáner exit 2 → skip).
const TOOLS = {
  semgrep: ({ profile }) => ({ argv: ["semgrep", "--error", "--quiet", "--json", "--config", semgrepConfig(profile)], skipCodes: SCANNER_ERROR, parseCases: parseSemgrep }),
  bandit: () => ({ argv: ["bandit", "-r", ".", "-f", "json", "--exclude", BANDIT_EXCLUDE], skipCodes: SCANNER_ERROR, parseCases: parseBandit }),
};

// Escáner de SECRETOS: objeto de evidencia PROPIO (patrón de la sonda de BD), independiente del SAST.
// Corre SIEMPRE (puro, sin herramienta externa, solo lee archivos) → aporta cobertura aunque el SAST
// se omita. Best-effort: si el escaneo falla, se OMITE con aviso; nunca rompe el ciclo.
function secretEvidence(opts = {}) {
  const { repoRoot = process.cwd(), profile = {}, workItemId } = opts;
  try {
    const res = scanSecrets(repoRoot, { profile });
    const cfg = (profile.security && profile.security.secrets) || {};
    if (cfg.off === true) return null; // apagado explícito por el perfil (escape hatch)
    const narrative = res.status === "fail"
      ? `Secretos en el código: ${res.findings.length} hallazgo(s) en ${res.filesScanned} archivo(s) revisado(s)`
      : `Secretos en el código: sin credenciales quemadas (${res.filesScanned} archivo[s] revisado[s])`;
    return { layer: "security", work_item_id: workItemId, status: res.status, narrative, cases: res.cases, metrics: { tool: "secret-scan", cwd: "" } };
  } catch (e) {
    return { layer: "security", work_item_id: workItemId, status: "skip", narrative: `escaneo de secretos omitido: ${(e && e.message) || e}`, metrics: { tool: "secret-scan", cwd: "" } };
  }
}

// Escáner de LICENCIAS de dependencias: objeto de evidencia PROPIO (patrón del secret-scan). PURO,
// solo lectura de node_modules → aporta cobertura sin herramienta externa. Best-effort: si falla, se OMITE.
function licenseEvidence(opts = {}) {
  const { repoRoot = process.cwd(), profile = {}, workItemId } = opts;
  const cfg = (profile.security && profile.security.licenses) || {};
  if (cfg.off === true) return null; // apagado explícito por el perfil (escape hatch)
  try {
    const res = scanLicenses(repoRoot, { profile });
    if (!res.cases.length) return null;
    const narrative = res.status === "fail"
      ? `Licencias de dependencias: ${res.cases.filter((c) => c.status === "fail").length} conflicto(s) de licencia`
      : res.status === "pass"
        ? `Licencias de dependencias: ${res.total} dependencia(s) con licencia permisiva conocida`
        : `Licencias de dependencias: ${res.cases.filter((c) => c.status === "skip").length} punto(s) a revisar (sugerencia)`;
    return { layer: "security", work_item_id: workItemId, status: res.status, narrative, cases: res.cases, metrics: { tool: "license-scan", cwd: "" } };
  } catch (e) {
    return { layer: "security", work_item_id: workItemId, status: "skip", narrative: `escaneo de licencias omitido: ${(e && e.message) || e}`, metrics: { tool: "license-scan", cwd: "" } };
  }
}

/** @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>} */
export async function runSecurityTests(opts = {}) {
  const secret = secretEvidence(opts);
  const license = licenseEvidence(opts);
  // SCA (dependencias vulnerables): objetos propios, detectados por manifiesto; best-effort.
  const sca = await runSca(opts).catch(() => []);
  const sast = await runLayer({ layer: "security", tools: TOOLS, ...opts });
  return [...(secret ? [secret] : []), ...(license ? [license] : []), ...sca, ...sast];
}

export default { runSecurityTests, secretEvidence, licenseEvidence };
