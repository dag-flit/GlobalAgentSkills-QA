// code-cycle.mjs — backbone del ciclo "QA del código" (capas static/unit/api/db/security).
// Es HERMANO de runQaCycle (E2E): NO lo modifica ni comparte su cuerpo. Corre las capas de
// código sobre un repo LOCAL confinado y entrega la evidencia por el MISMO sink que el E2E
// (local md+html / azure comentario+adjuntos) — sin cambios de contrato (Fase B).
//
// Seguridad:
//   1+3. confinamiento OPT-IN por el operador → resolveLocalSource (source/local-source.mjs): con
//        CODE_QA_BASE_DIR se confina el análisis a esa base; sin ella, ruta directa (1 solo operador).
//   2.   exec con allowlist + timeout → makeSandboxedExec (source/exec-sandbox.mjs): SIEMPRE ON.
// Núcleo offline: `exec`/`http` inyectables → el smoke corre sin lanzar procesos ni red.
//
// Uso:
//   import { runCodeCycle } from "./orchestrator/code-cycle.mjs";
//   const summary = await runCodeCycle({ sourcePath: "mi-repo", env, workItemId, layers });

import { resolveProfile } from "../profile/resolve-profile.mjs";
import { getAdapter } from "../../core/tracker-adapter/index.mjs";
import { detectRepo, resolveEnabledLayers } from "../detect/qa-detect.mjs";
import { runStaticAnalysis } from "../runners/static-analysis.mjs";
import { runUnitTests } from "../runners/unit.mjs";
import { runApiTests } from "../runners/api.mjs";
import { runDbTests } from "../runners/db.mjs";
import { runSecurityTests } from "../runners/security.mjs";
import { resolveLocalSource } from "../source/local-source.mjs";
import { makeSandboxedExec } from "../source/exec-sandbox.mjs";
import { attributeFailures } from "../source/git-blame.mjs";
import {
  renderFindingsDescription,
  buildFindingsTitle,
  stampNow,
  FINDINGS_TAGS,
  FINDINGS_COUNT_TAG,
} from "../evidence/findings-workitem.mjs";
import { executedHtml } from "../evidence/report-executed.mjs";

// Capas EN ALCANCE de este módulo (E2E/BDD viven en otra ruta / fuera de alcance del giro).
export const CODE_LAYERS = ["static", "unit", "api", "db", "security"];
const RUNNERS = {
  static: runStaticAnalysis,
  unit: runUnitTests,
  api: runApiTests,
  db: runDbTests,
  security: runSecurityTests,
};

/**
 * Corre el ciclo de QA de código de punta a punta.
 * @param {object} opts
 * @param {string} opts.sourcePath      carpeta del repo a analizar (relativa a CODE_QA_BASE_DIR)
 * @param {string} [opts.baseDir]       override del directorio base permitido (default: env)
 * @param {string} [opts.evidenceRoot]  dónde escribe el sink la evidencia (default: repo fuente).
 *                                       La webapp lo apunta al dir del tenant (evidencia aislada).
 * @param {object} [opts.env]           entorno (conexión de BD, base permitida, timeout…)
 * @param {object} [opts.profile]       perfil ya resuelto (si no, se resuelve del repo)
 * @param {string} [opts.workItemId]    HU/Feature destino de la evidencia (o "local")
 * @param {string} [opts.featureId]     FT padre (traza la carpeta de evidencia)
 * @param {string} [opts.developer]     dev responsable (traza la carpeta de evidencia)
 * @param {function} [opts.http]        transporte HTTP inyectable para el adapter (offline)
 * @param {string[]} [opts.layers]      capas pedidas (subconjunto de CODE_LAYERS; default: todas)
 * @param {function} [opts.exec]        ejecutor inyectable (default: sandbox allowlist+timeout)
 * @param {number}  [opts.timeoutMs]    tope por comando del sandbox
 * @returns {Promise<object>} resumen del ciclo
 */
export async function runCodeCycle({
  sourcePath,
  baseDir,
  evidenceRoot,
  env = {},
  profile,
  workItemId = "local",
  featureId,
  developer,
  http,
  layers,
  exec,
  timeoutMs,
  pgQuery,
  emit,
} = {}) {
  // Progreso en vivo (opcional): la webapp lo cablea a emitEvent para que la UI no se vea colgada
  // mientras cada capa corre en bloqueante (spawnSync). Sin callback → no-op (CLI/smoke).
  const say = typeof emit === "function" ? emit : () => {};
  // ── (1) Fuente confinada (mitigación 1 + gate mitigación 3) ─────────────────
  const src = resolveLocalSource({ sourcePath, baseDir, env });
  if (!src.ok) {
    return { ok: false, stopped: "source", tracker: null, results: [], report: null, warnings: [src.message] };
  }
  const repoRoot = src.repoRoot;

  // ── (2) Perfil + adapter (local/azure) + preflight CONDICIONAL (solo red) ────
  // La detección/runners operan sobre el repo FUENTE (repoRoot confinado); el sink escribe en
  // `evidenceRoot` (dir del tenant en la webapp) → la evidencia NO se mezcla con el repo analizado.
  const resolvedProfile = profile || resolveProfile({ repoRoot }).profile;
  const adapter = getAdapter({ profile: resolvedProfile, env, repoRoot: evidenceRoot || repoRoot, http });
  const caps = adapter.capabilities();
  let preflight = null;
  if (caps.network) {
    preflight = await adapter.preflight();
    if (!preflight.ok) {
      return { ok: false, stopped: "preflight", tracker: adapter.name, preflight, results: [], report: null, warnings: [] };
    }
  }

  // ── (3) Detección local (sin red) + capas a correr ──────────────────────────
  // toRun = detectadas ∩ EN-ALCANCE ∩ pedidas. La detección decide la herramienta por capa.
  const detection = detectRepo({ repoRoot });
  const enabled = resolveEnabledLayers(resolvedProfile, detection).enabled;
  const requested = Array.isArray(layers) && layers.length ? layers : CODE_LAYERS;
  const toRun = CODE_LAYERS.filter((l) => enabled.includes(l) && requested.includes(l));

  // ── (4) Ejecutor endurecido por defecto (mitigación 2); inyectable en tests ──
  const runExec = exec || makeSandboxedExec({ timeoutMs, env });

  // ── (5) Correr cada capa → EvidenceObjects normalizados (uno por objetivo) ───
  // Los runners usan spawnSync (BLOQUEANTE): mientras una capa corre, el hilo de Node está
  // congelado y el SSE no puede transmitir. `tick()` cede el hilo (macrotarea) para que el log EN
  // VIVO alcance a salir ANTES de bloquear con cada herramienta → el usuario ve "Capa X: ejecutando…"
  // durante la ejecución, no todo junto al final.
  const tick = () => new Promise((r) => setImmediate(r));
  say("info", `Capas detectadas: ${toRun.join(", ") || "ninguna"}. Corriendo…`);
  await tick(); // deja que el SSE se conecte y transmita lo previo antes de la 1ª capa bloqueante
  const results = [];
  for (const layer of toRun) {
    say("info", `Capa ${layer}: ejecutando…`);
    await tick(); // flush del "ejecutando…" ANTES de bloquear el hilo con spawnSync
    // `await`: la mayoría de runners son síncronos (spawnSync) pero `db` puede ser ASÍNCRONO (sonda
    // directa a Postgres vía pgQuery). await sobre un valor síncrono lo devuelve igual → uniforme.
    const out = await RUNNERS[layer]({ layer, repoRoot, profile: resolvedProfile, env, detection, exec: runExec, workItemId, pgQuery });
    const arr = Array.isArray(out) ? out : [out];
    // Resumen de la capa para el log en vivo (❌ si algún objetivo falló; ⏭ si todos se omitieron).
    const verdict = arr.some((r) => r.status === "fail") ? "❌ con fallos" : arr.every((r) => r.status === "skip") ? "⏭ omitida" : "✅ ok";
    const tc = arr.reduce((n, r) => n + (Array.isArray(r.cases) ? r.cases.length : 0), 0);
    say("info", `Capa ${layer}: ${verdict}${tc ? ` · ${tc} caso(s)` : ""}.`);
    results.push(...arr);
  }

  // ── (5b) Atribución best-effort: quién tocó por última vez el archivo/línea del fallo ──────
  // Read-only (git blame/log) sobre el repo probado. Nunca rompe el ciclo; si no es git, se omite.
  try {
    const attr = attributeFailures(repoRoot, results);
    if (attr.gitRepo && attr.attributed) {
      say("info", `Atribución: ${attr.attributed} fallo(s) vinculados a su último autor (git blame, solo lectura).`);
    }
  } catch {
    /* best-effort: la atribución jamás interrumpe la corrida */
  }

  const warnings = [];
  const notRun = requested.filter((l) => !toRun.includes(l));
  if (notRun.length) {
    warnings.push(`capas no ejecutadas (no detectadas en el repo o fuera de alcance): ${notRun.join(", ")}`);
  }

  // ── (6) Sink: reporte local SIEMPRE (aunque el destino sea Azure). El modo QA del código no
  // comenta una HU existente (no hay "WI destino"): el requirementId queda null → publishEvidence
  // solo escribe el reporte local (md+html) dentro del proyecto. Los hallazgos van a la HU nueva (7).
  const requirementId = caps.network && (!workItemId || workItemId === "local") ? null : workItemId;
  const report = await adapter.publishEvidence(
    { work_item_id: requirementId, feature_id: featureId, developer },
    { results }
  );

  // ── (7) HU de HALLAZGOS en Azure: SIEMPRE que el tracker sea de red. Cada ejecución deja su
  // registro en el sprint EN CURSO del proyecto configurado, con incrementador #N (por conteo de
  // las ya creadas). Con o sin hallazgos. No se relaciona a ninguna HU/Feature. Best-effort: si la
  // creación falla, la corrida NO se cae (el reporte local ya quedó). El tracker `local` no crea.
  let findingsWorkItem = null;
  if (caps.network && typeof adapter.createFindingsWorkItem === "function") {
    const when = stampNow();
    const reportPath = (report && (report.local?.htmlPath || report.htmlPath)) || "";
    say("info", "Registrando la HU de hallazgos en el sprint en curso…");
    try {
      findingsWorkItem = await adapter.createFindingsWorkItem({
        tags: FINDINGS_TAGS,
        countTag: FINDINGS_COUNT_TAG,
        makeTitle: (seq) => buildFindingsTitle({ seq, when }),
        descriptionHtml: renderFindingsDescription({ results, layersRun: toRun, when, reportPath }),
        attachHtml: reportPath || null,
      });
    } catch (e) {
      findingsWorkItem = { ok: false, reason: e.message };
    }
    // (7b) Bitácora "Qué se ejecutó por capa" como COMENTARIO en la Discussion de esa HU (NO en la
    // Description: ahí va el análisis de hallazgos). Best-effort: si el comentario falla, la HU y su
    // descripción ya quedaron — no se cae la corrida.
    if (findingsWorkItem && findingsWorkItem.ok && typeof adapter.commentWorkItem === "function") {
      try {
        const html = executedHtml(results, { when, reportPath });
        if (html) {
          const c = await adapter.commentWorkItem(findingsWorkItem.id, html);
          if (!c || !c.ok) warnings.push(`No se pudo comentar la bitácora de ejecución en la HU #${findingsWorkItem.id}: ${(c && c.reason) || "desconocido"}.`);
        }
      } catch (e) {
        warnings.push(`No se pudo comentar la bitácora de ejecución en la HU: ${e.message}.`);
      }
    }
    if (findingsWorkItem && findingsWorkItem.ok) {
      const where = findingsWorkItem.iterationPath
        ? ` · sprint: ${findingsWorkItem.iterationPath}`
        : findingsWorkItem.iterationSkipped
        ? " · (backlog: ADO no permitió crear en el sprint en curso — falta el permiso «Editar elementos de trabajo en este nodo» de la iteración)"
        : " · (backlog: no se resolvió el sprint en curso)";
      const noTags = findingsWorkItem.tagsSkipped ? " · sin tags (falta el permiso «create tag definition» en ADO)" : "";
      say("result", `HU de hallazgos #${findingsWorkItem.id} creada — «${findingsWorkItem.title}»${where}${noTags}.`);
    } else {
      const reason = (findingsWorkItem && findingsWorkItem.reason) || "desconocido";
      // En vivo (al momento del intento) + en warnings (recap/reporte). El reporte local ya quedó.
      say("stderr", `No se pudo crear la HU de hallazgos: ${reason} — los hallazgos están en el reporte local.`);
      warnings.push(`No se pudo crear la HU de hallazgos: ${reason}.`);
    }
  }

  return {
    ok: true,
    stopped: null,
    tracker: adapter.name,
    preflight,
    detection,
    layersRun: toRun,
    results,
    report,
    findingsWorkItem,
    warnings,
  };
}

export default { runCodeCycle, CODE_LAYERS };
