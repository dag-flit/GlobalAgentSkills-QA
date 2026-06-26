-- 0003_rls.sql — Multitenancy REAL: tenant_id + Row-Level Security en las tablas de datos.
-- Las tablas de auth (tenants/users/memberships/sessions/audit_log) son GLOBALES (sin RLS).
-- No había datos reales (solo el seed single-tenant) → se limpia; cada tenant siembra su
-- config en el primer acceso. tenant_id se llena por DEFAULT desde app.current_tenant (el
-- GUC que fija withTenant), y RLS lo valida (WITH CHECK) → no se puede escribir para otro.
--
-- NULLIF(..., ''): un GUC custom "tocado" devuelve '' (no NULL) tras el reset de la tx;
-- ''::uuid lanza error. NULLIF lo vuelve NULL → tenant ausente = 0 filas (fail-closed),
-- no una excepción.

-- 1) Limpia el seed single-tenant (no pertenece a ningún tenant).
DELETE FROM run_events;
DELETE FROM runs;
DELETE FROM db_connections;
DELETE FROM tracker_config;

-- 2) tenant_id (DEFAULT desde el GUC) en las 4 tablas de datos.
ALTER TABLE db_connections
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
ALTER TABLE runs
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
ALTER TABLE run_events
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid;

-- 3) db_connections: el id es único POR tenant (PK compuesta).
ALTER TABLE db_connections DROP CONSTRAINT db_connections_pkey;
ALTER TABLE db_connections ADD PRIMARY KEY (tenant_id, id);

-- 4) tracker_config: de singleton (id=1) a uno por tenant (PK = tenant_id).
ALTER TABLE tracker_config DROP CONSTRAINT tracker_config_pkey;
ALTER TABLE tracker_config DROP COLUMN id;
ALTER TABLE tracker_config
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
ALTER TABLE tracker_config ADD PRIMARY KEY (tenant_id);

CREATE INDEX IF NOT EXISTS runs_tenant_created_idx ON runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS run_events_tenant_idx ON run_events (tenant_id);

-- 5) RLS activada + FORZADA (ni el dueño de las tablas la evade) con policy de aislamiento.
--    USING filtra lo visible; WITH CHECK impide insertar/actualizar con otro tenant.
DO $rls$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['db_connections', 'tracker_config', 'runs', 'run_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
      tbl
    );
  END LOOP;
END
$rls$;
