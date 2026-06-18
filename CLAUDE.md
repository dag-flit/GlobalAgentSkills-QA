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
  (md+html), stub de ADO, manifest sin drift. Smoke test: `node runtime/smoke-test.mjs` → 6/6 OK.
- **F1 (Local-first corre) — SIGUIENTE.** Ver "Próximas tareas".

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
node runtime/smoke-test.mjs        # verificar plumbing (debe dar 6/6 OK)
```

## Próximas tareas (F1 — en orden)

1. **`qa-detect`** (`core/skills/qa-detect/` + helper en `runtime/`): detecta capas y stack
   a partir del repo (playwright.config→e2e, *.csproj/pytest/vitest→unit, openapi→api,
   migrations/pgtap→db, semgrep/auth→security, eslint/ruff→static). Hace que
   `layers_enabled: auto` encienda solo lo que existe. Añadir caso al smoke test.
2. **Portar `static-analysis-gate`** como primer runner de punta a punta: detecta herramienta,
   ejecuta, y emite el **objeto de evidencia normalizado** al sink local. Sin ADO.
3. **Preflight condicional** en el orquestador: el preflight de tracker solo corre si
   `tracker != local`. Con `local`, arranca directo.
4. Repetir el patrón del paso 2 con `unit` y `e2e` (corrigiendo de paso la deuda D1:
   `unit-test-runner` no debe mencionar `Custom.Evidences`).

Criterio de salida F1: `git clone` de un repo cualquiera + correr el kit → ejecuta
`static/unit/e2e` y deja `qa-evidence/` sin PAT ni editar perfil.

## Estilo de trabajo con Claude Code

- Cambios pequeños y verificables; corre el smoke test antes de dar una tarea por cerrada.
- Si tocas el contrato `tracker-adapter`, actualiza `CONTRACT.md` y los dos adapters.
- Al cerrar una fase, actualiza la sección "Estado actual" y "Próximas tareas" de este archivo.
