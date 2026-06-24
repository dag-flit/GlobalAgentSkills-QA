// _runner-core.mjs — lógica común a todos los runners de capa (static/unit/e2e/…).
// Cada runner concreto aporta solo: el nombre de capa y su registro de herramientas
// (tool → argv neutro). Aquí vive el resto: resolución de binario, ejecución
// (inyectable), mapeo a EvidenceObject normalizado. CERO literales de dominio.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectRepo } from "../detect/qa-detect.mjs";
import { casesSummary } from "./parse-cases.mjs";

// Resuelve el binario subiendo desde `startDir` (la cwd de la capa) hasta `repoRoot`,
// mirando el `node_modules/.bin` de cada nivel. Esto cubre TODO layout:
//   - repo plano:        <repo>/node_modules/.bin
//   - monorepo pnpm:     <repo>/<pkg>/node_modules/.bin   (bins por paquete)
//   - monorepo npm/yarn: <repo>/node_modules/.bin         (bins hoisteados)
// Si no aparece en ningún nivel, cae a PATH (pytest/dotnet/ruff/mypy suelen vivir ahí).
export function resolveBin(repoRoot, tool, startDir = repoRoot) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const root = path.resolve(repoRoot);
  let dir = path.resolve(startDir);
  while (true) {
    for (const cand of [tool + ext, tool]) {
      if (!cand) continue;
      const p = path.join(dir, "node_modules", ".bin", cand);
      if (fs.existsSync(p)) return p;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // llegó a la raíz del FS (startDir fuera de repoRoot)
    dir = parent;
  }
  return tool; // confía en PATH
}

// Cita un token para la línea de cmd.exe: envuelve en comillas si trae espacios o
// metacaracteres, escapando comillas internas. Sin esto, una RUTA CON ESPACIOS
// (p.ej. "C:\FLIT\TEST FLIT 2.0\...\vitest.cmd") parte el comando en el shell.
function quoteWin(s) {
  s = String(s);
  if (s === "") return '""';
  return /[\s"&|<>^()%!]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ¿`name` es ejecutable? Ruta con separador/absoluta → el archivo debe existir. Nombre
// suelto → búsqueda en PATH (con PATHEXT en Windows). Es LOCALE-INDEPENDIENTE: no depende
// del mensaje de cmd.exe ("is not recognized…" / "no se reconoce…") ni de un ERRORLEVEL
// concreto, que varían por idioma de Windows.
export function isExecutable(name) {
  if (!name) return false;
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\")) return fs.existsSync(name);
  const PATH = process.env.PATH || process.env.Path || "";
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean)
    : [""];
  for (const dir of PATH.split(path.delimiter).filter(Boolean)) {
    if (process.platform !== "win32" && fs.existsSync(path.join(dir, name))) return true;
    for (const ext of exts) if (fs.existsSync(path.join(dir, name + ext))) return true;
  }
  return false;
}

// Ejecutor por defecto (real). Inyectable para tests deterministas/offline.
// `env` (opcional) se MEZCLA sobre process.env del hijo: así una conexión de BD u otra
// var que el proyecto exporte (DATABASE_URL…) llega a la herramienta sin cablearla.
export function defaultExec(cmd, args, { cwd, env } = {}) {
  // Comando NO resoluble (no instalado / fuera de PATH) → 127 SIN invocar el shell, para que
  // el runner lo OMITA (skip). Es la vía robusta: en Windows en español, cmd.exe devuelve un
  // exit ambiguo (1) con mensaje localizado, así que NO podemos fiarnos de él. Como los tests
  // inyectan su propio `exec`, este chequeo solo afecta a las corridas reales.
  if (!isExecutable(cmd)) return { code: 127, stdout: "", stderr: "", spawnError: null };
  const childEnv = env && Object.keys(env).length ? { ...process.env, ...env } : undefined;
  let r;
  if (process.platform === "win32") {
    // Windows necesita shell para resolver shims .cmd/.bat, pero el shell NO cita: si la
    // ruta del binario o un argumento tiene espacios, se parte. Construimos la línea
    // ya citada y la pasamos como string única (control total del quoting).
    const line = [cmd, ...args].map(quoteWin).join(" ");
    r = spawnSync(line, [], { cwd, env: childEnv, encoding: "utf8", shell: true });
  } else {
    // POSIX: sin shell, el array de args ya respeta espacios; nada que citar.
    r = spawnSync(cmd, args, { cwd, env: childEnv, encoding: "utf8", shell: false });
  }
  return {
    code: typeof r.status === "number" ? r.status : 127,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    spawnError: r.error || null,
  };
}

// Quita secuencias de escape ANSI (colores/estilos) que muchas herramientas (vitest,
// playwright…) emiten y que ensucian el reporte md/html.
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// Resumen breve para la celda del reporte (el objeto va a una tabla md/html).
export function summarize(out) {
  const lines = stripAnsi(`${out.stdout}\n${out.stderr}`)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines.slice(0, 3).join(" · ").slice(0, 240) : "";
}

// Etiqueta de ubicación para distinguir objetivos de la misma capa en el reporte.
function whereLabel(cwd) {
  return cwd ? ` @ ${cwd}` : "";
}

// Ejecuta UN objetivo (herramienta + paquete) de una capa → un EvidenceObject.
function runTarget({ layer, tools, repoRoot, profile, env, detection, exec, workItemId, info, target }) {
  const tool = target.tool;
  const where = whereLabel(target.cwd);
  const base = { layer, work_item_id: workItemId };
  // Directorio de trabajo del objetivo: la raíz o, en monorepo, el subpaquete donde
  // qa-detect ubicó la herramienta. Así vitest/playwright/tsc resuelven su config y el
  // binario se encuentra en el node_modules correcto.
  const cwd = target.cwd ? path.join(repoRoot, target.cwd) : repoRoot;

  const spec = tools[tool];
  if (!spec) {
    return { ...base, status: "skip", narrative: `herramienta '${tool}'${where} sin invocación soportada`, metrics: { tool, cwd: target.cwd } };
  }

  // El spec puede ser un argv fijo (array) o una función que lo construye desde el
  // contexto. La función opera sobre el paquete del objetivo (recibe su cwd como repoRoot),
  // y puede devolver { skip: "razón" } para omitir con aviso (p.ej. conexión NO cableada),
  // o { argv, skipCodes, parseCases } donde:
  //   - skipCodes  = exit codes que significan "la herramienta NO concluyó" (p.ej. semgrep
  //                  exit 2 = error de escáner por red/config) → se OMITE en vez de fallar.
  //   - parseCases = (out, {repoRoot}) => TC[] : extrae los casos individuales del reporter
  //                  JSON de la herramienta; si no puede, devuelve null y se degrada al resumen.
  let argv;
  let skipCodes = [];
  let parseCases = null;
  if (typeof spec === "function") {
    const resolved = spec({ repoRoot: cwd, profile, env, detection, info: { ...info, tool, cwd: target.cwd }, tool });
    if (!resolved || resolved.skip) {
      return { ...base, status: "skip", narrative: (resolved && resolved.skip) || `'${tool}'${where} sin configuración suficiente`, metrics: { tool, cwd: target.cwd } };
    }
    argv = Array.isArray(resolved) ? resolved : resolved.argv;
    if (!Array.isArray(resolved)) {
      if (Array.isArray(resolved.skipCodes)) skipCodes = resolved.skipCodes;
      if (typeof resolved.parseCases === "function") parseCases = resolved.parseCases;
    }
  } else {
    argv = spec;
  }

  const [name, ...args] = argv;
  const bin = resolveBin(repoRoot, name, cwd);
  const command = argv.join(" "); // comando lógico exacto (p.ej. "tsc --noEmit") para la evidencia
  const t0 = Date.now();
  const out = exec(bin, args, { cwd, env });
  const ms = Date.now() - t0;

  // No se pudo lanzar el binario (no instalado / fuera de PATH): omitir con aviso.
  if (out.spawnError || out.code === 127) {
    return {
      ...base,
      status: "skip",
      narrative: `${tool}${where} no ejecutable (no instalado / fuera de PATH) — objetivo omitido`,
      metrics: { tool, cwd: target.cwd, exitCode: out.code, command },
    };
  }

  const detail = summarize(out);

  // Exit declarado como "error de herramienta" (no un hallazgo real): OMITIR, no fallar.
  if (out.code !== 0 && skipCodes.includes(out.code)) {
    return {
      ...base,
      status: "skip",
      narrative: `${tool}${where} no concluyó (exit ${out.code}, error de herramienta) — objetivo omitido${detail ? ` — ${detail}` : ""}`,
      metrics: { tool, cwd: target.cwd, exitCode: out.code, command, ms },
    };
  }

  const status = out.code === 0 ? "pass" : "fail";

  // TC individuales desde el reporter JSON (cuando el spec aporta parser). Best-effort: si la
  // salida no es el JSON esperado, `cases` queda null y la narrativa cae al resumen de texto.
  let cases = null;
  if (parseCases) {
    try {
      cases = parseCases(out, { repoRoot: cwd });
    } catch {
      cases = null;
    }
  }
  const hasCases = Array.isArray(cases) && cases.length > 0;
  const casesDetail = hasCases ? casesSummary(cases) : null;

  const narrative =
    status === "pass"
      ? `${tool}${where}: ok${casesDetail ? ` — ${casesDetail}` : ""}`
      : `${tool}${where}: exit ${out.code}${casesDetail ? ` — ${casesDetail}` : detail ? ` — ${detail}` : ""}`;

  const ev = { ...base, status, narrative, metrics: { tool, cwd: target.cwd, exitCode: out.code, command, ms } };
  if (hasCases) ev.cases = cases;
  return ev;
}

/**
 * Ejecuta una capa para TODOS sus objetivos (monorepo: un objetivo por paquete/herramienta)
 * y devuelve un EvidenceObject por objetivo.
 * @param {object} opts
 * @param {string} opts.layer            static | unit | e2e | …
 * @param {Record<string,string[]|function>} opts.tools  tool → argv o builder
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.profile]
 * @param {object} [opts.detection]      salida de detectRepo() (si ya se calculó)
 * @param {function} [opts.exec]         ejecutor inyectable (cmd, args, {cwd}) -> {code,stdout,stderr}
 * @param {string} [opts.workItemId]
 * @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]}
 */
export function runLayer({
  layer,
  tools,
  repoRoot = process.cwd(),
  profile = {},
  env = {},
  detection,
  exec = defaultExec,
  workItemId,
}) {
  const det = detection || detectRepo({ repoRoot });
  const info = det.layers?.[layer] || { enabled: false, reason: `capa ${layer} no detectada` };
  const base = { layer, work_item_id: workItemId };

  // Capa apagada: se OMITE con aviso, nunca rompe el ciclo (principio 5).
  if (!info.enabled) {
    return [{ ...base, status: "skip", narrative: info.reason || `sin herramienta para ${layer}`, metrics: { tool: null } }];
  }

  // Objetivos detectados (monorepo-aware); compat: si faltan, deriva uno del primario.
  const targets = info.targets && info.targets.length ? info.targets : [{ tool: info.tool, cwd: info.cwd || "" }];
  return targets.map((target) =>
    runTarget({ layer, tools, repoRoot, profile, env, detection: det, exec, workItemId, info, target })
  );
}

export default { runLayer, resolveBin, defaultExec, summarize };
