# adapter github (F5)

Implementa el contrato `tracker-adapter` sobre la REST de GitHub Issues. Se selecciona con
`tracker: github` (`profile: github`). Transporte HTTP **inyectable** → offline-testable.

## Archivos

- `github-adapter.mjs` — los 7 métodos + `capabilities`.
- `github-rest.mjs` — cliente REST (rutas/auth). `owner/repo` y token desde env.

## Variables (`env`)

`GITHUB_TOKEN`, `GITHUB_REPOSITORY` (`owner/repo`). Labels/estados desde el preset
`profiles/presets/github.yaml`.

## Métodos

| Método | GitHub |
|--------|--------|
| `preflight()` | GET del repo (200 ok; 401 token; 404 repo) |
| `getWorkItem(id)` | GET issue; mapea title/state y AC del body (markdown/checklist) |
| `publishEvidence(target, payload)` | comentario con resumen en el issue + reporte local md/html |
| `createDefect(defect)` | crea issue con la label de defecto del preset |
| `updateCycle(id, fields)` | **no-op** (GitHub no tiene custom fields; usa labels) |
| `closeArtifact(id, result)` | PATCH issue a `closed`/`open` según pass/fail |

`capabilities()`: `custom_fields:false`, `comments/states:true`. Los adjuntos binarios no se
suben por la REST de issues: los archivos de evidencia se **listan** en el comentario
(`attachments.listed`), sin fingir una subida.
