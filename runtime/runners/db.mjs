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

// Prioridad de qa-detect: pgtap > prisma > testcontainers > migrations.
const TOOLS = {
  pgtap: ({ env }) => {
    const conn = dbUrl(env);
    if (!conn) return { skip: NO_CONN };
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
