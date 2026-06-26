// retention.mjs — Política de retención del control-plane: purga runs (y sus run_events por
// cascade) más viejos que N días, POR TENANT, y borra su evidencia en disco. Pensado para
// correr en un cron. Recorre tenant por tenant fijando app.current_tenant porque flit_qa_app
// es NOBYPASSRLS (no puede borrar cross-tenant de una sola pasada).
//
// Uso (desde webapp/):  node --env-file=.env.local scripts/retention.mjs [días]
//   días: por defecto QA_RETENTION_DAYS o 90.
import fs from "node:fs";
import path from "node:path";
import pgmod from "pg";

const PG = pgmod.default ?? pgmod;
const days = Number(process.argv[2] || process.env.QA_RETENTION_DAYS || 90);
const dataDir = path.resolve(process.cwd(), "data");

async function main() {
  const url = process.env.CONTROL_PLANE_URL;
  if (!url) {
    console.error("✗ Falta CONTROL_PLANE_URL");
    process.exit(2);
  }
  if (!Number.isFinite(days) || days < 1) {
    console.error(`✗ días inválido: ${process.argv[2]}`);
    process.exit(2);
  }
  const pool = new PG.Pool({ connectionString: url });
  const tenants = (await pool.query("SELECT id FROM tenants")).rows;
  let purged = 0;
  for (const { id } of tenants) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant', $1, true)", [id]);
      const r = await c.query(
        "DELETE FROM runs WHERE created_at < now() - make_interval(days => $1) RETURNING id",
        [days],
      );
      await c.query("COMMIT");
      for (const row of r.rows) {
        try {
          fs.rmSync(path.join(dataDir, "tenants", id, "evidence", row.id), {
            recursive: true,
            force: true,
          });
        } catch {
          /* la evidencia en disco es best-effort */
        }
      }
      purged += r.rowCount ?? 0;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      console.error(`tenant ${id}: ${e.message}`);
    } finally {
      c.release();
    }
  }
  await pool.end();
  console.log(`✓ Purgados ${purged} run(s) > ${days} días en ${tenants.length} tenant(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
