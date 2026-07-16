// smoke-test.mjs — verifica el plumbing del kit de punta a punta, sin red.
// Corre con: node runtime/smoke-test.mjs
//
// El kit quedó acotado a EXPLORACIÓN de una URL viva (pruebas E2E) con tracker local o
// azure-devops. El cuerpo vive en runtime/smoke/*.mjs: `resolver` (perfil/factory/sink) y
// `explore-suite` (adapter azure, runner explore, runQaCycle, retry HTTP, guardrail de líneas).
// La aserción de conteo detecta casos perdidos.
import fs from "node:fs";
import assert from "node:assert";
import { makeCtx } from "./smoke/_harness.mjs";
import * as resolver from "./smoke/resolver.mjs";
import * as explore from "./smoke/explore-suite.mjs";
import * as fanoutSuite from "./smoke/fanout-suite.mjs";
import * as prSuite from "./smoke/pr-suite.mjs";
import * as codeSuite from "./smoke/code-suite.mjs";
import * as secretSuite from "./smoke/secret-scan-suite.mjs";
import * as scaSuite from "./smoke/sca-suite.mjs";

const EXPECTED = 73;

console.log("== smoke test (kit acotado a exploración E2E) ==\n");

const ctx = makeCtx();
// resolver PRIMERO: fija en ctx los valores compartidos (pDefault/pFlit/tmp/res) que usan los demás.
await resolver.run(ctx);
await explore.run(ctx);
await fanoutSuite.run(ctx);
await prSuite.run(ctx);
await codeSuite.run(ctx);
await secretSuite.run(ctx);
await scaSuite.run(ctx);

console.log(`\n== ${ctx.state.passed}/${EXPECTED} OK ==`);
assert.strictEqual(ctx.state.passed, EXPECTED, `se esperaban ${EXPECTED} casos, corrieron ${ctx.state.passed}`);
console.log("Reporte de ejemplo:", ctx.res.dir);
fs.rmSync(ctx.tmp, { recursive: true, force: true });
