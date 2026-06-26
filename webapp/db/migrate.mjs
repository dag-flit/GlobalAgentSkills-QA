// migrate.mjs — Runner de migraciones del CONTROL-PLANE. Aplica los .sql de
// webapp/db/migrations/ en orden lexicográfico, una sola vez cada uno (registro en
// la tabla schema_migrations). Idempotente: re-correrlo no re-aplica lo ya hecho.
//
// Uso (desde webapp/):  node --env-file=.env.local db/migrate.mjs
//   (--env-file carga CONTROL_PLANE_URL; Node 20.6+/24 lo soporta nativo.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pgmod from "pg";

const PG = pgmod.default ?? pgmod;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "migrations");

async function main() {
  const url = process.env.CONTROL_PLANE_URL;
  if (!url) {
    console.error("✗ Falta CONTROL_PLANE_URL (usa: node --env-file=.env.local db/migrate.mjs)");
    process.exit(2);
  }
  const client = new PG.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
        "version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version),
    );
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) {
        console.log(`= ${f} (ya aplicada)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, f), "utf-8");
      process.stdout.write(`▶ ${f} … `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log("OK");
        applied++;
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`FALLO\n   ${e.message}`);
        process.exit(1);
      }
    }
    console.log(`\n✓ ${applied} migración(es) nueva(s) · ${files.length} en total.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
