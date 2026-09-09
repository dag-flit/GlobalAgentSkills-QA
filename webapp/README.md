# Flit Certify — interfaz web (multitenant)

UI (Next.js 15 + React 19 + TypeScript + Tailwind) del producto **Flit Certify**. **No reimplementa el
motor**: importa `runQaCycle`/`runCodeCycle` del kit (`../runtime/`) y lo orquesta desde el navegador. Es
un servicio **multitenant** (Postgres + **RLS forzada**, auth propia, secretos cifrados AES-256-GCM,
aislamiento por **Proyecto**).

## Arrancar

Requiere **PostgreSQL** (control-plane del servicio). Primera vez:

1. En pgAdmin, como superusuario, ejecuta `webapp/db/provision.sql` (crea la base + el rol de la app;
   cambia el `CHANGE_ME` por una clave real). El rol de la app **no** debe ser superusuario (bypassea RLS).
2. Crea `webapp/.env.local` (NO se commitea):
   ```
   CONTROL_PLANE_URL=postgresql://<rol_app>:<clave>@localhost:5432/<base>
   QA_KIT_MASTER_KEY=<32 bytes base64>
   ```
   (genera la clave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

```bash
cd webapp
npm install
node --env-file=.env.local db/migrate.mjs   # aplica migraciones (idempotente)
npm run dev                                   # http://localhost:4312 (Turbopack)
```

La app **exige login**. Sin usuarios preexistentes → entra a **`/register`** ("Crear Proyecto"):
nombre + tu email + contraseña (mín. 8). Esa cuenta queda como *owner*. Arquitectura, setup y reglas de
extensión en **[../docs/MULTITENANT.md](../docs/MULTITENANT.md)**; despliegue en
**[../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)**.

> Para explorar una URL o correr regresión se necesita Chromium de Playwright:
> `npx playwright install chromium` (una sola vez).

⚠️ **No corras `npm run build` mientras `npm run dev` está vivo** (ambos usan `.next` y en Windows puede
corromperse). Si la UI se rompe: detén dev → borra `.next` → reinicia dev.

⚠️ La `QA_KIT_MASTER_KEY` cifra los secretos por tenant: **se fija una vez y no se cambia** (si cambia, lo
cifrado antes queda ilegible).

## Módulos (de un vistazo)

- **Ejecutar** (`/`): asistente `Tracker → (URL | Código | PR) → …→ Ejecutar`.
  - **Explorar URL / GUION E2E:** URL-smoke o constructor visual de un flujo de pasos (login → navegar →
    verificar) para no técnicos, con localizadores amigables, secretos `${QA_USER}`/`${QA_PASS}` (efímeros),
    **captura + evidencia por paso**, Importar/Exportar guion (JSON), guardado por HU, **fan-out de Feature**
    y **matriz de cobertura de AC**. Accesibilidad **axe/WCAG** opcional.
  - **QA del Código:** analiza un repo local del servidor por capas (static/unit/api/db/security), con
    **materialización efímera** de dependencias (no toca el repo certificado), sonda directa a Postgres y
    publicación automática de la **HU de hallazgos** en el sprint en curso de Azure (con reporte adjunto).
- **Analizar PR** (`/pr`): brief ISTQB determinista desde un PR de GitHub + corre guiones guardados.
- **Test de Regresión** (`/regression`): catálogo de selectores por crawl, suites por alias, runner con
  evidencia (capturas + video), multi-sistema, credenciales cifradas.
- **Seguimiento QA** (`/seguimiento`): tablero/tabla de pendientes, comentarios + actividad, métricas,
  export CSV/HTML, notificaciones e **import de work items de ADO** (solo lectura).
- **Casos de Prueba** (`/test-cases`, `/test-runs`): suites y casos con pasos, corridas con resultado por
  paso + cobertura de HU, **import de Azure Test Plans**, métricas y export.
- **Programadas** (`/schedules`): horarios de corridas + token de servicio (disparo por cron externo).
- **Bases de datos** (`/databases`): conexiones con **túnel SSH** y "Probar conexión" real.
- **Ajustes** (`/settings`) y **Proyectos** (`/projects`): tracker (Local/Azure) con preflight, y gestión
  de Proyectos (cada uno un tenant aislado).
- **Ejecución en vivo** (`/runs/[id]`): consola por SSE + resultados (casos/pasos), tarjetas de cobertura
  de AC, fan-out y **HU de hallazgos** (con enlace a ADO), reporte y galería de capturas.

## Dónde quedan las evidencias (y por qué NO se suben al repo)

Bajo `webapp/data/tenants/<tenantId>/…` (evidencia de corridas, evidencia de regresión, materialización
efímera). Cada reporte es **autocontenido**: `report.html` + `report.md` + capturas embebidas.

**Las evidencias NUNCA se versionan:** `webapp/data/` está en `webapp/.gitignore` y `qa-evidence/` en el
`.gitignore` raíz. Config, conexiones, runs y eventos viven en **PostgreSQL** (control-plane) con secretos
**cifrados** (AES-256-GCM) y aislados por tenant (RLS). En prod, `data/tenants/` debe ir en un **volumen
persistente** que sobreviva a los deploys (ver DEPLOYMENT.md).

## Pruebas / gates

```bash
node ../runtime/smoke-test.mjs                 # motor del kit → 140/140
node ../scripts/check-line-budget.mjs all      # regla de 400 líneas → 0 violaciones
npx tsc --noEmit                               # typecheck de la webapp
```

El aislamiento por tenant se valida contra Postgres (RLS) y por HTTP con dos Proyectos (ver
`../docs/MULTITENANT.md`).
