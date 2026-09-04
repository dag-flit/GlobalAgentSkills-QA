# Despliegue a producción — qa-kit (handoff para el líder técnico)

> **Destino:** GitHub Actions configura el pipeline y despliega a la **VPS de la
> compañía**. Este documento describe QUÉ necesita la app para correr en prod, para
> coordinar con quien arma el workflow. No impone infraestructura: enumera requisitos.

## 1. Qué se despliega (artefacto)

**El repositorio COMPLETO, no solo `webapp/`.** La webapp (`webapp/`, Next.js) importa
el motor del kit desde `runtime/`, `core/` y `adapters/` (rutas hermanas) con `import()`
nativo. Si se empaqueta solo `webapp/`, el motor no existe en runtime y las corridas
fallan. El árbol que debe llegar a la VPS incluye al menos: `webapp/`, `runtime/`,
`core/`, `adapters/`, `profiles/`.

## 2. Build y arranque

```bash
cd webapp
npm ci                 # instala dependencias exactas (lockfile)
npm run build          # next build (compila a .next/)
npm start              # next start -p 4312 (servidor de producción)
```

- Puerto **4312**. Ponerlo detrás de un **reverse proxy** (nginx/Caddy) con **TLS**.
- Mantener el proceso vivo con **PM2** o **systemd** (restart on crash). Las corridas
  que mueran a mitad de un reinicio se auto-reconcilian (heartbeat, migración 0007).

## 3. Variables de entorno (secretos)

Inyectadas por GitHub Actions → entorno del servicio en la VPS. **Nunca** en git.
Plantilla documentada en [`webapp/.env.production.example`](../webapp/.env.production.example).

| Variable | Obligatoria | Qué es |
|---|---|---|
| `CONTROL_PLANE_URL` | ✅ | Postgres del control-plane (auth/tenants/config/runs), con **RLS forzada**. El usuario de conexión **NO** debe ser superusuario (bypassea RLS). |
| `QA_KIT_MASTER_KEY` | ✅ | Llave maestra AES-256-GCM que cifra los secretos por tenant (PAT ADO, claves BD/SSH). Rotarla exige re-cifrar lo guardado. |
| `NODE_ENV=production` | ✅ | Entorno. |
| `GITHUB_TOKEN` | ⬜ | Solo para leer PRs privados en el modo "Analizar PR". |
| `SSH_AUTH_SOCK` | ⬜ | Solo si un tenant tuneliza a su BD por SSH con agente. |

## 4. Migraciones de base de datos

Runner idempotente: `webapp/db/migrate.mjs` (migraciones `0001`–`0011`, forward-only).
Correr **como paso del deploy, contra la BD productiva, ANTES de arrancar la versión nueva**:

```bash
cd webapp && node --env-file=<archivo-env-prod> db/migrate.mjs
```

Todas crean sus tablas de tenant con `tenant_id` + `FORCE ROW LEVEL SECURITY` + policy.

## 5. Requisitos de runtime en la VPS

El motor **ejecuta herramientas en el host** durante las corridas. La VPS necesita:

- **Node 20+** (la webapp y el motor `.mjs`).
- **Navegadores de Playwright** (E2E + Regresión):
  `npx playwright install --with-deps chromium`
- Para el módulo **QA del Código** (si se usa en prod): **.NET SDK**, **npm/pnpm/yarn**,
  y opcional Python + `pip-audit`/`semgrep`/`bandit`. Regla: la *herramienta* se instala
  en el host del kit; el *artefacto* (lockfile/restore) es del repo que se certifica.
- **Disco persistente** para datos por tenant: la app escribe bajo `data/tenants/<id>/`
  (evidencia de corridas, evidencia de regresión, **materialización efímera** que copia
  repos + `node_modules`). Debe ser un **volumen que sobreviva a los deploys** (no un
  directorio efímero del contenedor).

## 6. Puerta de calidad antes del go-live (aislamiento multitenant)

- Confirmar que las migraciones aplicaron **RLS FORCE** en la BD productiva.
- Confirmar que `CONTROL_PLANE_URL` usa un rol **no-superusuario** (el kit tiene un
  check que lo detecta: un superusuario ignora la RLS y anula el aislamiento).
- Probar con **dos tenants** que uno no ve datos del otro (login → datos aislados).

## 7. Health check

**Falta una ruta de health dedicada** (no existe `/api/health`). Opciones:
- Agregar `GET /api/health` liviano (200 sin auth) para el proxy/monitor — recomendado.
- Provisional: `GET /` responde **307** (redirect al login) = señal de que el server vive.

## 8. Programación de corridas (PRO #4)

La app trae el scheduler: en **«Programadas»** se definen horarios (qué suite corre y cuándo) y
se genera el **token de servicio** por tenant. Falta solo el **disparador externo** que golpee el
endpoint periódicamente. El endpoint corre los horarios **vencidos** del tenant; conviene un tick
cada ~15 min.

- **Endpoint:** `POST /api/schedule/tick` (público, autenticado por el cuerpo, no por sesión).
- **Credencial:** `{ "tenantId": "<uuid>", "token": "<token de servicio>" }`. El token se valida
  dentro de la RLS del tenant reclamado → un par que no casa devuelve 401, sin lectura cruzada.
- **Secretos:** guardar `tenantId` + `token` como secretos del entorno (uno por tenant a programar).

**Opción A — Workflow programado de GitHub Actions** (`.github/workflows/schedule-tick.yml`):

```yaml
name: qa-schedule-tick
on:
  schedule:
    - cron: "*/15 * * * *"   # cada 15 min (UTC)
  workflow_dispatch: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Disparar corridas vencidas
        run: |
          curl -fsS -X POST "$APP_URL/api/schedule/tick" \
            -H "Content-Type: application/json" \
            -d "{\"tenantId\":\"$TENANT_ID\",\"token\":\"$SCHED_TOKEN\"}"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          TENANT_ID: ${{ secrets.SCHED_TENANT_ID }}
          SCHED_TOKEN: ${{ secrets.SCHED_TOKEN }}
```

**Opción B — cron en la VPS** (`crontab -e`):

```
*/15 * * * * curl -fsS -X POST https://APP/api/schedule/tick -H 'Content-Type: application/json' -d '{"tenantId":"<uuid>","token":"<token>"}' >/dev/null 2>&1
```

Un tick puede tardar si hay varias suites (abre un navegador real por corrida): usar timeout amplio.
Para varios tenants, repetir el paso/línea con el `tenantId`+`token` de cada uno.
