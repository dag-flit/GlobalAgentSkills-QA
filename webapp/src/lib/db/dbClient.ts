import type { DbConnection } from "../types";
import { openSshTunnel, type Tunnel } from "./sshTunnel";

/** Parámetros efectivos del intento (sin exponer la contraseña). */
export interface DbTarget {
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  hasPassword: boolean;
  /** La contraseña efectiva tiene espacios al inicio/final (probable error de pegado). */
  passwordHasEdgeSpaces: boolean;
  /** La conexión se hace a través de un túnel SSH. */
  viaSsh: boolean;
}

export interface DbTestResult {
  ok: boolean;
  serverVersion?: string;
  message: string;
  durationMs: number;
  target: DbTarget;
}

/** Host/puerto a los que el driver se conecta realmente (local si hay túnel). */
interface ResolvedTarget {
  host: string;
  port: number;
  tunnel?: Tunnel;
}

async function resolveTarget(db: DbConnection): Promise<ResolvedTarget> {
  if (db.ssh?.enabled) {
    const tunnel = await openSshTunnel(db);
    return { host: tunnel.localHost, port: tunnel.localPort, tunnel };
  }
  return { host: db.host, port: db.port };
}

/** Extrae un mensaje legible de errores variados (incluye AggregateError). */
export function errorMessage(e: any): string {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  if (Array.isArray(e.errors) && e.errors.length) {
    return e.errors.map((x: any) => x?.message || x?.code || String(x)).join("; ");
  }
  if (e.code) return String(e.code);
  return String(e);
}

// ---------- versión por motor ----------

async function pgVersion(db: DbConnection, host: string, port: number): Promise<string> {
  const pgMod: any = await import("pg");
  const PG = pgMod.default ?? pgMod;
  const client = new PG.Client({
    host,
    port,
    user: db.user,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: !db.sslAllowSelfSigned } : undefined,
    connectionTimeoutMillis: 12000,
  });
  await client.connect();
  try {
    const r = await client.query("SELECT version() AS v");
    return r.rows?.[0]?.v ?? "PostgreSQL";
  } finally {
    await client.end();
  }
}

async function mysqlVersion(db: DbConnection, host: string, port: number): Promise<string> {
  const mysqlMod: any = await import("mysql2/promise");
  const mysql = mysqlMod.default ?? mysqlMod;
  const conn = await mysql.createConnection({
    host,
    port,
    user: db.user,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: !db.sslAllowSelfSigned } : undefined,
    connectTimeout: 12000,
  });
  try {
    const [rows]: any = await conn.query("SELECT VERSION() AS v");
    return rows?.[0]?.v ?? "MySQL";
  } finally {
    await conn.end();
  }
}

async function mssqlVersion(db: DbConnection, host: string, port: number): Promise<string> {
  const sqlMod: any = await import("mssql");
  const sql = sqlMod.default ?? sqlMod;
  const pool = new sql.ConnectionPool({
    server: host,
    port,
    user: db.user,
    password: db.password,
    database: db.database,
    options: { encrypt: db.ssl, trustServerCertificate: !!db.sslAllowSelfSigned },
    connectionTimeout: 12000,
  });
  await pool.connect();
  try {
    const r = await pool.request().query("SELECT @@VERSION AS v");
    return r.recordset?.[0]?.v ?? "SQL Server";
  } finally {
    await pool.close();
  }
}

/** Prueba la conexión a la BD y devuelve la versión del servidor. */
export async function testDbConnection(db: DbConnection): Promise<DbTestResult> {
  const start = Date.now();
  const target: DbTarget = {
    engine: db.engine,
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    ssl: db.ssl,
    hasPassword: Boolean(db.password),
    passwordHasEdgeSpaces: Boolean(db.password) && db.password !== db.password.trim(),
    viaSsh: Boolean(db.ssh?.enabled),
  };
  let resolved: ResolvedTarget | undefined;
  try {
    resolved = await resolveTarget(db);
    let version: string;
    if (db.engine === "postgres") version = await pgVersion(db, resolved.host, resolved.port);
    else if (db.engine === "mysql") version = await mysqlVersion(db, resolved.host, resolved.port);
    else version = await mssqlVersion(db, resolved.host, resolved.port);
    return {
      ok: true,
      serverVersion: version,
      message: "Conexión exitosa",
      durationMs: Date.now() - start,
      target,
    };
  } catch (e: any) {
    return { ok: false, message: errorMessage(e), durationMs: Date.now() - start, target };
  } finally {
    resolved?.tunnel?.close();
  }
}

/**
 * Cadena de conexión que el runner `db` del kit consume vía env
 * (DATABASE_URL / PG_CONNECTION). Postgres y MySQL usan URL; SQL Server
 * usa una cadena de pares clave=valor.
 */
export function buildConnectionString(db: DbConnection): string {
  const enc = encodeURIComponent;
  const auth = db.password ? `${enc(db.user)}:${enc(db.password)}` : enc(db.user);
  if (db.engine === "postgres") {
    const q = db.ssl ? "?sslmode=require" : "";
    return `postgresql://${auth}@${db.host}:${db.port}/${db.database}${q}`;
  }
  if (db.engine === "mysql") {
    return `mysql://${auth}@${db.host}:${db.port}/${db.database}`;
  }
  // mssql
  return `Server=${db.host},${db.port};Database=${db.database};User Id=${db.user};Password=${db.password};Encrypt=${db.ssl};TrustServerCertificate=true`;
}
