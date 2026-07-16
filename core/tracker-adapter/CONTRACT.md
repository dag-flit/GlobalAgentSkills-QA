# Contrato `tracker-adapter`

Interfaz **única** que toda integración de tracker implementa. El orquestador y las skills hablan **solo** con este contrato — nunca con Azure DevOps directamente. Cambiar de tracker = cambiar `tracker:` en el perfil; ninguna skill se entera.

> El kit está acotado a **exploración de una URL viva** (pruebas E2E). El contrato es mínimo: solo lo necesario para validar el tracker y **entregar la evidencia**. Trackers implementados: `local` (default, sin red) y `azure-devops` (evidencia E2E → ADO).

## Métodos

| Método | Qué hace | `local` (default) |
|--------|----------|-------------------|
| `preflight()` | Valida que el tracker puede operar | Siempre `{ok:true}`, sin red |
| `capabilities()` | Qué soporta el tracker | ver abajo |
| `getWorkItem(id)` | Devuelve la HU/Feature destino (incluye `type`: "Feature"/"User Story") | Lee `.qa/work-items/{id}.md` o devuelve un stub |
| `getChildren(id)` | HU **hijas** de un Feature (para el fan-out por HU) | `[]` (local no tiene jerarquía) |
| `publishEvidence(target, payload)` | Entrega la evidencia normalizada | Reporte `md`+`html` en `qa-evidence/` |
| `commentWorkItem(id, html)` | Publica un comentario HTML en un WI (p.ej. el **brief PR-driven**) | `{ok:false}` (sin Discussion) |
| `createFindingsWorkItem(opts)` | Crea una **HU de hallazgos** (modo QA del código) sin relacionarla a nada, en el sprint en curso | `{ok:false}` (local no crea work items) |

> **`commentWorkItem(id, html)`** — usado por el flujo **QA guiado por PR** para dejar el brief de
> validación (qué probar) como comentario en la HU. `azure-devops` lo postea en la Discussion
> (`addComment`); `local` devuelve `{ok:false, reason}` (no tiene comentarios). No entrega evidencia:
> es texto/HTML de contexto para el equipo.

> **`createFindingsWorkItem(opts)`** — usado por el modo **QA del código** (`azure-devops`). Cada
> ejecución crea una **HU (User Story) nueva** con los hallazgos de las capas, **sin relacionarla** a
> ninguna HU/Feature, en el **proyecto del tracker** y el **sprint en curso** (resuelto por
> `currentIteration`). El título lleva un **incrementador `#N`** por conteo de las ya creadas (por tag
> `QualityOps`, vía WIQL). `opts` = `{ makeTitle:(seq)=>string, descriptionHtml, tags?, countTag?, attachHtml? }`.
> Devuelve `{ok, id, url, seq, title, iterationPath, attached}`. `local` devuelve `{ok:false}` (no crea
> work items) — este modo se usa solo con Azure. El **reporte local** se sigue escribiendo por
> `publishEvidence` (dentro del proyecto analizado), aunque el destino sea Azure.

> **Fan-out de Feature:** cuando el WI destino es un **Feature**, la webapp lee sus **HU hijas** con
> `getChildren(id)` y corre el guion guardado de cada HU, publicando evidencia en cada una. `getWorkItem`
> expone `type` para decidir HU (corrida única) vs Feature (fan-out). `azure-devops` resuelve las hijas por
> WIQL (`[System.Parent] = <feature>`); `local` devuelve `[]`.

### `publishEvidence(target, payload)` — entrega de la evidencia

- `target` = `{ work_item_id, feature_id?, developer? }` — a qué HU/Feature se asocia la evidencia (o `"local"`); FT/dev nombran la subcarpeta.
- `payload` = `{ results }` — los `EvidenceObject[]` de la corrida (la exploración emite uno por URL).
- **`local`** → escribe el reporte `md`+`html` en `qa-evidence/<fecha>/…`.
- **`azure-devops`** (política DUAL) → reporte local **+** comentario-resumen en la Discussion del work item **+** **adjunta las capturas** (`files[]`) al Task hijo resuelto por `tc-match`. Esta es la ruta por la que la evidencia E2E llega a ADO.

## `capabilities()` — degradación elegante

Permite que una skill **omita** lo que el tracker no soporta sin romperse:

| Capability | `local` | `azure-devops` |
|------------|:-------:|:--------------:|
| `attachments` | sí (a carpeta) | sí (REST) |
| `custom_fields` | **no** | sí |
| `comments` | **no** | sí (Discussion) |
| `states` | **no** | sí |
| `network` | **no** | sí |

`network` gobierna el **preflight condicional** del orquestador: con `local` (sin red) el ciclo arranca directo, sin PAT; con `azure-devops` corre el preflight REST primero.

## Objeto de evidencia normalizado

El runner no sabe de ningún tracker. Emite:

```js
{
  layer: "explore",       // única capa del kit
  tc_id: "URL-1",
  status: "pass",          // pass|fail|skip
  files: ["explore-1.png"],// capturas locales (opcional)
  narrative: "…",          // texto legible (opcional)
  metrics: { tool: "playwright", urls: 3 },
  cases: [                 // un caso por URL visitada (o por PASO en modo GUION)
    { name: "https://app/", status: "pass", duration: 45, message: null },
    { name: "https://app/x", status: "fail", duration: 88, message: "HTTP 500" },
    // en modo GUION, un caso de verificación puede declarar qué criterio prueba:
    { name: "6. verificar_texto Bienvenido", status: "pass", ac: "AC1 ve el saludo" },
  ],
  // opcional (modo GUION): matriz de cobertura AC ↔ pasos, calculada por runtime/evidence/ac-coverage.mjs
  coverage: { passed: 1, failed: 0, uncovered: 1, rows: [{ ac: "AC1…", status: "pass", steps: [] }] },
  work_item_id: "123"      // opcional
}
```

> **Cobertura de AC (modo GUION):** un caso puede llevar `ac` (qué criterio de aceptación prueba, solo
> en verificaciones). El runner cruza esos `ac` con los `declaredAcs` de la HU y adjunta `coverage` al
> EvidenceObject. El sink lo renderiza (`local` = sección "Cobertura de criterios de aceptación";
> `dual` = línea + lista en el comentario del WI). Es MAPEO determinista evidencia↔criterio, sin IA.

El `sink` (definido por `evidence.sink` en el perfil) decide el destino:
- `local` → render md/html en el repo.
- `dual` (azure-devops) → resumen en la Discussion del work item + adjuntos.

## Cómo añadir un tracker nuevo

1. Crear `adapters/trackers/<nombre>/<nombre>-adapter.mjs` extendiendo `TrackerAdapter`, con su cliente REST de transporte **inyectable** → offline-testable.
2. Implementar los 4 métodos + `capabilities()`.
3. Registrarlo en `core/tracker-adapter/index.mjs` (`REGISTRY`).
4. Crear `profiles/presets/<nombre>.yaml` con sus defaults.

No se toca ninguna skill ni el orquestador.
