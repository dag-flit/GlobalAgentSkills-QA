import { importKit } from "./kit";
import { loadConfig } from "@/lib/config";
import { buildProfile, buildEnv } from "./runner";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { importAdoItems, listAdoWorkItemIds, type AdoImportRow } from "@/lib/db/qaItemsRepo";
import type { QaType } from "@/lib/db/qaItemsRepo";

// Puente webapp → adapter azure del tenant para IMPORTAR work items de ADO al tablero de Seguimiento.
// Una vía (solo LECTURA de ADO). El PAT vive en el server (nunca al navegador). El WIQL se acota al
// PROYECTO configurado (endpoint del client). Los valores de usuario se escapan para WIQL.

export type AdoQuery = { states?: string[]; types?: string[]; areaPath?: string; iterationPath?: string };
export type AdoImportRequest =
  | { mode: "ids"; ids: string[] }
  | { mode: "children"; parentId: string }
  | ({ mode: "query" } & AdoQuery);

interface AdoWi { id: string; title: string; type: string; state: string; assignee: string; url: string }

const LIMIT = 200; // tope de seguridad por import (se avisa si se alcanza)
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`; // literal WIQL seguro
const inList = (xs: string[]) => xs.map(q).join(", ");
// Estados TERMINALES que NO se traen por defecto (a menos que el usuario pida esos estados explícitamente).
const TERMINAL_EXCLUDE = "[System.State] NOT IN ('Closed', 'Removed')";

function mapType(adoType: string): QaType {
  const t = (adoType || "").toLowerCase();
  if (t.includes("bug")) return "bug";
  if (t.includes("test case")) return "test";
  if (t.includes("user story") || t.includes("historia") || t.includes("product backlog") || t.includes("issue") || t.includes("feature") || t.includes("epic")) return "story";
  if (t.includes("task")) return "task";
  return "task"; // fallback; el tipo REAL de ADO queda en ado_type y se muestra verbatim en la UI
}

function hasQueryFilter(qy: AdoQuery): boolean {
  return Boolean(qy.types?.length || qy.states?.length || qy.areaPath?.trim() || qy.iterationPath?.trim());
}

function buildWiql(req: AdoImportRequest): string {
  const base = "SELECT [System.Id] FROM WorkItems WHERE ";
  if (req.mode === "children") return `${base}[System.Parent] = ${Number(req.parentId) || 0}`;
  if (req.mode === "ids") {
    const ids = req.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    return `${base}[System.Id] IN (${ids.join(", ") || "0"})`;
  }
  const clauses: string[] = [];
  // Estado: si el usuario lo especifica, se respeta; si no, se EXCLUYEN los terminales (no trae Closed).
  clauses.push(req.states?.length ? `[System.State] IN (${inList(req.states)})` : TERMINAL_EXCLUDE);
  if (req.types?.length) clauses.push(`[System.WorkItemType] IN (${inList(req.types)})`);
  if (req.areaPath?.trim()) clauses.push(`[System.AreaPath] UNDER ${q(req.areaPath.trim())}`);
  if (req.iterationPath?.trim()) clauses.push(`[System.IterationPath] UNDER ${q(req.iterationPath.trim())}`);
  return base + clauses.join(" AND ");
}

export async function getAzureAdapter() {
  const cfg = await loadConfig();
  if (cfg.tracker.selected !== "azure-devops") {
    throw new Error("Importar de ADO requiere el tracker Azure DevOps configurado en Ajustes.");
  }
  ensureDataDirs();
  const profile = await buildProfile("azure-devops");
  const env = await buildEnv(cfg);
  const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
  return getAdapter({ profile, env, repoRoot: DATA_DIR });
}

function toRows(items: AdoWi[]): AdoImportRow[] {
  return items.map((w) => ({
    adoWi: String(w.id), title: w.title || `WI ${w.id}`, localType: mapType(w.type),
    adoType: w.type || "", adoState: w.state || "", assignee: w.assignee || "", url: w.url || "",
  }));
}

/** Importa (o refresca) los work items de ADO que resuelve el WIQL del pedido. */
export async function runAdoImport(req: AdoImportRequest): Promise<{ ok: boolean; fetched: number; created: number; updated: number; capped: boolean; error?: string }> {
  try {
    if (req.mode === "query" && !hasQueryFilter(req)) {
      return { ok: false, fetched: 0, created: 0, updated: 0, capped: false, error: "Elegí al menos un filtro (tipo, estado, área o sprint). Sin filtros la consulta traería demasiados work items." };
    }
    const adapter = await getAzureAdapter();
    const items: AdoWi[] = await adapter.queryWorkItems(buildWiql(req), LIMIT);
    const capped = items.length >= LIMIT;
    if (!items.length) return { ok: true, fetched: 0, created: 0, updated: 0, capped: false };
    const { created, updated } = await importAdoItems(toRows(items));
    return { ok: true, fetched: items.length, created, updated, capped };
  } catch (e: any) {
    return { ok: false, fetched: 0, created: 0, updated: 0, capped: false, error: e?.message ?? String(e) };
  }
}

/** «Actualizar desde ADO»: re-lee los work items ya importados y refresca su título/estado/asignado. */
export async function resyncAdoItems(): Promise<{ ok: boolean; fetched: number; updated: number; error?: string }> {
  try {
    const ids = await listAdoWorkItemIds();
    if (!ids.length) return { ok: true, fetched: 0, updated: 0 };
    const adapter = await getAzureAdapter();
    const items: AdoWi[] = await adapter.queryWorkItems(buildWiql({ mode: "ids", ids }));
    const { updated } = await importAdoItems(toRows(items));
    return { ok: true, fetched: items.length, updated };
  } catch (e: any) {
    return { ok: false, fetched: 0, updated: 0, error: e?.message ?? String(e) };
  }
}
