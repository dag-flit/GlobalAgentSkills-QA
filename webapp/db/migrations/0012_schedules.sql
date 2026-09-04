-- 0012_schedules.sql — PROGRAMACIÓN de corridas de regresión (PRO #4) + auth de servicio.
-- Dos tablas, ambas DATO DEL TENANT → RLS FORZADA (patrón 0003/0008). SIN barrido global entre
-- tenants: un disparador externo (cron de la VPS o workflow programado de GitHub Actions) llama a
-- POST /api/schedule/tick con {tenantId, token}. El endpoint abre el contexto del tenant reclamado
-- y valida el token DENTRO de la RLS (un token solo es visible en su propio tenant) → el par
-- (tenantId, token) es la credencial de servicio: sin sesión de usuario y sin lectura cruzada.
-- Forward-only.

-- Token de servicio (mínimo privilegio: solo dispara /schedule/tick). Se guarda SOLO sha256
-- (token_hash), nunca el token en claro (mismo patrón que sessions). Revocable (revoked_at).
CREATE TABLE IF NOT EXISTS scheduler_tokens (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE scheduler_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scheduler_tokens
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Horarios: qué suite de qué sistema corre y con qué cadencia. next_run_at = instante (UTC) de la
-- próxima corrida; el tick corre los vencidos (enabled AND next_run_at <= now) y recomputa next_run_at
-- desde la cadencia. FK a regression_targets → borrar un sistema borra sus horarios. La suite se valida
-- en runtime (getSuite) por si se renombró/borró.
CREATE TABLE IF NOT EXISTS schedules (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  target_id text NOT NULL,
  suite_id text NOT NULL,
  cadence jsonb NOT NULL,               -- {kind:'hourly'|'daily'|'weekly', everyHours?, time?, weekday?, tz?}
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_run_id text,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, target_id) REFERENCES regression_targets (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schedules
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS schedules_due_idx ON schedules (tenant_id, enabled, next_run_at);
