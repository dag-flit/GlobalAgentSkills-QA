---
name: db-test-runner
description: >
  Runner de la capa `db`. Ejecuta los checks de base de datos existentes (pgtap/prisma)
  detectados por qa-detect y emite el OBJETO DE EVIDENCIA NORMALIZADO al sink. La conexión
  viene SIEMPRE de env (nunca cableada); el driver lo da la detección. Local-first.
layer: db
emits: evidence-object
runtime: runtime/runners/db.mjs
---

# db-test-runner

Corre los checks de BD que ya existen en el repo. **La conexión nunca se cablea**: se lee
de `env` (`DATABASE_URL` / `PG_CONNECTION` / `DB_CONNECTION`). Si falta, la capa se **omite
con aviso** — no aborta el ciclo ni inventa una conexión.

## Flujo

1. **Detectar** — `detection.layers.db` de qa-detect (pgtap > prisma > testcontainers > migrations).
2. **Ejecutar** — construye el comando según la herramienta y la conexión de `env`.
3. **Emitir** — exit `0` → `pass`; exit `≠0` → `fail`; sin conexión / sin runner → `skip` con aviso.

## Herramientas → invocación

| tool | comando | nota |
|------|---------|------|
| `pgtap` | `pg_prove -d $DATABASE_URL --recurse .` | conexión desde env |
| `prisma` | `prisma migrate status` | — |
| `migrations` | — | solo carpeta `migrations/`: sin runner standalone → `skip` |
| `testcontainers` | — | corre dentro de la capa unit → `skip` |

## Salida (EvidenceObject)

```js
{ layer: "db", status: "skip", narrative: "falta DATABASE_URL/PG_CONNECTION en env (la conexión nunca se cablea)", metrics: { tool: "pgtap" } }
```

## Invariantes

- **Conexión solo desde env.** Cero `flit_dev`, host o puerto cableados.
- **Driver auto.** Lo determina la detección, no el código.
- **Degrada con aviso.** Sin conexión o sin runner = `skip`, nunca aborta.
