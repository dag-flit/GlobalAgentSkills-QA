// ado-requirements.mjs — evidencia/planificación POR HU del adapter de Azure DevOps.
// Extraído de azure-devops-adapter.mjs (F1) sin cambiar comportamiento. Las funciones reciben
// el adapter como `self` (para usar self.client, self._wi(), self.getWorkItem,
// self._supervisionPrefix()) y delegan el render a ./ado-html.mjs.

import {
  renderTcCriterion,
  renderTcDescription,
  renderHuPlan,
  renderHuEvidence,
  renderTestPlan,
} from "./ado-html.mjs";

// Busca un hijo de `parentId` cuyo título cumpla `titleMatches`.
export async function findChild(self, parentId, titleMatches) {
  const res = await self.client.getWorkItemRelations(parentId);
  if (res.status !== 200) return null;
  const relations = (res.json && res.json.relations) || [];
  const childIds = relations
    .filter((r) => r && r.rel === "System.LinkTypes.Hierarchy-Forward")
    .map((r) => String(r.url || "").split("/").pop())
    .filter(Boolean);
  for (const cid of childIds) {
    const wi = await self.getWorkItem(cid);
    if (wi && titleMatches(wi.title)) return cid;
  }
  return null;
}
// Coincidencia exacta de título (idempotencia del TC por HU).
export function findChildByTitle(self, parentId, title) {
  return findChild(self, parentId, (t) => t === title);
}
// Coincidencia por prefijo (idempotencia por clave estable).
export function findChildByTitlePrefix(self, parentId, prefix) {
  return findChild(self, parentId, (t) => String(t || "").startsWith(prefix));
}

// Publica la evidencia POR HU: asegura UN TC (Task hijo) POR CRITERIO de la HU (idempotente
// por la clave "TC-AC<n>") y comenta el resultado de la corrida en la HU. Los criterios y los
// TC son de la HU, NO del Feature. NO toca el resumen al Feature ni la evidencia local.
export async function publishRequirementEvidence(self, requirementId, info = {}) {
  const huId = String(requirementId);
  const criteria = Array.isArray(info.criteria) ? info.criteria : [];
  const results = Array.isArray(info.results) ? info.results : [];
  const tcs = Array.isArray(info.tcs) ? info.tcs : [];
  const wi = self._wi();
  const sup = self._supervisionPrefix();
  const tcType = wi.test_case_work_item_type || "Task";
  const out = { ok: true, mode: self.name, requirementId: huId, tcId: null, tcCreated: false, tcs: [] };

  if (tcs.length) {
    // Un TC (Task) por CRITERIO — idempotente por la clave "TC-AC<n>" (estable aunque cambie
    // el texto). El título descriptivo lo trae el manifest del generador.
    for (const tc of tcs) {
      const entry = { key: tc.key, acIndex: tc.acIndex, title: tc.title, status: tc.status || "pending", tcId: null, created: false };
      try {
        const existing = await findChildByTitlePrefix(self, huId, `${tc.key} `);
        if (existing) {
          entry.tcId = existing;
        } else {
          const res = await self.client.createWorkItem(tcType, [
            { op: "add", path: "/fields/System.Title", value: tc.title },
            { op: "add", path: "/fields/System.Description", value: renderTcCriterion({ sup, huId, tc }) },
            { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: self.client.workItemUrl(huId) } },
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
      const existing = await findChildByTitle(self, huId, tcTitle);
      if (existing) {
        out.tcId = existing;
      } else {
        const res = await self.client.createWorkItem(tcType, [
          { op: "add", path: "/fields/System.Title", value: tcTitle },
          { op: "add", path: "/fields/System.Description", value: renderTcDescription({ sup, huId, huTitle: info.huTitle, criteria }) },
          { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: self.client.workItemUrl(huId) } },
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
        const res = await self.client.addComment(huId, renderHuPlan({ sup, huId, criteria, tcs: out.tcs }));
        out.commentOk = res.status >= 200 && res.status < 300;
        out.commentId = (res.json && res.json.id) ?? null;
        if (!out.commentOk) out.commentStatus = res.status;
      }
    } else {
      const res = await self.client.addComment(huId, renderHuEvidence({ sup, client: self.client, huId, criteria, results, info, tcId: out.tcId, tcs: out.tcs }));
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
export async function publishTestPlan(self, featureId, info = {}) {
  const fid = String(featureId);
  const wi = self._wi();
  const planType = wi.test_case_work_item_type || "Task";
  const planPrefix = wi.test_plan_title_prefix || "PLAN PRUEBAS FEATURE ";
  const title = `${planPrefix}${info.featureTitle || fid}`;
  const out = { ok: true, mode: self.name, featureId: fid, planId: null, created: false };
  try {
    const description = renderTestPlan({ sup: self._supervisionPrefix(), info: { ...info, featureId: fid } });
    const existing = await findChildByTitlePrefix(self, fid, planPrefix);
    if (existing) {
      out.planId = existing;
      const res = await self.client.patchWorkItem(existing, [{ op: "add", path: "/fields/System.Description", value: description }]);
      out.updated = res.status >= 200 && res.status < 300;
      if (!out.updated) out.error = `actualizar plan: ADO ${res.status}`;
    } else {
      const res = await self.client.createWorkItem(planType, [
        { op: "add", path: "/fields/System.Title", value: title },
        { op: "add", path: "/fields/System.Description", value: description },
        { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: self.client.workItemUrl(fid) } },
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
