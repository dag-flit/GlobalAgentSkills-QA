# Guía de extensión — qa-kit

Cómo añadir un runner de capa, un tracker o un overlay de organización, y cómo empaquetar.
Antes de tocar el core, lee las **invariantes** (al final) y `CLAUDE.md`.

Regla transversal: **todo se prueba offline**. La ejecución de herramientas (`exec`) y el
transporte HTTP de los trackers (`http`) son **inyectables** — añade siempre un caso al
`runtime/smoke-test.mjs` con un `exec`/`http` falso. Tras cualquier cambio: `node runtime/smoke-test.mjs`.

---

## 1. Añadir un runner de capa

Los runners comparten `runtime/runners/_runner-core.mjs` (`runLayer`): resolución de binario,
ejecución inyectable y mapeo a `EvidenceObject`. Un runner nuevo solo aporta su registro
`tool → argv`.

**Paso 1 — detección.** Asegúrate de que `qa-detect` (`runtime/detect/qa-detect.mjs`) detecte
la capa y fije `layers.<capa>.tool`. Si es una capa nueva, añade su bloque de señales.

**Paso 2 — el runner.** Crea `runtime/runners/<capa>.mjs`:

```js
import { runLayer } from "./_runner-core.mjs";

const TOOLS = {
  // argv fijo:
  miherramienta: ["mi-cli", "test"],
  // o función (argv dinámico desde env/profile/archivos; puede devolver { skip: "razón" }):
  otra: ({ env, profile, repoRoot, detection }) => {
    if (!env.MI_CONEXION) return { skip: "falta MI_CONEXION en env (nunca se cablea)" };
    return ["otra-cli", "--url", env.MI_CONEXION];
  },
};

export function runMiCapa(opts = {}) {
  return runLayer({ layer: "micapa", tools: TOOLS, ...opts });
}
```

**Paso 3 — registrar** en `runtime/orchestrator.mjs` (`RUNNERS`).

**Paso 4 — doc** `core/skills/<nombre>/SKILL.md` con frontmatter (`name`, `description`,
`layer`, `runtime`).

**Paso 5 — smoke test** con un `exec` que capture argv y simule exit 0/1.

> El runner **nunca** habla con un tracker: devuelve el `EvidenceObject` y el sink decide.
> Una capa sin herramienta/condición → `status: "skip"` con razón (degrada, no aborta).

---

## 2. Añadir un tracker

Patrón de referencia: `adapters/trackers/azure-devops/` (completo) o `github/`/`jira/`.

**Paso 1 — cliente REST** `adapters/trackers/<nombre>/<nombre>-rest.mjs`:

```js
export async function defaultHttp(req) { /* fetch → { status, json, text } */ }

export function createClient({ env, http = defaultHttp }) {
  // construye URLs y auth desde env; http es el ÚNICO punto de red (inyectable)
  return { preflightCall(){...}, getItem(id){...}, addComment(id, body){...}, /* … */ };
}
```

**Paso 2 — adapter** `adapters/trackers/<nombre>/<nombre>-adapter.mjs` extendiendo
`TrackerAdapter`. Lee el cliente inyectable del ctx:

```js
constructor(ctx = {}) {
  super(ctx);
  this.client = ctx.<nombre>Client || createClient({ env: this.env, http: ctx.http });
}
```

Implementa los 7 métodos + `capabilities()`. Reglas:
- `preflight()`: primero valida presencia de variables `env`; luego una llamada REST real.
- Estados, campos, tags, transiciones → **del perfil** (`profile.<nombre>.*`), nunca cableados.
- `publishEvidence()`: escribe el reporte local (`writeLocalReport`) **y** publica el resumen
  remoto. Si algo no se puede (p.ej. subir binarios), regístralo, no lo finjas.
- `capabilities()`: marca con honestidad qué soporta; las skills degradan en consecuencia.

**Paso 3 — preset** `profiles/presets/<nombre>.yaml` (`tracker: <nombre>`, `evidence.sink: dual`,
y la config específica bajo una clave `<nombre>:`).

**Paso 4 — registrar** en `core/tracker-adapter/index.mjs` (`REGISTRY`).

**Paso 5 — smoke test** con un transporte `http` falso que devuelva respuestas canónicas y
permita inspeccionar las requests (método/url/body). Verifica los 7 métodos.

**Paso 6 — docs**: `adapters/trackers/<nombre>/README.md` y la tabla de `CONTRACT.md`.

> Ninguna skill ni el orquestador se tocan al añadir un tracker.

---

## 3. Añadir un overlay de organización

Para convenciones específicas de un equipo (como `flit`), crea
`profiles/overlays/<org>.yaml`:

```yaml
extends: azure-devops     # hereda un preset; cadena: default ← preset ← overlay ← proyecto
project: { name: "<org>" }
locale: { timezone: "<TZ>" }
azure:
  work_item: { certified_tag: "<TAG>", ... }   # solo lo que difiere del preset
```

Un repo lo usa con `profile: <org>` en `.qa/qa-project.profile.yaml`. **Todos** los literales
de la organización viven aquí — nunca en `core/`/`runtime/`/`adapters/`.

---

## 4. Empaquetar a un target de entrega

El empaquetador (`runtime/delivery/build.mjs`) copia el **motor** (`core`, `runtime`,
`adapters`, `profiles`, `manifest.yaml`) con los imports intactos y añade los envoltorios del
target. Para añadir un target nuevo: amplía `TARGETS` y la lógica en `buildTarget`.

```bash
node runtime/delivery/build.mjs dist            # los 3 targets en dist/
node runtime/delivery/build.mjs dist -t cursor  # solo uno
```

El frontmatter plegado (`>`/`|`) de los `SKILL.md`/`AGENT.md` se resuelve al generar `.mdc`.

---

## Invariantes (no romper)

1. **`core/` es portable.** Cero literales de dominio (FLIT, hosts, timezones, rutas `.cursor/`).
   Eso vive solo en `profiles/overlays/<org>.yaml` o en `delivery/`.
2. **Las skills/runners hablan solo con `tracker-adapter`** — nunca con ADO/github/jira directo.
3. **Local-first:** ningún paso de red es obligatorio. Con `tracker: local` todo corre sin PAT.
4. **Evidencia normalizada → sink.** Un runner emite el `EvidenceObject`; el sink decide destino.
5. **Node `.mjs`, cross-platform.** Sin PowerShell ni Python en `core/`/`runtime/`.
6. **Ejecución y transporte inyectables** → todo offline-testable. Cada capacidad nueva añade
   su caso al smoke test, que queda **verde**.
7. **`manifest.yaml` sin drift:** lista solo lo que existe.
8. **`dev-tester` está fuera del core** (`packs/dev-side/`, opcional). No reincorporarlo.
