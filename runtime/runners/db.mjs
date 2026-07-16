// db.mjs — runner de la capa `db`. Ejecuta los checks de base de datos existentes
// (pgtap/prisma) y emite el EvidenceObject normalizado al sink.
// La CONEXIÓN viene SIEMPRE de env (DATABASE_URL / PG_CONNECTION / DB_CONNECTION), nunca
// cableada; el driver lo da qa-detect. _runner-core reenvía `env` al proceso hijo, así que
// CUALQUIER proyecto que exporte su conexión activa la capa sin tocar el kit. Si falta la
// conexión o el tooling, se OMITE con un aviso accionable (nunca aborta el ciclo).

import { runLayer } from "./_runner-core.mjs";
import { probePostgres, countMigrationsInCode } from "./db-probe.mjs";
import { scanDeclaredRls } from "./db-declared.mjs";

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
  // Si HAY conexión inyectada (toggle «usar BD configurada»), se aclara que esa conexión NO alimenta
  // esta capa —no hay runner de BD que ejecutar— sino las pruebas de integración de la capa `unit`
  // (p.ej. .NET leyendo ConnectionStrings): así el usuario no cree que «marqué BD y no hizo nada».
  migrations: ({ env }) => ({
    skip: dbUrl(env)
      ? "conexión detectada, pero el repo solo trae migrations/ (sin runner de BD como pgtap/prisma): la conexión se inyecta en las pruebas de integración de la capa unit, no como una capa db aparte"
      : "solo carpeta migrations/: sin runner db standalone — añade pgtap/prisma + conexión en env para activar db",
  }),
  testcontainers: () => ({ skip: "testcontainers corre dentro de la capa unit, no como check db aparte" }),
};

// Cuando la capa `db` se resolvería a `migrations` (no hay pgtap/prisma REAL que correr) PERO llega una
// sonda de Postgres inyectada (`pgQuery`), en vez de OMITIR se hace una VALIDACIÓN DIRECTA a la base:
// conecta, verifica estructura y contrasta migraciones código↔base (ver db-probe.mjs). Cumple el objetivo
// del usuario: "conectarme a Postgres directamente y evaluar la BD". pgtap/prisma reales → los corre runLayer.
async function maybeProbePostgres(opts) {
  const { detection, repoRoot = process.cwd(), env = {}, pgQuery, workItemId, profile = {} } = opts;
  if (typeof pgQuery !== "function") return null; // sin sonda inyectada → comportamiento previo (skip)
  if (detection?.layers?.db?.tool !== "migrations") return null; // pgtap/prisma → runLayer los ejecuta
  if (!dbUrl(env)) return null; // sin conexión → skip normal (mensaje consciente de la conexión)
  const migrationsInCode = countMigrationsInCode(repoRoot);
  // El criterio sale del CÓDIGO del repo probado, no del kit ni de una config del usuario: se lee qué
  // declara sobre su base (RLS/policies en su DDL o migraciones) y la sonda contrasta base↔código —
  // igual que el conteo de migraciones. Si el repo no declara nada, el check no aplica y se omite.
  const declared = { rls: scanDeclaredRls(repoRoot) };
  const res = await probePostgres({ query: pgQuery, migrationsInCode, profile, declared });
  const okCount = res.cases.filter((c) => c.status === "pass").length;
  const undecl = res.cases.filter((c) => c.status === "skip").length;
  const narrative = res.connected
    ? `Conexión directa a PostgreSQL: ${okCount} verificación(es) OK${res.status === "fail" ? " · con hallazgos" : ""}${undecl ? ` · ${undecl} sin declarar/omitida(s)` : ""}`
    : "No se pudo conectar a PostgreSQL";
  return [{ layer: "db", work_item_id: workItemId, status: res.status, narrative, cases: res.cases, metrics: { tool: "postgres-probe", cwd: "" } }];
}

/** @returns {Promise<import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]>} */
export async function runDbTests(opts = {}) {
  const probe = await maybeProbePostgres(opts);
  if (probe) return probe;
  return runLayer({ layer: "db", tools: TOOLS, ...opts });
}

export default { runDbTests };
