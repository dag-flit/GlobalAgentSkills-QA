import { getFlow } from "@/lib/db/flowsRepo";

// Fan-out de un Feature: recorre sus HU hijas, corre el guion GUARDADO de cada una y publica
// evidencia en cada HU. Se orquesta en la WEBAPP (tiene BD para leer los guiones); el kit corre UN
// flujo → publica en UN WI por vez. Una HU sin guion guardado se SALTA con aviso claro. NO se
// inventan pruebas a ciegas desde los AC ni con IA (eso producía "teatro" que corría sin validar
// de verdad); el QUÉ probar de cada HU lo aporta el brief PR-driven / el guion armado por el humano.

export interface FanoutDeps {
  runQaCycle: (opts: any) => Promise<any>;
  getChildren: (id: string) => Promise<any[]>;
  getDeclaredAcs?: (id: string) => Promise<string[]>; // AC declarados de una HU (para su cobertura)
  profile: any;
  env: Record<string, string>;
  repoRoot: string;
  launchBrowser?: () => Promise<any>;
  vars: Record<string, string>;
  appUrl?: string; // URL adjunta a la corrida: habilita el login-smoke en HU frontend SIN guion
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
  backendSkipped: number; // HU backend saltadas (no aplican E2E por navegador)
  frontendNoGuion: number; // HU frontend sin guion guardado (se pueden armar)
}

/** ¿La HU es backend (prefijo [BACKEND] en el título)? Esas NO se prueban por navegador (E2E). */
function isBackendHu(title = ""): boolean {
  return /\[\s*backend\s*\]/i.test(title) && !/\[\s*frontend\s*\]/i.test(title);
}

export async function runFeatureFanout(featureId: string, deps: FanoutDeps): Promise<FanoutSummary> {
  const { runQaCycle, getChildren, getDeclaredAcs, profile, env, repoRoot, launchBrowser, vars, appUrl, emit } = deps;
  const children = await getChildren(featureId);
  emit("info", `Feature ${featureId}: ${children.length} HU hija(s).`);

  const hus: FanoutSummary["hus"] = [];
  const results: any[] = [];
  const warnings: string[] = [];
  let anyFail = false;
  let anyRun = false;
  let backendSkipped = 0;
  let frontendNoGuion = 0;

  for (const child of children) {
    const cid = String(child.id);
    // Solo corre el guion GUARDADO de la HU. Sin guion → se salta con aviso (no se inventa nada).
    const steps = await getFlow(cid);
    const origen = "guardado";
    if (!steps || !steps.length) {
      // Distinguir: una HU backend NO aplica E2E por navegador (no le falta un guion, no se prueba
      // así); una HU frontend sin guion SÍ se puede armar (o generar el andamiaje) y guardar.
      if (isBackendHu(child.title)) {
        backendSkipped++;
        const msg = `HU ${cid}${child.title ? ` (${child.title})` : ""}: es backend — no se valida por navegador (E2E), se omite.`;
        warnings.push(msg);
        emit("stderr", `• ${msg}`);
        hus.push({ id: cid, title: child.title, status: "skipped", origen: "backend (no E2E)" });
        continue;
      }
      // Frontend SIN guion, pero con URL adjunta a la corrida → login-smoke: el motor abre la URL,
      // inicia sesión (si hay ${QA_USER}/${QA_PASS}) y captura por paso. NO valida AC (para eso hace
      // falta un guion armado); es evidencia honesta de que la app abre y el login funciona, y se
      // etiqueta como tal. Sin URL → se salta como antes (no se inventa nada).
      if (appUrl) {
        anyRun = true;
        const hasCreds = Boolean(vars.QA_USER && vars.QA_PASS);
        const origenSmoke = hasCreds ? "login+captura (sin guion)" : "smoke de URL (sin guion)";
        const declaredAcsSmoke = getDeclaredAcs ? await getDeclaredAcs(cid).catch(() => []) : [];
        emit("info", `HU ${cid}: sin guion → ${origenSmoke} sobre ${appUrl}…`);
        const summary = await runQaCycle({
          repoRoot, env, profile, workItemId: cid, appUrl, vars, tcId: cid,
          declaredAcs: declaredAcsSmoke, explore: true, launchBrowser,
        });
        for (const w of summary.warnings || []) emit("stderr", `⚠ [HU ${cid}] ${w}`);
        const childResults = summary.results || [];
        for (const r of childResults) results.push({ ...r, hu_id: cid });
        const failed = childResults.filter((r: any) => r.status === "fail").length > 0;
        if (failed) anyFail = true;
        hus.push({ id: cid, title: child.title, status: failed ? "failed" : "passed", origen: origenSmoke, report: summary.report?.local || summary.report });
        emit("result", `HU ${cid}: ${failed ? "❌ falló" : "✅ pasó"} (${origenSmoke}).`);
        continue;
      }
      frontendNoGuion++;
      const msg = `HU ${cid}${child.title ? ` (${child.title})` : ""}: sin guion guardado — armá uno (o usá «🧩 Generar andamiaje» en el paso «Desde un PR») y guardalo en la HU.`;
      warnings.push(msg);
      emit("stderr", `⚠ ${msg}`);
      hus.push({ id: cid, title: child.title, status: "skipped", origen: "sin guion" });
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

  return { fanout: true, feature: featureId, hus, results, warnings, anyFail, anyRun, backendSkipped, frontendNoGuion };
}
