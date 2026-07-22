import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionTargetSchema } from "@/lib/validation/schemas";
import { listTargets, getTarget, saveTarget, deleteTarget } from "@/lib/db/regressionTargetsRepo";
import { SECRET_MASK, type RegressionTarget } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// La clave NUNCA viaja al navegador: si hay una guardada se envía enmascarada; si no, vacía.
function mask(t: RegressionTarget): RegressionTarget {
  return { ...t, password: t.password ? SECRET_MASK : "" };
}

// GET /api/regression/targets → { targets } (todos los sistemas del tenant, con la clave enmascarada).
export async function GET() {
  return withTenantScope(async () => {
    const targets = (await listTargets()).map(mask);
    return NextResponse.json({ targets });
  });
}

// PUT /api/regression/targets → crea/actualiza un sistema. Si la clave llega enmascarada (no cambió),
// se PRESERVA la guardada (no se clobbea). auth_mode='none' → sin credenciales.
export async function PUT(req: Request) {
  const parsed = await parseJson(req, regressionTargetSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const t = parsed.data as RegressionTarget;
  return withTenantScope(async () => {
    if (t.authMode === "none") {
      t.username = "";
      t.password = "";
    } else if (t.password === SECRET_MASK) {
      // Enmascarada = el usuario no la tocó → conservar la que ya estaba (descifrada del repo).
      const existing = await getTarget(t.id);
      t.password = existing?.password ?? "";
    }
    await saveTarget(t);
    return NextResponse.json({ ok: true });
  });
}

// DELETE /api/regression/targets?id=<id> → elimina un sistema del tenant.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });
  return withTenantScope(async () => {
    await deleteTarget(id);
    return NextResponse.json({ ok: true });
  });
}
