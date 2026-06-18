# qa-kit — andamiaje global (F0)

Reescritura **local-first** y sin sesgo del kit QA. Esta entrega es **F0 (andamiaje)**:
la estructura, los perfiles por capas, el contrato de tracker y el adapter `local` funcionando.
Los runners y agentes se portan en F1–F3 (ver `qa-kit-arquitectura-global.md`).

## Principio

> Lo **local siempre funciona** sin red ni configuración. El tracker (ADO/GitHub/Jira) es un
> plug-in opcional que se enciende con un overlay mínimo.

## Estructura

```
qa-kit/
├─ core/tracker-adapter/   # contrato único (CONTRACT.md + base Node + factory)
├─ adapters/trackers/
│  ├─ local/               # DEFAULT — sin red, evidencia md+html al repo
│  └─ azure-devops/        # stub F0 (lógica MCP/REST se porta en F2)
├─ profiles/
│  ├─ default.yaml         # local-first: tracker=local, layers=auto
│  ├─ presets/azure-devops.yaml
│  └─ overlays/flit.yaml   # único lugar con literales FLIT
├─ runtime/
│  ├─ profile/             # cargador YAML + resolver (deep-merge)
│  ├─ evidence/            # sink local (md+html)
│  └─ smoke-test.mjs       # prueba el plumbing extremo a extremo
├─ delivery/{cursor,claude-code,plain}/   # empaque por runtime (F4)
├─ packs/dev-side/         # dev-tester (opcional, fuera del core)
└─ manifest.yaml           # inventario real, sin drift
```

## Probar (sin instalar nada)

```bash
node runtime/smoke-test.mjs
```

Debe imprimir `6/6 OK`. Verifica: deep-merge, resolución de perfil (repo sin config → `local`),
herencia `default ← azure-devops ← flit`, factory de tracker, preflight local sin red,
y escritura del reporte local md+html.

## Resolución de perfil

```
default.yaml  ←  presets/<tracker>.yaml  ←  overlays/<org>.yaml  ←  qa-project.profile.yaml (repo)
```

- Repo nuevo **sin** perfil → usa `default.yaml` (`tracker: local`, `layers: auto`) y corre ya.
- Repo con `profile: azure-devops` → hereda el preset.
- Repo con `profile: flit` → hereda `flit ← azure-devops ← default`.

## Qué sigue (F1)

`qa-detect` (auto-encender capas), portar los runners para que emitan el objeto de evidencia
normalizado, y preflight condicional en el orquestador (`tracker != local`). Tras F1, cualquier
repo corre `static/unit/e2e` local sin configuración.
