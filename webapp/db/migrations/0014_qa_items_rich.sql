-- 0014_qa_items_rich.sql — SEGUIMIENTO QA robusto (incremento A): campos ricos en qa_items para
-- acercarlo a un tracker serio (tipo Jira / Azure Test Plans). Forward-only e IDEMPOTENTE: solo
-- agrega columnas (ADD COLUMN IF NOT EXISTS) → la RLS/policy de 0013 ya cubre la tabla y sus columnas.
-- No toca datos existentes (defaults sensatos para las filas ya creadas).

ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'task';        -- bug | task | test | improvement
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT '';         -- '' | trivial | menor | mayor | critica (sobre todo para bugs)
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;  -- array de etiquetas (texto)
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS due_date date;                              -- fecha límite (opcional)
ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS reporter text NOT NULL DEFAULT '';          -- quién lo creó (email/nombre)

-- Índice para filtrar/ordenar por tipo dentro del tenant (la vista tabla filtra por tipo).
CREATE INDEX IF NOT EXISTS qa_items_type_idx ON qa_items (tenant_id, type);
