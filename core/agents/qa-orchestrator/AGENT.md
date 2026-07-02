---
name: qa-orchestrator
description: Orquesta el ciclo de exploración de una URL viva (pruebas E2E) y entrega la evidencia al tracker (local o Azure DevOps).
---

# qa-orchestrator

Encadena el ciclo de una corrida de **exploración de URL** (`runtime/orchestrator.mjs` →
`runQaCycle`), acotado a un solo propósito: probar una app **corriendo** (no el código fuente).

Flujo:

1. **Resolver perfil** (`runtime/profile/resolve-profile.mjs`): `default ← preset del tracker ←
   overlay de la organización`. Trackers soportados: `local` (reporte en disco, sin red) y
   `azure-devops` (destino de la evidencia E2E).
2. **Preflight condicional**: solo si el tracker requiere red (`azure-devops`). Con `local`
   arranca directo, sin PAT.
3. **Explorar la URL** (`runtime/runners/explore.mjs`): abre la app con Playwright (launcher
   **inyectable**), visita la(s) URL(s) y emite un `EvidenceObject` por corrida (status HTTP +
   errores de consola + captura por página). Sin `appUrl` no se explora nada.
4. **Entregar la evidencia** (`publishEvidence` del adapter): en `local` deja un reporte md+html
   en `qa-evidence/`; en `azure-devops` comenta el resumen en la HU y adjunta las capturas.

El launcher del navegador y el transporte HTTP del tracker son **inyectables** → todo es
probable offline (ver `runtime/smoke-test.mjs`).
