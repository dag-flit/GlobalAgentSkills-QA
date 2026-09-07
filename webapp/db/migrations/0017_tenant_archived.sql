-- 0017_tenant_archived.sql — PROYECTOS: permite marcar un proyecto como TERMINADO (archivado) sin
-- borrarlo. `tenants` es tabla de identidad (no lleva RLS por tenant); solo se agrega una columna.
-- archived_at NULL = activo; con fecha = terminado. Forward-only e idempotente.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
