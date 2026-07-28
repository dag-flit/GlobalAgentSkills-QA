// materialize.mjs — materialización EFÍMERA del repo FUERA de la ruta certificada.
//
// Problema que resuelve: para type-checkear (tsc) o correr pruebas (vitest) de un repo Node hacen
// falta sus dependencias instaladas — y `npm install` escribe `node_modules/` DENTRO del repo. Quien
// CERTIFICA no debe mutar el artefacto que certifica. Este módulo copia el repo a un espacio de
// trabajo del KIT (scratch), instala ahí, y devuelve ese `workRoot`; el repo original NUNCA se toca.
//
// Es lo que hace un CI: clona a un workspace y instala ahí. El kit se adapta al repo, no al revés.
//
// PURO / offline-testable: TODO efecto (crear temp, copiar, ejecutar, borrar, leer) es INYECTABLE.
// El puente de la webapp provee el `fs` real + el exec ENDURECIDO (allowlist + timeout). El smoke
// inyecta fakes → corre sin copiar ni lanzar procesos.
//
// Alcance v1: repos Node (npm/pnpm/yarn con lockfile). Un repo con .NET NO se materializa (devuelve
// null → se analiza en su lugar): `dotnet` restaura al caché GLOBAL de NuGet, sin ensuciar el repo,
// así que el camino .NET actual queda intacto. Extensión .NET = trabajo futuro.

import path from "node:path";

// Carpetas que NUNCA se copian al espacio aislado: dependencias/artefactos (se regeneran al instalar),
// control de versiones y salidas del propio kit. Copiar `node_modules` sería lento e inútil (se reinstala).
export const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  ".turbo", ".cache", "qa-evidence", "qa-generated", ".vs", "bin", "obj",
  ".venv", "venv", "__pycache__",
]);

// Lockfile → gestor. La presencia del lockfile es la señal (invariante 9: se detecta, no se configura).
const LOCKFILES = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
};

// Comando de instalación por gestor: [primario reproducible, fallback tolerante]. El primario respeta
// el lockfile EXACTO (ci/frozen) → certificás las versiones bloqueadas; si el lock está desincronizado,
// el fallback instala igual (muta el lock SOLO en la copia, nunca en el repo original).
const INSTALL = {
  npm: [["npm", "ci", "--no-audit", "--no-fund"], ["npm", "install", "--no-audit", "--no-fund"]],
  pnpm: [["pnpm", "install", "--frozen-lockfile"], ["pnpm", "install"]],
  yarn: [["yarn", "install", "--frozen-lockfile"], ["yarn", "install"]],
};

// Comando de build por gestor (script `build` del package.json raíz). En un MONOREPO, un paquete que
// depende de un hermano (project references / paquete que compila a dist/) no type-checkea hasta que el
// hermano se construye — igual que un dev corre `npm run build`. Best-effort tras instalar.
const BUILD = {
  npm: ["npm", "run", "build"],
  pnpm: ["pnpm", "run", "build"],
  yarn: ["yarn", "run", "build"],
};

// Lee el package.json de un directorio (inyectable readFile). Devuelve el objeto o null.
function readPkgJson(readFile, dir) {
  if (typeof readFile !== "function") return null;
  try {
    const s = readFile(path.join(dir, "package.json"));
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

// ¿El script `build` de un paquete es un EMPAQUETADOR de aplicación (vite/next/astro/…)? Su salida (el
// bundle) no la consume ningún type-check y suele fallar por CSS/assets ajenos al objetivo → se SALTA al
// materializar. `tsup`/`rollup` NO entran a propósito: suelen ser el build de una LIBRERÍA que emite los
// .d.ts que otros paquetes importan → esos SÍ hay que construirlos.
function isAppBundlerBuild(script) {
  const s = String(script || "");
  return /\b(?:vite|astro|nuxt|parcel)\s+build\b/i.test(s)
    || /\bnext\s+build\b/i.test(s)
    || /\bremix\s+(?:vite:)?build\b/i.test(s)
    || /\bwebpack\b/i.test(s);
}

// Enumera los paquetes del workspace a partir de los globs `workspaces` del package.json raíz (array o
// {packages:[…]}). Expande solo el patrón «dir/*»; las entradas literales se toman tal cual. Devuelve
// { dir, name, build, hasBuild } por cada paquete con package.json legible.
function resolveWorkspacePackages(root, rootPkg, { readdir, readFile }) {
  const ws = rootPkg && rootPkg.workspaces;
  const globs = Array.isArray(ws) ? ws : (ws && Array.isArray(ws.packages) ? ws.packages : []);
  const dirs = [];
  for (const g of globs) {
    const gg = String(g).replace(/\\/g, "/");
    if (gg.endsWith("/*")) {
      const base = gg.slice(0, -2);
      let entries = [];
      try { entries = readdir(base ? path.join(root, base) : root) || []; } catch { entries = []; }
      for (const e of entries) if (e.dir && !e.name.startsWith(".") && !EXCLUDE_DIRS.has(e.name)) dirs.push(base ? `${base}/${e.name}` : e.name);
    } else if (gg && !gg.includes("*")) {
      dirs.push(gg);
    }
  }
  const pkgs = [];
  for (const dir of dirs) {
    const pj = readPkgJson(readFile, path.join(root, dir));
    if (!pj) continue;
    const build = pj.scripts && typeof pj.scripts.build === "string" ? pj.scripts.build : "";
    pkgs.push({ dir, name: pj.name || "", build, hasBuild: !!build });
  }
  return pkgs;
}

// ¿El repo es Node y NO trae .NET? (v1 solo materializa Node). Lee la detección de qa-detect.
function analyzeDetection(detection) {
  const stack = (detection && detection.stack) || {};
  const isNode = stack.backend === "node" || (stack.frontend && stack.frontend !== "none");
  let hasDotnet = false;
  const layers = (detection && detection.layers) || {};
  for (const l of ["static", "unit"]) {
    const info = layers[l];
    if (!info || !info.enabled) continue;
    for (const tg of info.targets || []) {
      if (String(tg.tool || "").startsWith("dotnet")) hasDotnet = true;
    }
  }
  return { isNode: !!isNode, hasDotnet };
}

function isAncestorDir(a, b) {
  if (a === b) return false;
  return a === "" ? b !== "" : b.startsWith(a + "/");
}

// Busca los directorios con lockfile (raíz + workspaces). Devuelve SOLO los más superficiales: un lock
// en la raíz de un workspace (npm/pnpm/yarn) cubre a sus sub-paquetes → una sola instalación.
export function findLockfileDirs(root, { readdir }) {
  const found = []; // { dir, manager, file }
  const seen = new Set();
  const walk = (rel, depth) => {
    if (depth > 3) return;
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = readdir(abs); } catch { return; }
    for (const e of entries) {
      if (e.dir) {
        if (!EXCLUDE_DIRS.has(e.name) && !e.name.startsWith(".")) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
      } else if (LOCKFILES[e.name] && !seen.has(rel)) {
        seen.add(rel);
        found.push({ dir: rel, manager: LOCKFILES[e.name], file: e.name });
      }
    }
  };
  walk("", 0);
  // Descarta un dir si un ANCESTRO también tiene lockfile (el workspace raíz cubre a los descendientes).
  return found.filter((f) => !found.some((o) => o !== f && isAncestorDir(o.dir, f.dir)));
}

function installErr(out) {
  if (out && out.spawnError) return out.spawnError.code || "error de proceso";
  const s = `${(out && out.stderr) || ""} ${(out && out.stdout) || ""}`.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 160) : `exit ${out && out.code}`;
}

/**
 * Crea un preparador de espacio de trabajo aislado. Todos los efectos son INYECTABLES.
 * @param {object} deps
 * @param {(prefix:string)=>string} deps.mkdtemp   crea un dir temporal y devuelve su ruta absoluta
 * @param {(src:string,dest:string,opts:{exclude:Set<string>})=>void} deps.copyTree  copia el árbol
 * @param {(cmd:string,args:string[],opts:{cwd:string})=>Promise<{code,stdout,stderr,spawnError}>} deps.exec
 * @param {(dir:string)=>void} deps.rm             borra un árbol (best-effort)
 * @param {(abs:string)=>{name:string,dir:boolean}[]} deps.readdir  lista un directorio
 * @param {(abs:string)=>string|null} [deps.readFile]  lee un archivo de texto (para el build de monorepo)
 * @returns {(ctx:{repoRoot:string,detection:object})=>Promise<{workRoot:string|null,cleanup?:function,warnings:string[]}|null>}
 */
export function makeMaterializer({ mkdtemp, copyTree, exec, rm, readdir, readFile }) {
  return async function prepareWorkspace({ repoRoot, detection } = {}) {
    const warnings = [];
    const { isNode, hasDotnet } = analyzeDetection(detection);

    // No es Node → nada que materializar; el ciclo sigue como hoy (sin tocar el repo).
    if (!isNode) return null;
    // Mixto/.NET → v1 no materializa: dotnet restaura al caché global (no ensucia el repo). Camino intacto.
    if (hasDotnet) {
      return { workRoot: null, warnings: ["Proyecto con .NET: se analiza en su lugar (dotnet restaura al caché global sin escribir dependencias en el repo). La materialización aislada cubre Node."] };
    }

    const locks = findLockfileDirs(repoRoot, { readdir });
    if (!locks.length) {
      return { workRoot: null, warnings: ["No se encontró un lockfile (package-lock.json/pnpm-lock.yaml/yarn.lock): se analiza el repo tal cual, sin instalar nada en él."] };
    }

    const workRoot = mkdtemp("qa-ws-");
    try {
      copyTree(repoRoot, workRoot, { exclude: EXCLUDE_DIRS });
    } catch (e) {
      try { rm(workRoot); } catch { /* best-effort */ }
      return { workRoot: null, warnings: [`No se pudo copiar el repo a un espacio aislado (${(e && e.message) || e}); se analiza en su lugar (sin modificarlo).`] };
    }

    let anyInstalled = false;
    for (const lock of locks) {
      const cwd = lock.dir ? path.join(workRoot, lock.dir) : workRoot;
      const cmds = INSTALL[lock.manager];
      if (!cmds) { warnings.push(`Gestor «${lock.manager}» sin instalación soportada; «${lock.dir || "raíz"}» quedó sin dependencias.`); continue; }
      const [primary, fallback] = cmds;
      let out = await exec(primary[0], primary.slice(1), { cwd });
      if ((out.code !== 0 || out.spawnError) && fallback) out = await exec(fallback[0], fallback.slice(1), { cwd });
      if (out.code === 0 && !out.spawnError) anyInstalled = true;
      else warnings.push(`No se instalaron las dependencias de «${lock.dir || "raíz"}» (${lock.manager}): ${installErr(out)}.`);
    }

    // Si NADA se instaló, la copia daría falsos negativos (imports sin resolver): se descarta y el
    // ciclo cae al comportamiento de hoy (analizar el repo tal cual) → nunca queda peor que antes.
    if (!anyInstalled) {
      try { rm(workRoot); } catch { /* best-effort */ }
      return { workRoot: null, warnings: [...warnings, "No se pudieron instalar dependencias en el espacio aislado; se analiza el repo tal cual (sin modificarlo)."] };
    }

    // Monorepo: construir los paquetes del workspace para que el type-check de un paquete resuelva a sus
    // HERMANOS (project references / paquetes que compilan a dist/). Es lo que hace un dev antes de tipar.
    // Solo en monorepos (arquitectura "microservices") → no ralentiza repos de un solo paquete.
    //
    // Se construyen SOLO los paquetes que EMITEN tipos/artefactos (builds con tsc) y se SALTAN los
    // empaquetadores de app (vite/next/…): su salida no la consume ningún type-check y puede fallar por
    // CSS/assets ajenos al objetivo (p.ej. rutas de Windows largas), ensuciando el reporte con un falso
    // «no se pudo construir». La app se type-checkea igual, por separado, en la capa `static`. Best-effort.
    const isMonorepo = (detection && detection.architecture) === "microservices";
    if (isMonorepo) {
      const rootManager = (locks.find((l) => l.dir === "") || locks[0]).manager;
      const b = BUILD[rootManager];
      const rootPkg = readPkgJson(readFile, workRoot);
      const pkgs = b ? resolveWorkspacePackages(workRoot, rootPkg, { readdir, readFile }) : [];
      const buildTargets = pkgs.filter((p) => p.hasBuild && !isAppBundlerBuild(p.build));
      if (b && buildTargets.length) {
        for (const t of buildTargets) {
          const out = await exec(b[0], b.slice(1), { cwd: path.join(workRoot, t.dir) });
          if (out.code !== 0 || out.spawnError) {
            warnings.push(`No se pudo construir el paquete «${t.dir}» (${rootManager} run build): ${installErr(out)}. Si otro paquete que lo importa marca «módulo no encontrado» en el type-check, viene de acá; el type-check de cada paquete corre por separado y su resultado sigue siendo válido.`);
          }
        }
      } else if (b && rootPkg && rootPkg.scripts && typeof rootPkg.scripts.build === "string") {
        // No se pudieron enumerar los paquetes (sin campo `workspaces` legible): fallback al build de la
        // raíz, best-effort. Puede arrastrar el empaquetador de una app (posible falso «no se pudo construir»).
        const out = await exec(b[0], b.slice(1), { cwd: workRoot });
        if (out.code !== 0 || out.spawnError) {
          warnings.push(`No se pudo construir el workspace (${rootManager} run build): ${installErr(out)}. Suele ser el empaquetado de una app (no un error de tipos); el type-check de cada paquete corre por separado y su resultado sigue siendo válido.`);
        }
      }
    }

    return {
      workRoot,
      cleanup: async () => { try { rm(workRoot); } catch { /* best-effort */ } },
      warnings,
      managers: locks.map((l) => l.manager),
    };
  };
}

export default { makeMaterializer, findLockfileDirs, EXCLUDE_DIRS };
