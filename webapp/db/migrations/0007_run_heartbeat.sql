-- 0007_run_heartbeat.sql — liveness de las corridas para detectar HUÉRFANAS.
-- `runs` ya trae tenant_id + FORCE ROW LEVEL SECURITY + policy desde 0003 → la columna nueva hereda
-- el aislamiento por tenant sin policy nueva. Forward-only e idempotente.
--
-- heartbeat_at = el último "sigo viva" que escribe el proceso que ejecuta la corrida (cada ~15s). Una
-- corrida `running` con heartbeat viejo (o sin heartbeat y con inicio hace rato) = su proceso murió
-- antes de finalizarla (huérfana, p.ej. un reinicio del servidor). La reconciliación PEREZOSA la cierra
-- como error cuando el tenant lee sus corridas (dentro de withTenant → respeta RLS; no hay barrido global).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
