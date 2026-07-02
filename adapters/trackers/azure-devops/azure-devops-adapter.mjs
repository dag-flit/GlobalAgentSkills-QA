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
      acceptance_criteria: parseAc(fields[acField] || ""),
      raw: fields,
      stub: false,
    };
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

      const m = await resolveTaskId({
        evidence: r,
        parentId,
        profile: this.profile,
        env: this.env,
        repoRoot: this.repoRoot,
        client: this.client,
      });
      if (!m.taskId) {
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
        const rel = await this.client.patchWorkItem(m.taskId, [
          {
            op: "add",
            path: "/relations/-",
            value: { rel: "AttachedFile", url, attributes: { comment: `evidencia ${r.tc_id ?? ""} (${r.status})` } },
          },
        ]);
        if (rel.status >= 200 && rel.status < 300) {
          summary.uploaded++;
          summary.linked.push({ tc_id: r.tc_id ?? null, taskId: m.taskId, file: path.basename(abs), strategy: m.strategy });
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
