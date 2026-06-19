// _runner-core.mjs — lógica común a todos los runners de capa (static/unit/e2e/…).
// Cada runner concreto aporta solo: el nombre de capa y su registro de herramientas
// (tool → argv neutro). Aquí vive el resto: resolución de binario, ejecución
// (inyectable), mapeo a EvidenceObject normalizado. CERO literales de dominio.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectRepo } from "../detect/qa-detect.mjs";

// Resuelve el binario: prefiere el local del repo (node_modules/.bin) y cae a PATH.
export function resolveBin(repoRoot, tool) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const local = path.join(repoRoot, "node_modules", ".bin", tool + ext);
  if (fs.existsSync(local)) return local;
  const localNoExt = path.join(repoRoot, "node_modules", ".bin", tool);
  if (fs.existsSync(localNoExt)) return localNoExt;
  return tool; // confía en PATH (pytest/dotnet/ruff/mypy suelen vivir ahí)
}

// Ejecutor por defecto (real). Inyectable para tests deterministas/offline.
export function defaultExec(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32", // resuelve shims .cmd en Windows
  });
  return {
    code: typeof r.status === "number" ? r.status : 127,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    spawnError: r.error || null,
  };
}

// Resumen breve para la celda del reporte (el objeto va a una tabla md/html).
export function summarize(out) {
  const lines = `${out.stdout}\n${out.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines.slice(0, 3).join(" · ").slice(0, 240) : "";
}

/**
 * Ejecuta una capa y devuelve un EvidenceObject normalizado.
 * @param {object} opts
 * @param {string} opts.layer            static | unit | e2e | …
 * @param {Record<string,string[]>} opts.tools  tool → argv (p.ej. { vitest: ["vitest","run"] })
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.profile]
 * @param {object} [opts.detection]      salida de detectRepo() (si ya se calculó)
 * @param {function} [opts.exec]         ejecutor inyectable (cmd, args, {cwd}) -> {code,stdout,stderr}
 * @param {string} [opts.workItemId]
 * @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject}
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
    return { ...base, status: "skip", narrative: info.reason || `sin herramienta para ${layer}`, metrics: { tool: null } };
  }

  const tool = info.tool;
  const spec = tools[tool];
  if (!spec) {
    return { ...base, status: "skip", narrative: `herramienta '${tool}' sin invocación soportada`, metrics: { tool } };
  }

  // El spec puede ser un argv fijo (array) o una función que lo construye desde el
  // contexto (env/profile/detección). La función puede devolver { skip: "razón" } para
  // omitir con aviso (p.ej. falta una conexión que NUNCA se cablea).
  let argv;
  if (typeof spec === "function") {
    const resolved = spec({ repoRoot, profile, env, detection: det, info, tool });
    if (!resolved || resolved.skip) {
      return { ...base, status: "skip", narrative: (resolved && resolved.skip) || `'${tool}' sin configuración suficiente`, metrics: { tool } };
    }
    argv = Array.isArray(resolved) ? resolved : resolved.argv;
  } else {
    argv = spec;
  }

  const [name, ...args] = argv;
  const bin = resolveBin(repoRoot, name);
  const out = exec(bin, args, { cwd: repoRoot });

  // No se pudo lanzar el binario (no instalado / fuera de PATH): omitir con aviso.
  if (out.spawnError || out.code === 127) {
    return {
      ...base,
      status: "skip",
      narrative: `${tool} no ejecutable (no instalado / fuera de PATH) — capa omitida`,
      metrics: { tool, exitCode: out.code },
    };
  }

  const status = out.code === 0 ? "pass" : "fail";
  const detail = summarize(out);
  const narrative = status === "pass" ? `${tool}: ok` : `${tool}: exit ${out.code}${detail ? ` — ${detail}` : ""}`;

  return { ...base, status, narrative, metrics: { tool, exitCode: out.code } };
}

export default { runLayer, resolveBin, defaultExec, summarize };
