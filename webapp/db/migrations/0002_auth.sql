-- 0002_auth.sql — Auth propia + modelo de TENANT (organización). Sesiones opacas
-- server-side (revocación inmediata). El aislamiento por RLS llega en F6 (0003);
-- aquí se establece la identidad. gen_random_uuid() es nativo en PG13+ (sin pgcrypto).

CREATE TABLE IF NOT EXISTS tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Un usuario pertenece a N tenants con un rol por tenant.
CREATE TABLE IF NOT EXISTS memberships (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

-- Sesiones opacas: se guarda SOLO sha256(token), nunca el token. tenant_id = tenant activo.
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text UNIQUE NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id    uuid REFERENCES tenants (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Bitácora de auditoría (login, cambios sensibles). tenant_id/user_id nullable (eventos
-- de sistema o pre-login).
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid,
  user_id    uuid,
  action     text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);
