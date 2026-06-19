---
name: qa-orchestrator
description: >
  Orquesta el ciclo QA local-first: preflight CONDICIONAL → qa-detect → runners de
  capas → evidence-sink. Habla solo con el tracker-adapter; nunca con un tracker
  concreto. Con `tracker: local` arranca directo, sin red ni PAT.
runtime: runtime/orchestrator.mjs
---

# qa-orchestrator

Punto de entrada del ciclo. Decide qué correr y en qué orden, sin acoplarse a ningún
tracker. La lógica vive en `runtime/orchestrator.mjs` (`runQaCycle`).

## Inicio — preflight CONDICIONAL

El preflight de tracker **solo corre si el tracker requiere red**
(`adapter.capabilities().network === true`):

- `tracker: local` → `network: false` → **arranca directo**, sin preflight, sin PAT.
- `tracker: azure-devops | github | jira` → `network: true` → corre `adapter.preflight()`
  primero; si **FALLA**, el ciclo se **detiene** (`stopped: "preflight"`) **antes** de
  ejecutar cualquier runner. Esto desbloquea las pruebas locales (B2 del doc de arquitectura).

El gating es por **capability**, no por el literal `"local"`: cualquier tracker sin red
arranca directo; cualquiera con red exige preflight.

## Flujo

1. **Resolver perfil** (`resolveProfile`) y **seleccionar adapter** (`getAdapter`).
2. **Preflight condicional** (ver arriba).
3. **Detectar** capas con `qa-detect`; `resolveEnabledLayers` aplica el override del perfil.
4. **Ejecutar runners** de las capas habilitadas (hoy: `static`; resto se porta en F1/F3).
   Una capa habilitada sin runner, o una omitida por detección, va al reporte como `skip`
   con su razón (degrada con aviso, nunca aborta — principio 5).
5. **Publicar** los `EvidenceObject` al `evidence-sink` vía `adapter.publishEvidence`.

## Salida (resumen del ciclo)

```js
{
  ok: true,
  stopped: null,            // "preflight" si un tracker remoto no estaba operativo
  tracker: "local",
  preflight: null,          // null = no se requirió (arrancó directo)
  detection: { ... },       // salida de qa-detect
  results: [ /* EvidenceObject[] */ ],
  report: { dir, mdPath, htmlPath }
}
```

## Invariantes

- **Local-first.** Ningún paso de red es obligatorio; con `local` el ciclo corre completo.
- **Solo tracker-adapter.** El orquestador nunca llama a ADO/GitHub/Jira directo.
- **Degrada con aviso.** Capas sin herramienta/runner se reportan como `skip`, no abortan.
