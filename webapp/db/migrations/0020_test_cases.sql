-- 0020_test_cases.sql — MÓDULO «Casos de Prueba» (Fase 1): casos con PASOS (acción/esperado)
-- organizados en SUITES, por PROYECTO (tenant) → RLS FORZADA (patrón 0003/0013). Base para las
-- ejecuciones (Fase 2) y el import de Azure Test Plans (Fase 3). Forward-only.

CREATE TABLE IF NOT EXISTS qa_test_suites (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE qa_test_suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_test_suites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_test_suites
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE TABLE IF NOT EXISTS qa_test_cases (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  suite_id text,                              -- NULL = sin suite (sin archivar); FK a qa_test_suites
  title text NOT NULL,
  preconditions text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'media',     -- alta | media | baja
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ado_wi text NOT NULL DEFAULT '',            -- HU/Feature de ADO que cubre (opcional)
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ action, expected }]
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, suite_id) REFERENCES qa_test_suites (tenant_id, id) ON DELETE SET NULL
);

ALTER TABLE qa_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_test_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_test_cases
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_test_cases_suite_idx ON qa_test_cases (tenant_id, suite_id, position);
