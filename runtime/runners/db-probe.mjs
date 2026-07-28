// db-probe.mjs — VALIDACIÓN DIRECTA de PostgreSQL para la capa `db` cuando el repo no trae un runner
// de BD ejecutable (pgtap/prisma) sino solo `migrations/`. En vez de omitir, si hay una conexión
// configurada CONECTA a Postgres y verifica lo esencial: (1) conectividad real, (2) que la base tenga
// estructura (tablas), (3) que las migraciones DECLARADAS en el código estén APLICADAS en la base
// (contrasta contra la tabla de control — EF Core `__EFMigrationsHistory`, Flyway, Prisma, etc.).
//
// El acceso a Postgres es INYECTABLE (`query(sql) => Promise<rows[]>`): en la webapp lo respalda `pg`
// (con el host/puerto ya resueltos, incluido el túnel SSH); el smoke inyecta una función falsa → todo
// offline-testable. Es SOLO LECTURA (SELECT sobre catálogo/tabla de control): sin DDL/DML, seguro.

import fs from "node:fs";
import path from "node:path";
import { runDeclaredChecks } from "./db-checks.mjs";

// Nombres de tabla de control de migraciones más comunes por ecosistema (el primero que exista gana).
// Drizzle usa `__drizzle_migrations` (por defecto en el esquema `drizzle`): como la búsqueda es por
// `information_schema.tables` sin fijar esquema, se encuentra igual y el conteo usa su `table_schema` real.
const TRACKING_TABLES = ["__EFMigrationsHistory", "flyway_schema_history", "_prisma_migrations", "__drizzle_migrations", "schema_migrations", "pgmigrations", "changelog"];

function msg(e) {
  return String((e && e.message) || e || "error").replace(/\s+/g, " ").trim();
}

// Cuenta las migraciones DECLARADAS en el código (para contrastar con las aplicadas en la base).
// Soporta EF Core (`<timestamp>_Nombre.cs`, ignora `.Designer.cs` y el ModelSnapshot) y SQL suelto.
export function countMigrationsInCode(repoRoot, { maxDepth = 7 } = {}) {
  const SKIP = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".vs"]);
  let sql = 0;
  let ef = 0;
  function walk(dir, depth, inMig) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
        walk(path.join(dir, e.name), depth + 1, inMig || /^migrations$/i.test(e.name));
      } else if (inMig && e.isFile()) {
        if (/\.sql$/i.test(e.name)) sql++;
        else if (/^\d{6,}_.+\.cs$/.test(e.name) && !/\.designer\.cs$/i.test(e.name) && !/snapshot/i.test(e.name)) ef++;
      }
    }
  }
  walk(repoRoot, 0, false);
  return { count: sql + ef, style: ef > 0 ? "ef" : sql > 0 ? "sql" : "none" };
}

/**
 * Sondea Postgres: 3 verificaciones base (conectividad, estructura, migraciones) + las DECLARADAS
 * por el repo en `profile.db` (ver db-checks.mjs). Cada una = un "caso" del reporte, con `plain`/`action`
 * (🧩 qué pasó / 👉 qué hacer) para que HU, MD, HTML y UX muestren lo mismo.
 * @param {object} opts
 * @param {(sql:string)=>Promise<any[]>} opts.query  ejecutor de SQL inyectable (conexión ya ligada)
 * @param {{count:number,style:string}} [opts.migrationsInCode]  migraciones declaradas en el repo
 * @param {object} [opts.profile]  perfil resuelto del repo probado (se lee `profile.db`)
 * @returns {Promise<{status:'pass'|'fail', connected:boolean, cases:object[]}>}
 */
export async function probePostgres({ query, migrationsInCode = { count: 0, style: "none" }, profile = {}, declared = {} } = {}) {
  const cases = [];

  // (1) Conectividad — el objetivo central: conectar a Postgres DIRECTAMENTE. Si esto falla, el resto
  // no aplica (y el mensaje del driver —p.ej. 28P01 clave inválida— queda visible para diagnosticar).
  let version = "";
  try {
    const rows = await query("SELECT version() AS v");
    version = (rows && rows[0] && (rows[0].v ?? rows[0].version)) || "PostgreSQL";
    cases.push({ name: "Conexión directa a PostgreSQL", status: "pass", message: version, plain: `Se conectó a la base con las credenciales configuradas y respondió: ${version}. La base existe, está levantada y acepta la conexión.` });
  } catch (e) {
    cases.push({
      name: "Conexión directa a PostgreSQL",
      status: "fail",
      message: msg(e),
      plain: `No se pudo conectar a la base con la conexión configurada, así que ninguna verificación de base de datos pudo ejecutarse. El motivo exacto lo da el driver en el detalle técnico.`,
      action: `Revisá que la base esté levantada y que el host/puerto/usuario/clave de la conexión sean los correctos (el código 28P01 significa "contraseña incorrecta"; "connection refused" = nadie escucha en ese puerto).`,
    });
    return { status: "fail", connected: false, cases };
  }

  // (2) Estructura — ¿la base tiene tablas de usuario? (existe y está poblada de esquema).
  try {
    const rows = await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
    const n = rows && rows[0] ? Number(rows[0].n) : 0;
    cases.push(
      n > 0
        ? { name: "Estructura de la base", status: "pass", message: `${n} tabla(s) de usuario.`, plain: `La base tiene ${n} tabla(s) creadas: no está vacía, el esquema del proyecto está aplicado.` }
        : {
            name: "Estructura de la base",
            status: "fail",
            message: "0 tablas de usuario.",
            plain: `La base no tiene ninguna tabla: está vacía. Cualquier prueba que lea o escriba datos va a fallar.`,
            action: `Aplicá las migraciones del proyecto contra esta base, o revisá que la conexión apunte a la base correcta (puede estar apuntando a una vacía).`,
          },
    );
  } catch (e) {
    cases.push({ name: "Estructura de la base", status: "skip", message: msg(e), plain: `No se pudo leer el esquema de la base, así que no se sabe si tiene tablas.`, action: `Revisá que el usuario de la conexión pueda leer «information_schema».` });
  }

  // (3) Migraciones aplicadas vs declaradas — busca la tabla de control y compara.
  try {
    const inList = TRACKING_TABLES.map((t) => `'${t}'`).join(",");
    const found = await query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN (${inList}) LIMIT 1`);
    const inCode = migrationsInCode.count;
    if (found && found.length) {
      const schema = found[0].table_schema || "public";
      const table = found[0].table_name;
      const cnt = await query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
      const applied = cnt && cnt[0] ? Number(cnt[0].n) : 0;
      if (inCode > 0 && applied < inCode) {
        cases.push({
          name: "Migraciones al día",
          status: "fail",
          message: `código: ${inCode} · base: ${applied} (tabla «${table}»)`,
          plain: `La base está DESACTUALIZADA respecto al código: el repo trae ${inCode} migración(es) y la base solo tiene ${applied} aplicada(s), o sea faltan ${inCode - applied}. Las tablas o columnas que agregan esas migraciones NO existen todavía, así que todo lo que dependa de ellas va a fallar.`,
          action: `Aplicá las migraciones pendientes contra esta base (p. ej. «dotnet ef database update» o el comando de migración del proyecto) y volvé a correr.`,
        });
      } else {
        cases.push({ name: "Migraciones al día", status: "pass", message: `${applied} aplicada(s)${inCode ? ` / ${inCode} en código` : ""} (tabla «${table}»)`, plain: `La base está al día con el código: tiene ${applied} migración(es) aplicada(s)${inCode ? ` y el repo declara ${inCode}` : ""}, así que el esquema que ven las pruebas es el que el código espera.` });
      }
    } else if (inCode > 0) {
      cases.push({
        name: "Migraciones al día",
        status: "skip",
        message: `${inCode} migración(es) ${migrationsInCode.style.toUpperCase()} en el código; sin tabla de control en la base.`,
        plain: `El repo trae ${inCode} migración(es) pero la base no tiene la tabla donde se anota cuáles se aplicaron, así que no hay forma de saber si el esquema está al día.`,
        action: `Si el proyecto usa migraciones, aplicalas con su herramienta (crea la tabla de control). Si administra el esquema de otra forma, ignorá este punto.`,
      });
    }
  } catch (e) {
    cases.push({ name: "Migraciones al día", status: "skip", message: msg(e), plain: `No se pudo verificar el estado de las migraciones contra la base.`, action: `Revisá los permisos de lectura del usuario de la conexión.` });
  }

  // (4+) Verificaciones contra lo que el propio CÓDIGO del repo declara (`declared`, ver db-declared.mjs)
  // + los universales ajustables por `profile.db` — solo lectura del catálogo, best-effort.
  try {
    cases.push(...(await runDeclaredChecks(query, profile, declared)));
  } catch (e) {
    cases.push({ name: "Verificaciones declaradas de BD", status: "skip", message: msg(e), plain: `No se pudieron correr las verificaciones declaradas de base de datos.` });
  }

  return { status: cases.some((c) => c.status === "fail") ? "fail" : "pass", connected: true, cases };
}

export default { probePostgres, countMigrationsInCode };
