# Flit Certify — plataforma de QA multitenant

**Flit Certify** es una plataforma de aseguramiento de calidad que se maneja **a clics** desde una
**webapp multitenant** (`webapp/`, Next.js) y se apoya en un **motor Node** (`runtime/`, `core/`,
`adapters/`) offline-testable. Es un servicio **multitenant** de verdad: PostgreSQL con **RLS forzada**,
auth propia, secretos por tenant **cifrados** (AES-256-GCM) y aislamiento por **Proyecto**.

> El folder del repo se llama `qa-kit` por historia; el producto es **Flit Certify**. La evidencia se
> publica en **Azure DevOps** o queda **local** (reporte en disco). Trackers Jira/GitHub **no** se usan.

Node 20+ (cross-platform, `.mjs`). Smoke test del motor: **140/140**. Ningún archivo de código supera
**400 líneas** (guardrail duro).

## Módulos (desde la webapp)

| Módulo | Ruta | Qué hace |
|--------|------|----------|
| **Explorar URL / GUION E2E** | `/` | Abre una app viva con Playwright (status HTTP + errores de consola + captura). En modo **GUION** corre un flujo de pasos (login → navegar → verificar) con **captura y evidencia por paso**, **cobertura de criterios de aceptación (AC)** y **fan-out de Feature** (corre el guion de cada HU hija). Accesibilidad **axe/WCAG** opcional. |
| **QA del Código** | `/` (modo código) | Analiza un repo local del servidor por capas: **static** (eslint/tsc/ruff/mypy + Roslyn .NET), **unit** (vitest/jest/`dotnet test`/pytest), **api**, **db** (sonda directa a Postgres + checks declarativos: RLS, PK, migraciones…), **security** (SAST semgrep/bandit + escáner de secretos + **SCA** npm/pnpm/dotnet/pip + licencias). Publica los hallazgos como **HU nueva en el sprint en curso** de Azure, con el reporte adjunto. |
| **Analizar PR** | `/pr` | Lee un PR de GitHub (determinista, sin IA), lo vincula a la HU/Feature de ADO y arma un **brief ISTQB** (qué validar, con más alcance que el happy-path del dev) + corre los guiones guardados. |
| **Test de Regresión** | `/regression` | Catálogo de selectores por **crawl** del sistema, **constructor de suites** por alias, runner Playwright con **evidencia (capturas + video)**, multi-sistema, credenciales cifradas, detección de regresión. |
| **Seguimiento QA** | `/seguimiento` | Tablero/tabla de pendientes (tipo Jira liviano): campos ricos, comentarios + actividad, métricas y export CSV/HTML, notificaciones in-app e **import de work items de ADO** (solo lectura). |
| **Casos de Prueba** | `/test-cases`, `/test-runs` | Test management: suites y casos con pasos (acción/esperado), **corridas** con resultado por paso + snapshot + cobertura de HU, **import de Azure Test Plans**, métricas y export. |
| **Programadas** | `/schedules` | Programa qué suite corre y cuándo; genera un **token de servicio** por tenant que un cron externo dispara (`/api/schedule/tick`). |
| **Bases de datos / Ajustes / Proyectos** | `/databases`, `/settings`, `/projects` | Conexiones (con **túnel SSH**), credenciales del tracker (Local / Azure) con preflight real, y gestión de **Proyectos** (cada uno es un tenant aislado con su propia config). |

## Arrancar la webapp

Requiere **PostgreSQL** (control-plane del servicio). Primera vez:

```bash
cd webapp
npm install
# .env.local (NO se commitea):
#   CONTROL_PLANE_URL=postgresql://USUARIO:CLAVE@localhost:5432/BASE
#   QA_KIT_MASTER_KEY=<32 bytes base64>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node --env-file=.env.local db/migrate.mjs   # aplica migraciones (idempotente)
npm run dev                                   # http://localhost:4312 (Turbopack; exige login)
```

Sin usuarios preexistentes → entrá a **`/register`** para crear el primer Proyecto (tu cuenta queda como
*owner*). Para E2E/Regresión hace falta Chromium de Playwright: `npx playwright install chromium`.

> ⚠️ La `QA_KIT_MASTER_KEY` cifra los secretos de cada tenant (PAT de ADO, claves de BD/SSH). **Se fija
> una vez y no se cambia**: si cambia, todo lo cifrado con la anterior queda ilegible. Guardala en el
> gestor de secretos.

## CLI del motor (sin webapp)

El motor también corre directo para exploración/GUION E2E:

```bash
node runtime/cli.mjs --url https://tu-app.com [-w <HU>] [-f <FT>] [-d "<dev>"]   # URL-smoke
node runtime/cli.mjs --flow guion.json [-w <HU>]                                 # GUION E2E
node runtime/smoke-test.mjs                                                      # plumbing offline → 140/140
node scripts/check-line-budget.mjs all                                          # guardrail 400 líneas → 0
```

El CLI deja el reporte en `<repo>/qa-evidence/<fecha>/FT-<feature>__<dev>/report.{md,html}` y sale con
`0` (sin fallos) · `1` (con fallos) · `2` (preflight de tracker) · `3` (error).

## Trackers y perfiles

Por defecto `tracker: local` (sin red). Para Azure DevOps, `.qa/qa-project.profile.yaml` con
`profile: azure-devops` (o `flit`) y `env`: `AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`,
`USER_REAL_EMAIL`. Resolución (deep-merge):

```
default.yaml  ←  presets/azure-devops.yaml  ←  overlays/flit.yaml  ←  qa-project.profile.yaml (repo)
```

## Despliegue

Handoff completo para el líder técnico (GitHub Actions → VPS) en **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**:
se despliega el **repo completo** (no solo `webapp/`), variables obligatorias (`CONTROL_PLANE_URL` con rol
**no-superusuario**, `QA_KIT_MASTER_KEY`), migraciones antes de arrancar, toolchains en la VPS, volumen
persistente para `data/tenants/<id>/`, y el modelo de rutas de QA del Código (el repo a certificar debe
estar en el filesystem de la VPS; sus dependencias se instalan solas y aisladas).

## Estructura

```
core/tracker-adapter/   contrato único (CONTRACT.md + base Node + factory local+azure)
adapters/trackers/      local (default) · azure-devops   (cliente REST inyectable)
profiles/               default.yaml · presets/azure-devops.yaml · overlays/flit.yaml
runtime/runners/        explore · explore-steps · explore-flow · static-analysis · unit · api · db · security · regression · …
runtime/orchestrator/   runQaCycle (E2E) · runCodeCycle (QA de código)
runtime/pr/             QA guiado por PR (pr-reader · classify · scope-matrix · brief · scaffold)
runtime/evidence/       sink local (md+html) · cobertura AC · HU de hallazgos · explicadores
webapp/                 UI multitenant (Next.js 15 + React 19 + TS + Tailwind) — el producto
docs/                   MULTITENANT.md · DEPLOYMENT.md
manifest.yaml           inventario real, sin drift
```

## Documentación

- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — despliegue a producción (requisitos, variables, migraciones, VPS).
- **[docs/MULTITENANT.md](docs/MULTITENANT.md)** — la webapp como servicio multitenant (Postgres+RLS, auth, cifrado) y reglas para extenderla sin romper el aislamiento.
- **[CLAUDE.md](CLAUDE.md)** — memoria del proyecto, estado por módulo, invariantes y registro de correcciones.
