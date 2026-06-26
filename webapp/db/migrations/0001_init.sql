-- 0001_init.sql — Esquema base del CONTROL-PLANE (single-tenant).
-- La multitenancy (tenant_id + RLS) y la auth llegan en migraciones posteriores
-- (F5/F6); aquí solo reemplazamos los archivos JSON por tablas con integridad y
-- un lock optimista para runs. NO confundir con la BD del cliente (DATABASE_URL).

-- ----------------------------------------------------------------------------
-- Conexiones de BD guardadas (gestor tipo pgAdmin). Una fila por conexión.
-- password/ssh guardan secretos en claro POR AHORA; F4 los pasa a columnas
-- cifradas (AES-GCM). Mantener el shape cercano a DbConnection (types.ts).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS db_connections (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  engine                text NOT NULL,
  host                  text NOT NULL,
  port                  integer NOT NULL,
  database              text NOT NULL,
  db_user               text NOT NULL,
  password              text NOT NULL DEFAULT '',
  ssl                   boolean NOT NULL DEFAULT false,
  ssl_allow_self_signed boolean NOT NULL DEFAULT false,
  ssh                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default            boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Config del tracker: singleton (una sola fila, id = 1). En F6 pasa a por-tenant.
-- azure/github/jira como jsonb (incluyen secretos en claro hasta F4).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracker_config (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  selected   text NOT NULL DEFAULT 'local',
  azure      jsonb NOT NULL DEFAULT '{}'::jsonb,
  github     jsonb NOT NULL DEFAULT '{}'::jsonb,
  jira       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Runs (ciclo QA). `version` = lock optimista; `stop_requested` = persistencia
-- durable del stop (el hot-path lo lee de memoria, esto es la copia de verdad).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runs (
  id             text PRIMARY KEY,
  created_at     timestamptz NOT NULL,
  started_at     timestamptz,
  finished_at    timestamptz,
  status         text NOT NULL,
  mode           text NOT NULL,
  tracker        text NOT NULL,
  title          text NOT NULL,
  repo_root      text,
  app_url        text,
  feature_id     text,
  hu_ids         jsonb,
  layers         jsonb,
  summary        jsonb,
  error          text,
  stop_requested boolean NOT NULL DEFAULT false,
  version        integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at DESC);

-- ----------------------------------------------------------------------------
-- Eventos de un run: append-only (reemplaza data/events/<id>.jsonl). Fuente de
-- verdad de los logs; el SSE en vivo sale del bus en memoria.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_events (
  seq    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  ts     bigint NOT NULL,
  level  text NOT NULL,
  msg    text NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);
