# Quality Ops Framework — interfaz web del qa-kit

UI (Next.js 15 + React 19 + TypeScript + Tailwind) para usar el **qa-kit a clics**: explorar una
URL viva (pruebas E2E) sin tocar la CLI. **No reimplementa el motor**: importa `runQaCycle` del kit
(`../runtime/`) y lo orquesta desde el navegador. Es un servicio **multitenant** (Postgres + RLS,
auth propia, secretos cifrados).

## Arrancar

Requiere **PostgreSQL** (control-plane del servicio). Primera vez:

1. En pgAdmin, como superusuario, ejecuta `webapp/db/provision.sql` (crea la base
   `flit_qa_kit` + el rol `flit_qa_app`; cambia el `CHANGE_ME` por una clave real).
2. Crea `webapp/.env.local` (NO se commitea):
   ```
   CONTROL_PLANE_URL=postgresql://flit_qa_app:<clave>@localhost:5432/flit_qa_kit
   QA_KIT_MASTER_KEY=<32 bytes base64>
   ```
   (genera la clave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

```bash
cd webapp
npm install
node --env-file=.env.local db/migrate.mjs   # aplica migraciones (idempotente)
npm run dev                                   # http://localhost:4312
```

La app **exige login**. No hay usuarios preexistentes → entra a **`/register`** ("Crear
organización"): nombre + tu email + contraseña (mín. 8). Esa cuenta queda como *owner*.
Arquitectura, setup y reglas de extensión completas en **[../docs/MULTITENANT.md](../docs/MULTITENANT.md)**.

> Para explorar una URL se necesita Chromium de Playwright:
> `npx playwright install chromium` (una sola vez).

⚠️ **No corras `npm run build` mientras `npm run dev` está vivo** (ambos usan `.next` y en Windows
puede corromperse). Si la UI se rompe: detén dev → borra `.next` → reinicia dev.

## Qué hace (de un vistazo)

- **Bases de datos** (`/databases`): gestor estilo pgAdmin (varias conexiones, **túnel SSH**),
  con "Probar conexión" real y secretos enmascarados.
- **Ajustes** (`/settings`): credenciales del tracker (**Local** / **Azure DevOps**) con
  "Probar conexión" (preflight real del adapter).
- **Ejecutar** (`/`): asistente de un solo flujo — **Explorar una URL**: `Tracker → URL → Ejecutar`.
  Abre la app viva con Playwright y registra status HTTP + errores de consola + una captura por página.
- **Ejecución en vivo** (`/runs/[id]`): consola por SSE + resultados claros (qué se exploró,
  duración, casos por URL con pass/fail), reporte y galería de capturas.

## Dónde quedan las evidencias (y por qué NO se suben al repo)

La corrida deja la evidencia bajo
`webapp/data/tenants/<tenantId>/evidence/<id>/qa-evidence/<fecha>/…`. Cada carpeta es
**autocontenida**: `report.html` + `report.md` + subcarpeta `capturas/` (las imágenes se copian
ahí y se embeben en el HTML).

**Las evidencias NUNCA se suben al repo:**
- `webapp/data/` (config con secretos, runs, evidencia de exploración) está en `webapp/.gitignore`.
- `qa-evidence/` está en el `.gitignore` raíz del kit.

> **Persistencia:** config, conexiones, runs y eventos viven en **PostgreSQL** (control-plane),
> con secretos **cifrados** (AES-GCM) y aislados por tenant (RLS). En disco, `webapp/data/` (no
> versionado) solo guarda artefactos por tenant: `tenants/<tenantId>/evidence/`.

## Pruebas

```bash
node ../runtime/smoke-test.mjs                 # motor del kit → 14/14
node ../scripts/check-line-budget.mjs all      # regla de 400 líneas → 0 violaciones
npx tsc --noEmit                               # typecheck de la webapp
```

> El aislamiento por tenant (AIS-01..08) se valida directamente contra Postgres (RLS) y por
> HTTP con dos organizaciones (ver `docs/MULTITENANT.md`). `test/full-suite.mjs` cubre la
> exploración de URL de punta a punta (requiere el dev server + login) y el guardrail de 400
> líneas sobre `webapp/src`.

## Estructura

```
src/middleware.ts   portón de auth (Edge) + cabeceras de seguridad
src/app/            páginas (login, register, …) + API routes (auth/*, config, db/test, tracker/test, runs/*, artifacts)
src/components/      AppShell · SessionBadge · AuthCard · run-wizard/* · db-connections/* · run-detail/* · ui
src/lib/auth/        password (scrypt) · session · context · cookie · route (withTenantScope)
src/lib/db/          pool · tx (withTenant) · tenantContext (ALS) · {config,runs,events,session,auth}Repo · secretsMapper
src/lib/security/    secretsCrypto (AES-GCM) · paths (anti-traversal)
src/lib/validation/  schemas (zod) · parse
src/lib/qa/          puentes al motor del kit: runner (runQaCycle) · tracker · kit
db/                  migrations/*.sql + migrate.mjs + provision.sql
scripts/             retention.mjs (retención por tenant)
data/                local, NO versionado (evidencia por tenant)
test/                full-suite.mjs
```
