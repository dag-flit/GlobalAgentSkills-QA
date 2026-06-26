import { NextResponse } from "next/server";
import { findUserByEmail, listMemberships, audit } from "@/lib/db/authRepo";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { parseJson } from "@/lib/validation/parse";
import { loginSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await parseJson(req, loginSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  // Verifica siempre que haya un user; con credenciales malas se responde igual (no se
  // revela si el email existe). El hash scrypt da el costo de tiempo constante natural.
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    return NextResponse.json({ ok: false, error: "Credenciales inválidas." }, { status: 401 });
  }

  const memberships = await listMemberships(user.id);
  const activeTenant = memberships[0]?.tenant_id ?? null;
  await createSession(user.id, activeTenant);
  await audit("login", { email }, activeTenant, user.id);
  return NextResponse.json({
    ok: true,
    tenants: memberships.map((m) => ({ id: m.tenant_id, name: m.tenant_name, role: m.role })),
  });
}
