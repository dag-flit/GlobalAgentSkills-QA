// _runner-core.mjs — lógica común a todos los runners de capa (static/unit/e2e/…).
// Cada runner concreto aporta solo: el nombre de capa y su registro de herramientas
// (tool → argv neutro). Aquí vive el resto: resolución de binario, ejecución
// (inyectable), mapeo a EvidenceObject normalizado. CERO literales de dominio.

import { spawn } from "node:child_process";
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
// `timeout` (ms, opcional) mata la herramienta si se cuelga: defensa en profundidad para
// correr QA de código en un server compartido (una gen/escáner colgado no bloquea la corrida).
// Decodifica la salida de un proceso hijo a texto. Muchas herramientas de Windows (p.ej. `dotnet`
// en español) escriben en el codepage ANSI (cp1252), NO en UTF-8; decodificar como UTF-8 corrompe
// los acentos y las comillas « » a «�» (pérdida irreversible). Por eso capturamos BYTES y probamos
// UTF-8 con validación estricta; si no es UTF-8 válido, caemos a latin1 (cp1252) → acentos correctos.
export function decodeOutput(buf) {
  if (buf == null) return "";
  if (typeof buf === "string") return buf.replace(/�/g, "?"); // un exec inyectado ya puede devolver string
  try {
    // UTF-8 válido: puede contener U+FFFD si la HERRAMIENTA ya perdió el carácter aguas arriba
    // (p.ej. Npgsql mal-decodifica un error de PostgreSQL PRE-autenticación → el acento se pierde
    // en .NET, no en nuestra captura, y es irrecuperable). Lo normalizamos a "?" para que el
    // reporte y la HU no muestren cuadros rotos.
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/�/g, "?");
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
}

const MAX_OUTPUT = 32 * 1024 * 1024; // tope de salida por proceso (anti-OOM en el server)

// Ejecutor ASÍNCRONO (spawn, NO spawnSync). CRÍTICO: no congela el event loop de Node. Antes, con
// spawnSync, un subproceso largo (p.ej. `dotnet test`, minutos) bloqueaba el loop y cualquier servicio
// Node en el mismo proceso quedaba muerto — en particular el TÚNEL SSH (net.createServer + ssh2), que
// vive del event loop: el subproceso .NET recibía "connection refused" al puerto local del túnel. Con
// spawn asíncrono el loop sigue girando → el túnel atiende al subproceso → la BD por SSH funciona.
export function defaultExec(cmd, args, { cwd, env, timeout } = {}) {
  // Comando NO resoluble (no instalado / fuera de PATH) → 127 SIN invocar el shell, para que el runner
  // lo OMITA. En Windows en español cmd.exe da un exit ambiguo, así que no nos fiamos de él.
  if (!isExecutable(cmd)) return Promise.resolve({ code: 127, stdout: "", stderr: "", spawnError: null, timeout: null });
  const childEnv = env && Object.keys(env).length ? { ...process.env, ...env } : undefined;
  const to = timeout && timeout > 0 ? timeout : 0;
  return new Promise((resolve) => {
    let child;
    try {
      // Windows necesita shell para resolver shims .cmd/.bat, pero el shell NO cita: construimos la
      // línea ya citada (control total del quoting). POSIX: sin shell, el array de args respeta espacios.
      if (process.platform === "win32") {
        const line = [cmd, ...args].map(quoteWin).join(" ");
        child = spawn(line, [], { cwd, env: childEnv, shell: true });
      } else {
        child = spawn(cmd, args, { cwd, env: childEnv, shell: false });
      }
    } catch (e) {
      resolve({ code: 127, stdout: "", stderr: "", spawnError: e, timeout: to || null });
      return;
    }
    const outCh = []; const errCh = [];
    let outLen = 0; let errLen = 0; let over = false; let timedOut = null; let settled = false;
    let timer = null;
    const finish = (code, spawnError) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      // Sin `encoding` → Buffers; los decodificamos (utf8 con fallback a latin1) para no romper acentos.
      resolve({
        code: typeof code === "number" ? code : 127,
        stdout: decodeOutput(Buffer.concat(outCh)),
        stderr: decodeOutput(Buffer.concat(errCh)),
        // ENOBUFS (buffer excedido) y ETIMEDOUT (timeout) → explainExecFailure los distingue del "no instalado".
        spawnError: spawnError || (over ? Object.assign(new Error("maxBuffer exceeded"), { code: "ENOBUFS" }) : timedOut),
        timeout: to || null,
      });
    };
    child.stdout?.on("data", (d) => { outLen += d.length; if (outLen <= MAX_OUTPUT) outCh.push(d); else if (!over) { over = true; child.kill("SIGKILL"); } });
    child.stderr?.on("data", (d) => { errLen += d.length; if (errLen <= MAX_OUTPUT) errCh.push(d); else if (!over) { over = true; child.kill("SIGKILL"); } });
    child.on("error", (e) => finish(127, e));
    child.on("close", (code) => finish(code == null ? 127 : code, null));
    if (to) timer = setTimeout(() => { timedOut = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }); child.kill("SIGKILL"); }, to);
  });
}

// Quita secuencias de escape ANSI (colores/estilos) que muchas herramientas (vitest,
// playwright…) emiten y que ensucian el reporte md/html.
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// Resumen breve para la celda del reporte (el objeto va a una tabla md/html). Si hay líneas de
// SEÑAL (error/fallo/excepción), se prefieren sobre el preámbulo (p.ej. el log de restauración de
// dotnet, que si no tapa el error real). Si no hay señal, cae a las primeras líneas.
export function summarize(out) {
  const lines = stripAnsi(`${out.stdout}\n${out.stderr}`)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const signal = lines.filter((l) => /\b(error|failed|fail|exception|assert)\b|error\s+[A-Z]{1,3}\d{3,}|:\s*line\s+\d+/i.test(l));
  const pick = (signal.length ? signal : lines).slice(0, 3);
  return pick.join(" · ").slice(0, 240);
}

// Traduce un fallo de LANZAMIENTO (spawnError, o exit 127) a una razón ACCIONABLE y precisa.
// Antes TODO caía en "no instalado / fuera de PATH", que ocultaba las causas reales: un TIMEOUT
// (herramienta compilada que en frío no termina a tiempo, p.ej. `dotnet test` con restore+build) o
// la SATURACIÓN del buffer de salida — ambos se veían como "no instalado", desorientando al usuario.
export function explainExecFailure(out, name) {
  const err = out.spawnError;
  if (err) {
    if (err.code === "ETIMEDOUT") {
      const s = out.timeout ? Math.round(out.timeout / 1000) : null;
      return `se agotó el tiempo${s ? ` (timeout ${s}s)` : ""}: la herramienta no terminó a tiempo — sube CODE_QA_EXEC_TIMEOUT_MS o precalienta el build (compila el proyecto una vez antes de correr QA)`;
    }
    if (err.code === "ENOBUFS") return "superó el límite de salida (maxBuffer): la herramienta emitió demasiada salida — reduce su verbosidad";
    return `no se pudo lanzar (${err.code || "error de proceso"})`;
  }
  // exit 127 SIN spawnError: rechazo de la allowlist del sandbox, o binario realmente ausente.
  if (/allowlist/i.test(out.stderr || "")) return String(out.stderr).trim();
  if (!isExecutable(name)) return "no ejecutable (no instalado / fuera de PATH)";
  return `no ejecutable (exit 127)${out.stderr ? ` — ${String(out.stderr).slice(0, 160)}` : ""}`;
}

// Etiqueta de ubicación para distinguir objetivos de la misma capa en el reporte.
function whereLabel(cwd) {
  return cwd ? ` @ ${cwd}` : "";
}

// Ejecuta UN objetivo (herramienta + paquete) de una capa → un EvidenceObject. ASÍNCRONO: `exec` puede
// devolver una promesa (defaultExec asíncrono) o un valor síncrono (fakes del smoke); `await` sirve a ambos.
async function runTarget({ layer, tools, repoRoot, profile, env, detection, exec, workItemId, info, target }) {
  const tool = target.tool;
  // Etiqueta legible del objetivo: un `label` explícito (p.ej. el nombre del proyecto de test en el
  // fan-out dotnet sin .sln) gana; si no, la ubicación (cwd) del paquete en monorepo.
  const where = target.label ? ` @ ${target.label}` : whereLabel(target.cwd);
  const base = { layer, work_item_id: workItemId };
  // Directorio de trabajo del objetivo: la raíz o, en monorepo, el subpaquete donde
  // qa-detect ubicó la herramienta. Así vitest/playwright/tsc resuelven su config y el
  // binario se encuentra en el node_modules correcto.
  const cwd = target.cwd ? path.join(repoRoot, target.cwd) : repoRoot;

  const spec = tools[tool];
  if (!spec) {
    return { ...base, status: "skip", narrative: `herramienta '${tool}'${where} sin invocación soportada`, metrics: { tool, label: target.label, cwd: target.cwd } };
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
    const resolved = spec({ repoRoot: cwd, profile, env, detection, info: { ...info, tool, cwd: target.cwd }, tool, project: target.project });
    if (!resolved || resolved.skip) {
      return { ...base, status: "skip", narrative: (resolved && resolved.skip) || `'${tool}'${where} sin configuración suficiente`, metrics: { tool, label: target.label, cwd: target.cwd } };
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
  const out = await exec(bin, args, { cwd, env });
  const ms = Date.now() - t0;

  // No concluyó por el LANZAMIENTO (spawnError o exit 127): omitir con la razón REAL (timeout,
  // buffer, allowlist o binario ausente), no un genérico que confunda "tardó" con "no instalado".
  if (out.spawnError || out.code === 127) {
    return {
      ...base,
      status: "skip",
      narrative: `${tool}${where} ${explainExecFailure(out, name)} — objetivo omitido`,
      metrics: { tool, label: target.label, cwd: target.cwd, exitCode: out.code, command },
    };
  }

  const detail = summarize(out);

  // Exit declarado como "error de herramienta" (no un hallazgo real): OMITIR, no fallar.
  if (out.code !== 0 && skipCodes.includes(out.code)) {
    return {
      ...base,
      status: "skip",
      narrative: `${tool}${where} no concluyó (exit ${out.code}, error de herramienta) — objetivo omitido${detail ? ` — ${detail}` : ""}`,
      metrics: { tool, label: target.label, cwd: target.cwd, exitCode: out.code, command, ms },
    };
  }

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

  // Veredicto del objetivo: el exit code es autoritativo para el FALLO, pero si el parser extrajo
  // TC, un caso en ROJO también es fallo aunque la herramienta haya salido 0 (hay reporters/configs
  // —p.ej. algunos setups de vitest/jest— que no propagan el exit al fallar un test). Así NUNCA se
  // marca "pass" una capa con TC fallidos, que era la causa del "falló pero dice que pasó".
  const caseFail = hasCases && cases.some((c) => c.status === "fail");
  const status = out.code !== 0 || caseFail ? "fail" : "pass";

  const narrative =
    status === "pass"
      ? `${tool}${where}: ok${casesDetail ? ` — ${casesDetail}` : ""}`
      : `${tool}${where}: exit ${out.code}${casesDetail ? ` — ${casesDetail}` : detail ? ` — ${detail}` : ""}`;

  const ev = { ...base, status, narrative, metrics: { tool, label: target.label, cwd: target.cwd, exitCode: out.code, command, ms } };
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
export async function runLayer({
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

  // Objetivos detectados (monorepo-aware); compat: si faltan, deriva uno del primario. Se corren de a UNO
  // (secuencial, como antes: no satura la máquina ni la BD con N builds a la vez), pero con `await` → el
  // event loop NO se congela entre procesos → el túnel SSH sigue atendiendo al subproceso en curso.
  const targets = info.targets && info.targets.length ? info.targets : [{ tool: info.tool, cwd: info.cwd || "" }];
  const results = [];
  for (const target of targets) {
    results.push(await runTarget({ layer, tools, repoRoot, profile, env, detection: det, exec, workItemId, info, target }));
  }
  return results;
}

export default { runLayer, resolveBin, defaultExec, summarize };
