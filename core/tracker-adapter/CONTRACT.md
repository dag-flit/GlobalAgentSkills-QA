# Contrato `tracker-adapter`

Interfaz **única** que toda integración de tracker implementa. El orquestador y las skills hablan **solo** con este contrato — nunca con Azure DevOps, GitHub o Jira directamente. Cambiar de tracker = cambiar `tracker:` en el perfil; ninguna skill se entera.

## Métodos

| Método | Qué hace | `local` (default) |
|--------|----------|-------------------|
| `preflight()` | Valida que el tracker puede operar | Siempre `{ok:true}`, sin red |
| `getWorkItem(id)` | Devuelve el requisito/HU | Lee `.qa/work-items/{id}.md` o devuelve un stub |
| `resolveRequirements(ref)` | Extrae los AC | De Gherkin/checklist/viñetas del archivo local |
| `publishEvidence(target, payload)` | Entrega la evidencia normalizada | Reporte `md`+`html` en `qa-evidence/` |
| `createDefect(defect)` | Registra un defecto | Archivo md en `qa-evidence/defects/` |
| `updateCycle(id, fields)` | Campos de ciclo (TestStartDate, ReTest…) | no-op |
| `closeArtifact(id, result)` | Cierra Task-TC / Bug (nunca el padre) | no-op |
| `capabilities()` | Qué soporta el tracker | ver abajo |

## `capabilities()` — degradación elegante

Permite que una skill **omita** lo que el tracker no soporta sin romperse:

| Capability | `local` | `azure-devops` | `github` (fase 5) | `jira` (fase 5) |
|------------|:-------:|:--------------:|:-----------------:|:---------------:|
| `attachments` | sí (a carpeta) | sí (REST) | sí (issue/PR) | sí |
| `custom_fields` | **no** | sí (`Custom.*`) | no (labels) | sí (custom fields) |
| `comments` | no | sí (Discussion) | sí (comments) | sí |
| `states` | no | sí | sí (labels/close) | sí (transiciones) |
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
  work_item_id: "123"      // opcional
}
```

El `sink` (definido por `evidence.sink` en el perfil) decide el destino:
- `local` → render md/html en el repo.
- `dual` (azure-devops) → resumen en Discussion del padre + adjuntos en Task-TC (fase 2).

## Cómo añadir un tracker nuevo (fase 5)

1. Crear `adapters/trackers/<nombre>/<nombre>-adapter.mjs` extendiendo `TrackerAdapter`.
2. Implementar los 7 métodos + `capabilities()`.
3. Registrarlo en `core/tracker-adapter/index.mjs` (`REGISTRY`).
4. Crear `profiles/presets/<nombre>.yaml` con sus defaults.

No se toca ninguna skill ni el orquestador.
