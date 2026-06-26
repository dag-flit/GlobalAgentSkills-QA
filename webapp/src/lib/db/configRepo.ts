import type { PoolClient } from "pg";
import { query } from "./pool";
import { withSystem } from "./tx";
import { encryptDb, decryptDb, encryptTracker, decryptTracker } from "./secretsMapper";
import type { AppConfig, DbConnection, TrackerConfig } from "@/lib/types";

// Repositorio de configuración: databases (una fila por conexión) + tracker (singleton).
// Reemplaza data/config.json. Los secretos viajan en claro POR AHORA (F4 los cifra).

function rowToDb(r: any): DbConnection {
  return {
    id: r.id,
    name: r.name,
    engine: r.engine,
    host: r.host,
    port: r.port,
    database: r.database,
    user: r.db_user,
    password: r.password ?? "",
    ssl: r.ssl,
    sslAllowSelfSigned: r.ssl_allow_self_signed,
    ssh: r.ssh,
    isDefault: r.is_default,
  } as DbConnection;
}

/** Lee el estado persistido. `tracker` es null si el control-plane aún está vacío. */
export async function readConfig(): Promise<{
  databases: DbConnection[];
  tracker: TrackerConfig | null;
}> {
  const dbs = await query("SELECT * FROM db_connections ORDER BY sort_order, id");
  const tc = await query("SELECT selected, azure, github, jira FROM tracker_config WHERE id = 1");
  const t = tc.rows[0];
  const tracker = t
    ? ({ selected: t.selected, azure: t.azure, github: t.github, jira: t.jira } as TrackerConfig)
    : null;
  // Descifra los secretos antes de devolver (el resto del código ve texto plano).
  return {
    databases: dbs.rows.map(rowToDb).map(decryptDb),
    tracker: tracker ? decryptTracker(tracker) : null,
  };
}

async function upsertDb(c: PoolClient, db: DbConnection, order: number): Promise<void> {
  await c.query(
    `INSERT INTO db_connections
       (id,name,engine,host,port,database,db_user,password,ssl,ssl_allow_self_signed,ssh,is_default,sort_order,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (id) DO UPDATE SET
       name=$2,engine=$3,host=$4,port=$5,database=$6,db_user=$7,password=$8,ssl=$9,
       ssl_allow_self_signed=$10,ssh=$11,is_default=$12,sort_order=$13,updated_at=now()`,
    [
      db.id, db.name, db.engine, db.host, db.port, db.database, db.user, db.password ?? "",
      db.ssl, db.sslAllowSelfSigned ?? false, JSON.stringify(db.ssh ?? {}), db.isDefault, order,
    ],
  );
}

/** Persiste toda la config en una transacción: tracker singleton + sync de databases. */
export async function writeConfig(cfg: AppConfig): Promise<void> {
  await withSystem(async (c) => {
    // Cifra los secretos antes de persistir (la fila en Postgres nunca los tiene en claro).
    const t = encryptTracker(cfg.tracker);
    await c.query(
      `INSERT INTO tracker_config (id, selected, azure, github, jira, updated_at)
       VALUES (1, $1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET selected=$1, azure=$2, github=$3, jira=$4, updated_at=now()`,
      [t.selected, JSON.stringify(t.azure), JSON.stringify(t.github), JSON.stringify(t.jira)],
    );
    const ids = cfg.databases.map((d) => d.id);
    if (ids.length) await c.query("DELETE FROM db_connections WHERE NOT (id = ANY($1))", [ids]);
    else await c.query("DELETE FROM db_connections");
    for (let i = 0; i < cfg.databases.length; i++) await upsertDb(c, encryptDb(cfg.databases[i]), i);
  });
}
