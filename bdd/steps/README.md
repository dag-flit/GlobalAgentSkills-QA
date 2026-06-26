# Librería de step-definitions (Ruta B — BDD)

Steps reutilizables que **ejecutan** los `.feature` generados desde los AC (el AC ES el test).
El runner `bdd` del kit los **materializa** en `qa-generated/bdd/steps/` del proyecto bajo prueba y
Cucumber.js los carga (`--import`) junto a los steps propios del proyecto.

## Dominios incluidos (core, reutilizable entre proyectos)

| Archivo | Dominio | Ejemplos de frases |
|---|---|---|
| `web.steps.mjs` | UI (Playwright) | `Dado que estoy en "/login"`, `Cuando hago clic en "Entrar"`, `Entonces debería ver "Bienvenido"` |
| `api.steps.mjs` | HTTP (`fetch`) | `Cuando hago GET "/health"`, `Entonces el estado es 200`, `Entonces la respuesta debería contener "ok"` |
| `db.steps.mjs` | SQL (`pg`) | `Entonces la tabla "users" tiene 3 filas` |
| `world.mjs` | estado + hooks | baseURL desde env, browser perezoso, cierre automático |

Las frases coinciden con el **texto** del paso, sin importar el keyword (`Given`/`Dado`,
`When`/`Cuando`, `Then`/`Entonces`). El feature-writer añade `# language: es` cuando el AC está en
español.

## Peer-dependencies (en TU proyecto, no en el kit)

- `@cucumber/cucumber` (siempre), `playwright` (steps web), `pg` (steps db).
- La conexión de BD se toma de `DATABASE_URL` / `PG_CONNECTION` (nunca cableada).
- La baseURL web/API de `BASE_URL` / `PLAYWRIGHT_BASE_URL` / `API_BASE_URL`.

## Extender en tu proyecto

Crea `bdd/steps/*.mjs` (o `tests/bdd/steps/`, `features/steps/`, `features/support/`) en tu repo:
el runner los carga **junto** a los del kit. Usa las mismas frases o añade las tuyas:

```js
import { Then } from "@cucumber/cucumber";
Then(/^el saldo debería ser \$(\d+)$/i, function (n) {
  // ... tu aserción de dominio
});
```

> El core es el **activo reutilizable** entre empresas; los steps de dominio propio viven en cada
> repo. No edites los archivos materializados en `qa-generated/` (se regeneran en cada corrida).
