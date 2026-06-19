# qa-kit — memoria del proyecto (para Claude Code)

> Este archivo lo lee Claude Code automáticamente al abrir el repo. Es el puente entre
> el trabajo hecho hasta ahora y la continuación. Mantenerlo actualizado al cerrar cada fase.

## Qué es esto

Reescritura **local-first y sin sesgo** de un kit de agentes/skills de QA que hoy está
acoplado a Azure DevOps + Cursor + Windows + dominio FLIT. Objetivo: que **cualquier
proyecto** corra `static / unit / e2e / db / security` y deje un reporte local, **sin PAT,
sin Cursor y sin configurar nada**. El tracker (ADO/GitHub/Jira) es un plug-in opcional.

Plan completo: **`docs/qa-kit-arquitectura-global.md`** (léelo antes de tocar nada).

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
  - `db.mjs`: pgtap/prisma; **conexión SIEMPRE desde env** (`DATABASE_URL`…), nunca cableada.
  - `security.mjs`: semgrep/bandit; `security.target_profile` (api|web|generic) ajusta el ruleset.
  - `api.mjs`: colección Postman → `newman run`; OpenAPI sin runner estándar → skip con aviso.
  - Registrados en `RUNNERS`; el orquestador pasa `env` a los runners. Skills `db/security/api`.
  - qa-detect: `db` prefiere herramienta ejecutable (pgtap/prisma) sobre `migrations/` suelto.
  - Smoke test: `node runtime/smoke-test.mjs` → **15/15 OK** (casos 14-15 cubren las 6 capas).
- **F4 (Multi-delivery) — SIGUIENTE.** Ver "Próximas tareas".

## Invariantes (no romper)

1. **`core/` es portable.** Cero literales de dominio: nada de `FLIT`, `abrahamc`, `flitsas`,
   `America/Bogota`, `flit_dev`, `.NET`, rutas `.cursor/`. Todo eso vive SOLO en
   `profiles/overlays/flit.yaml` o en `delivery/`.
2. **Las skills hablan solo con `tracker-adapter`**, nunca con ADO/GitHub/Jira directo.
3. **Local-first:** ningún paso de red es obligatorio. Con `tracker: local` todo corre sin PAT.
4. **Evidencia normalizada → sink.** Los runners emiten `{layer, tc_id, status, files, narrative}`
   y el sink decide destino (`local` = md+html; `dual` = ADO en F2). Un runner nunca escribe
   en un tracker directamente.
5. **Node `.mjs`, cross-platform.** Sin PowerShell ni Python en `core/`/`runtime/`.
6. **Tres targets de entrega** (Cursor, Claude Code, repo plano) comparten el mismo `core/`.
7. **`dev-tester` está fuera del core** (en `packs/dev-side/`, opcional). No lo reincorpores.
8. **El smoke test queda verde.** Tras cada cambio: `node runtime/smoke-test.mjs`. Si agregas
   capacidades, agrega su caso al smoke test.

## Mapa del repo

```
core/tracker-adapter/   contrato (CONTRACT.md + base + factory)
adapters/trackers/      local/ (default) , azure-devops/ (stub→F2)
profiles/               default.yaml , presets/azure-devops.yaml , overlays/flit.yaml
runtime/                profile/ (yaml-lite + resolver) , evidence/ (local sink) , smoke-test.mjs
delivery/               cursor/ , claude-code/ , plain/   (empaque — F4)
packs/dev-side/         dev-tester (opcional, no se instala)
manifest.yaml           inventario real
```

## Resolución de perfil

`default.yaml ← presets/<tracker>.yaml ← overlays/<org>.yaml ← qa-project.profile.yaml`
Repo sin perfil → `tracker: local`, `layers: auto`. `profile: flit` → hereda `flit←azure-devops←default`.

## Comandos

```bash
node runtime/smoke-test.mjs        # verificar plumbing (debe dar 15/15 OK)
```

## F1 — cerrada (resumen)

Las 4 tareas están **HECHAS** (ver "Estado actual"): `qa-detect`, runners `static/unit/e2e`
con `_runner-core` y ejecutor inyectable (D1 cerrada), y preflight condicional en el
orquestador. Criterio de salida F1 cumplido y cubierto por el smoke test (10/10).

## Próximas tareas (F4 — multi-delivery)

El mismo `core/` se empaqueta para cada runtime (decisión §9.1: los tres desde el inicio):

1. **`delivery/claude-code`:** generar `SKILL.md`/`AGENTS.md` con frontmatter estándar desde
   `core/skills` y `core/agents`. Hoy ya hay frontmatter; falta el empaquetador.
2. **`delivery/plain`:** carpeta `qa-kit/` + CLI Node (`runQaCycle` como entrypoint).
3. **`delivery/cursor`:** `.cursor/{agents,skills}`, `.mdc`, `install.ps1` (el target heredado).
4. **Instalador multi-target** (`install.mjs -Target …`) + mantener manifest sin drift.

> Patrón a respetar: `core/` es la fuente de verdad; `delivery/*` se GENERA desde core/.
> Ejecución/transporte inyectables → todo se prueba offline.

## Estilo de trabajo con Claude Code

- Cambios pequeños y verificables; corre el smoke test antes de dar una tarea por cerrada.
- Si tocas el contrato `tracker-adapter`, actualiza `CONTRACT.md` y los dos adapters.
- Al cerrar una fase, actualiza la sección "Estado actual" y "Próximas tareas" de este archivo.
