import { query } from "./pool";

// DAL de sesiones opacas. Se guarda SOLO sha256(token) (token_hash), nunca el token; así
// una fuga de la BD no permite robar sesiones. La revocación es inmediata (DELETE).

export interface SessionRow {
  id: string;
  user_id: string;
  tenant_id: string | null;
  expires_at: Date;
}

export async function insertSession(
  tokenHash: string,
  userId: string,
  tenantId: string | null,
  expiresAt: Date,
): Promise<void> {
  await query(
    "INSERT INTO sessions(token_hash, user_id, tenant_id, expires_at) VALUES($1, $2, $3, $4)",
    [tokenHash, userId, tenantId, expiresAt.toISOString()],
  );
}

/** Sesión vigente (no expirada) por hash del token. */
export async function findSession(tokenHash: string): Promise<SessionRow | undefined> {
  const r = await query<SessionRow>(
    "SELECT id, user_id, tenant_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    [tokenHash],
  );
  return r.rows[0];
}

export async function setSessionTenant(tokenHash: string, tenantId: string): Promise<void> {
  await query("UPDATE sessions SET tenant_id = $1, last_seen_at = now() WHERE token_hash = $2", [
    tenantId,
    tokenHash,
  ]);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

/** Revoca TODAS las sesiones de un usuario (cambio de contraseña, logout global). */
export async function deleteUserSessions(userId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
