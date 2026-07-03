-- 0005_flows.sql — GUIONES E2E persistidos POR HU (work item). Es dato del tenant → RLS forzada,
-- mismo patrón que 0003 (tenant_id por DEFAULT desde el GUC app.current_tenant; policy de
-- aislamiento con USING + WITH CHECK). Los guiones NO guardan credenciales: los pasos referencian
-- ${QA_USER}/${QA_PASS} y los valores reales son efímeros por corrida (nunca se persisten aquí).

CREATE TABLE IF NOT EXISTS flows (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  work_item_id text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_item_id)
);

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON flows
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
