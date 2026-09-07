-- 0016_qa_notifications.sql — SEGUIMIENTO QA robusto (incremento D): notificaciones in-app por
-- usuario. Dato del tenant → RLS FORZADA (patrón 0003/0013). Aíslan por proyecto (RLS) y además se
-- filtran por `recipient` (email del destinatario) en la API → cada quien ve solo las suyas. Se generan
-- al ASIGNAR un pendiente o al cambiar su estado (si el responsable no fue quien hizo el cambio).
-- FK compuesta a qa_items → al borrar el pendiente se llevan sus notificaciones. Forward-only.

CREATE TABLE IF NOT EXISTS qa_notifications (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  id text NOT NULL,
  recipient text NOT NULL,                  -- email del destinatario (responsable del pendiente)
  item_id text NOT NULL,
  kind text NOT NULL,                       -- assigned | status
  text text NOT NULL,
  read_at timestamptz,                      -- NULL = no leída
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES qa_items (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE qa_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qa_notifications
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE INDEX IF NOT EXISTS qa_notifications_recipient_idx ON qa_notifications (tenant_id, recipient, read_at, created_at);
