# Webapp multitenant — guía de arquitectura, uso y extensión

> La webapp (`webapp/`, Next.js) pasó de herramienta local mono-usuario a **servicio
> multitenant** con PostgreSQL + Row-Level Security, autenticación propia y secretos cifrados.
> El **motor** (`core/`, `runtime/`, `adapters/`) NO cambió: sigue **offline y portable**.
> Esta guía resume qué se hizo (plan F0–F7), cómo se usa y cómo extenderlo sin romperlo.

## 1. Qué cambió (resumen del plan F0–F7)

| Fase | Cambio | Resultado |
|---|---|---|
| F0 | Guardrail de 400 líneas/archivo | Mantenibilidad (regla dura) |
| F1 | Refactor del motor | Cumplir F0 sin tocar comportamiento |
| F2 | Hardening del data-plane (anti-prod en runner `db`, pin npx, TLS mssql, git validado) | Menos superficie de ataque |
| F3 | Persistencia en **PostgreSQL** (antes archivos JSON) | Fin del *lost-update*; base multitenant |
| F4 | **Validación zod** + **cifrado AES-GCM** de secretos + anti path-traversal | Inputs confiables; secretos no en claro |
| F5 | **Auth propia** + tenant = organización + login/registro | Identidad |
| F6 | **Row-Level Security** forzada de extremo a extremo | Aislamiento real entre organizaciones |
| F7 | Limpieza de código muerto + aislamiento en disco + retención | Endurecimiento operativo |

**No se perdió ninguna función** del motor (correr capas static/unit/e2e/db/security/api/bdd,
trackers, evidencia, plan por HU, BDD). El smoke test del motor sigue en **42/42**.

## 2. Arquitectura

### Dos planos separados (no mezclar nunca)
- **Control-plane** (`CONTROL_PLANE_URL`): la BD del **servicio** — config, conexiones, runs,
  eventos, tenants, usuarios, sesiones. Es Postgres (rol `flit_qa_app`, NOBYPASSRLS).
- **Data-plane** (`DATABASE_URL`): la BD del **cliente** que el runner `db` prueba en cada
  corrida. Llega por env en la corrida; nada que ver con el control-plane.

### Aislamiento por tenant (RLS)
- Cada fila de datos lleva `tenant_id`. Las tablas `db_connections`, `tracker_config`, `runs`,
  `run_events` tienen **`FORCE ROW LEVEL SECURITY`** con una policy `tenant_isolation`
  (`USING` + `WITH CHECK`) que compara `tenant_id` con el GUC `app.current_tenant`.
- El tenant activo se fija por transacción con `SET LOCAL app.current_tenant` (helper
  `withTenant` en `lib/db/tx.ts`), leyendo el tenant del **contexto de la sesión**
  (`AsyncLocalStorage` en `lib/db/tenantContext.ts`), **nunca del input del usuario**.
- Las tablas de auth (`tenants`, `users`, `memberships`, `sessions`, `audit_log`) son
  **globales** (sin RLS).

### Autenticación
- Sesiones **opacas server-side**: el token va en cookie `HttpOnly`; en la BD solo su
  `sha256` (revocación inmediata). Contraseñas con **scrypt** (interfaz abstraída → migrable
  a argon2). Roles por tenant: `owner > admin > member > viewer`.
- `middleware.ts` (Edge, sin DB) hace el portón grueso: sin cookie → `/api` 401, páginas →
  `/login`. La validación real (sesión vigente, tenant, rol) la hacen los handlers con
  `requireAuth`/`requireTenant`/`requireRole` (`lib/auth/context.ts`).

### Secretos cifrados
- AES-256-GCM (`lib/security/secretsCrypto.ts`), formato `enc:1:<base64>`, **AAD =
  `<tenantId>:<campo>`** (liga el criptograma a su tenant y campo). La clave maestra está en
  `QA_KIT_MASTER_KEY` (env), con interfaz abstraída para migrar a KMS sin tocar call-sites.
- `lib/db/secretsMapper.ts` cifra/descifra en la frontera con la BD; el resto del código ve
  texto plano en memoria.

## 3. Puesta en marcha (local)

1. **PostgreSQL** corriendo (probado con PG18). Crear el control-plane: en pgAdmin, como
   superusuario, ejecutar `webapp/db/provision.sql` (crea la base `flit_qa_kit` + el rol
   `flit_qa_app`). Cambia el `CHANGE_ME` por una clave real.
2. **`webapp/.env.local`** (NO se commitea):
   ```
   CONTROL_PLANE_URL=postgresql://flit_qa_app:<clave>@localhost:5432/flit_qa_kit
   QA_KIT_MASTER_KEY=<32 bytes en base64>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
3. **Migraciones:** `cd webapp && node --env-file=.env.local db/migrate.mjs` (idempotente).
4. **Arrancar:** `cd webapp && npm run dev` → http://localhost:4312
5. **Primer ingreso:** la app exige login. No hay usuarios preexistentes → entra a
   **`/register`** ("Crear organización"): nombre de org + tu email + contraseña (mín. 8).
   Esa cuenta queda como **owner**. La contraseña se guarda hasheada (no recuperable; si se
   olvida, se resetea por BD).

> **Dos tipos de credenciales, no confundir:** el **login de la app** (lo creas en `/register`)
> es distinto de las credenciales de **infraestructura** (rol `flit_qa_app` en `.env.local`;
> superusuario `postgres` para pgAdmin).

## 4. Cómo extender SIN romper nada (playbook)

**Invariantes que no se negocian:**
1. Motor (`core/`/`runtime/`/`adapters/`) offline y portable: NO `pg`/auth/`tenant_id` ni
   literales de dominio. La multitenancy vive SOLO en `webapp/`.
2. Control-plane ≠ data-plane: nunca mezclar `CONTROL_PLANE_URL` y `DATABASE_URL`.
3. ≤400 líneas por archivo (`scripts/check-line-budget.mjs`; allowlist vacía).
4. Datos del tenant SOLO por `withTenant`/`withTenantScope` (nunca `query()` crudo).
5. Secretos SOLO por `secretsCrypto`/`secretsMapper`.
6. Inputs SOLO por zod (`lib/validation/schemas.ts`).

**Acción → camino:**
- **Ruta API que toca datos del tenant** → envolver en `withTenantScope(async (auth) => {…})`
  (`@/lib/auth/route`); validar el body con zod antes. El tenant sale de la sesión, no del input.
- **Tabla nueva con datos del tenant** → migración `000N_*.sql` (forward-only) con
  `tenant_id` + `ENABLE`/`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` (copiar de
  `db/migrations/0003_rls.sql`). Tablas globales/auth: sin RLS, usar `withSystem`.
- **Campo secreto nuevo** → añadirlo en `secretsMapper` (encrypt/decrypt).
- **Trabajo en background** (runner, colas) → re-abrir contexto con
  `runInTenant(snapshotTenantId, fn)` (no hay ALS tras responder). Ver `runner.startRun`.
- **Servir archivos** → solo bajo `tenantDir(tenantId)`/repoRoots de los runs del tenant y
  solo extensiones de evidencia (ver `artifacts/route.ts`).
- **Caché en memoria** → keyear por `tenantId` (un caché global filtra entre tenants).

**Gate de "terminado" (correr SIEMPRE):**
```bash
cd webapp && npx tsc --noEmit
node ../scripts/check-line-budget.mjs all      # 0 violaciones
node ../runtime/smoke-test.mjs                 # 42/42
```

> Nota: los errores de RLS de Postgres salen en español (code `42501`, "viola la política de
> seguridad de registros") — detectarlos por código, no por texto en inglés.

## 5. Mantenimiento

- **Retención:** `cd webapp && node --env-file=.env.local scripts/retention.mjs [días]`
  (default 90) purga por tenant los runs/eventos antiguos + su evidencia en disco. Cron-able.

## 6. Limitaciones conocidas para un despliegue *hosted* (no bloquean el uso local)

1. **Fuentes `local`-path:** en un servicio hosted deshabilitar las fuentes de filesystem
   local (usar solo git/explore); el repoRoot local apunta fuera de `tenantDir`.
2. **SSE/stop en memoria:** válido para 1 instancia. Escala horizontal → `LISTEN/NOTIFY`.
3. **Clave maestra en env:** migrar a un KMS por la interfaz abstraída de `secretsCrypto`.
4. **Tests de webapp:** la suite de aislamiento (AIS-01..08) se corrió manualmente; falta
   dejarla en `webapp/test/full-suite.mjs` + un CI que corra los 3 chequeos del gate.

## 7. Mapa de archivos nuevos (webapp/)

```
src/middleware.ts                     portón Edge (cookie + cabeceras de seguridad)
src/lib/auth/                          password (scrypt), session, context, cookie, route (withTenantScope)
src/lib/db/                            pool, tx (withSystem/withTenant), tenantContext (ALS),
                                       configRepo, runsRepo, eventsRepo, sessionRepo, authRepo, secretsMapper
src/lib/security/                      secretsCrypto (AES-GCM), paths (anti-traversal)
src/lib/validation/                    schemas (zod), parse
src/app/login, src/app/register        pantallas de auth
src/app/api/auth/                      register, login, logout, me, switch-tenant
db/migrations/0001_init,0002_auth,0003_rls.sql   esquema del control-plane
db/migrate.mjs                         runner de migraciones
db/provision.sql                       bootstrap (rol + base) para pgAdmin
scripts/retention.mjs                  retención por tenant
```
