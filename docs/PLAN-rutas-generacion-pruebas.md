# Rutas para generar/ejecutar pruebas a partir de los AC (+ casos adicionales)

> Documento de arquitectura: evalúa **dos rutas** para ir de los Criterios de Aceptación (AC) y
> casos adicionales a **pruebas ejecutables**, con sus ventajas, costos y una recomendación.
> Pensado para mantener registro de la decisión (por qué se eligió lo que se eligió).

## Objetivo

Que el ciclo QA pueda, a partir de los AC de cada HU **y** de casos adicionales, producir y ejecutar
pruebas **trazables** (online en el tracker + offline en el reporte local), respetando los invariantes
del kit: `core/` portable y offline/determinista; la generación es una **estrategia inyectable**
(`generateTests`); las skills solo hablan con `tracker-adapter`; evidencia normalizada al sink.

---

## Ruta A — Generador con IA (lo ya implementado)

Un LLM (Google Gemini / Anthropic / **Ollama local**) escribe el **código real** del test a partir
del texto del AC, con *grounding* del repo (contexto real para no inventar imports/rutas) y fallback
determinista a esqueletos. Vive solo en la webapp; el core sigue offline.

- **Qué produce:** código de test en el framework del repo (lo que escribiría un dev).
- **Pros:** bajo setup, muy flexible (cualquier lógica), agnóstico de proveedor (incl. local/$0).
- **Contras:** riesgo estructural de IA — puede **alucinar** (funciones/selectores inexistentes) o
  escribir un test que **pasa pero valida lo incorrecto** → **revisión humana obligatoria**.
- **Estado:** implementada. Fase A (esqueletos) + Fase B (IA, 3 proveedores) + grounding. Detalle en
  `docs/PLAN-ia-generacion-tests.md`.

---

## Ruta B — BDD ejecutable + Catálogo de plantillas (ruta nueva propuesta)

**Cambio de paradigma: el AC ES el test.** El Gherkin del criterio se ejecuta tal cual mediante una
**librería de step-definitions reutilizable**. Los casos adicionales salen de un **catálogo de
plantillas parametrizadas**. Sin generación de código por IA → cero alucinación, 100% determinista.

> El activo comercial deja de ser "un generador con IA" y pasa a ser **tu librería de steps + tu
> catálogo de plantillas**, curados y reutilizables entre empresas, que ejecutan los AC literalmente.

### Piezas a construir

1. **Feature-writer (AC → `.feature`)** — `runtime/generate/feature-writer.mjs`
   Por HU emite Gherkin: `Feature: [HU-###] <título>`, **un `Scenario` por AC** (pasos = el
   Given/When/Then que el kit ya extrae como `detail`), con tags `@HU-### @TC-AC<n>`. Reusa el parseo
   de AC por encabezado, la convención `[HU-###]` y las claves `TC-AC<n>`.

2. **Librería de step-definitions (la "cola" = el activo)** — `bdd/steps/`
   Steps **core, agnósticos de proyecto**, por dominio: **web** (Playwright), **api** (HTTP), **db**
   (SQL). Ej.: `Given estoy en "{page}"`, `When hago clic en "{btn}"`, `Then debería ver "{texto}"`,
   `When hago GET "{ruta}"`, `Then el estado es {code}`, `Then la tabla "{t}" tiene {n} filas`. Cada
   proyecto **extiende** con sus selectores/verbos. El core se reúsa en todas las empresas.

3. **Runner `bdd`** — `runtime/runners/bdd.mjs`
   Ejecuta los `.feature` con el framework detectado: **Cucumber.js** (+Playwright) en JS/TS,
   **pytest-bdd**/**behave** en Python, **Reqnroll** en .NET. `qa-detect` enciende el target `bdd` si
   hay deps de BDD o archivos `.feature` (mismo patrón multi-target). Cada **Scenario = un caso** →
   reusa `parse-cases.mjs` (Cucumber JSON / pytest-bdd json) para el detalle por TC.

4. **Catálogo de plantillas (casos adicionales)** — `templates/bdd/`
   Plantillas de escenarios parametrizadas: smoke, CRUD, validación de formularios, auth, paginación,
   estados de error, accesibilidad. Plantilla = `.feature` template + parámetros (entidad, endpoint,
   campos…). El usuario elige plantilla + parámetros (webapp o archivo tipo `qa-intent.md`) → emite
   `Scenario`/`Scenario Outline` concretos que ejecuta el **mismo** runner `bdd`.

5. **Trazabilidad y evidencia (online + offline) — contrato intacto**
   Sigue publicando evidencia por HU + Plan del Feature vía `tracker-adapter`
   (`publishRequirementEvidence`, `publishTestPlan`). **Un TC por AC** (= un Scenario), mismas claves
   `TC-AC<n>`, idempotente. Mismos renderers de reporte local + comentarios del tracker, alimentados
   por los resultados del runner BDD.

6. **IA opcional y degradada (si se conserva):** solo **asistente** — sugerir un step-def para un
   paso sin mapear, o proponer parámetros de una plantilla. **Nunca** autora del test. Webapp,
   opcional, con fallback. (Reposiciona la Ruta A sin botarla.)

### Fases de implementación (cada una verificable: plan → aprobar → construir)

- **B1 — Esqueleto ejecutable:** feature-writer (AC→`.feature`) + `qa-detect` para `.feature`/BDD +
  runner `bdd` con **un stack** (Cucumber.js+Playwright) + parseCases + casos de smoke.
- **B2 — Librería de steps:** core web/api/db + mecanismo de extensión por proyecto.
- **B3 — Catálogo de plantillas:** plantillas parametrizadas + pipeline "aplicar plantilla" + UI en
  la webapp (la Revisión muestra **Gherkin legible**, no código).
- **B4 — Multi-stack + IA-asistente:** pytest-bdd, Reqnroll + sugeridor de steps opcional.

---

## Comparación honesta

| | Ruta A — Generador IA | Ruta B — BDD ejecutable |
|---|---|---|
| Qué produce | **Código** de test | El **AC mismo** se vuelve ejecutable |
| Confianza | Riesgo: alucina, "pasa pero valida mal" → revisión obligatoria | **Determinista**, sin alucinación, auditable |
| Trazabilidad | Buena (construida) | **Nativa** (Feature=HU, Scenario=AC) |
| Pitch enterprise | "una IA escribe tus tests, revísalos" | "tu AC se ejecuta tal cual, tu código no sale, es auditable" → **más fuerte** |
| Costo real | Bajo setup, depende de un modelo | **Inversión**: construir/mantener la librería de steps |
| Punto débil | Fiabilidad | Flojo para lógica **unitaria pura**; "impuesto BDD" si la librería se diseña mal |

**Verdad sin adornos:** no es "una mejor que la otra" en abstracto — son **herramientas distintas**.
Para el objetivo declarado (ejecutar pruebas con base en AC + casos adicionales) y para **vender a
empresas**, BDD es el **cimiento más sólido y defendible** (determinismo, trazabilidad, activo
reutilizable). Pero su robustez **no es gratis**: se paga construyendo una buena librería de steps, y
**no reemplaza** los tests unitarios. La IA es más flexible y de bajo setup, pero carga un riesgo de
fiabilidad inherente a que un LLM **escriba** los tests.

---

## Recomendación

No es "BDD **o** IA". Lo más robusto es **combinar**:

- **BDD como columna vertebral** (determinismo + trazabilidad + activo reutilizable),
- **+ catálogo de plantillas** para los casos adicionales estándar,
- **+ IA degradada a asistente opcional** (sugerir steps/parámetros), no autora del test,
- conservando los **esqueletos deterministas** como piso sin IA.

Como la generación es **inyectable**, las estrategias **coexisten** detrás de un flag: no hay que
arrancar nada de raíz, y la versión "limitada" (sin IA) puede correr **BDD-only**.

## Decisiones abiertas (confirmar antes de codear — no asumir)

1. **Trazabilidad de casos adicionales:** un Scenario que no nace de un AC, ¿se asocia a una HU
   elegida, al Feature, o a un bucket "pruebas personalizadas"?
2. **Dónde vive la capa de steps específica del proyecto:** ¿en el repo bajo prueba (junto a sus
   `.feature`) o como overlay del kit? (Recomendado: core en el kit, específicos en el repo probado.)
3. **Stack BDD a prototipar primero:** recomendado **Cucumber.js + Playwright** (encaja con el sesgo
   JS/Playwright del kit) para la B1.

## Nota sobre dónde construir (IP, separado de la calidad)

La **arquitectura** (qué ruta) es una decisión técnica. **Dónde** construirla (repo personal vs
laboral) es una decisión de propiedad intelectual e **independiente de la calidad**: ambos repos son
el mismo código. BDD es AI-free por defecto, así que sirve igual para simplificar la versión laboral
"limitada" como para ser el núcleo de la versión personal/comercial.
