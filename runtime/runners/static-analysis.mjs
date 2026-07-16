// static-analysis.mjs — runner de la capa `static` (linter / type-checker / análisis Roslyn).
// Detecta la herramienta (vía qa-detect) y emite el EvidenceObject normalizado.
// La mecánica (resolución de binario, ejecución, mapeo) vive en _runner-core.mjs.

import { runLayer } from "./_runner-core.mjs";
import { parseEslint, parseRuff, parseDotnetBuild } from "./parse-cases.mjs";
import { expandDotnetStaticTargets, findDotnetBuildTarget } from "./dotnet-static.mjs";

// El orden de prioridad ya lo fija qa-detect (eslint > tsc > ruff > mypy > dotnet);
// aquí solo mapeamos cada herramienta a su invocación neutra. eslint/ruff/dotnet exponen sus
// hallazgos como TC vía parser; tsc/mypy no traen JSON por caso: resumen de texto.
const TOOLS = {
  eslint: () => ({ argv: ["eslint", ".", "-f", "json"], parseCases: parseEslint }),
  tsc: ["tsc", "--noEmit"],
  ruff: () => ({ argv: ["ruff", "check", ".", "--output-format=json"], parseCases: parseRuff }),
  mypy: ["mypy", "."],
  // Análisis estático de .NET: `dotnet build` re-corre los analizadores Roslyn + el compilador.
  //  • `--no-incremental` FUERZA la recompilación → los analizadores vuelven a emitir sus avisos
  //    aunque el build esté "al día" (si no, MSBuild salta los proyectos up-to-date y NO reporta
  //    nada → falso "sin hallazgos"). Es el precio de un análisis estático honesto.
  //  • `/p:EnableNETAnalyzers=true /p:AnalysisLevel=latest-recommended` fuerza el set de
  //    analizadores por LÍNEA DE COMANDO (propiedad MSBuild) → NO modifica el repo probado.
  //  • Las advertencias NO se convierten en error (sin `/warnaserror`) → el build no se cae por
  //    avisos; solo los errores de compilación (exit ≠ 0) marcan la capa en rojo.
  "dotnet-build": ({ repoRoot, project }) => {
    const target = project || findDotnetBuildTarget(repoRoot);
    if (!target) return { skip: "dotnet detectado pero sin .sln ni *.csproj localizable" };
    return {
      argv: ["dotnet", "build", target, "--nologo", "--no-incremental",
        "/p:EnableNETAnalyzers=true", "/p:AnalysisLevel=latest-recommended", "/clp:NoSummary"],
      parseCases: parseDotnetBuild,
    };
  },
};

/** @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>} */
export function runStaticAnalysis(opts = {}) {
  // Con detección, expande el objetivo .NET a uno por proyecto de aplicación (sin .sln) o a la
  // solución → así el backend .NET recibe análisis estático JUNTO al frontend (eslint), no solo el
  // de mayor prioridad. Sin detección, runLayer la calcula (qa-detect ya enciende static por .NET).
  const detection = opts.detection
    ? expandDotnetStaticTargets(opts.detection, opts.repoRoot || process.cwd())
    : opts.detection;
  return runLayer({ layer: "static", tools: TOOLS, ...opts, detection });
}

export default { runStaticAnalysis };
