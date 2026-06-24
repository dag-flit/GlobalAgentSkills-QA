# Contrato `tracker-adapter`

Interfaz **única** que toda integración de tracker implementa. El orquestador y las skills hablan **solo** con este contrato — nunca con Azure DevOps, GitHub o Jira directamente. Cambiar de tracker = cambiar `tracker:` en el perfil; ninguna skill se entera.

## Métodos

| Método | Qué hace | `local` (default) |
|--------|----------|-------------------|
| `preflight()` | Valida que el tracker puede operar | Siempre `{ok:true}`, sin red |
| `getWorkItem(id)` | Devuelve el requisito/HU | Lee `.qa/work-items/{id}.md` o devuelve un stub |
| `resolveRequirements(ref)` | Extrae los AC | De Gherkin/checklist/viñetas del archivo local |
| `listChildren(id)` | Lista los hijos jerárquicos de un work item (Feature → HUs) | `[]` (sin jerarquía remota) |
| `publishEvidence(target, payload)` | Entrega la evidencia normalizada | Reporte `md`+`html` en `qa-evidence/` |
| `createDefect(defect)` | Registra un defecto | Archivo md en `qa-evidence/defects/` |
| `updateCycle(id, fields)` | Campos de ciclo (TestStartDate, ReTest…) | no-op |
| `closeArtifact(id, result)` | Cierra Task-TC / Bug (nunca el padre) | no-op |
| `reactivateRequirement(id, info)` | Reactiva la HU con novedad + comentario de trazabilidad del Bug | no-op (sin estados/comentarios) |
| `publishRequirementEvidence(requirementId, info)` | Por HU: asegura **un TC (Task) por criterio** (idempotente por clave `TC-AC<n>`) + comenta el resultado en la HU | no-op (`{ok, skipped}`) |
| `publishTestPlan(featureId, info)` | Crea/actualiza el **Plan de Pruebas del Feature** (Task "PLAN PRUEBAS FEATURE…" con objetivo + HUs/TC + alcance + resultado) | no-op (`{ok, skipped}`) |
| `capabilities()` | Qué soporta el tracker | ver abajo |

### `reactivateRequirement(id, info)` — manejo de novedad sobre el requisito

A diferencia de `closeArtifact` (que cierra Task/Bug y **nunca** toca el padre), este método **sí** opera sobre el requisito padre (HU), pero solo lo **reactiva** al estado de novedad del perfil — nunca lo cierra (eso es exclusivo del PO). Además deja un comentario de **trazabilidad** en la misma HU enlazando el Bug creado y los hallazgos.

- `info` = `{ bugId, items }` — `bugId`: id del defecto recién creado (o `null` si falló); `items`: `EvidenceObject[]` con las fallas de esa HU.
- Estado destino: `azure.work_item.on_defect_reactivate_state` (ADO, p.ej. `Active`), reabrir issue (`github`), `jira.transitions.reactivate` (jira). Si el tracker no lo define → solo comenta (degrada con aviso).
- El orquestador lo invoca **automáticamente** tras `publishEvidence`, una vez por cada HU con fallas (gated por `capabilities().states`; en `local` es no-op). El Bug se crea **enlazado a la HU que contiene la novedad** (la evidencia puede declarar su `work_item_id`; si no, se usa la HU del ciclo).

### `publishRequirementEvidence(requirementId, info)` — evidencia y TC por HU

Complementa a `publishEvidence` (que deja el **resumen en el Feature paraguas**): por cada **HU hija seleccionada** deja constancia de la ejecución en la propia HU. **No** sustituye ni altera la ejecución generalizada ni la evidencia local.

- `info` = `{ criteria, results, reportLink, huTitle }` — `criteria`: AC de la HU (de `getWorkItem`); `results`: `EvidenceObject[]` globales del ciclo; `reportLink`: ruta del reporte local; `huTitle`: título de la HU.
- Hace dos cosas **idempotentes**: (1) **asegura el TC** de la HU = un work item hijo creado desde sus criterios y enlazado a la HU como padre. El **tipo** lo decide el perfil (`azure.work_item.test_case_work_item_type`, p.ej. `Task` cuando el proyecto no tiene el tipo «Test Case»); el título sale de `test_case_title_prefix` + `HU-<id>` (idempotencia por título: si ya existe, se reusa). (2) **comenta** en la HU el resultado **global** del ciclo + los criterios + (si hay pruebas etiquetadas `[HU-###]` para esa HU) sus casos, o la nota de cómo habilitar la validación por criterio.
- **Modelo actual:** **un TC (Task) por criterio** de la HU. El título lo trae el manifest del generador (`TC-AC<n> - <objetivo>`), idempotente por la clave estable `TC-AC<n>`. Si no llega manifest (`info.tcs` vacío) se cae al modo compat (un TC por HU).
- **Fases (lógica QA):** `info.phase: "plan"` se usa en la **planificación** (crea los TC pendientes + comenta el plan, solo si se crearon TC nuevos — evita ruido al re-correr); `info.phase: "result"` (default) se usa **tras ejecutar** (reusa los TC idempotentes + comenta el resultado). El orquestador lo invoca en `"plan"` **antes** de los runners y en `"result"` **después**.

### `publishTestPlan(featureId, info)` — Plan de Pruebas del Feature (techo)

El **Feature** es el papá mayor: solo aporta el **entendimiento del objetivo** y el **plan**. NO tiene criterios ni TC propios (esos son de las HUs). Este método crea/actualiza una Task hija del Feature, "PLAN PRUEBAS FEATURE <nombre>", que **agrega** el plan completo:

- `info` = `{ featureTitle, objective?, hus: [{id, title, tcs:[{key,title,status}]}], results, reportLink }`.
- Contenido: objetivo + las HUs y sus TC + **alcance global** (las capas de la corrida general) + **resultado consolidado**. **Idempotente** por el prefijo del título (`azure.work_item.test_plan_title_prefix`): si ya existe, **actualiza** su descripción; no duplica.
- **Cuándo se invoca (lógica QA):** se **crea en la planificación** — antes de ejecutar, con `results: []` → estado "planificado (pendiente de ejecución)" — y se **actualiza** tras ejecutar con el resultado consolidado. Idempotente (crea o actualiza; no duplica). Tipo de work item: `azure.work_item.test_case_work_item_type` (p.ej. `Task`).

## `capabilities()` — degradación elegante

Permite que una skill **omita** lo que el tracker no soporta sin romperse:

| Capability | `local` | `azure-devops` | `github` | `jira` |
|------------|:-------:|:--------------:|:--------:|:------:|
| `attachments` | sí (a carpeta) | sí (REST) | no (se listan en el comentario) | sí |
| `custom_fields` | **no** | sí (`Custom.*`) | **no** (labels) | sí (custom fields) |
| `comments` | no | sí (Discussion) | sí (comments) | sí (ADF) |
| `states` | no | sí | sí (open/close) | sí (transiciones) |
| `network` | **no** | sí | sí | sí |

Ejemplo: si `capabilities().custom_fields === false`, la skill **no** intenta escribir `TestStartDate`/`ReTest` — esos campos simplemente no existen en local.

## Objeto de evidencia normalizado

Los runners no saben de ningún tracker. Emiten:

```js
{
  layer: "e2e",            // static|unit|api|e2e|db|security|regression
  tc_id: "TC-02",
  status: "pass",          // pass|fail|skip
  files: ["shot1.png"],    // rutas locales (opcional)
  narrative: "…",          // texto legible (opcional)
  metrics: { ms: 1234 },   // opcional
  cases: [                 // TC individuales ejecutados por debajo de la capa (opcional)
    { name: "auth › login", status: "pass", duration: 45, message: null },
    { name: "cart › cupón", status: "fail", duration: 88, message: "AssertionError: …" },
  ],
  work_item_id: "123"      // opcional
}
```

`cases[]` lo rellena el runner cuando la herramienta expone un reporter JSON nativo (vitest,
jest, playwright, eslint, ruff, semgrep, bandit). Cada caso es `{ name, status: pass|fail|skip,
duration: ms|null, message: string|null }`. Si la herramienta no trae JSON o la salida no se
puede parsear, el runner OMITE `cases` y deja solo la `narrative` de resumen (degradación). El
sink local y los adapters remotos (ADO/GitHub/Jira) renderizan este detalle por capa.

El `sink` (definido por `evidence.sink` en el perfil) decide el destino:
- `local` → render md/html en el repo.
- `dual` (azure-devops) → resumen en Discussion del padre + adjuntos en Task-TC (fase 2).

## Cómo añadir un tracker nuevo

Trackers implementados: `local`, `azure-devops`, `github`, `jira`. Para añadir otro:

1. Crear `adapters/trackers/<nombre>/<nombre>-adapter.mjs` extendiendo `TrackerAdapter`,
   con su cliente REST de transporte **inyectable** (`<nombre>-rest.mjs`) → offline-testable.
2. Implementar los 8 métodos + `capabilities()`.
3. Registrarlo en `core/tracker-adapter/index.mjs` (`REGISTRY`).
4. Crear `profiles/presets/<nombre>.yaml` con sus defaults.

No se toca ninguna skill ni el orquestador.
