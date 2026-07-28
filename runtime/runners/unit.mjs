// unit.mjs — runner de la capa `unit`. Ejecuta los tests unitarios existentes del repo
// (vitest/jest/pytest/dotnet) y emite el EvidenceObject normalizado al sink.
// NO genera código ni se acopla a un stack: solo corre lo que ya existe (la generación
// de tests es del pack opcional dev-side, fuera del core QA).
//
// Deuda D1 cerrada: este runner NUNCA escribe en `Custom.Evidences` ni en ningún campo
// de tracker. Emite el objeto normalizado; el sink (local por defecto) decide el destino.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLayer } from "./_runner-core.mjs";
import { parseJestLike, parseDotnet } from "./parse-cases.mjs";

// vitest/jest con `--reporter=json` escriben el JSON a STDOUT, MEZCLADO con los `console.log`/stderr de
// las propias pruebas → el JSON queda contaminado y el parser no puede extraer los casos (se pierde el
// desglose prueba-por-prueba). Fix: escribir el reporte a un ARCHIVO (`--outputFile`) y leerlo limpio.
// Fallback: si el archivo no existe (la herramienta murió antes de escribirlo, o un exec fake en el smoke),
// se cae a `out.stdout` → comportamiento previo intacto. El archivo va a un temporal (no toca el repo).
function jsonReporterSpec(argvBase, label) {
  const file = path.join(os.tmpdir(), `qa-${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`);
  return {
    argv: [...argvBase, `--outputFile=${file}`],
    parseCases: (out, ctx) => {
      let json = out.stdout;
      try {
        const f = fs.readFileSync(file, "utf8");
        if (f && f.trim()) json = f;
      } catch { /* archivo ausente → usa stdout (fallback) */ }
      try { fs.unlinkSync(file); } catch { /* best-effort */ }
      return parseJestLike({ ...out, stdout: json }, ctx);
    },
  };
}

// Escanea el árbol (acotado) y recolecta la solución (.sln) y TODOS los proyectos de test
// (*.csproj con Test/Tests). En monorepos el .csproj puede vivir en backend/services/… → no
// depende de la cwd. Un solo recorrido; los llamadores deciden qué usar.
function scanDotnet(baseDir, { maxDepth = 5 } = {}) {
  const SKIP = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".vs"]);
  let sln = null;
  const tests = []; // { abs, label }
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (!sln && /\.sln$/i.test(e.name)) sln = path.join(dir, e.name);
        else if (/tests?\.csproj$/i.test(e.name)) tests.push({ abs: path.join(dir, e.name), label: e.name.replace(/\.csproj$/i, "") });
      }
    }
  }
  walk(baseDir, 0);
  return { sln, tests };
}

// Destino de una ÚNICA invocación `dotnet test`: prefiere la solución (.sln) —corre TODOS los
// proyectos de test de una— y si no hay, el primer proyecto de test.
function findDotnetTarget(baseDir) {
  const { sln, tests } = scanDotnet(baseDir);
  return sln || (tests[0] && tests[0].abs) || null;
}

// SIN solución (.sln), `dotnet test` no puede correr TODOS los proyectos de test en una sola
// invocación; sin esto el runner corría SOLO el primero y saltaba el resto (pérdida SILENCIOSA de
// cobertura). Expandimos el objetivo dotnet en uno POR proyecto de test: cada uno pasa su .csproj por
// RUTA ABSOLUTA (arg de dotnet) con la cwd en la RAÍZ del repo — así un `global.json` PROFUNDO (que
// fijaría un SDK no instalado) NO se activa. Con .sln, o con 0/1 proyecto, se deja el comportamiento
// de siempre (una sola invocación). Se preserva el resto de objetivos de la capa (p.ej. vitest@frontend).
function expandDotnetTargetsForUnit(detection, repoRoot) {
  const unit = detection?.layers?.unit;
  if (!unit || !unit.enabled || !Array.isArray(unit.targets)) return detection;
  const idx = unit.targets.findIndex((t) => t.tool === "dotnet-test");
  if (idx < 0) return detection;
  const { sln, tests } = scanDotnet(repoRoot);
  if (sln || tests.length < 2) return detection; // .sln o ≤1 proyecto → una sola invocación
  const expanded = tests.map((t) => ({ tool: "dotnet-test", cwd: "", project: t.abs, label: t.label }));
  const targets = [...unit.targets.slice(0, idx), ...expanded, ...unit.targets.slice(idx + 1)];
  return { ...detection, layers: { ...detection.layers, unit: { ...unit, targets } } };
}

// Prioridad fijada por qa-detect (vitest > jest > pytest > *.csproj).
// vitest/jest emiten el detalle por TC en formato Jest-JSON (reporter nativo, sin instalar
// nada) → parseJestLike. dotnet no trae JSON nativo, pero SÍ parseamos su salida de consola
// (errores de compilación + pruebas fallidas) → parseDotnet. pytest queda con el resumen de texto.
const TOOLS = {
  vitest: () => jsonReporterSpec(["vitest", "run", "--reporter=json"], "vitest"),
  jest: () => jsonReporterSpec(["jest", "--json"], "jest"),
  pytest: ["pytest"],
  // función: si el objetivo trae un `project` explícito (fan-out sin .sln), lo corre; si no,
  // localiza el .sln/primer .csproj bajo la cwd. Sin destino localizable → skip con aviso, no aborta.
  // `--nologo` reduce el ruido de restauración; parseDotnet extrae los fallos reales (compilación / pruebas).
  "dotnet-test": ({ repoRoot, project }) => {
    const target = project || findDotnetTarget(repoRoot);
    return target
      ? { argv: ["dotnet", "test", target, "--nologo"], parseCases: parseDotnet }
      : { skip: "dotnet detectado pero sin .sln ni *Tests.csproj localizable" };
  },
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runUnitTests(opts = {}) {
  // Sin .sln, expande el objetivo dotnet a uno por proyecto de test (corre TODOS, no solo el primero).
  // Requiere la detección; si no vino, runLayer la calcula y NO se expande (comportamiento previo).
  const detection = opts.detection
    ? expandDotnetTargetsForUnit(opts.detection, opts.repoRoot || process.cwd())
    : opts.detection;
  return runLayer({ layer: "unit", tools: TOOLS, ...opts, detection });
}

export default { runUnitTests };
