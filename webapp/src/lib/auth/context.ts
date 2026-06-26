import { resolveSession } from "./session";
import { getUserById, getMembership } from "@/lib/db/authRepo";

// Contexto de auth resuelto por petición: identidad + tenant activo + rol en ese tenant.
// Las rutas llaman requireAuth/requireTenant/requireRole; un fallo lanza AuthError con su
// status (401/403) que el handler traduce a respuesta.

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string | null;
  role: string | null;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Contexto actual o null si no hay sesión válida. */
export async function getAuth(): Promise<AuthContext | null> {
  const s = await resolveSession();
  if (!s) return null;
  const user = await getUserById(s.user_id);
  if (!user) return null;
  let role: string | null = null;
  if (s.tenant_id) {
    const m = await getMembership(s.user_id, s.tenant_id);
    role = m?.role ?? null;
  }
  return { userId: user.id, email: user.email, tenantId: s.tenant_id, role };
}

export async function requireAuth(): Promise<AuthContext> {
  const a = await getAuth();
  if (!a) throw new AuthError("No autenticado", 401);
  return a;
}

export async function requireTenant(): Promise<AuthContext & { tenantId: string }> {
  const a = await requireAuth();
  if (!a.tenantId) throw new AuthError("Sin tenant activo", 403);
  return a as AuthContext & { tenantId: string };
}

const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

/** Exige al menos el rol `min` en el tenant activo (owner > admin > member > viewer). */
export async function requireRole(min: "owner" | "admin" | "member" | "viewer"): Promise<
  AuthContext & { tenantId: string }
> {
  const a = await requireTenant();
  if ((RANK[a.role ?? ""] ?? 0) < RANK[min]) {
    throw new AuthError("Permiso insuficiente", 403);
  }
  return a;
}
