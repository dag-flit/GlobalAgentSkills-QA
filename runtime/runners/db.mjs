// db.mjs — runner de la capa `db`. Ejecuta los checks de base de datos existentes
// (pgtap/prisma) y emite el EvidenceObject normalizado al sink.
// La CONEXIÓN viene SIEMPRE de env (DATABASE_URL / PG_CONNECTION / DB_CONNECTION), nunca
// cableada; el driver lo da qa-detect. _runner-core reenvía `env` al proceso hijo, así que
// CUALQUIER proyecto que exporte su conexión activa la capa sin tocar el kit. Si falta la
// conexión o el tooling, se OMITE con un aviso accionable (nunca aborta el ciclo).

import { runLayer } from "./_runner-core.mjs";

// Variables de conexión soportadas (orden de preferencia). Cablear aquí NO una URL, sino
// SOLO los NOMBRES de var que el kit reconoce; el valor vive en el entorno del proyecto.
const CONN_ENV_VARS = ["DATABASE_URL", "PG_CONNECTION", "DB_CONNECTION"];
function dbUrl(env) {
  for (const k of CONN_ENV_VARS) if (env[k]) return env[k];
  return null;
}
const NO_CONN = `falta conexión en env (${CONN_ENV_VARS.join("/")}) — defínela para activar la capa db (la conexión nunca se cablea)`;

// Extrae el host de una cadena de conexión: URL (postgres/mysql `scheme://user:pass@host:port/db`)
// o pares clave=valor (mssql `Server=host,port;...`). Devuelve el host en minúsculas o null.
function connHost(conn) {
  if (!conn) return null;
  const url = String(conn).match(/^[a-z][a-z0-9+.-]*:\/\/[^/@]*@?([^:/?,;]+)/i);
  if (url) return url[1].toLowerCase();
  const kv = String(conn).match(/(?:Server|Host|Data\s*Source)\s*=\s*([^;,]+)/i);
  return kv ? kv[1].trim().toLowerCase() : null;
}

// Guardrail ANTI-PRODUCCIÓN (F2): pgtap ejecuta archivos .sql arbitrarios (posible DDL/DML).
// Si el host de la conexión parece de producción y NO hay un override explícito, se OMITE con
// aviso accionable. Hosts no-prod corren normal (no cambia el comportamiento previo). "Producción"
// se decide por el perfil: db.production_hosts (lista exacta) o db.production_patterns (regex);
// default conservador: hostnames que contienen "prod"/"produccion"/"production". El override es
// QA_DB_ALLOW_WRITE en el entorno (o profile.db.allow_write=true).
function dbWriteBlocked({ env = {}, profile, conn }) {
  if (env.QA_DB_ALLOW_WRITE) return null;
  const dbCfg = (profile && profile.db) || {};
  if (dbCfg.allow_write) return null;
  const host = connHost(conn);
  if (!host) return null;
  const hosts = (dbCfg.production_hosts || []).map((h) => String(h).toLowerCase());
  const patterns = (dbCfg.production_patterns || ["prod", "produccion", "production"]).map((p) => new RegExp(p, "i"));
  const isProd = hosts.includes(host) || patterns.some((re) => re.test(host));
  if (!isProd) return null;
  return `host '${host}' parece PRODUCCIÓN: la capa db ejecuta pgtap (posible DDL/DML) y se OMITE por seguridad. ` +
    `Exporta QA_DB_ALLOW_WRITE=1 (o profile.db.allow_write) para permitirlo, o ajusta profile.db.production_*.`;
}

// Prioridad de qa-detect: pgtap > prisma > testcontainers > migrations.
const TOOLS = {
  pgtap: ({ env, profile }) => {
    const conn = dbUrl(env);
    if (!conn) return { skip: NO_CONN };
    const blocked = dbWriteBlocked({ env, profile, conn });
    if (blocked) return { skip: blocked };
    return ["pg_prove", "-d", conn, "--recurse", "."];
  },
  // prisma lee la conexión de su propio env (DATABASE_URL); _runner-core reenvía `env` al
  // hijo. Guardamos igual que pgtap para dar un aviso accionable en vez de fallar opaco.
  prisma: ({ env }) => {
    if (!dbUrl(env)) return { skip: NO_CONN };
    return ["prisma", "migrate", "status"];
  },
  // migrations/ y testcontainers no tienen runner standalone: se omiten con aviso accionable.
  migrations: () => ({ skip: "solo carpeta migrations/: sin runner db standalone — añade pgtap/prisma + conexión en env para activar db" }),
  testcontainers: () => ({ skip: "testcontainers corre dentro de la capa unit, no como check db aparte" }),
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runDbTests(opts = {}) {
  return runLayer({ layer: "db", tools: TOOLS, ...opts });
}

export default { runDbTests };
