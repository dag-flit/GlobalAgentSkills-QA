// db.steps.mjs — steps de BD (SQL) reutilizables. Conexión SIEMPRE desde env (nunca cableada):
// DATABASE_URL / PG_CONNECTION / DB_CONNECTION. El driver `pg` se carga de forma perezosa (solo si
// un step de BD se ejecuta) y debe estar instalado en el proyecto. Frases en español.

import { Then } from "@cucumber/cucumber";
import { strict as assert } from "node:assert";

Then(/^la tabla "([^"]*)" (?:tiene|deber[ií]a tener) (\d+) filas?$/i, async function (tabla, n) {
  const conn = process.env.DATABASE_URL || process.env.PG_CONNECTION || process.env.DB_CONNECTION;
  if (!conn) throw new Error("sin conexión a BD: exporta DATABASE_URL o PG_CONNECTION");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    // El nombre de tabla viene del .feature (autoría QA), no de input externo. Se valida que sea
    // un identificador SQL simple para evitar inyección accidental.
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(tabla)) throw new Error(`nombre de tabla no válido: ${tabla}`);
    const r = await client.query(`SELECT count(*)::int AS c FROM ${tabla}`);
    assert.equal(r.rows[0].c, Number(n), `la tabla ${tabla} tiene ${r.rows[0].c} filas, se esperaban ${n}`);
  } finally {
    await client.end();
  }
});
