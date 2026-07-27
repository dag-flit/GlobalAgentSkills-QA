// azure-devops-adapter.mjs — adapter de Azure DevOps, acotado a ENTREGAR LA EVIDENCIA E2E.
// Implementa el contrato TrackerAdapter (explore-only) sobre un cliente REST con transporte
// INYECTABLE, para poder probarlo offline. CERO literales: org/proyecto/PAT vienen de `env`;
// campos y tags vienen del perfil (azure.*). Solo se usa cuando el perfil pide
// `tracker: azure-devops`; el preflight condicional del orquestador lo exige.
//
// publishEvidence implementa la política DUAL: resumen en la Discussion del WI + reporte local
// (md/html) como artefacto + adjuntos (capturas de la exploración) en el Task hijo (tc-match).
// El render HTML + parse vive en ./ado-html.mjs.

import fs from "node:fs";
import path from "node:path";
import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";
import { createClient } from "./ado-rest.mjs";
import { resolveTaskId } from "./tc-match.mjs";
import { writeLocalReport } from "../../../runtime/evidence/local-sink.mjs";
import { parseAc, renderSummary } from "./ado-html.mjs";

const REQUIRED = ["AZURE_ORG_URL", "AZURE_PROJECT_NAME", "AZURE_PAT", "USER_REAL_EMAIL"];
const MODE = "azure-devops";

export class AzureDevOpsAdapter extends TrackerAdapter {
  constructor(ctx = {}) {
    super(ctx);
    // cliente inyectable (ctx.adoClient) o construido con transporte inyectable (ctx.http)
    this.client = ctx.adoClient || createClient({ env: this.env, http: ctx.http });
  }

  get name() {
    return MODE;
  }

  capabilities() {
    return { attachments: true, custom_fields: true, comments: true, states: true, network: true };
  }

  async preflight() {
    const missing = REQUIRED.filter((k) => !this.env[k]);
    if (missing.length) {
      return { ok: false, mode: MODE, detail: `Faltan variables: ${missing.join(", ")}` };
    }
    try {
      const res = await this.client.getProject();
      if (res.status === 200) {
        return { ok: true, mode: MODE, detail: `Proyecto '${this.client.project}' accesible.` };
      }
      if (res.status === 401 || res.status === 203) {
        return { ok: false, mode: MODE, detail: "PAT inválido o sin permisos (401/203)." };
      }
      if (res.status === 404) {
        return { ok: false, mode: MODE, detail: `Proyecto '${this.client.project}' no encontrado (404).` };
      }
      return { ok: false, mode: MODE, detail: `ADO respondió ${res.status} al validar el proyecto.` };
    } catch (e) {
      return { ok: false, mode: MODE, detail: `No se pudo contactar ADO: ${e.message}` };
    }
  }

  // Lee una HU/Feature (para saber a qué work item se adjunta la evidencia).
  async getWorkItem(id) {
    const res = await this.client.getWorkItem(id);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`azure-devops.getWorkItem(${id}): ADO ${res.status}`);
    const fields = (res.json && res.json.fields) || {};
    const acField = this._field("acceptance_criteria", "Microsoft.VSTS.Common.AcceptanceCriteria");
    return {
      id: String(id),
      title: fields["System.Title"] || `WI ${id}`,
      state: fields["System.State"] || "unknown",
      type: fields["System.WorkItemType"] || "unknown",
      acceptance_criteria: parseAc(fields[acField] || ""),
      raw: fields,
      stub: false,
    };
  }

  // HU hijas directas de un Feature (para el fan-out por HU). WIQL por [System.Parent] y luego
  // se lee cada hija para su título/tipo/estado. Degrada a [] si la consulta no devuelve nada.
  async getChildren(id) {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = ${Number(id) || 0}`;
    const res = await this.client.queryByWiql(wiql);
    const items = (res.json && res.json.workItems) || [];
    const out = [];
    for (const it of items) {
      const wi = await this.getWorkItem(it.id);
      if (wi) out.push({ id: wi.id, title: wi.title, type: wi.type, state: wi.state });
    }
    return out;
  }

  // Publica un comentario HTML (p.ej. el brief PR-driven de qué validar) en la Discussion del WI.
  async commentWorkItem(id, html) {
    if (!id) return { ok: false, reason: "sin work item destino" };
    const res = await this.client.addComment(id, this._supervisionPrefix() + String(html || ""));
    return res.status >= 200 && res.status < 300
      ? { ok: true, id: (res.json && res.json.id) ?? null }
      : { ok: false, reason: `ADO ${res.status}` };
  }

  // Crea una HU de "hallazgos" (modo QA del código) SIN relacionarla a nada, en el proyecto del
  // tracker y en el SPRINT EN CURSO (resuelto de ADO). El incrementador #N sale del conteo de las
  // HU ya creadas por el agente (por tag → robusto entre reinicios). Best-effort en cada paso: un
  // fallo de conteo/iteración/adjunto NO aborta la creación; solo la creación en sí puede fallar.
  async createFindingsWorkItem({
    type = "User Story",
    tags = "QualityOps; Hallazgos-QA",
    countTag = "QualityOps",
    makeTitle,
    descriptionHtml = "",
    attachHtml = null,
    attachFiles = [], // archivos extra a adjuntar (p.ej. capturas PNG de la corrida de regresión)
  } = {}) {
    // (1) Incrementador #N: cuántas HU de hallazgos existen ya. Se cuenta por el TÍTULO (token de
    // marca), NO por tag: crear/leer tags requiere un permiso especial de ADO («create tag definition»)
    // que puede faltar; el título siempre está disponible y es igual de distintivo.
    let seq = 1;
    try {
      const q = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '${countTag}'`;
      const res = await this.client.queryByWiql(q);
      seq = (((res.json && res.json.workItems) || []).length) + 1;
    } catch {
      /* conteo best-effort: si falla, seq=1 (mejor crear que abortar) */
    }
    const title = String(typeof makeTitle === "function" ? makeTitle(seq) : `Hallazgos QA de código #${seq}`).slice(0, 255);

    // (2) Sprint en curso (best-effort). Sin sprint activo → el WI queda en el backlog.
    let iterationPath = null;
    try {
      const it = await this.client.currentIteration();
      iterationPath = (it.json && it.json.value && it.json.value[0] && it.json.value[0].path) || null;
    } catch {
      /* sin iteración → backlog */
    }

    // (3) Crear la HU (JSON-Patch). Description acepta HTML. Title/Description SIEMPRE van; los campos
    // que requieren PERMISOS ESPECIALES se degradan si ADO los rechaza (403/401), para que la HU se
    // cree igual y no se pierdan los hallazgos:
    //   • System.Tags → permiso «create tag definition» (TF401289) — puede faltar.
    //   • System.IterationPath → permiso «Editar elementos de trabajo en este nodo» del sprint.
    // Se intenta con todo, y ante 403/401 se quita primero el tag y luego la iteración.
    const baseOps = [
      { op: "add", path: "/fields/System.Title", value: title },
      { op: "add", path: "/fields/System.Description", value: this._supervisionPrefix() + String(descriptionHtml || "") },
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
      res = await this.client.createWorkItem(type, plan.ops);
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
          ? ` — la cuenta/PAT no puede crear el work item en '${this.client.project}' ni con los campos mínimos. Revisá el scope «Work Items (Read, write & manage)» del PAT y el permiso «Editar elementos de trabajo en este nodo» del Área raíz del proyecto.`
          : st === 404
          ? ` — no se encontró el proyecto/tipo. ¿Existe el tipo '${type}' en el proceso del proyecto '${this.client.project}'?`
          : st === 400
          ? ` — la creación fue rechazada${apiMsg ? `: ${apiMsg}` : " (revisá el tipo de work item)"}.`
          : "";
      return { ok: false, reason: `ADO ${st}${hint}${apiMsg ? ` [ADO: ${apiMsg}]` : ""}`, seq, title };
    }

    // (4) Adjuntar evidencia a la HU (best-effort): el reporte HTML autocontenido + los archivos
    // extra (p.ej. capturas PNG por paso de la regresión, para verlas directo en ADO sin abrir el HTML).
    let attached = false;
    if (attachHtml) attached = await this._attachFileTo(id, attachHtml, "Reporte QualityOps (autocontenido)");
    let attachedFiles = 0;
    for (const f of Array.isArray(attachFiles) ? attachFiles : []) {
      if (await this._attachFileTo(id, f, "Evidencia de regresión (captura por paso)")) attachedFiles++;
    }
    return { ok: true, id: String(id), url: this.client.workItemWebUrl(id), seq, title, iterationPath, iterationSkipped, tagsSkipped, attached, attachedFiles };
  }

  // Sube UN archivo y lo enlaza como AttachedFile a la HU. Best-effort: devuelve false si no existe,
  // no sube o no enlaza (nunca lanza → la HU ya creada no se pierde por un adjunto).
  async _attachFileTo(id, filePath, comment) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const up = await this.client.uploadAttachment(path.basename(filePath), fs.readFileSync(filePath));
      const url = up.json && up.json.url;
      if (!url) return false;
      const rel = await this.client.patchWorkItem(id, [
        { op: "add", path: "/relations/-", value: { rel: "AttachedFile", url, attributes: { comment: comment || "" } } },
      ]);
      return rel.status >= 200 && rel.status < 300;
    } catch {
      return false;
    }
  }

  async publishEvidence(target, payload) {
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const parentId = (target && target.work_item_id) || (payload && payload.work_item_id) || null;

    // 1) Reporte local SIEMPRE (artefacto md/html para CI/diff). FT/dev se propagan para que
    // la subcarpeta de evidencia se nombre igual que en local (FT-<feature>__<dev>).
    const local = writeLocalReport({
      repoRoot: this.repoRoot,
      profile: this.profile,
      workItemId: parentId || "local",
      featureId: (target && target.feature_id) ?? (payload && payload.feature_id),
      developer: (target && target.developer) ?? (payload && payload.developer),
      results,
    });

    // 2) Resumen en la Discussion del WI.
    let comment = null;
    if (parentId) {
      const res = await this.client.addComment(parentId, renderSummary({ sup: this._supervisionPrefix(), results }));
      comment = res.status >= 200 && res.status < 300
        ? { ok: true, id: (res.json && res.json.id) ?? null }
        : { ok: false, status: res.status };
    }

    // 3) Adjuntos png/webm por caso → Task (resueltos por tc-match).
    const attachments = await this._attachEvidence(results, parentId);

    return {
      ok: true,
      sink: "dual",
      parentCommentId: comment ? comment.id ?? null : null,
      comment,
      local,
      attachments,
    };
  }

  // Sube cada `files[]` de evidencia y lo enlaza al Task resuelto por tc-match.
  // Degrada con aviso: sin Task asociado o archivo faltante → se registra, no aborta.
  async _attachEvidence(results, parentId) {
    const summary = { uploaded: 0, linked: [], unmatched: [], skipped: [] };
    if (!this.capabilities().attachments) return summary;

    for (const r of results) {
      const files = Array.isArray(r.files) ? r.files : [];
      if (!files.length) continue;

      // Resuelve el Task hijo (convención FLIT). Si NINGUNA estrategia matchea, se adjunta DIRECTO
      // a la HU/WI padre para que la evidencia SIEMPRE quede visible en el work item. Antes, en E2E
      // el tc_id es el nº de la propia HU y casi nunca existe un Task hijo con ese título → las
      // capturas caían en `unmatched` y no se subían. Ahora el destino es el Task si lo hay, o la HU.
      const m = await resolveTaskId({
        evidence: r,
        parentId,
        profile: this.profile,
        env: this.env,
        repoRoot: this.repoRoot,
        client: this.client,
      });
      const targetId = m.taskId || parentId;
      const strategy = m.taskId ? m.strategy : "parent_work_item";
      if (!targetId) {
        // Sin Task y sin HU padre (no debería pasar con azure) → se registra, no se pierde silencioso.
        summary.unmatched.push({ tc_id: r.tc_id ?? null, reason: m.warning });
        continue;
      }

      for (const f of files) {
        const abs = path.isAbsolute(f) ? f : path.join(this.repoRoot, f);
        if (!fs.existsSync(abs)) {
          summary.skipped.push({ file: f, reason: "archivo no existe" });
          continue;
        }
        const up = await this.client.uploadAttachment(path.basename(abs), fs.readFileSync(abs));
        const url = up.json && up.json.url;
        if (!(up.status >= 200 && up.status < 300) || !url) {
          summary.skipped.push({ file: f, reason: `upload ${up.status}` });
          continue;
        }
        const rel = await this.client.patchWorkItem(targetId, [
          {
            op: "add",
            path: "/relations/-",
            value: { rel: "AttachedFile", url, attributes: { comment: `evidencia ${r.tc_id ?? ""} (${r.status})` } },
          },
        ]);
        if (rel.status >= 200 && rel.status < 300) {
          summary.uploaded++;
          summary.linked.push({ tc_id: r.tc_id ?? null, taskId: targetId, file: path.basename(abs), strategy });
        } else {
          summary.skipped.push({ file: f, reason: `link ${rel.status}` });
        }
      }
    }
    return summary;
  }

  // ── helpers internos ────────────────────────────────────────────────────────
  _fields() {
    return (this.profile.azure && this.profile.azure.fields) || {};
  }
  _field(key, fallback) {
    return this._fields()[key] || fallback;
  }

  // Bloque de supervisión (reusado por el resumen). Vacío si no aplica.
  _supervisionPrefix() {
    const sup = this.profile.supervision;
    if (!sup || !sup.enabled) return "";
    const text = (sup.comment_prefix || "")
      .replace("{agent_or_skill}", "qa-orchestrator")
      .replace("{lead_email}", this.env[(sup.lead_email || "").replace(/^env\./, "")] || sup.lead_email || "");
    return `<p><em>${esc(text)}</em></p>`;
  }
}

// `esc` se usa solo en _supervisionPrefix; el resto del render vive en ado-html.mjs.
function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export default AzureDevOpsAdapter;
