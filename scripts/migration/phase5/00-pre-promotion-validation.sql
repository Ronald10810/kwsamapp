\set ON_ERROR_STOP on

-- Phase 5 pre-promotion validation (read-only)
-- Expected session target database: kwsa_uat
-- Source tables accessed via FDW foreign table schema: src_staging (pointing to kwsa_import_staging.migration)

SELECT 'current_database' AS check_name, current_database() AS value;

DO $$
BEGIN
  IF current_database() <> 'kwsa_uat' THEN
    RAISE EXCEPTION 'Safety stop: connected to %, expected kwsa_uat', current_database();
  END IF;
END $$;

-- Required source tables (src_staging via FDW) and target tables (migration)
WITH expected(table_name) AS (
  VALUES
    ('core_market_centers'),
    ('core_teams'),
    ('core_associates'),
    ('core_listings'),
    ('core_transactions'),
    ('id_map_market_centers'),
    ('id_map_teams'),
    ('id_map_associates'),
    ('id_map_listings'),
    ('listing_agents'),
    ('listing_images'),
    ('listing_marketing_urls'),
    ('transaction_agents'),
    ('transaction_agent_calculations'),
    ('load_rejections')
)
SELECT
  e.table_name,
  EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'src_staging' AND t.table_name = e.table_name
  ) AS has_src_staging,
  EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'migration' AND t.table_name = e.table_name
  ) AS has_migration_target
FROM expected e
ORDER BY e.table_name;

DO $$
DECLARE
  missing_count integer;
BEGIN
  WITH expected(table_name) AS (
    VALUES
      ('core_market_centers'),
      ('core_teams'),
      ('core_associates'),
      ('core_listings'),
      ('core_transactions'),
      ('id_map_market_centers'),
      ('id_map_teams'),
      ('id_map_associates'),
      ('id_map_listings'),
      ('listing_agents'),
      ('listing_images'),
      ('listing_marketing_urls'),
      ('transaction_agents'),
      ('transaction_agent_calculations'),
      ('load_rejections')
  )
  SELECT count(*)
  INTO missing_count
  FROM expected e
  WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'src_staging' AND t.table_name = e.table_name
    )
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'migration' AND t.table_name = e.table_name
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Safety stop: % required promotion tables are missing in src_staging (FDW) and/or migration', missing_count;
  END IF;
END $$;

-- Baseline row counts for approved promotion tables
WITH expected(table_name) AS (
  VALUES
    ('core_market_centers'),
    ('core_teams'),
    ('core_associates'),
    ('core_listings'),
    ('core_transactions'),
    ('id_map_market_centers'),
    ('id_map_teams'),
    ('id_map_associates'),
    ('id_map_listings'),
    ('listing_agents'),
    ('listing_images'),
    ('listing_marketing_urls'),
    ('transaction_agents'),
    ('transaction_agent_calculations'),
    ('load_rejections')
)
SELECT
  e.table_name,
  (SELECT count(*) FROM src_staging.core_market_centers WHERE e.table_name = 'core_market_centers')
+ (SELECT count(*) FROM src_staging.core_teams WHERE e.table_name = 'core_teams')
+ (SELECT count(*) FROM src_staging.core_associates WHERE e.table_name = 'core_associates')
+ (SELECT count(*) FROM src_staging.core_listings WHERE e.table_name = 'core_listings')
+ (SELECT count(*) FROM src_staging.core_transactions WHERE e.table_name = 'core_transactions')
+ (SELECT count(*) FROM src_staging.id_map_market_centers WHERE e.table_name = 'id_map_market_centers')
+ (SELECT count(*) FROM src_staging.id_map_teams WHERE e.table_name = 'id_map_teams')
+ (SELECT count(*) FROM src_staging.id_map_associates WHERE e.table_name = 'id_map_associates')
+ (SELECT count(*) FROM src_staging.id_map_listings WHERE e.table_name = 'id_map_listings')
+ (SELECT count(*) FROM src_staging.listing_agents WHERE e.table_name = 'listing_agents')
+ (SELECT count(*) FROM src_staging.listing_images WHERE e.table_name = 'listing_images')
+ (SELECT count(*) FROM src_staging.listing_marketing_urls WHERE e.table_name = 'listing_marketing_urls')
+ (SELECT count(*) FROM src_staging.transaction_agents WHERE e.table_name = 'transaction_agents')
+ (SELECT count(*) FROM src_staging.transaction_agent_calculations WHERE e.table_name = 'transaction_agent_calculations')
+ (SELECT count(*) FROM src_staging.load_rejections WHERE e.table_name = 'load_rejections')
    AS source_count,
  (SELECT count(*) FROM migration.core_market_centers WHERE e.table_name = 'core_market_centers')
+ (SELECT count(*) FROM migration.core_teams WHERE e.table_name = 'core_teams')
+ (SELECT count(*) FROM migration.core_associates WHERE e.table_name = 'core_associates')
+ (SELECT count(*) FROM migration.core_listings WHERE e.table_name = 'core_listings')
+ (SELECT count(*) FROM migration.core_transactions WHERE e.table_name = 'core_transactions')
+ (SELECT count(*) FROM migration.id_map_market_centers WHERE e.table_name = 'id_map_market_centers')
+ (SELECT count(*) FROM migration.id_map_teams WHERE e.table_name = 'id_map_teams')
+ (SELECT count(*) FROM migration.id_map_associates WHERE e.table_name = 'id_map_associates')
+ (SELECT count(*) FROM migration.id_map_listings WHERE e.table_name = 'id_map_listings')
+ (SELECT count(*) FROM migration.listing_agents WHERE e.table_name = 'listing_agents')
+ (SELECT count(*) FROM migration.listing_images WHERE e.table_name = 'listing_images')
+ (SELECT count(*) FROM migration.listing_marketing_urls WHERE e.table_name = 'listing_marketing_urls')
+ (SELECT count(*) FROM migration.transaction_agents WHERE e.table_name = 'transaction_agents')
+ (SELECT count(*) FROM migration.transaction_agent_calculations WHERE e.table_name = 'transaction_agent_calculations')
+ (SELECT count(*) FROM migration.load_rejections WHERE e.table_name = 'load_rejections')
    AS target_count
FROM expected e
ORDER BY e.table_name;

-- Preserve checks (read-only indicators)
SELECT 'public.users' AS preserve_table,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') AS exists;

SELECT 'public.roles' AS preserve_table,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='roles') AS exists;

SELECT 'public.user_roles' AS preserve_table,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles') AS exists;

SELECT 'public.audit_logs' AS preserve_table,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_logs') AS exists;
