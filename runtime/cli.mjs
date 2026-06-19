#!/usr/bin/env node
// cli.mjs — entrypoint del kit. Corre el ciclo QA local-first y sale con código según
// fallos (0 sin fallos, 1 con fallos, 2 preflight de tracker, 3 error). Es el ejecutable
// que usan los tres targets de entrega (plain/claude-code/cursor) vía bin/qa.mjs.
//
//   node runtime/cli.mjs [repoRoot] [--work-item <id>] [--repo <dir>]
//                        [--feature <FT>] [--developer "<nombre>"]
//
// --feature/-f y --developer/-d se anexan a la subcarpeta de evidencia
// (qa-evidence/<fecha>/WI-<id>__FT-<feature>__<dev>) para trazar corridas de distintos devs.

import { fileURLToPath } from "node:url";
import { runQaCycle } from "./orchestrator.mjs";

const ICONS = { pass: "✅", fail: "❌", skip: "⏭" };

function parseArgs(argv) {
  const out = { repoRoot: undefined, workItem: "local", feature: undefined, developer: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--work-item" || a === "-w") out.workItem = argv[++i];
    else if (a === "--repo" || a === "-C") out.repoRoot = argv[++i];
    else if (a === "--feature" || a === "-f") out.feature = argv[++i];
    else if (a === "--developer" || a === "-d") out.developer = argv[++i];
    else if (!a.startsWith("-")) out.repoRoot = a;
  }
  return out;
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
  const summary = await runQaCycle({
    repoRoot: args.repoRoot || process.cwd(),
    env: process.env,
    workItemId: args.workItem,
    featureId: args.feature,
    developer: args.developer,
  });

  if (summary.stopped === "preflight") {
    console.error(`✗ Preflight del tracker '${summary.tracker}' falló: ${summary.preflight && summary.preflight.detail}`);
    return 2;
  }

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
