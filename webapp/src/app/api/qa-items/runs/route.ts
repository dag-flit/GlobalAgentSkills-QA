import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { listRuns } from "@/lib/runStore";
import { listRecentHistoryRuns } from "@/lib/db/regressionHistoryRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/qa-items/runs → corridas recientes del tenant (del kit + de regresión), normalizadas para
// el selector de vínculo de Seguimiento QA. Solo lectura, acotado por RLS (withTenantScope).
export interface RunOption {
  kind: "run" | "regression";
  id: string;
  title: string;
  sub: string;
  status: string;
  when: string;
  href: string | null; // corrida del kit → /runs/[id]; regresión → sin página propia (chip informativo)
}

export async function GET() {
  return withTenantScope(async () => {
    const [kit, regr] = await Promise.all([listRuns(), listRecentHistoryRuns(20)]);

    const kitOpts: RunOption[] = kit.slice(0, 20).map((r) => ({
      kind: "run", id: r.id, title: r.title || r.mode, sub: `${r.mode} · ${r.tracker}`,
      status: r.status, when: r.createdAt, href: `/runs/${r.id}`,
    }));

    const regrOpts: RunOption[] = regr.map((r) => ({
      kind: "regression", id: r.runId, title: `${r.systemName} · ${r.suiteName}`,
      sub: `${r.passed}/${r.total} ok${r.failed ? ` · ${r.failed} en rojo` : ""}`,
      status: r.failed > 0 ? "failed" : "passed", when: r.ranAt, href: null,
    }));

    const runs = [...kitOpts, ...regrOpts]
      .sort((a, b) => (b.when || "").localeCompare(a.when || ""))
      .slice(0, 30);
    return NextResponse.json({ ok: true, runs });
  });
}
