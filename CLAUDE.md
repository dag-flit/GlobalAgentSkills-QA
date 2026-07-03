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
- **Smoke:** `node runtime/smoke-test.mjs` → **22/22** (resolver; explore-suite: adapter azure +
  adjuntos + `getChildren`, runner explore, guion de pasos + localizadores, entrada avanzada +
  verificaciones ricas, cobertura de AC, `runQaCycle` local+azure+flow, guarda sin `-w`, retry HTTP,
  guardrail de líneas). Todo offline (launcher y transporte HTTP inyectables).

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
    (no clobber), ruta `PUT /api/config/ai` (solo la porción `ai`), UI `components/AiSettings.tsx` en `/settings`.
    tsc 0, smoke 22/22, line-budget 0.
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
7. **El smoke queda verde.** Tras cada cambio: `node runtime/smoke-test.mjs` (22/22). Si agregas
   capacidades, agrega su caso.
8. **Webapp multitenant — aislamiento por tenant (detalle en `docs/MULTITENANT.md`).** La webapp es
   un servicio multitenant (Postgres + RLS forzada, auth propia, secretos cifrados AES-256-GCM); el
   endurecimiento de la auditoría **sigue intacto y es ortogonal al giro explore-only**. Al extender:
   - **Control-plane (`CONTROL_PLANE_URL`) ≠ data-plane (`DATABASE_URL`):** nunca mezclar.
   - **Datos del tenant SOLO por `withTenant`/`withTenantScope`** (nunca `query()` crudo → RLS no filtraría).
   - **Secretos SOLO por `secretsCrypto`/`secretsMapper`; inputs SOLO por zod** (`lib/validation`).
   - **Tabla nueva con datos del tenant** → migración forward-only con `tenant_id` +
     `FORCE ROW LEVEL SECURITY` + policy (copiar `webapp/db/migrations/0003_rls.sql`).
   - Gate al cerrar: `npx tsc --noEmit` + `check-line-budget all` + smoke 22/22.

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
runtime/smoke-test.mjs  prueba el plumbing offline (22/22)
webapp/                 UX web multitenant (Next.js, :4312) — el producto
docs/                   guías (MULTITENANT vigente; el resto es histórico del pipeline retirado)
manifest.yaml           inventario real, sin drift
```

## Resolución de perfil

`default.yaml ← presets/azure-devops.yaml ← overlays/flit.yaml ← qa-project.profile.yaml`
Repo sin perfil → `tracker: local`. `profile: flit` → hereda `flit ← azure-devops ← default`.

## Comandos

```bash
node runtime/smoke-test.mjs        # verificar plumbing del motor (debe dar 18/18 OK)
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
