\set ON_ERROR_STOP on

-- Phase 5 post-promotion validation (read-only)

SELECT 'current_database' AS check_name, current_database() AS value;

DO $$
BEGIN
  IF current_database() <> 'kwsa_uat' THEN
    RAISE EXCEPTION 'Safety stop: connected to %, expected kwsa_uat', current_database();
  END IF;
END $$;

-- Source-vs-target row-count parity across approved promotion tables
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
  (SELECT count(*) FROM phase5_src.core_market_centers WHERE e.table_name='core_market_centers')
+ (SELECT count(*) FROM phase5_src.core_teams WHERE e.table_name='core_teams')
+ (SELECT count(*) FROM phase5_src.core_associates WHERE e.table_name='core_associates')
+ (SELECT count(*) FROM phase5_src.core_listings WHERE e.table_name='core_listings')
+ (SELECT count(*) FROM phase5_src.core_transactions WHERE e.table_name='core_transactions')
+ (SELECT count(*) FROM phase5_src.id_map_market_centers WHERE e.table_name='id_map_market_centers')
+ (SELECT count(*) FROM phase5_src.id_map_teams WHERE e.table_name='id_map_teams')
+ (SELECT count(*) FROM phase5_src.id_map_associates WHERE e.table_name='id_map_associates')
+ (SELECT count(*) FROM phase5_src.id_map_listings WHERE e.table_name='id_map_listings')
+ (SELECT count(*) FROM phase5_src.listing_agents WHERE e.table_name='listing_agents')
+ (SELECT count(*) FROM phase5_src.listing_images WHERE e.table_name='listing_images')
+ (SELECT count(*) FROM phase5_src.listing_marketing_urls WHERE e.table_name='listing_marketing_urls')
+ (SELECT count(*) FROM phase5_src.transaction_agents WHERE e.table_name='transaction_agents')
+ (SELECT count(*) FROM phase5_src.transaction_agent_calculations WHERE e.table_name='transaction_agent_calculations')
+ (SELECT count(*) FROM phase5_src.load_rejections WHERE e.table_name='load_rejections') AS source_count,
  (SELECT count(*) FROM migration.core_market_centers WHERE e.table_name='core_market_centers')
+ (SELECT count(*) FROM migration.core_teams WHERE e.table_name='core_teams')
+ (SELECT count(*) FROM migration.core_associates WHERE e.table_name='core_associates')
+ (SELECT count(*) FROM migration.core_listings WHERE e.table_name='core_listings')
+ (SELECT count(*) FROM migration.core_transactions WHERE e.table_name='core_transactions')
+ (SELECT count(*) FROM migration.id_map_market_centers WHERE e.table_name='id_map_market_centers')
+ (SELECT count(*) FROM migration.id_map_teams WHERE e.table_name='id_map_teams')
+ (SELECT count(*) FROM migration.id_map_associates WHERE e.table_name='id_map_associates')
+ (SELECT count(*) FROM migration.id_map_listings WHERE e.table_name='id_map_listings')
+ (SELECT count(*) FROM migration.listing_agents WHERE e.table_name='listing_agents')
+ (SELECT count(*) FROM migration.listing_images WHERE e.table_name='listing_images')
+ (SELECT count(*) FROM migration.listing_marketing_urls WHERE e.table_name='listing_marketing_urls')
+ (SELECT count(*) FROM migration.transaction_agents WHERE e.table_name='transaction_agents')
+ (SELECT count(*) FROM migration.transaction_agent_calculations WHERE e.table_name='transaction_agent_calculations')
+ (SELECT count(*) FROM migration.load_rejections WHERE e.table_name='load_rejections') AS target_count,
  CASE
    WHEN (
      (SELECT count(*) FROM phase5_src.core_market_centers WHERE e.table_name='core_market_centers')
    + (SELECT count(*) FROM phase5_src.core_teams WHERE e.table_name='core_teams')
    + (SELECT count(*) FROM phase5_src.core_associates WHERE e.table_name='core_associates')
    + (SELECT count(*) FROM phase5_src.core_listings WHERE e.table_name='core_listings')
    + (SELECT count(*) FROM phase5_src.core_transactions WHERE e.table_name='core_transactions')
    + (SELECT count(*) FROM phase5_src.id_map_market_centers WHERE e.table_name='id_map_market_centers')
    + (SELECT count(*) FROM phase5_src.id_map_teams WHERE e.table_name='id_map_teams')
    + (SELECT count(*) FROM phase5_src.id_map_associates WHERE e.table_name='id_map_associates')
    + (SELECT count(*) FROM phase5_src.id_map_listings WHERE e.table_name='id_map_listings')
    + (SELECT count(*) FROM phase5_src.listing_agents WHERE e.table_name='listing_agents')
    + (SELECT count(*) FROM phase5_src.listing_images WHERE e.table_name='listing_images')
    + (SELECT count(*) FROM phase5_src.listing_marketing_urls WHERE e.table_name='listing_marketing_urls')
    + (SELECT count(*) FROM phase5_src.transaction_agents WHERE e.table_name='transaction_agents')
    + (SELECT count(*) FROM phase5_src.transaction_agent_calculations WHERE e.table_name='transaction_agent_calculations')
    + (SELECT count(*) FROM phase5_src.load_rejections WHERE e.table_name='load_rejections')
    )
    =
    (
      (SELECT count(*) FROM migration.core_market_centers WHERE e.table_name='core_market_centers')
    + (SELECT count(*) FROM migration.core_teams WHERE e.table_name='core_teams')
    + (SELECT count(*) FROM migration.core_associates WHERE e.table_name='core_associates')
    + (SELECT count(*) FROM migration.core_listings WHERE e.table_name='core_listings')
    + (SELECT count(*) FROM migration.core_transactions WHERE e.table_name='core_transactions')
    + (SELECT count(*) FROM migration.id_map_market_centers WHERE e.table_name='id_map_market_centers')
    + (SELECT count(*) FROM migration.id_map_teams WHERE e.table_name='id_map_teams')
    + (SELECT count(*) FROM migration.id_map_associates WHERE e.table_name='id_map_associates')
    + (SELECT count(*) FROM migration.id_map_listings WHERE e.table_name='id_map_listings')
    + (SELECT count(*) FROM migration.listing_agents WHERE e.table_name='listing_agents')
    + (SELECT count(*) FROM migration.listing_images WHERE e.table_name='listing_images')
    + (SELECT count(*) FROM migration.listing_marketing_urls WHERE e.table_name='listing_marketing_urls')
    + (SELECT count(*) FROM migration.transaction_agents WHERE e.table_name='transaction_agents')
    + (SELECT count(*) FROM migration.transaction_agent_calculations WHERE e.table_name='transaction_agent_calculations')
    + (SELECT count(*) FROM migration.load_rejections WHERE e.table_name='load_rejections')
    )
    THEN 'OK'
    ELSE 'COUNT_MISMATCH'
  END AS status
FROM expected e
ORDER BY e.table_name;

-- Referential integrity checks
SELECT 'listing_agents_orphans' AS check_name, count(*) AS orphan_rows
FROM migration.listing_agents la
LEFT JOIN migration.core_listings cl ON cl.id = la.listing_id
WHERE cl.id IS NULL;

SELECT 'listing_images_orphans' AS check_name, count(*) AS orphan_rows
FROM migration.listing_images li
LEFT JOIN migration.core_listings cl ON cl.id = li.listing_id
WHERE cl.id IS NULL;

SELECT 'listing_marketing_urls_orphans' AS check_name, count(*) AS orphan_rows
FROM migration.listing_marketing_urls lu
LEFT JOIN migration.core_listings cl ON cl.id = lu.listing_id
WHERE cl.id IS NULL;

SELECT 'transaction_agents_orphans' AS check_name, count(*) AS orphan_rows
FROM migration.transaction_agents ta
LEFT JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
WHERE ct.id IS NULL;

SELECT 'transaction_agent_calculations_orphans' AS check_name, count(*) AS orphan_rows
FROM migration.transaction_agent_calculations tac
LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
WHERE ct.id IS NULL;

-- Duplicate checks on source business keys
SELECT 'dup_source_market_center_id' AS check_name, count(*) AS duplicate_keys
FROM (
  SELECT source_market_center_id
  FROM migration.core_market_centers
  GROUP BY source_market_center_id
  HAVING count(*) > 1
) d;

SELECT 'dup_source_team_id' AS check_name, count(*) AS duplicate_keys
FROM (
  SELECT source_team_id
  FROM migration.core_teams
  GROUP BY source_team_id
  HAVING count(*) > 1
) d;

SELECT 'dup_source_associate_id' AS check_name, count(*) AS duplicate_keys
FROM (
  SELECT source_associate_id
  FROM migration.core_associates
  GROUP BY source_associate_id
  HAVING count(*) > 1
) d;

SELECT 'dup_source_listing_id' AS check_name, count(*) AS duplicate_keys
FROM (
  SELECT source_listing_id
  FROM migration.core_listings
  GROUP BY source_listing_id
  HAVING count(*) > 1
) d;

SELECT 'dup_source_transaction_id' AS check_name, count(*) AS duplicate_keys
FROM (
  SELECT source_transaction_id
  FROM migration.core_transactions
  GROUP BY source_transaction_id
  HAVING count(*) > 1
) d;
