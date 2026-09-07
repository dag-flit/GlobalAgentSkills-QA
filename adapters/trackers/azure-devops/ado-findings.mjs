// ado-findings.mjs — creación de la HU de "hallazgos"/regresión, extraída del adapter azure para
// respetar el guardrail de 400 líneas. Recibe `a`, la instancia del adapter, y reusa su client +
// helpers (_field, _supervisionPrefix, _attachFileTo, _uploadInline, _resolveEvidenceField). Toda la
// lógica de red vive en el client inyectable → sigue offline-testable desde el adapter.

import { renderShotGallery } from "./ado-html.mjs";

// Crea una HU de "hallazgos" (modo QA del código) o de regresión SIN relacionarla a nada, en el
// proyecto del tracker y en el SPRINT EN CURSO (resuelto de ADO). El incrementador #N sale del conteo
// de las HU ya creadas por el agente (por título → robusto entre reinicios). Best-effort en cada paso:
// un fallo de conteo/iteración/adjunto NO aborta la creación; solo la creación en sí puede fallar.
export async function createFindingsWorkItem(a, {
  type = "User Story",
  tags = "Flit Certify; Hallazgos-QA",
  countTag = "Flit Certify",
  countAlso = "QualityOps", // marca LEGACY: el conteo #N también cuenta las HU con la marca vieja
  makeTitle,
  descriptionHtml = "",
  attachHtml = null,
  attachFiles = [], // archivos extra a ADJUNTAR (relación AttachedFile → van a la lista de adjuntos)
  inlineImages = [], // capturas a mostrar INLINE en el cuerpo: [{file,label,status}] — se suben y
  inlineIntoEvidence = false, // se referencian por URL en Description (y en el campo Evidences si se pide)
} = {}) {
  const client = a.client;

  // (1) Incrementador #N: cuántas HU de hallazgos existen ya. Se cuenta por el TÍTULO (token de
  // marca), NO por tag: crear/leer tags requiere un permiso especial de ADO («create tag definition»)
  // que puede faltar; el título siempre está disponible y es igual de distintivo. El conteo matchea la
  // marca actual `countTag` O la marca LEGACY `countAlso` (si se pasa) → tras un rebrand la numeración
  // NO se reinicia: sigue contando las HU creadas con la marca anterior. Las comillas simples del token
  // se escapan para WIQL (doble comilla).
  let seq = 1;
  try {
    const esc = (s) => String(s).replace(/'/g, "''");
    const tokens = [countTag, ...(countAlso && countAlso !== countTag ? [countAlso] : [])]
      .filter(Boolean)
      .map((t) => `[System.Title] CONTAINS '${esc(t)}'`);
    const q = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND (${tokens.join(" OR ")})`;
    const res = await client.queryByWiql(q);
    seq = (((res.json && res.json.workItems) || []).length) + 1;
  } catch {
    /* conteo best-effort: si falla, seq=1 (mejor crear que abortar) */
  }
  const title = String(typeof makeTitle === "function" ? makeTitle(seq) : `Hallazgos QA de código #${seq}`).slice(0, 255);

  // (2) Sprint en curso (best-effort). Sin sprint activo → el WI queda en el backlog.
  let iterationPath = null;
  try {
    const it = await client.currentIteration();
    iterationPath = (it.json && it.json.value && it.json.value[0] && it.json.value[0].path) || null;
  } catch {
    /* sin iteración → backlog */
  }

  // (2b) Capturas INLINE: se suben como adjunto (ADO borra data-URI → deben referenciarse por URL)
  // y se arma una galería rotulada «Paso N». Va DENTRO de la Description (cuerpo de la HU), no a la
  // lista de adjuntos. Best-effort: una imagen que no sube se omite. Sin imágenes → galería vacía.
  const uploaded = [];
  for (const im of Array.isArray(inlineImages) ? inlineImages : []) {
    const url = await a._uploadInline(im && im.file);
    if (url) uploaded.push({ url, label: im.label, status: im.status });
  }
  const gallery = renderShotGallery(uploaded);
  const gallerySection = gallery ? `<h3 style="margin:16px 0 6px">Evidencia por paso</h3>${gallery}` : "";
  // El apartado «Evidencia por paso» va al campo custom «Evidences» (si el proceso lo tiene). Solo cae
  // a la Description como FALLBACK cuando NO hay campo Evidences donde alojarlo → la evidencia nunca se
  // pierde, pero si el campo existe la Description queda limpia (solo el resumen).
  const evidenceField = inlineIntoEvidence && gallery ? await a._resolveEvidenceField() : null;
  const fullDescription = String(descriptionHtml || "") + (evidenceField ? "" : gallerySection);

  // (3) Crear la HU (JSON-Patch). Description acepta HTML. Title/Description SIEMPRE van; los campos
  // que requieren PERMISOS ESPECIALES se degradan si ADO los rechaza (403/401), para que la HU se
  // cree igual y no se pierdan los hallazgos:
  //   • System.Tags → permiso «create tag definition» (TF401289) — puede faltar.
  //   • System.IterationPath → permiso «Editar elementos de trabajo en este nodo» del sprint.
  // Se intenta con todo, y ante 403/401 se quita primero el tag y luego la iteración.
  const baseOps = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.Description", value: a._supervisionPrefix() + fullDescription },
  ];
  const tagsOp = tags ? { op: "add", path: "/fields/System.Tags", value: tags } : null;
  const iterOp = iterationPath ? { op: "add", path: "/fields/System.IterationPath", value: iterationPath } : null;
  const plans = [
    { ops: [...baseOps, ...(iterOp ? [iterOp] : []), ...(tagsOp ? [tagsOp] : [])], iter: !!iterOp, tags: !!tagsOp },
    { ops: [...baseOps, ...(iterOp ? [iterOp] : [])], iter: !!iterOp, tags: false }, // sin tags
    { ops: [...baseOps], iter: false, tags: false }, // sin tags ni sprint (backlog)
  ];

  const is2xx = (r) => r.status >= 200 && r.status < 300 && r.json && r.json.id;
  let res = null;
  let used = plans[0];
  let prevOpsLen = -1;
  for (const plan of plans) {
    if (plan.ops.length === prevOpsLen) continue; // salta intentos idénticos (sin campo que quitar)
    prevOpsLen = plan.ops.length;
    res = await client.createWorkItem(type, plan.ops);
    used = plan;
    if (is2xx(res)) break;
    if (res.status !== 403 && res.status !== 401) break; // otro error → no tiene sentido degradar
  }
  const iterationSkipped = Boolean(iterOp) && is2xx(res) && !used.iter;
  const tagsSkipped = Boolean(tagsOp) && is2xx(res) && !used.tags;
  if (iterationSkipped) iterationPath = null;

  const id = res && res.json && res.json.id;
  if (!is2xx(res)) {
    const apiMsg = (res && (res.json?.message || res.json?.value?.Message)) || "";
    const st = res ? res.status : "?";
    const hint =
      st === 401 || st === 403
        ? ` — la cuenta/PAT no puede crear el work item en '${client.project}' ni con los campos mínimos. Revisá el scope «Work Items (Read, write & manage)» del PAT y el permiso «Editar elementos de trabajo en este nodo» del Área raíz del proyecto.`
        : st === 404
        ? ` — no se encontró el proyecto/tipo. ¿Existe el tipo '${type}' en el proceso del proyecto '${client.project}'?`
        : st === 400
        ? ` — la creación fue rechazada${apiMsg ? `: ${apiMsg}` : " (revisá el tipo de work item)"}.`
        : "";
    return { ok: false, reason: `ADO ${st}${hint}${apiMsg ? ` [ADO: ${apiMsg}]` : ""}`, seq, title };
  }

  // (4) Adjuntar evidencia a la HU (best-effort): el reporte HTML autocontenido + los archivos
  // extra que se pidan explícitamente como adjuntos.
  let attached = false;
  if (attachHtml) attached = await a._attachFileTo(id, attachHtml, "Reporte Flit Certify (autocontenido)");
  let attachedFiles = 0;
  for (const f of Array.isArray(attachFiles) ? attachFiles : []) {
    if (await a._attachFileTo(id, f, "Evidencia de regresión (captura por paso)")) attachedFiles++;
  }

  // (5) Campo «Evidences»: aloja el apartado «Evidencia por paso» (galería rotulada). El reference name
  // se resolvió arriba (por nombre visible o del perfil). Best-effort; si el PATCH falla, se RECUPERA
  // metiendo la galería en la Description para no perder la evidencia.
  let evidenceAttached = false;
  if (evidenceField && gallerySection) {
    try {
      const r = await client.patchWorkItem(id, [{ op: "add", path: `/fields/${evidenceField}`, value: gallerySection }]);
      evidenceAttached = r.status >= 200 && r.status < 300;
    } catch {
      /* best-effort */
    }
    if (!evidenceAttached) {
      try {
        await client.patchWorkItem(id, [
          { op: "add", path: "/fields/System.Description", value: a._supervisionPrefix() + String(descriptionHtml || "") + gallerySection },
        ]);
      } catch {
        /* recuperación best-effort: si tampoco se pudo, queda el reporte adjunto */
      }
    }
  }

  return {
    ok: true,
    id: String(id),
    url: client.workItemWebUrl(id),
    seq,
    title,
    iterationPath,
    iterationSkipped,
    tagsSkipped,
    attached,
    attachedFiles,
    inlineImages: uploaded.length,
    evidenceField,
    evidenceAttached,
  };
}

export default { createFindingsWorkItem };
