# Guía de uso — qa-kit

Cómo correr el kit en cualquier repo, elegir tracker y leer la evidencia. Para extenderlo
(añadir runners/trackers) ver **GUIA-EXTENSION.md**; para el catálogo de piezas, **GUIA-AGENTES-SKILLS.md**.

## Requisitos

- **Node 18+** (usa `fetch` y `fs.cpSync` nativos). Cross-platform (Windows/macOS/Linux).
- Nada más. El kit no requiere instalación ni dependencias para correr en modo local.

## 1. Correr el ciclo QA (local, sin configuración)

```bash
node runtime/cli.mjs /ruta/al/repo
```

El CLI:
1. Resuelve el perfil del repo (sin perfil → `tracker: local`, `layers: auto`).
2. `qa-detect` inspecciona el repo y enciende las capas detectadas (`security` es **zero-config**:
   se intenta siempre).
3. Ejecuta los runners de esas capas (lo que no se pueda ejecutar se omite **con aviso**, nunca aborta).
4. Escribe el reporte y sale con un código según el resultado.

Salida de ejemplo:

```
QA (local) — ✅ 3 · ❌ 1 · ⏭ 2
  ✅ static — eslint: ok
  ✅ unit — vitest: ok
  ❌ e2e — playwright: exit 1 — 1 failed
  ⏭ db — sin migraciones/pgtap/testcontainers
  ...
Reporte: /ruta/al/repo/qa-evidence/2026-06-18/WI-local/report.md
```

Opciones:
- `--work-item <id>` / `-w` — etiqueta el reporte / HU bajo prueba.
- `--feature <FT>` / `-f` — Feature (FT) padre; se anexa a la subcarpeta de evidencia.
- `--developer "<nombre>"` / `-d` — desarrollador responsable; se anexa a la subcarpeta (saneado).
- `--repo <dir>` / `-C` — equivalente a pasar la ruta posicional.

```bash
node runtime/cli.mjs /ruta/al/repo -w 10194 -f 10118 -d "Abraham Cañon Vasquez"
# → qa-evidence/<fecha>/WI-10194__FT-10118__Abraham-Canon-Vasquez/report.md
```

### Códigos de salida

| Código | Significado |
|-------:|-------------|
| `0` | Ciclo completo, sin fallos |
| `1` | Al menos una capa falló |
| `2` | Preflight del tracker remoto falló (no se corrió ningún runner) |
| `3` | Error inesperado |

## 2. Qué capas detecta

| Señal en el repo | Capa | Comando que ejecuta |
|------------------|------|---------------------|
| `eslint` / `tsconfig.json` / `ruff` / `mypy` | `static` | el linter/type-checker detectado |
| `vitest` / `jest` / `pytest` / `*.csproj` (test) | `unit` | `vitest run` · `jest` · `pytest` · `dotnet test` |
| `playwright.config` / `cypress.config` | `e2e` | `playwright test` · `cypress run` |
| `*.postman_collection.json` / `openapi`·`swagger` | `api` | `newman run <colección>` · `redocly lint <spec>` (validación de contrato OpenAPI, offline) |
| `pgtap` / `prisma` / `migrations/` | `db` | `pg_prove` · `prisma migrate status` (conexión desde `env`) |
| *(siempre — zero-config)* | `security` | `semgrep --config auto` · `bandit -r .` |

> Las herramientas deben estar instaladas en el repo/PATH para ejecutarse. Si no, la capa
> se omite con aviso (`skip`), no rompe el ciclo. Detalles por capa:
>
> - **`api` · OpenAPI**: valida el contrato **sin servidor** con `redocly lint` (vía `npx`,
>   zero-config; ruleset por perfil `api.openapi_ruleset`, default `minimal`). Errores de
>   contrato → `fail`. El contract testing contra un servidor vivo (schemathesis/dredd) es otro
>   modo, no local-first, y no está incluido.
> - **`security` · zero-config**: se intenta en **cualquier** repo sin pedir `.semgrep.yml`
>   (qa-detect elige `bandit` para Python, `semgrep auto` para el resto). Hallazgo real → `fail`;
>   error del escáner (sin red/config, exit 2) → `skip`; escáner no instalado → `skip`.
> - **`db`**: la conexión llega **del entorno** (`DATABASE_URL`/`PG_CONNECTION`/`DB_CONNECTION`);
>   el kit la reenvía al proceso. Sin conexión o sin pgtap/prisma → `skip` accionable.

### Forzar capas (override)

Por defecto `testing.layers_enabled: auto`. Para fijar capas explícitas, en
`.qa/qa-project.profile.yaml`:

```yaml
testing:
  layers_enabled: ["static", "unit"]   # lista explícita: gana sobre la detección
```

## 3. Evidencia

Siempre se escribe un reporte local en `<repo>/qa-evidence/<fecha>/WI-<id>/`. Si pasas
`--feature`/`--developer`, la subcarpeta se vuelve `WI-<id>__FT-<feature>__<dev-slug>` (y el
encabezado del reporte muestra Feature y Desarrollador). Así, corridas de distintos devs sobre
la misma HU quedan en carpetas separadas y trazables, sin pisarse:

- `report.md` — para diff / CI.
- `report.html` — para abrir en el navegador.

Cada fila es un `EvidenceObject`: `{ layer, tc_id, status, narrative, metrics }`. Con un
tracker remoto, además se publica un resumen (ver abajo); el reporte local **siempre** queda.

## 4. Publicar en un tracker (opcional)

Crea `.qa/qa-project.profile.yaml` en el repo destino:

```yaml
profile: github        # azure-devops | github | jira | flit
project:
  name: "mi-proyecto"
```

Y exporta las variables del tracker (nunca se cablean en el código):

| Tracker | `profile:` | Variables `env` | Qué publica `publishEvidence` |
|---------|-----------|-----------------|-------------------------------|
| Azure DevOps | `azure-devops` / `flit` | `AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`, `USER_REAL_EMAIL` | resumen en Discussion del WI padre + adjuntos por TC→Task + reporte local |
| GitHub | `github` | `GITHUB_TOKEN`, `GITHUB_REPOSITORY` (`owner/repo`) | comentario en el issue + reporte local |
| Jira | `jira` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY` | comentario ADF en el issue + reporte local |

Con un tracker remoto, el orquestador corre **preflight** primero; si falla (credenciales,
proyecto), el ciclo se detiene **antes** de ejecutar runners (código `2`). En `local` no hay
preflight: arranca directo.

> El tipo de bug, estados, campos custom y transiciones se configuran en el **preset** del
> tracker (`profiles/presets/<tracker>.yaml`), no en el código.

## 5. Empaquetar para otro runtime

```bash
node runtime/delivery/build.mjs dist          # genera dist/{plain,claude-code,cursor}
node dist/plain/bin/qa.mjs /ruta/al/repo       # el paquete corre standalone
```

- **plain** — kit + CLI Node para cualquier IDE/CI.
- **claude-code** — `skills/`, `agents/`, `CLAUDE.md`, `bin/qa.mjs`.
- **cursor** — `.cursor/{skills,agents}/*.mdc` (`alwaysApply:false`) + `install.ps1`.

## 6. Verificar el kit

```bash
node runtime/smoke-test.mjs        # → 22/22 OK
```

Cubre, sin red, todo el plumbing: resolución de perfiles, detección, los 6 runners, el
orquestador (local y dual), los 4 adapters de tracker, el CLI y el empaquetador.
