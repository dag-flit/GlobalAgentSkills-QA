-- ============================================================================
-- provision.sql — Bootstrap del CONTROL-PLANE del servicio qa-kit (LABORAL / FLIT).
--
-- NOMBRES con prefijo flit_ a propósito: esta es la versión LABORAL atada a FLIT.
--   La futura versión PERSONAL/profesional usará otros nombres (otro control-plane).
--
-- QUÉ ES: la BD propia del SERVICIO (config, conexiones, runs, eventos, y más
--   adelante tenants/usuarios/sesiones). NO confundir con la BD del CLIENTE que el
--   runner `db` prueba (esa llega por DATABASE_URL en cada corrida). Dos planos
--   separados, nunca se mezclan.
--
-- CÓMO CORRERLO (en tu PC, con pgAdmin):
--   1. Abre pgAdmin, conéctate a tu servidor PostgreSQL 18 como superusuario `postgres`.
--   2. Selecciona la base `postgres` → botón derecho → Query Tool.
--   3. Pega TODO este archivo y ejecútalo (F5).
--   4. (Si la base `flit_qa_kit` ya existía y quieres recrearla limpia, descomenta el DROP.)
--
-- SEGURIDAD: el rol `flit_qa_app` es de BAJA PRIVILEGIO (NOSUPERUSER, NOBYPASSRLS).
--   La webapp se conecta SIEMPRE como `flit_qa_app`, nunca como `postgres`. Así, cuando
--   en F6 activemos FORCE ROW LEVEL SECURITY, ni el dueño de las tablas podrá saltarse
--   el aislamiento por tenant.
-- ============================================================================

-- 1) Rol de la aplicación (idempotente). Cambia la contraseña si quieres, pero debe
--    COINCIDIR con la de webapp/.env.local (CONTROL_PLANE_URL).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flit_qa_app') THEN
    CREATE ROLE flit_qa_app LOGIN PASSWORD 'CHANGE_ME'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- 2) Base del control-plane, PROPIEDAD de flit_qa_app (así puede correr las migraciones
--    DDL; el aislamiento por tenant lo da FORCE RLS en F6, no el rol).
--    CREATE DATABASE no admite IF NOT EXISTS: si ya existe, ignora el error
--    "database \"flit_qa_kit\" already exists" (o descomenta el DROP para recrear).
-- DROP DATABASE IF EXISTS flit_qa_kit;
CREATE DATABASE flit_qa_kit OWNER flit_qa_app ENCODING 'UTF8' TEMPLATE template0;

-- 3) Endurecimiento mínimo: nadie más que flit_qa_app se conecta a esta base.
REVOKE CONNECT ON DATABASE flit_qa_kit FROM PUBLIC;
GRANT  CONNECT ON DATABASE flit_qa_kit TO flit_qa_app;

-- Verificación rápida (en pgAdmin: refresca Databases y verás "flit_qa_kit").
