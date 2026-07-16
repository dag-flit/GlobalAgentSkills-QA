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
8. **Todo ítem de prueba que se agregue a una capa se plasma en las 4 rutas: HU, MD, HTML y UX** —
   siempre en el lenguaje más claro posible para personas NO técnicas. Cómo se cumple SIN duplicar texto:
   el check emite su propia explicación `{plain, action}` junto al caso y `failure-explain.explainFailure`
   la deja pasar (rama 0, pass-through) → las 4 superficies la muestran solas. Un caso se explica si está
   en rojo **o si trae `plain`** (así un check verde u omitido no pierde su mensaje, y las N pruebas verdes
   de una suite no inflan el reporte). Etiqueta según el estado (`explainLabels`, espejada en la webapp):
   ✔ Qué se validó / 🧩 Qué pasó / ℹ️ Qué significa + 👉 Qué hacer. La evidencia positiva se selecciona con
   `layer-explain.evidenceLayers` + `describeEvidence` (incluye la capa en rojo que igual validó cosas
   adentro → "evidencia parcial"). Al sumar un check nuevo: emitir `plain`/`action` y listo.
9. **La capa `db` NO opina ni pide configuración: verifica que la base cumpla lo que el CÓDIGO del repo
   declara.** El criterio se DETECTA del repo probado (`db-declared.scanDeclaredRls` lee su DDL/migraciones),
   igual que `static` corre el `.eslintrc` que el equipo escribió. Si el repo no declara algo, el check NO
   aplica y se omite (no es hallazgo). Nunca exigir lo que el proyecto no declara (p.ej. FLIT declara RLS
   pero NO `FORCE` → no se le exige FORCE). Quien certifica NO debe tocar el repo probado ni llenar
   formularios: el objetivo es autonomía (`profile.db` existe solo como escape hatch).
10. **Webapp multitenant — aislamiento por tenant (detalle en `docs/MULTITENANT.md`).** La webapp es
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

- **QA del código → Azure-only + HU de hallazgos por ejecución (2026-07-13, motor+webapp, smoke 47 · tsc0 · budget0,
  NADA commiteado).** El usuario redefinió el destino del modo "code": tracker **solo Azure** (sin botón Local; el
  reporte local se sigue escribiendo en el repo), **sin "WI destino"** — los hallazgos se plasman en una **HU nueva**
  (User Story) NO relacionada a nada, en el **sprint en curso** del proyecto configurado, con incrementador `#N` y
  fecha/hora en el título; y no dejar avanzar si la ruta no es un **proyecto real**. Motor: `evidence/findings-workitem.mjs`
  (render puro: título+Description), `source/validate-project.mjs` (`validateProjectPath`), `ado-rest.currentIteration()`,
  `azure-devops-adapter.createFindingsWorkItem` (conteo #N por tag `QualityOps` vía WIQL → sprint activo → crea User Story
  → adjunta report.html), contrato base += `createFindingsWorkItem` (local `{ok:false}`), `code-cycle` paso 7 SIEMPRE crea
  la HU si el tracker es de red (best-effort). Webapp: `TrackerStep.lockAzure`, `CodeStep` valida la ruta en Continuar
  (`POST /api/code/validate-path`) y quita el WI card + `AcPanel`, `useRunWizard` deja de enviar `workItemId` y fija azure
  al elegir el modo, `RunSummary` sin "WI destino". Reusa el reporte local (invariante 1) y no toca la auditoría multitenant.
  Ver [[reintro-qa-codigo-modulo]]. Reiniciado `npm run dev`. Pendiente: validación E2E del usuario contra Azure real.

- **Capas omitidas mal explicadas: «no ejecutable» ocultaba TIMEOUT; y capa `db` con conexión no aclaraba (2026-07-14,
  motor, smoke 52 · tsc0 · budget0, sin commitear).** Corrida real contra `C:\FLIT\FLIT 2.0 V Final\flit`: (1) la capa
  **unit** (`dotnet-test`) salió «OMITIDA — no ejecutable (no instalado / fuera de PATH)» aunque `dotnet` SÍ está en el
  PATH. Diagnóstico REPRODUCIDO: en frío `dotnet test` hace restore+build+71 tests y **supera el timeout del sandbox
  (180 s)** → `spawnSync` lo mata → `spawnError` (ETIMEDOUT) → la rama de error de `_runner-core` lo etiquetaba con el
  genérico «no instalado / fuera de PATH» (confundía «tardó» con «falta el binario»). Warm corre en ~36 s y da `fail —
  71 TC` (los 71 fallan por no alcanzar la BD = el 28P01). (2) la capa **db** se omitía con «solo migrations/…» **aunque
  el usuario marcó “usar BD configurada”**: FLIT solo tiene `migrations/` (sin pgtap/prisma) → el handler `migrations`
  omite SIEMPRE; el toggle **no alimenta la capa `db`** sino las **pruebas de integración .NET de la capa `unit`**
  (`ConnectionStrings__Core`) — que a su vez se saltaron por (1). Fixes (motor, no debilita nada): `_runner-core.explainExecFailure`
  distingue **timeout / maxBuffer(ENOBUFS) / allowlist / binario ausente** con razón accionable (`defaultExec` ahora
  devuelve el `timeout` efectivo para reportar «timeout Ns»); `exec-sandbox` **sube el default 180 s→600 s** (build .NET en
  frío; sigue acotado y `CODE_QA_EXEC_TIMEOUT_MS` lo ajusta); `db.mjs` da un skip **consciente de la conexión** («la
  conexión va a las pruebas de integración de la capa unit, no a una capa db aparte»). Smoke +2 (52/52). Ver
  [[capas-omitidas-timeout-y-db]] y [[reintro-qa-codigo-modulo]]. **Reiniciado `npm run dev`.** Pendiente del usuario:
  re-ejecutar (el build en frío ahora cabe en el timeout; la 1ª corrida igual tardará minutos — es normal). Para que los
  71 tests .NET pasen: la conexión inyectada debe ser la BD correcta Y el proyecto necesita el SDK que fija su `global.json`
  (10.0.300; la máquina tiene 10.0.101 — si se corre `dotnet` DENTRO de `services/core-api` falla por SDK, pero el runner
  usa el `repoRoot` y ahí el `global.json` profundo no aplica).

- **Sin `.sln`, la capa unit corría SOLO 1 de N proyectos de test .NET → fan-out por proyecto (2026-07-14, motor,
  smoke 53 · tsc0 · budget0, sin commitear).** FLIT no tiene solución (`.sln`) y `findDotnetTarget` devolvía el
  PRIMER `*Tests.csproj` (`Flit.Admin.Tests`), saltando los otros 5 (`Analytics`, `Infrastructure`, `Security`,
  `Tramites.Application`, `Tramites.Domain`) → pérdida SILENCIOSA de cobertura. Fix (`unit.mjs`): `scanDotnet`
  recolecta la `.sln` y TODOS los proyectos de test; con `.sln` se corre una sola invocación (como antes); SIN `.sln`
  y ≥2 proyectos, `expandDotnetTargetsForUnit` expande la capa a **un objetivo por proyecto** —cada uno con su
  `.csproj` por RUTA ABSOLUTA y `cwd` en la RAÍZ del repo (así un `global.json` PROFUNDO —el de `services/core-api`,
  SDK 10.0.300— NO se activa; se usa el SDK instalado). `_runner-core`: el objetivo acepta `project` (arg de dotnet)
  y `label` (etiqueta legible por proyecto). VALIDADO contra FLIT: de 2 objetivos (1 proyecto .NET) a **7** (los 6 +
  vitest@frontend). No debilita nada (transporte/launcher inyectables intactos). Ver [[fanout-proyectos-test-dotnet]].
  **Reiniciado `npm run dev`.**
  - **Nota BD para la cobertura de código:** el kit NO tiene una capa de "integración" — las capas son
    static/unit/api/db/security. Los tests de integración .NET (`WebApplicationFactory<Program>`, sin Testcontainers)
    viven DENTRO de los proyectos de test y corren bajo la capa **`unit`** (`dotnet test`); ahí es donde importa la BD.
    La capa **`db`** aparte solo corre con pgtap/prisma (FLIT no tiene → se omite; no es un bug). Para que la cobertura
    de BD REAL ocurra: (1) toggle «usar BD configurada» ON con la conexión **QA** correcta; `buildDbEnv` inyecta
    `ConnectionStrings__Core` (nombre que usa FLIT) y ASP.NET lo sobreescribe sobre appsettings; (2) Postgres accesible
    con user/clave válidos (el `28P01` era clave equivocada del appsettings, user `postgres`); (3) esquema aplicado
    (migraciones); (4) la capa unit debe correr (timeout 600s + fan-out ya arreglados). Ver [[capas-omitidas-timeout-y-db]].

- **Claridad del reporte de código + SONDA DIRECTA a Postgres (2026-07-14, motor+webapp, smoke 54 · tsc0 · budget0,
  sin commitear).** Tres pedidos del usuario tras correr QA del código: **(1)** las tarjetas de la capa unit no dejaban
  claro que **cada comando es un objetivo distinto** (proyecto). Fix: `_runner-core` cuelga `metrics.label` en cada
  objetivo; `RunResults` muestra un chip «🎯 <proyecto>» y `helpers.layerNarrative` antepone «Objetivo: «X» (esta
  tarjeta es un comando/proyecto puntual)». **(2)** el análisis estático listaba las 10 advertencias solo como rutas.
  Fix: `helpers.lintRuleHelp` (diccionario de reglas eslint/next/ruff → «qué significa» en lenguaje llano + prefijos
  a11y/ts/react) y `CaseList` ahora muestra por advertencia: la **regla** (chip), **📖 Qué significa** y **📝 Mensaje
  del linter** (antes solo la ruta). **(3)** la capa `db` se omitía; el usuario quiere **conectarse a Postgres
  directo**. Fix: `runtime/runners/db-probe.mjs` (`probePostgres` + `countMigrationsInCode`): con una conexión + una
  SONDA inyectada (`pgQuery`), la capa `db` **CONECTA a Postgres** y valida (1) conectividad, (2) estructura (nº de
  tablas), (3) **migraciones código↔base** (cuenta EF `.cs`/`.sql` vs la tabla de control `__EFMigrationsHistory`/
  flyway/prisma…) → tool `postgres-probe`. `db.runDbTests` ahora es **async** (`code-cycle` hace `await` los runners);
  solo entra la sonda si el tool detectado es `migrations` (pgtap/prisma reales los corre runLayer). Webapp:
  `lib/qa/dbInject.ts` (`setupConfiguredDb`: resuelve la conexión **por defecto** —sea cual sea, con/ sin SSH—, abre
  túnel, arma env y expone `pgQuery` reusando UN cliente `pg`; se cierra en el finally); `runner.ts` la usa y pasa
  `pgQuery` a `runCodeCycle` (extraído para no pasar 400 líneas). Es SOLO LECTURA (catálogo) → seguro; offline-testable
  (pgQuery inyectable). VALIDADO: sonda contra FLIT contó **78 migraciones EF** y detecta desfase; auth-fail (28P01) se
  surface con el mensaje real del driver. Nuevo smoke `runtime/smoke/db-probe-suite.mjs`. Ver
  [[sonda-directa-postgres-y-claridad-reporte]]. **Reiniciado `npm run dev`.**

- **Tests .NET no conectaban a la BD por SSH: el túnel Node lo congelaba `spawnSync` → EXEC ASÍNCRONO (2026-07-14,
  motor, smoke 54 · tsc0 · budget0, sin commitear).** Diagnóstico por BD (leyendo `runs`/`run_events`/`summary` con RLS):
  la conexión QA (SSH password a `177.7.49.115`, user condatab → `flitqa`) **SÍ funciona** — la sonda `postgres-probe`
  conectó a PostgreSQL 16.14, vio 71 tablas y detectó 77/78 migraciones (¡1 pendiente!). PERO los 64 tests .NET fallaban
  con `Npgsql: Failed to connect to 127.0.0.1:59190 — connection refused`. Causa RAÍZ: el túnel SSH está hecho en Node
  (`net.createServer` + `ssh2`), que vive del **event loop**; pero `defaultExec` corría las herramientas con **`spawnSync`
  (bloqueante)** → durante los minutos de `dotnet test` el event loop quedaba CONGELADO → el túnel no atendía → el
  subproceso .NET recibía *connection refused*. La sonda funcionaba porque corre DESPUÉS (loop libre). Fix (`_runner-core`):
  `defaultExec` reescrito con **`spawn` ASÍNCRONO** (Promise; maxBuffer por chunks → ENOBUFS; timeout → ETIMEDOUT; decode
  utf8/latin1 igual); `runTarget`/`runLayer` ahora **async** (objetivos secuenciales con `await` → NO satura la máquina
  pero el loop NO se congela → el túnel sigue vivo). `code-cycle` ya hacía `await` los runners; los 6 runners devuelven
  Promesa; smoke: `await` en las 6 llamadas a `runUnitTests`. VALIDADO empíricamente: durante un subproceso de 2.1s el
  event loop latió 19 veces (con spawnSync serían 0). No debilita nada (transporte/launcher inyectables intactos; el
  `tick()` de SSE queda redundante pero inofensivo, y de hecho el streaming mejora). Ver [[tunel-ssh-vs-spawnsync]].
  **Reiniciado `npm run dev`.** Pendiente: el usuario re-ejecuta el Feature con la BD QA por SSH → los .NET deben conectar.

- **Reportes más claros + evidencia de lo que pasó (2026-07-14, motor, smoke 54 · budget0, sin commitear).** Tres
  pedidos del usuario sobre la evidencia: **(1)** en la HU de hallazgos, incluir también las **capas que PASARON** como
  evidencia (no solo fallos). **(2)** que la HU sea visualmente clara (cajas, separaciones). **(3)** estructurar el
  `.md`/`.html` local. Fixes: `findings-workitem.mjs` (Description de la HU) reescrito con helpers `box`/`sectionBar`/
  `evidenceCard`/`whatPassed`: cabecera con veredicto en caja de color, `layerTable` con bordes inline (ADO conserva
  inline-style), **sección «✅ Evidencia — lo que se validó»** (una tarjeta verde por capa que pasó, con qué validó +
  verificaciones concretas —p.ej. los checks de la sonda de BD), y **«❌ Hallazgos»** con una tarjeta roja por caso
  (🧩/👉/👤/detalle). `local-sink.mjs`: `<style>` global en el HTML (h2 con separador, `.evi`, code), sección de
  evidencia en HTML y `.md`, encabezado consciente del modo («Detalle por capa» en código vs «flujo» en E2E), y muestra
  `metrics.label` (proyecto). Smoke case 7 actualizado (evidencia + estructura visual). Ver [[reportes-claros-evidencia]].
  **Reiniciado `npm run dev`.**

- **Claridad total de resultados + advertencias como sugerencias + números capas≠pruebas (2026-07-14, motor+webapp,
  smoke 54 · tsc0 · budget0, sin commitear).** El usuario pidió: (1) advertencias del linter en el reporte md/html
  (como en la HU); (2) descripciones de evidencia más claras para NO técnicos; (3) por qué «5 fallos» vs «7 hallazgos»;
  (4) claridad de resultados en md/html/HU para TODAS las capas; (5) claridad también en la evidencia de lo que pasó.
  **Respuesta a (3):** «5» = CAPAS en rojo (objetivos: vitest+api+db+bandit+semgrep); «7» = PRUEBAS en rojo (casos:
  vitest 4+db 1+bandit 1+semgrep 1). Se mezclaban sin etiquetar. (Bonus: en esa corrida los 6 proyectos .NET pasaron →
  el fix del túnel async funcionó.) **Fixes:** nuevo `runtime/evidence/lint-explain.mjs` (`lintRuleHelp` espejo de la
  webapp + `warningsMd`/`warningsHtml`): las advertencias de eslint se explican en claro (regla → «qué significa») y se
  plasman como **💡 Sugerencias (positivas, no bloquean)** en md, html y HU. Números **etiquetados y consistentes** en
  las 4 superficies: «N capa(s) con hallazgos · M prueba(s) en rojo · K sugerencia(s)» (verdict de `local-sink` y
  `findings-workitem`; `RunResults` muestra Capas/Pruebas/Sugerencias + nota «capa=objetivo, prueba=caso»). `whatPassed`
  reescrito en lenguaje llano (qué validó cada capa). Smoke case 7 (HU) extraído a `runtime/smoke/findings-suite.mjs`
  (guardrail 400). Ver [[claridad-resultados-y-sugerencias]]. **Reiniciado `npm run dev`.**

- **Evidencia ESPECÍFICA por objetivo + advertencias referenciadas a su capa (2026-07-14, motor+webapp, smoke 54 ·
  tsc0 · budget0, sin commitear).** (1) Cada advertencia del linter se REFERENCIA a la capa/objetivo de la que proviene
  (agrupadas por «Capa: Análisis estático — eslint · frontend») en md/html/HU; la UI ya las muestra bajo la tarjeta de su
  capa. (2) La descripción de la evidencia de lo que PASÓ dejó de ser genérica: nombra el OBJETIVO (proyecto/paquete) —
  p.ej. «Proyecto de pruebas «Flit.Admin.Tests» — .NET: sus pruebas automáticas pasaron… verifican ese módulo…», «Se
  revisó el código de «frontend»…», «Se conectó a la base de datos (N chequeos OK)…» — en las 4 rutas y para TODAS las
  capas. Fix: `layer-explain.describePassed(r)` (redacción específica compartida, con `toolStack` para el nombre amigable
  del stack) usada por `local-sink` (md+html) y `findings-workitem` (HU, reemplaza `whatPassed`); `lint-explain.collectWarnings`
  añade `source` (capa+tool+cwd) y `warningsMd`/`warningsHtml`/`suggestionsSection` agrupan por ese origen; webapp
  `helpers.layerNarrative` produce la evidencia específica para capas que pasan (espejo de describePassed + `TOOL_STACK`).
  Ver [[claridad-resultados-y-sugerencias]]. **Reiniciado `npm run dev`.**

- **Evidencias: nombres amigables + agrupado por regla, conservando la ruta exacta para los agentes (2026-07-14,
  motor+webapp, smoke 54 · tsc0 · budget0, sin commitear).** El usuario aprobó A (nombre amigable de archivo) + B
  (agrupar por regla) + C (normalizar rutas) + D (conteo), con la condición de que los **agentes de desarrollo** leen
  los hallazgos para corregir → hay que CONSERVAR `regla` + `ruta:línea:col` exacta y solo ENRIQUECER. Fix:
  `lint-explain.friendlyFile` (Next app router → «Página «/ruta»», «Componente «X»», «Módulo «x»», «Hook», «Ruta API»…)
  + `parseLoc` + `groupWarnings` (por capa→regla, explicación UNA vez, «N usos en M archivos», cada ocurrencia = amigable
  + `ruta:línea:col` normalizada a `/`); `warningsMd`/`warningsHtml` y `findings-workitem.suggestionsSection` reescritos.
  Blame (atribución) en las 4 rutas → amigable + ruta exacta (`local-sink.blameAt`, `findings.failCard`, webapp
  `CaseList`/`RunResults`). Webapp: espejos `helpers.friendlyFile/parseLoc/groupLintWarnings`; `CaseList` capa estática
  → rama agrupada por regla. Doble propósito: humano (amigable, sin repetir) + agente (ruta exacta parseable). Uniforme
  en MD/HTML/HU/UX. Ver [[evidencias-nombres-amigables-agrupado]]. **Reiniciado `npm run dev`.**

- **Bug: el reporte local se sobreescribía en cada corrida → subcarpeta por hora (2026-07-14, motor, smoke 54 ·
  budget0, sin commitear).** `writeLocalReport` escribía a `qa-evidence/<fecha>/<grupo>/` donde `<grupo>` = FT-…__dev
  o (en modo código) SIEMPRE `WI-local` → cada corrida pisaba `report.md`/`report.html`/`capturas/` de la anterior.
  Fix: `report-shots.evidenceRunDir` cuelga cada corrida en una **subcarpeta por hora** `qa-evidence/<fecha>/<grupo>/
  <HH-MM-SS>` (con sufijo -2/-3 si coinciden en el mismo segundo) → se conservan TODAS las evidencias. `local-sink` usa
  el helper (se movió la construcción de carpeta ahí para respetar el límite de líneas). Smoke de explore ajustado (el
  grupo FT/dev es ahora el PADRE; el basename es la hora). Ver [[bug-reporte-local-sobreescrito]].
  **Reiniciado `npm run dev`.**

- **Capa db: verificaciones de salud/estructura (Paso 1, 2026-07-14, motor, sin commitear).** Primer incremento de las
  mejoras acordadas (secuencial), empezando por RLS multitenant. Corren sobre el MISMO `pgQuery` inyectado que la sonda
  → la BD del **repo probado** (túnel SSH si aplica), NUNCA la BD del kit. `runtime/runners/db-checks.mjs` (solo lectura
  del catálogo, best-effort) con 6 checks: (1) **RLS multitenant**; (2) **PK** por tabla; (3) **índices en FK**;
  (4) **capacidad de secuencias**; (5) **codificación**; (6) **capacidad/tamaño** (informativo). `db-probe.probePostgres`
  las agrega tras conectividad/estructura/migraciones. Se suprimió "👤 Sin responsable" en capas `db`/`api` (la atribución
  de código no aplica a hallazgos de esquema) en local-sink + CaseList. Ver [[db-checks-automaticos]]. **Nota:** nacieron
  AUTOMÁTICOS (criterio cableado en el kit) y el usuario pidió volverlos DECLARATIVOS → ver la entrada siguiente.

- **Checks de BD DECLARATIVOS + evidencia COHERENTE en las 4 rutas + fix de la "raya roja" (2026-07-15, motor+webapp,
  smoke 56 · tsc0 · budget0, sin commitear).** Feedback del usuario tras correr el Paso 1: (a) los checks deben ser
  **declarativos como las demás capas**; (b) **bug visual**: una raya roja arriba de "Migraciones al día"/"Aislamiento
  por RLS" que crecía al abrir el detalle técnico; (c) al agregar alcance nuevo, la evidencia debe ser **coherente en
  HU, MD, HTML y UX en TODOS los escenarios**.
  - **Causa de la raya (era mía):** `CaseList` dibujaba SIEMPRE la caja 🧩/👉/👤 en un caso rojo, pero para `db`
    `explainFailure` devolvía `null` (no conocía los checks nuevos) Y el "Sin responsable" ya estaba suprimido para
    `db`/`api` → `div` con borde y padding y CERO hijos = una raya; al abrir el `<details>` aparecía el `<pre>` de borde
    rojo → el área roja "crecía". Fix: la caja no se dibuja si no tiene contenido (`hasBox`).
  - **Declarativo → AUTÓNOMO (corregido en la misma sesión).** Primero se puso la declaración en
    `qa-project.profile.yaml` **del repo probado**; el usuario lo rechazó: *"SIN TOCAR NADA en el repo probado —
    soy yo quien debe adaptarme al entorno que ando certificando"* y *"mi objetivo es que todo sea autónomo y lo
    menos dependiente de mí posible"*. Se propuso entonces un panel en la webapp y también lo rechazó (seguía siendo
    configurar). **La lectura correcta de "declarativo como las demás capas":** `static` no pide declarar nada —
    **detecta** el `.eslintrc` que el equipo YA escribió y corre eso; es declarativo **y** autónomo porque el criterio
    sale de artefactos que el repo ya tiene. Aplicado a la BD: **`runtime/runners/db-declared.mjs`**
    (`scanDeclaredRls(repoRoot)`, PURO/offline) lee el DDL/migraciones del repo (.sql/.cs, salta bin/obj/node_modules)
    y extrae qué tablas declara con `ENABLE/FORCE ROW LEVEL SECURITY` y `CREATE POLICY`. El check contrasta
    **código ↔ base** (mismo patrón que el de migraciones, que al usuario le gustó): (a) el repo no declara RLS →
    ⏭ *"este proyecto no usa RLS"*, no aplica; (b) declara y la base no cumple → ❌ *"el código dice una cosa y la
    base tiene otra"*; (c) cumple → ✅. **Solo se exige lo que el proyecto declara** — validado contra FLIT: declara
    RLS pero `force:false`, así que ya NO se le exige FORCE (el check original lo exigía = opinión del kit metida
    como hallazgo). `profile.db` queda como **escape hatch** (`multitenant.except`, apagar universales con
    `primary_key/fk_indexes/encoding/sequences_max_pct: off`), NO como el camino normal.
  - **VALIDADO contra FLIT real:** `scanDeclaredRls` detecta **40 tablas en 37 archivos**
    (`src/Flit.Infrastructure/Persistence/Sql/Ddl` + migraciones EF, no `docs/`) → el hallazgo de RLS pasó de ser
    una opinión del kit a evidencia dura: *"tu código declara RLS para 40 tablas en 37 archivos; la base no las
    protege"*. Los universales (PK/UTF-8/secuencias/FK) siguen activos por defecto (decisión del usuario).
  - **Coherencia (regla ÚNICA en las 4 rutas):** cada check emite su propia explicación `{plain, action}` junto al caso;
    `failure-explain.explainFailure` la deja **pasar tal cual** (rama 0, pass-through) → HU/MD/HTML/UX muestran lo mismo
    sin duplicar texto, y **cualquier check futuro (SCA, secretos…) lo hereda gratis**. Un caso se explica si está en rojo
    **o si trae `plain`** → un check verde u omitido ya NO pierde su mensaje (antes solo se explicaban los rojos), y las
    71 pruebas verdes de una suite no inflan nada (no traen `plain`). Etiqueta según el estado (`explainLabels`, espejada
    en webapp): ✔ Qué se validó / 🧩 Qué pasó / ℹ️ Qué significa + 👉 Qué hacer.
  - **Huecos de la HU que esto destapó y se corrigieron:** los casos ⏭ **no aparecían** (un "no declarado" habría sido
    invisible) → nueva sección **"⏭ No verificado"** (filtrada por `plain`, así el ruido del linter/tests saltados no
    entra); y la evidencia positiva **desaparecía** si la capa fallaba → `layer-explain.evidenceLayers` +
    `describeEvidence` (compartidos por HU/MD/HTML): la capa en rojo que igual validó cosas aparece como **"evidencia
    parcial"**, nombrando cada punto cubierto. `describePassed(db)` y el espejo `helpers.layerNarrative(db)` ahora
    **NOMBRAN los puntos comprobados** (conexión · estructura · migraciones · RLS · PK · índices · secuencias ·
    codificación · tamaño) en vez del genérico "las verificaciones pasaron"; `TOOL_DESC["postgres-probe"]` también.
  - **Refactor por guardrail:** `local-sink.mjs` estaba en 393/400 → el detalle POR CASO (md+html) se extrajo a
    **`runtime/evidence/report-cases.mjs`** (`casesMd`/`casesHtml`, una sola regla para ambos formatos); local-sink bajó
    a 293. Smoke: `db-probe-suite` += declarativo (no declarado / declarado+fail / `except` / apagar un universal /
    pass-through) y `findings-suite` += caso de COHERENCIA (mismo resultado db → HU+MD+HTML con la etiqueta correcta por
    estado). **Verificado en vivo:** FLIT no trae `qa-project.profile.yaml` → RLS sale ⏭ "no declarado"; declarando
    `rls: true` + `except: [audit_log]` falla solo la tabla no exceptuada. Ver [[db-checks-declarativos-y-coherencia]].
    **Reiniciado `npm run dev`.**

- **Evidencia: verificaciones excluidas por un tope, texto recortado y sin detalle técnico (2026-07-15, motor,
  smoke 59 · tsc0 · budget0, sin commitear).** El usuario vio en «✅ Evidencia — lo que se validó correctamente»
  que «Capacidad y tamaño» moría en «…procedure_instance_status_history (1406 filas, 6…» y pidió (a) el **detalle
  técnico** de la capa `db` ahí mismo y (b) que **no se excluya nada** de «qué se validó». Eran TRES bugs en el
  mismo bloque: **(1)** el listado por verificación estaba condicionado a `passed.length <= 8` → con **9 checks no
  se listaba NINGUNO** (la sonda de BD llega a 9; el tope se volvía en contra justo cuando más hay que mostrar);
  **(2)** la HU recortaba la explicación con `short(c.plain, 220)` → el «…» que reportó; **(3)** el detalle técnico
  (`c.message`) solo salía como *fallback* si el check NO traía `plain` — o sea, nunca para los declarativos de BD.
  Fix: `layer-explain.evidenceItems(passed)` (regla ÚNICA compartida por HU/MD/HTML): **un check que trae su propia
  explicación (`plain`) es un ítem de prueba y se lista SIEMPRE, sin tope y completo** — invariante 8; una suite
  CRUDA sin `plain` (71 tests de vitest) mantiene el tope para no inundar (su evidencia ya está en la redacción de
  la capa). `layer-explain.techDetail(m)` normaliza el detalle crudo. `findings-workitem.evidenceCard` +
  `local-sink` (md y html) muestran ahora **explicación completa + 🔎 Detalle técnico por verificación**. La **UX ya
  estaba bien** (CaseList muestra cada check con su `plain` y el `<details>` de detalle técnico) → el hueco era solo
  HU/MD/HTML. Smoke +1 (9 checks listados sin recorte + detalle en las 3 rutas; y la suite de 71 sigue resumida).
  Ver [[evidencia-sin-topes-ni-recortes]]. **Reiniciado `npm run dev`.**

- **Sección «⏭ No verificado» en md/html + bitácora de ejecución en la Discussion de la HU (2026-07-15, motor,
  smoke 58 · tsc0 · budget0, sin commitear).** El usuario validó lo anterior ("quedó correctamente") y reportó dos
  cosas: (1) el check «Índices en llaves foráneas» se veía en la UX pero **no** en md/html/HU; (2) el resumen final
  del md «Qué se ejecutó por capa» debería ir también a la HU, pero en **Evidences/Discussion**, NO en la Description.
  - **(1) Causa:** la sección «💡 Sugerencias» de md/html filtra `layer === "static"` → solo cubre advertencias del
    LINTER. El check de FK es una sugerencia de la capa **db** → quedaba fuera, y solo aparecía enterrado en «Detalle
    por capa» (línea 837 de 870). La HU sí lo mostraba (`notVerifiedSection`, agregado antes) → el hueco real era
    md/html. Fix: selección compartida `layer-explain.notVerifiedCases(results)` (casos `skip` con `plain`; el filtro
    por `plain` deja fuera el ruido del linter/tests saltados) usada por la HU **y** por md/html → sección «⏭ No
    verificado» en las 3 rutas (la UX ya lo mostraba en la tarjeta de la capa). Cumple el invariante 8.
  - **(2) Hecho:** nuevo `runtime/evidence/report-executed.mjs` (`executedMd`/`executedHtml`/`executedLayers`) —
    una sola redacción para DOS destinos: el md (reemplaza el bloque inline que tenía local-sink) y el **comentario**
    de la HU. `code-cycle` paso **7b**: tras crear la HU de hallazgos, `adapter.commentWorkItem(id, executedHtml(...))`
    → la bitácora va a la **Discussion**; la **Description NO la lleva** (ahí queda el análisis, como estaba).
    Best-effort: si el comentario falla, va a `warnings` y la corrida no se cae. HTML con estilos EN LÍNEA (ADO
    descarta las hojas de estilo).
  - **Tercer hueco encontrado de paso:** «Qué se ejecutó por capa» filtraba por `metrics.command` → la sonda de BD
    (`postgres-probe`, que no lanza un binario) **no aparecía** en el resumen. Ahora `executedLayers` incluye toda
    capa que corrió (comando **o** casos) y para la sonda dice explícitamente "(conexión directa a PostgreSQL — no
    ejecuta un comando de consola)".
  - Smoke: `findings-suite` += ítem omitido de capa no-linter en las 4 rutas (usa `writeLocalReport` real a temporal)
    + bitácora en md/comentario y **ausente** de la Description. Ver [[db-checks-declarativos-y-coherencia]].
    **Reiniciado `npm run dev`.** Pendiente: Paso 2 = seguridad (SCA + secret scanning).

- **Paso 2 (seguridad) — Incremento 1: escáner de SECRETOS quemados (2026-07-16, motor+webapp, smoke 66 · tsc0 ·
  budget0, sin commitear).** Primer incremento del Paso 2 (el usuario eligió «secret scanning primero», luego SCA).
  Nuevo `runtime/runners/secret-scan.mjs` (PURO/offline, `listFiles`/`readFile` inyectables): camina el repo probado
  y busca credenciales escritas directo en el código con reglas de **ALTA confianza** (llave privada PEM, clave AWS
  `AKIA/ASIA`, API key de Google `AIza`, tokens GitHub `ghp_`/`github_pat_`, Slack `xox…`, Stripe `sk_live_`, OpenAI
  `sk-…`, contraseña embebida en URL de conexión `scheme://u:PASS@host`, `Password=` en cadena de conexión .NET con
  contexto `Server=/Host=`, y una regla genérica `secret/token/api_key=…` **filtrada por entropía + placeholder**).
  Autonomía (invariante 9): NO opina de estilo (no marca «esta var se llama password»); descarta placeholders y refs
  de entorno (`process.env`, `${…}`, `<set-me>`, `changeme`, `xxxx`); salta `node_modules/bin/obj/dist/.next/…` y
  lockfiles/binarios. **El valor JAMÁS viaja completo** — se REDACTA (`AKI…YZ (20 car.)`); el escáner no puede ser él
  mismo una fuga hacia la HU/ADO. Escape hatch en `profile.security.secrets`: `off` desactiva, `ignore:[frag]` descarta
  rutas de falsos positivos. Cada tipo de secreto = un caso agrupado por regla con `plain` (qué ES y por qué es
  peligroso) + `action` (rotala YA, movela a env/gestor de secretos, purgala del historial de git) + `message`
  (ruta:línea + valor redactado, para los agentes de desarrollo). Cableado: `security.runSecurityTests` ahora
  devuelve un **objeto de evidencia propio `secret-scan`** (patrón de la sonda de BD) junto al SAST, corre SIEMPRE
  (no necesita herramienta externa; best-effort). Nombres amigables + evidencia específica en las 4 rutas
  (`layer-explain` TOOL_DESC/TOOL_STACK/`describePassed`; webapp `helpers` TOOL_STACK/TOOL_WHAT/`layerNarrative`).
  Como cada caso emite `plain`/`action`, HU/MD/HTML/UX lo muestran sin tocar el render (pass-through, invariante 8).
  Suite `runtime/smoke/secret-scan-suite.mjs` (+7): detecta formas reales + redacta + línea exacta; no marca
  placeholders/env-refs; KV exige contexto y genérica exige entropía; escaneo de repo agrupa por regla; repo limpio
  da evidencia positiva; escape hatch off/ignore; integración con SAST; y **coherencia HU/MD/HTML con el valor
  REDACTADO en las 3 rutas**. Ver [[secret-scan-alta-confianza]]. **Reiniciado `npm run dev`.** Pendiente del Paso 2:
  Incremento 2 = SCA (vulnerabilidades en dependencias: `npm audit` / `dotnet list package --vulnerable`).

- **Paso 2 (seguridad) — Incremento 2: SCA (dependencias vulnerables) (2026-07-16, motor+webapp, smoke 72 · tsc0 ·
  budget0, sin commitear).** Análisis de composición (SCA): vulnerabilidades CONOCIDAS en las dependencias de
  terceros. `runtime/runners/sca.mjs` (detección + orquestación) + `runtime/runners/parse-sca.mjs` (parsers PUROS).
  **Detecta el gestor por los MANIFIESTOS que el repo ya tiene** (invariante 9: no se configura, se detecta) y corre
  la herramienta nativa: `npm audit --json` (package.json **con lockfile**), `dotnet list package --vulnerable
  --include-transitive` (.sln → un objetivo; si no, uno por `.csproj`), `pip-audit --format json` (requirements/
  pyproject). Emitido como **objeto(s) de evidencia propio(s)** junto al secret-scan y al SAST (patrón de la sonda
  de BD). **Best-effort con skips ACCIONABLES:** sin lockfile → «corré npm install»; sin assets → «corré dotnet
  restore»; herramienta ausente (127) → skip; salida no parseable → degrada. Necesita RED (feed de avisos), como
  semgrep `auto`; el motor sigue offline-TESTABLE (`exec` inyectable). Severidad → estado: **crítica/alta bloquean
  (fail), menor = sugerencia (skip)**; escape hatch `profile.security.sca` (`off`, `fail_on:[…]`, `ignore:[pkg]`).
  Cada dependencia vulnerable = un caso con `plain` (qué ES + por qué corre con tu app aunque tu código esté bien) +
  `action` (actualizá a versión corregida; si es transitiva, actualizá la que la trae) + `message` (URL del aviso +
  rango/versión). Como emite `plain`/`action`, las 4 rutas lo muestran sin tocar el render (invariante 8). Nombres
  amigables + evidencia específica (`layer-explain` TOOL_DESC/TOOL_STACK/`isScaTool`/`describePassed`; webapp
  `helpers` SCA_TOOLS/TOOL_STACK/TOOL_WHAT/`layerNarrative`). Suite `runtime/smoke/sca-suite.mjs` (+6): detección de
  manifiestos, parsers npm/dotnet/pip con mapeo de severidad, skips accionables, escape hatch off/fail_on/ignore,
  integración con SAST+secret-scan y coherencia HU/MD/HTML. Ajustada la aserción de `code-suite` (exit 0 → «ningún
  fallo», ya que SCA puede quedar en skip legítimo sin lockfile). Ver [[sca-dependencias-vulnerables]]. **Reiniciado
  `npm run dev`.** **Paso 2 (seguridad) COMPLETO** (SAST + secret-scan + SCA). Pendiente del usuario: validar E2E
  contra FLIT real (npm audit en frontend + dotnet --vulnerable en los .csproj, con restore/lockfile presentes).
  - **Soporte pnpm agregado (2026-07-16, cierra el hueco de FLIT):** el frontend de FLIT usa **pnpm**
    (`pnpm-lock.yaml`), que `npm audit` no lee. `sca.detectScaTargets` ahora detecta `pnpm-lock.yaml` → objetivo
    **`pnpm-audit`** (`pnpm audit --json`) en la raíz del workspace; como pnpm guarda UN lock por workspace y
    `pnpm audit` audita todo el árbol, los sub-paquetes cubiertos (`frontend/` sin lock propio) **ya NO emiten un
    npm-audit con skip engañoso** (`coveredByPnpm`). `pnpm audit --json` usa el formato `advisories` (estilo npm
    v6) → **`parseNpmAudit` se reutiliza** sin parser nuevo. VALIDADO contra FLIT real: 1 `pnpm-audit` (raíz) + 1
    `npm-audit` (un sub-paquete con su package-lock propio) + 18 `dotnet-vulnerable` + 1 `pip-audit`, **0 skips
    engañosos**. Nombres amigables en las 4 rutas (`layer-explain`/webapp `helpers` += `pnpm-audit` en TOOL_DESC/
    TOOL_STACK/SCA_TOOLS/TOOL_WHAT). Smoke 73 (+caso pnpm). Ver [[sca-dependencias-vulnerables]]. Pendiente del
    usuario: validar E2E (pnpm audit en frontend + dotnet --vulnerable con restore).

- **Corridas HUÉRFANAS: heartbeat + reconciliación perezosa + stop que finaliza (2026-07-16, webapp, migración 0007 ·
  tsc0 · budget0 · smoke 72, sin commitear).** NO es una capa de QA: es el CICLO DE VIDA de la corrida. Bug: si el
  proceso que ejecuta una corrida muere a mitad (p.ej. reinicio de `npm run dev`), la corrida queda `running` para
  siempre y el botón «Detener» miente (prende una bandera en memoria que solo lee el proceso —ya muerto— dueño; el
  proceso nuevo no tiene registro de ella). Fue exactamente el zombi que hubo que matar a mano. Fix (3 piezas):
  **(1) Liveness durable** — migración `0007_run_heartbeat.sql` (columna `heartbeat_at timestamptz` en `runs`; hereda
  tenant_id+FORCE RLS de 0003; forward-only; **aplicada**) + `lib/qa/heartbeat.ts` (late `now()` cada 15s dentro del
  contexto de tenant; `setInterval().unref()`; el exec ASÍNCRONO ya deja latir el loop aunque una herramienta tarde
  minutos) + `runsRepo.touchHeartbeat`. `runner.startRun` marca la corrida activa (`procRegistry.markActive`) y
  arranca el heartbeat; en el `.finally` del fire-and-forget para el heartbeat y `markDone`. Si el proceso muere,
  esos no corren → el heartbeat se congela. **(2) Reconciliación PEREZOSA al leer** — `runsRepo.reconcileStaleInTx`
  (en la MISMA transacción de `getRun`/`listRuns`, con el tenant ya fijado por `withTenant` → RLS): cierra como
  `error` las `running`/`pending` con `COALESCE(heartbeat_at, started_at, created_at) < now()-90s`, excluyendo las que
  ESTE proceso ejecuta (`procRegistry.activeRunIds`). NO hay barrido global entre tenants (Next no da un hook de
  arranque limpio, y RLS lo impediría): cada tenant limpia sus huérfanas al mirar sus corridas — justo cuando la
  mentira sería visible. **(3) Stop que finaliza** — `stop/route.ts`: si `isActive(id)` → corte cooperativo (como
  antes); si NO (huérfana, aún dentro del margen de heartbeat) → `finalizeRun(id,"error",…)` directo en la base +
  evento + `endRun` (prender la bandera no serviría). `procRegistry` += `markActive/markDone/isActive/activeRunIds`;
  `runsRepo` += `touchHeartbeat/finalizeRun`. VALIDADO contra la BD real en una transacción con **ROLLBACK** (no
  persiste): huérfana(heartbeat viejo)→error+finished_at; viva(heartbeat fresco)→intacta; activa-en-este-proceso→
  excluida. No debilita la auditoría multitenant (todo por `withTenant`/RLS; control-plane intacto). Solo TS+SQL →
  Next recompila en caliente (no exige reiniciar). Ver [[reconciliacion-corridas-huerfanas]].

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
