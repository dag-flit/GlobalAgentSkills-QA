-- 0018_qa_item_link_runs.sql — SEGUIMIENTO QA: permitir vincular VARIAS corridas (kit/regresión) a un
-- mismo pendiente. Se agrega `link_runs` (array jsonb de {kind,id,title,sub,href,when,status}) y se
-- MIGRA el vínculo simple previo (link_run_*) como primer elemento del array. Las columnas viejas se
-- conservan (compat, forward-only) pero la UI usa link_runs. Idempotente: solo backfillea si el array
-- está vacío y había un vínculo simple.

ALTER TABLE qa_items ADD COLUMN IF NOT EXISTS link_runs jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE qa_items SET link_runs = jsonb_build_array(jsonb_build_object(
    'kind', link_run_kind,
    'id', link_run_id,
    'title', COALESCE(link_run_meta ->> 'title', ''),
    'sub', COALESCE(link_run_meta ->> 'sub', ''),
    'href', link_run_meta ->> 'href',
    'when', COALESCE(link_run_meta ->> 'when', ''),
    'status', COALESCE(link_run_meta ->> 'status', '')
  ))
  WHERE link_run_id <> '' AND link_runs = '[]'::jsonb;
