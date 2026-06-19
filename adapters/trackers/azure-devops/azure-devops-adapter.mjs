// azure-devops-adapter.mjs — adapter REAL de Azure DevOps (F2).
// Implementa el contrato TrackerAdapter sobre un cliente REST con transporte INYECTABLE,
// para poder probarlo offline. CERO literales: org/proyecto/PAT vienen de `env`; estados,
// campos y tags vienen del perfil (azure.*). Local-first: este adapter solo se usa cuando
// el perfil pide `tracker: azure-devops`; el preflight condicional del orquestador lo exige.
//
// publishEvidence implementa la política DUAL: resumen en la Discussion del WI padre +
// reporte local (md/html) como artefacto para CI/diff. Los adjuntos por TC→Task (que
// requieren tc-ado-match) quedan para F2.2; se reportan como `deferred`, no se fingen.

import fs from "node:fs";
import path from "node:path";
import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";
import { createClient } from "./ado-rest.mjs";
import { resolveTaskId } from "./tc-match.mjs";
import { writeLocalReport } from "../../../runtime/evidence/local-sink.mjs";

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

  async resolveRequirements(ref) {
    const wi = await this.getWorkItem(ref);
    return (wi && wi.acceptance_criteria) || [];
  }

  async publishEvidence(target, payload) {
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const parentId = (target && target.work_item_id) || (payload && payload.work_item_id) || null;

    // 1) Reporte local SIEMPRE (artefacto md/html para CI/diff).
    const local = writeLocalReport({
      repoRoot: this.repoRoot,
      profile: this.profile,
      workItemId: parentId || "local",
      results,
    });

    // 2) Resumen en la Discussion del WI padre.
    let comment = null;
    if (parentId) {
      const res = await this.client.addComment(parentId, this._summaryHtml(results));
      comment = res.status >= 200 && res.status < 300
        ? { ok: true, id: (res.json && res.json.id) ?? null }
        : { ok: false, status: res.status };
    }

    // 3) Adjuntos png/webm por TC → Task (resueltos por tc-match).
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

  // Sube cada `files[]` de evidencia y lo enlaza al Task-TC resuelto por tc-match.
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

  async createDefect(defect = {}) {
    const wi = this._wi();
    const type = wi.bug_work_item_type || "Bug";
    const ops = [
      { op: "add", path: "/fields/System.Title", value: defect.title || "(sin título)" },
      { op: "add", path: "/fields/System.Description", value: defect.description || "" },
    ];
    if (wi.defect_tag) ops.push({ op: "add", path: "/fields/System.Tags", value: wi.defect_tag });
    if (defect.parent_id) {
      ops.push({
        op: "add",
        path: "/relations/-",
        value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: this.client.workItemUrl(defect.parent_id) },
      });
    }
    const res = await this.client.createWorkItem(type, ops);
    if (res.status >= 200 && res.status < 300) return String(res.json && res.json.id);
    throw new Error(`azure-devops.createDefect: ADO ${res.status}`);
  }

  async updateCycle(id, fields = {}) {
    const map = this._fields();
    const ops = Object.entries(fields).map(([k, v]) => ({
      op: "add",
      path: `/fields/${map[k] || k}`, // acepta clave lógica (test_start_date) o ref directa (Custom.*)
      value: v,
    }));
    if (!ops.length) return { ok: true, noop: true };
    const res = await this.client.patchWorkItem(id, ops);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  }

  async closeArtifact(id, result = {}) {
    const wi = this._wi();
    const state =
      result.type === "bug"
        ? result.passed
          ? wi.bug_qa_verified_state
          : wi.bug_dev_resolved_state
        : result.passed
          ? wi.test_case_pass_state
          : wi.test_case_fail_state;
    if (!state) return { ok: false, reason: "sin estado destino configurado en el perfil" };
    const res = await this.client.patchWorkItem(id, [{ op: "add", path: "/fields/System.State", value: state }]);
    return { ok: res.status >= 200 && res.status < 300, state, status: res.status };
  }

  // ── helpers internos ────────────────────────────────────────────────────────
  _wi() {
    return (this.profile.azure && this.profile.azure.work_item) || {};
  }
  _fields() {
    return (this.profile.azure && this.profile.azure.fields) || {};
  }
  _field(key, fallback) {
    return this._fields()[key] || fallback;
  }

  _summaryHtml(results) {
    const count = (s) => results.filter((r) => r.status === s).length;
    const rows = results
      .map((r) => {
        const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
        return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id || "—")}</td><td>${icon} ${esc(
          r.status
        )}</td><td>${esc(r.narrative || "")}</td></tr>`;
      })
      .join("");
    const sup = this.profile.supervision;
    const prefix =
      sup && sup.enabled
        ? `<p><em>${esc(
            (sup.comment_prefix || "").replace("{agent_or_skill}", "qa-orchestrator").replace(
              "{lead_email}",
              this.env[(sup.lead_email || "").replace(/^env\./, "")] || sup.lead_email || ""
            )
          )}</em></p>`
        : "";
    return (
      `${prefix}<p><strong>Resumen QA</strong> — ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
      `<table><thead><tr><th>Capa</th><th>TC</th><th>Resultado</th><th>Notas</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }
}

// AC en ADO es HTML: lo normalizamos a líneas (gherkin / checklist / viñetas).
function parseAc(html) {
  if (!html) return [];
  const text = String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^- \[.?\]/.test(t)) out.push(t.replace(/^- \[.?\]\s*/, ""));
    else if (/^[-*]\s+/.test(t)) out.push(t.replace(/^[-*]\s+/, ""));
    else out.push(t); // incluye líneas Gherkin (Scenario/Given/When/Then)
  }
  return out;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export default AzureDevOpsAdapter;
