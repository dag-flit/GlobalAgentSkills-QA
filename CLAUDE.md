# qa-kit — memoria del proyecto (para Claude Code)

> Este archivo lo lee Claude Code automáticamente al abrir el repo. Es el puente entre
> el trabajo hecho hasta ahora y la continuación. Mantenerlo actualizado al cerrar cada fase.

## Qué es esto

Kit de QA **acotado a un solo propósito: explorar una URL viva** (pruebas E2E sobre una app
ya corriendo — status HTTP, errores de consola y captura por página). Se maneja desde una
**webapp multitenant** (`webapp/`, Next.js, :4312). El proyecto es **deliberadamente sesgado a
la compañía** (Azure DevOps / FLIT): el tracker de destino de la evidencia es **local** o
**azure-devops**. La versión portable/robusta (multi-stack, multi-tracker) vive en el **repo
personal** (`damadogar/quality-assurance-suite`), no aquí.

> **Giro (2026-07-01):** se **retiró por completo** el modo "QA del código" (capas
> static/unit/e2e/api/db/security/bdd, generación BDD/esqueletos, plan por Feature, TC por
> criterio, novedades) y los trackers **Jira/GitHub**. Todo eso quedó en el historial de git
> (commits 91fe705 / be2531d / …) — recuperable con `git restore` si hiciera falta, pero NO se
> reincorpora. Antes existía un pipeline completo local-first sin sesgo; hoy el foco es E2E→ADO.

## Estado actual — kit explore-only

- **Motor (`runtime/orchestrator.mjs`):** backbone *slim* → `resolveProfile` → `getAdapter`
  (preflight condicional si hay red) → `runExplore` (si hay `appUrl`) → `publishEvidence`.
  Sin capas de código, sin generación, sin novedades.
- **Única capa (`runtime/runners/explore.mjs`):** abre la app con Playwright (launcher
  **inyectable** → offline-testable), visita la URL, emite un `EvidenceObject` (un caso por URL:
  status HTTP + errores de consola + captura). Sin `appUrl` no participa. Sin Playwright → skip.
- **Trackers (`core/tracker-adapter/index.mjs`):** solo `local` (reporte md+html en disco, sin
  red) y `azure-devops` (comenta el resumen en la HU + **adjunta las capturas** al Task hijo —
  esta es la ruta por la que las evidencias E2E llegan a ADO). Contrato **mínimo** (explore-only):
  `preflight`, `capabilities`, `getWorkItem`, `publishEvidence` (ver `CONTRACT.md`). Se retiraron
  los métodos de "QA del código" del adapter azure y el contrato base (createDefect, plan, novedades,
  commentFindings, evidencia por HU) — eran residuo del pipeline eliminado.
- **CLI (`runtime/cli.mjs`):** `node runtime/cli.mjs --url <https://app> [-w <HU>] [-f <FT>] [-d "<dev>"]`.
- **Webapp:** modo único "Explorar una URL" (`Tracker → URL → Ejecutar`). Tracker: Local o Azure.
- **Smoke:** `node runtime/smoke-test.mjs` → **30/30** (resolver; explore-suite: adapter azure +
  adjuntos + `getChildren`, runner explore, guion de pasos + localizadores, entrada avanzada +
  verificaciones ricas, cobertura de AC, `runQaCycle` local+azure+flow, guarda sin `-w`, retry HTTP,
  guardrail de líneas; **pr-suite**: lector de PR + clasificador E2E + scope-matrix + brief +
  `commentWorkItem`). Todo offline (launcher y transporte HTTP inyectables).

### Modo GUION E2E (flujo de pasos) — en construcción (Fase 4 en progreso)

Sobre el kit explore-only se agregó un **modo GUION**: además del URL-smoke, se puede correr un **flujo
de pasos** (login → navegar → verificar) sobre una misma sesión, con **captura + evidencia por paso**.
Se maneja desde la webapp con un **constructor visual para no técnicos** (sin YAML). Detalle y estado en
la memoria [[e2e-flujo-guion]].
- **Motor:** `runtime/runners/explore-steps.mjs` (registro de PASOS + `resolveLocator` + `${VAR}`) y
  `explore-flow.mjs` (ejecutor: orden, fail-fast, captura por paso vinculada al caso). `explore.mjs`
  bifurca: con `flow` → guion; si no → URL-smoke (compat). Orquestador y CLI aceptan `--flow`.
- **Catálogo (20 pasos)** por grupos: Navegación / Entrada / Espera / Verificación / Evidencia.
- **Localizadores amigables** (`por`: etiqueta/placeholder/texto/boton/css): se apunta por lo visible,
  no por CSS. **Secretos** por `${QA_USER}`/`${QA_PASS}` (efímeros, nunca en el guion).
- **Reporte auto-contenido:** el `local-sink` embebe las capturas como **data-URI** (no rutas relativas)
  + veredicto + timeline paso a paso.
- **F4.1 hecho:** contrato + adapters con `getWorkItem().type` y `getChildren(id)` (Azure por WIQL;
  local `[]`) — base del fan-out de Feature.
- **F4.2 hecho:** persistencia de guiones por HU. Migración `db/migrations/0005_flows.sql` (tabla `flows`
  con `tenant_id` + FORCE RLS + policy, patrón 0003) **ya aplicada**; `lib/db/flowsRepo.ts` (get/saveFlow
  por `withTenant`) + API `api/flows` (GET/PUT, `flowSaveSchema` zod). Los guiones NO guardan credenciales.
- **F4.3 hecho:** guardar/cargar guion en la HU desde el constructor (`useRunWizard` + `StepsStep`); el
  guion guardado es auto-contenido (el `ir_a` de la URL es el primer paso). Requiere WI destino (Azure).
- **F4.4 hecho:** fan-out de Feature en la webapp (`lib/qa/fanout.ts` + `runner.ts`): si el WI destino es
  Feature → recorre `getChildren`, corre el guion guardado (`getFlow`) de cada HU vía `runQaCycle` y
  publica evidencia por HU; HU sin guion se salta con aviso. `RunDetail` muestra la tarjeta de fan-out.
- **F4.5 hecho:** campo **Importar/Exportar guion (JSON)** en el constructor
  (`run-wizard/FlowImportExport.tsx` + `useRunWizard.importFlowJson/exportFlowJson`). Pegar un guion
  en JSON lo carga de una vez en el constructor (separa el `ir_a` inicial → URL + pasos, valida cada
  `op` contra el catálogo, NUNCA ejecuta el texto); Exportar serializa lo armado. Sirve para pegar un
  guion producido fuera (p.ej. una exploración de Claude) sin escribir paso a paso. No importa
  credenciales (viajan como `${QA_USER}`/`${QA_PASS}`).
- **Fase 4 COMPLETA** (motor + persistencia + UI + import/export). **Falta:** validación end-to-end del
  usuario con un Feature+HU reales en ADO.

### Enfoque A — cobertura de criterios de aceptación (AC) por HU — en progreso

Objetivo: **validar los AC de cada HU dentro del E2E** SIN revivir el pipeline purgado (nada de generar
tests desde el requerimiento ni IA). Es **aditivo y determinista**: se mapea la evidencia del guion a los
AC declarados de la HU. NO altera el guion actual ni el fan-out.
- **A.1 hecho (mostrar los AC):** el adapter azure ya devuelve `acceptance_criteria: [{title, detail}]`
  (`getWorkItem` → `parseAc`). Se agregó ruta de lectura `webapp/src/app/api/tracker/workitem/route.ts`
  (GET `?wid`, solo Azure, usa la config guardada del tenant — el PAT nunca viaja al navegador) y la
  tarjeta `run-wizard/AcPanel.tsx` (carga a demanda, solo lectura) enganchada en `StepsStep`. Muestra los
  criterios declarados para tenerlos a la vista al armar el guion. **Feature-aware:** si el WI es un
  Feature, la ruta detecta las HU hijas (`getChildren`) y trae los AC de cada una (`getWorkItem` por hija);
  el panel las lista con sus criterios (mismo criterio que el fan-out). WI simple → sus propios AC.
- **A.2 hecho (matriz de cobertura):** cada paso de verificación puede declarar qué AC prueba (`ac`).
  Motor: `runtime/evidence/ac-coverage.mjs` (puro: cruza `case.ac` con `declaredAcs` → cubierto/fallo/sin
  cubrir); `explore-flow` adjunta `ac` al caso, `explore.runFlowMode` adjunta `coverage` al EvidenceObject,
  `orchestrator`/`runExplore` aceptan `declaredAcs`. Reporte: `local-sink` (sección md+html) y `ado-html`
  (línea + lista en el comentario del WI). Webapp: `steps-catalog.provesAc` + `cleanStep` incluye `ac`;
  `StepsStep` muestra un desplegable "¿Qué AC prueba?" en verificaciones (poblado por `w.acs`, que setea
  `AcPanel` al cargar una HU); `useRunWizard` envía `declaredAcs`; `runner`/`fanout` los pasan (fan-out:
  AC declarados POR HU vía `getWorkItem`); `RunDetail` muestra la tarjeta de cobertura. Smoke **22/22**.
  Es MAPEO determinista (NO genera pruebas ni usa IA). **Enfoque A COMPLETO** (mostrar AC + matriz).

### Enfoque AUTÓNOMO — autogenerar el guion desde los AC (Fase 1 en progreso)

Objetivo del usuario: **quitar el trabajo a quien ejecuta** — enviar un Feature/HU y que el sistema, sin
copiar/pegar ni completar localizadores, **lea los AC de ADO, deduzca el guion y lo ejecute**. Se acordó
un enfoque **A+B**: (A) generador **determinista** dentro del producto (SIN IA) + (B) Claude concreta
localizadores si hace falta; y una **Fase 2 OPCIONAL** con **Ollama local/off-by-default** (detrás de una
interfaz) SOLO para el long tail de localizadores — el núcleo NUNCA depende de IA. La resolución de
localizadores se apoya en que Playwright `getByLabel/getByRole` matchean por **subcadena** (p.ej.
`getByLabel("Usuario")` matchea "Usuario Corporativo") → cubre el caso común gratis.
- **F1.1 hecho (motor puro):** `runtime/generate/ac-to-flow.mjs` (211 líneas, PURO/offline, SIN IA):
  `generateFlowFromAc({acs, appUrl, title})` → `{flow, notes, e2eable, reason}`. Parsea Gherkin (Dado/
  Cuando/Entonces, es/en) con diccionario de verbos y extractores; emite pasos VÁLIDOS del registro
  (`ir_a/escribir/clic/verificar_*`), usa `${QA_USER}`/`${QA_PASS}` para login (nunca el valor), y
  **auto-etiqueta el `ac`** en las verificaciones → la matriz de cobertura se llena sola. `classifyE2eable`
  descarta HU backend/migración/API. Suite propia `runtime/smoke/generate-suite.mjs` (Gherkin→pasos +
  clasificación + el guion generado CORRE en el runner). Smoke **22/22**.
- **F1.2 hecho (cableado webapp):** `webapp/src/lib/qa/autogen.ts` (puente → `importKit` del generador;
  lee los AC vía `adapter.getWorkItem`; guion EFÍMERO, no se persiste). `fanout.ts`: si una HU hija no
  tiene guion guardado, **autogenera** desde sus AC (antes se saltaba); marca `origen: guardado|autogenerado`.
  `runner.ts`: pasa `autogen` al fan-out **y** para una **HU sola** sin guion manual autogenera desde sus AC
  (`autoFlow`/`autoDeclaredAcs`). Prioridad del guion: manual/guardado > autogenerado. Preserva la ruta E2E
  libre (URL-smoke/manual intactos). tsc 0, smoke 22/22, line-budget 0.
- **F1.3 hecho (login automático):** paso `login` heurístico y GENÉRICO (sin sesgo de app) en
  `explore-steps.mjs` (usuario por etiqueta/heurística, clave por `input[type=password]`, enviar por
  botón submit/acceso; credenciales por `${QA_USER}`/`${QA_PASS}`). El generador lo antepone tras el `ir_a`
  cuando `login:true`; `autogenFlow(...,login)` y `runner.ts` (`hasCreds = vars.QA_USER && vars.QA_PASS`)
  lo activan cuando la corrida trae credenciales. Solo aplica al guion AUTOGENERADO (los manuales traen su
  propio login). Smoke **22/22** (caso login en generate-suite). tsc 0, line-budget 0.
- **VALIDADO contra Feature 10115 real (2026-07-03):** el pipeline corre de punta a punta (backend HU se
  saltan con razón; frontend 10178/10179 autogeneran+corren+publican). PERO los guiones salieron DÉBILES:
  los AC de FLIT son **narrativos, NO Gherkin con nombres de UI** ("envía invitación", "intenta activar")
  → el determinista omite pasos o inventa verificaciones literales que fallan. Confirma que el determinista
  NO basta para estos AC → se justifica la **Fase 2 (IA local)**. El usuario la aprobó.
- **Fase 2 EN CURSO — IA local (Ollama), B1, modelo CONFIGURABLE (sin sesgo), OFF por defecto, config en
  AJUSTES por tenant; el núcleo NUNCA depende de IA.** Sub-pasos: F2.1 config (hecho) → F2.2 planner Ollama
  (AC+DOM→guion, con fallback determinista) → F2.3 recon (login→captura DOM) + cableado + interruptor.
  - **F2.1 hecho (config IA por tenant):** `AiConfig {enabled,endpoint,model}` (`types.ts`, `AppConfig.ai`).
    Migración `webapp/db/migrations/0006_ai_config.sql` (columna `ai jsonb` en `tracker_config` → hereda
    tenant_id+FORCE RLS de 0003; forward-only; **aplicada**). `config.ts` (default OFF, merge, redact/preserve
    —sin secretos), `configRepo` (lee/escribe `ai`), `schemas.aiConfigSchema` + `appConfigSchema.ai` opcional
    (no clobber), ruta `PUT /api/config/ai` (solo la porción `ai`). UI: `run-wizard/AiPanel.tsx` **dentro del
    asistente, en el paso «Pasos»** (ver corrección "Config IA movida de Ajustes al asistente"); ya NO vive en
    `/settings`. tsc 0, smoke 22/22, line-budget 0.
  - **F2.2 hecho (planner Ollama + fallback determinista):** `runtime/generate/flow-planner.mjs`
    (`planFlow({acs,appUrl,title,login,dom,ai,http})` → `{flow,notes,e2eable,reason,origin}`) con proveedor
    **Ollama** (`POST {endpoint}/api/generate`, `format:"json"`, transporte **inyectable** → offline-testable)
    y `runtime/generate/flow-sanitize.mjs` (saneo ESTRICTO de la salida del modelo contra el registro
    `STEPS`: op/campo fuera de la whitelist → descartado; campos mínimos por op; tope 60 pasos/300 chars).
    Núcleo NUNCA depende de IA: **IA off/sin modelo/sin http → determinista**; **IA on pero falla/vacía →
    determinista** (con nota); **IA ok → guion saneado + scaffold** (`ir_a`/`login` los pone el planner,
    la IA solo aporta acciones/verificaciones). Filtro para el path IA: solo `titleLooksBackend` (NO exige
    Gherkin — es justo lo que la IA cubre en AC narrativos). Webapp: `autogen.autogenFlow(...,ai)` usa
    `planFlow` (http endurecido de `http-retry` SOLO si IA activa); `runner`/`fanout` pasan `cfg.ai` y
    muestran el `origin` (IA local / determinista). Allowlist `kit.ts` +`flow-planner.mjs`+`http-retry.mjs`.
    Suite `runtime/smoke/planner-suite.mjs` (IA saneada+scaffold, fallback al fallar y con IA off sin llamar,
    saneo directo). Smoke **24/24**, tsc 0, line-budget 0.
  - **F2.3 hecho (recon + cableado + UI):** `runtime/generate/recon.mjs` (`captureDom({appUrl,login,env,vars,
    launchBrowser,timeout})` → `{ok,dom,message}`): abre la app, opcionalmente inicia sesión (reusa `STEPS.login`)
    y captura un resumen del DOM VISIBLE (campos con su etiqueta, botones, enlaces, títulos) vía `page.evaluate`
    — launcher INYECTABLE → offline-testable. `runner.ts`: si la IA está activa (`cfg.ai.enabled+model`) y hay
    URL+launcher y se va a autogenerar, corre el recon **UNA vez** (login = `hasCreds`) y comparte el `reconDom`
    con el fan-out y la HU sola; best-effort (si falla, la IA usa solo los AC). `autogen.autogenFlow(...,dom)` →
    `planFlow({dom})`. UI: badge de origen del guion (🤖 IA local / determinista) en la tarjeta de fan-out de
    `RunDetail`; indicador informativo en el resumen del asistente (`RunSummary`) leyendo `cfg.ai.enabled` de
    `/api/config` vía `useRunWizard.aiEnabled` (fuente única: Ajustes; no duplica el interruptor). Allowlist
    `kit.ts` += `recon.mjs`. Smoke **25/25** (recon: navega+login+captura DOM; el DOM viaja en el prompt), tsc 0,
    line-budget 0. **Fase 2 COMPLETA** (config + planner + saneo + recon + UI). **Falta:** el usuario instala
    Ollama, enciende el Asistente IA en Ajustes y valida E2E contra un Feature/HU reales (p.ej. 10115).

### Cómo se hizo el giro (4 fases, todas HECHAS)

1. **Fase 1 — UX:** se quitó "QA del código" del selector de modos (reversible, sin borrar).
2. **Fase 2 — Webapp:** borrados componentes/ rutas code-only (`FeatureStep`, `ReviewStep`,
   `SourceStep`, `DetectStep`, `CoverageCard`; API `detect`/`generate`/`plan`/`templates`/
   `tracker/children`; libs `generate.ts`/`detect.ts`/`bdd-generator.ts`) y limpiados los ramales
   `mode==="code"` (`RunWizard`, `useRunWizard`, `runner.ts`, `RunSummary`, `UrlStep`, `RunDetail`).
3. **Fase 3 — Motor:** `orchestrator.mjs` reescrito a slim; borrados runners de capa,
   `_runner-core`, `parse-cases`, `orchestrator/{plan-phase,novelty}`, generadores
   (`feature-writer`, `skeleton-generator`, `template-applier`), `detect/qa-detect`, adapters
   **github/jira** + presets, `_shared/parse-ac`, `bdd/`, `templates/bdd/`. Factory: local + azure.
4. **Fase 4 — Tests + docs:** smoke re-baselinado a 14, `manifest.yaml` saneado, `CLAUDE.md`
   reescrito, skills de runners eliminadas (queda `url-explore`), CLI con `--url`.

### GIRO (2026-07-06): pruebas guiadas por INSTRUCCIÓN en lenguaje natural (reemplaza autogen ciego desde AC)

Tras validar el autogen desde AC contra el Feature 10139, el usuario confirmó que produce **"teatro de
pruebas"**: guiones que CORREN pero no VALIDAN el AC (clic aleatorio sobre lo que el recon ve, verificaciones
inventadas). Decisión: el usuario **escribe en lenguaje natural qué probar por HU** ("Entrá a Reportes, poné
fechas, clic Exportar Excel, validá que descarga") y la **IA (Ollama) traduce esa instrucción a un guion**.
Le quita a la IA lo que no podía resolver sola (cómo navegar + qué afirmar); no la ejecución. Mecanismo
elegido por el usuario: **IA traduce → guion** (reusa saneo/runner/evidencia/cobertura). HU sin instrucción ni
guion guardado → **se salta con aviso** (no se inventa desde los AC).
- **Motor:** `flow-planner.planFlow({...,instruction})` — con instrucción, es la fuente PRIMARIA del prompt
  (`buildPrompt` la antepone; los AC + el recon quedan de contexto). El path instrucción **exige IA**: sin IA
  no hay traducción de prosa → `e2eable:false` con razón accionable (NO cae al determinista). El path AC
  (sin instrucción) queda intacto para compat/smoke, pero la webapp ya no lo usa a ciegas.
- **Persistencia:** migración `0007_instructions.sql` (tabla `hu_instructions`, tenant_id + FORCE RLS, patrón
  0003; **aplicada**) + `lib/db/instructionsRepo.ts` (get/saveInstruction) + `GET/PUT /api/instructions`
  (`instructionSaveSchema` zod). La instrucción NO trae credenciales.
- **UI:** campo **«¿Qué probar? (en tus palabras)»** por HU en `run-wizard/AcPanel.tsx` (subcomponente
  `HuInstruction`: carga lo guardado, guarda al salir del campo), debajo de los AC de cada HU hija y de la HU
  suelta — así el usuario no va a Azure a deducir qué validar. `useRunWizard` mantiene `instructions {hu_id→
  prosa}`, las envía al lanzar (override de lo guardado) y expone `saveInstruction`.
- **Ejecución:** `runInputSchema.instructions` (zod) → `runner`/`fanout`. Prioridad por HU: **guion guardado >
  instrucción (IA) > se salta**. `fanout` recibe `getInstruction` + `autogen(cid,instruction)`; la HU sola usa
  su instrucción (sin instrucción → smoke de la URL, ya NO autogen desde AC). Badge de origen "instrucción
  (IA local)" en `RunDetail`; `RunSummary` explica el nuevo modelo. Smoke **28/28** (+caso instrucción en
  planner-suite), tsc 0, line-budget 0. Reiniciar `npm run dev`. **Pendiente:** el usuario escribe instrucciones
  en las HU del Feature 10139 y valida E2E.

### GIRO (2026-07-08): QA guiado por PR (determinista, sin IA) — **retira TODA la IA**

Tras validar el autogen/instrucción-IA, el usuario decidió **quitar la IA por completo** y cambiar la fuente
de "qué validar": **leer los PR de GitHub que despliegan los devs**. Objetivo: quitarle trabajo a quien
ejecuta Y superar el "happy path" del dev con un **alcance más completo** (técnicas ISTQB). Todo
**determinista** (regex + paths + reglas), el núcleo nunca depende de IA. Decisiones del usuario: (Q1) eliminar
la IA del flujo; (Q2) entregable = **brief (qué validar) + correr los guiones guardados**; alcance = más que el
happy-path del dev.

- **Fase 0 — se ELIMINÓ toda la IA + la feature de "instrucción" (sin commitear):** borrados
  `runtime/generate/*` (flow-planner/recon/flow-sanitize/ac-to-flow), `webapp/.../qa/autogen.ts`, `AiPanel.tsx`,
  rutas `api/config/ai` + `api/instructions`, `instructionsRepo.ts`, migración `0007` (untracked), y todo el
  cableado (`AiConfig`/`cfg.ai` en types/config/configRepo/schemas, `instructions` en runner/fanout/useRunWizard,
  `HuInstruction` en AcPanel, bloque IA en RunSummary/StepsStep). `fanout` corre **solo guiones guardados**; HU
  sin guion se salta. La columna `ai` (0006) queda **huérfana** en BD pero inofensiva (forward-only; no se dropea).
  Recuperable por git si hiciera falta, pero NO se reincorpora.
- **Pipeline nuevo `runtime/pr/` (puro, offline-testable, transporte inyectable, sin IA):**
  - `pr-reader.mjs` — lee un PR de GitHub (API **pública**; `GITHUB_TOKEN` opcional en el server): archivos
    cambiados, "test plan" del dev, y **vincula HU/Feature de ADO** (regex rama/título/cuerpo). Distingue la
    **HU primaria** (la que el PR entrega) y NO cuenta el nº de Feature como HU. `parseRepoUrl`, `findPrsForWorkItem`.
  - `classify-files.mjs` — clasifica cada archivo: `frontend-visible` (E2E) vs `frontend-support`/backend/infra/
    docs/test, con **área** funcional (usuarios/login/…). Solo lo visible es objetivo E2E.
  - `scope-matrix.mjs` — **el "más completo"**: expande cada AC + área en escenarios por técnica ISTQB
    (camino_feliz, validación_negativa, valor_límite, partición, permisos_RBAC, estado_error, regresión_adyacente,
    no_funcional) y marca **dev-cubierto vs gap-QA** (solapamiento de palabras AC↔test-plan del dev; de-acentúa).
  - `brief.mjs` — ensambla el **brief** (markdown + HTML auto-contenido + `briefComment` = fragmento HTML para ADO).
- **Contrato:** nuevo método `commentWorkItem(id, html)` (azure = `addComment` en la Discussion; local = `{ok:false}`).
  Ver `CONTRACT.md`. Es texto de contexto (el brief), NO evidencia.
- **Webapp:** allowlist `kit.ts` += `pr-reader.mjs`+`brief.mjs`; `lib/qa/prBrief.ts` (`buildPrBrief`/`publishPrBrief`:
  lee el PR, trae los AC por HU vía adapter azure —PAT nunca al navegador—, arma el brief); rutas
  `POST /api/pr/brief` y `POST /api/pr/publish` (`prBriefSchema`/`prPublishSchema` zod); página **`/pr` «Analizar
  PR»** (pegar URL → ver brief en iframe → publicar en la HU → correr guiones guardados del Feature/HU vía el
  runner/fan-out existente). Sin nueva migración: la URL del PR se pega por corrida y el token vive en el server.
- **Reutiliza** el fan-out existente para "correr lo que tenga guion" (Q2). El brief dice el **QUÉ**; el **CÓMO**
  (clics) lo aporta un guion guardado o el humano — ya NO se autogenera.
- **VALIDADO en vivo** contra `flitsas/flit` (PRs #110/#118 reales, API pública): vincula HU primaria + Feature,
  clasifica 90 archivos, y el brief revela que el dev solo corrió CI → todo queda como gap-QA.

#### Fases 7–9 (2026-07-08) — refinamientos pedidos por el usuario tras probar `/pr`

- **F7 — Detección AUTORITATIVA (no adivinar por el título):** el usuario detectó que se colaba el nº del
  propio PR como HU (`#150`) y que se raspaban números sueltos. Fix en `pr-reader.extractWorkItems`: devuelve
  **`candidates`** SOLO de fuentes confiables (rama `agent/10618-slug` + marcadores explícitos `HU/US/Feature #N`),
  **excluye el nº del propio PR** (`prNumber`) y **ya NO raspa** `#NNNN` sueltos. La clasificación HU vs Feature
  la decide **ADO por el `type` REAL**: `prBrief.buildPrBrief` llama `getWorkItem` por candidato → `detected
  {features,hus,other,notFound}`. La UI muestra lo detectado y el usuario **confirma/elige** el WI (nunca se
  asume). PRs de ajuste en caliente **sin HU** → soportado (brief por áreas). `splitBestEffort` da un preview
  sin ADO (local). Smoke: candidatos excluye el nº del PR + no raspa sueltos.
- **F8 — Andamiaje determinista (`runtime/pr/scaffold.mjs`, sin IA):** `scaffoldFlow({appUrl,acs,login,title})`
  → esqueleto de guion (ir_a → [login] → una `verificar_texto` placeholder por AC, con `ac` etiquetado para la
  cobertura → captura) con placeholders «completar: …». NO adivina localizadores (eso era la IA/"teatro"); las
  pruebas negativas/RBAC quedan como NOTAS a agregar. Es un molde que el humano completa.
- **F9 — Unificado en el asistente de Ejecución (nuevo paso «Desde un PR»):** `run-wizard/PrStep.tsx` (tras
  Tracker): pegás el PR → detecta+**confirmás** el WI (chips Feature/HU, marca si la HU tiene guion guardado:
  cobertura) → ves el brief (iframe) → **publicar** el brief en la HU / **generar andamiaje** (carga el esqueleto
  al constructor y sigue) / **correr** (fan-out del Feature). `buildSteps` += `pr`; `prBrief` devuelve `scaffold`;
  allowlist `kit.ts` += `scaffold.mjs`. La página `/pr` suelta queda como **atajo**. Smoke **30/30** (+scaffold),
  tsc 0, line-budget 0. **Pendiente:** el usuario valida el flujo unificado con Azure (detección real + andamiaje
  + publicar + correr) contra un PR/Feature real (p.ej. #150 / Feature 10618).

## Invariantes (no romper)

1. **Local-first para explore:** ningún paso de red es obligatorio. Con `tracker: local` la
   corrida deja el reporte en `qa-evidence/` sin PAT.
2. **Las skills/orquestador hablan solo con `tracker-adapter`**, nunca con ADO directo.
3. **Evidencia normalizada → sink.** El runner emite `{layer, tc_id, status, files, narrative,
   cases}` y el adapter decide destino (`local` = md+html; `dual` = comentario + adjuntos en ADO).
4. **Node `.mjs`, cross-platform.** Sin PowerShell ni Python en `core/`/`runtime/`.
5. **Ejecución/transporte inyectables** (launcher de navegador + HTTP) → todo offline-testable.
6. **Ningún archivo de código supera 400 líneas** (`.mjs/.ts/.tsx`). Guardrail:
   `node scripts/check-line-budget.mjs [all|engine|webapp]`. La `ALLOWLIST` está vacía: NO repueblar.
7. **El smoke queda verde.** Tras cada cambio: `node runtime/smoke-test.mjs` (30/30). Si agregas
   capacidades, agrega su caso.
8. **Webapp multitenant — aislamiento por tenant (detalle en `docs/MULTITENANT.md`).** La webapp es
   un servicio multitenant (Postgres + RLS forzada, auth propia, secretos cifrados AES-256-GCM); el
   endurecimiento de la auditoría **sigue intacto y es ortogonal al giro explore-only**. Al extender:
   - **Control-plane (`CONTROL_PLANE_URL`) ≠ data-plane (`DATABASE_URL`):** nunca mezclar.
   - **Datos del tenant SOLO por `withTenant`/`withTenantScope`** (nunca `query()` crudo → RLS no filtraría).
   - **Secretos SOLO por `secretsCrypto`/`secretsMapper`; inputs SOLO por zod** (`lib/validation`).
   - **Tabla nueva con datos del tenant** → migración forward-only con `tenant_id` +
     `FORCE ROW LEVEL SECURITY` + policy (copiar `webapp/db/migrations/0003_rls.sql`).
   - Gate al cerrar: `npx tsc --noEmit` + `check-line-budget all` + smoke 30/30.

## Correcciones / endurecimientos posteriores — registro

> **Regla permanente:** cada corrección se registra aquí Y en la memoria del proyecto, y NO debe
> dañar ni debilitar lo endurecido en la auditoría multitenant (RLS, auth, cifrado, validación zod,
> motor offline). Objetivo siempre: **la mayor robustez posible**.

*(Las correcciones del antiguo pipeline de código —guardrail de tracker, TC BDD, detección
auto-contaminación, novedades en dos niveles— quedaron en el historial junto con el código que las
contenía; ver git. Registrar aquí las nuevas del kit explore-only.)*

- **Reporte con imagen rota (404) → reporte auto-contenido.** El `report.html` embebía las capturas con
  ruta relativa (`capturas/x.png`); servido por `/api/artifacts?path=…`, el navegador la resolvía a
  `/api/capturas/x.png` → 404. Fix: `local-sink` embebe las capturas como **data-URI** (base64) dentro
  del HTML → funciona por proxy, del disco y adjunto por correo. No debilita nada.
- **Fallback silencioso a URL-smoke → wizard endurecido.** Un paso a medio llenar se descartaba en
  silencio y la corrida caía a URL-smoke (el usuario creía correr un flujo). Fix: `StepsStep` marca el
  paso incompleto y **no deja continuar** hasta completarlo o quitarlo.
- **Evidencia (capturas) no llegaba a la HU en E2E → adjuntar directo a la HU (fallback).** El adapter
  azure adjuntaba las capturas SOLO a un **Task hijo** resuelto por `tc-match` (título que contiene el
  `tc_id`). En modo GUION el `tc_id` es el **nº de la propia HU**, así que casi nunca había un Task con
  ese título → las capturas caían en `unmatched` y **no se subían** (el resumen sí se comentaba). Fix:
  `_attachEvidence` usa `targetId = m.taskId || parentId` — si ninguna estrategia matchea, la evidencia
  se adjunta **directo a la HU/WI padre** (`strategy: "parent_work_item"`); la ruta de Task hijo se
  conserva cuando sí existe (mapping/título). Smoke +1 (caso B2, 22/22). No debilita nada; el reporte
  local sigue igual. **Recordar reiniciar `npm run dev`** (motor tocado → import cacheado).
- **Autogeneración fallaba en silencio (allowlist de importKit) → sincronizar allowlist + surface del error.**
  El fan-out mostraba "sus AC no permiten autogenerar" (genérico) para TODAS las HU, incluso frontend. Causa:
  `webapp/src/lib/qa/kit.ts` tiene una **allowlist anti-RCE** (`ALLOWED`) de módulos del motor importables;
  `runtime/generate/ac-to-flow.mjs` NO estaba en ella → `importKit` lanzaba "Módulo del kit no permitido",
  y el `.catch(()=>null)` de `autogen` lo tragaba → cada HU caía al mensaje genérico y se saltaba. Fix:
  agregar el generador a `ALLOWED` (la propia lista pide mantenerla sincronizada con los `importKit(` reales)
  + el `catch` de `fanout` ahora **emite el error real** en vez de tragarlo. NO debilita el blindaje (la lista
  sigue cerrada). Reiniciar `npm run dev` (kit nuevo importado).
- **Planner IA (Ollama) caía al determinista de forma intermitente → normalizar la forma del paso + inferir
  localizador.** Validado con Ollama real (qwen2.5:7b, 2026-07-03): el circuito corre (planFlow→Ollama→saneo→
  scaffold) pero ~2 de cada 3 corridas caían al determinista ("La IA no produjo pasos accionables tras el saneo").
  Causa: el modelo a veces emite la **forma abreviada** `{"clic":{"por":"boton","en":"…"}}` (op como CLAVE) en
  vez de `{"op":"clic",…}`; `sanitizeStep` leía `raw.op` (undefined) → descartaba TODOS los pasos → fallback.
  Fix en `runtime/generate/flow-sanitize.mjs`: **normaliza cada paso con `normalizeStep`** (reusa el del runner:
  acepta `{op,…}`, la forma abreviada y el atajo `"url"`) ANTES de validar. Segundo fix: cuando el modelo usa un
  `por` inválido (`campo`/`opción`/`email`) se limpiaba y el paso caía a css roto → ahora, si el op usa
  localizador, quedó sin `por` válido, hay `en` y no parece CSS, se **infiere amigable** (`boton` para clic,
  `etiqueta` para el resto → match por subcadena). Además `flow-planner` fija `temperature:0` y el prompt trae un
  ejemplo EXACTO de forma + los tokens válidos de `por`. Resultado: **5/5 corridas `origin:ia`** (~4s) con guion
  ejecutable. Smoke +casos (forma abreviada + inferencia), **25/25**. NO debilita el saneo (la whitelist de ops/
  campos sigue cerrada; normalizeStep solo reconoce formas, no amplía ops). Reiniciar `npm run dev`.
- **Desplegable de AC ausente en los pasos → carga automática + aviso.** El desplegable "¿Qué AC prueba?"
  solo aparecía si `w.acs` estaba poblado, y `AcPanel` cargaba **a demanda** (había que tocar "Ver
  criterios"): el usuario no lo veía. Fix: `AcPanel` **auto-carga** los AC al entrar con una HU Azure
  (`useEffect`, con el early-return DESPUÉS de los hooks para no violar las reglas de React) y `StepsStep`
  muestra un **aviso** en verificaciones cuando no hay AC (cargá el panel / la HU no tiene AC declarados).
- **Config IA movida de Ajustes al asistente (paso «Pasos»).** El Asistente IA (Ollama) se configuraba en un
  módulo suelto de `/settings` (`components/AiSettings.tsx`), pero el usuario topaba con el mensaje "activá el
  Asistente IA en Ajustes" recién en el paso «Ejecutar» y tenía que salir del flujo. Fix (decisión del
  usuario): se **movió** el editor al asistente de ejecución como tarjeta OPCIONAL en el paso «Pasos»
  (`run-wizard/AiPanel.tsx`), al lado de armar/importar el guion; se **borró** `AiSettings.tsx` y su uso en
  `/settings`. `AiPanel` reusa el mismo `PUT /api/config/ai` (config por tenant, sin secretos: Ollama es
  local) → el runner sigue leyendo `cfg.ai` sin cambios (una sola fuente de verdad). Al guardar, `AiPanel`
  llama `onSaved` → `useRunWizard.setAiEnabled` refresca en vivo el estado que muestra el resumen «Ejecutar»
  (mensaje actualizado a "activá el Asistente IA en el paso «Pasos»"). Se **conserva** el constructor de guion
  manual (precisión + guiones reutilizables para el fan-out + red de escape). Prioridad intacta:
  guion manual/guardado > autogenerado (IA/determinista). tsc 0, smoke 25/25, line-budget 0. Cambio solo de
  webapp (sin motor `.mjs`) → Next.js recompila en caliente, no exige reiniciar `npm run dev`.

- **Login (y recon) fallaban en apps client-rendered (SPA) → esperar el render.** Corrida real contra el
  Feature 10139 (dev.flitsas.online): las 6 HU E2E fallaron TODAS en el paso 2 `login` ("no se encontró el
  campo de usuario", ~30 ms) → por *fail-fast* murieron los pasos 3…N → todo `failed`, AC `uncovered`. Causa:
  `dev.flitsas.online` es una SPA (React); al evento `load` la página está EN BLANCO (captura del fallo =
  página blanca) y el formulario lo pinta el JS después. El paso `login` (`explore-steps.mjs`) sondeaba el DOM
  con `firstPresent` → `locator.count()`, que mira el DOM UNA vez y **no espera** → 0 campos. (Los guiones
  MANUALES funcionaban porque `escribir/clic` usan localizadores que auto-esperan; el `login` genérico no.)
  Además el `recon` leía `0 caracteres` (mismo motivo) → la IA generaba los guiones **a ciegas** (solo AC).
  Fix (motor): (1) `firstPresentWait` — sondea con reintentos hasta `timeout` a que aparezca el campo (SPA);
  `stepLogin` lo usa para usuario/clave/botón. (2) `settleSpa` (exportado) — tras `page.goto` espera
  `networkidle` best-effort (GUARDADO: si el fake no tiene `waitForLoadState`, se omite → smoke offline
  intacto); lo llaman `stepIrA` y el `recon`. (3) `recon.captureWhenReady` — sondea `extractDom` hasta que el
  DOM tiene contenido (deja de leer 0 chars). Smoke +2 casos (login-SPA con `count 0,0,1`; recon-SPA vacío→
  contenido) → **26/26**, tsc 0, line-budget 0. No debilita nada (transporte/launcher siguen inyectables).
  Reiniciar `npm run dev` (motor tocado). Pendiente: el usuario re-ejecuta el Feature 10139 y observa.

- **2ª corrida SPA: login OK pero lento (~15 min) y sin cumplir objetivo → 4 arreglos (perf + correctitud).**
  Tras el fix de SPA anterior, el Feature 10139 mejoró (recon leyó 236 chars, no 0; `ir_a`+`login` PASAN) pero
  seguía fallando y tardó ~15 min. Diagnóstico por BD (event deltas): (a) **una generación de Ollama se colgó
  ~10 min** (sin timeout en el fetch); (b) cada paso con localizador equivocado esperaba **30 s** (default de
  Playwright); (c) **doble login** — el motor antepone su `login` y la IA ADEMÁS generaba pasos de login con
  localizadores inventados ("Correo electrónico" inexistente; "Contraseña" por placeholder) → moría ahí, nunca
  probaba el dashboard; (d) el recon capturaba el LOGIN (no el dashboard) porque el `login` no esperaba a
  autenticar. Fixes: **(1)** `stepLogin` espera a que el login CIERRE (`passLoc.waitFor({state:"hidden"})` +
  `settleSpa`) antes de devolver → el recon captura el dashboard y la ejecución sigue autenticada. **(2)**
  Timeout a la IA en `flow-planner.planFlow` (`AbortController` + `AI_TIMEOUT_MS`=90s, env-ajustable; `defaultHttp`
  ahora reenvía `signal` a fetch y NO reintenta aborts) → una gen colgada aborta y cae al determinista. **(3)**
  Timeout por paso 30s→**15s** (`explore.mjs`, `EXPLORE_TIMEOUT_MS`) + `runFlow` fija `page.setDefaultTimeout(timeout)`
  → las acciones de Playwright fallan en 15s, no 30s. **(4)** Dedup de login en el path IA: `planFlow` descarta los
  pasos de login que invente la IA (`isLoginStep`) cuando el scaffold ya antepone `login`. Smoke +1 (dedup +
  timeout-IA en planner-suite; login-SPA ya estaba) → **27/27**, tsc 0, line-budget 0. No debilita nada.
  Reiniciar `npm run dev`. Pendiente: el usuario re-ejecuta 10139 y observa (debe ser MUCHO más rápido; el recon
  debería ver el dashboard). Nota: el mojibake en títulos de ADO sigue sin arreglar (latente, inofensivo aquí).

- **URL sin guion no iniciaba sesión ni validaba → login automático desde credenciales (determinista, sin IA).**
  El usuario corrió una prueba mandando **URL + WI (Azure)** con las credenciales cargadas pero **sin armar un
  guion**, y la corrida "no validó nada". Causa: sin guion, `runExplore` caía al **URL-smoke** (solo status HTTP +
  errores de consola + una captura); ignoraba las credenciales y **no logueaba**. (Con WI Feature habría sido el
  fan-out saltando HU sin guion; con HU suelta, el URL-smoke.) Nota: enviar WI+URL ya **no** deduce pasos — eso era
  el autogen retirado el 2026-07-08. Fix (motor, `runtime/runners/explore.mjs`): si llega **`appUrl` + sin `flow` +
  `QA_USER`&`QA_PASS`** (helper `hasCreds`, vars gana a env), se **sintetiza un guion mínimo `[ir_a → login]`** y se
  corre por `runFlowMode`; el ejecutor de flujo ya **captura una imagen por paso** → queda evidencia de la pantalla
  de login y del estado post-login (autenticado). **Sin credenciales → sigue el URL-smoke** (compat intacta). Reusa
  `STEPS.login` genérico (sin sesgo de app) y la captura por paso; NO revive autogen/IA (no inventa navegación ni
  afirmaciones). La webapp ya enviaba `vars` (credenciales del paso «Pasos», efímeras) sin tocar nada. Caso de smoke
  extraído a `runtime/smoke/explore-login.mjs` (para no pasar las 400 líneas de `explore-suite.mjs`) → **43/43**,
  line-budget 0. **Reiniciar `npm run dev`** (motor tocado). Para validar AC de verdad (afirmaciones), sigue
  haciendo falta un **guion** de pasos.
  - **Ampliación al FAN-OUT (mismo día):** al re-correr, el WI era un **Feature** (10515) → tomó el fan-out, que
    **ignora URL+credenciales** y solo corre guiones guardados; las 3 HU se saltaron (2 backend + 1 frontend sin
    guion) → `error` "No se ejecutó ninguna prueba" (el login sintetizado NO estaba en ese camino). Fix
    (`webapp/src/lib/qa/fanout.ts` + `runner.ts`): `FanoutDeps.appUrl`; una HU **frontend sin guion** con **URL
    adjunta** ya NO se salta → corre `runQaCycle({appUrl,vars,workItemId:cid})` = **login-smoke** (el motor
    sintetiza `ir_a→login`, captura por paso), etiquetada `origen: "login+captura (sin guion)"` (o "smoke de URL"
    sin credenciales). Sin URL → se salta como antes. NO valida AC (honesto, no "teatro"). tsc 0, line-budget 0,
    smoke 43/43. Solo TS de webapp → Next recompila en caliente (no exige reiniciar). Diagnóstico vía script pg
    fijando el GUC `app.current_tenant` (leer `runs`/`run_events` con RLS forzada). VALIDADO: el usuario re-corrió
    el Feature 10515 con URL+credenciales → la HU frontend 10517 dejó las capturas de login. ✔

- **Comentario de RESUMEN en el Feature (como QA del código).** Cada HU hija ya recibía su comentario
  (`publishEvidence`→`renderSummary`) pero el **Feature padre no recibía nada**. Fix: nuevo render PURO
  `runtime/evidence/fanout-comment.mjs` (`renderFanoutSummary({feature,hus})` → tabla HTML por HU + conteo
  pasó/falló/omitida, HTML escapado); `runner.ts` lo publica tras el fan-out vía `adapter.commentWorkItem(featureId,
  html)` (best-effort: si falla, la corrida no se cae — la evidencia por HU ya se publicó). Allowlist `kit.ts` +=
  `fanout-comment.mjs`. Reusa el contrato `commentWorkItem` (azure = addComment en la Discussion; local = no-op).
  La HU/WI simple ya comentaba (publishEvidence por HU) → "igual que QA del código". Suite `runtime/smoke/fanout-suite.mjs`
  → **44/44**, tsc 0, line-budget 0. Solo TS+módulo nuevo del motor: reiniciar `npm run dev` si el import quedó
  cacheado (el módulo es nuevo → primer import lo toma; a fin de asegurar, reiniciar). VALIDADO: el comentario de
  resumen queda en el Feature. ✔

- **Brief publicado en una HU que no era el WI enviado → aviso de mismatch (no bloqueante).** El usuario envió un
  WI (paso Tracker) y ADEMÁS analizó un PR sin relación; el brief terminó en la HU **detectada del PR**, no en el WI
  enviado, sin aviso. Causa: `PrStep.analyze()` hace `w.setWorkItem(target)` con la HU/Feature detectada del PR →
  **pisa en silencio** el WI que el usuario escribió; y `publish()` comenta en la HU del PR (`detected.hus`). El
  brief SIEMPRE sigue al PR (rama/marcadores en ADO), y no hay auto-publicación en la corrida (el brief se publica
  solo con el botón «Publicar brief en la HU»). Fix (`run-wizard/PrStep.tsx`, UI, sin motor): (1) `analyze()` **ya NO pisa
  el WI enviado**: solo pre-selecciona la HU/Feature del PR cuando el usuario NO envió un WI; si envió uno, se
  **respeta** (su elección manda), haya o no mismatch. (2) Si el WI enviado NO está entre los candidatos detectados
  del PR → **aviso ámbar no bloqueante** ("Enviaste el WI X, que no corresponde a este PR (detecté {Feature|HU} Y).
  Mantengo X como WI a ejecutar. Ojo: el brief se publica en la HU del PR (Y), no en X. Para cambiar el WI, elegí
  con los chips."). (3) El mensaje de «Publicar» aclara el destino cuando difiere del WI seleccionado ("(HU del PR,
  no el WI …)"). NO frena la ejecución (decisión del usuario). tsc 0, line-budget 0. Solo UI → Next recompila en
  caliente. Pendiente: el usuario repite el caso PR+WI distintos y ve el aviso + que su WI se mantiene.

## Mapa del repo

```
core/tracker-adapter/   contrato (CONTRACT.md + base + factory local+azure)
core/skills/url-explore/  skill: explorar una URL viva
core/agents/qa-orchestrator/  agente: ciclo de exploración → sink
adapters/trackers/      local (default) , azure-devops (evidencia E2E → ADO)
adapters/_shared/       http-retry (transporte con reintento)
profiles/               default.yaml , presets/azure-devops.yaml , overlays/flit.yaml
runtime/profile/        yaml-lite + resolver (deep-merge)
runtime/runners/        explore.mjs (única capa)
runtime/orchestrator.mjs  runQaCycle slim (perfil → adapter → explore → sink)
runtime/evidence/       sink local (md+html)
runtime/cli.mjs         entrypoint (--url)
runtime/delivery/build.mjs  empaqueta core/ a plain/claude-code/cursor
runtime/pr/             QA guiado por PR: pr-reader, classify-files, scope-matrix, brief (determinista)
runtime/smoke-test.mjs  prueba el plumbing offline (30/30)
webapp/                 UX web multitenant (Next.js, :4312) — el producto
docs/                   guías (MULTITENANT vigente; el resto es histórico del pipeline retirado)
manifest.yaml           inventario real, sin drift
```

## Resolución de perfil

`default.yaml ← presets/azure-devops.yaml ← overlays/flit.yaml ← qa-project.profile.yaml`
Repo sin perfil → `tracker: local`. `profile: flit` → hereda `flit ← azure-devops ← default`.

## Comandos

```bash
node runtime/smoke-test.mjs        # verificar plumbing del motor (debe dar 30/30 OK)
node scripts/check-line-budget.mjs [all|engine|webapp]   # guardrail de 400 líneas (exit 1 si viola)
node runtime/cli.mjs --url <https://app> [-w <HU>] [-f <FT>] [-d "<dev>"]   # explorar una URL
node runtime/delivery/build.mjs dist   # generar los targets de entrega en dist/

# Webapp multitenant (control-plane Postgres; ver docs/MULTITENANT.md):
cd webapp && node --env-file=.env.local db/migrate.mjs    # aplicar migraciones (idempotente)
cd webapp && npm run dev                                   # :4312 — exige login; crea la 1ª org en /register
```

**Trazabilidad de evidencia (FT + dev):** el sink local nombra la subcarpeta con el Feature y el
dev: `qa-evidence/<fecha>/FT-<feature>__<dev-slug>/`. Los flags `--feature/-f` y `--developer/-d`
(cli → `runQaCycle` → `publishEvidence`) componen ese nombre. Sin FT ni dev → fallback `WI-<HU>`.

**Recordatorio de motor cacheado:** la webapp importa el kit con `import()` nativo cacheado por
proceso. Cambios en `runtime/`/`core/`/`adapters/` exigen **reiniciar** `npm run dev` (:4312).

## Documentación / guías

- `docs/MULTITENANT.md` — la **webapp como servicio multitenant** (Postgres+RLS, auth, cifrado) y
  reglas para extenderla SIN romper el aislamiento. **Único doc vigente.**
- Las guías del antiguo pipeline de código (arquitectura global, agentes/skills, extensión, planes de
  generación) se **eliminaron** en la purga explore-only; su contenido vive en el historial de git.

## Estilo de trabajo con Claude Code

- Cambios pequeños y verificables; corre el smoke test antes de dar una tarea por cerrada.
- Si tocas el contrato `tracker-adapter`, actualiza `CONTRACT.md` y los dos adapters (local + azure).
- Al cerrar una fase/tarea, actualiza "Estado actual" de este archivo. Mantén `manifest.yaml` sin drift.
