# Contrato `tracker-adapter`

Interfaz **única** que toda integración de tracker implementa. El orquestador y las skills hablan **solo** con este contrato — nunca con Azure DevOps directamente. Cambiar de tracker = cambiar `tracker:` en el perfil; ninguna skill se entera.

> El kit está acotado a **exploración de una URL viva** (pruebas E2E). El contrato es mínimo: solo lo necesario para validar el tracker y **entregar la evidencia**. Trackers implementados: `local` (default, sin red) y `azure-devops` (evidencia E2E → ADO).

## Métodos

| Método | Qué hace | `local` (default) |
|--------|----------|-------------------|
| `preflight()` | Valida que el tracker puede operar | Siempre `{ok:true}`, sin red |
| `capabilities()` | Qué soporta el tracker | ver abajo |
| `getWorkItem(id)` | Devuelve la HU/Feature destino de la evidencia | Lee `.qa/work-items/{id}.md` o devuelve un stub |
| `publishEvidence(target, payload)` | Entrega la evidencia normalizada | Reporte `md`+`html` en `qa-evidence/` |

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
  cases: [                 // un caso por URL visitada
    { name: "https://app/", status: "pass", duration: 45, message: null },
    { name: "https://app/x", status: "fail", duration: 88, message: "HTTP 500" },
  ],
  work_item_id: "123"      // opcional
}
```

El `sink` (definido por `evidence.sink` en el perfil) decide el destino:
- `local` → render md/html en el repo.
- `dual` (azure-devops) → resumen en la Discussion del work item + adjuntos.

## Cómo añadir un tracker nuevo

1. Crear `adapters/trackers/<nombre>/<nombre>-adapter.mjs` extendiendo `TrackerAdapter`, con su cliente REST de transporte **inyectable** → offline-testable.
2. Implementar los 4 métodos + `capabilities()`.
3. Registrarlo en `core/tracker-adapter/index.mjs` (`REGISTRY`).
4. Crear `profiles/presets/<nombre>.yaml` con sus defaults.

No se toca ninguna skill ni el orquestador.
