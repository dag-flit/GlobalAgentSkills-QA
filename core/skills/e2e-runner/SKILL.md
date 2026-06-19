---
name: e2e-runner
description: >
  Runner de la capa `e2e`. Ejecuta la suite end-to-end existente del repo (playwright/
  cypress) detectada por qa-detect y emite el OBJETO DE EVIDENCIA NORMALIZADO al sink.
  Renombra el viejo `playwright-runner`. Local-first, sin PAT ni preflight de tracker.
layer: e2e
emits: evidence-object
runtime: runtime/runners/e2e.mjs
---

# e2e-runner

Ejecuta la suite end-to-end **que ya existe** en el repo y emite el `EvidenceObject`.
Sustituye a `playwright-runner`: el preflight de tracker y el export de PAT **salen del
flujo base** — los aporta el adapter ADO en F2 **solo si el sink lo requiere**. En local
arranca directo, sin red.

## Flujo

1. **Detectar** — `detection.layers.e2e` de `qa-detect` (playwright > cypress).
2. **Ejecutar** — resuelve el binario (prefiere `node_modules/.bin`, cae a PATH) y lo corre.
   Ejecutor **inyectable** (`exec`) para tests deterministas y offline.
3. **Emitir** — exit `0` → `pass`; exit `≠0` → `fail` (con resumen en `narrative`);
   binario no lanzable → `skip` con aviso. Capa apagada → `skip` con la razón de detección.

## Herramientas → invocación

| tool | comando |
|------|---------|
| `playwright` | `playwright test` |
| `cypress` | `cypress run` |

## Salida (EvidenceObject)

```js
{ layer: "e2e", status: "pass", narrative: "playwright: ok", metrics: { tool: "playwright", exitCode: 0 } }
```

> Captura de screenshots/videos por paso y su copia al directorio de evidencia se conecta
> al `evidence-sink` cuando se porte la captura (runtime de evidencia, fase posterior).
> El contrato de salida ya soporta `files: []` para esos adjuntos.

## Invariantes

- **Local-first.** Sin preflight de tracker ni PAT en el flujo base.
- **Sin tracker directo.** Emite el objeto; el sink decide el destino.
- **Degrada con aviso.** Falta de herramienta = `skip`, nunca aborta el ciclo.
