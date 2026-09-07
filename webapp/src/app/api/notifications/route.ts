import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { notificationReadSchema } from "@/lib/validation/schemas";
import { listForUser, markRead } from "@/lib/db/qaNotificationsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notificaciones in-app del usuario en el proyecto activo (acotadas por RLS + por recipient = su email).
// GET → lista + conteo sin leer. POST { id? } → marca una como leída, o todas si no se pasa id.
export async function GET() {
  return withTenantScope(async (auth) =>
    NextResponse.json({ ok: true, ...(await listForUser(auth.email)) }),
  );
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, notificationReadSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    await markRead(auth.email, parsed.data.id ?? null);
    return NextResponse.json({ ok: true });
  });
}
