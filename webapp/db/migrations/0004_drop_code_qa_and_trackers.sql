-- 0004_drop_code_qa_and_trackers.sql — purga de columnas OBSOLETAS tras acotar el producto a
-- "Explorar una URL" (E2E) con tracker local/azure. Se retiraron el modo "QA del código" y los
-- trackers Jira/GitHub, así que sus columnas quedaron muertas. Idempotente (IF EXISTS).
-- No toca tenant_id ni las políticas RLS (son columnas de datos, no de aislamiento).

-- Trackers retirados: Jira / GitHub.
ALTER TABLE tracker_config
  DROP COLUMN IF EXISTS github,
  DROP COLUMN IF EXISTS jira;

-- Inputs del modo "QA del código" (Feature/HUs/capas), que la exploración de URL no usa.
ALTER TABLE runs
  DROP COLUMN IF EXISTS feature_id,
  DROP COLUMN IF EXISTS hu_ids,
  DROP COLUMN IF EXISTS layers;
