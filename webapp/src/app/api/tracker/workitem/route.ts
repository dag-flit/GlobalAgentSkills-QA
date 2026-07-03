import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { loadConfig } from "@/lib/config";
import { trackerEnv } from "@/lib/qa/tracker";
import { importKit } from "@/lib/qa/kit";
import { KIT_ROOT } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tracker/workitem?wid=<id> → datos de la HU/Feature SOLO PARA MOSTRAR (solo lectura):
// { id, title, type, state, acceptance_criteria: [{title, detail}] }. Sirve para ver los criterios
// de aceptación al armar el guion; NO cambia el guion ni la corrida. Requiere Azure con credenciales
// (usa la config guardada del tenant; el PAT nunca viaja al navegador). Local no tiene AC → 400.
export async function GET(req: Request) {
  const wid = new URL(req.url).searchParams.get("wid")?.trim() || "";
  if (!wid) return NextResponse.json({ ok: false, error: "Falta 'wid'." }, { status: 400 });

  return withTenantScope(async () => {
    const cfg = await loadConfig();
    if (cfg.tracker.selected !== "azure-devops") {
      return NextResponse.json(
        { ok: false, error: "Los criterios de aceptación solo están disponibles con Azure DevOps." },
        { status: 400 },
      );
    }
    const env = trackerEnv(cfg.tracker);
    const { getAdapter } = await importKit("core/tracker-adapter/index.mjs");
    const adapter = getAdapter({ profile: { tracker: "azure-devops" }, env, repoRoot: KIT_ROOT });
    try {
      const wi = await adapter.getWorkItem(wid);
      if (!wi) {
        return NextResponse.json({ ok: false, error: `No se encontró el work item ${wid}.` }, { status: 404 });
      }
      const acOf = (x: any) => (Array.isArray(x?.acceptance_criteria) ? x.acceptance_criteria : []);
      const base = {
        ok: true,
        id: wi.id,
        title: wi.title,
        type: wi.type,
        state: wi.state,
        acceptance_criteria: acOf(wi),
      };
      // Feature → además de sus AC propios (raros), trae las HU hijas CON sus AC (mismo criterio
      // que el fan-out: getChildren por [System.Parent], y getWorkItem por hija para sus AC).
      if (wi.type !== "Feature") return NextResponse.json(base);
      const kids = await adapter.getChildren(wid);
      const children = [];
      for (const k of kids) {
        const full = await adapter.getWorkItem(k.id).catch(() => null);
        children.push({ id: String(k.id), title: k.title, type: k.type, state: k.state, acceptance_criteria: acOf(full) });
      }
      return NextResponse.json({ ...base, children });
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message ?? "No se pudo leer el work item." },
        { status: 502 },
      );
    }
  });
}
