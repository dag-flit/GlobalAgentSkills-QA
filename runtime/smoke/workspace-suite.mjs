// workspace-suite.mjs — materialización EFÍMERA del repo fuera de la ruta certificada (materialize.mjs).
// OFFLINE: mkdtemp/copyTree/exec/rm/readdir son fakes → no copia ni lanza procesos. Verifica que:
//  - un repo Node con lockfile se COPIA (excluyendo node_modules/.git) y se instala en el workRoot;
//  - npm ci fallido cae a npm install; si TODO falla, se descarta la copia y se vuelve al repo (null);
//  - un repo .NET (mixto) o sin lockfile NO se materializa (null) — el camino actual queda intacto;
//  - el gestor sale del lockfile (pnpm) y los workspaces se deduplican (la raíz cubre sub-paquetes).

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeMaterializer, findLockfileDirs, EXCLUDE_DIRS } from "../workspace/materialize.mjs";
import { runCodeCycle } from "../orchestrator/code-cycle.mjs";

const ROOT = path.join(path.sep, "repo");
const WS = path.join(path.sep, "ws-tmp");

// readdir fake: monorepo npm (lock SOLO en la raíz; apps/api sin lock propio → cubierto por la raíz).
function readdirNpmMonorepo(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return [
    { name: "package.json", dir: false }, { name: "package-lock.json", dir: false },
    { name: "node_modules", dir: true }, { name: "apps", dir: true },
  ];
  if (rel === "apps") return [{ name: "api", dir: true }];
  if (rel === "apps/api") return [{ name: "package.json", dir: false }];
  return [];
}
function readdirPnpm(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return [{ name: "package.json", dir: false }, { name: "pnpm-lock.yaml", dir: false }];
  return [];
}
function readdirNoLock(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return [{ name: "package.json", dir: false }, { name: "src", dir: true }];
  return [];
}

const detNode = {
  stack: { backend: "node", frontend: "react", db: "postgres" },
  layers: { static: { enabled: true, targets: [{ tool: "tsc", cwd: "apps/api" }] }, unit: { enabled: true, targets: [{ tool: "vitest", cwd: "apps/api" }] } },
};
// FLIT-like (mixto .NET + vitest): NO se materializa (protege el camino .NET vigente).
const detDotnet = {
  stack: { backend: "dotnet", frontend: "react" },
  layers: { static: { enabled: true, targets: [{ tool: "dotnet-build", cwd: "" }, { tool: "eslint", cwd: "web" }] }, unit: { enabled: true, targets: [{ tool: "dotnet-test", cwd: "svc" }, { tool: "vitest", cwd: "web" }] } },
};

// Fabrica un materializador con efectos registrables; `execScript(callIndex, cmd, args) => out`.
// `pkgJson` (opcional) = contenido de package.json de la raíz (para probar el build de monorepo).
function mk(readdir, execScript, pkgJson) {
  const rec = { copied: [], removed: [], execs: [] };
  const deps = {
    mkdtemp: () => WS,
    copyTree: (src, dest, opts) => rec.copied.push({ src, dest, exclude: opts.exclude }),
    rm: (dir) => rec.removed.push(dir),
    readdir,
    readFile: () => (pkgJson ? JSON.stringify(pkgJson) : null),
    exec: async (cmd, args, o) => {
      rec.execs.push({ cmd, args, cwd: o.cwd });
      return execScript(rec.execs.length - 1, cmd, args);
    },
  };
  return { prepare: makeMaterializer(deps), rec };
}

const OK = () => ({ code: 0, stdout: "", stderr: "", spawnError: null });
const FAIL = () => ({ code: 1, stdout: "", stderr: "npm ERR!", spawnError: null });

export async function run(ctx) {
  const { ok } = ctx;

  // findLockfileDirs deduplica: la raíz cubre apps/api (no instala dos veces).
  const locks = findLockfileDirs(ROOT, { readdir: readdirNpmMonorepo });
  assert.strictEqual(locks.length, 1, "un solo objetivo de instalación (la raíz cubre el workspace)");
  assert.strictEqual(locks[0].dir, "", "el lockfile de la raíz");
  assert.strictEqual(locks[0].manager, "npm", "gestor npm por package-lock.json");
  assert.ok(EXCLUDE_DIRS.has("node_modules") && EXCLUDE_DIRS.has(".git"), "la copia excluye node_modules y .git");

  // (1) Node + lockfile + install OK → copia (con excludes) + npm ci en el workRoot + cleanup borra.
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => OK());
    const res = await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(res.workRoot, WS, "devuelve el workRoot aislado (no la ruta certificada)");
    assert.strictEqual(rec.copied.length, 1, "copió el repo una vez");
    assert.strictEqual(rec.copied[0].src, ROOT, "copia DESDE el repo original");
    assert.strictEqual(rec.copied[0].dest, WS, "copia HACIA el espacio aislado");
    assert.ok(rec.copied[0].exclude.has("node_modules"), "la copia excluye node_modules");
    assert.strictEqual(rec.execs.length, 1, "una sola instalación");
    assert.strictEqual(rec.execs[0].cmd, "npm", "instala con npm");
    assert.strictEqual(rec.execs[0].args[0], "ci", "usa `npm ci` (reproducible, respeta el lock)");
    assert.strictEqual(rec.execs[0].cwd, WS, "instala DENTRO del espacio aislado, no en el repo");
    assert.deepStrictEqual(res.managers, ["npm"], "reporta el gestor usado");
    await res.cleanup();
    assert.deepStrictEqual(rec.removed, [WS], "cleanup borra el espacio aislado");
  }
  ok("materialize: repo Node con lockfile → copia (excluye node_modules/.git) + `npm ci` en el workRoot aislado + cleanup borra (el repo original nunca se toca)");

  // (2) npm ci falla → fallback a npm install (OK) → sigue devolviendo el workRoot.
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, (i) => (i === 0 ? FAIL() : OK()));
    const res = await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(res.workRoot, WS, "con el fallback exitoso, el workspace queda listo");
    assert.strictEqual(rec.execs.length, 2, "reintenta: ci y luego install");
    assert.strictEqual(rec.execs[1].args[0], "install", "el fallback es `npm install`");
  }
  // (2b) ambos fallan → descarta la copia y cae al repo original (workRoot null) SIN dejar basura.
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => FAIL());
    const res = await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(res.workRoot, null, "si no se instala nada → null (se analiza el repo tal cual)");
    assert.deepStrictEqual(rec.removed, [WS], "la copia inservible se borra (no queda basura)");
    assert.ok(res.warnings.some((w) => /no se pudieron instalar/i.test(w)), "avisa el fallback y por qué");
  }
  ok("materialize: `npm ci` falla → `npm install`; si ambos fallan → descarta la copia y vuelve al repo (null), sin dejar basura ni empeorar el estado actual");

  // (3) .NET (mixto FLIT-like) → NO materializa (null): el camino .NET vigente queda intacto.
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => OK());
    const res = await prepare({ repoRoot: ROOT, detection: detDotnet });
    assert.strictEqual(res.workRoot, null, ".NET presente → no se materializa (dotnet no ensucia el repo)");
    assert.strictEqual(rec.copied.length, 0, "no copia");
    assert.strictEqual(rec.execs.length, 0, "no instala");
    assert.ok(res.warnings.some((w) => /\.NET/.test(w)), "explica por qué se analiza en su lugar");
  }
  // (3b) sin lockfile → null + aviso (no se instala nada en el repo).
  {
    const { prepare, rec } = mk(readdirNoLock, () => OK());
    const res = await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(res.workRoot, null, "sin lockfile → no materializa");
    assert.strictEqual(rec.copied.length, 0, "no copia sin lockfile");
    assert.ok(res.warnings.some((w) => /lockfile/i.test(w)), "avisa que falta el lockfile");
  }
  // (3c) repo que no es Node → null liso (no aplica).
  {
    const { prepare } = mk(readdirNoLock, () => OK());
    const res = await prepare({ repoRoot: ROOT, detection: { stack: { backend: "python", frontend: "none" }, layers: {} } });
    assert.strictEqual(res, null, "repo no-Node → null (materialización no aplica)");
  }
  ok("materialize: .NET (mixto) o sin lockfile o no-Node → NO materializa (null) sin copiar ni ejecutar → el camino actual queda intacto");

  // (4) el gestor sale del lockfile: pnpm → `pnpm install --frozen-lockfile`.
  {
    const { prepare, rec } = mk(readdirPnpm, () => OK());
    const res = await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(res.workRoot, WS);
    assert.strictEqual(rec.execs[0].cmd, "pnpm", "instala con pnpm por su lockfile");
    assert.deepStrictEqual(rec.execs[0].args, ["install", "--frozen-lockfile"], "usa el install reproducible de pnpm");
  }
  ok("materialize: el gestor se detecta por el lockfile (pnpm → `pnpm install --frozen-lockfile`); un lock de workspace cubre sus sub-paquetes (una sola instalación)");

  // (4b) Monorepo con script `build`: tras instalar, construye los paquetes del workspace → un paquete que
  // depende de un hermano (project references / dist) type-checkea. Solo en monorepos (microservices).
  const detMono = { ...detNode, architecture: "microservices" };
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => OK(), { name: "root", scripts: { build: "tsc -b" } });
    const res = await prepare({ repoRoot: ROOT, detection: detMono });
    assert.strictEqual(res.workRoot, WS);
    assert.strictEqual(rec.execs.length, 2, "instala y LUEGO construye");
    assert.deepStrictEqual(rec.execs[1], { cmd: "npm", args: ["run", "build"], cwd: WS }, "corre `npm run build` en el workRoot tras instalar");
  }
  // (4c) Monorepo SIN script build → no construye (solo instala).
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => OK(), { name: "root", scripts: { dev: "vite" } });
    await prepare({ repoRoot: ROOT, detection: detMono });
    assert.strictEqual(rec.execs.length, 1, "sin script build → no intenta construir");
  }
  // (4d) Repo de un solo paquete (no monorepo) → nunca construye, aunque haya script build.
  {
    const { prepare, rec } = mk(readdirNpmMonorepo, () => OK(), { name: "root", scripts: { build: "tsc" } });
    await prepare({ repoRoot: ROOT, detection: detNode });
    assert.strictEqual(rec.execs.length, 1, "repo simple → solo instala, no construye");
  }
  ok("materialize: monorepo con script `build` → construye los paquetes del workspace tras instalar; sin script build o repo de un solo paquete → no construye");

  // (4e) Monorepo con `workspaces`: se construyen SOLO los paquetes que emiten tipos (build con tsc) y se
  //      SALTA el empaquetador de la app (vite build) — su salida no la consume el type-check y puede fallar
  //      por CSS/ruta ajena. Espejo de flito (apps/api `tsc -b`, apps/web `tsc && vite build`, packages/shared).
  {
    const detWs = { ...detNode, architecture: "microservices" };
    const files = {
      "": { name: "root", private: true, workspaces: ["apps/*", "packages/*"], scripts: { build: "x" } },
      "apps/api": { name: "@op/api", scripts: { build: "tsc -b && tsc-alias" } },
      "apps/web": { name: "@op/web", scripts: { build: "tsc --noEmit && vite build" } },
      "packages/shared-types": { name: "@op/shared", scripts: { build: "tsc -b" } },
    };
    const relOf = (abs) => {
      for (const base of [WS, ROOT]) {
        if (abs === base) return "";
        const p = base + path.sep;
        if (abs.startsWith(p)) return abs.slice(p.length).replace(/\\/g, "/");
      }
      return abs.replace(/\\/g, "/");
    };
    const readdirWs = (abs) => {
      const rel = relOf(abs);
      if (rel === "") return [{ name: "package.json", dir: false }, { name: "package-lock.json", dir: false }, { name: "apps", dir: true }, { name: "packages", dir: true }];
      if (rel === "apps") return [{ name: "api", dir: true }, { name: "web", dir: true }];
      if (rel === "packages") return [{ name: "shared-types", dir: true }];
      return [];
    };
    const rec = { execs: [] };
    const prepare = makeMaterializer({
      mkdtemp: () => WS,
      copyTree: () => {},
      rm: () => {},
      readdir: readdirWs,
      readFile: (abs) => {
        const key = relOf(abs).replace(/\/?package\.json$/, "");
        return files[key] ? JSON.stringify(files[key]) : null;
      },
      exec: async (cmd, args, o) => { rec.execs.push({ cmd, args, cwd: o.cwd }); return OK(); },
    });
    const res = await prepare({ repoRoot: ROOT, detection: detWs });
    assert.strictEqual(res.workRoot, WS);
    const builtDirs = rec.execs
      .filter((e) => e.args[0] === "run" && e.args[1] === "build")
      .map((e) => path.relative(WS, e.cwd).replace(/\\/g, "/"))
      .sort();
    assert.deepStrictEqual(builtDirs, ["apps/api", "packages/shared-types"], "construye los paquetes tsc (apps/api + shared-types)");
    assert.ok(!builtDirs.includes("apps/web"), "SALTA el empaquetador de la app (apps/web: vite build)");
  }
  ok("materialize: monorepo → construye solo los paquetes que emiten tipos (tsc) y SALTA los empaquetadores de app (vite/next); la app se type-checkea igual por separado, sin el falso «no se pudo construir»");

  // (5) Integración con runCodeCycle: con `prepareWorkspace`, las capas con deps (static/unit/security)
  // corren en el workRoot (copia FUERA del repo certificado); SIN él, sobre el repo tal cual (histórico).
  // El cleanup se ejecuta siempre. Offline: exec fake + materializador fake (no copia ni instala real).
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ws-base-"));
  try {
    const repo = path.join(baseDir, "myrepo");
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "myrepo", devDependencies: { eslint: "^9", vitest: "^2" } }), "utf8");
    const realRepo = fs.realpathSync(repo);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-ws-fake-"));

    let cleaned = 0;
    const cwdsWs = [];
    const cycleWs = await runCodeCycle({
      sourcePath: "myrepo", baseDir, env: {}, workItemId: "local",
      exec: (_c, _a, o) => { cwdsWs.push(o && o.cwd); return { code: 0, stdout: "", stderr: "" }; },
      prepareWorkspace: async ({ repoRoot }) => {
        assert.strictEqual(repoRoot, realRepo, "el materializador recibe el repo REAL a copiar");
        return { workRoot: workDir, cleanup: async () => { cleaned++; }, warnings: ["espacio aislado listo"] };
      },
    });
    assert.ok(cwdsWs.length > 0, "se corrieron herramientas de las capas con deps");
    assert.ok(cwdsWs.every((c) => c === workDir), "static/unit/security corren en el espacio aislado, NO en la ruta certificada");
    assert.strictEqual(cleaned, 1, "el cleanup del espacio aislado se ejecuta una vez");
    assert.ok((cycleWs.warnings || []).some((w) => /espacio aislado listo/.test(w)), "propaga los avisos del materializador");

    // Sin prepareWorkspace → las mismas capas corren sobre el repo ORIGINAL (histórico intacto).
    const cwdsRepo = [];
    await runCodeCycle({ sourcePath: "myrepo", baseDir, env: {}, workItemId: "local", exec: (_c, _a, o) => { cwdsRepo.push(o && o.cwd); return { code: 0, stdout: "", stderr: "" }; } });
    assert.ok(cwdsRepo.length > 0 && cwdsRepo.every((c) => c === realRepo), "sin materializador → corre sobre el repo tal cual (histórico intacto)");

    fs.rmSync(workDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  ok("materialize: integración con runCodeCycle (capas con deps → workRoot; sin materializador → repo original; cleanup siempre; la ruta certificada nunca se toca)");
}

export default { run };
