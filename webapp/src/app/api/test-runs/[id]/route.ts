import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { getRun } from "@/lib/db/qaTestRunsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detalle de una corrida: la corrida + los resultados por caso (con snapshot de pasos). Acotado por RLS.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenantScope(async () => {
    const { run, results } = await getRun(id);
    if (!run) return NextResponse.json({ ok: false, error: "Corrida no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true, run, results });
  });
}
