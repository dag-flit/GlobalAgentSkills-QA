import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { qaItemSchema, qaItemDeleteSchema } from "@/lib/validation/schemas";
import { listQaItems, upsertQaItem, deleteQaItem, getQaItem } from "@/lib/db/qaItemsRepo";
import { diffActivity, logActivity } from "@/lib/db/qaItemThreadRepo";
import { buildNotifications, addNotifications } from "@/lib/db/qaNotificationsRepo";

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
    const before = await getQaItem(d.id); // para el historial de actividad (nuevo vs cambios)
    await upsertQaItem({
      id: d.id, title: d.title, notes: d.notes, status: d.status, priority: d.priority,
      type: d.type, severity: d.severity, labels: d.labels, dueDate: d.dueDate, reporter: d.reporter,
      assignee: d.assignee, adoWi: d.adoWi, linkRunKind: d.linkRunKind, linkRunId: d.linkRunId,
      linkRunMeta: d.linkRunMeta, linkRuns: d.linkRuns, position: d.position,
    });
    await logActivity(d.id, auth.email, diffActivity(before, {
      status: d.status, priority: d.priority, type: d.type, severity: d.severity,
      assignee: d.assignee, title: d.title, dueDate: d.dueDate,
    }));
    await addNotifications(d.id, buildNotifications(before, { title: d.title, status: d.status, assignee: d.assignee }, auth.email));
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
