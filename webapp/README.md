# Quality Ops Framework — interfaz web del qa-kit

UI (Next.js 15 + React 19 + TypeScript + Tailwind) para usar el **qa-kit a clics**, pensada para
que **cualquier persona** (técnica o no) corra el ciclo QA sin tocar la CLI. **No reimplementa el
motor**: importa `runQaCycle` del kit (`../runtime/`) y lo orquesta desde el navegador.

## Arrancar

```bash
cd webapp
npm install
npm run dev          # http://localhost:4312
```

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
| **Explorar una URL** | `webapp/data/evidence/<id>/qa-evidence/<fecha>/WI-local/` |

Cada carpeta es **autocontenida**: `report.html` + `report.md` + subcarpeta `capturas/` (las
imágenes se copian ahí y se embeben en el HTML).

**Las evidencias NUNCA se suben al repo** — se mantienen **solo localmente**:
- `qa-evidence/` está en el `.gitignore` raíz del kit (cualquier nivel).
- `webapp/data/` (config con secretos, runs, repos clonados, evidencia de exploración) está en
  `webapp/.gitignore`.
- En **tus** proyectos, agrega `qa-evidence/` al `.gitignore` del repo para no subir corridas.

> Datos locales de la app (no versionados): `webapp/data/` → `config.json` (con secretos
> enmascarados al enviar al navegador), `runs.json` + `events/` (historial), `repos/` (repos
> clonados), `evidence/` (evidencias del modo explorar).

## Trazabilidad por-HU (etiqueta `[HU-###]`)

Para que una novedad se registre en **su** HU (y no en el Feature), etiqueta la prueba con su HU
dueña en el título: `describe("[HU-103] Checkout", …)`. El kit la resuelve y crea el Bug en la
HU 103. Lo no etiquetado cae al Feature. El detalle de la corrida muestra además la **cobertura**:
qué HUs seleccionadas quedaron cubiertas por pruebas y cuáles no.

## Pruebas

```bash
node ../runtime/smoke-test.mjs        # motor del kit → 27/27
# Suite E2E de la webapp (con el dev server arriba):
cp test/fixtures/seed-runs.json data/runs.json   # siembra el caso de cobertura
node test/full-suite.mjs                          # API + ejecución + navegador → PASS
```

`test/fixtures/demo-repo/` es un repo de fixtura (vitest con pruebas etiquetadas `[HU-201]`/
`[HU-202]`) para validar QA del código de punta a punta.

## Estructura

```
src/app/            páginas + API routes (config, db/test, detect, tracker/*, runs/*, artifacts)
src/components/      AppShell (menú) · RunWizard · TrackerStep · FeatureStep · DbConnections · RunDetail · ui
src/lib/             config · runStore · events · procRegistry · db/* (cliente + túnel SSH)
src/lib/qa/          puentes al motor del kit: runner (runQaCycle) · detect · tracker · gitService · kit
data/                local, NO versionado (config, runs, repos, evidencia de exploración)
test/                full-suite.mjs + fixtures/
```
