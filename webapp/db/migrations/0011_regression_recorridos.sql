-- 0011_regression_recorridos.sql — RECORRIDOS de regresión: el walk-through de un asistente
-- multi-pantalla (Matrícula Inicial, Traspaso…). Un Recorrido tiene ETAPAS ordenadas; el escáner lo
-- camina cosechando cada pantalla y avanzando por el flujo (resuelve las pantallas con URL dinámica
-- tipo hash). Dato del tenant → RLS forzada (patrón 0003). El árbol etapas→avances vive en jsonb; los
-- avances referencian ALIAS del catálogo (no selectores crudos) → sin secretos. Forward-only.

CREATE TABLE IF NOT EXISTS regression_recorridos (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE
    DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::uuid,
  target_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  entry_route text NOT NULL DEFAULT '',
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, advance:[{op, alias?, valor?, ...}] }]
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, target_id, id)
);

ALTER TABLE regression_recorridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE regression_recorridos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON regression_recorridos
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
