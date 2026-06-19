// db.mjs — runner de la capa `db`. Ejecuta los checks de base de datos existentes
// (pgtap/prisma) y emite el EvidenceObject normalizado al sink.
// La CONEXIÓN viene SIEMPRE de env (DATABASE_URL / PG_CONNECTION), nunca cableada;
// el driver lo da qa-detect. Si falta la conexión, se omite con aviso (no aborta).

import { runLayer } from "./_runner-core.mjs";

function dbUrl(env) {
  return env.DATABASE_URL || env.PG_CONNECTION || env.DB_CONNECTION || null;
}

// Prioridad de qa-detect: pgtap > prisma > testcontainers > migrations.
const TOOLS = {
  pgtap: ({ env }) => {
    const conn = dbUrl(env);
    if (!conn) return { skip: "falta DATABASE_URL/PG_CONNECTION en env (la conexión nunca se cablea)" };
    return ["pg_prove", "-d", conn, "--recurse", "."];
  },
  prisma: () => ["prisma", "migrate", "status"],
  // migrations/ y testcontainers no tienen runner standalone: se omiten con aviso.
  migrations: () => ({ skip: "solo carpeta migrations/: sin runner db standalone (usa pgtap/prisma)" }),
  testcontainers: () => ({ skip: "testcontainers corre dentro de la capa unit, no como check db aparte" }),
};

/** @returns {import("../../core/tracker-adapter/tracker-adapter.mjs").EvidenceObject[]} */
export function runDbTests(opts = {}) {
  return runLayer({ layer: "db", tools: TOOLS, ...opts });
}

export default { runDbTests };
