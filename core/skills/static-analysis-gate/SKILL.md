---
name: static-analysis-gate
description: >
  Primer runner del ciclo QA. Ejecuta la capa `static` (linter / type-checker) del repo
  detectada por qa-detect, y emite el OBJETO DE EVIDENCIA NORMALIZADO. No habla con ningún
  tracker: el sink (local por defecto) decide el destino. Local-first, sin red obligatoria.
layer: static
emits: evidence-object
runtime: runtime/runners/static-analysis.mjs
---

# static-analysis-gate

Runner stack-agnóstico de la capa `static`. Detecta la herramienta presente (eslint, tsc,
ruff, mypy — priorizadas por `qa-detect`), la ejecuta y devuelve **un** `EvidenceObject`.
**Nunca escribe en un tracker**: entrega el objeto y el `evidence-sink` (definido por
`evidence.sink`) lo enruta (`local` = md+html en `qa-evidence/`; `dual` = ADO en F2).

## Flujo

1. **Detectar** — toma `detection.layers.static` de `qa-detect` (tool + señales). Si la capa
   está apagada, devuelve `status: "skip"` con la razón (degrada con aviso, no aborta).
2. **Ejecutar** — resuelve el binario (prefiere `node_modules/.bin`, cae a PATH) y lo corre.
   El ejecutor es **inyectable** (`exec`) para tests deterministas y offline.
3. **Emitir** — mapea el resultado a un `EvidenceObject` normalizado:
   - exit `0` → `pass`
   - exit `≠0` → `fail` (con resumen de los primeros hallazgos en `narrative`)
   - binario no lanzable (no instalado / fuera de PATH) → `skip` con aviso

## Salida (EvidenceObject)

```js
{
  layer: "static",
  status: "pass" | "fail" | "skip",
  narrative: "eslint: exit 1 — /src/a.ts: 'x' is defined but never used",
  metrics: { tool: "eslint", exitCode: 1 },
  work_item_id: "123"   // opcional
}
```

## Uso (end-to-end, sin ADO)

```js
import { detectRepo } from "../../../runtime/detect/qa-detect.mjs";
import { runStaticAnalysis } from "../../../runtime/runners/static-analysis.mjs";
import { getAdapter } from "../../../core/tracker-adapter/index.mjs";

const detection = detectRepo({ repoRoot });
const ev = runStaticAnalysis({ repoRoot, profile, detection });   // ejecuta el linter
const adapter = getAdapter({ profile, env, repoRoot });           // local por defecto
await adapter.publishEvidence({ work_item_id: "123" }, { results: [ev] });
// → qa-evidence/<fecha>/WI-123/report.{md,html}
```

## Invariantes

- **Sin tracker, sin red obligatoria.** Solo ejecuta una herramienta local y emite datos.
- **Stack-agnóstico.** La herramienta sale de la detección; nada cableado.
- **Degrada con aviso.** Falta de herramienta = `skip` con razón, nunca aborta el ciclo.
- **Ejecución inyectable.** `exec` permite probar el runner sin instalar binarios.
