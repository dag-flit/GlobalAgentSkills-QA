-- 0015_qa_item_thread.sql — SEGUIMIENTO QA robusto (incremento B): comentarios + historial de
-- actividad por pendiente (colaboración y auditoría, como Jira/Azure). Datos del tenant → RLS
-- FORZADA (patrón 0003/0013). FK compuesta (tenant_id, item_id) → qa_items: al borrar un pendiente
-- se llevan sus comentarios y su historial. Forward-only.

CREATE TABLE IF NOT EXISTS qa_item_comments (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  item_id text NOT NULL,
  author text NOT NULL DEFAULT '',         -- email/nombre del autor (del contexto de auth)
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES qa_items (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE qa_item_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_item_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_item_comments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_item_comments_item_idx ON qa_item_comments (tenant_id, item_id, created_at);

CREATE TABLE IF NOT EXISTS qa_item_activity (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  item_id text NOT NULL,
  actor text NOT NULL DEFAULT '',           -- quién hizo el cambio
  action text NOT NULL,                     -- created | field | comment
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, -- { field, from, to } cuando action = 'field'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES qa_items (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE qa_item_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_item_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_item_activity
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_item_activity_item_idx ON qa_item_activity (tenant_id, item_id, created_at);
