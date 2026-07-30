-- 0010_regression_runs.sql — HISTÓRICO de corridas de regresión (una fila por corrida de SUITE
-- completa) para ver la TENDENCIA por prueba y detectar pruebas inestables/recurrentes. Dato del
-- tenant → RLS forzada (patrón 0003). El detalle por prueba vive en jsonb. Forward-only.
-- No guarda credenciales ni evidencia: solo el veredicto por prueba + la categoría del fallo.

CREATE TABLE IF NOT EXISTS regression_runs (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  target_id text NOT NULL,
  suite_id text NOT NULL,
  suite_name text NOT NULL DEFAULT '',
  system_name text NOT NULL DEFAULT '',
  run_id text NOT NULL,
  total int NOT NULL DEFAULT 0,
  passed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  flaky int NOT NULL DEFAULT 0,
  tests jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ id, name, status, flaky, attempts, kinds:[...] }]
  ran_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS regression_runs_suite_idx
  ON regression_runs (tenant_id, target_id, suite_id, ran_at DESC);

ALTER TABLE regression_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE regression_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON regression_runs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
