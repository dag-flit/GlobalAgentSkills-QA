// github-adapter.mjs — adapter de GitHub Issues. Implementa el contrato TrackerAdapter
// sobre la REST de GitHub, con transporte inyectable (offline-testable). Sin custom_fields
// (GitHub usa labels): updateCycle es no-op. Evidencia → comentario en el issue + reporte
// local. Labels/estados desde el preset (profiles/presets/github.yaml). Cero literales.

import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";
import { createClient } from "./github-rest.mjs";
import { parseAcText } from "../../_shared/parse-ac.mjs";
import { writeLocalReport } from "../../../runtime/evidence/local-sink.mjs";

const REQUIRED = ["GITHUB_TOKEN", "GITHUB_REPOSITORY"];
const MODE = "github";

export class GithubAdapter extends TrackerAdapter {
  constructor(ctx = {}) {
    super(ctx);
    this.client = ctx.ghClient || createClient({ env: this.env, http: ctx.http });
  }

  get name() {
    return MODE;
  }

  capabilities() {
    // sin custom_fields (labels); adjuntos binarios no via REST → se listan en el comentario
    return { attachments: false, custom_fields: false, comments: true, states: true, network: true };
  }

  async preflight() {
    const missing = REQUIRED.filter((k) => !this.env[k]);
    if (missing.length) return { ok: false, mode: MODE, detail: `Faltan variables: ${missing.join(", ")}` };
    try {
      const res = await this.client.getRepo();
      if (res.status === 200) return { ok: true, mode: MODE, detail: `Repo ${this.client.owner}/${this.client.repo} accesible.` };
      if (res.status === 401) return { ok: false, mode: MODE, detail: "Token inválido (401)." };
      if (res.status === 404) return { ok: false, mode: MODE, detail: `Repo ${this.client.owner}/${this.client.repo} no encontrado (404).` };
      return { ok: false, mode: MODE, detail: `GitHub respondió ${res.status}.` };
    } catch (e) {
      return { ok: false, mode: MODE, detail: `No se pudo contactar GitHub: ${e.message}` };
    }
  }

  async getWorkItem(id) {
    const res = await this.client.getIssue(id);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`github.getWorkItem(${id}): ${res.status}`);
    const it = res.json || {};
    return {
      id: String(id),
      title: it.title || `issue ${id}`,
      state: it.state || "open",
      acceptance_criteria: parseAcText(it.body || ""),
      raw: it,
      stub: false,
    };
  }

  async resolveRequirements(ref) {
    const wi = await this.getWorkItem(ref);
    return (wi && wi.acceptance_criteria) || [];
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
      const res = await this.client.addComment(issue, this._summaryMarkdown(results));
      comment = res.status >= 200 && res.status < 300 ? { ok: true, id: (res.json && res.json.id) ?? null } : { ok: false, status: res.status };
    }

    // GitHub no sube binarios por REST de issues: los archivos se referencian en el comentario.
    const filed = results.filter((r) => Array.isArray(r.files) && r.files.length).flatMap((r) => r.files);
    return { ok: true, sink: "dual", commentId: comment ? comment.id ?? null : null, comment, local, attachments: { uploaded: 0, listed: filed } };
  }

  async createDefect(defect = {}) {
    const label = (this.profile.github && this.profile.github.defect_label) || "qa-defect";
    const payload = { title: defect.title || "(sin título)", body: defect.description || "", labels: [label] };
    const res = await this.client.createIssue(payload);
    if (res.status >= 200 && res.status < 300) return String(res.json && res.json.number);
    throw new Error(`github.createDefect: ${res.status}`);
  }

  async updateCycle(id, fields) {
    // GitHub no tiene custom fields: no-op (capabilities.custom_fields === false).
    return { ok: true, noop: true, reason: "github: sin custom fields (usa labels)" };
  }

  async closeArtifact(id, result = {}) {
    const state = result.passed ? "closed" : "open";
    const res = await this.client.updateIssue(id, { state });
    return { ok: res.status >= 200 && res.status < 300, state, status: res.status };
  }

  _summaryMarkdown(results) {
    const count = (s) => results.filter((r) => r.status === s).length;
    const rows = results
      .map((r) => {
        const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
        return `| ${r.layer} | ${r.tc_id || "—"} | ${icon} ${r.status} | ${(r.narrative || "").replace(/\|/g, "\\|")} |`;
      })
      .join("\n");
    return (
      `**Resumen QA** — ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}\n\n` +
      `| Capa | TC | Resultado | Notas |\n|------|----|-----------|-------|\n${rows}\n` +
      casesMarkdown(results)
    );
  }
}

// Detalle de los TC ejecutados por debajo de cada capa, en Markdown (listas anidadas).
function casesMarkdown(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases.map((r) => {
    const c = (s) => r.cases.filter((x) => x.status === s).length;
    const where = r.metrics && r.metrics.cwd ? ` @ ${r.metrics.cwd}` : "";
    const lines = r.cases.map((tc) => {
      const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : "⏭";
      const d = typeof tc.duration === "number" ? ` _(${tc.duration} ms)_` : "";
      let line = `- ${ic} ${(tc.name || "").replace(/\|/g, "\\|")}${d}`;
      if (tc.status === "fail" && tc.message) {
        line += `\n  - ⚠ ${String(tc.message).split(/\r?\n/).slice(0, 3).join(" ⏎ ")}`;
      }
      return line;
    });
    return `**${r.layer} — ${(r.metrics && r.metrics.tool) || ""}**${where} · ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}\n${lines.join("\n")}`;
  });
  return `\n### Detalle de pruebas (TC ejecutados)\n\n${blocks.join("\n\n")}\n`;
}

export default GithubAdapter;
