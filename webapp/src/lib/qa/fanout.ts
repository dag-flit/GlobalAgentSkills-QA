import { getFlow } from "@/lib/db/flowsRepo";
import { hasActionableSteps, type GenResult } from "@/lib/qa/autogen";

// Fan-out de un Feature: recorre sus HU hijas, corre el guion de cada una y publica evidencia en
// cada HU. Se orquesta en la WEBAPP (tiene BD para leer los guiones); el kit corre UN flujo →
// publica en UN WI por vez. Prioridad del guion por HU: (1) el GUARDADO en la HU; si no hay,
// (2) uno AUTOGENERADO desde sus AC (determinista, sin IA). Si tampoco es E2E-able → se salta con
// razón. Así un Feature con HU sin guion guardado igual se prueba de forma autónoma.

export interface FanoutDeps {
  runQaCycle: (opts: any) => Promise<any>;
  getChildren: (id: string) => Promise<any[]>;
  getDeclaredAcs?: (id: string) => Promise<string[]>; // AC declarados de una HU (para su cobertura)
  autogen?: (id: string) => Promise<GenResult>;       // autogenera el guion desde los AC (sin guardado)
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
  hus: Array<{ id: string; title?: string; status: string; origen?: string; report?: any }>;
  results: any[];
  warnings: string[];
  anyFail: boolean;
  anyRun: boolean;
}

export async function runFeatureFanout(featureId: string, deps: FanoutDeps): Promise<FanoutSummary> {
  const { runQaCycle, getChildren, getDeclaredAcs, autogen, profile, env, repoRoot, launchBrowser, vars, emit } = deps;
  const children = await getChildren(featureId);
  emit("info", `Feature ${featureId}: ${children.length} HU hija(s).`);

  const hus: FanoutSummary["hus"] = [];
  const results: any[] = [];
  const warnings: string[] = [];
  let anyFail = false;
  let anyRun = false;

  for (const child of children) {
    const cid = String(child.id);
    // Prioridad: guion GUARDADO; si no hay, AUTOGENERADO desde los AC (determinista, sin IA).
    let steps = await getFlow(cid);
    let origen = "guardado";
    if ((!steps || !steps.length) && autogen) {
      const g = await autogen(cid).catch((e: any) => {
        emit("stderr", `  · autogeneración falló para HU ${cid}: ${e?.message ?? e}`);
        return null;
      });
      if (hasActionableSteps(g)) {
        steps = g!.flow;
        origen = g!.origin === "ia" ? "autogenerado (IA local)" : "autogenerado (determinista)";
        emit("info", `HU ${cid}: sin guion guardado → guion AUTOGENERADO (${g!.origin === "ia" ? "IA local" : "determinista"}) desde sus AC (${g!.flow.length} paso(s)).`);
        for (const n of g!.notes || []) emit("stderr", `  · ${n}`);
      } else {
        const why = (g && g.reason) || "sin guion y sus AC no permiten autogenerar";
        const msg = `HU ${cid}${child.title ? ` (${child.title})` : ""}: ${why} — se salta.`;
        warnings.push(msg);
        emit("stderr", `⚠ ${msg}`);
        hus.push({ id: cid, title: child.title, status: "skipped" });
        continue;
      }
    } else if (!steps || !steps.length) {
      const msg = `HU ${cid}${child.title ? ` (${child.title})` : ""}: sin guion guardado — se salta.`;
      warnings.push(msg);
      emit("stderr", `⚠ ${msg}`);
      hus.push({ id: cid, title: child.title, status: "skipped" });
      continue;
    }
    anyRun = true;
    const declaredAcs = getDeclaredAcs ? await getDeclaredAcs(cid).catch(() => []) : [];
    emit("info", `Ejecutando HU ${cid} (${steps.length} paso(s), guion ${origen})…`);
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
    hus.push({ id: cid, title: child.title, status: failed ? "failed" : "passed", origen, report: summary.report?.local || summary.report });
    emit("result", `HU ${cid}: ${failed ? "❌ falló" : "✅ pasó"} (guion ${origen}).`);
  }

  return { fanout: true, feature: featureId, hus, results, warnings, anyFail, anyRun };
}
