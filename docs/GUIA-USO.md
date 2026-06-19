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
2. `qa-detect` inspecciona el repo y enciende **solo** las capas cuya herramienta existe.
3. Ejecuta los runners de esas capas (las demás se omiten **con aviso**, nunca aborta).
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

Opciones: `--work-item <id>` (etiqueta el reporte / WI padre), `--repo <dir>` (equivalente a
pasar la ruta posicional).

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
| `openapi`·`swagger` / `*.postman_collection.json` | `api` | `newman run <colección>` (openapi → skip) |
| `pgtap` / `prisma` / `migrations/` | `db` | `pg_prove` · `prisma migrate status` |
| `semgrep` / `bandit` | `security` | `semgrep …` · `bandit -r .` |

> Las herramientas deben estar instaladas en el repo/PATH para ejecutarse. Si no, la capa
> se omite con aviso (`skip`), no rompe el ciclo.

### Forzar capas (override)

Por defecto `testing.layers_enabled: auto`. Para fijar capas explícitas, en
`.qa/qa-project.profile.yaml`:

```yaml
testing:
  layers_enabled: ["static", "unit"]   # lista explícita: gana sobre la detección
```

## 3. Evidencia

Siempre se escribe un reporte local en `<repo>/qa-evidence/<fecha>/WI-<id>/`:

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
node runtime/smoke-test.mjs        # → 19/19 OK
```

Cubre, sin red, todo el plumbing: resolución de perfiles, detección, los 6 runners, el
orquestador (local y dual), los 4 adapters de tracker, el CLI y el empaquetador.
