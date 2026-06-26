// smoke-test.mjs — verifica el plumbing del kit de punta a punta, sin red.
// Corre con: node runtime/smoke-test.mjs
//
// El cuerpo se partió por área en runtime/smoke/*.mjs (F1, regla de 400 líneas). Este archivo
// es solo el runner: crea el contexto compartido, ejecuta los módulos EN ORDEN y verifica que
// corrieron exactamente 41 casos (la aserción de conteo detecta casos perdidos en el split).
import fs from "node:fs";
import assert from "node:assert";
import { makeCtx } from "./smoke/_harness.mjs";
import * as resolver from "./smoke/resolver.mjs";
import * as runners from "./smoke/runners.mjs";
import * as adapters from "./smoke/adapters.mjs";
import * as layers from "./smoke/layers.mjs";
import * as orchestrator from "./smoke/orchestrator.mjs";
import * as evidence from "./smoke/evidence.mjs";
import * as bdd from "./smoke/bdd.mjs";

const EXPECTED = 42;

console.log("== F0 smoke test ==\n");

const ctx = makeCtx();
// resolver PRIMERO: fija en ctx los valores compartidos (pDefault/pFlit/tmp/res) que usan los demás.
await resolver.run(ctx);
await runners.run(ctx);
await adapters.run(ctx);
await layers.run(ctx);
await orchestrator.run(ctx);
await evidence.run(ctx);
await bdd.run(ctx);

console.log(`\n== ${ctx.state.passed}/${EXPECTED} OK ==`);
assert.strictEqual(ctx.state.passed, EXPECTED, `se esperaban ${EXPECTED} casos, corrieron ${ctx.state.passed}`);
console.log("Reporte de ejemplo:", ctx.res.dir);
fs.rmSync(ctx.tmp, { recursive: true, force: true });
