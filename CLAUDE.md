# qa-kit — memoria del proyecto (para Claude Code)

> Este archivo lo lee Claude Code automáticamente al abrir el repo. Es el puente entre
> el trabajo hecho hasta ahora y la continuación. Mantenerlo actualizado al cerrar cada fase.

## Qué es esto

Reescritura **local-first y sin sesgo** de un kit de agentes/skills de QA que antes estaba
acoplado a Azure DevOps + Cursor + Windows + dominio FLIT. Objetivo: que **cualquier
proyecto** corra `static / unit / e2e / db / security / api` y deje un reporte local, **sin
PAT, sin Cursor y sin configurar nada**. El tracker es un plug-in opcional: hay cuatro
(`local`, `azure-devops`, `github`, `jira`) y se cambia con una línea de perfil.

Plan completo: **`docs/qa-kit-arquitectura-global.md`**. Guías de uso/extensión en `docs/`.
**Estado: roadmap F0–F5 completo** (ver "Estado actual"). Smoke test: 25/25.

## Estado actual

- **F0 (Andamiaje) — HECHO.** Estructura `core/adapters/delivery/profiles`, perfiles por
  capas con deep-merge, contrato `tracker-adapter`, adapter `local` funcionando, sink local
  (md+html), stub de ADO, manifest sin drift.
- **F1 (Local-first corre) — HECHO.** Un `git clone` cualquiera corre `static/unit/e2e`
  local y deja `qa-evidence/` sin PAT ni editar perfil. Piezas:
  - **`qa-detect`** (`runtime/detect/qa-detect.mjs` + skill): detecta capas (señales + deps
    de `package.json`) y stack/arquitectura; `resolveEnabledLayers` aplica override del perfil.
  - **Runners** (`runtime/runners/`): `_runner-core.mjs` (lógica común) + `static`/`unit`/`e2e`,
    cada uno detecta su herramienta, ejecuta (ejecutor **inyectable**) y emite el
    `EvidenceObject` normalizado al sink. **D1 cerrada** (unit no toca `Custom.Evidences`).
  - **Orquestador** (`runtime/orchestrator.mjs` `runQaCycle` + `core/agents/qa-orchestrator/`):
    preflight **condicional** gated por `capabilities().network` (local arranca directo; ADO
    sin env se detiene antes de runners) → detect → runners → sink.
  - Smoke test: `node runtime/smoke-test.mjs` → **10/10 OK**.
- **F2 (ADO como adapter) — HECHO.** `tracker: azure-devops` opera el contrato completo
  contra la REST de ADO, con **transporte HTTP inyectable** (offline-testable). Piezas:
  - `adapters/trackers/azure-devops/ado-rest.mjs`: cliente REST (único lugar con rutas/auth).
  - `azure-devops-adapter.mjs`: los 7 métodos — preflight REST, getWorkItem (+AC HTML→líneas),
    resolveRequirements, publishEvidence **dual** (resumen en Discussion del padre + reporte
    local md/html + **adjuntos** png/webm por TC→Task), createDefect (Bug+tag+enlace),
    updateCycle (clave lógica→`Custom.*`), closeArtifact (estado pass/fail del perfil).
  - `tc-match.mjs`: resuelve `tc_id`→Task hijo (annotation/mapping_file/env_map/WIQL);
    `on_unmatched: warn` degrada sin abortar.
  - Orquestador: `runQaCycle` acepta `http` inyectable → ciclo dual end-to-end probado offline.
  - D1/D2 cerradas. Smoke test: `node runtime/smoke-test.mjs` → **13/13 OK**.
- **F3 (Cobertura de capas) — HECHO.** Las 6 capas tienen runner. `_runner-core` ahora
  acepta specs como **función** (argv dinámico desde env/profile/archivos, o `{skip}`):
  - `db.mjs`: pgtap/prisma; **conexión SIEMPRE desde env** (`DATABASE_URL`/`PG_CONNECTION`/
    `DB_CONNECTION`), nunca cableada. `prisma` guarda igual que pgtap (sin conexión → skip
    accionable). `_runner-core` **reenvía `env` al proceso hijo** → cualquier proyecto futuro
    que exporte su conexión activa la capa sin tocar el kit.
  - `security.mjs`: semgrep/bandit; `security.target_profile` (api|web|generic) ajusta el ruleset.
    **ZERO-CONFIG:** la capa enciende en CUALQUIER repo (qa-detect elige bandit para Python,
    semgrep `auto` para el resto) sin exigir `.semgrep.yml`; degrada a skip si el escáner no
    está instalado. La detección de "no ejecutable" es **locale-independiente** (`isExecutable`
    resuelve PATH/PATHEXT antes de lanzar: en Windows español cmd.exe no da ENOENT ni 9009).
    Un spec puede declarar **`skipCodes`** (exit que significa "error de herramienta, no
    hallazgo"): semgrep/bandit usan `[2]` → un `--config auto` sin red **se omite, no falla**.
    Hallazgo real = exit 1 → fail. **bandit excluye directorios de test** (`*/tests/*`, `*/test/*`,
    venvs): `assert` en pytest es B101 pero NO un hallazgo de seguridad — sin esto cualquier repo
    Python rompía el gate de security por ruido. fnmatch normaliza `/`→`\` (vale en Windows).
  - `api.mjs`: colección Postman → `newman run`; OpenAPI → validación de contrato OFFLINE
    con `@redocly/cli lint` vía npx (local-first, sin servidor; ruleset por perfil
    `api.openapi_ruleset`, default `minimal`; degrada a skip si npx/red no resuelven).
    **Detección/localización ampliada:** además de `openapi.yaml`/`swagger.yaml`, reconoce
    cualquier `.yaml/.json` dentro de un directorio `openapi/` (p.ej. `contracts/openapi/
    core-api.v1.yaml`) — contratos versionados con nombre propio. `findByPath` baja varios
    niveles (no solo raíz+1) y elige determinista por orden lexicográfico.
  - Registrados en `RUNNERS`; el orquestador pasa `env` a los runners. Skills `db/security/api`.
  - qa-detect: `db` prefiere herramienta ejecutable (pgtap/prisma) sobre `migrations/` suelto.
  - Smoke test: `node runtime/smoke-test.mjs` → **15/15 OK** (casos 14-15 cubren las 6 capas).
- **F4 (Multi-delivery) — HECHO.** El mismo `core/` se empaqueta para los tres runtimes.
  - `runtime/cli.mjs`: entrypoint real (`runQaCycle`); exit 0/1/2/3 según fallos/preflight/error.
  - `runtime/delivery/build.mjs`: empaquetador. Copia el **motor** (core/runtime/adapters/profiles,
    imports intactos) y añade envoltorios por target: `plain` (bin/qa.mjs+README), `claude-code`
    (skills/agents + CLAUDE.md + bin), `cursor` (`.cursor/*.mdc` con `alwaysApply:false` + install.ps1).
    CLI: `node runtime/delivery/build.mjs dist [-t <target>]`. Salida en `dist/` (gitignored).
  - Smoke test: `node runtime/smoke-test.mjs` → **17/17 OK** (16 CLI real por subproceso, 17 build).
- **F5 (Más trackers) — HECHO.** Roadmap completo. Cuatro trackers: `local`, `azure-devops`,
  `github`, `jira`. Mismo patrón que F2 (cliente REST con transporte **inyectable** → offline):
  - `adapters/trackers/github/`: Issues. `custom_fields:false` (labels); `updateCycle` no-op;
    adjuntos se listan en el comentario (sin subida binaria por REST). Preset `github.yaml`.
  - `adapters/trackers/jira/`: API v3. `custom_fields:true`; comentarios/description en **ADF**;
    `updateCycle`→`customfield_*`; `closeArtifact`→transición. Preset `jira.yaml`.
  - `adapters/_shared/parse-ac.mjs`: AC desde texto/markdown (reuso github+jira).
  - Registrados en la factory; cero cambios en skills/orquestador. CONTRACT actualizado.
  - Smoke test: `node runtime/smoke-test.mjs` → **19/19 OK** (casos 18 github, 19 jira).
- **Monorepos + stack mixto (pnpm/yarn/npm workspaces) — HECHO.** El kit se adapta a CUALQUIER
  layout: repo plano, o monorepo donde herramientas/binarios viven en subpaquetes, incluso con
  **varias herramientas por capa** (p.ej. `unit` = vitest@frontend **y** dotnet-test@backend).
  - **Contrato nuevo: N objetivos por capa.** `detection.layers[layer].targets` = lista de
    `{tool, cwd, signals}`, un objetivo por (herramienta × paquete) donde la capa enciende.
    `qa-detect` corre la detección **por paquete** (cada `package.json` define un scope; los
    archivos sin `package.json` propio —p.ej. `*.csproj`— caen al scope ancestro). `collapseTargets`
    descarta, para una MISMA herramienta, el cwd que es ancestro de otro (dep hoisteada en raíz +
    config en subpaquete → conserva el subpaquete); herramientas distintas y paquetes hermanos
    conviven. `layers[layer].tool`/`.cwd` siguen existiendo como **primario** (compat).
  - **Los runners devuelven `EvidenceObject[]`** (uno por objetivo). `_runner-core.runTarget`
    ejecuta cada objetivo en su `cwd`; `runLayer` mapea sobre `targets`. El orquestador hace
    `results.push(...runner(...))`. La narrativa/`metrics` incluyen `tool` y `cwd` para distinguir
    objetivos de la misma capa en el reporte. Specs función (api/db/security) reciben el `cwd` del
    objetivo como base (buscan colección/escáner en ese paquete).
  - **`resolveBin(repoRoot, tool, startDir)`** sube desde el `cwd` del objetivo hasta la raíz
    mirando `node_modules/.bin` en cada nivel → cubre pnpm (bins por paquete) y npm/yarn
    (hoisteados); cae a PATH solo si no aparece (pytest/dotnet/ruff/mypy).
  - **Ejecución robusta (Windows + .NET):** `defaultExec` en Windows construye la línea de
    comando **citada** y la pasa como string única a `shell:true` → una RUTA CON ESPACIOS
    (p.ej. `C:\FLIT\TEST FLIT 2.0\…\vitest.cmd`) ya NO se parte (era el `"C:\FLIT\TEST" no se
    reconoce…`). En POSIX sigue `shell:false` con array de args. El objetivo `dotnet-test`
    **localiza el `.sln`** (o `*Tests.csproj`) y lo pasa explícito, así `dotnet test` no depende
    de la cwd (el proyecto puede vivir en `backend/`). `summarize()` quita códigos ANSI.
  - Validado E2E sobre repo real (monorepo pnpm + .NET): tsc@frontend ok, dotnet-test ok,
    vitest@frontend corre (fail = test real), playwright@frontend ok.
  - Smoke test: `node runtime/smoke-test.mjs` → **22/22 OK** (20 pnpm; 21 stack mixto unit
    vitest+dotnet; 22 ruta con espacios — regresión Windows).

## Manejo de novedades (Bug + reactivación + trazabilidad) — HECHO

Cuando una corrida deja **fallas**, el orquestador (`runQaCycle`, tras `publishEvidence`) maneja
la **novedad automáticamente**, agrupando las fallas por la **HU** a la que pertenecen:
- **`groupFailuresByRequirement`**: cada `EvidenceObject` con `status:"fail"` se asigna a su HU
  efectiva (`result.work_item_id` si lo declara; si no, la HU del ciclo `-w`). Sin HU real
  (`local`) no hay novedad. Una HU por grupo.
- Por cada HU con fallas: **`createDefect`** (Bug **enlazado a esa HU** vía `parent_id`; título
  `[QA] Novedad en HU <id>` + capas/casos fallidos en la descripción) → **`reactivateRequirement`**.
- **Contrato nuevo `reactivateRequirement(id, {bugId, items})`** (en los 4 adapters + base +
  CONTRACT): reactiva la HU al estado de novedad del perfil (**NUNCA** Closed — exclusivo PO) y
  deja un **comentario de trazabilidad** en la MISMA HU enlazando el Bug y listando los hallazgos.
  - `azure-devops`: PATCH `System.State` ← `azure.work_item.on_defect_reactivate_state` (`Active`)
    + comentario HTML con enlace clicable al Bug (`ado-rest.workItemWebUrl`). `_supervisionPrefix`
    se reusa en resumen y trazabilidad.
  - `github`: reabre el issue (`state:open`) + comentario markdown. `jira`: transición
    `jira.transitions.reactivate` (preset) + comentario ADF. `local`: no-op trazable (sin red).
- Gated por `capabilities().states` → local no dispara nada (no hay HU remota que reactivar).
  Degrada con aviso: un fallo de red en un paso se registra en `summary.novelties[]`, no aborta.
- **Punto ya cubierto:** "al ejecutar cualquier prueba, plasmar en ADO lo ejecutado" lo hace
  `publishEvidence` (resumen + detalle de TC en la Discussion de la HU) en CADA corrida — no
  requirió cambios.
- Smoke test caso 24: reactivación unit (PATCH Active + comentario con enlace al Bug) + ciclo
  completo (falla → Bug enlazado a la HU + reactivación) offline.
- **Guarda online (paridad offline↔online):** un tracker remoto sin `-w` (workItemId=`local`)
  NO intenta comentar sobre una HU inexistente (que daría 404 online): `runQaCycle` calcula
  `requirementId` (null si remoto sin HU real) y degrada a SOLO reporte local + `summary.warnings[]`
  (el CLI los imprime con `⚠`). Para `local` no aplica (`local` es nombre de carpeta válido). Las
  novedades igual se crean para resultados que declaren su propia `work_item_id`. Smoke test caso 25.

## Invariantes (no romper)

1. **`core/` es portable.** Cero literales de dominio: nada de `FLIT`, `abrahamc`, `flitsas`,
   `America/Bogota`, `flit_dev`, `.NET`, rutas `.cursor/`. Todo eso vive SOLO en
   `profiles/overlays/flit.yaml` o en `delivery/`.
2. **Las skills hablan solo con `tracker-adapter`**, nunca con ADO/GitHub/Jira directo.
3. **Local-first:** ningún paso de red es obligatorio. Con `tracker: local` todo corre sin PAT.
4. **Evidencia normalizada → sink.** Los runners emiten `{layer, tc_id, status, files, narrative}`
   y el sink decide destino (`local` = md+html; `dual` = comentario+local en ADO/github/jira).
   Un runner nunca escribe en un tracker directamente.
5. **Node `.mjs`, cross-platform.** Sin PowerShell ni Python en `core/`/`runtime/`.
6. **Tres targets de entrega** (Cursor, Claude Code, repo plano) comparten el mismo `core/`.
7. **`dev-tester` está fuera del core** (en `packs/dev-side/`, opcional). No lo reincorpores.
8. **El smoke test queda verde.** Tras cada cambio: `node runtime/smoke-test.mjs`. Si agregas
   capacidades, agrega su caso al smoke test.

## Mapa del repo

```
core/tracker-adapter/   contrato (CONTRACT.md + base + factory)
core/skills/            qa-detect , {static-analysis-gate,unit,e2e,db,security,api}-runner (docs)
core/agents/            qa-orchestrator (doc)
adapters/trackers/      local (default) , azure-devops , github , jira
adapters/_shared/       parse-ac (AC desde texto/markdown)
profiles/               default.yaml , presets/{azure-devops,github,jira}.yaml , overlays/flit.yaml
runtime/profile/        yaml-lite + resolver (deep-merge)
runtime/detect/         qa-detect (capas/stack)
runtime/runners/        _runner-core + static/unit/e2e/db/security/api
runtime/evidence/       sink local (md+html)
runtime/orchestrator.mjs  runQaCycle (preflight condicional → detect → runners → sink)
runtime/cli.mjs         entrypoint del kit
runtime/delivery/build.mjs  empaqueta core/ a plain/claude-code/cursor
runtime/smoke-test.mjs  prueba el plumbing extremo a extremo (25/25)
docs/                   arquitectura + guías (GUIA-USO, GUIA-AGENTES-SKILLS, GUIA-EXTENSION)
delivery/               docs por target (la salida real se genera en dist/)
packs/dev-side/         dev-tester (opcional, no se instala)
manifest.yaml           inventario real, sin drift
```

## Resolución de perfil

`default.yaml ← presets/<tracker>.yaml ← overlays/<org>.yaml ← qa-project.profile.yaml`
Repo sin perfil → `tracker: local`, `layers: auto`. `profile: flit` → hereda `flit←azure-devops←default`.

## Comandos

```bash
node runtime/smoke-test.mjs        # verificar plumbing (debe dar 25/25 OK)
node runtime/cli.mjs [repoRoot]    # correr el ciclo QA local-first sobre un repo
node runtime/cli.mjs [repoRoot] -w <HU> -f <FT> -d "<dev>"   # con trazabilidad por dev
node runtime/delivery/build.mjs dist   # generar los targets de entrega en dist/
```

**Trazabilidad de evidencia (FT + dev):** el sink local nombra la subcarpeta **netamente con el
Feature y el dev**: `qa-evidence/<fecha>/FT-<feature>__<dev-slug>/`. Los flags `--feature/-f` y
`--developer/-d` (propagados cli→`runQaCycle`→`publishEvidence`→`writeLocalReport`) componen ese
nombre y aparecen en el encabezado del reporte. El nombre del dev se sanea con `slug()` (tildes/ñ/
espacios → ASCII-safe). Solo si no llega ni FT ni dev se usa el fallback `WI-<HU>` para que la
carpeta nunca quede sin nombre. Así, corridas de distintos devs sobre el mismo feature no se pisan.
El título del reporte es solo «Reporte QA local» (sin `WI <id>`).

**Detalle por TC en la evidencia:** además de la tabla-resumen (un `EvidenceObject` por capa),
el reporte plasma los **TC individuales ejecutados por debajo de cada capa** (sección «Detalle de
pruebas»). Piezas: `runtime/runners/parse-cases.mjs` convierte el **reporter JSON nativo** de cada
herramienta (vitest/jest `--json`/`--reporter=json`, playwright json, eslint `-f json`, ruff
`--output-format=json`, semgrep `--json`, bandit `-f json`) en `cases: [{name,status,duration,
message}]`; el spec del runner declara `parseCases` y `_runner-core` lo invoca best-effort (si la
salida no es el JSON esperado → omite `cases`, degrada al resumen de texto, nunca rompe). El sink
local (`local-sink.casesHtml`/md) y los tres adapters remotos (`azure-devops` HTML,
`github` markdown, `jira` texto→ADF) renderizan el mismo detalle. Herramientas sin JSON nativo
(tsc/mypy/pytest/dotnet/cypress/newman/redocly/pgtap/prisma) quedan con resumen de texto.
Smoke test caso 23 cubre parseo + render.

## Documentación / guías

- `docs/qa-kit-arquitectura-global.md` — plan/diseño completo (leer antes de tocar el core).
- `docs/GUIA-USO.md` — cómo correr el kit, perfiles/trackers, capas, evidencia.
- `docs/GUIA-AGENTES-SKILLS.md` — catálogo de agentes/skills/archivos y qué hace cada uno.
- `docs/GUIA-EXTENSION.md` — cómo añadir un runner, un tracker o un overlay; cómo empaquetar.

## Roadmap completo — posibles siguientes (fuera del plan original)

Las 6 fases (F0–F5) del documento de arquitectura están HECHAS. Ideas de continuación:

1. **Adjuntos reales** en github (release assets / git LFS) y jira (multipart `/attachments`).
2. **Capa `api` OpenAPI — modo servidor vivo**: la validación de contrato OFFLINE
   (`redocly lint`) ya está HECHA. Falta el contract testing contra servidor vivo
   (schemathesis/dredd), que NO es local-first (requiere la API corriendo + base URL).
3. **Overlays de organización** adicionales (como `flit`) para otros equipos.
4. **CI**: workflow que corra `node runtime/smoke-test.mjs` en cada push.
5. **Empaquetado real de delivery** publicado (npm / release) desde `dist/`.

> Patrón a respetar: `core/` es la fuente de verdad; `delivery/*` se GENERA desde core/.
> Skills solo hablan con `tracker-adapter`; ejecución/transporte inyectables → todo offline.

## Estilo de trabajo con Claude Code

- Cambios pequeños y verificables; corre el smoke test antes de dar una tarea por cerrada.
- Si tocas el contrato `tracker-adapter`, actualiza `CONTRACT.md` y los cuatro adapters.
- Al cerrar una fase/tarea, actualiza "Estado actual" de este archivo y, si cambia el uso,
  las guías en `docs/`. Mantén `manifest.yaml` sin drift.
