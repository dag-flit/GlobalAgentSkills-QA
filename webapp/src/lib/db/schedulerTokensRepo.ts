import crypto from "node:crypto";
import { withTenant } from "./tx";

// DAL de TOKENS de servicio del scheduler (dato del tenant → withTenant → RLS forzada). Se guarda
// SOLO sha256(token) (mismo patrón que sessions): una fuga de la BD no revela tokens usables, y la
// revocación es inmediata (revoked_at). El token en claro se muestra UNA sola vez, al crearlo.

export interface SchedulerTokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Crea un token para el tenant activo. Devuelve el token EN CLARO una única vez. */
export async function createSchedulerToken(label: string): Promise<{ id: string; token: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  return withTenant(async (c) => {
    const r = await c.query(
      "INSERT INTO scheduler_tokens(token_hash, label) VALUES($1, $2) RETURNING id",
      [hashToken(token), label || ""],
    );
    return { id: r.rows[0].id as string, token };
  });
}

/**
 * ¿El token pertenece al tenant ACTIVO (contexto) y sigue vigente? Como corre bajo withTenant,
 * la RLS solo deja ver los tokens de ESE tenant → un token de otro tenant no aparece (no casa).
 * Actualiza last_used_at. Devuelve el id o null.
 */
export async function consumeSchedulerToken(token: string): Promise<string | null> {
  return withTenant(async (c) => {
    const r = await c.query(
      "SELECT id FROM scheduler_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
      [hashToken(token)],
    );
    const id = r.rows[0]?.id as string | undefined;
    if (!id) return null;
    await c.query("UPDATE scheduler_tokens SET last_used_at = now() WHERE id = $1", [id]);
    return id;
  });
}

export async function listSchedulerTokens(): Promise<SchedulerTokenRow[]> {
  return withTenant(async (c) => {
    const r = await c.query(
      "SELECT id, label, created_at, last_used_at FROM scheduler_tokens WHERE revoked_at IS NULL ORDER BY created_at",
    );
    return r.rows as SchedulerTokenRow[];
  });
}

export async function revokeSchedulerToken(id: string): Promise<void> {
  await withTenant(async (c) => {
    await c.query("UPDATE scheduler_tokens SET revoked_at = now() WHERE id = $1", [id]);
  });
}
