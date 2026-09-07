import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth/context";
import { withSystem } from "@/lib/db/tx";
import {
  createTenantForUser, listMemberships, getMembership, getTenant,
  renameTenant, setTenantArchived, deleteTenant, audit,
} from "@/lib/db/authRepo";
import { switchSessionTenant } from "@/lib/auth/session";
import { parseJson } from "@/lib/validation/parse";
import { projectCreateSchema, projectActionSchema, projectDeleteSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Un PROYECTO es un espacio AISLADO (tenant con RLS): su propia config (ADO, BD, regresión) y su propio
// Seguimiento. GET lista los proyectos del usuario; POST crea uno (se vuelve su owner + lo deja activo);
// PATCH renombra / marca terminado / reactiva; DELETE elimina con confirmación tipeada. Las mutaciones
// exigen ser OWNER del proyecto. La identidad (tenants/memberships) se toca por withSystem.
function slugify(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "proj";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
const err = (msg: string, status = 500) => NextResponse.json({ ok: false, error: msg }, { status });

export async function GET() {
  try {
    const auth = await requireAuth();
    const rows = await listMemberships(auth.userId);
    const projects = rows.map((m) => ({
      id: m.tenant_id, name: m.tenant_name, role: m.role,
      archived: Boolean(m.archived_at), active: m.tenant_id === auth.tenantId,
    }));
    return NextResponse.json({ ok: true, projects });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.status);
    throw e;
  }
}

export async function POST(req: Request) {
  const parsed = await parseJson(req, projectCreateSchema, "ok");
  if (!parsed.ok) return parsed.response;
  try {
    const auth = await requireAuth();
    const { tenantId } = await withSystem((c) =>
      createTenantForUser(c, { tenantName: parsed.data.name, slug: slugify(parsed.data.name), userId: auth.userId }),
    );
    await switchSessionTenant(tenantId);
    await audit("project_create", { name: parsed.data.name }, tenantId, auth.userId);
    return NextResponse.json({ ok: true, tenantId });
  } catch (e: any) {
    if (e instanceof AuthError) return err(e.message, e.status);
    if (e?.code === "23505") return err("Ya existe un proyecto con un nombre muy parecido. Probá otro.", 409);
    return err(e?.message ?? String(e));
  }
}

export async function PATCH(req: Request) {
  const parsed = await parseJson(req, projectActionSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const { tenantId, action, name } = parsed.data;
  try {
    const auth = await requireAuth();
    const m = await getMembership(auth.userId, tenantId);
    if (!m) return err("No perteneces a ese proyecto.", 403);
    if (m.role !== "owner") return err("Solo el propietario puede administrar el proyecto.", 403);
    if (action === "rename") {
      if (!name) return err("Falta el nombre.", 400);
      await renameTenant(tenantId, name);
    } else {
      await setTenantArchived(tenantId, action === "archive");
    }
    await audit(`project_${action}`, { name }, tenantId, auth.userId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof AuthError) return err(e.message, e.status);
    return err(e?.message ?? String(e));
  }
}

export async function DELETE(req: Request) {
  const parsed = await parseJson(req, projectDeleteSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const { tenantId, confirmName } = parsed.data;
  try {
    const auth = await requireAuth();
    const m = await getMembership(auth.userId, tenantId);
    if (!m) return err("No perteneces a ese proyecto.", 403);
    if (m.role !== "owner") return err("Solo el propietario puede eliminar el proyecto.", 403);
    const t = await getTenant(tenantId);
    if (!t) return err("El proyecto no existe.", 404);
    if (confirmName.trim() !== t.name) return err("El nombre no coincide. Escribí el nombre exacto del proyecto para confirmar.", 400);
    await deleteTenant(tenantId); // cascada: se lleva TODO el contenido del proyecto
    // Si el proyecto borrado era el activo, mover la sesión a otro que le quede (o queda sin activo).
    let nextTenant: string | null = null;
    if (auth.tenantId === tenantId) {
      const rest = (await listMemberships(auth.userId)).filter((x) => x.tenant_id !== tenantId);
      nextTenant = rest[0]?.tenant_id ?? null;
      if (nextTenant) await switchSessionTenant(nextTenant);
    }
    await audit("project_delete", { name: t.name }, null, auth.userId);
    return NextResponse.json({ ok: true, nextTenant });
  } catch (e: any) {
    if (e instanceof AuthError) return err(e.message, e.status);
    return err(e?.message ?? String(e));
  }
}
