// exec-sandbox.mjs — ejecutor ENDURECIDO para el modo "QA del código".
// El QA de código EJECUTA las herramientas de prueba del repo objetivo (vitest/pytest/
// eslint/semgrep…) en el server. En un servicio multitenant eso es, por diseño, ejecución
// de código: este sandbox lo acota (mitigación 2 de 3) con dos límites deterministas:
//   1. ALLOWLIST de comandos: solo los binarios de QA conocidos pueden lanzarse. Un `op`/
//      spec que intente correr cualquier otra cosa se RECHAZA (exit 126) sin invocarla.
//   2. TIMEOUT por comando: una herramienta colgada se mata (vía defaultExec) y se OMITE.
// El confinamiento de la RUTA vive en local-source.mjs (mitigación 1); el gate por operador
// (CODE_QA_BASE_DIR requerido) en local-source.mjs (mitigación 3). Núcleo offline: el exec
// es inyectable, así que el smoke corre sin lanzar procesos reales.

import path from "node:path";
import { defaultExec } from "../runners/_runner-core.mjs";

// Herramientas que las capas static/unit/api/db/security invocan (argv[0] lógico). Es una
// lista CERRADA: mantenerla sincronizada con los TOOLS de runtime/runners/*.mjs. `npx` entra
// porque la capa api valida OpenAPI con `npx @redocly/cli@1` (paquete PINEADO, nunca @latest).
export const DEFAULT_ALLOW = [
  "eslint", "tsc", "ruff", "mypy",            // static
  "vitest", "jest", "pytest", "dotnet",       // unit
  "newman", "npx",                            // api
  "pg_prove", "prisma",                       // db
  "semgrep", "bandit",                        // security
];

// Timeout por defecto por comando (ms). Ajustable por env CODE_QA_EXEC_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 180000;

// Nombre lógico del comando: basename sin extensión de shim de Windows (.cmd/.exe/.bat).
// resolveBin puede entregar una ruta absoluta a node_modules/.bin/vitest.cmd; el gate mira
// el nombre, no la ruta, para que la allowlist funcione igual en Windows y POSIX.
export function commandName(cmd) {
  const base = path.basename(String(cmd || "")).toLowerCase();
  return base.replace(/\.(cmd|exe|bat|com|ps1)$/i, "");
}

/**
 * Crea un ejecutor endurecido (allowlist + timeout) sobre un `base` inyectable.
 * @param {object} [opts]
 * @param {function} [opts.base]      ejecutor real (default: defaultExec)
 * @param {number}   [opts.timeoutMs] tope por comando (default: env o 180 s)
 * @param {string[]} [opts.allow]     allowlist de nombres (default: DEFAULT_ALLOW)
 * @param {object}   [opts.env]       entorno para leer CODE_QA_EXEC_TIMEOUT_MS
 * @returns {(cmd:string,args:string[],opts?:object)=>{code,stdout,stderr,spawnError}}
 */
export function makeSandboxedExec({ base = defaultExec, timeoutMs, allow, env = process.env } = {}) {
  const ALLOW = new Set((allow || DEFAULT_ALLOW).map((s) => String(s).toLowerCase()));
  const envTimeout = Number(env?.CODE_QA_EXEC_TIMEOUT_MS);
  const timeout = timeoutMs || (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
  return (cmd, args = [], callOpts = {}) => {
    const name = commandName(cmd);
    if (!ALLOW.has(name)) {
      // Fuera de la allowlist → NO se ejecuta. Se devuelve 127 (igual que "no ejecutable") para
      // que _runner-core lo OMITA con aviso, sin fallar ni romper el ciclo y sin tocar su lógica.
      return { code: 127, stdout: "", stderr: `comando '${name}' fuera de la allowlist del sandbox de QA de código`, spawnError: null };
    }
    return base(cmd, args, { ...callOpts, timeout });
  };
}

export default { makeSandboxedExec, commandName, DEFAULT_ALLOW };
