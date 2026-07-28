// sca.mjs — SCA (Software Composition Analysis): vulnerabilidades CONOCIDAS en las dependencias del repo
// probado. Detecta el gestor por los MANIFIESTOS que el repo ya tiene (invariante 9: no se configura, se
// detecta) y corre la herramienta nativa: `npm audit` (package.json), `dotnet list package --vulnerable`
// (.sln/.csproj), `pip-audit` (requirements/pyproject). Emitido como objeto(s) de evidencia propio(s)
// junto al SAST y al escáner de secretos. Best-effort: si la herramienta falta, no está restaurada o no
// hay lockfile, se OMITE con un aviso ACCIONABLE (nunca rompe el ciclo).
//
// Necesita RED (consulta el feed de avisos) igual que semgrep `auto` o la sonda de BD necesitan su
// recurso; el motor sigue offline-TESTABLE porque el ejecutor (`exec`) es inyectable.

import fs from "node:fs";
import path from "node:path";
import { resolveBin, isExecutable, explainExecFailure } from "./_runner-core.mjs";
import { parseNpmAudit, parseDotnetVulnerable, parsePipAudit } from "./parse-sca.mjs";

const SKIP_DIRS = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".next", "out", "coverage", ".vs", "vendor", "packages", "qa-evidence", "qa-generated"]);
const NPM_LOCKS = ["package-lock.json", "npm-shrinkwrap.json"]; // gestor npm
const PNPM_LOCK = "pnpm-lock.yaml"; // gestor pnpm (un lock por workspace; `pnpm audit` cubre todo el workspace)
const DEFAULT_FAIL_ON = ["critical", "high"];

// Recorre el repo y ubica los manifiestos de dependencias (inyectable para test: `listDir` devuelve los
// nombres de un directorio; `exists` comprueba un archivo). Devuelve objetivos ya listos para ejecutar.
function detectScaTargets(repoRoot, { listDir, exists } = {}) {
  const rd = listDir || ((abs) => { try { return fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() })); } catch { return []; } });
  const ex = exists || ((abs) => fs.existsSync(abs));
  const npm = []; const csproj = []; const sln = []; const py = []; const pnpmRoots = [];
  const walk = (rel, depth) => {
    if (depth > 8) return;
    const abs = rel ? path.join(repoRoot, rel) : repoRoot;
    for (const e of rd(abs)) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.dir) { if (!SKIP_DIRS.has(e.name)) walk(childRel, depth + 1); continue; }
      if (e.name === "package.json") npm.push({ cwd: rel, hasNpmLock: NPM_LOCKS.some((l) => ex(path.join(abs, l))) });
      else if (e.name === PNPM_LOCK) pnpmRoots.push(rel);
      else if (/\.sln$/i.test(e.name)) sln.push(childRel);
      else if (/\.csproj$/i.test(e.name)) csproj.push(childRel);
      else if (e.name === "requirements.txt" || e.name === "pyproject.toml") py.push({ cwd: rel });
    }
  };
  walk("", 0);
  const targets = [];
  // pnpm: un objetivo por WORKSPACE (dir con pnpm-lock.yaml) — `pnpm audit` audita todo el workspace de una.
  for (const root of pnpmRoots) targets.push({ tool: "pnpm-audit", cwd: root, label: `${root || "raíz"} (pnpm)`, hasLock: true });
  // ¿Un package.json cae bajo un workspace pnpm? (mismo dir o descendiente de una raíz pnpm). Un lock en la
  // raíz cubre todo el árbol. Los sub-paquetes cubiertos NO emiten npm-audit → sin ruido de "skip sin lock".
  const coveredByPnpm = (dir) => pnpmRoots.some((root) => dir === root || (root === "" ? true : dir.startsWith(root + "/")));
  // Igual para npm workspaces: hay UN solo package-lock.json (la raíz) y `npm audit` de ese dir audita
  // TODO el árbol de workspaces. Un sub-paquete SIN lock propio pero bajo un ancestro que SÍ lo tiene queda
  // cubierto → no se emite objetivo (evita el falso "necesita lockfile" en apps/api, apps/web, etc.).
  const npmLockRoots = npm.filter((n) => n.hasNpmLock).map((n) => n.cwd);
  const coveredByNpmLock = (dir) => npmLockRoots.some((root) => root !== dir && (root === "" ? true : dir.startsWith(root + "/")));
  for (const n of npm) {
    if (n.hasNpmLock) targets.push({ tool: "npm-audit", cwd: n.cwd, label: `${n.cwd || "raíz"} (npm)`, hasLock: true });
    else if (!coveredByPnpm(n.cwd) && !coveredByNpmLock(n.cwd)) targets.push({ tool: "npm-audit", cwd: n.cwd, label: `${n.cwd || "raíz"} (npm)`, hasLock: false });
  }
  // Con solución (.sln) basta un objetivo (cubre todos los proyectos); sin ella, uno por proyecto.
  const dotnetArgs = sln.length ? sln : csproj;
  for (const arg of dotnetArgs) targets.push({ tool: "dotnet-vulnerable", cwd: "", arg, label: `${arg} (NuGet)` });
  for (const p of py) targets.push({ tool: "pip-audit", cwd: p.cwd, label: `${p.cwd || "raíz"} (pip)` });
  return targets;
}

// Señales de "no concluyó" (no es que no haya vulnerabilidades, es que faltó un requisito) → skip accionable.
function scaSkipReason(target, out) {
  const t = `${out.stdout}\n${out.stderr}`.toLowerCase();
  if (target.tool === "npm-audit") {
    if (!target.hasLock) return "npm audit necesita un lockfile (package-lock.json): corré `npm install` para generarlo (si el proyecto usa pnpm, se detecta por su pnpm-lock.yaml)";
    if (/enolock|requires existing|no lockfile|package-lock\.json.*not found/.test(t)) return "npm audit no encontró el lockfile: corré `npm install`";
  }
  if (target.tool === "pnpm-audit" && /no.*pnpm-lock|lockfile.*not found|enolock/.test(t)) {
    return "pnpm audit no encontró el lockfile: corré `pnpm install` para generar pnpm-lock.yaml";
  }
  if (target.tool === "dotnet-vulnerable" && /assets file.*not found|run(?: a)? .*restore|nuget restore|no se encontró.*assets/.test(t)) {
    return "dotnet no tiene los assets restaurados: corré `dotnet restore` antes del análisis de vulnerabilidades";
  }
  return null;
}

const TOOL_ARGV = {
  "npm-audit": () => ["npm", "audit", "--json"],
  "pnpm-audit": () => ["pnpm", "audit", "--json"],
  "dotnet-vulnerable": (t) => ["dotnet", "list", t.arg, "package", "--vulnerable", "--include-transitive"],
  "pip-audit": () => ["pip-audit", "--format", "json"],
};
// pnpm audit --json emite el formato `advisories` (estilo npm v6) → parseNpmAudit ya lo entiende.
const PARSERS = { "npm-audit": parseNpmAudit, "pnpm-audit": parseNpmAudit, "dotnet-vulnerable": parseDotnetVulnerable, "pip-audit": parsePipAudit };

// Un objetivo SCA → un EvidenceObject.
async function runScaTarget({ target, repoRoot, exec, failOn, ignore, workItemId }) {
  const base = { layer: "security", work_item_id: workItemId };
  const argv = TOOL_ARGV[target.tool](target);
  const [name, ...args] = argv;
  const cwd = target.cwd ? path.join(repoRoot, target.cwd) : repoRoot;
  const metrics = { tool: target.tool, label: target.label, cwd: target.cwd, command: argv.join(" ") };
  // Skip CON caso explicativo (`plain`) → aparece en «No verificado» en las 4 rutas (HU/MD/HTML/UX),
  // igual que los checks declarativos de BD. Sin el caso, la razón solo salía en la tabla del md/html.
  const skip = (reason) => ({
    ...base, status: "skip", narrative: `${target.label}: ${reason}`, metrics,
    cases: [{ name: `Dependencias — ${target.label}`, status: "skip",
      plain: `No se analizaron las dependencias de «${target.label}»: ${reason}`,
      action: "Resolvé lo indicado y volvé a correr para que el análisis de vulnerabilidades cubra este objetivo.",
      message: metrics.command }],
  });

  // Lockfile ausente (npm) → skip SIN invocar (determinista, testable).
  if (target.tool === "npm-audit" && !target.hasLock) return skip(scaSkipReason(target, { stdout: "", stderr: "" }));
  const bin = resolveBin(repoRoot, name, cwd);
  const out = await exec(bin, args, { cwd });

  // Herramienta ausente / no lanzable → skip con la razón real (no instalada, timeout…).
  if (out.spawnError || out.code === 127) return skip(`${explainExecFailure(out, name)}`);
  const reason = scaSkipReason(target, out);
  if (reason) return skip(reason);

  let cases = null;
  try { cases = PARSERS[target.tool](out, { failOn }); } catch { cases = null; }
  if (!Array.isArray(cases)) return skip(`no se pudo interpretar la salida de ${target.tool}`);
  cases = cases.filter((c) => !ignore.some((frag) => c.name.toLowerCase().includes(frag)));
  if (!cases.length) {
    return { ...base, status: "pass", narrative: `${target.label}: sin dependencias con vulnerabilidades conocidas`, metrics,
      cases: [{ name: "Dependencias sin vulnerabilidades conocidas", status: "pass", message: `Objetivo: ${target.label}.`,
        plain: `Se revisaron las dependencias de «${target.label}» contra la base pública de avisos de seguridad y ninguna versión usada tiene una vulnerabilidad conocida. Es un chequeo automático: reduce el riesgo, no lo elimina.` }] };
  }
  const fails = cases.filter((c) => c.status === "fail").length;
  return { ...base, status: fails ? "fail" : "pass", cases, metrics,
    narrative: fails ? `${target.label}: ${fails} dependencia(s) vulnerable(s) (severidad que bloquea)` : `${target.label}: ${cases.length} aviso(s) de menor severidad (sugerencia)` };
}

/**
 * Corre SCA para todos los manifiestos detectados. Best-effort; devuelve [] si el repo no tiene
 * dependencias que analizar (SCA no aplica) o si el perfil lo apaga.
 * @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>}
 */
export async function runSca(opts = {}) {
  const { repoRoot = process.cwd(), exec, profile = {}, workItemId, detect } = opts;
  const cfg = (profile.security && profile.security.sca) || {};
  if (cfg.off === true || typeof exec !== "function") return [];
  const failOn = new Set((cfg.fail_on || DEFAULT_FAIL_ON).map((s) => String(s).toLowerCase()));
  const ignore = (cfg.ignore || []).map((s) => String(s).toLowerCase());
  const targets = (detect || detectScaTargets)(repoRoot, opts);
  const results = [];
  for (const target of targets) {
    try { results.push(await runScaTarget({ target, repoRoot, exec, failOn, ignore, workItemId })); }
    catch (e) { results.push({ layer: "security", work_item_id: workItemId, status: "skip", narrative: `${target.label}: SCA omitido (${(e && e.message) || e})`, metrics: { tool: target.tool, label: target.label } }); }
  }
  return results;
}

export { detectScaTargets };
export default { runSca, detectScaTargets };
