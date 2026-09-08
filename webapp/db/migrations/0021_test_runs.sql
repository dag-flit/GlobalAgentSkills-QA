-- 0021_test_runs.sql — MÓDULO «Casos de Prueba» Fase 2: EJECUCIONES (corridas manuales). Una corrida
-- toma los casos de una suite (o todos) y guarda el resultado POR CASO y POR PASO, con SNAPSHOT del
-- caso al momento de correr (título + pasos) → la corrida queda inmutable aunque el caso cambie luego.
-- Dato del tenant → RLS FORZADA (patrón 0003/0013). Forward-only.

CREATE TABLE IF NOT EXISTS qa_test_runs (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  name text NOT NULL,
  suite_id text,                              -- suite ejecutada (NULL = todos los casos)
  status text NOT NULL DEFAULT 'running',     -- running | done
  started_by text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE qa_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_test_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_test_runs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE TABLE IF NOT EXISTS qa_test_results (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  run_id text NOT NULL,
  case_id text NOT NULL,                       -- referencia al caso original (puede borrarse luego)
  case_title text NOT NULL DEFAULT '',         -- SNAPSHOT del título
  ado_wi text NOT NULL DEFAULT '',             -- SNAPSHOT de la HU cubierta (para cobertura)
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,     -- SNAPSHOT de los pasos [{action, expected}]
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb, -- estado por paso: ['untested'|'pass'|'fail'|'blocked'|'skipped']
  status text NOT NULL DEFAULT 'untested',      -- untested | pass | fail | blocked | skipped
  actual_result text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  executed_by text NOT NULL DEFAULT '',
  executed_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES qa_test_runs (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE qa_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_test_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_test_results
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_test_results_run_idx ON qa_test_results (tenant_id, run_id, position);
