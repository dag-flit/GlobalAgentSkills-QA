#!/usr/bin/env node
// cli.mjs — entrypoint del kit. Explora una URL viva (pruebas E2E) y sale con código según
// fallos (0 sin fallos, 1 con fallos, 2 preflight de tracker, 3 error). Es el ejecutable
// que usan los tres targets de entrega (plain/claude-code/cursor) vía bin/qa.mjs.
//
//   node runtime/cli.mjs (--url <https://app> | --flow <archivo>) [--work-item <id>]
//                        [--repo <dir>] [--feature <FT>] [--developer "<nombre>"]
//
// --url/-u es la app viva a explorar (modo URL-smoke). --flow/-F es un GUION de pasos (modo
// flujo E2E: login → navegar → verificar) en JSON o YAML; los `${VAR}` del guion se resuelven
// contra el entorno (p.ej. QA_USER/QA_PASS). --feature/-f y --developer/-d se anexan a la
// subcarpeta de evidencia. El tracker (local o azure-devops) sale del perfil.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runQaCycle } from "./orchestrator.mjs";
import { parseYaml } from "./profile/yaml-lite.mjs";

const ICONS = { pass: "✅", fail: "❌", skip: "⏭" };

function parseArgs(argv) {
  const out = { repoRoot: undefined, workItem: "local", feature: undefined, developer: undefined, url: undefined, flow: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--work-item" || a === "-w") out.workItem = argv[++i];
    else if (a === "--repo" || a === "-C") out.repoRoot = argv[++i];
    else if (a === "--feature" || a === "-f") out.feature = argv[++i];
    else if (a === "--developer" || a === "-d") out.developer = argv[++i];
    else if (a === "--url" || a === "-u") out.url = argv[++i];
    else if (a === "--flow" || a === "-F") out.flow = argv[++i];
    else if (!a.startsWith("-")) out.repoRoot = a;
  }
  return out;
}

// Carga un guion desde archivo. Acepta un array de pasos, o un objeto { url?, steps, vars? }.
// .json → JSON nativo; .yaml/.yml → yaml-lite (lista de flow-maps inline).
function loadFlow(file) {
  const text = fs.readFileSync(file, "utf8");
  const data = /\.ya?ml$/i.test(file) ? parseYaml(text) : JSON.parse(text);
  if (Array.isArray(data)) return { steps: data, url: undefined, vars: {} };
  return { steps: data.steps || data.pasos || [], url: data.url || data.appUrl, vars: data.vars || {} };
}

function reportPath(summary) {
  const r = summary.report;
  return (r && (r.mdPath || (r.local && r.local.mdPath))) || null;
}

/**
 * Punto de entrada programable (devuelve el exit code, no llama a process.exit).
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  let flowSpec = null;
  if (args.flow) {
    try {
      flowSpec = loadFlow(args.flow);
    } catch (e) {
      console.error(`✗ No se pudo leer el guion '${args.flow}': ${e.message}`);
      return 3;
    }
  }
  const appUrl = args.url || (flowSpec && flowSpec.url);
  const steps = flowSpec && flowSpec.steps;
  const hasFlow = Array.isArray(steps) && steps.length > 0;
  if (!appUrl && !hasFlow) {
    console.error("✗ Falta --url <https://app> o --flow <archivo>: indica qué explorar.");
    return 3;
  }
  // El WI real (no "local") traza la evidencia del guion para el attach en ADO.
  const tcId = args.workItem && args.workItem !== "local" ? args.workItem : undefined;

  const summary = await runQaCycle({
    repoRoot: args.repoRoot || process.cwd(),
    env: process.env,
    workItemId: args.workItem,
    featureId: args.feature,
    developer: args.developer,
    appUrl,
    flow: steps,
    vars: (flowSpec && flowSpec.vars) || {},
    tcId,
  });

  if (summary.stopped === "preflight") {
    console.error(`✗ Preflight del tracker '${summary.tracker}' falló: ${summary.preflight && summary.preflight.detail}`);
    return 2;
  }

  for (const w of summary.warnings || []) console.warn(`⚠ ${w}`);

  const results = summary.results || [];
  const c = (s) => results.filter((r) => r.status === s).length;
  console.log(`QA (${summary.tracker}) — ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}`);
  for (const r of results) {
    const tc = r.tc_id ? ` ${r.tc_id}` : "";
    console.log(`  ${ICONS[r.status] || "•"} ${r.layer}${tc} — ${r.narrative || r.status}`);
  }
  const md = reportPath(summary);
  if (md) console.log(`Reporte: ${md}`);
  return c("fail") > 0 ? 1 : 0;
}

// Ejecutar si se invoca directamente (no cuando se importa).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(3);
    });
}

export default { main };
