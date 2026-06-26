import { NextResponse } from "next/server";
import { withSystem } from "@/lib/db/tx";
import { createTenantWithOwner, audit } from "@/lib/db/authRepo";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { parseJson } from "@/lib/validation/parse";
import { registerSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // quita diacríticos (tildes/ñ → n)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

/** Crea una organización (tenant) + su usuario owner y abre sesión. */
export async function POST(req: Request) {
  const parsed = await parseJson(req, registerSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const { tenantName, email, password, userName } = parsed.data;
  try {
    const passwordHash = await hashPassword(password);
    const { userId, tenantId } = await withSystem((c) =>
      createTenantWithOwner(c, {
        tenantName,
        slug: slugify(tenantName),
        email,
        passwordHash,
        userName: userName ?? email.split("@")[0],
      }),
    );
    await createSession(userId, tenantId);
    await audit("register", { email, tenantName }, tenantId, userId);
    return NextResponse.json({ ok: true, tenantId });
  } catch (e: any) {
    if (e?.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "Ese email u organización ya existe." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
