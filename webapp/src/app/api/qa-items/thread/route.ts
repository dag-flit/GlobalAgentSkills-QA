import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { qaCommentSchema } from "@/lib/validation/schemas";
import { listThread, addComment } from "@/lib/db/qaItemThreadRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hilo de un pendiente de Seguimiento QA: comentarios + historial de actividad. GET ?itemId → el hilo
// (acotado al proyecto por RLS). POST → agrega un comentario (autor = usuario de la sesión); requiere
// rol member+. La actividad se genera sola (al comentar y al editar el pendiente).
export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get("itemId") ?? "";
  if (!itemId) return NextResponse.json({ ok: false, error: "Falta itemId." }, { status: 400 });
  return withTenantScope(async () => NextResponse.json({ ok: true, ...(await listThread(itemId)) }));
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, qaCommentSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) {
      return NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });
    }
    await addComment({ itemId: parsed.data.itemId, author: auth.email, body: parsed.data.body });
    return NextResponse.json({ ok: true });
  });
}
