import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { qaItemSchema, qaItemDeleteSchema } from "@/lib/validation/schemas";
import { listQaItems, upsertQaItem, deleteQaItem } from "@/lib/db/qaItemsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () =>
  NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });

// Tablero de Seguimiento QA. GET → lista los pendientes del tenant. PUT → crea/actualiza (upsert).
// DELETE → elimina. Todo acotado al tenant por RLS (withTenantScope); escrituras: rol member+.
export async function GET() {
  return withTenantScope(async () => NextResponse.json({ ok: true, items: await listQaItems() }));
}

export async function PUT(req: Request) {
  const parsed = await parseJson(req, qaItemSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await upsertQaItem({
      id: d.id, title: d.title, notes: d.notes, status: d.status, priority: d.priority,
      assignee: d.assignee, adoWi: d.adoWi, linkRunKind: d.linkRunKind, linkRunId: d.linkRunId,
      linkRunMeta: d.linkRunMeta, position: d.position,
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  const parsed = await parseJson(req, qaItemDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await deleteQaItem(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
