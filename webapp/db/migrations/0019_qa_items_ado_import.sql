-- 0019_qa_items_ado_import.sql — SEGUIMIENTO QA: importar work items de Azure DevOps al tablero (una
-- vía, solo lectura desde ADO). Se marca el ORIGEN del pendiente y se guardan datos de ADO como
-- INFORMATIVOS (el estado local del tablero es independiente del estado de ADO). Forward-only,
-- idempotente (ADD COLUMN IF NOT EXISTS). La RLS/policy de 0013 ya cubre la tabla y sus columnas.

ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local';   -- 'local' | 'ado'
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS ado_state text NOT NULL DEFAULT '';      -- estado en ADO (informativo)
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS ado_type text NOT NULL DEFAULT '';       -- tipo REAL en ADO (Bug/Task/User Story/…)
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS ado_url text NOT NULL DEFAULT '';        -- enlace directo al work item
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS ado_synced_at timestamptz;               -- última sincronización desde ADO

-- Buscar/deduplicar por work item de ADO dentro del proyecto (import y «Actualizar desde ADO»).
CREATE INDEX IF NOT EXISTS qa_items_ado_wi_idx ON qa_items (tenant_id, ado_wi) WHERE ado_wi <> '';
