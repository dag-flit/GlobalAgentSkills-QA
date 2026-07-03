-- 0006_ai_config.sql — configuración de IA (asistente de guion) POR TENANT.
-- Se guarda como columna jsonb en tracker_config (1 fila por tenant), que ya trae tenant_id +
-- FORCE ROW LEVEL SECURITY + policy desde 0003 → hereda el aislamiento por tenant sin policy nueva.
-- Forward-only e idempotente. SIN secretos: Ollama es LOCAL (endpoint + modelo), no usa API key.
-- Forma esperada del jsonb: { "enabled": bool, "endpoint": text, "model": text }.
ALTER TABLE tracker_config ADD COLUMN IF NOT EXISTS ai jsonb;
