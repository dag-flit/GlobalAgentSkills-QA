import { getFlow } from "@/lib/db/flowsRepo";

// Fan-out de un Feature: recorre sus HU hijas, corre el GUION GUARDADO de cada una y publica
// evidencia en cada HU. Se orquesta en la WEBAPP (tiene BD para leer los guiones); el kit corre
// UN flujo → publica en UN WI por vez. La HU sin guion guardado se salta con aviso.

export interface FanoutDeps {
  runQaCycle: (opts: any) => Promise<any>;
  getChildren: (id: string) => Promise<any[]>;
  getDeclaredAcs?: (id: string) => Promise<string[]>; // AC declarados de una HU (para su cobertura)
  profile: any;
  env: Record<string, string>;
  repoRoot: string;
  launchBrowser?: () => Promise<any>;
  vars: Record<string, string>;
  emit: (level: string, msg: string) => void;
}

export interface FanoutSummary {
  fanout: true;
  feature: string;
  hus: Array<{ id: string; title?: string; status: string; report?: any }>;
  results: any[];
  warnings: string[];
  anyFail: boolean;
  anyRun: boolean;
}

export async function runFeatureFanout(featureId: string, deps: FanoutDeps): Promise<FanoutSummary> {
  const { runQaCycle, getChildren, getDeclaredAcs, profile, env, repoRoot, launchBrowser, vars, emit } = deps;
  const children = await getChildren(featureId);
  emit("info", `Feature ${featureId}: ${children.length} HU hija(s).`);

  const hus: FanoutSummary["hus"] = [];
  const results: any[] = [];
  const warnings: string[] = [];
  let anyFail = false;
  let anyRun = false;

  for (const child of children) {
    const cid = String(child.id);
    const steps = await getFlow(cid);
    if (!steps || !steps.length) {
      const msg = `HU ${cid}${child.title ? ` (${child.title})` : ""}: sin guion guardado — se salta.`;
      warnings.push(msg);
      emit("stderr", `⚠ ${msg}`);
      hus.push({ id: cid, title: child.title, status: "skipped" });
      continue;
    }
    anyRun = true;
    const declaredAcs = getDeclaredAcs ? await getDeclaredAcs(cid).catch(() => []) : [];
    emit("info", `Ejecutando HU ${cid} (${steps.length} paso(s))…`);
    const summary = await runQaCycle({
      repoRoot,
      env,
      profile,
      workItemId: cid,
      flow: steps,
      vars,
      tcId: cid,
      declaredAcs,
      explore: true,
      launchBrowser,
    });
    for (const w of summary.warnings || []) emit("stderr", `⚠ [HU ${cid}] ${w}`);
    const childResults = summary.results || [];
    for (const r of childResults) results.push({ ...r, hu_id: cid });
    const failed = childResults.filter((r: any) => r.status === "fail").length > 0;
    if (failed) anyFail = true;
    hus.push({ id: cid, title: child.title, status: failed ? "failed" : "passed", report: summary.report?.local || summary.report });
    emit("result", `HU ${cid}: ${failed ? "❌ falló" : "✅ pasó"}.`);
  }

  return { fanout: true, feature: featureId, hus, results, warnings, anyFail, anyRun };
}
