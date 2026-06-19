# adapter azure-devops (F2)

Implementa el contrato `tracker-adapter` sobre la REST de Azure DevOps. Se selecciona
cuando el perfil pide `tracker: azure-devops` (p.ej. `profile: flit`). El orquestador exige
preflight OK antes de correr runners (preflight condicional, gated por `capabilities().network`).

## Archivos

- `azure-devops-adapter.mjs` — implementación del contrato (los 7 métodos + `capabilities`).
- `ado-rest.mjs` — cliente REST mínimo: ÚNICO lugar que conoce rutas/auth de ADO.
- `tc-match.mjs` — resuelve el Task hijo de cada `tc_id` (annotation / mapping_file / env_map / WIQL).

## Variables (`env`)

`AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`, `USER_REAL_EMAIL`. Nada se cablea:
estados, campos (`Custom.*`), tags y patrones de título vienen del **perfil** (`azure.*`),
no del código.

## Transporte inyectable (offline-testable)

El cliente REST recibe un transporte `http(req) -> {status,json,text}`. Por defecto usa
`fetch`; en tests se inyecta uno falso (`getAdapter({ ..., http })` o `{ adoClient }`), así
el adapter se prueba sin red (ver caso 11 del smoke test).

## Métodos

| Método | ADO |
|--------|-----|
| `preflight()` | GET del proyecto: valida PAT + acceso (200 ok; 401/203 PAT inválido; 404 proyecto) |
| `getWorkItem(id)` | GET work item; mapea `System.Title/State` y normaliza AC (HTML → líneas) |
| `resolveRequirements(ref)` | AC del campo `acceptance_criteria` del perfil |
| `publishEvidence(target, payload)` | **dual**: resumen en Discussion del WI padre + reporte local md/html + adjuntos png/webm por TC→Task |
| `createDefect(defect)` | crea `Bug` con `defect_tag` y enlace `Hierarchy-Reverse` al padre |
| `updateCycle(id, fields)` | PATCH; mapea claves lógicas (`test_start_date`…) → refs `Custom.*` del perfil |
| `closeArtifact(id, result)` | PATCH `System.State` al estado pass/fail del perfil (Task-TC o Bug) |

## Adjuntos (tc-match)

`publishEvidence` resuelve, por cada `tc_id` con `files[]`, el Task hijo usando las
estrategias del perfil (`azure.tc_ado_matching.strategies`): `annotation` (`ev.task_id`),
`mapping_file` (`.qa/mappings/wi-{id}.json`), `env_map` (`env.AZURE_TC_MAP`) y consultas
WIQL por título (`exact_title`/`prefix_seq`/`normalized_slug`). Sube el binario a
`_apis/wit/attachments` y lo enlaza al Task como `AttachedFile`. `on_unmatched: warn`:
un TC sin Task se registra en `attachments.unmatched`, no aborta el ciclo.
