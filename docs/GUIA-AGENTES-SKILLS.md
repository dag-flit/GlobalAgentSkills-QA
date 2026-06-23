# Guía de agentes, skills y archivos — qa-kit

Catálogo de las piezas del kit: qué hace cada una, qué entra y qué sale, y cómo se invocan.
Para correrlo ver **GUIA-USO.md**; para extenderlo, **GUIA-EXTENSION.md**.

## Modelo mental

```
qa-orchestrator (runQaCycle)
  ├─ 1. resuelve perfil + selecciona tracker-adapter (local|azure-devops|github|jira)
  ├─ 2. preflight CONDICIONAL  (solo si el tracker requiere red)
  ├─ 3. qa-detect              (qué capas encender)
  ├─ 4. runners por capa       (static/unit/e2e/db/security/api) → EvidenceObject[]
  ├─ 5. adapter.publishEvidence → evidence-sink (local md/html | comentario remoto)
  └─ 6. novedades (si hay fallas) → por HU: createDefect + reactivateRequirement
        (Bug enlazado a la HU + reactivar la HU + comentario de trazabilidad)
```

Regla de oro: **las skills (runners) nunca hablan con un tracker**. Emiten un objeto de
evidencia normalizado; el adapter/sink decide el destino.

## Objeto de evidencia normalizado (`EvidenceObject`)

Todos los runners devuelven este objeto (ver `core/tracker-adapter/CONTRACT.md`):

```js
{
  layer: "e2e",                 // static|unit|api|e2e|db|security
  tc_id: "TC-02",               // opcional
  status: "pass" | "fail" | "skip",
  files: ["shot1.png"],         // rutas locales, opcional
  narrative: "login redirect roto",
  metrics: { tool: "playwright", exitCode: 1 },
  cases: [                      // TC individuales de la capa, opcional (ver abajo)
    { name: "auth › login", status: "pass", duration: 45, message: null },
  ],
  work_item_id: "123"           // opcional
}
```

**`cases[]` — detalle por TC.** Cuando la herramienta expone un reporter JSON nativo
(`vitest`/`jest`/`playwright`/`eslint`/`ruff`/`semgrep`/`bandit`), el runner extrae los casos
individuales (`runtime/runners/parse-cases.mjs`) y los adjunta como `cases`: cada uno con
`{ name, status, duration, message }`. El sink local y los adapters remotos lo renderizan como
sección de detalle por capa. Si la salida no es el JSON esperado, se OMITE `cases` y queda solo
la `narrative` (degradación, nunca rompe el ciclo).

## Agente

### `qa-orchestrator`  ·  `core/agents/qa-orchestrator/AGENT.md`  ·  `runtime/orchestrator.mjs`

Punto de entrada del ciclo (`runQaCycle`). Encadena preflight condicional → detección →
runners → sink. **Preflight condicional**: solo corre si `adapter.capabilities().network`
es `true` (gating por capability, no por el literal `"local"`); con `local` arranca directo,
con ADO/github/jira corre preflight y un FAIL detiene el ciclo antes de los runners.

```js
import { runQaCycle } from "./runtime/orchestrator.mjs";
const summary = await runQaCycle({ repoRoot, env: process.env, workItemId: "123" });
// { ok, stopped, tracker, preflight, detection, results: EvidenceObject[], report,
//   novelties,   // null=no aplica | []=sin fallas | [{work_item_id,bugId,reactivation}]
//   warnings }   // avisos no fatales (p.ej. tracker remoto sin -w)
```

Tras publicar la evidencia, si hay **fallas** el orquestador maneja la **novedad** (paso 6):
agrupa las fallas por la HU a la que pertenecen (la `work_item_id` que declare cada resultado,
o la HU del ciclo `-w`) y por cada HU crea un Bug enlazado a ella (`createDefect`) y la reactiva
con trazabilidad (`reactivateRequirement`). Gated por `capabilities().states` (en `local` es
no-op). **Guarda sin `-w`:** un tracker remoto sin HU real degrada a solo reporte local + un
aviso en `warnings`, en vez de comentar sobre una HU inexistente (404 online).

## Skills — detección

### `qa-detect`  ·  `core/skills/qa-detect/SKILL.md`  ·  `runtime/detect/qa-detect.mjs`

Inspecciona el repo (archivos-marcador + deps de `package.json`) y devuelve qué capas
encender, el stack y la arquitectura. `resolveEnabledLayers(profile, detection)` reconcilia
con el perfil: `auto` usa lo detectado; una lista explícita gana.

```js
import { detectRepo, resolveEnabledLayers } from "./runtime/detect/qa-detect.mjs";
const det = detectRepo({ repoRoot });          // { stack, architecture, layers, enabled, skipped }
const { enabled } = resolveEnabledLayers(profile, det);
```

## Skills — runners (una por capa)

Todas comparten `runtime/runners/_runner-core.mjs` (resolución de binario, **ejecución
inyectable** vía `exec`, mapeo a `EvidenceObject`). Cada runner aporta solo su registro de
herramientas (`tool → argv`, fijo o función).

| Skill (doc) | Runtime | Capa | Herramientas → comando |
|-------------|---------|------|------------------------|
| `static-analysis-gate` | `runners/static-analysis.mjs` | `static` | eslint `.` · tsc `--noEmit` · ruff · mypy |
| `unit-test-runner` | `runners/unit.mjs` | `unit` | vitest `run` · jest · pytest · dotnet `test` |
| `e2e-runner` | `runners/e2e.mjs` | `e2e` | playwright `test` · cypress `run` |
| `db-test-runner` | `runners/db.mjs` | `db` | pg_prove (conexión desde `env`) · prisma `migrate status` |
| `security-test-runner` | `runners/security.mjs` | `security` | semgrep `auto`/`target_profile` · bandit — **zero-config** |
| `api-test-runner` | `runners/api.mjs` | `api` | newman `run <colección>` · `redocly lint <spec>` (OpenAPI, offline) |

Mapeo de resultado común: exit `0` → `pass`; exit `≠0` → `fail`; herramienta ausente, sin
conexión o sin runner → `skip` **con aviso**. Un spec puede declarar **`skipCodes`** (exit que
significa "error de herramienta, no hallazgo") → ese código se mapea a `skip` en vez de `fail`.
Notas por capa:

- **db**: la conexión **siempre** viene de `env` (`DATABASE_URL`/`PG_CONNECTION`/`DB_CONNECTION`);
  `_runner-core` la **reenvía al proceso hijo**, así que cualquier proyecto que la exporte activa
  la capa sin tocar el kit. `prisma` también guarda la conexión (sin ella → `skip` accionable).
  `migrations/` y testcontainers se omiten (sin runner standalone).
- **security · zero-config**: enciende en **cualquier** repo sin `.semgrep.yml` (qa-detect elige
  `bandit` para Python, `semgrep auto` para el resto). `security.target_profile` (api|web|generic|auto)
  decide el ruleset de semgrep. Hallazgo → `fail`; error del escáner (exit 2, sin red/config) →
  `skip` (`skipCodes: [2]`); escáner no instalado → `skip`. La detección de "no ejecutable" es
  locale-independiente (`isExecutable` resuelve PATH/PATHEXT antes de lanzar).
- **api · OpenAPI**: `redocly lint` valida el contrato **sin servidor** (vía `npx`, zero-config;
  ruleset por perfil `api.openapi_ruleset`, default `minimal`). Errores de contrato → `fail`.
- **unit**: **no genera** tests ni asume stack; solo corre los existentes (D1: jamás escribe
  `Custom.Evidences`). La generación es del pack opcional `dev-side`, fuera del core.

```js
import { runStaticAnalysis } from "./runtime/runners/static-analysis.mjs";
const ev = runStaticAnalysis({ repoRoot, profile, detection });   // EvidenceObject
```

## Tracker-adapters (plug-ins)

Contrato único en `core/tracker-adapter/` (`CONTRACT.md` + base + factory). El orquestador y
las skills hablan **solo** con este contrato. Cambiar de tracker = cambiar `tracker:` en el
perfil. Todos (salvo `local`) usan un cliente REST con **transporte HTTP inyectable** →
offline-testable.

| Adapter | `tracker:` | Evidencia | custom_fields | Notas |
|---------|-----------|-----------|:-------------:|-------|
| `local` | `local` (default) | md+html en `qa-evidence/` | no | sin red, sin PAT, preflight siempre OK |
| `azure-devops` | `azure-devops` | Discussion del padre + adjuntos TC→Task + local | sí (`Custom.*`) | `tc-match` resuelve `tc_id`→Task; reactiva la HU a `Active` |
| `github` | `github` | comentario en el issue + local | no (labels) | adjuntos se listan en el comentario; reactiva = reabrir issue |
| `jira` | `jira` | comentario ADF + local | sí (`customfield_*`) | transiciones para cerrar y para `reactivate` |

Los 8 métodos del contrato: `preflight`, `getWorkItem`, `resolveRequirements`,
`publishEvidence`, `createDefect`, `updateCycle`, `closeArtifact`, `reactivateRequirement`, más
`capabilities()`. `reactivateRequirement(id, {bugId, items})` reactiva la HU con novedad (estado
del perfil; nunca la cierra) y deja la trazabilidad del Bug en su comentario. `capabilities()`
permite que las skills **degraden** lo que un tracker no soporta sin romperse.

## Perfiles

| Archivo | Rol |
|---------|-----|
| `profiles/default.yaml` | local-first: `tracker: local`, `layers: auto`. Un repo corre solo con esto |
| `profiles/presets/azure-devops.yaml` | estados, campos `Custom.*`, `tc_ado_matching` |
| `profiles/presets/github.yaml` | label de defecto, estados open/closed |
| `profiles/presets/jira.yaml` | tipo de bug, `customfield_*`, ids de transición |
| `profiles/overlays/flit.yaml` | **único** lugar con literales de la organización FLIT |

Resolución: `default ← presets/<tracker> ← overlays/<org> ← .qa/qa-project.profile.yaml`.

## Runtime de apoyo

| Archivo | Rol |
|---------|-----|
| `runtime/profile/yaml-lite.mjs` | cargador YAML mínimo, sin dependencias |
| `runtime/profile/resolve-profile.mjs` | resuelve el perfil efectivo por deep-merge |
| `runtime/evidence/local-sink.mjs` | renderiza el reporte local md+html |
| `runtime/cli.mjs` | entrypoint del kit (códigos de salida 0/1/2/3) |
| `runtime/delivery/build.mjs` | empaqueta `core/` a plain/claude-code/cursor |
| `runtime/smoke-test.mjs` | prueba todo el plumbing sin red (25/25) |
| `adapters/_shared/parse-ac.mjs` | normaliza AC desde texto/markdown (github+jira) |

## Cómo se invocan

- **Usuario / CI:** `node runtime/cli.mjs <repo>` (o el `bin/qa.mjs` del paquete generado).
- **Programático:** `import { runQaCycle } from "runtime/orchestrator.mjs"`.
- **Claude Code / Cursor:** los `SKILL.md`/`AGENT.md` (con su frontmatter) se empaquetan al
  target correspondiente; el agente `qa-orchestrator` orquesta y cada runner es una skill.
