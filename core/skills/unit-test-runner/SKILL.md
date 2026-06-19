---
name: unit-test-runner
description: >
  Runner de la capa `unit`. Ejecuta los tests unitarios existentes del repo (vitest/jest/
  pytest/dotnet) detectados por qa-detect y emite el OBJETO DE EVIDENCIA NORMALIZADO al
  sink. NO genera código ni se acopla a un stack. Local-first, sin red obligatoria.
layer: unit
emits: evidence-object
runtime: runtime/runners/unit.mjs
---

# unit-test-runner

Ejecuta y resume las pruebas unitarias **que ya existen** en el repo. La generación de
tests desde criterios de aceptación **no** es de este runner (eso es del pack opcional
`dev-side`, fuera del core QA). Aquí solo se corre lo que el repo permite correr.

> **Deuda D1 cerrada:** este runner **NUNCA** escribe en `Custom.Evidences` ni en ningún
> campo de tracker. Emite el `EvidenceObject` y el `evidence-sink` decide el destino
> (`local` = md+html; `dual` = ADO en F2). Un solo punto decide; el runner no conoce ADO.

## Flujo

1. **Detectar** — `detection.layers.unit` de `qa-detect` (vitest > jest > pytest > *.csproj).
2. **Ejecutar** — resuelve el binario (prefiere `node_modules/.bin`, cae a PATH) y lo corre.
   Ejecutor **inyectable** (`exec`) para tests deterministas y offline.
3. **Emitir** — exit `0` → `pass`; exit `≠0` → `fail` (con resumen en `narrative`);
   binario no lanzable → `skip` con aviso. Capa apagada → `skip` con la razón de detección.

## Herramientas → invocación

| tool | comando |
|------|---------|
| `vitest` | `vitest run` |
| `jest` | `jest` |
| `pytest` | `pytest` |
| `dotnet-test` | `dotnet test` |

## Salida (EvidenceObject)

```js
{ layer: "unit", status: "fail", narrative: "vitest: exit 1 — 2 failed", metrics: { tool: "vitest", exitCode: 1 } }
```

## Invariantes

- **Sin tracker, sin red obligatoria.** Solo corre tests locales y emite datos.
- **No genera tests ni asume stack.** La herramienta sale de la detección.
- **D1:** jamás menciona ni escribe `Custom.Evidences`.
