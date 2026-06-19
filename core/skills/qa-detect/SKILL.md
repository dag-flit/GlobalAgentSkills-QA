---
name: qa-detect
description: >
  Detecta qué capas de prueba (static/unit/api/e2e/db/security) y qué stack tiene un
  repo, a partir de archivos-señal. Hace que `testing.layers_enabled: auto` encienda
  SOLO lo que el repo permite probar, y reporte lo que omite y por qué. Local-first,
  sin red, sin literales de dominio.
layer: detect
emits: detection-object
runtime: runtime/detect/qa-detect.mjs
---

# qa-detect

Primer paso del ciclo QA. El orquestador lo ejecuta **antes** de cualquier runner para
saber qué correr. Con `layers_enabled: auto`, cada capa se enciende sola si su herramienta
existe; las demás se **omiten con aviso**, nunca abortan el ciclo (principio 5).

No ejecuta pruebas ni toca el tracker: solo inspecciona el árbol del repo y emite un
**objeto de detección** normalizado. La lógica vive en `runtime/detect/qa-detect.mjs`.

## Qué detecta

### Capas (tabla de señales)

| Señal en el repo | Enciende |
|------------------|----------|
| `eslint` / `tsconfig.json` / `ruff` / `mypy` | `static` |
| `vitest` / `jest` / `pytest` / `*.csproj` (test) | `unit` |
| `openapi`·`swagger` / colección Postman | `api` |
| `playwright.config` / `cypress.config` | `e2e` |
| `migrations/` / `prisma` / `pgtap` / `testcontainers` | `db` |
| `semgrep` / `bandit` | `security` |

Las señales se leen de archivos-marcador **y** de las dependencias de los `package.json`
encontrados (raíz + monorepo), que es la fuente más rica en repos Node.

### Stack y arquitectura (best-effort, sólo pista)

- `stack.backend`: `dotnet | node | python | java | go | none`
- `stack.frontend`: `react | vue | angular | none`
- `stack.db`: `postgres | mysql | sqlite | none` (la conexión real siempre viene de `env`)
- `architecture`: `monolith | microservices | react-spa | api-rest`

## Salida (objeto de detección)

```js
{
  stack: { backend: "node", frontend: "react", db: "postgres" },
  architecture: "react-spa",
  layers: {
    static: { enabled: true,  tool: "eslint",     signals: ["eslint", "tsconfig.json"] },
    unit:   { enabled: true,  tool: "vitest",     signals: ["vitest"] },
    e2e:    { enabled: true,  tool: "playwright", signals: ["playwright"] },
    api:    { enabled: false, tool: null, signals: [], reason: "sin contrato API (openapi/postman)" },
    db:     { enabled: false, tool: null, signals: [], reason: "sin migraciones/pgtap/testcontainers" },
    security:{ enabled: false, tool: null, signals: [], reason: "sin escáner (semgrep/bandit)" }
  },
  enabled: ["static", "unit", "e2e"],
  skipped: [
    { layer: "api", reason: "sin contrato API (openapi/postman)" },
    { layer: "db",  reason: "sin migraciones/pgtap/testcontainers" },
    { layer: "security", reason: "sin escáner (semgrep/bandit)" }
  ]
}
```

## Reconciliación con el perfil

`resolveEnabledLayers(profile, detection)` decide el conjunto final:

- `testing.layers_enabled: auto` (default) → usa `detection.enabled`.
- `testing.layers_enabled: [static, unit]` (lista explícita) → **gana el perfil**
  (principio 2: la config explícita sobrescribe la detección).

## Uso

```js
import { detectRepo, resolveEnabledLayers } from "../../../runtime/detect/qa-detect.mjs";

const detection = detectRepo({ repoRoot: process.cwd() });
const { enabled, source } = resolveEnabledLayers(profile, detection);
// enabled → capas a correr; detection.skipped → qué se omitió y por qué (para el reporte)
```

## Invariantes

- **Sin red, sin tracker.** Pura inspección de archivos; no depende de PAT ni de ADO.
- **Sin literales de dominio.** Sólo señales de herramientas; nada de FLIT/stack fijo.
- **Degrada con aviso.** Una capa sin herramienta no rompe el ciclo: sale en `skipped`.
