\set ON_ERROR_STOP on

-- Phase 5 promotion SQL (execution-gated)
-- Source schema: phase5_src
-- Target schema: migration in kwsa_uat
-- Method: controlled delete-and-reload for approved migration tables only
-- IMPORTANT: Run only during approved maintenance window.

SELECT 'current_database' AS check_name, current_database() AS value;

DO $$
BEGIN
  IF current_database() <> 'kwsa_uat' THEN
    RAISE EXCEPTION 'Safety stop: connected to %, expected kwsa_uat', current_database();
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE phase5_reload_plan (
  order_id integer PRIMARY KEY,
  table_name text NOT NULL UNIQUE
);

INSERT INTO phase5_reload_plan (order_id, table_name)
VALUES
  (10, 'transaction_agent_calculations'),
  (20, 'transaction_agents'),
  (30, 'listing_marketing_urls'),
  (40, 'listing_images'),
  (50, 'listing_agents'),
  (60, 'id_map_listings'),
  (70, 'id_map_associates'),
  (80, 'id_map_teams'),
  (90, 'id_map_market_centers'),
  (100, 'core_transactions'),
  (110, 'core_listings'),
  (120, 'core_associates'),
  (130, 'core_teams'),
  (140, 'core_market_centers'),
  (150, 'load_rejections');

CREATE TEMP TABLE phase5_reload_results (
  order_id integer,
  table_name text,
  source_count bigint,
  target_before_count bigint,
  deleted_count bigint,
  inserted_count bigint,
  target_after_count bigint,
  status text,
  checked_at timestamptz DEFAULT now()
);

DO $$
DECLARE
  r record;
  common_cols text;
  source_count bigint;
  before_count bigint;
  deleted_count bigint;
  inserted_count bigint;
  after_count bigint;
BEGIN
  FOR r IN
    SELECT order_id, table_name
    FROM phase5_reload_plan
    ORDER BY order_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'phase5_src'
        AND table_name = r.table_name
    ) THEN
      RAISE EXCEPTION 'Missing source table phase5_src.%', r.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'migration'
        AND table_name = r.table_name
    ) THEN
      RAISE EXCEPTION 'Missing target table migration.%', r.table_name;
    END IF;

    SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO common_cols
    FROM information_schema.columns c
    JOIN information_schema.columns s
      ON s.table_schema = 'phase5_src'
     AND s.table_name = r.table_name
     AND s.column_name = c.column_name
    WHERE c.table_schema = 'migration'
      AND c.table_name = r.table_name;

    IF common_cols IS NULL OR btrim(common_cols) = '' THEN
      RAISE EXCEPTION 'No common columns found for table %', r.table_name;
    END IF;

    EXECUTE format('SELECT count(*) FROM phase5_src.%I', r.table_name) INTO source_count;
    EXECUTE format('SELECT count(*) FROM migration.%I', r.table_name) INTO before_count;

    EXECUTE format('WITH d AS (DELETE FROM migration.%I RETURNING 1) SELECT count(*) FROM d', r.table_name)
      INTO deleted_count;

    EXECUTE format(
      'INSERT INTO migration.%I (%s) SELECT %s FROM phase5_src.%I',
      r.table_name,
      common_cols,
      common_cols,
      r.table_name
    );
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    EXECUTE format('SELECT count(*) FROM migration.%I', r.table_name) INTO after_count;

    INSERT INTO phase5_reload_results (
      order_id,
      table_name,
      source_count,
      target_before_count,
      deleted_count,
      inserted_count,
      target_after_count,
      status
    )
    VALUES (
      r.order_id,
      r.table_name,
      source_count,
      before_count,
      deleted_count,
      inserted_count,
      after_count,
      CASE WHEN after_count = source_count THEN 'OK' ELSE 'COUNT_MISMATCH' END
    );

    IF after_count <> source_count THEN
      RAISE EXCEPTION 'Count mismatch on table %: source %, target %', r.table_name, source_count, after_count;
    END IF;
  END LOOP;
END $$;

SELECT
  order_id,
  table_name,
  source_count,
  target_before_count,
  deleted_count,
  inserted_count,
  target_after_count,
  status,
  checked_at
FROM phase5_reload_results
ORDER BY order_id;

COMMIT;
