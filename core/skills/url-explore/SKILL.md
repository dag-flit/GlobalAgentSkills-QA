---
name: url-explore
description: Explora una URL viva (app corriendo) con Playwright — smoke E2E: status HTTP, errores de consola y captura por página.
---

# url-explore

Única capa del kit: **exploración de una URL viva** (pruebas E2E sobre una app ya desplegada,
sin necesitar el código fuente). Implementada en `runtime/runners/explore.mjs`.

- **Entrada:** una `appUrl` (y rutas adicionales opcionales). Sin URL, la capa no participa.
- **Qué hace:** abre la app con Playwright (launcher inyectable; si no está disponible → skip
  accionable, nunca rompe), visita cada URL, y registra: **status HTTP**, **errores de consola**
  y una **captura** por página.
- **Salida:** un `EvidenceObject` normalizado (`layer: "explore"`, un caso por URL) que el sink
  del tracker entrega: reporte local (md+html) con `local`, o comentario + adjuntos en la HU con
  `azure-devops`.

Local-first: el launcher del navegador es inyectable → offline-testable. No toca el repositorio
del proyecto; la evidencia (capturas) queda bajo `qa-evidence/`.
