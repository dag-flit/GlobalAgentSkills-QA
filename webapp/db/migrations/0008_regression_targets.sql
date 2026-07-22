-- 0008_regression_targets.sql — SISTEMAS a probar por regresión + su CATÁLOGO de selectores.
-- Dato del tenant → RLS forzada (mismo patrón que 0003: tenant_id por DEFAULT desde el GUC
-- app.current_tenant; policy de aislamiento con USING + WITH CHECK). Multi-sistema desde el día 1:
-- un tenant registra N sistemas.
--
-- Credenciales: si auth_mode='login' se guarda usuario/clave CIFRADOS (AES-256-GCM, secretsMapper,
-- AAD ligado a tenant+campo) — la clave nunca en claro ni viaja al navegador. auth_mode='none' →
-- sistema público, sin credenciales. `catalog` = último escaneo ({baseUrl, authMode, pages:[...]});
-- son selectores, jamás secretos. Forward-only.

CREATE TABLE IF NOT EXISTS regression_targets (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  auth_mode text NOT NULL DEFAULT 'none',
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',            -- cifrado (enc:1:…) si auth_mode='login'; '' si none
  catalog jsonb NOT NULL DEFAULT '{}'::jsonb,   -- catálogo de selectores del último escaneo
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE regression_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE regression_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON regression_targets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
