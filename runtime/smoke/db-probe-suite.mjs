// db-probe-suite.mjs — casos de la SONDA DIRECTA a Postgres (capa db). Extraído de code-suite para no
// pasar el guardrail de 400 líneas. Con una conexión + `pgQuery` inyectado, la capa db CONECTA a Postgres
// y valida (conectividad + estructura + migraciones código↔base) en vez de omitir. Todo offline (pgQuery falso).

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectRepo } from "../detect/qa-detect.mjs";
import { runDbTests } from "../runners/db.mjs";
import { countMigrationsInCode } from "../runners/db-probe.mjs";
import { explainFailure } from "../evidence/failure-explain.mjs";

export async function runDbProbeCases(ctx) {
  const { ok } = ctx;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "qa-db-probe-"));
  try {
    fs.mkdirSync(path.join(base, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(base, "migrations", "0001_init.sql"), "CREATE TABLE t();", "utf8");
    const det = detectRepo({ repoRoot: base });
    assert.strictEqual(det.layers.db.enabled, true, "migrations/ enciende la capa db (tool=migrations)");

    // Cuenta las migraciones declaradas en el código (SQL suelto y EF Core).
    assert.strictEqual(countMigrationsInCode(base).count, 1, "cuenta 1 migración .sql declarada en el repo");
    fs.mkdirSync(path.join(base, "ef", "Migrations"), { recursive: true });
    fs.writeFileSync(path.join(base, "ef", "Migrations", "20260101_Init.cs"), "// mig", "utf8");
    fs.writeFileSync(path.join(base, "ef", "Migrations", "20260101_Init.Designer.cs"), "// designer (ignorado)", "utf8");
    assert.strictEqual(countMigrationsInCode(base).count, 2, "suma la migración EF (ignora .Designer.cs)");

    // pgQuery FALSO (offline): simula el catálogo de Postgres según el escenario (incluye las
    // verificaciones automáticas: RLS, PK, FK, secuencias, encoding, capacidad).
    const fakePg = (scenario) => async (sql) => {
      if (/version\(\)/.test(sql)) { if (scenario === "authfail") throw new Error('password authentication failed for user "postgres"'); return [{ v: "PostgreSQL 16.2" }]; }
      if (/information_schema\.tables WHERE table_schema NOT IN/.test(sql)) return [{ n: 30 }];
      // Tabla de control de migraciones: Drizzle la publica como `drizzle.__drizzle_migrations`; el resto
      // de ecosistemas (EF) en `public`. La sonda debe reconocer AMBAS (no es EF/Flyway/Prisma).
      if (/table_name IN/.test(sql)) return scenario === "drizzle"
        ? [{ table_schema: "drizzle", table_name: "__drizzle_migrations" }]
        : [{ table_schema: "public", table_name: "__EFMigrationsHistory" }];
      if (/FROM "drizzle"\."__drizzle_migrations"/.test(sql)) return [{ n: 2 }];
      if (/count\(\*\)::int AS n FROM "public"/.test(sql)) return [{ n: scenario === "behind" ? 0 : 5 }];
      if (/pg_encoding_to_char/.test(sql)) return [{ enc: "UTF8" }];
      // Rol de la conexión (menor privilegio): superusuario solo en el escenario "superuser".
      if (/rolsuper AS super/.test(sql)) return [{ usr: scenario === "superuser" ? "postgres" : "app_user", super: scenario === "superuser" }];
      // Integridad referencial (restricciones sin validar): una FK NOT VALID solo en "notvalid".
      if (/NOT c\.convalidated/.test(sql)) return scenario === "notvalid" ? [{ tbl: "public.orders", con: "orders_customer_fk", typ: "f" }] : [];
      if (/relforcerowsecurity/.test(sql)) {
        if (scenario === "rlsgap") return [{ sch: "public", tbl: "orders", en: false, forced: false, pol: false }];
        if (scenario === "rlsok") return [{ sch: "public", tbl: "orders", en: true, forced: false, pol: true }];
        return [];
      }
      return [];
    };
    const env = { DATABASE_URL: "postgres://u:p@localhost/db" };

    const dbOk = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("ok"), workItemId: "local" });
    assert.strictEqual(dbOk[0].metrics.tool, "postgres-probe", "con pgQuery → sonda directa (no skip)");
    assert.strictEqual(dbOk[0].status, "pass", "conecta + tiene tablas + migraciones al día + checks OK → pass");
    assert.ok(dbOk[0].cases.some((c) => /Conexi.n directa a PostgreSQL/.test(c.name) && c.status === "pass"), "verifica conectividad directa");
    assert.ok(dbOk[0].cases.some((c) => /Estructura de la base/.test(c.name) && /30 tabla/.test(c.message)), "reporta la estructura (nº de tablas)");
    // Universales (PK/encoding/secuencias): activos por defecto SIN declarar nada.
    assert.ok(dbOk[0].cases.some((c) => /Codificaci.n de la base/.test(c.name) && c.status === "pass"), "los checks universales corren por defecto (encoding OK)");
    // Cada caso trae su propia explicación → las 4 superficies muestran 🧩/👉 sin repetir texto.
    const conn = dbOk[0].cases.find((c) => /Conexi.n directa/.test(c.name));
    assert.ok(conn.plain && /PostgreSQL 16\.2/.test(conn.plain), "el caso emite `plain` (explicación en lenguaje llano)");
    assert.deepStrictEqual(
      explainFailure(conn, { layer: "db" }),
      { category: "declared", plain: conn.plain, action: undefined },
      "failure-explain deja pasar la explicación del propio check (pass-through)",
    );

    // AUTÓNOMO — el criterio sale del CÓDIGO del repo, no de una config. Este repo no declara RLS en
    // ninguna parte → el check NO aplica (no es hallazgo: ese proyecto no usa RLS). El kit no opina.
    const rlsUndeclared = dbOk[0].cases.find((c) => /Aislamiento por tenant \(RLS\)/.test(c.name));
    assert.strictEqual(rlsUndeclared.status, "skip", "el repo no declara RLS → no se asume (skip, ni verde ni rojo)");
    assert.ok(/no usa aislamiento por base de datos/.test(rlsUndeclared.plain), "explica que no aplica a ese proyecto (no pide configurar nada)");

    // AUTÓNOMO — un repo cuyo DDL SÍ declara RLS: el kit lo detecta solo y contrasta base↔código.
    const rlsRepo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-db-rls-"));
    try {
      fs.mkdirSync(path.join(rlsRepo, "migrations"), { recursive: true });
      fs.writeFileSync(path.join(rlsRepo, "migrations", "0001_init.sql"), "CREATE TABLE orders();", "utf8");
      fs.mkdirSync(path.join(rlsRepo, "ddl"), { recursive: true });
      fs.writeFileSync(
        path.join(rlsRepo, "ddl", "rls.sql"),
        `ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_iso ON orders USING (tenant_id = current_setting('app.tenant'));`,
        "utf8",
      );
      const rlsDet = detectRepo({ repoRoot: rlsRepo });

      // El código declara RLS para `orders` pero la base no la tiene → hallazgo REAL (código ≠ base).
      const dbRls = await runDbTests({ repoRoot: rlsRepo, detection: rlsDet, env, pgQuery: fakePg("rlsgap"), workItemId: "local" });
      const rlsCase = dbRls[0].cases.find((c) => /Aislamiento por tenant \(RLS\)/.test(c.name));
      assert.strictEqual(dbRls[0].status, "fail", "el código declara RLS y la base no lo cumple → fail");
      assert.ok(/orders/.test(rlsCase.message), "nombra la tabla desprotegida");
      assert.ok(/El código dice una cosa y la base tiene otra/.test(rlsCase.plain), "el hallazgo se funda en el código del repo, no en una opinión del kit");

      // La base SÍ cumple lo declarado → pass. El DDL de ejemplo NO usa FORCE, así que el check
      // tampoco lo exige: solo se verifica lo que el propio proyecto pide (nada inventado).
      const dbRlsOk = await runDbTests({ repoRoot: rlsRepo, detection: rlsDet, env, pgQuery: fakePg("rlsok"), workItemId: "local" });
      const okCase = dbRlsOk[0].cases.find((c) => /Aislamiento por tenant \(RLS\)/.test(c.name));
      assert.strictEqual(okCase.status, "pass", "RLS habilitada + policy (sin FORCE, que el repo no declara) → pass");

      // Escape hatch: una tabla global justificada se puede exceptuar desde el perfil del kit.
      const dbExcept = await runDbTests({
        repoRoot: rlsRepo, detection: rlsDet, env, pgQuery: fakePg("rlsgap"), workItemId: "local",
        profile: { db: { multitenant: { except: ["orders"] } } },
      });
      assert.ok(
        !dbExcept[0].cases.some((c) => /Aislamiento por tenant \(RLS\)/.test(c.name) && c.status === "fail"),
        "una tabla en `except` no cuenta como hallazgo de RLS",
      );
    } finally {
      fs.rmSync(rlsRepo, { recursive: true, force: true });
    }

    // DECLARATIVO — el repo puede apagar un check universal (no se inventa criterio sobre su base).
    const dbPkOff = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("ok"), workItemId: "local", profile: { db: { schema: { primary_key: "off" } } } });
    assert.ok(!dbPkOff[0].cases.some((c) => /Clave primaria/.test(c.name)), "un check apagado por declaración no corre ni aparece");

    // Checks NUEVOS (read-only, universales): en el escenario "ok" pasan (rol acotado + restricciones validadas).
    assert.ok(dbOk[0].cases.some((c) => /Menor privilegio/.test(c.name) && c.status === "pass"), "el rol no-superusuario → menor privilegio OK");
    assert.ok(dbOk[0].cases.some((c) => /Integridad referencial/.test(c.name) && c.status === "pass"), "sin restricciones NOT VALID → integridad referencial OK");
    // Menor privilegio: por defecto es SUGERENCIA (warn→skip); subido a bloqueante detecta el superusuario.
    const dbSuper = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("superuser"), workItemId: "local", profile: { db: { privileges: { superuser: "fail" } } } });
    const superCase = dbSuper[0].cases.find((c) => /Menor privilegio/.test(c.name));
    assert.ok(superCase.status === "fail" && /SUPERUSUARIO/.test(superCase.message) && superCase.plain && superCase.action, "conexión con superusuario → hallazgo con plain/action (ignora RLS)");
    // Integridad referencial: subida a bloqueante, nombra la restricción sin validar.
    const dbNotValid = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("notvalid"), workItemId: "local", profile: { db: { schema: { fk_validated: "fail" } } } });
    const nvCase = dbNotValid[0].cases.find((c) => /Integridad referencial/.test(c.name));
    assert.ok(nvCase.status === "fail" && /orders_customer_fk/.test(nvCase.message) && nvCase.plain, "restricción NOT VALID → hallazgo que la nombra, con explicación");
    ok("QA de código: checks de BD read-only nuevos (menor privilegio/superusuario + integridad referencial NOT VALID) — universales, ajustables, con plain/action en las 4 rutas");

    const dbBehind = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("behind"), workItemId: "local" });
    assert.strictEqual(dbBehind[0].status, "fail", "faltan migraciones (0 aplicadas < 2 en código) → fail");
    assert.ok(dbBehind[0].cases.some((c) => /Migraciones al d.a/.test(c.name) && c.status === "fail"), "señala migraciones pendientes por aplicar");

    // Drizzle ORM: su tabla de control es `drizzle.__drizzle_migrations` (no EF/Flyway/Prisma). La sonda
    // debe reconocerla y contrastar código↔base como con EF, en vez de caer a "sin tabla de control".
    const dbDrizzle = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("drizzle"), workItemId: "local" });
    const drz = dbDrizzle[0].cases.find((c) => /Migraciones al d.a/.test(c.name));
    assert.ok(drz && drz.status === "pass" && /__drizzle_migrations/.test(drz.message), "reconoce la tabla de control de Drizzle (drizzle.__drizzle_migrations) → migraciones al día, no 'sin tabla de control'");
    ok("QA de código: la sonda reconoce la tabla de control de Drizzle (__drizzle_migrations) además de EF/Flyway/Prisma → migraciones código↔base en repos Drizzle/Postgres");

    const dbAuth = await runDbTests({ repoRoot: base, detection: det, env, pgQuery: fakePg("authfail"), workItemId: "local" });
    assert.strictEqual(dbAuth[0].status, "fail", "auth falla → fail (no oculta el problema)");
    assert.ok(/password authentication/.test(dbAuth[0].cases[0].message), "surfacea el error real del driver (28P01)");

    // Sin pgQuery → NO sonda: cae al skip consciente de la conexión (comportamiento previo).
    const dbNoProbe = await runDbTests({ repoRoot: base, detection: det, env, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    assert.strictEqual(dbNoProbe[0].status, "skip", "sin pgQuery → skip (no intenta conectar)");
    ok("QA de código: sonda DIRECTA a Postgres (conectividad + estructura + migraciones código↔base; auth-fail se surface; sin pgQuery → skip)");
    ok("QA de código: checks de BD AUTÓNOMOS (el criterio sale del DDL del repo: sin RLS declarada no aplica; declarada+base incumple → hallazgo; no exige FORCE si el repo no lo usa; except + apagar un universal; cada caso trae su explicación → pass-through en las 4 superficies)");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

export default { runDbProbeCases };
