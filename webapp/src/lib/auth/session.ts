import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  insertSession,
  findSession,
  deleteSession,
  setSessionTenant,
  type SessionRow,
} from "@/lib/db/sessionRepo";
import { SESSION_COOKIE } from "./cookie";

// Sesión opaca ligada a una cookie HttpOnly. El token va en la cookie; en la BD solo su
// sha256. Estos helpers tocan el cookie jar → solo se usan desde route handlers / actions.
export { SESSION_COOKIE };
const TTL_MS = 7 * 86400_000; // 7 días

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Crea una sesión para el usuario y fija la cookie. tenantId = tenant activo inicial. */
export async function createSession(userId: string, tenantId: string | null): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TTL_MS);
  await insertSession(hashToken(token), userId, tenantId, expires);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Resuelve la sesión vigente desde la cookie (o null). */
export async function resolveSession(): Promise<SessionRow | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await findSession(hashToken(token))) ?? null;
}

/** Cierra la sesión actual: borra la fila y la cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

/** Cambia el tenant activo de la sesión actual (validar membership antes en el caller). */
export async function switchSessionTenant(tenantId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await setSessionTenant(hashToken(token), tenantId);
}
