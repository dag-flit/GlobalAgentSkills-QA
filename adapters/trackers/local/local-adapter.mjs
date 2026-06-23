// local-adapter.mjs — adapter de tracker LOCAL. Default del kit. Sin red, sin PAT.
// Preflight siempre OK. Work items se leen de .qa/work-items/{id}.md o devuelven stub.
// Evidencia → reporte local md+html. update_cycle/closeArtifact son no-ops registrados.

import fs from "node:fs";
import path from "node:path";
import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";
import { writeLocalReport } from "../../../runtime/evidence/local-sink.mjs";

export class LocalAdapter extends TrackerAdapter {
  get name() {
    return "local";
  }

  async preflight() {
    return { ok: true, mode: "local", detail: "Sin tracker remoto: evidencia al repo (qa-evidence/)." };
  }

  capabilities() {
    return {
      attachments: true,    // se copian al directorio de evidencia
      custom_fields: false, // no hay TestStartDate/ReTest en local
      comments: false,
      states: false,
      network: false,
    };
  }

  async getWorkItem(id) {
    // intenta leer un archivo local de requisito; si no existe, devuelve stub
    const candidates = [
      path.join(this.repoRoot, ".qa", "work-items", `${id}.md`),
      path.join(this.repoRoot, ".qa", "work-items", `${id}.yaml`),
    ];
    const file = candidates.find((c) => fs.existsSync(c));
    if (!file) {
      return { id: String(id), title: `(stub local) WI ${id}`, state: "local", stub: true };
    }
    const text = fs.readFileSync(file, "utf8");
    const titleMatch = text.match(/^#\s+(.+)$/m);
    return {
      id: String(id),
      title: titleMatch ? titleMatch[1].trim() : `WI ${id}`,
      state: "local",
      acceptance_criteria: extractAC(text),
      stub: false,
    };
  }

  async resolveRequirements(ref) {
    const wi = await this.getWorkItem(ref);
    return wi?.acceptance_criteria || [];
  }

  async publishEvidence(target, payload) {
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const out = writeLocalReport({
      repoRoot: this.repoRoot,
      profile: this.profile,
      workItemId: target?.work_item_id || payload?.work_item_id || "local",
      featureId: target?.feature_id ?? payload?.feature_id,
      developer: target?.developer ?? payload?.developer,
      results,
    });
    return { ok: true, sink: "local", ...out };
  }

  async createDefect(defect) {
    // local: registra el defecto como archivo md en qa-evidence/defects/
    const dir = path.join(this.repoRoot, (this.profile.evidence?.output_dir) || "qa-evidence", "defects");
    fs.mkdirSync(dir, { recursive: true });
    const id = `LOCAL-BUG-${Date.now()}`;
    fs.writeFileSync(
      path.join(dir, `${id}.md`),
      `# ${id}\n\n${defect?.title || "(sin título)"}\n\n${defect?.description || ""}\n`,
      "utf8"
    );
    return id;
  }

  async updateCycle(id, fields) {
    return { ok: true, noop: true, reason: "tracker local: sin campos de ciclo" };
  }

  async closeArtifact(id, result) {
    return { ok: true, noop: true, reason: "tracker local: nada que cerrar" };
  }

  async reactivateRequirement(id, info = {}) {
    // local no tiene estados ni comentarios remotos (capabilities.states/comments === false):
    // la trazabilidad del defecto ya queda en qa-evidence/defects/ vía createDefect.
    return {
      ok: true,
      noop: true,
      reason: "tracker local: sin estados ni comentarios remotos",
      id: String(id),
      bugId: info.bugId || null,
    };
  }
}

function extractAC(text) {
  // Gherkin (Scenario:) o checklist (- [ ]) o viñetas
  const acSection = text.split(/^#+\s/m).find((s) => /criterios|acceptance|AC\b/i.test(s)) || text;
  const lines = acSection.split(/\r?\n/);
  const ac = [];
  for (const l of lines) {
    const t = l.trim();
    if (/^- \[.?\]/.test(t)) ac.push(t.replace(/^- \[.?\]\s*/, ""));
    else if (/^Scenario:/i.test(t)) ac.push(t.replace(/^Scenario:\s*/i, ""));
    else if (/^- /.test(t)) ac.push(t.replace(/^- /, ""));
  }
  return ac;
}

export default LocalAdapter;
