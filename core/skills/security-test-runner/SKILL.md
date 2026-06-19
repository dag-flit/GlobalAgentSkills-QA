---
name: security-test-runner
description: >
  Runner de la capa `security`. Ejecuta el escáner detectado (semgrep/bandit) y emite el
  OBJETO DE EVIDENCIA NORMALIZADO al sink. `security.target_profile` (api|web|generic|auto)
  ajusta el ruleset: OWASP API deja de ser el único modo. Local-first.
layer: security
emits: evidence-object
runtime: runtime/runners/security.mjs
---

# security-test-runner

Corre el análisis de seguridad estático que el repo permite. El **enfoque** ya no está fijo
en OWASP API: `security.target_profile` del perfil decide el ruleset.

## Flujo

1. **Detectar** — `detection.layers.security` de qa-detect (semgrep / bandit).
2. **Ejecutar** — `target_profile` ajusta la config del escáner.
3. **Emitir** — exit `0` → `pass`; hallazgos (exit `≠0`) → `fail`; sin escáner → `skip` con aviso.

## Herramientas y perfil

| tool | comando |
|------|---------|
| `semgrep` | `semgrep --error --quiet --config <cfg>` |
| `bandit` | `bandit -r .` |

`<cfg>` según `security.target_profile`: `api`/`web` → `p/owasp-top-ten`; `generic`/`auto` → `auto`.

## Salida (EvidenceObject)

```js
{ layer: "security", status: "fail", narrative: "semgrep: exit 1 — 1 finding", metrics: { tool: "semgrep", exitCode: 1 } }
```

## Invariantes

- **Enfoque configurable.** `target_profile` decide el ruleset; nada cableado a API.
- **Sin red obligatoria en el flujo base.** Solo ejecuta el escáner local.
- **Degrada con aviso.** Sin escáner = `skip`, nunca aborta el ciclo.
