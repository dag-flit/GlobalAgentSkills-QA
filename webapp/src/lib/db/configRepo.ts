import type { PoolClient } from "pg";
import { withTenant } from "./tx";
import { encryptDb, decryptDb, encryptTracker, decryptTracker } from "./secretsMapper";
import type { AppConfig, DbConnection, TrackerConfig } from "@/lib/types";

// Repositorio de configuración POR TENANT: databases (una fila por conexión) + tracker (una
// fila por tenant). Toda lectura/escritura corre en withTenant → RLS aísla por tenant a
// nivel de BD; tenant_id se llena por DEFAULT desde el GUC (no se inserta a mano). Los
// secretos viajan cifrados (secretsMapper, AAD ligado al tenant).

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

/** Lee la config del tenant activo. `tracker` es null si aún no tiene fila. */
export async function readConfig(): Promise<{
  databases: DbConnection[];
  tracker: TrackerConfig | null;
}> {
  return withTenant(async (c) => {
    const dbs = await c.query("SELECT * FROM db_connections ORDER BY sort_order, id");
    const tc = await c.query("SELECT selected, azure, github, jira FROM tracker_config LIMIT 1");
    const t = tc.rows[0];
    const tracker = t
      ? ({ selected: t.selected, azure: t.azure, github: t.github, jira: t.jira } as TrackerConfig)
      : null;
    return {
      databases: dbs.rows.map(rowToDb).map(decryptDb),
      tracker: tracker ? decryptTracker(tracker) : null,
    };
  });
}

async function upsertDb(c: PoolClient, db: DbConnection, order: number): Promise<void> {
  await c.query(
    `INSERT INTO db_connections
       (id,name,engine,host,port,database,db_user,password,ssl,ssl_allow_self_signed,ssh,is_default,sort_order,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       name=$2,engine=$3,host=$4,port=$5,database=$6,db_user=$7,password=$8,ssl=$9,
       ssl_allow_self_signed=$10,ssh=$11,is_default=$12,sort_order=$13,updated_at=now()`,
    [
      db.id, db.name, db.engine, db.host, db.port, db.database, db.user, db.password ?? "",
      db.ssl, db.sslAllowSelfSigned ?? false, JSON.stringify(db.ssh ?? {}), db.isDefault, order,
    ],
  );
}

/** Persiste la config del tenant activo: tracker (1 fila) + sync de databases, en una tx. */
export async function writeConfig(cfg: AppConfig): Promise<void> {
  await withTenant(async (c) => {
    const t = encryptTracker(cfg.tracker);
    await c.query(
      `INSERT INTO tracker_config (selected, azure, github, jira, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET selected=$1, azure=$2, github=$3, jira=$4, updated_at=now()`,
      [t.selected, JSON.stringify(t.azure), JSON.stringify(t.github), JSON.stringify(t.jira)],
    );
    const ids = cfg.databases.map((d) => d.id);
    if (ids.length) await c.query("DELETE FROM db_connections WHERE NOT (id = ANY($1))", [ids]);
    else await c.query("DELETE FROM db_connections");
    for (let i = 0; i < cfg.databases.length; i++) await upsertDb(c, encryptDb(cfg.databases[i]), i);
  });
}
