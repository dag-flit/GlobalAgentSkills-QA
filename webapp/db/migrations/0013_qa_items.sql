-- 0013_qa_items.sql — SEGUIMIENTO QA: tablero de pendientes por tenant (módulo «Seguimiento QA»).
-- Dato del tenant → RLS FORZADA (patrón 0003/0008). Híbrido: un pendiente puede vincularse
-- OPCIONALMENTE a una HU/Feature de Azure DevOps (ado_wi) y a una corrida del kit (link_run_*).
-- Las columnas del vínculo a corrida se crean desde ya para no migrar dos veces (se cablean en la
-- UI en un segundo incremento). Forward-only.

CREATE TABLE IF NOT EXISTS qa_items (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo',        -- todo | doing | blocked | review | done
  priority text NOT NULL DEFAULT 'media',     -- alta | media | baja
  assignee text NOT NULL DEFAULT '',          -- responsable (texto libre; email o nombre)
  ado_wi text NOT NULL DEFAULT '',            -- id de HU/Feature de Azure (opcional)
  link_run_kind text NOT NULL DEFAULT '',     -- '' | run | regression (vínculo a corrida)
  link_run_id text NOT NULL DEFAULT '',
  link_run_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,        -- orden dentro de su columna
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE qa_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_items_status_idx ON qa_items (tenant_id, status, position);
