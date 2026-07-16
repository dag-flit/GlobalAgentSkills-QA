// db-env.mjs — construye las variables de entorno de conexión a BD para INYECTAR al proceso hijo
// de "QA del código" (las pruebas). PURO / offline: recibe una conexión YA RESUELTA (host/port; si
// hay túnel SSH, el llamador pasa el host/puerto LOCAL del túnel). No abre red ni túneles aquí.
//
// Cubre dos consumidores a la vez:
//   • la capa `db` del motor → DATABASE_URL / PG_CONNECTION / DB_CONNECTION (ver runners/db.mjs).
//   • las pruebas .NET (FLIT) → ConnectionStrings__Core / __DefaultConnection (formato Npgsql,
//     convención ASP.NET con doble guion bajo → pisa el appsettings.json del proyecto de test).
// Postgres es el caso primario (FLIT); mysql/mssql se cubren best-effort con DATABASE_URL.

function encAuth(user, password) {
  const e = encodeURIComponent;
  return password ? `${e(user)}:${e(password)}` : e(user);
}

// Npgsql/ADO: envuelve en comillas simples los valores con caracteres especiales (; ' " = espacio),
// duplicando la comilla interna. Sin esto, un password con `;` parte la cadena o inyecta parámetros.
function npg(v) {
  const s = String(v ?? "");
  return /[;'"=\s]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

/**
 * @param {object} c  conexión resuelta { engine, host, port, database, user, password, ssl, sslAllowSelfSigned }
 * @returns {Record<string,string>}  vars de entorno (vacío si falta host/user)
 */
export function buildDbEnv({ engine = "postgres", host, port, database = "", user, password = "", ssl = false, sslAllowSelfSigned = false } = {}) {
  if (!host || !user) return {}; // sin datos suficientes → no se inyecta nada (comportamiento actual)
  const out = {};
  if (engine === "postgres") {
    const url = `postgresql://${encAuth(user, password)}@${host}:${port}/${database}${ssl ? "?sslmode=require" : ""}`;
    out.DATABASE_URL = url;
    out.PG_CONNECTION = url;
    out.DB_CONNECTION = url;
    let npgStr = `Host=${npg(host)};Port=${port};Database=${npg(database)};Username=${npg(user)};Password=${npg(password)}`;
    if (ssl) npgStr += `;SSL Mode=Require;Trust Server Certificate=${sslAllowSelfSigned ? "true" : "false"}`;
    out.ConnectionStrings__Core = npgStr;
    out.ConnectionStrings__DefaultConnection = npgStr;
  } else if (engine === "mysql") {
    const url = `mysql://${encAuth(user, password)}@${host}:${port}/${database}`;
    out.DATABASE_URL = url;
    out.DB_CONNECTION = url;
  } else {
    // mssql: cadena clave=valor (no URL). Se deja en DATABASE_URL para consumidores .NET/ADO.
    out.DATABASE_URL =
      `Server=${host},${port};Database=${database};User Id=${user};Password=${password};` +
      `Encrypt=${ssl ? "true" : "false"};TrustServerCertificate=${sslAllowSelfSigned ? "true" : "false"}`;
  }
  return out;
}

export default { buildDbEnv };
