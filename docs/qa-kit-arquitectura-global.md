# Arquitectura para globalizar el QA Kit

**De `flit-qa-kit-v3` (ADO/Cursor/Windows/FLIT) → `qa-kit` portable, local-first y sin sesgo**

| | |
|---|---|
| Versión analizada | flit-qa-kit-v3 · 3.1.2 |
| Objetivo | Que los agentes y skills de QA corran en **cualquier proyecto** (local, e2e, bd, seguridad…) con **poca o cero configuración**, sin estar atados a Azure DevOps, Cursor, Windows ni al dominio FLIT |
| Alcance de este documento | Diagnóstico → principios → arquitectura objetivo → mapa `literal → clave de perfil` → plan de migración archivo por archivo → roadmap |

---

## 1. Resumen ejecutivo

El kit v3 ya es **funcionalmente completo y autocontenido** (incluye KB, perfiles, scripts, runtime TS e instalador). El problema ya **no** es que falten piezas, sino que el diseño es **ADO-first, Cursor-first, Windows-first y con convenciones FLIT**. Para "cualquier proyecto" hay que **invertir el default**:

> **Hoy:** Azure DevOps es obligatorio; lo local es opcional.
> **Objetivo:** lo **local siempre funciona**; el tracker (ADO/Jira/GitHub) es un **plug-in opcional** que se enciende con un overlay mínimo.

Un repo nuevo debe poder ejecutar `static / unit / e2e / db / security` y producir un **reporte local** (Markdown/HTML) **sin PAT, sin Cursor y sin editar nada**. El resto se logra con tres movimientos: (a) una **abstracción de tracker**, (b) **auto-detección** que enciende capas solas, y (c) separar **contenido portable** de la **entrega** específica de cada herramienta.

---

## 2. Diagnóstico del estado actual

### 2.1 Lo que ya está bien (v3 mejoró respecto a v2)

- Perfil de proyecto real (`qa-project.profile.yaml`) con `default.yaml` genérico y `flit.yaml` como overlay.
- KB completa (1750 líneas), mayormente teoría QA portable (shift-left, pirámide/panal/trofeo, BVA/EP, Playwright, API testing).
- Scripts `.mjs` (cross-platform por naturaleza) y runtime TS de evidencia presentes.
- La mayoría de literales ADO (estados, campos `Custom.*`, tags, picklists, patrón de título) **ya viven en el perfil**, no en el texto.

### 2.2 Bloqueadores de globalización (en orden de impacto)

| # | Bloqueador | Evidencia | Efecto |
|---|------------|-----------|--------|
| B1 | **Acoplamiento total a Azure DevOps; no existe modo "sin tracker"** | ~495 menciones Azure/ADO/`Custom.*` en skills+agentes; cero noción de Jira/GitHub/local | El kit no arranca sin ADO |
| B2 | **Preflight ADO obligatorio antes de cualquier intent** | `qa-orchestrator-agent` → "Inicio obligatorio" paso 2 corre `validate-qa-env.ps1 -TestRest` + MCP `user-ado`; FAIL detiene todo | Las pruebas **locales** quedan bloqueadas sin PAT |
| B3 | **Entrega atada a Cursor + Windows** | `install.ps1` (solo PowerShell), rutas `.cursor/`, reglas `.mdc`, scripts `.ps1` mandatorios, layout `frontend/e2e/` asumido | No corre en Claude Code, bash ni cross-platform |
| B4 | **Toda la evidencia desemboca en ADO** | Cada runner enruta a `evidence-publisher` → ADO; no hay *sink* local | "Pruebas locales" no pueden emitir reporte propio |
| B5 | **`default.yaml` no es "cero config"** | `layers_enabled` es lista fija; las tablas de detección existen pero no se promueven a un paso que **encienda capas solas** | Hay que listar capas a mano |
| B6 | **Sesgo de dominio en texto (no en perfil)** | `dev-tester` (namespaces `FLIT.*`, `dotnet`, Vitest), `db-test-runner`/runtime (`flit_dev:5433`, `psql`), `security` (OWASP API), `America/Bogota`, `flitsas`, `abrahamc` | Falla o asume stack ajeno |

### 2.3 Deuda / defectos que persisten

| # | Defecto | Ubicación |
|---|---------|-----------|
| D1 | `unit-test-runner` dice "append `Custom.Evidences`", contradiciendo la política (QA nunca escribe ahí; solo Discussion) | `skills/unit-test-runner/SKILL.md` |
| D2 | **Drift del manifest:** lista agentes y skills que no están en el kit (`backend-agent`, `frontend-agent`, `tech-lead-agent`, `integration-agent`, `architecture-agent`, `infra-agent`, `orchestrator-agent`, `flit-azure-devops`, `flit-crear-hu`, `flit-gestion-hu`, `flit-integration-ado`) | `manifest.yaml` |
| D3 | Reglas `.mdc` y workflows 100% FLIT/.NET/ADO, marcados `alwaysApply: true` | `rules/*.mdc`, `workflows/*` |
| D4 | Plantillas en dos ubicaciones (`dev-tester/assets/` vs `skills/templates/`) | varias |

---

## 3. Principios de diseño

1. **Local-first / invertir defaults.** Sin configuración, el tracker es `local`: ejecuta pruebas y escribe evidencia a `qa-evidence/` en el repo. Ningún paso de red es obligatorio.
2. **Configuración por convención, no por declaración.** Auto-detectar stack, arquitectura y capas a partir del repo. La config explícita solo **sobrescribe** lo detectado.
3. **Contenido portable ≠ entrega.** Los agentes/skills/plantillas/KB son Markdown neutro. `.cursor/`, `.mdc`, `.ps1` y rutas son **detalles de empaque**, no del contenido.
4. **Tracker como adaptador conectable.** ADO es **una** implementación de una interfaz, no el centro. `local` es el default; `azure-devops`, `github`, `jira` son intercambiables.
5. **Capas opcionales y degradables.** Cada capa (static/unit/api/e2e/db/security) se enciende sola si su herramienta existe, y degrada con aviso si falta —nunca aborta todo el ciclo.
6. **Cero literal de dominio en el texto.** Todo lo específico (timezone, naming de tests, BD, correos, proyecto) vive en perfil/env/runtime config.

---

## 4. Arquitectura objetivo

### 4.1 Estructura de carpetas

```
qa-kit/
├─ core/                         # 100% portable, sin .cursor / .ps1 / literales
│  ├─ agents/                    # orquestador + sub-agentes (tracker-agnósticos)
│  ├─ skills/                    # runners + diseño de pruebas
│  ├─ templates/                 # ÚNICA carpeta de plantillas
│  │  ├─ local/                  #   reportes md/html locales (NUEVO)
│  │  └─ trackers/azure-devops/  #   HTML específico de ADO (movido)
│  └─ knowledge-base.md          # KB depurada de FLIT
│
├─ adapters/
│  └─ trackers/
│     ├─ local/                  # DEFAULT — evidencia a repo, sin red (NUEVO)
│     ├─ azure-devops/           # adapter actual (renombrado/movido)
│     ├─ github/                 # (futuro)
│     └─ jira/                   # (futuro)
│
├─ profiles/
│  ├─ default.yaml               # local-first, layers: auto
│  ├─ presets/azure-devops.yaml  # preset de tracker ADO
│  └─ overlays/flit.yaml         # overlay de organización (extiende ADO)
│
├─ runtime/                      # código de apoyo (cross-platform)
│  ├─ e2e-support/               # generic: tracker-match, narrative, meta
│  ├─ e2e-support/db/            # helpers BD parametrizables
│  └─ scripts/                   # .mjs cross-platform + equivalentes node
│
├─ delivery/                     # EMPAQUE por herramienta — generado desde core/
│  ├─ cursor/                    # .cursor/, .mdc, install.ps1
│  ├─ claude-code/               # SKILL.md / AGENTS.md / CLAUDE.md
│  └─ plain/                     # repo plano + bash installer
│
├─ install.(ps1|sh|mjs)          # instalador multi-target
└─ manifest.yaml                 # inventario real (sin drift)
```

Regla clave: **`core/` es la fuente de verdad**; `delivery/*` se **genera/empaqueta** desde `core/` para cada runtime. Una sola edición → todos los destinos.

### 4.2 Capa de abstracción: `tracker-adapter`

Una interfaz única que cualquier tracker implementa. El orquestador y las skills **solo** hablan con esta interfaz, nunca con ADO directamente.

```
interface TrackerAdapter:
  preflight() -> {ok, mode}          # local: siempre ok, sin red
  get_work_item(id) -> WorkItem?     # local: lee .qa/work-items/{id}.md o devuelve stub
  resolve_requirements(ref) -> AC[]  # AC desde archivo, issue o WI
  publish_evidence(target, payload)  # → evidence-sink (local | tracker)
  create_defect(defect) -> id
  update_cycle(id, fields)           # local: no-op / escribe a reporte
  close_artifact(id, result)
  reactivate_requirement(id, info)   # reactiva la HU con novedad + comentario de trazabilidad del Bug
  capabilities() -> {attachments, custom_fields, comments, states}
```

`capabilities()` permite que las skills **degraden con elegancia**: si el tracker no soporta `custom_fields` (caso local), se omiten `TestStartDate`/`ReTest` sin romper el flujo.

| Implementación | Preflight | Evidencia | Estados/campos |
|----------------|-----------|-----------|----------------|
| **`local`** (default) | siempre OK, sin red | `qa-evidence/{fecha}/` md+html+png | no-op (resumen en reporte) |
| `azure-devops` | `.env` + PAT + REST | política dual (Discussion + Tasks) | `Custom.*`, estados ADO |
| `github` (futuro) | token GH | comentarios en issue/PR | labels + checklists |
| `jira` (futuro) | token Jira | comentarios + adjuntos | transiciones + custom fields |

### 4.3 Modelo de perfiles (resolución por capas)

Resolución por **deep-merge** en orden:

```
default.yaml  ←  presets/<tracker>.yaml  ←  overlays/<org>.yaml  ←  qa-project.profile.yaml (repo)
```

- **Proyecto nuevo sin nada:** usa `default.yaml` (`tracker: local`, `layers: auto`) → corre ya.
- **Proyecto con ADO:** overlay de 3 líneas (`profile: azure-devops` + nombre de proyecto) → hereda todo el preset.
- **Equipo FLIT:** `overlays/flit.yaml` extiende `azure-devops` con sus convenciones (`QA_TC##`, `Test QA`, etc.).

`default.yaml` (esqueleto objetivo, recortado):

```yaml
tracker: local            # local | azure-devops | github | jira
project:
  name: auto              # auto = nombre de carpeta/git remote
  architecture: auto      # monolith | microservices | react-spa | api-rest | auto
locale:
  timezone: auto          # auto = TZ del sistema  (antes: America/Bogota hardcodeado)
stack:
  backend: auto           # dotnet | node | python | java | go | auto
  frontend: auto          # react | vue | none | auto
testing:
  layers_enabled: auto    # auto = detección por repo  (antes: lista fija)
  ac_format: auto
evidence:
  sink: auto              # auto = sigue al tracker (local→local, ado→dual)
  output_dir: qa-evidence
runtime:
  db:
    driver: auto          # postgres | mysql | sqlite | none | auto
    connection: env       # desde env, nunca hardcode (antes: flit_dev:5433)
security:
  target_profile: auto    # api | web | generic | auto
supervision:
  enabled: false          # bloque "@encargado" solo si el tracker lo requiere
```

### 4.4 Auto-detección (`qa-detect`) — la clave del "sin config"

Promover las tablas de detección ya existentes (hoy dispersas en cada skill) a **un paso único** que el `qa-decision-engine` ejecuta primero. Con `layers_enabled: auto`, cada capa se enciende sola:

| Señal en el repo | Enciende |
|------------------|----------|
| `vitest.config` / `jest` / `pytest` / `*.csproj` en tests | `unit` |
| `playwright.config` / specs e2e | `e2e` |
| `openapi.yaml` / colección Postman | `api` |
| `migrations/` / `pgtap` / testcontainers | `db` |
| `semgrep` / `bandit` / cambios en auth | `security` |
| `eslint` / `ruff` / `tsc` / `mypy` | `static` |

Resultado: un repo nuevo no necesita declarar capas; el kit prueba **lo que el repo permite probar** y reporta lo que omitió y por qué.

### 4.5 Evidence sink desacoplado

Los runners dejan de saber de ADO. Emiten un **objeto de evidencia normalizado**; el *sink* decide destino:

```
runner → EvidenceObject{layer, tc_id, status, files[], narrative, metrics}
       → evidence-sink(profile.evidence.sink)
          ├─ local: render md/html + copia png/webm a qa-evidence/
          └─ azure-devops: política dual (Discussion HU + adjuntos Task-TC)
```

Esto elimina ADO de `static/unit/api/db/security/e2e` y resuelve de paso la contradicción D1 (un solo punto decide el destino).

### 4.6 Targets de entrega

| Target | Empaque | Notas |
|--------|---------|-------|
| **Cursor** | `.cursor/{agents,skills,rules,workflows}`, `.mdc`, `install.ps1` | Lo actual; pasa a ser **un** target |
| **Claude Code** | `SKILL.md` por skill, `AGENTS.md`/`CLAUDE.md`, install `.sh/.mjs` | Skills con frontmatter estándar |
| **Plano** | carpeta `qa-kit/` + CLI Node | Para cualquier IDE/CI |

El contenido es idéntico; cambia solo el contenedor y el formato del frontmatter.

---

## 5. Mapa `literal → clave de perfil`

Inventario de todo lo que hoy está cableado y a dónde debe migrar. **"Ya"** = el v3 ya lo parametrizó; **"NUEVO"** = clave a crear.

| Literal hoy | Dónde aparece | Clave de perfil / mecanismo | Estado |
|-------------|---------------|-----------------------------|--------|
| Azure DevOps como único tracker | global | `tracker:` (local default) | **NUEVO** |
| `FLIT - EVOLUTION` (proyecto) | adapter, validator | `env.AZURE_PROJECT_NAME` | Ya |
| `Resolved` / `Active` / `Closed` | agentes, skills | `azure.work_item.*_state` | Ya |
| `Custom.Evidences/Testing/ReTest/Manuales/TestStartDate/TestEndDate` | adapter, evidence | `azure.fields.*` | Ya |
| Tags `QA_PDN` / `QA_NOVEDAD` | orquestador, evidence | `certified_tag` / `defect_tag` | Ya |
| `Test QA` / `No Test` | adapter, evidence | `testing_values.*` | Ya |
| `QA_TC##` (título TC) | validator, matching | `test_case_title_pattern/prefix` | Ya |
| `America/Bogota` | adapter, validator, scripts | `locale.timezone: auto` | **NUEVO** |
| `flit_dev` / `:5433` / `psql` | db-runner, psql-helpers, README-e2e | `runtime.db.{driver,connection}` (env) | **NUEVO** |
| `.NET` / `FLIT.<Modulo>.*` / `dotnet` / Vitest | dev-tester, evidences-template | `stack.{backend,frontend}` + language packs | **NUEVO** |
| `daniel.amado@flitsas.com` | adapter (ejemplo), playwright | `env.USER_REAL_EMAIL` | Ya (pero queda en texto) |
| `abrahamc` (raíz repo) | adapter, scripts, docs | `install.TargetRepo` (param) | Ya (pero queda en texto) |
| `.cursor/...` (rutas) | casi todo | resuelto por **delivery target** | **NUEVO** |
| Bloque supervisión "@encargado" siempre | adapter, plantillas | `supervision.enabled` (tracker-gated) | **NUEVO** |
| OWASP **API** Top 10 (foco fijo) | security-runner | `security.target_profile: api\|web\|generic` | **NUEVO** |
| Evidencia siempre a ADO | todos los runners | `evidence.sink: auto` | **NUEVO** |
| `layers_enabled` lista fija | perfil | `layers_enabled: auto` + `qa-detect` | **NUEVO** |
| Preflight ADO obligatorio | orquestador | condicional a `tracker != local` | **NUEVO** |

**Lectura:** el v3 ya parametrizó casi todo lo de ADO. El trabajo de globalización se concentra en **~10 claves nuevas**, la mayoría con default `auto`.

---

## 6. Plan de migración archivo por archivo

Leyenda de acción: **PORTAR** (mover a `core/` casi tal cual) · **REFACTOR** (cambios de fondo) · **DIVIDIR** (separar genérico/específico) · **NUEVO** · **MOVER** (a `delivery/` u overlay) · **FIX**.

### 6.1 Agentes (`core/agents/`)

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `qa-orchestrator-agent.md` | **REFACTOR** | "Inicio obligatorio": preflight **condicional** a `tracker != local`; reemplazar referencias ADO por `tracker-adapter`; quitar "Política FLIT" del cuerpo → overlay |
| `qa-executor-agent.md` | REFACTOR | Capas vía `qa-detect`; evidencia vía `evidence-sink`; quitar `Custom.*`/`TestStartDate` del flujo base (los aporta el adapter ADO) |
| `qa-generator-agent.md` | REFACTOR | Quitar pasos 6a/6b/6c específicos de ADO al adapter; corregir numeración duplicada (deuda v2) |
| `qa-explorer-agent.md` | PORTAR | Ya es casi neutro (Playwright MCP); solo limpiar refs `azure-devops-adapter` → `tracker-adapter` |
| `qa-healer-agent.md` | PORTAR | Neutro; sin cambios de fondo |

### 6.2 Skills — runners (`core/skills/`)

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `static-analysis-gate` | PORTAR | Ya stack-agnóstico; salida → `evidence-sink` |
| `unit-test-runner` | **FIX** + REFACTOR | Quitar "append `Custom.Evidences`" (D1); salida → `evidence-sink` |
| `api-test-runner` | PORTAR | Neutro; salida → `evidence-sink` |
| `db-test-runner` | DIVIDIR | Checks genéricos en `core`; conexión/driver a `runtime.db`; quitar `flit_dev`/Postgres-only → `driver: auto` |
| `security-test-runner` | REFACTOR | `target_profile: api\|web\|generic`; OWASP API deja de ser el único modo |
| `playwright-runner` | DIVIDIR + REFACTOR | Renombrar a `e2e-runner`; PASO 0 ADO → preflight condicional; export de PAT solo si sink=ado; evidencia → `evidence-sink` |
| `regression-selector` | PORTAR | WIQL → query del adapter (local: lee índice de TCs locales) |

### 6.3 Skills — diseño y decisión

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `qa-decision-engine` | REFACTOR | Absorbe `qa-detect`; emite capas + arquitectura detectadas |
| `test-case-generator` | PORTAR | Neutro (BVA/EP); refs KB intactas |
| `test-case-validator` | DIVIDIR | Validación de formato en `core`; publicación ADO (6a/6b/6c) al adapter |
| `test-plan-generator` | PORTAR | Neutro; plantilla local + ADO |

### 6.4 Tracker y evidencia

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `azure-devops-adapter/` | MOVER + REFACTOR | A `adapters/trackers/azure-devops/`; implementa la interfaz `TrackerAdapter`; `validate-qa-env.ps1` pasa a ser preflight **de este adapter** |
| `adapters/trackers/local/` | **NUEVO** | Default sin red: stubs de WI, evidencia a `qa-evidence/`, `update_cycle` no-op |
| `core/tracker-adapter` (contrato) | **NUEVO** | Interfaz + `capabilities()` |
| `evidence-publisher` | REFACTOR | Renombrar a `evidence-sink`; `local` (md/html) default, `azure-devops` (dual) opcional; resuelve destino único (cierra D1) |

### 6.5 dev-tester → pack opcional (fuera del core)

**Decisión (§9.2):** `dev-tester` se retira del core QA. Es una skill **del lado desarrollo**, no del flujo QA, y la más acoplada (`FLIT.*`, dotnet, Vitest). Se archiva en `packs/dev-side/`, **sin instalar por defecto**.

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `dev-tester/SKILL.md` | **MOVER** (a `packs/dev-side/`) | Sale del core; no se globaliza ahora. Si se retoma: núcleo neutro + **language packs** (`dotnet`, `node`, `python`) por `stack.*` |
| `dev-tester/assets/evidences-template.md` | MOVER (con el pack) | **No** va a `core/templates/`; viaja con el pack dev-side |

> La capa unit del flujo QA queda cubierta por `unit-test-runner` (ejecuta y resume specs existentes, sin generar código ni acoplarse a un stack).

### 6.6 Plantillas (`core/templates/`)

| Archivo | Acción |
|---------|--------|
| `bug.template.md`, `test-case.template.md`, `test-plan.template.md`, `evidence.template.md` | PORTAR (ya neutros) |
| `*.html` (ado-supervision, bug-ado, test-case-ado, qa-parent-evidence-summary, qa-tc-design-parent-comment) | MOVER a `templates/trackers/azure-devops/` |
| Reporte local md/html | **NUEVO** en `templates/local/` |

### 6.7 KB, reglas, workflows

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `qa-agent-knowledge-base.md` | DIVIDIR | ~90% portable (teoría QA); extraer ejemplos FLIT/.NET/ADO a apéndice de overlay |
| `rules/flit-agents.mdc` | MOVER | A `overlays/flit` + `delivery/cursor`; **no** `alwaysApply` en el kit genérico |
| `rules/hu-lifecycle-ado.mdc` | MOVER | Específico ADO → `adapters/azure-devops` + delivery cursor |
| `workflows/*` | MOVER | FLIT/ADO → overlay; crear workflows genéricos mínimos en core |

### 6.8 Runtime TS

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `tc-ado-match.ts` (+ `.test.ts`) | REFACTOR | Generalizar a `tracker-match.ts` (ADO como una estrategia) |
| `qa-meta.ts`, `qa-narrative.ts`, `api-evidence.ts` | PORTAR | Neutros; usados por el sink |
| `auth-helpers.ts` | DIVIDIR | Patrón genérico de login + ejemplo "curtain" como muestra de proyecto |
| `psql-helpers.ts` | DIVIDIR | `runSql/sqlLines` genéricos; defaults `flit_dev:5433` → `runtime.db` |
| `_qa_evidence_capture.ts`, `_qa_evidence_reporter.ts`, `playwright.evidence.config.ts.example` | REFACTOR | Reporter habla con `evidence-sink`, no con ADO directo |

### 6.9 Scripts, instalador, manifest

| Archivo | Acción | Cambios |
|---------|--------|---------|
| `qa-ado-cycle-fields.mjs`, `publish-qa-evidence-ado.mjs` | MOVER | A `adapters/azure-devops/scripts/` (específicos de ese tracker) |
| `run-qa-hu-playwright.ps1` | REFACTOR | Equivalente Node cross-platform; `.ps1` queda en delivery/cursor |
| `validate-qa-env.ps1` | MOVER | Preflight **del adapter ADO**; añadir equivalente Node |
| `install.ps1` | REFACTOR | Instalador **multi-target** (`-Target cursor|claude-code|plain`); añadir `install.sh`/`install.mjs` |
| `manifest.yaml` | **FIX** | Eliminar drift (D2): quitar agentes/skills inexistentes; reflejar `core/adapters/delivery` |

---

## 7. Roadmap por fases

| Fase | Entregable | Resultado |
|------|-----------|-----------|
| **F0 — Andamiaje** | Estructura `core/adapters/delivery/profiles`; `default.yaml` local-first; contrato `tracker-adapter`; `local` adapter mínimo | El kit "existe" en forma global |
| **F1 — Local-first corre** | `qa-detect` + `evidence-sink local` + preflight condicional; runners emiten reporte local | **Cualquier repo corre static/unit/e2e local sin config** |
| **F2 — ADO como adapter** | Mover ADO a `adapters/`; sink dual opt-in; fix D1/D2 | Paridad con hoy, pero desacoplado |
| **F3 — Cobertura de capas** | `db` (driver auto), `security` (api/web/generic), api contract | e2e/bd/seguridad locales completos |
| **F4 — Multi-delivery** | `delivery/claude-code` + `delivery/plain`; installer cross-platform | Corre fuera de Cursor/Windows |
| **F5 — Más trackers** | `github` / `jira` adapters | Globalización plena |

---

## 8. Criterios de aceptación ("definition of global")

- [ ] `git clone` de un repo cualquiera + ejecutar el kit → corre `static/unit/e2e` y deja `qa-evidence/` **sin** PAT, `.env`, ni editar perfil.
- [ ] `layers_enabled: auto` enciende solo las capas cuya herramienta existe; las demás se omiten **con aviso**, sin abortar.
- [ ] Cambiar de `local` a `azure-devops` = overlay de ≤5 líneas; ningún cambio en skills.
- [ ] Cero literales `FLIT/abrahamc/flitsas/America-Bogota/flit_dev` fuera de `overlays/flit.yaml`.
- [ ] El mismo `core/` se empaqueta para Cursor y Claude Code sin editar contenido.
- [ ] `manifest.yaml` lista solo lo que existe; `unit-test-runner` no menciona `Custom.Evidences`.

---

## 9. Decisiones (resueltas)

| # | Decisión | Resolución | Impacto en el diseño |
|---|----------|------------|----------------------|
| 1 | **Targets de entrega** | **Cursor + Claude Code + repo plano**, los tres desde el inicio | `delivery/{cursor,claude-code,plain}` es parte de F0; el frontmatter de skills se estandariza para servir a los tres |
| 2 | **`dev-tester`** | **Fuera del `core/`.** Es flujo dev, no QA. Se archiva como **pack opcional** `packs/dev-side/dev-tester/`, **no** instalado por defecto | El core QA no carga sesgo `.NET`/Vitest. `unit-test-runner` cubre la capa unit del lado QA. El pack opcional se globaliza solo si se decide después (language packs) |
| 3 | **Formato del reporte local** | **Ambos:** HTML (para abrir) + Markdown (para diff/CI). El sink `local` emite los dos | `templates/local/` lleva `report.md.tmpl` y `report.html.tmpl`; `evidence-sink local` renderiza ambos en `qa-evidence/{fecha}/` |
| 4 | **Trackers de fase 5** | **Ambos:** GitHub Issues **y** Jira | `capabilities()` se diseña desde F0 contemplando los 3 destinos (issue/PR comments + labels/checklists en GH; transiciones + custom fields en Jira) para no rehacer la interfaz |
| 5 | **Compatibilidad hacia atrás** | **Sin paridad estricta — corte limpio.** Responsable único = QA. FLIT se preserva **como overlay** (`overlays/flit.yaml`), no como restricción del core | F2 no debe replicar byte-a-byte el comportamiento ADO; basta con que el overlay FLIT siga funcionando. Libera el refactor para priorizar lo local-first |

### Nota sobre `dev-tester`

Se retira de la sección **6.5** del plan de migración como skill del core. Pasa a `packs/dev-side/` (opcional, sin instalar por defecto). Su plantilla `evidences-template.md` **no** se mueve a `core/templates/`; viaja con el pack. La capa unit del flujo QA queda cubierta por `unit-test-runner` (que solo ejecuta y resume specs existentes, sin generar ni acoplarse a un stack).
