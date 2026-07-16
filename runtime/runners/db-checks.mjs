// db-checks.mjs — verificaciones DECLARATIVAS de la base del repo probado (SOLO LECTURA del catálogo).
//
// Principio (igual que las demás capas): el kit NO inventa el criterio, lo VALIDA. El repo declara qué
// debe cumplir su base en `qa-project.profile.yaml` bajo `db:` y acá se contrasta contra el catálogo real.
//   • Lo OPINABLE (aislamiento multitenant por RLS) NO se asume: sin declararlo el check se OMITE con la
//     línea exacta para activarlo — nunca se pinta en rojo algo que el proyecto no pidió.
//   • Lo UNIVERSAL (PK, UTF-8, secuencias, índices de FK) viene activo por defecto y se ajusta/apaga
//     desde el mismo `db:`.
//
// Corren sobre el MISMO `query` inyectado que la sonda (la BD del repo probado, vía túnel SSH si aplica),
// NUNCA la BD del kit. Best-effort: si una consulta falla, ese check se OMITE con aviso.
//
// Cada check devuelve un caso {name, status, message, plain, action}: `plain`/`action` son la explicación
// en lenguaje llano (🧩 qué pasó / 👉 qué hacer) que `failure-explain` deja pasar tal cual → las 4
// superficies (HU, MD, HTML, UX) muestran lo mismo. `message` queda como detalle técnico.

const list = (arr, n = 8) => arr.slice(0, n).join(", ") + (arr.length > n ? `, …(+${arr.length - n})` : "");
const emsg = (e) => String((e && e.message) || e || "error").replace(/\s+/g, " ").trim();

// Valores por defecto. `rls: null` = NO declarado → el check se omite (es criterio del proyecto).
// Los universales traen su modo por defecto: "fail" (bloquea) | "warn" (sugerencia) | "off" (no corre).
const DEFAULTS = {
  multitenant: { rls: null, tenant_column: "tenant_id", except: [] },
  schema: { primary_key: "fail", fk_indexes: "warn", encoding: "UTF8", fk_validated: "warn" },
  capacity: { sequences_max_pct: 80, report_top: 5 },
  privileges: { superuser: "warn" },
};

/** Resuelve la declaración del repo (`profile.db`) sobre los defaults. Puro. */
export function resolveDbSpec(profile = {}) {
  const d = (profile && profile.db) || {};
  return {
    multitenant: { ...DEFAULTS.multitenant, ...(d.multitenant || {}) },
    schema: { ...DEFAULTS.schema, ...(d.schema || {}) },
    capacity: { ...DEFAULTS.capacity, ...(d.capacity || {}) },
    privileges: { ...DEFAULTS.privileges, ...(d.privileges || {}) },
  };
}

// Traduce el modo declarado a un estado de caso ante una violación: "fail" → ❌, "warn" → ⏭ sugerencia.
const violation = (mode) => (String(mode) === "warn" ? "skip" : "fail");
const isOff = (mode) => String(mode) === "off" || mode === false;

// (1) Aislamiento multitenant por RLS — el criterio lo pone el CÓDIGO DEL REPO, no el kit ni el usuario.
// Se contrasta "lo que el código declara ↔ lo que la base tiene" (igual que el check de migraciones).
// Si el repo no declara RLS en ninguna parte, no aplica (no es hallazgo: ese proyecto no lo usa).
// Solo se exige lo que el proyecto pide: FORCE únicamente si su propio DDL lo usa.
async function checkRls(query, spec, declared) {
  const name = "Aislamiento por tenant (RLS)";
  const mt = spec.multitenant;
  if (isOff(mt.rls)) return null; // apagado explícitamente en el perfil (escape hatch)
  const dec = declared || { tables: [], force: false, files: 0 };
  if (!dec.tables.length) {
    return {
      name,
      status: "skip",
      message: "El código del repo no declara RLS en ningún archivo .sql/.cs.",
      plain: `Este proyecto no usa aislamiento por base de datos (RLS): en su código no hay ninguna tabla que lo habilite ni ninguna regla de acceso (policy). Por eso no se verifica — no es un hallazgo, simplemente no aplica a este proyecto.`,
      action: `Si creés que SÍ debería aislar los datos de cada cliente en la base, eso lo declara el equipo de desarrollo en su DDL/migraciones; en cuanto lo haga, esta verificación se activa sola.`,
    };
  }
  const rows = await query(
    `SELECT n.nspname AS sch, c.relname AS tbl, c.relrowsecurity AS en, c.relforcerowsecurity AS forced,
       EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) AS pol
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')`,
  );
  const actual = new Map();
  for (const r of rows || []) {
    actual.set(`${r.sch}.${r.tbl}`, r);
    if (!actual.has(r.tbl)) actual.set(r.tbl, r); // fallback: el código no siempre califica el esquema
  }
  const except = new Set((mt.except || []).map((t) => String(t).toLowerCase()));
  const label = (t) => (t.schema ? `${t.schema}.${t.name}` : t.name);
  const missing = [];
  const absent = [];
  let checked = 0;
  for (const t of dec.tables) {
    const key = label(t);
    if (except.has(key) || except.has(t.name)) continue;
    const a = t.schema ? actual.get(key) || actual.get(t.name) : actual.get(t.name);
    if (!a) { absent.push(key); continue; } // declarada en el código pero la tabla no está en la base
    checked++;
    if (!(a.en && a.pol && (!dec.force || a.forced))) missing.push(key);
  }
  const src = `${dec.tables.length} tabla(s) en ${dec.files} archivo(s) del repo`;
  const nota = absent.length ? ` · ${absent.length} declarada(s) que no existen en la base: ${list(absent, 4)}` : "";
  if (!checked && absent.length) {
    return {
      name, status: "fail",
      message: `${absent.length} tabla(s) declaradas con RLS no existen en la base: ${list(absent)}`,
      plain: `El código declara aislamiento por RLS para ${absent.length} tabla(s) que ni siquiera existen en esta base. La base no corresponde al código: probablemente le faltan las migraciones.`,
      action: `Aplicá las migraciones del proyecto contra esta base, o revisá que la conexión apunte a la base correcta.`,
    };
  }
  if (!missing.length) {
    return {
      name, status: "pass",
      message: `${checked} de ${src} con RLS activa${dec.force ? " y forzada" : ""} y con regla de acceso.${nota}`,
      plain: `El código de este proyecto declara que los datos de cada cliente se aíslan en la base misma, y la base cumple: las ${checked} tabla(s) declaradas tienen la protección activa. Aunque una consulta se olvide de filtrar por cliente, PostgreSQL no deja ver datos de otro.`,
    };
  }
  return {
    name, status: "fail",
    message: `${missing.length} de ${checked} tabla(s) declaradas sin RLS efectiva en la base: ${list(missing)}${nota}`,
    plain: `El código de este proyecto declara que los datos de cada cliente se aíslan en la base misma (lo declara para ${src}), pero la base NO lo cumple: ${missing.length} de ${checked} tabla(s) declaradas no tienen esa protección activa. Como la base no la aplica, cualquier consulta que se olvide de filtrar por cliente puede devolver datos de OTRO cliente. El código dice una cosa y la base tiene otra.`,
    action: `Aplicar contra esta base lo que el propio repo ya declara para esas tablas (habilitar la seguridad por fila${dec.force ? " en modo forzado" : ""} y crear su regla de acceso). Suele significar que faltan migraciones o que se aplicaron sin la parte de seguridad.`,
  };
}

// (2) Clave primaria por tabla — universal (activo por defecto; ajustable con db.schema.primary_key).
async function checkPk(query, spec) {
  const name = "Clave primaria por tabla";
  const mode = spec.schema.primary_key;
  if (isOff(mode)) return null;
  const rows = await query(
    `SELECT t.table_name AS tbl FROM information_schema.tables t
     WHERE t.table_type='BASE TABLE' AND t.table_schema NOT IN ('pg_catalog','information_schema')
       AND NOT EXISTS(SELECT 1 FROM information_schema.table_constraints tc
                      WHERE tc.table_schema=t.table_schema AND tc.table_name=t.table_name AND tc.constraint_type='PRIMARY KEY')`,
  );
  const bad = (rows || []).map((r) => r.tbl);
  if (!bad.length) return { name, status: "pass", message: "Todas las tablas tienen clave primaria.", plain: `Cada tabla tiene una clave primaria: la base puede distinguir una fila de otra, lo que evita duplicados y permite actualizarlas y replicarlas con seguridad.` };
  return {
    name,
    status: violation(mode),
    message: `${bad.length} tabla(s) sin clave primaria: ${list(bad)}`,
    plain: `${bad.length} tabla(s) no tienen clave primaria: la base no puede distinguir una fila de otra, así que se pueden colar registros duplicados y no hay forma segura de actualizar o replicar una fila puntual.`,
    action: `Agregá una clave primaria a esas tablas. Si alguna es intencionalmente sin PK (p. ej. una tabla de log append-only), apagá el check con «db.schema.primary_key: off» o bajalo a «warn».`,
  };
}

// (3) Índices en llaves foráneas — universal, por defecto SUGERENCIA (db.schema.fk_indexes).
async function checkFkIndex(query, spec) {
  const name = "Índices en llaves foráneas";
  const mode = spec.schema.fk_indexes;
  if (isOff(mode)) return null;
  const rows = await query(
    `SELECT conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c
     CROSS JOIN LATERAL unnest(c.conkey) AS k(n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n
     WHERE c.contype='f' AND connamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname IN ('pg_catalog','information_schema'))
       AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND (i.indkey::int2[])[0]=k.n)`,
  );
  const bad = (rows || []).map((r) => `${r.tbl}.${r.col}`);
  if (!bad.length) return { name, status: "pass", message: "Todas las llaves foráneas tienen un índice de apoyo.", plain: `Cada relación entre tablas tiene su índice de apoyo: los cruces (joins) y los borrados en cascada no tienen que recorrer la tabla entera.` };
  return {
    name,
    status: violation(mode),
    message: `${bad.length} llave(s) foránea(s) sin índice: ${list(bad)}`,
    plain: `${bad.length} relación(es) entre tablas no tienen índice de apoyo. No es un error: la base funciona igual, pero cada cruce o borrado en cascada sobre esas columnas obliga a recorrer la tabla completa y se vuelve lento a medida que crecen los datos.`,
    action: `Crear un índice sobre esas columnas. Es una mejora de rendimiento, no un bloqueo — subilo a bloqueante con «db.schema.fk_indexes: fail» o silencialo con «off».`,
  };
}

// (3b) Integridad referencial — restricciones (FK/CHECK) declaradas como NO VALIDADAS. Solo lectura del
// catálogo (barato, sin escanear datos): una restricción NOT VALID se aplica a las filas NUEVAS pero
// nunca comprobó las EXISTENTES → pueden quedar filas que violan la relación sin que la base lo note.
// Universal, por defecto SUGERENCIA (db.schema.fk_validated).
async function checkFkValidated(query, spec) {
  const name = "Integridad referencial (restricciones validadas)";
  const mode = spec.schema.fk_validated;
  if (isOff(mode)) return null;
  const rows = await query(
    `SELECT conrelid::regclass::text AS tbl, conname AS con, contype AS typ FROM pg_constraint c
     WHERE c.contype IN ('f','c') AND NOT c.convalidated
       AND connamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname IN ('pg_catalog','information_schema'))`,
  );
  const bad = (rows || []).map((r) => `${r.tbl}.${r.con}${r.typ === "f" ? " (FK)" : " (CHECK)"}`);
  if (!bad.length) return { name, status: "pass", message: "Todas las restricciones de integridad están validadas.", plain: `Las relaciones entre tablas y las reglas de validación (llaves foráneas y CHECK) están VALIDADAS contra los datos existentes: la base garantiza que no hay filas que las violen.` };
  return {
    name,
    status: violation(mode),
    message: `${bad.length} restricción(es) sin validar: ${list(bad)}`,
    plain: `${bad.length} restricción(es) de integridad están declaradas como NO VALIDADAS: la base las exige a los datos nuevos, pero NUNCA comprobó los que ya estaban. Puede haber filas viejas que violan la relación (p. ej. una llave foránea que apunta a un registro que no existe) sin que la base lo detecte.`,
    action: `Validá esas restricciones tras corregir los datos (ALTER TABLE … VALIDATE CONSTRAINT …). Si es intencional, bajá o apagá el check con «db.schema.fk_validated».`,
  };
}

// (4) Capacidad de secuencias — universal (db.capacity.sequences_max_pct).
async function checkSequences(query, spec) {
  const name = "Capacidad de secuencias";
  const pct = spec.capacity.sequences_max_pct;
  if (isOff(pct) || pct == null) return null;
  const limit = Number(pct);
  const rows = await query(
    `SELECT sequencename AS s, last_value::numeric AS last, max_value::numeric AS max
     FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema')`,
  );
  const near = (rows || []).filter((r) => r.last != null && Number(r.max) > 0 && (Number(r.last) / Number(r.max)) * 100 > limit).map((r) => r.s);
  if (!near.length) return { name, status: "pass", message: `${(rows || []).length} secuencia(s) por debajo del ${limit}% de su tope.`, plain: `Los contadores que generan los IDs están lejos de su valor máximo: no hay riesgo de que la base se quede sin identificadores nuevos.` };
  return {
    name,
    status: "fail",
    message: `${near.length} secuencia(s) por encima del ${limit}% de su tope: ${list(near)}`,
    plain: `${near.length} contador(es) de IDs pasó el ${limit}% de su valor máximo. Cuando llegue al tope, la base va a RECHAZAR toda inserción nueva en esa tabla — es una caída en producción con fecha, no un riesgo teórico.`,
    action: `Migrá esas columnas a «bigint» (o revisá por qué consumen IDs tan rápido). El umbral se ajusta con «db.capacity.sequences_max_pct».`,
  };
}

// (5) Codificación de la base — universal (db.schema.encoding).
async function checkEncoding(query, spec) {
  const name = "Codificación de la base";
  const want = spec.schema.encoding;
  if (isOff(want) || !want) return null;
  const rows = await query(`SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname=current_database()`);
  const enc = (rows && rows[0] && rows[0].enc) || "";
  const okEnc = String(enc).replace(/[-_]/g, "").toLowerCase() === String(want).replace(/[-_]/g, "").toLowerCase();
  if (okEnc) return { name, status: "pass", message: `Codificación ${enc} (declarada: ${want}).`, plain: `La base guarda el texto en ${enc}, tal como declara el proyecto: los acentos, las eñes y los emojis se almacenan y se leen sin corromperse.` };
  return {
    name,
    status: "fail",
    message: `Codificación «${enc || "desconocida"}», se declaró «${want}».`,
    plain: `La base guarda el texto en «${enc || "desconocida"}» pero el proyecto declaró «${want}». Con una codificación distinta, los acentos, las eñes y los emojis se guardan mal y aparecen como caracteres rotos.`,
    action: `Recrear la base con la codificación declarada (${want}) y recargar los datos, o corregir la declaración en «db.schema.encoding» si la base es correcta.`,
  };
}

// (6) Capacidad y tamaño — INFORMATIVO (nunca falla): dimensiona las tablas más grandes.
async function checkCapacity(query, spec) {
  const name = "Capacidad y tamaño (informativo)";
  const top = Number(spec.capacity.report_top || 5);
  if (top <= 0) return null;
  const rows = await query(
    `SELECT relname AS t, n_live_tup AS filas, pg_size_pretty(pg_total_relation_size(relid)) AS tam
     FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT ${top}`,
  );
  if (!rows || !rows.length) return { name, status: "pass", message: "Sin datos de tamaño (base vacía o sin estadísticas).", plain: `No hay estadísticas de tamaño todavía: la base está vacía o nunca se analizó.` };
  return {
    name,
    status: "pass",
    message: rows.map((r) => `${r.t} (${r.filas} filas, ${r.tam})`).join(" · "),
    plain: `Referencia de cuánto pesa hoy la base, para ver cómo crece entre corridas. Tablas más grandes: ${rows.map((r) => `${r.t} (${r.filas} filas, ${r.tam})`).join(" · ")}.`,
  };
}

// (7) Menor privilegio — el rol de la conexión NO debería ser SUPERUSUARIO. Solo lectura (pg_roles).
// Universal, por defecto SUGERENCIA (db.privileges.superuser). Es coherente con el check de RLS: un
// superusuario IGNORA la seguridad por fila, así que conectarse así anula el aislamiento por cliente.
async function checkSuperuser(query, spec) {
  const name = "Menor privilegio de la conexión";
  const mode = spec.privileges.superuser;
  if (isOff(mode)) return null;
  const rows = await query(`SELECT current_user AS usr, rolsuper AS super FROM pg_roles WHERE rolname = current_user`);
  const r = (rows && rows[0]) || {};
  const isSuper = r.super === true || r.super === "t" || r.super === "true";
  if (!isSuper) return { name, status: "pass", message: `El rol «${r.usr || "de la conexión"}» no es superusuario.`, plain: `La aplicación se conecta con un rol de permisos ACOTADOS (no superusuario): la seguridad por fila (RLS) sí lo limita y, ante una inyección SQL, el alcance del daño es limitado.` };
  return {
    name,
    status: violation(mode),
    message: `El rol «${r.usr || "de la conexión"}» es SUPERUSUARIO.`,
    plain: `La aplicación se conecta a la base con un rol de SUPERUSUARIO. Un superusuario puede leer, modificar o borrar cualquier cosa e IGNORA la seguridad por fila (RLS): si la app se conecta así, el aislamiento por cliente no protege nada y una vulnerabilidad de inyección tendría acceso TOTAL a la base.`,
    action: `Usá un rol de aplicación con los permisos mínimos (SELECT/INSERT/UPDATE/DELETE sobre sus tablas), NUNCA superusuario. Ajustá o silenciá con «db.privileges.superuser».`,
  };
}

const CHECKS = [
  { title: "Aislamiento por tenant (RLS)", run: checkRls },
  { title: "Menor privilegio de la conexión", run: checkSuperuser },
  { title: "Clave primaria por tabla", run: checkPk },
  { title: "Índices en llaves foráneas", run: checkFkIndex },
  { title: "Integridad referencial (restricciones validadas)", run: checkFkValidated },
  { title: "Capacidad de secuencias", run: checkSequences },
  { title: "Codificación de la base", run: checkEncoding },
  { title: "Capacidad y tamaño", run: checkCapacity },
];

/**
 * Corre las verificaciones (best-effort) → array de casos {name,status,message,plain,action}.
 * @param {(sql:string)=>Promise<any[]>} query  ejecutor SQL ligado a la BD del repo probado
 * @param {object} [profile]  perfil resuelto del repo (se lee `profile.db`)
 * @param {{rls?:{tables:Array,force:boolean,files:number}}} [declared]  lo que el CÓDIGO del repo declara
 *   sobre su base (ver db-declared.mjs). Es la fuente del criterio: sin esto el kit no opina.
 */
export async function runDeclaredChecks(query, profile = {}, declared = {}) {
  const spec = resolveDbSpec(profile);
  const out = [];
  for (const chk of CHECKS) {
    try {
      const r = await chk.run(query, spec, declared.rls);
      if (r) out.push(r); // null = el repo apagó el check en su declaración
    } catch (e) {
      out.push({
        name: chk.title,
        status: "skip",
        message: `No se pudo verificar: ${emsg(e)}`,
        plain: `Esta verificación no se pudo ejecutar contra la base (permiso insuficiente o vista del catálogo no disponible), así que no se sabe si cumple o no.`,
        action: `Revisá que el usuario de la conexión pueda leer el catálogo de PostgreSQL (pg_catalog / information_schema).`,
      });
    }
  }
  return out;
}

export default { runDeclaredChecks, resolveDbSpec };
