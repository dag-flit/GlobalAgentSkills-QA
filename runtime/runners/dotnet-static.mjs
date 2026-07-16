// dotnet-static.mjs — análisis ESTÁTICO de .NET para la capa `static`. Hermano del fan-out de
// `unit` (expandDotnetTargetsForUnit): sin `.sln`, `dotnet build` no cubre TODOS los proyectos en
// una sola invocación, así que expandimos la capa a un objetivo por proyecto (cada uno con su
// `.csproj` por RUTA ABSOLUTA y cwd en la RAÍZ del repo → un `global.json` PROFUNDO no se activa).
//
// PURO/offline: solo escanea el árbol (fs). La ejecución la hace runLayer con el `exec` inyectable.
// NO toca el repo probado: `dotnet build` solo restaura al caché global de NuGet y escribe obj/bin
// (artefactos transitorios, git-ignored) — no modifica el código fuente ni agrega dependencias.

import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".vs", ".venv", "venv"]);
const isTestProject = (name) => /tests?\.csproj$/i.test(name);

// Recorre el árbol (acotado) y recolecta la solución (.sln) y TODOS los proyectos .csproj,
// separando los de test (los cubre la capa `unit`) de los de aplicación (objetivo del static).
export function scanDotnetProjects(baseDir, { maxDepth = 6 } = {}) {
  let sln = null;
  const app = []; // { abs, label }  proyectos de aplicación (no-test)
  const test = []; // { abs, label } proyectos de test
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
        else if (/\.csproj$/i.test(e.name)) {
          const item = { abs: path.join(dir, e.name), label: e.name.replace(/\.csproj$/i, "") };
          (isTestProject(e.name) ? test : app).push(item);
        }
      }
    }
  }
  walk(baseDir, 0);
  return { sln, app, test };
}

// Destino de UNA invocación `dotnet build` cuando no se pasa un proyecto explícito: prefiere la
// solución (.sln) —cubre todo— y si no hay, el primer proyecto de aplicación (o el primer .csproj).
export function findDotnetBuildTarget(repoRoot) {
  const { sln, app, test } = scanDotnetProjects(repoRoot);
  return sln || (app[0] && app[0].abs) || (test[0] && test[0].abs) || null;
}

// Igual que expandDotnetTargetsForUnit pero para `static`: garantiza que .NET reciba análisis
// estático AUNQUE otra herramienta (eslint) domine el scope en un monorepo mixto (frontend JS +
// backend .NET). Conserva los objetivos NO-dotnet (eslint/tsc/ruff/mypy) y agrega los de .NET:
//   • con .sln  → UN objetivo (la solución cubre todos los proyectos);
//   • sin .sln  → uno por proyecto de APLICACIÓN (los de test los corre `unit`).
// Enciende la capa si estaba apagada pero hay .NET. Sin .NET → detección intacta.
export function expandDotnetStaticTargets(detection, repoRoot) {
  const { sln, app, test } = scanDotnetProjects(repoRoot);
  if (!sln && !app.length && !test.length) return detection; // repo sin .NET → sin cambios
  const projects = app.length ? app : test; // repo solo-tests: igual damos análisis estático
  const dotnetTargets = sln
    ? [{ tool: "dotnet-build", cwd: "", project: sln, label: path.basename(sln) }]
    : projects.map((p) => ({ tool: "dotnet-build", cwd: "", project: p.abs, label: p.label }));

  const st = detection?.layers?.static;
  // Conserva objetivos de OTRAS herramientas; descarta cualquier dotnet-build genérico de la
  // detección (lo reemplazamos por objetivos concretos con ruta absoluta de proyecto).
  const kept = (st && st.enabled && Array.isArray(st.targets) ? st.targets : []).filter((t) => t.tool !== "dotnet-build");
  const targets = [...kept, ...dotnetTargets];
  const static2 = { ...(st || {}), enabled: true, tool: (st && st.tool && st.tool !== "dotnet-build") ? st.tool : "dotnet-build", targets };
  return { ...detection, layers: { ...(detection?.layers || {}), static: static2 } };
}

export default { scanDotnetProjects, findDotnetBuildTarget, expandDotnetStaticTargets };
