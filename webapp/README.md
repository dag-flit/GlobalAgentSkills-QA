# Quality Ops Framework — interfaz web del qa-kit

UI (Next.js 15 + React 19 + TypeScript + Tailwind) para usar el **qa-kit a clics**, pensada para
que **cualquier persona** (técnica o no) corra el ciclo QA sin tocar la CLI. **No reimplementa el
motor**: importa `runQaCycle` del kit (`../runtime/`) y lo orquesta desde el navegador.

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

> Para el modo **Explorar URL** se necesita Chromium de Playwright:
> `npx playwright install chromium` (una sola vez).

⚠️ **No corras `npm run build` mientras `npm run dev` está vivo** (ambos usan `.next` y en Windows
puede corromperse). Si la UI se rompe: detén dev → borra `.next` → reinicia dev.

## Qué hace (de un vistazo)

- **Bases de datos** (`/databases`): gestor estilo pgAdmin (varias conexiones, **túnel SSH**),
  con "Probar conexión" real y secretos enmascarados.
- **Ajustes** (`/settings`): credenciales del tracker (local/Azure DevOps/GitHub/Jira) con
  "Probar conexión" (preflight real del adapter).
- **Ejecutar** (`/`): asistente con **2 modos**
  - **QA del código** — corre las 6 capas (estático · unit · API · BD · seguridad · E2E). Origen
    (repo Git o ruta local) → detección de capas → tracker → *(opcional)* Feature→HUs →
    **Revisión** de pruebas generadas → *(opcional)* URL base para E2E → ejecutar. Trae las HUs
    hijas de un Feature por la conexión REST del adapter.
  - **Explorar una URL** — crawler (Playwright): smoke + capturas de una app viva, sin repo.
- **Revisión + Plan + evidencia por HU** (paso "Revisión"): a partir de los **criterios de cada HU**
  prepara **una especificación ejecutable (BDD/Gherkin) por criterio** y la muestra en lenguaje claro
  (✓ aprobar / ✎ ajustar / ✗ descartar, "ver especificación"). El AC **es** la prueba: se ejecuta tal
  cual con Cucumber.js — determinista, sin IA. Botón **"Publicar plan en el tracker"** crea, ANTES de
  ejecutar, la Task **"PLAN PRUEBAS FEATURE …"** + los **TC por criterio** (estado *planificado*). Al
  ejecutar, se actualizan con el resultado y se comenta por HU. Paridad online (tracker) y offline (reporte).
- **Ejecución en vivo** (`/runs/[id]`): consola por SSE + resultados claros por capa (qué se
  ejecutó, comando, duración, casos con pass/fail/**skip**), **Plan del Feature**, **evidencia por HU**,
  cobertura, reporte y galería de capturas.

## Generación de pruebas: BDD ejecutable (Ruta B)

Las pruebas se generan como **especificaciones ejecutables Gherkin** a partir de los criterios de cada
HU: el AC **es** el test (determinista, sin IA, sin alucinación). El feature-writer del kit emite un
`.feature` por criterio (un Scenario, etiquetado `@HU-### @TC-AC<n>`) y la capa `bdd` los ejecuta con
**Cucumber.js**. Si el proyecto no tiene el runtime, el kit lo trae on-demand (`npx`); los steps **web**
usan Playwright. Los `.feature` se escriben en `qa-generated/HU-<id>/` (visibles y revisables; ya en
`.gitignore`). La librería de step-definitions reutilizable vive en `bdd/steps/` (web/api/db) y se
extiende por proyecto (`bdd/steps/`, `tests/bdd/steps/`, `features/steps/`…).

> Esta versión (limitada) **no** incluye generación con IA: la ruta única es BDD.

## Dónde quedan las evidencias (y por qué NO se suben al repo)

| Modo | Carpeta local de evidencia |
|------|----------------------------|
| **QA del código** | `<repo-probado>/qa-evidence/<fecha>/FT-<feature>__<dev>/` (o `WI-<id>/`) |
| **Explorar una URL** | `webapp/data/tenants/<tenantId>/evidence/<id>/qa-evidence/<fecha>/WI-local/` |

Cada carpeta es **autocontenida**: `report.html` + `report.md` + subcarpeta `capturas/` (las
imágenes se copian ahí y se embeben en el HTML).

**Las evidencias NUNCA se suben al repo** — se mantienen **solo localmente**:
- `qa-evidence/` está en el `.gitignore` raíz del kit (cualquier nivel).
- `webapp/data/` (config con secretos, runs, repos clonados, evidencia de exploración) está en
  `webapp/.gitignore`.
- En **tus** proyectos, agrega `qa-evidence/` al `.gitignore` del repo para no subir corridas.

> **Persistencia:** config, conexiones, runs y eventos viven en **PostgreSQL** (control-plane),
> con secretos **cifrados** (AES-GCM) y aislados por tenant (RLS). En disco, `webapp/data/` (no
> versionado) solo guarda artefactos por tenant: `tenants/<tenantId>/repos/` (repos clonados) y
> `tenants/<tenantId>/evidence/` (modo explorar).

## Trazabilidad por-HU (etiqueta `[HU-###]`)

Para que una novedad se registre en **su** HU (y no en el Feature), etiqueta la prueba con su HU
dueña en el título: `describe("[HU-103] Checkout", …)`. El kit la resuelve y crea el Bug en la
HU 103. Lo no etiquetado cae al Feature. El detalle de la corrida muestra además la **cobertura**:
qué HUs seleccionadas quedaron cubiertas por pruebas y cuáles no.

## Pruebas

```bash
node ../runtime/smoke-test.mjs                 # motor del kit → 42/42
node ../scripts/check-line-budget.mjs all      # regla de 400 líneas → 0 violaciones
npx tsc --noEmit                               # typecheck de la webapp
```

> El aislamiento por tenant (AIS-01..08) se valida directamente contra Postgres (RLS) y por
> HTTP con dos organizaciones (ver `docs/MULTITENANT.md`). `test/full-suite.mjs` cubre el
> guardrail de 400 líneas sobre `webapp/src`.

`test/fixtures/demo-repo/` es un repo de fixtura (vitest con pruebas etiquetadas `[HU-201]`/
`[HU-202]`) para validar QA del código de punta a punta.

## Estructura

```
src/middleware.ts   portón de auth (Edge) + cabeceras de seguridad
src/app/            páginas (login, register, …) + API routes (auth/*, config, db/test, detect, tracker/*, runs/*, artifacts)
src/components/      AppShell · SessionBadge · AuthCard · run-wizard/* · db-connections/* · run-detail/* · ui
src/lib/auth/        password (scrypt) · session · context · cookie · route (withTenantScope)
src/lib/db/          pool · tx (withTenant) · tenantContext (ALS) · {config,runs,events,session,auth}Repo · secretsMapper
src/lib/security/    secretsCrypto (AES-GCM) · paths (anti-traversal)
src/lib/validation/  schemas (zod) · parse
src/lib/qa/          puentes al motor del kit: runner (runQaCycle) · detect · tracker · gitService · kit
db/                  migrations/*.sql + migrate.mjs + provision.sql
scripts/             retention.mjs (retención por tenant)
data/                local, NO versionado (repos + evidencia por tenant)
test/                full-suite.mjs + fixtures/
```
