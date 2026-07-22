-- 0009_regression_suites.sql — SUITES de regresión (colección de pruebas) por sistema. Dato del
-- tenant → RLS forzada (patrón 0003). Reusa el patrón `flows` (0005): el árbol prueba→pasos vive en
-- una columna jsonb. Los pasos referencian ALIAS del catálogo (no selectores crudos) → sin secretos.
-- Forward-only.

CREATE TABLE IF NOT EXISTS regression_suites (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  target_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  tests jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, name, steps:[{op, alias?, valor?, ...}] }]
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, target_id, id)
);

ALTER TABLE regression_suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE regression_suites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON regression_suites
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
