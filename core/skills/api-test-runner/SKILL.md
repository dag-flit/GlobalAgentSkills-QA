---
name: api-test-runner
description: >
  Runner de la capa `api`. Ejecuta el contract testing existente (colección Postman vía
  newman) detectado por qa-detect y emite el OBJETO DE EVIDENCIA NORMALIZADO al sink.
  El contrato OpenAPI sin runner estándar instalado se omite con aviso. Local-first.
layer: api
emits: evidence-object
runtime: runtime/runners/api.mjs
---

# api-test-runner

Corre las pruebas de contrato que el repo permite. Hoy ejecuta colecciones **Postman** con
`newman`; el contrato **OpenAPI** sin runner estándar instalado se **omite con aviso**
(pendiente schemathesis/dredd).

## Flujo

1. **Detectar** — `detection.layers.api` de qa-detect (openapi·swagger / colección Postman).
2. **Localizar y ejecutar** — busca la colección en raíz/subcarpeta y corre `newman run`.
3. **Emitir** — exit `0` → `pass`; exit `≠0` → `fail`; sin runner/colección → `skip` con aviso.

## Herramientas → invocación

| tool | comando | nota |
|------|---------|------|
| `postman` | `newman run <colección>` | colección localizada en raíz o un nivel de subcarpeta |
| `openapi` | — | sin runner estándar instalado → `skip` (pendiente schemathesis/dredd) |

## Salida (EvidenceObject)

```js
{ layer: "api", status: "pass", narrative: "postman: ok", metrics: { tool: "postman", exitCode: 0 } }
```

## Invariantes

- **Sin tracker, sin red obligatoria.** Solo ejecuta el runner de contrato local.
- **Degrada con aviso.** OpenAPI sin runner o colección no localizada = `skip`, no aborta.
