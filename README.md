# qa-kit — Explorar una URL viva (pruebas E2E)

Kit de QA **acotado a un solo propósito**: explorar una app **ya corriendo** en una URL y dejar
evidencia (status HTTP + errores de consola + captura por página). Se maneja desde una **webapp
multitenant** (`webapp/`, Next.js). El destino de la evidencia es **local** (reporte en disco) o
**Azure DevOps** (comentario + capturas adjuntas en la HU).

> **Sesgo intencional:** este es el repo **laboral**, acotado a la compañía (Azure/FLIT). La versión
> portable/robusta (multi-stack, multi-tracker, "QA del código") vive en el repo personal.
> El pipeline de "QA del código" y los trackers Jira/GitHub se **retiraron** (viven en el historial de git).

Node 18+ (cross-platform, `.mjs`). Smoke test **14/14**.

## Inicio rápido

```bash
# explorar una URL viva (deja el reporte en qa-evidence/)
node runtime/cli.mjs --url https://tu-app.com [-w <HU>] [-f <FT>] [-d "<dev>"]

# verificar el plumbing del kit (offline)
node runtime/smoke-test.mjs        # → 14/14 OK
```

El CLI deja el reporte en `<repo>/qa-evidence/<fecha>/FT-<feature>__<dev>/report.{md,html}` y sale
con código `0` (sin fallos) · `1` (con fallos) · `2` (preflight de tracker) · `3` (error).

## Qué hace

| Capa | Runner |
|------|--------|
| `explore` | abre la URL en un navegador (Playwright): status HTTP + errores de consola + captura por página. Corre **solo** si se proporciona una URL (`--url`/`appUrl`); sin URL no aparece. Sin Playwright → skip accionable. |

El launcher del navegador es **inyectable** → todo es probable offline.

## Trackers

Por defecto `tracker: local` (sin red). Para publicar la evidencia en Azure DevOps, crea
`.qa/qa-project.profile.yaml` con `profile: azure-devops` (o `flit`) y exporta:

| Tracker | `profile:` | Variables `env` |
|---------|-----------|-----------------|
| Local (default) | — | (ninguna, sin red) |
| Azure DevOps | `azure-devops` (o `flit`) | `AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`, `USER_REAL_EMAIL` |

Resolución de perfil (deep-merge):

```
default.yaml  ←  presets/azure-devops.yaml  ←  overlays/flit.yaml  ←  qa-project.profile.yaml (repo)
```

El adapter de Azure entrega la evidencia en **modo dual**: comentario-resumen en la Discussion del
work item **+** reporte local **+** las **capturas adjuntas** al Task hijo (resuelto por `tc-match`).

## Interfaz web (multitenant)

`webapp/` es la UI (Next.js) para usar el kit **a clics**: un único flujo `Tracker → URL → Ejecutar`.
Es un servicio **multitenant** (Postgres + RLS, auth propia, secretos cifrados). No reimplementa nada:
llama a `runQaCycle`.

```bash
cd webapp && npm install && npm run dev      # http://localhost:4312 (exige login)
```

Detalle y reglas de extensión: **[docs/MULTITENANT.md](docs/MULTITENANT.md)**.

## Empaquetado multi-target

El mismo `core/` se **genera** para tres runtimes:

```bash
node runtime/delivery/build.mjs dist            # plain + claude-code + cursor en dist/
node dist/plain/bin/qa.mjs --url https://app    # el paquete generado corre standalone
```

## Estructura

```
core/tracker-adapter/   contrato único (CONTRACT.md + base Node + factory local+azure)
core/skills/url-explore/  core/agents/qa-orchestrator/   docs de la skill y del orquestador
adapters/trackers/      local (default) · azure-devops   (cliente REST inyectable)
adapters/_shared/       http-retry (transporte con reintento)
profiles/               default.yaml · presets/azure-devops.yaml · overlays/flit.yaml
runtime/                runners/explore · evidence (sink) · profile · orchestrator · cli
delivery/               docs por target (salida real en dist/)
docs/                   MULTITENANT.md (vigente)
manifest.yaml           inventario real, sin drift
```

## Documentación

- **[docs/MULTITENANT.md](docs/MULTITENANT.md)** — la webapp como servicio multitenant (Postgres+RLS, auth, cifrado) y reglas para extenderla.
- **[CLAUDE.md](CLAUDE.md)** — memoria del proyecto e invariantes (para Claude Code).
