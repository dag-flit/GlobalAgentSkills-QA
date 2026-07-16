import { importKit } from "./kit";
import { loadConfig } from "@/lib/config";
import { buildProfile, buildEnv } from "./runner";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";

// Puente webapp → pipeline PR-driven del kit (runtime/pr/*). Lee un PR de GitHub, resuelve las HU
// vinculadas, trae sus AC de Azure (adapter del tenant, el PAT nunca sale al navegador) y arma el
// BRIEF de validación (qué probar, más allá del happy path). Determinista, sin IA. El token de
// GitHub es opcional y vive SOLO en el server (GITHUB_TOKEN); nunca viaja al cliente.

export interface HuWithAcs {
  id: string;
  title: string;
  acs: Array<{ title: string; detail?: string }>;
}

export interface DetectedWi { id: string; title: string; type: string }
export interface Detected {
  features: DetectedWi[]; // work items que ADO confirma como Feature
  hus: HuWithAcs[]; // work items que ADO confirma como User Story (con sus AC)
  other: DetectedWi[]; // otros tipos (Task/Bug…) — no son objetivo del brief
  notFound: number[]; // candidatos que ADO no reconoce (p.ej. un nº que no era work item)
}

export interface Scaffold { huId: string | null; flow: Array<Record<string, any>>; notes: string[] }

export interface PrBriefResult {
  pr: { number: number; title: string; branch: string; author: string; state: string; merged: boolean; candidates: number[]; featureHint: number | null; url: string };
  detected: Detected; // clasificación AUTORITATIVA por el `type` real de ADO (no por el título del PR)
  hus: HuWithAcs[]; // = detected.hus (las HU con AC para las que se arma el brief)
  scaffold: Scaffold | null; // esqueleto de guion determinista de la HU primaria (para completar)
  markdown: string;
  html: string;
  tracker: string;
  warnings: string[];
}

/** Extrae el número de PR de una URL de GitHub (…/pull/NNN) o de un "#NNN"/número suelto. */
function prNumberFrom(url: string): number | null {
  const m = String(url).match(/\/pull\/(\d+)/) || String(url).match(/[#/](\d+)(?:$|\D)/) || String(url).match(/\b(\d{1,7})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Analiza los cambios que ROMPEN el contrato OpenAPI del PR (modo PR/E2E; determinista, sin binarios).
 * El lector de contenidos (base vs head) va por el http del kit; el YAML se parsea con `yaml` (webapp).
 * Best-effort: si algo falla, devuelve null y el brief sale sin la sección de contrato. Nota: SOLO se usa
 * en el modo PR; la QA de código nunca llama a esto.
 */
async function computeApiDiff(repo: { owner: string; repo: string }, pr: any, token: string): Promise<any> {
  try {
    const specs = (pr.changedFiles || []).filter((f: any) => typeof (f?.filename ?? f) === "string");
    const { readFileAtRef } = await importKit("runtime/pr/pr-reader.mjs");
    const { analyzeApiBreaking, isOpenapiSpecPath } = await importKit("runtime/pr/openapi-diff.mjs");
    if (!specs.some((f: any) => isOpenapiSpecPath(f?.filename ?? f))) return null; // el PR no toca ningún OpenAPI
    const YAML: any = await import("yaml");
    const parseYaml = (t: string) => YAML.parse(t);
    const readFile = (path: string, which: "base" | "head") =>
      readFileAtRef({ owner: repo.owner, repo: repo.repo, path, ref: which === "base" ? pr.baseSha : pr.headSha, token });
    return await analyzeApiBreaking({ changedFiles: pr.changedFiles, readFile, parseYaml });
  } catch {
    return null;
  }
}

/** Resuelve el PR + AC (si el tracker es Azure) y arma el brief. No publica nada. */
export async function buildPrBrief(prUrl: string): Promise<PrBriefResult> {
  const cfg = await loadConfig();
  const tracker = cfg.tracker.selected;
  const warnings: string[] = [];

  const { parseRepoUrl, readPr } = await importKit("runtime/pr/pr-reader.mjs");
  const { generateBrief } = await importKit("runtime/pr/brief.mjs");

  const repo = parseRepoUrl(prUrl);
  const number = prNumberFrom(prUrl);
  if (!repo || !number) throw new Error("URL de PR inválida. Esperado: https://github.com/<owner>/<repo>/pull/<número>.");

  const token = process.env.GITHUB_TOKEN || "";
  const pr = await readPr({ owner: repo.owner, repo: repo.repo, number, token });

  // Clasificación AUTORITATIVA: para cada CANDIDATO (rama + marcadores explícitos, sin el nº del PR)
  // le preguntamos a ADO su `type` REAL → Feature vs User Story vs otro. NO se adivina por el título.
  const detected: Detected = { features: [], hus: [], other: [], notFound: [] };
  if (tracker === "azure-devops") {
    ensureDataDirs();
    const profile = await buildProfile(tracker);
    const env = await buildEnv(cfg);
    const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
    const adapter = getAdapter({ profile, env, repoRoot: DATA_DIR });
    for (const id of pr.candidates) {
      const wi = await adapter.getWorkItem(String(id)).catch(() => null);
      if (!wi) { detected.notFound.push(id); continue; }
      if (/feature/i.test(wi.type)) detected.features.push({ id: String(id), title: wi.title, type: wi.type });
      else if (/user story|historia/i.test(wi.type)) detected.hus.push({ id: String(id), title: wi.title, acs: wi.acceptance_criteria || [] });
      else detected.other.push({ id: String(id), title: wi.title, type: wi.type });
    }
    if (!detected.hus.length && !detected.features.length) {
      warnings.push("El PR no vincula ninguna HU/Feature en Azure (¿ajuste en caliente?). El brief sale por áreas de UI. Podés indicar la HU manualmente.");
    }
  } else {
    // Sin ADO: best-effort NO autoritativo (para preview). El usuario confirma la HU en la UI.
    detected.hus = pr.hus.map((id: number) => ({ id: String(id), title: "", acs: [] }));
    if (pr.feature != null) detected.features.push({ id: String(pr.feature), title: "", type: "Feature" });
    warnings.push("Tracker local: la clasificación HU/Feature NO está confirmada en Azure (best-effort). El brief sale por áreas de UI.");
  }

  // El brief usa las HU CONFIRMADAS por ADO + el Feature confirmado para el encabezado.
  const prForBrief = {
    ...pr,
    feature: detected.features[0] ? Number(detected.features[0].id) : null,
    hus: detected.hus.map((h) => Number(h.id)),
    primaryHu: detected.hus[0] ? Number(detected.hus[0].id) : null,
  };
  // Breaking-change del contrato OpenAPI (si el PR tocó un spec) → sección en el brief (MD/HTML).
  const apiDiff = await computeApiDiff(repo, pr, token);
  if (apiDiff && apiDiff.totals?.breaking) warnings.push(`El PR incluye ${apiDiff.totals.breaking} cambio(s) que ROMPEN el contrato de la API — priorizá validar regresión de los clientes.`);
  const brief = generateBrief({ pr: prForBrief, husWithAcs: detected.hus, apiDiff });

  // Andamiaje determinista de la HU primaria (esqueleto de guion a completar). Sin HU → null.
  let scaffold: Scaffold | null = null;
  const primary = detected.hus[0];
  if (primary) {
    const { scaffoldFlow } = await importKit("runtime/pr/scaffold.mjs");
    const s = scaffoldFlow({ appUrl: "", acs: primary.acs, login: false, title: primary.title });
    scaffold = { huId: primary.id, flow: s.flow, notes: s.notes };
  }

  return {
    pr: {
      number: pr.number, title: pr.title, branch: pr.branch, author: pr.author, state: pr.state,
      merged: pr.merged, candidates: pr.candidates, featureHint: pr.featureHint, url: pr.url,
    },
    detected,
    hus: detected.hus,
    scaffold,
    markdown: brief.markdown,
    html: brief.html,
    tracker,
    warnings,
  };
}

/** Publica el brief como comentario en una HU de Azure. Devuelve el resultado del adapter. */
export async function publishPrBrief(prUrl: string, workItemId: string): Promise<{ ok: boolean; id?: any; reason?: string }> {
  const cfg = await loadConfig();
  if (cfg.tracker.selected !== "azure-devops") return { ok: false, reason: "Publicar el brief requiere el tracker Azure DevOps." };

  const { parseRepoUrl, readPr } = await importKit("runtime/pr/pr-reader.mjs");
  const { briefComment } = await importKit("runtime/pr/brief.mjs");
  const repo = parseRepoUrl(prUrl);
  const number = prNumberFrom(prUrl);
  if (!repo || !number) return { ok: false, reason: "URL de PR inválida." };

  const token = process.env.GITHUB_TOKEN || "";
  const pr = await readPr({ owner: repo.owner, repo: repo.repo, number, token });

  ensureDataDirs();
  const profile = await buildProfile("azure-devops");
  const env = await buildEnv(cfg);
  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  const adapter = getAdapter({ profile, env, repoRoot: DATA_DIR });

  // AC de la HU destino (para que el comentario liste los gaps con contexto de AC).
  const wi = await adapter.getWorkItem(workItemId).catch(() => null);
  const hus = [{ id: workItemId, title: wi?.title || "", acs: wi?.acceptance_criteria || [] }];
  const apiDiff = await computeApiDiff(repo, pr, token);
  const html = briefComment({ pr, hus, apiDiff });
  return adapter.commentWorkItem(workItemId, html);
}
