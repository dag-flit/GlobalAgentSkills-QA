# qa-kit — Explorar una URL viva (pruebas E2E)

Kit de QA **acotado a un solo propósito**: explorar una app **ya corriendo** en una URL y dejar
evidencia (status HTTP + errores de consola + captura por página). Se maneja desde una **webapp
multitenant** (`webapp/`, Next.js). El destino de la evidencia es **local** (reporte en disco) o
**Azure DevOps** (comentario + capturas adjuntas en la HU).

> **Sesgo intencional:** este es el repo **laboral**, acotado a la compañía (Azure/FLIT). La versión
> portable/robusta (multi-stack, multi-tracker, "QA del código") vive en el repo personal.
> El pipeline de "QA del código" y los trackers Jira/GitHub se **retiraron** (viven en el historial de git).

Node 18+ (cross-platform, `.mjs`). Smoke test **19/19**.

## Inicio rápido

```bash
# explorar una URL viva (URL-smoke: deja el reporte en qa-evidence/)
node runtime/cli.mjs --url https://tu-app.com [-w <HU>] [-f <FT>] [-d "<dev>"]

# correr un GUION E2E (flujo de pasos: login → navegar → verificar)
node runtime/cli.mjs --flow guion.json [-w <HU>]

# verificar el plumbing del kit (offline)
node runtime/smoke-test.mjs        # → 19/19 OK
```

El CLI deja el reporte en `<repo>/qa-evidence/<fecha>/FT-<feature>__<dev>/report.{md,html}` y sale
con código `0` (sin fallos) · `1` (con fallos) · `2` (preflight de tracker) · `3` (error).

## Qué hace

| Modo | Runner |
|------|--------|
| **URL-smoke** | abre la URL en un navegador (Playwright): status HTTP + errores de consola + captura por página. Corre si se pasa `--url`/`appUrl`. |
| **GUION E2E** | corre un **flujo de pasos** en orden sobre una misma sesión (login → navegar → verificar) con **captura + evidencia por paso**. Se pasa `--flow`/`flow`. Localizadores amigables (etiqueta/placeholder/texto/botón/css), secretos por `${QA_USER}`/`${QA_PASS}` (efímeros, nunca en el guion). |

Sin URL ni guion, la capa no participa. Sin Playwright → skip accionable. El launcher del navegador es
**inyectable** → todo es probable offline.

**Cobertura de criterios de aceptación (AC):** en modo GUION, cada paso de verificación puede declarar
qué AC prueba (`ac`). El runner cruza esos `ac` con los AC declarados de la HU (leídos de Azure) y arma
una **matriz de cobertura** (cubierto ✅ / con fallo ❌ / sin cubrir ⚠) en el reporte y en el comentario
del work item. Es MAPEO determinista evidencia↔criterio (sin IA, sin generación de pruebas).

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

`webapp/` es la UI (Next.js) para usar el kit **a clics**: flujo `Tracker → URL → Pasos → Ejecutar`.
Incluye un **constructor visual de guiones** para no técnicos (sin YAML), Importar/Exportar guion (JSON),
guardado del guion **por HU** + **fan-out de Feature**, panel de **criterios de aceptación** y **matriz
de cobertura de AC**. Es un servicio **multitenant** (Postgres + RLS, auth propia, secretos cifrados).
No reimplementa nada: llama a `runQaCycle`.

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
runtime/                runners/{explore · explore-steps · explore-flow} · evidence/{local-sink · ac-coverage} · profile · orchestrator · cli
delivery/               docs por target (salida real en dist/)
docs/                   MULTITENANT.md (vigente)
manifest.yaml           inventario real, sin drift
```

## Documentación

- **[docs/MULTITENANT.md](docs/MULTITENANT.md)** — la webapp como servicio multitenant (Postgres+RLS, auth, cifrado) y reglas para extenderla.
- **[CLAUDE.md](CLAUDE.md)** — memoria del proyecto e invariantes (para Claude Code).
