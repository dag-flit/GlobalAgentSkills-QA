import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import type { RegressionTarget, RegressionSuite } from "@/lib/types";

// Publica en Azure DevOps la evidencia de una corrida de regresión ya ejecutada. Alcance «por prueba
// individual»: por CADA prueba de la corrida crea una HU (User Story) nueva «Regresión — <suite> /
// <prueba>» en el sprint en curso, con el resumen + las capturas por paso INLINE en el CUERPO de la HU
// (Description y campo «Evidences», cada imagen rotulada «Paso N»), y el reporte autocontenido ADJUNTO
// como archivo. Reusa `createFindingsWorkItem` del adapter azure. No re-ejecuta el navegador: lee la
// evidencia que dejó la corrida.
//
// Seguridad: el cliente solo manda ids opacos (targetId/suiteId/runId); la carpeta de la corrida la
// reconstruye ESTE server desde tenant + target + suite + runId. `runId` se valida como dígitos.

export interface PublishedItem { testId: string; testName: string; ok: boolean; id?: string; url?: string; title?: string; shots?: number; reason?: string }
export interface PublishResult { ok: boolean; published: PublishedItem[]; message?: string }

function slug(s: string): string {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

interface ManifestTest { id: string; name: string; status: "pass" | "fail"; steps: number; warnings: string[]; cases: Array<{ name: string; op?: string; status: string; message?: string | null; file?: string; kind?: string }>; dir: string; report: string; attempts?: number; flaky?: boolean }

interface Manifest { system: string; suite: string; stamp: string; tests: ManifestTest[] }

export async function publishRun(opts: {
  target: RegressionTarget;
  suite: RegressionSuite;
  runId: string;
  testId?: string;
  evidenceBase: string;
  adapter: any;
}): Promise<PublishResult> {
  const { target, suite, runId, testId, evidenceBase, adapter } = opts;
  if (!/^\d+$/.test(runId)) return { ok: false, published: [], message: "Identificador de corrida inválido." };

  const runDir = path.join(evidenceBase, slug(target.id), slug(suite.name), runId);
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, published: [], message: "No se encontró la evidencia de esa corrida. Volvé a correr la suite y publicá enseguida." };
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, published: [], message: "La evidencia de la corrida está dañada." };
  }

  const { renderRegressionFindings, regressionTitle, REGRESSION_COUNT_ALSO } = await importKit("runtime/regression/findings.mjs");
  const { friendlyStep } = await importKit("runtime/regression/step-label.mjs");
  const chosen = (manifest.tests ?? []).filter((t) => !testId || t.id === testId);
  if (!chosen.length) return { ok: false, published: [], message: "No hay pruebas de esa corrida para publicar." };

  const published: PublishedItem[] = [];
  for (const t of chosen) {
    const descriptionHtml = renderRegressionFindings({ system: manifest.system, suite: manifest.suite, test: t, stamp: manifest.stamp, url: target.baseUrl });
    const attach = t.report ? path.join(runDir, t.report) : "";
    // Capturas por paso → INLINE en el cuerpo (Description + Evidences), rotuladas «Paso N — <paso>».
    // El adapter las sube y las referencia por URL (no van a la lista de adjuntos).
    const inlineImages = (t.cases || [])
      .map((c, i) => {
        if (!c.file) return null;
        const action = friendlyStep(c.name, c.op);
        return { file: path.join(runDir, t.dir, c.file), label: `Paso ${i + 1}${action ? ` — ${action}` : ""}`, status: c.status };
      })
      .filter(Boolean);
    try {
      const res = await adapter.createFindingsWorkItem({
        makeTitle: (seq: number) => regressionTitle({ suite: manifest.suite, test: t.name, stamp: manifest.stamp, seq }),
        tags: "Flit Certify; Regresión",
        countTag: "Regresión E2E (Flit Certify)",
        countAlso: REGRESSION_COUNT_ALSO,
        descriptionHtml,
        attachHtml: attach && fs.existsSync(attach) ? attach : null,
        inlineImages,
        inlineIntoEvidence: true,
      });
      if (res?.ok) published.push({ testId: t.id, testName: t.name, ok: true, id: res.id, url: res.url, title: res.title, shots: res.inlineImages ?? inlineImages.length });
      else published.push({ testId: t.id, testName: t.name, ok: false, reason: res?.reason || "No se pudo crear la HU." });
    } catch (e: any) {
      published.push({ testId: t.id, testName: t.name, ok: false, reason: String(e?.message ?? e) });
    }
  }
  return { ok: published.some((p) => p.ok), published };
}
