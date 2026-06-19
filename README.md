# qa-kit — QA local-first, sin sesgo

Kit de agentes/skills de QA **portable**. Cualquier repo corre
`static · unit · e2e · db · security · api` y deja un reporte local, **sin PAT, sin Cursor
y sin configurar nada**. El tracker es un plug-in opcional: `local` (default), `azure-devops`,
`github` o `jira` — se cambia con una línea de perfil; ninguna skill se entera.

> **Principio:** lo **local siempre funciona** sin red. El tracker remoto se enciende con un
> overlay mínimo. Ningún runner habla con un tracker: todos emiten evidencia normalizada a un
> *sink*, y el *sink* decide el destino.

Estado: **roadmap F0–F5 completo**. Smoke test **22/22**. Node 18+ (cross-platform, `.mjs`).

## Inicio rápido (sin instalar nada)

```bash
# correr el ciclo QA sobre un repo (detecta capas y ejecuta lo que el repo permita)
node runtime/cli.mjs /ruta/al/repo

# verificar el plumbing del kit
node runtime/smoke-test.mjs        # → 22/22 OK
```

El CLI deja el reporte en `<repo>/qa-evidence/<fecha>/WI-<id>/report.{md,html}` y sale con
código `0` (sin fallos) · `1` (con fallos) · `2` (preflight de tracker) · `3` (error).

## Qué detecta y corre

`qa-detect` enciende las capas según el repo; lo que no se pueda ejecutar se omite con aviso
(`skip`), nunca rompe el ciclo. `security` es **zero-config**: se intenta en todo repo.

| Señal en el repo | Capa | Runner |
|------------------|------|--------|
| eslint / tsconfig / ruff / mypy | `static` | linter / type-checker |
| vitest / jest / pytest / *.csproj | `unit` | runner de tests existentes |
| playwright / cypress | `e2e` | suite end-to-end |
| colección Postman / openapi·swagger | `api` | newman (postman) · `redocly lint` (validación de contrato OpenAPI, offline) |
| pgtap / prisma / migrations | `db` | checks de BD (conexión desde `env`) |
| *(siempre)* | `security` | semgrep `auto` / bandit — **zero-config**; skip si el escáner no está instalado |

## Trackers (opcional)

Por defecto `tracker: local` (sin red). Para publicar en un tracker, crea
`.qa/qa-project.profile.yaml` con `profile: <preset>` y exporta las variables de entorno:

| Tracker | `profile:` | Variables `env` |
|---------|-----------|-----------------|
| Azure DevOps | `azure-devops` (o `flit`) | `AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`, `USER_REAL_EMAIL` |
| GitHub Issues | `github` | `GITHUB_TOKEN`, `GITHUB_REPOSITORY` |
| Jira Cloud | `jira` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY` |

Resolución de perfil (deep-merge):

```
default.yaml  ←  presets/<tracker>.yaml  ←  overlays/<org>.yaml  ←  qa-project.profile.yaml (repo)
```

## Empaquetado multi-target

El mismo `core/` se **genera** para tres runtimes:

```bash
node runtime/delivery/build.mjs dist            # plain + claude-code + cursor en dist/
node runtime/delivery/build.mjs dist -t plain   # solo un target
node dist/plain/bin/qa.mjs /ruta/al/repo        # el paquete generado corre standalone
```

## Estructura

```
core/tracker-adapter/   contrato único (CONTRACT.md + base Node + factory)
core/skills/  core/agents/   docs portables de skills (runners) y del orquestador
adapters/trackers/      local · azure-devops · github · jira    (cliente REST inyectable)
profiles/               default.yaml · presets/* · overlays/flit.yaml
runtime/                detect · runners · evidence (sink) · profile · orchestrator · cli
delivery/               docs por target (salida real en dist/)
docs/                   arquitectura + guías de uso/extensión
manifest.yaml           inventario real, sin drift
```

## Documentación

- **[docs/GUIA-USO.md](docs/GUIA-USO.md)** — cómo correr el kit, perfiles, capas, evidencia.
- **[docs/GUIA-AGENTES-SKILLS.md](docs/GUIA-AGENTES-SKILLS.md)** — catálogo de agentes/skills/archivos.
- **[docs/GUIA-EXTENSION.md](docs/GUIA-EXTENSION.md)** — añadir un runner, un tracker o un overlay.
- **[docs/qa-kit-arquitectura-global.md](docs/qa-kit-arquitectura-global.md)** — diseño completo.
- **[CLAUDE.md](CLAUDE.md)** — memoria del proyecto e invariantes (para Claude Code).
