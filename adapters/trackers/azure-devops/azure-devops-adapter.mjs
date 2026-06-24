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

  // Lista los hijos jerárquicos de un work item (p.ej. las HUs de un Feature).
  async listChildren(id) {
    const res = await this.client.getWorkItemRelations(id);
    if (res.status === 404) return [];
    if (res.status !== 200) throw new Error(`azure-devops.listChildren(${id}): ADO ${res.status}`);
    const relations = (res.json && res.json.relations) || [];
    const childIds = relations
      .filter((r) => r && r.rel === "System.LinkTypes.Hierarchy-Forward")
      .map((r) => String(r.url || "").split("/").pop())
      .filter(Boolean);
    const children = [];
    for (const cid of childIds) {
      const wi = await this.getWorkItem(cid);
      if (wi) {
        children.push({
          id: wi.id,
          title: wi.title,
          state: wi.state,
          type: (wi.raw && wi.raw["System.WorkItemType"]) || "",
        });
      }
    }
    return children;
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
      plan: payload && payload.plan,
      results,
    });

    // 2) Resumen en la Discussion del WI padre.
    let comment = null;
    if (parentId) {
      const res = await this.client.addComment(parentId, this._summaryHtml(results, payload && payload.plan));
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

  // Reactiva la HU con novedad y deja la TRAZABILIDAD del Bug en su Discussion.
  // El estado destino sale del perfil (azure.work_item.on_defect_reactivate_state, p.ej.
  // "Active"); NUNCA Closed — eso es exclusivo del PO. Si el perfil no lo define, no toca
  // el estado pero igual deja el comentario de trazabilidad (degrada con aviso).
  async reactivateRequirement(id, info = {}) {
    const wi = this._wi();
    const out = { ok: true, mode: MODE, id: String(id) };

    const state = wi.on_defect_reactivate_state;
    if (state) {
      const res = await this.client.patchWorkItem(id, [{ op: "add", path: "/fields/System.State", value: state }]);
      out.state = state;
      out.stateOk = res.status >= 200 && res.status < 300;
      if (!out.stateOk) out.stateStatus = res.status;
    } else {
      out.stateSkipped = "sin azure.work_item.on_defect_reactivate_state en el perfil";
    }

    const res = await this.client.addComment(id, this._traceHtml(info));
    out.commentOk = res.status >= 200 && res.status < 300;
    out.commentId = (res.json && res.json.id) ?? null;
    if (!out.commentOk) out.commentStatus = res.status;

    out.ok = out.stateOk !== false && out.commentOk;
    return out;
  }

  // Publica la evidencia POR HU: asegura UN TC (Task hijo) POR CRITERIO de la HU (idempotente
  // por la clave "TC-AC<n>") y comenta el resultado de la corrida en la HU. Los criterios y los
  // TC son de la HU, NO del Feature. NO toca el resumen al Feature ni la evidencia local.
  async publishRequirementEvidence(requirementId, info = {}) {
    const huId = String(requirementId);
    const criteria = Array.isArray(info.criteria) ? info.criteria : [];
    const results = Array.isArray(info.results) ? info.results : [];
    const tcs = Array.isArray(info.tcs) ? info.tcs : [];
    const wi = this._wi();
    const tcType = wi.test_case_work_item_type || "Task";
    const out = { ok: true, mode: MODE, requirementId: huId, tcId: null, tcCreated: false, tcs: [] };

    if (tcs.length) {
      // Un TC (Task) por CRITERIO — idempotente por la clave "TC-AC<n>" (estable aunque cambie
      // el texto). El título descriptivo lo trae el manifest del generador.
      for (const tc of tcs) {
        const entry = { key: tc.key, acIndex: tc.acIndex, title: tc.title, status: tc.status || "pending", tcId: null, created: false };
        try {
          const existing = await this._findChildByTitlePrefix(huId, `${tc.key} `);
          if (existing) {
            entry.tcId = existing;
          } else {
            const res = await this.client.createWorkItem(tcType, [
              { op: "add", path: "/fields/System.Title", value: tc.title },
              { op: "add", path: "/fields/System.Description", value: this._tcCriterionHtml(huId, tc) },
              { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: this.client.workItemUrl(huId) } },
            ]);
            if (res.status >= 200 && res.status < 300) { entry.tcId = String(res.json && res.json.id); entry.created = true; }
            else entry.error = `crear TC: ADO ${res.status}`;
          }
        } catch (e) {
          entry.error = e.message;
        }
        out.tcs.push(entry);
      }
      out.tcId = out.tcs[0] ? out.tcs[0].tcId : null; // compat con consumidores antiguos
      out.tcCreated = out.tcs.some((t) => t.created);
    } else {
      // Compat: un único TC por HU (cuando no llega manifest de criterios).
      const tcTitle = `${wi.test_case_title_prefix || "TC-"}HU-${huId}`;
      try {
        const existing = await this._findChildByTitle(huId, tcTitle);
        if (existing) {
          out.tcId = existing;
        } else {
          const res = await this.client.createWorkItem(tcType, [
            { op: "add", path: "/fields/System.Title", value: tcTitle },
            { op: "add", path: "/fields/System.Description", value: this._tcDescriptionHtml(huId, info.huTitle, criteria) },
            { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: this.client.workItemUrl(huId) } },
          ]);
          if (res.status >= 200 && res.status < 300) { out.tcId = String(res.json && res.json.id); out.tcCreated = true; }
          else out.tcError = `crear TC: ADO ${res.status}`;
        }
      } catch (e) {
        out.tcError = e.message;
      }
    }

    // Comentar en la HU. En fase "plan" (planificación) se deja el plan/TC pendientes y SOLO
    // si se crearon TC nuevos (evita ruido al re-correr). En fase "result" (default, tras
    // ejecutar) se comenta el resultado de la corrida.
    const phase = info.phase === "plan" ? "plan" : "result";
    try {
      if (phase === "plan") {
        if (out.tcs.some((t) => t.created) || out.tcCreated) {
          const res = await this.client.addComment(huId, this._huPlanHtml({ huId, criteria, tcs: out.tcs }));
          out.commentOk = res.status >= 200 && res.status < 300;
          out.commentId = (res.json && res.json.id) ?? null;
          if (!out.commentOk) out.commentStatus = res.status;
        }
      } else {
        const res = await this.client.addComment(huId, this._huEvidenceHtml({ huId, criteria, results, info, tcId: out.tcId, tcs: out.tcs }));
        out.commentOk = res.status >= 200 && res.status < 300;
        out.commentId = (res.json && res.json.id) ?? null;
        if (!out.commentOk) out.commentStatus = res.status;
      }
    } catch (e) {
      out.commentError = e.message;
    }

    out.ok = out.tcError == null && out.tcs.every((t) => !t.error) && out.commentOk !== false;
    return out;
  }

  // Crea/actualiza el PLAN DE PRUEBAS del Feature: una Task hija "PLAN PRUEBAS FEATURE <nombre>"
  // que AGREGA objetivo + HUs + sus TC + alcance global + resultado. Idempotente por el prefijo
  // del título. El Feature NO aporta criterios/TC: solo el techo (objetivo + plan).
  async publishTestPlan(featureId, info = {}) {
    const fid = String(featureId);
    const wi = this._wi();
    const planType = wi.test_case_work_item_type || "Task";
    const planPrefix = wi.test_plan_title_prefix || "PLAN PRUEBAS FEATURE ";
    const title = `${planPrefix}${info.featureTitle || fid}`;
    const out = { ok: true, mode: MODE, featureId: fid, planId: null, created: false };
    try {
      const description = this._testPlanHtml({ ...info, featureId: fid });
      const existing = await this._findChildByTitlePrefix(fid, planPrefix);
      if (existing) {
        out.planId = existing;
        const res = await this.client.patchWorkItem(existing, [{ op: "add", path: "/fields/System.Description", value: description }]);
        out.updated = res.status >= 200 && res.status < 300;
        if (!out.updated) out.error = `actualizar plan: ADO ${res.status}`;
      } else {
        const res = await this.client.createWorkItem(planType, [
          { op: "add", path: "/fields/System.Title", value: title },
          { op: "add", path: "/fields/System.Description", value: description },
          { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: this.client.workItemUrl(fid) } },
        ]);
        if (res.status >= 200 && res.status < 300) { out.planId = String(res.json && res.json.id); out.created = true; }
        else out.error = `crear plan: ADO ${res.status}`;
      }
    } catch (e) {
      out.error = e.message;
    }
    out.ok = out.error == null;
    return out;
  }

  // Busca un hijo de `parentId` cuyo título coincida exactamente (idempotencia del TC por HU).
  async _findChildByTitle(parentId, title) {
    return this._findChild(parentId, (t) => t === title);
  }
  // Busca un hijo de `parentId` cuyo título EMPIECE por `prefix` (idempotencia por clave estable).
  async _findChildByTitlePrefix(parentId, prefix) {
    return this._findChild(parentId, (t) => String(t || "").startsWith(prefix));
  }
  async _findChild(parentId, titleMatches) {
    const res = await this.client.getWorkItemRelations(parentId);
    if (res.status !== 200) return null;
    const relations = (res.json && res.json.relations) || [];
    const childIds = relations
      .filter((r) => r && r.rel === "System.LinkTypes.Hierarchy-Forward")
      .map((r) => String(r.url || "").split("/").pop())
      .filter(Boolean);
    for (const cid of childIds) {
      const wi = await this.getWorkItem(cid);
      if (wi && titleMatches(wi.title)) return cid;
    }
    return null;
  }

  // Descripción del TC: criterios de aceptación de la HU como checklist a validar.
  _tcDescriptionHtml(huId, huTitle, criteria) {
    const items = (criteria || []).map((c) => `<li>${esc(critText(c))}</li>`).join("");
    return (
      `${this._supervisionPrefix()}` +
      `<p>TC de validación de la HU #${esc(huId)}${huTitle ? ` — ${esc(huTitle)}` : ""}.</p>` +
      (items
        ? `<p>Criterios de aceptación a validar:</p><ol>${items}</ol>`
        : `<p>(La HU no declara criterios de aceptación.)</p>`)
    );
  }

  // Descripción de un TC por CRITERIO: el criterio + su detalle (Gherkin) + estado.
  _tcCriterionHtml(huId, tc = {}) {
    const detail = tc.detail ? `<pre>${esc(tc.detail)}</pre>` : "";
    return (
      `${this._supervisionPrefix()}` +
      `<p>TC <strong>${esc(tc.key || "")}</strong> — HU #${esc(huId)}.</p>` +
      `<p><strong>Criterio de aceptación:</strong></p><blockquote>${esc(tc.criterion || "")}</blockquote>` +
      detail +
      `<p><em>Estado: ${esc(tc.status || "pendiente")} — prueba auto-generada (esqueleto), pendiente de implementar.</em></p>`
    );
  }

  // Comentario de PLANIFICACIÓN en la HU: registra los TC (pendientes) desde los criterios,
  // antes de ejecutar (lógica QA: el plan se arma en la planificación).
  _huPlanHtml({ huId, criteria, tcs }) {
    const tcArr = Array.isArray(tcs) ? tcs : [];
    const tcList = tcArr.length
      ? `<ul>${tcArr.map((t) => `<li>${esc(t.title || t.key)} <em>(pendiente)</em></li>`).join("")}</ul>`
      : (criteria || []).length
      ? `<ol>${criteria.map((c) => `<li>${esc(critText(c))}</li>`).join("")}</ol>`
      : "<p><em>(sin criterios declarados)</em></p>";
    return (
      `${this._supervisionPrefix()}` +
      `<p>📋 <strong>Plan de pruebas — HU #${esc(huId)}</strong></p>` +
      `<p>Se registraron los TC a partir de los criterios de aceptación (pendientes de ejecución):</p>` +
      tcList
    );
  }

  // Bloque "Plan por HU" (vertical, agrupado): HU como encabezado y sus TC en lista debajo.
  // SIN clave duplicada (el título del TC ya incluye "TC-AC<n> -"). Reusado por el Plan del
  // Feature y por el comentario general de ejecución del Feature.
  _planByHuHtml(hus) {
    return (Array.isArray(hus) ? hus : [])
      .map((h) => {
        const tcItems = (h.tcs || [])
          .map((tc) => `<li>${esc(tc.title || tc.key || "")} <em>(${esc(tc.status || "pendiente")})</em></li>`)
          .join("");
        return (
          `<p><strong>HU #${esc(h.id)}</strong>${h.title ? ` — ${esc(h.title)}` : ""}</p>` +
          (tcItems ? `<ul>${tcItems}</ul>` : `<p><em>(sin criterios declarados)</em></p>`)
        );
      })
      .join("");
  }

  // Plan de Pruebas del Feature: objetivo + HUs y sus TC + alcance global + resultado.
  _testPlanHtml(info = {}) {
    const hus = Array.isArray(info.hus) ? info.hus : [];
    const results = Array.isArray(info.results) ? info.results : [];
    const executed = results.length > 0;
    const count = (s) => results.filter((r) => r.status === s).length;
    const layers = [...new Set(results.map((r) => r.layer))];
    return (
      `${this._supervisionPrefix()}` +
      `<p>🗂️ <strong>Plan de Pruebas del Feature #${esc(info.featureId || "")}</strong>${info.featureTitle ? ` — ${esc(info.featureTitle)}` : ""}</p>` +
      (info.objective ? `<p><strong>Objetivo:</strong> ${esc(info.objective)}</p>` : "") +
      `<p><strong>Alcance:</strong> las HUs y criterios de abajo, MÁS la corrida general de capas${executed ? ` (${esc(layers.join(", ") || "—")})` : ""}.</p>` +
      (executed
        ? `<p><strong>Resultado consolidado:</strong> ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}.</p>`
        : `<p><strong>Estado:</strong> planificado (pendiente de ejecución).</p>`) +
      `<p><strong>Historias y sus TC:</strong></p>${this._planByHuHtml(hus) || "<p><em>(sin HUs)</em></p>"}` +
      (info.reportLink ? `<p>Evidencia local del ciclo: <code>${esc(info.reportLink)}</code></p>` : "")
    );
  }

  // Comentario de ejecución que se deja en la HU: resultado GLOBAL del ciclo + criterios +
  // pruebas asociadas a ESTA HU si las hay (etiqueta [HU-###]) o, si no, la nota de cómo
  // habilitar la validación por criterio. La evidencia local se enlaza si vino.
  _huEvidenceHtml({ huId, criteria, results, info, tcId, tcs }) {
    const count = (s) => results.filter((r) => r.status === s).length;
    const huCases = [];
    for (const r of results)
      for (const c of Array.isArray(r.cases) ? r.cases : [])
        if (huTagOf(c.name) === String(huId)) huCases.push({ layer: r.layer, ...c });
    const reportNote =
      info && info.reportLink ? `<p>Evidencia local del ciclo: <code>${esc(info.reportLink)}</code></p>` : "";

    // Si hay TC por criterio (manifest), se listan con su link y estado; si no, se cae al
    // listado simple de criterios (compat).
    const tcArr = Array.isArray(tcs) ? tcs.filter((t) => t && (t.key || t.title)) : [];
    const tcSection = tcArr.length
      ? `<p><strong>TC por criterio de esta HU:</strong></p><ul>${tcArr
          .map((t) => {
            const link = t.tcId ? ` <a href="${esc(this.client.workItemWebUrl(t.tcId))}">#${esc(t.tcId)}</a>` : "";
            return `<li>${esc(t.title || t.key)}${link} <em>(${esc(t.status || "pendiente")})</em></li>`;
          })
          .join("")}</ul>`
      : (criteria || []).length
      ? `<p><strong>Criterios de aceptación:</strong></p><ol>${criteria.map((c) => `<li>${esc(critText(c))}</li>`).join("")}</ol>`
      : "";

    const huSection = huCases.length
      ? `<p>Pruebas asociadas a esta HU (etiqueta [HU-${esc(huId)}]):</p><ul>${huCases
          .map((c) => {
            const ic = c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⏭";
            return `<li>${ic} ${esc(c.layer)} — ${esc(c.name)}</li>`;
          })
          .join("")}</ul>`
      : `<p><em>El resultado mostrado es el GLOBAL del ciclo. La validación por criterio se hace sobre los TC de arriba (hoy en estado «pendiente»: prueba generada por implementar).</em></p>`;

    return (
      `${this._supervisionPrefix()}` +
      `<p>🧪 <strong>Ejecución QA — HU #${esc(huId)}</strong></p>` +
      `<p>Resultado global del ciclo: ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
      tcSection +
      huSection +
      reportNote
    );
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

  // Bloque de supervisión (reusado por el resumen y la trazabilidad). Vacío si no aplica.
  _supervisionPrefix() {
    const sup = this.profile.supervision;
    if (!sup || !sup.enabled) return "";
    const text = (sup.comment_prefix || "")
      .replace("{agent_or_skill}", "qa-orchestrator")
      .replace("{lead_email}", this.env[(sup.lead_email || "").replace(/^env\./, "")] || sup.lead_email || "");
    return `<p><em>${esc(text)}</em></p>`;
  }

  _summaryHtml(results, plan) {
    const count = (s) => results.filter((r) => r.status === s).length;
    const rows = results
      .map((r) => {
        const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭";
        return `<tr><td>${esc(r.layer)}</td><td>${esc(r.tc_id || "—")}</td><td>${icon} ${esc(
          r.status
        )}</td><td>${esc(r.narrative || "")}</td></tr>`;
      })
      .join("");
    // Desglose "Plan por HU" (HU → sus TC) bajo la tabla de capas, si vino el plan.
    const planBlock =
      plan && Array.isArray(plan.hus) && plan.hus.length
        ? `<p><strong>Plan por HU</strong></p>${this._planByHuHtml(plan.hus)}`
        : "";
    return (
      `${this._supervisionPrefix()}<p><strong>Resumen QA</strong> — ✅ ${count("pass")} · ❌ ${count("fail")} · ⏭ ${count("skip")}</p>` +
      `<table><thead><tr><th>Capa</th><th>TC</th><th>Resultado</th><th>Notas</th></tr></thead><tbody>${rows}</tbody></table>` +
      planBlock +
      casesHtml(results)
    );
  }

  // Comentario de trazabilidad que se deja en la HU reactivada: enlaza el Bug creado y
  // lista los hallazgos (capa/TC/narrativa) que originaron la novedad.
  _traceHtml(info = {}) {
    const wi = this._wi();
    const bugId = info.bugId;
    const link = bugId
      ? `<a href="${esc(this.client.workItemWebUrl(bugId))}">#${esc(bugId)}</a>`
      : "(no se pudo crear el Bug)";
    const items = Array.isArray(info.items) ? info.items : [];
    const rows = items
      .map((r) => {
        const tc = r.tc_id ? ` ${esc(r.tc_id)}` : "";
        const tool = r.metrics && r.metrics.tool ? ` [${esc(r.metrics.tool)}]` : "";
        return `<li>❌ ${esc(r.layer)}${tool}${tc} — ${esc(r.narrative || "falla")}</li>`;
      })
      .join("");
    const stateNote = wi.on_defect_reactivate_state
      ? ` Historia reactivada a <strong>${esc(wi.on_defect_reactivate_state)}</strong>.`
      : "";
    return (
      `${this._supervisionPrefix()}` +
      `<p>🔴 <strong>Novedad QA</strong> — se registró el Bug de trazabilidad ${link}.${stateNote}</p>` +
      `<p>Hallazgos que originaron la novedad:</p><ul>${rows}</ul>`
    );
  }
}

// Detalle de los TC ejecutados por debajo de cada capa (mismo nivel de detalle que la
// evidencia local), para que la Discussion del WI padre no muestre solo el agregado.
function casesHtml(results) {
  const withCases = results.filter((r) => Array.isArray(r.cases) && r.cases.length);
  if (!withCases.length) return "";
  const blocks = withCases
    .map((r) => {
      const c = (s) => r.cases.filter((x) => x.status === s).length;
      const where = r.metrics && r.metrics.cwd ? ` @ ${esc(r.metrics.cwd)}` : "";
      const items = r.cases
        .map((tc) => {
          const ic = tc.status === "pass" ? "✅" : tc.status === "fail" ? "❌" : "⏭";
          const d = typeof tc.duration === "number" ? ` (${tc.duration} ms)` : "";
          const msg = tc.status === "fail" && tc.message ? `<br/><em>${esc(String(tc.message).split(/\r?\n/).slice(0, 3).join(" ⏎ "))}</em>` : "";
          return `<li>${ic} ${esc(tc.name)}${d}${msg}</li>`;
        })
        .join("");
      return `<p><strong>${esc(r.layer)} — ${esc((r.metrics && r.metrics.tool) || "")}</strong>${where} · ✅ ${c("pass")} · ❌ ${c("fail")} · ⏭ ${c("skip")}</p><ul>${items}</ul>`;
    })
    .join("");
  return `<p><strong>Detalle de pruebas (TC ejecutados)</strong></p>${blocks}`;
}

// Texto de un criterio que puede venir como string (línea) u objeto {title, detail}.
function critText(c) {
  return typeof c === "string" ? c : (c && c.title) || "";
}

function decodeHtml(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;/gi, "'");
}
// HTML → una línea (quita tags/entidades). Para títulos de encabezado.
function htmlLineText(html) {
  return decodeHtml(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
// HTML → texto multilínea, preservando saltos (de <br>, bloques y <pre>). Para el detalle.
function htmlBlockText(html) {
  const txt = decodeHtml(
    String(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|h\d|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
  return txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");
}

// AC en ADO es HTML. Si trae ENCABEZADOS (<h1-6>), cada encabezado es UN criterio (AC) y el
// contenido hasta el siguiente encabezado es su DETALLE (Gherkin/pasos) → 1 TC por AC. Si NO
// hay encabezados, se cae al modo por-línea (cada línea/viñeta es un criterio). Devuelve
// objetos {title, detail}; los renderers usan critText() y son tolerantes a strings.
function parseAc(html) {
  if (!html) return [];
  const s = String(html);
  if (/<h[1-6][^>]*>/i.test(s)) {
    const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;
    const heads = [];
    let m;
    while ((m = re.exec(s))) heads.push({ title: htmlLineText(m[1]), titleEnd: re.lastIndex, start: m.index });
    const out = [];
    for (let i = 0; i < heads.length; i++) {
      const detailHtml = s.slice(heads[i].titleEnd, i + 1 < heads.length ? heads[i + 1].start : s.length);
      out.push({ title: heads[i].title, detail: htmlBlockText(detailHtml) });
    }
    return out.filter((c) => c.title);
  }
  // sin encabezados: por línea (compat), como objetos {title, detail:""}
  const out = [];
  for (const raw of htmlBlockText(s).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^- \[.?\]/.test(t)) out.push({ title: t.replace(/^- \[.?\]\s*/, ""), detail: "" });
    else if (/^[-*]\s+/.test(t)) out.push({ title: t.replace(/^[-*]\s+/, ""), detail: "" });
    else out.push({ title: t, detail: "" }); // incluye líneas Gherkin sueltas
  }
  return out;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Id de HU de una etiqueta de convención "[HU-103]" / "HU-103" / "HU 103" (igual que el
// orquestador). Permite que el comentario por-HU muestre solo las pruebas de esa HU si las hay.
function huTagOf(text) {
  const m = String(text || "").match(/\bHU[-\s]?(\d+)\b/i);
  return m ? m[1] : null;
}

export default AzureDevOpsAdapter;
