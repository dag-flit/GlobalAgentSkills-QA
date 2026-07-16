import type { AppConfig, DbConnection } from "@/lib/types";
import { resolveTarget } from "@/lib/db/dbClient";
import type { Tunnel } from "@/lib/db/sshTunnel";
import { importKit } from "./kit";

// Preparación de la BD configurada para una corrida de "QA del código" (opt-in). Extraído de runner.ts
// para respetar el límite de 400 líneas. Toma la conexión POR DEFECTO del módulo de BD (sea cual sea, con
// o sin SSH), abre el túnel si aplica, arma las variables de conexión para las pruebas de integración, y
// expone una SONDA directa a Postgres (pgQuery) para la capa `db`. Nada es específico a "QA": usa isDefault.

export interface DbInjection {
  env: Record<string, string>; // vars a mezclar en el entorno de las pruebas (DATABASE_URL, ConnectionStrings__*)
  pgQuery?: (sql: string) => Promise<any[]>; // ejecutor SQL directo (solo postgres); la conexión ya va ligada
  info: string; // mensaje para el log en vivo
  close: () => Promise<void>; // cierra cliente pg + túnel SSH (best-effort)
}

/**
 * Resuelve la conexión por defecto y prepara la inyección de BD. Devuelve null si NO hay una conexión
 * por defecto con host/usuario (el llamador emite el aviso). La contraseña (descifrada en el server) va
 * SOLO al proceso hijo / a la sonda; nunca al navegador.
 */
export async function setupConfiguredDb(cfg: AppConfig): Promise<DbInjection | null> {
  const db: DbConnection | undefined = cfg.databases.find((d) => d.isDefault) ?? cfg.databases[0];
  if (!db || !db.host || !db.user) return null;

  const resolved = await resolveTarget(db); // abre el túnel SSH si la conexión lo tiene activado
  const tunnel: Tunnel | undefined = resolved.tunnel;
  let pgClient: any; // se abre perezosamente en la 1ª consulta y se reusa; se cierra en close()

  const { buildDbEnv } = await importKit("runtime/source/db-env.mjs");
  const env: Record<string, string> = buildDbEnv({
    engine: db.engine,
    host: resolved.host,
    port: resolved.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    sslAllowSelfSigned: db.sslAllowSelfSigned,
  });

  // Sonda de la capa `db`: consulta directa a Postgres (a través del túnel si aplica). El motor decide QUÉ
  // SQL correr (db-probe.mjs); acá solo se ejecuta. Misma lógica SSL que "Probar conexión" → consistencia.
  let pgQuery: ((sql: string) => Promise<any[]>) | undefined;
  if (db.engine === "postgres") {
    pgQuery = async (sql: string) => {
      if (!pgClient) {
        const pgMod: any = await import("pg");
        const PG = pgMod.default ?? pgMod;
        const client = new PG.Client({
          host: resolved.host,
          port: resolved.port,
          user: db.user,
          password: db.password,
          database: db.database,
          ssl: db.ssl ? { rejectUnauthorized: !db.sslAllowSelfSigned } : undefined,
          connectionTimeoutMillis: 12000,
        });
        await client.connect(); // si falla (p.ej. 28P01), pgClient queda undefined → close() no-op
        pgClient = client;
      }
      const r = await pgClient.query(sql);
      return r.rows;
    };
  }

  const info = `Usando la BD configurada «${db.name}» (${db.host}:${db.port}/${db.database}${db.ssh?.enabled ? " · vía SSH" : ""}) en las pruebas.`;
  const close = async () => {
    try { await pgClient?.end(); } catch { /* cierre del cliente pg best-effort */ }
    try { tunnel?.close(); } catch { /* cierre del túnel SSH best-effort */ }
  };

  return { env, pgQuery, info, close };
}
