// unit.mjs — runner de la capa `unit`. Ejecuta los tests unitarios existentes del repo
// (vitest/jest/pytest/dotnet) y emite el EvidenceObject normalizado al sink.
// NO genera código ni se acopla a un stack: solo corre lo que ya existe (la generación
// de tests es del pack opcional dev-side, fuera del core QA).
//
// Deuda D1 cerrada: este runner NUNCA escribe en `Custom.Evidences` ni en ningún campo
// de tracker. Emite el objeto normalizado; el sink (local por defecto) decide el destino.

import fs from "node:fs";
import path from "node:path";
import { runLayer } from "./_runner-core.mjs";
import { parseJestLike, parseDotnet } from "./parse-cases.mjs";

// Busca el destino de `dotnet test` bajo baseDir: prefiere una solución (.sln) —corre TODOS
// los proyectos de test— y si no hay, el primer proyecto de test (*.csproj con Test/Tests).
// Así `dotnet test` no depende de la cwd: en monorepos el .csproj puede vivir en backend/.
function findDotnetTarget(baseDir, { maxDepth = 4 } = {}) {
  const SKIP = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".vs"]);
  let sln = null;
  let testProj = null;
  function walk(dir, depth) {
    if (depth > maxDepth || (sln && testProj)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (!sln && /\.sln$/i.test(e.name)) sln = path.join(dir, e.name);
        else if (!testProj && /tests?\.csproj$/i.test(e.name)) testProj = path.join(dir, e.name);
      }
    }
  }
  walk(baseDir, 0);
  return sln || testProj || null;
}

// Prioridad fijada por qa-detect (vitest > jest > pytest > *.csproj).
// vitest/jest emiten el detalle por TC en formato Jest-JSON (reporter nativo, sin instalar
// nada) → parseJestLike. dotnet no trae JSON nativo, pero SÍ parseamos su salida de consola
// (errores de compilación + pruebas fallidas) → parseDotnet. pytest queda con el resumen de texto.
const TOOLS = {
  vitest: () => ({ argv: ["vitest", "run", "--reporter=json"], parseCases: parseJestLike }),
  jest: () => ({ argv: ["jest", "--json"], parseCases: parseJestLike }),
  pytest: ["pytest"],
  // función: localiza el .sln/.csproj y lo pasa explícito (recibe la cwd del objetivo como
  // base). Sin destino localizable → skip con aviso, no aborta. `--nologo` reduce el ruido de
  // restauración en la salida; parseDotnet extrae los fallos reales (compilación / pruebas).
  "dotnet-test": ({ repoRoot }) => {
    const target = findDotnetTarget(repoRoot);
    return target
      ? { argv: ["dotnet", "test", target, "--nologo"], parseCases: parseDotnet }
      : { skip: "dotnet detectado pero sin .sln ni *Tests.csproj localizable" };
  },
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runUnitTests(opts = {}) {
  return runLayer({ layer: "unit", tools: TOOLS, ...opts });
}

export default { runUnitTests };
