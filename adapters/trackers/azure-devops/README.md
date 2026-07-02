# adapter azure-devops

Implementa el contrato `tracker-adapter` (explore-only) sobre la REST de Azure DevOps. Se
selecciona cuando el perfil pide `tracker: azure-devops` (p.ej. `profile: flit`). El orquestador
exige preflight OK antes de entregar la evidencia (preflight condicional, gated por
`capabilities().network`). Es el destino por el que las **evidencias E2E llegan a ADO**.

## Archivos

- `azure-devops-adapter.mjs` — implementación del contrato (preflight, getWorkItem, publishEvidence, adjuntos).
- `ado-rest.mjs` — cliente REST mínimo: ÚNICO lugar que conoce rutas/auth de ADO.
- `ado-html.mjs` — parse de la HU (AC) + render del resumen de la corrida (HTML).
- `tc-match.mjs` — resuelve el Task hijo al que se adjunta cada captura (annotation / mapping_file / env_map / WIQL).

## Variables (`env`)

`AZURE_ORG_URL`, `AZURE_PROJECT_NAME`, `AZURE_PAT`, `USER_REAL_EMAIL`. Nada se cablea:
campos (`Custom.*`), tags y patrones de título vienen del **perfil** (`azure.*`), no del código.

## Transporte inyectable (offline-testable)

El cliente REST recibe un transporte `http(req) -> {status,json,text}`. Por defecto usa
`fetch`; en tests se inyecta uno falso (`getAdapter({ ..., http })` o `{ adoClient }`), así
el adapter se prueba sin red (ver `runtime/smoke/explore-suite.mjs`).

## Métodos

| Método | ADO |
|--------|-----|
| `preflight()` | GET del proyecto: valida PAT + acceso (200 ok; 401/203 PAT inválido; 404 proyecto) |
| `capabilities()` | attachments/custom_fields/comments/states/network = sí |
| `getWorkItem(id)` | GET work item; mapea `System.Title/State` y normaliza AC (para saber a qué HU se adjunta) |
| `publishEvidence(target, payload)` | **dual**: resumen en la Discussion del work item + reporte local md/html + **adjuntos** (capturas) por caso → Task |

## Adjuntos (tc-match)

`publishEvidence` resuelve, por cada `tc_id` con `files[]`, el Task hijo usando las
estrategias del perfil (`azure.tc_ado_matching.strategies`): `annotation` (`ev.task_id`),
`mapping_file` (`.qa/mappings/wi-{id}.json`), `env_map` (`env.AZURE_TC_MAP`) y consultas
WIQL por título (`exact_title`/`prefix_seq`/`normalized_slug`). Sube el binario a
`_apis/wit/attachments` y lo enlaza al Task como `AttachedFile`. `on_unmatched: warn`:
un TC sin Task se registra en `attachments.unmatched`, no aborta el ciclo.
