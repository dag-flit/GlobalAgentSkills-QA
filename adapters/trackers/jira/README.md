# adapter jira (F5)

Implementa el contrato `tracker-adapter` sobre la REST v3 de Jira Cloud. Se selecciona con
`tracker: jira` (`profile: jira`). Transporte HTTP **inyectable** → offline-testable.

## Archivos

- `jira-adapter.mjs` — los 8 métodos + `capabilities`.
- `jira-rest.mjs` — cliente REST (rutas/auth Basic email:token) + helper ADF.

## Variables (`env`)

`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_PROJECT_KEY`. Tipo de bug, custom fields
y transiciones desde el preset `profiles/presets/jira.yaml` (ajustar ids por instancia).

## Métodos

| Método | Jira |
|--------|------|
| `preflight()` | GET `/myself` (200 ok; 401/403 credenciales) |
| `getWorkItem(id)` | GET issue; mapea summary/status y AC de la description (texto o ADF) |
| `publishEvidence(target, payload)` | comentario ADF con resumen + reporte local md/html |
| `createDefect(defect)` | crea issue tipo `Bug` en el proyecto del preset |
| `updateCycle(id, fields)` | PUT; mapea claves lógicas → `customfield_*` del preset |
| `closeArtifact(id, result)` | POST transición (`pass`/`fail`) del preset |
| `reactivateRequirement(id, info)` | POST transición `jira.transitions.reactivate` (si está configurada) + comentario ADF de trazabilidad |

`capabilities()`: `attachments/custom_fields/comments/states:true`. Los comentarios y la
description usan **ADF** (Atlassian Document Format) generado desde texto plano.
