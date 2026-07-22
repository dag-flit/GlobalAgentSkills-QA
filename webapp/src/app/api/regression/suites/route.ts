import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionSuiteSchema } from "@/lib/validation/schemas";
import { listSuites, saveSuite, deleteSuite } from "@/lib/db/regressionSuitesRepo";
import type { RegressionSuite } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/regression/suites?targetId=<id> → { suites } (todas las suites de ese sistema).
export async function GET(req: Request) {
  const targetId = new URL(req.url).searchParams.get("targetId")?.trim() || "";
  if (!targetId) return NextResponse.json({ ok: false, error: "Falta 'targetId'." }, { status: 400 });
  return withTenantScope(async () => NextResponse.json({ suites: await listSuites(targetId) }));
}

// PUT /api/regression/suites → crea/actualiza una suite (upsert, RLS por tenant).
export async function PUT(req: Request) {
  const parsed = await parseJson(req, regressionSuiteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    await saveSuite(parsed.data as RegressionSuite);
    return NextResponse.json({ ok: true });
  });
}

// DELETE /api/regression/suites?targetId=<id>&id=<suite> → elimina una suite.
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId")?.trim() || "";
  const id = url.searchParams.get("id")?.trim() || "";
  if (!targetId || !id) return NextResponse.json({ ok: false, error: "Faltan 'targetId'/'id'." }, { status: 400 });
  return withTenantScope(async () => {
    await deleteSuite(targetId, id);
    return NextResponse.json({ ok: true });
  });
}
