import type { PoolClient } from "pg";
import { query } from "./pool";

// DAL de identidad: usuarios, tenants, memberships, auditoría. Las sesiones viven en
// sessionRepo.ts. Sin scoping por RLS todavía (F6); aquí solo se resuelve la identidad.

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
}

export interface MembershipRow {
  tenant_id: string;
  role: string;
  tenant_name: string;
  tenant_slug: string;
  archived_at: string | null;
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const r = await query<UserRow>(
    "SELECT id, email, password_hash, name FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  return r.rows[0];
}

export async function getUserById(id: string): Promise<UserRow | undefined> {
  const r = await query<UserRow>("SELECT id, email, password_hash, name FROM users WHERE id = $1", [id]);
  return r.rows[0];
}

const MEMBERSHIP_SELECT =
  "SELECT m.tenant_id, m.role, t.name AS tenant_name, t.slug AS tenant_slug, t.archived_at " +
  "FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = $1";

export async function listMemberships(userId: string): Promise<MembershipRow[]> {
  const r = await query<MembershipRow>(`${MEMBERSHIP_SELECT} ORDER BY t.name`, [userId]);
  return r.rows;
}

export async function getMembership(userId: string, tenantId: string): Promise<MembershipRow | undefined> {
  const r = await query<MembershipRow>(`${MEMBERSHIP_SELECT} AND m.tenant_id = $2`, [userId, tenantId]);
  return r.rows[0];
}

/** Registro: crea tenant + usuario owner + membership en una transacción. */
export async function createTenantWithOwner(
  c: PoolClient,
  args: { tenantName: string; slug: string; email: string; passwordHash: string; userName: string },
): Promise<{ userId: string; tenantId: string }> {
  const t = await c.query("INSERT INTO tenants(name, slug) VALUES($1, $2) RETURNING id", [
    args.tenantName,
    args.slug,
  ]);
  const tenantId = t.rows[0].id as string;
  const u = await c.query(
    "INSERT INTO users(email, password_hash, name) VALUES($1, $2, $3) RETURNING id",
    [args.email, args.passwordHash, args.userName],
  );
  const userId = u.rows[0].id as string;
  await c.query("INSERT INTO memberships(user_id, tenant_id, role) VALUES($1, $2, 'owner')", [
    userId,
    tenantId,
  ]);
  return { userId, tenantId };
}

/** Crea un PROYECTO nuevo (tenant) y hace al usuario EXISTENTE su owner, en una transacción. */
export async function createTenantForUser(
  c: PoolClient,
  args: { tenantName: string; slug: string; userId: string },
): Promise<{ tenantId: string }> {
  const t = await c.query("INSERT INTO tenants(name, slug) VALUES($1, $2) RETURNING id", [
    args.tenantName,
    args.slug,
  ]);
  const tenantId = t.rows[0].id as string;
  await c.query("INSERT INTO memberships(user_id, tenant_id, role) VALUES($1, $2, 'owner')", [
    args.userId,
    tenantId,
  ]);
  return { tenantId };
}

export async function getTenant(tenantId: string): Promise<{ id: string; name: string } | undefined> {
  const r = await query<{ id: string; name: string }>("SELECT id, name FROM tenants WHERE id = $1", [tenantId]);
  return r.rows[0];
}

/** Renombra un proyecto (tenant). El caller valida que el usuario sea owner. */
export async function renameTenant(tenantId: string, name: string): Promise<void> {
  await query("UPDATE tenants SET name = $2 WHERE id = $1", [tenantId, name]);
}

/** Marca un proyecto como terminado (archived_at = now) o lo reactiva (NULL). */
export async function setTenantArchived(tenantId: string, archived: boolean): Promise<void> {
  await query("UPDATE tenants SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [tenantId, archived]);
}

/** Elimina un proyecto y TODO su contenido (cascada por las FK a tenants). Solo owner (validado antes). */
export async function deleteTenant(tenantId: string): Promise<void> {
  await query("DELETE FROM tenants WHERE id = $1", [tenantId]);
}

/** Bitácora best-effort: un fallo de auditoría no debe romper la operación principal. */
export async function audit(
  action: string,
  detail: unknown,
  tenantId?: string | null,
  userId?: string | null,
): Promise<void> {
  await query(
    "INSERT INTO audit_log(tenant_id, user_id, action, detail) VALUES($1, $2, $3, $4)",
    [tenantId ?? null, userId ?? null, action, detail ? JSON.stringify(detail) : null],
  ).catch(() => {});
}
