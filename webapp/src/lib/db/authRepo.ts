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
  "SELECT m.tenant_id, m.role, t.name AS tenant_name, t.slug AS tenant_slug " +
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
