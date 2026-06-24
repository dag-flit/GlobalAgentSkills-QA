// jira-adapter.mjs — adapter de Jira Cloud. Implementa el contrato TrackerAdapter sobre la
// REST v3, con transporte inyectable (offline-testable). Soporta custom_fields (updateCycle
// mapea claves lógicas → customfield_* del preset) y transiciones (closeArtifact). Evidencia
// → comentario en el issue + reporte local. Tipos/campos/transiciones desde el preset.

import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";
import { createClient, adf } from "./jira-rest.mjs";
import { parseAcText } from "../../_shared/parse-ac.mjs";
import { writeLocalReport } from "../../../runtime/evidence/local-sink.mjs";

const REQUIRED = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_TOKEN", "JIRA_PROJECT_KEY"];
const MODE = "jira";

export class JiraAdapter extends TrackerAdapter {
  constructor(ctx = {}) {
    super(ctx);
    this.client = ctx.jiraClient || createClient({ env: this.env, http: ctx.http });
  }

  get name() {
    return MODE;
  }

  capabilities() {
    return { attachments: true, custom_fields: true, comments: true, states: true, network: true };
  }

  async preflight() {
    const missing = REQUIRED.filter((k) => !this.env[k]);
    if (missing.length) return { ok: false, mode: MODE, detail: `Faltan variables: ${missing.join(", ")}` };
    try {
      const res = await this.client.myself();
      if (res.status === 200) return { ok: true, mode: MODE, detail: `Jira ${this.client.base} accesible.` };
      if (res.status === 401 || res.status === 403) return { ok: false, mode: MODE, detail: "Credenciales inválidas (401/403)." };
      return { ok: false, mode: MODE, detail: `Jira respondió ${res.status}.` };
    } catch (e) {
      return { ok: false, mode: MODE, detail: `No se pudo contactar Jira: ${e.message}` };
    }
  }

  async getWorkItem(id) {
    const res = await this.client.getIssue(id);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`jira.getWorkItem(${id}): ${res.status}`);
    const fields = (res.json && res.json.fields) || {};
    const desc = typeof fields.description === "string" ? fields.description : this._adfToText(fields.description);
    return {
      id: String(id),
      title: fields.summary || `issue ${id}`,
      state: (fields.status && fields.status.name) || "unknown",
      acceptance_criteria: parseAcText(desc),
      raw: fields,
      stub: false,
    };
  }

  async resolveRequirements(ref) {
    const wi = await this.getWorkItem(ref);
    return (wi && wi.acceptance_criteria) || [];
  }

  // Jira (epic→story por "Epic Link"/parent) no se resuelve aún en este adapter: [] por ahora.
  async listChildren(id) {
    return [];
  }

  async publishEvidence(target, payload) {
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const issue = (target && target.work_item_id) || (payload && payload.work_item_id) || null;

    const local = writeLocalReport({
      repoRoot: this.repoRoot,
      profile: this.profile,
      workItemId: issue || "local",
      featureId: (target && target.feature_id) ?? (payload && payload.feature_id),
      developer: (target && target.developer) ?? (payload && payload.developer),
      results,
    });

    let comment = null;
    if (issue) {
      const res = await this.client.addComment(issue, adf(this._summaryText(results)));
      comment = res.status >= 200 && res.status < 300 ? { ok: true, id: (res.json && res.json.id) ?? null } : { ok: false, status: res.status };
    }

    return { ok: true, sink: "dual", commentId: comment ? comment.id ?? null : null, comment, local };
  }

  async createDefect(defect = {}) {
    const j = this.profile.jira || {};
    const fields = {
      project: { key: this.client.project },
      issuetype: { name: j.bug_issue_type || "Bug" },
      summary: defect.title || "(sin título)",
      description: adf(defect.description || ""),
    };
    const res = await this.client.createIssue(fields);
    if (res.status >= 200 && res.status < 300) return String((res.json && (res.json.key || res.json.id)) || "");
    throw new Error(`jira.createDefect: ${res.status}`);
  }

  async updateCycle(id, fields = {}) {
    const map = (this.profile.jira && this.profile.jira.fields) || {};
    const payload = {};
    for (const [k, v] of Object.entries(fields)) payload[map[k] || k] = v; // clave lógica → customfield_*
    if (!Object.keys(payload).length) return { ok: true, noop: true };
    const res = await this.client.updateIssue(id, payload);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  }

  async closeArtifact(id, result = {}) {
    const tr = (this.profile.jira && this.profile.jira.transitions) || {};
    const transitionId = result.passed ? tr.pass : tr.fail;
    if (!transitionId) return { ok: false, reason: "sin transición configurada en el preset jira" };
    const res = await this.client.transition(id, transitionId);
    return { ok: res.status >= 200 && res.status < 300, transitionId, status: res.status };
  }

  // Reactiva la HU con novedad mediante la transición `jira.transitions.reactivate` (si está
  // configurada) y deja la trazabilidad del defecto en un comentario ADF del mismo issue.
  async reactivateRequirement(id, info = {}) {
    const out = { ok: true, mode: MODE, id: String(id) };
    const tr = (this.profile.jira && this.profile.jira.transitions) || {};
    if (tr.reactivate) {
      const re = await this.client.transition(id, tr.reactivate);
      out.transitionId = tr.reactivate;
      out.stateOk = re.status >= 200 && re.status < 300;
      if (!out.stateOk) out.stateStatus = re.status;
    } else {
      out.stateSkipped = "sin jira.transitions.reactivate en el preset";
    }

    const c = await this.client.addComment(id, adf(this._traceText(info)));
    out.commentOk = c.status >= 200 && c.status < 300;
    out.commentId = (c.json && c.json.id) ?? null;
    if (!out.commentOk) out.commentStatus = c.status;

    out.ok = out.stateOk !== false && out.commentOk;
    return out;
  }

  _traceText(info = {}) {
    const bug = info.bugId ? info.bugId : "(no se pudo crear el defecto)";
    const items = Array.isArray(info.items) ? info.items : [];
    const lines = items.map((r) => {
      const tool = r.metrics && r.metrics.tool ? ` [${r.metrics.tool}]` : "";
      const tc = r.tc_id ? ` ${r.tc_id}` : "";
      return `FAIL ${r.layer}${tool}${tc}: ${r.narrative || "falla"}`;
    });
    return `Novedad QA — defecto de trazabilidad: ${bug}\nHallazgos que originaron la novedad:\n` + lines.join("\n");
  }

  _summaryText(results) {
    const count = (s) => results.filter((r) => r.status === s).length;
    const lines = results.map((r) => `${r.status.toUpperCase()} ${r.layer}${r.tc_id ? " " + r.tc_id : ""}: ${r.narrative || ""}`);
    let text = `Resumen QA — pass ${count("pass")} / fail ${count("fail")} / skip ${count("skip")}\n` + lines.join("\n");

    // Detalle de los TC ejecutados por debajo de cada capa.
    const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
    if (withCases.length) {
      text += "\n\nDetalle de pruebas (TC ejecutados):";
      for (const r of withCases) {
        const c = (s) => r.cases.filter((x) => x.status === s).length;
        const where = r.metrics && r.metrics.cwd ? ` @ ${r.metrics.cwd}` : "";
        text += `\n${r.layer} — ${(r.metrics && r.metrics.tool) || ""}${where} · pass ${c("pass")} / fail ${c("fail")} / skip ${c("skip")}`;
        for (const tc of r.cases) {
          const mark = tc.status === "pass" ? "[OK]" : tc.status === "fail" ? "[X]" : "[-]";
          const d = typeof tc.duration === "number" ? ` (${tc.duration} ms)` : "";
          text += `\n  ${mark} ${tc.name}${d}`;
          if (tc.status === "fail" && tc.message) text += `\n      ${String(tc.message).split(/\r?\n/).slice(0, 2).join(" ⏎ ")}`;
        }
      }
    }
    return text;
  }

  _adfToText(node) {
    // extracción best-effort de texto desde un documento ADF
    if (!node || typeof node !== "object") return "";
    if (node.type === "text" && typeof node.text === "string") return node.text;
    const kids = Array.isArray(node.content) ? node.content : [];
    return kids.map((k) => this._adfToText(k)).join(node.type === "paragraph" ? "" : "\n");
  }
}

export default JiraAdapter;
