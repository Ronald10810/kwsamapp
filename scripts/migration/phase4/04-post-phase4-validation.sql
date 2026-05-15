-- Post-Phase 4 validation pack (read-only).
-- Intended to run immediately after Phase 4 SQL execution.

-- 1) Core and feature counts
SELECT 'migration.core_market_centers' AS table_name, COUNT(*) AS row_count FROM migration.core_market_centers
UNION ALL SELECT 'migration.core_teams', COUNT(*) FROM migration.core_teams
UNION ALL SELECT 'migration.core_associates', COUNT(*) FROM migration.core_associates
UNION ALL SELECT 'migration.core_listings', COUNT(*) FROM migration.core_listings
UNION ALL SELECT 'migration.core_transactions', COUNT(*) FROM migration.core_transactions
UNION ALL SELECT 'migration.listing_agents', COUNT(*) FROM migration.listing_agents
UNION ALL SELECT 'migration.listing_images', COUNT(*) FROM migration.listing_images
UNION ALL SELECT 'migration.listing_marketing_urls', COUNT(*) FROM migration.listing_marketing_urls
UNION ALL SELECT 'migration.transaction_agents', COUNT(*) FROM migration.transaction_agents
UNION ALL SELECT 'migration.transaction_agent_calculations', COUNT(*) FROM migration.transaction_agent_calculations
UNION ALL SELECT 'migration.load_rejections', COUNT(*) FROM migration.load_rejections
ORDER BY 1;

-- 2) Duplicate business keys in core tables
SELECT 'core_market_centers' AS entity, source_market_center_id AS business_key, COUNT(*)
FROM migration.core_market_centers
GROUP BY source_market_center_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'core_teams', source_team_id, COUNT(*)
FROM migration.core_teams
GROUP BY source_team_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'core_associates', source_associate_id, COUNT(*)
FROM migration.core_associates
GROUP BY source_associate_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'core_listings', source_listing_id, COUNT(*)
FROM migration.core_listings
GROUP BY source_listing_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'core_transactions', source_transaction_id, COUNT(*)
FROM migration.core_transactions
GROUP BY source_transaction_id
HAVING COUNT(*) > 1;

-- 3) Listing description linkage check (source_listing_id-based)
SELECT
  COUNT(*) FILTER (WHERE d.source_listing_id IS NOT NULL) AS descriptions_joined,
  COUNT(*) FILTER (WHERE d.source_listing_id IS NULL) AS descriptions_missing
FROM migration.core_listings cl
LEFT JOIN staging.listing_descriptions_raw_source d
  ON d.source_listing_id::text = cl.source_listing_id::text
 AND (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR d.batch_id = current_setting('migration.batch', true)
 );

-- 4) Listing links and media integrity
SELECT 'listing_agents_without_listing' AS check_name, COUNT(*) AS issue_count
FROM migration.listing_agents la
LEFT JOIN migration.core_listings cl ON cl.id = la.listing_id
WHERE cl.id IS NULL
UNION ALL
SELECT 'listing_agents_without_associate', COUNT(*)
FROM migration.listing_agents la
LEFT JOIN migration.core_associates ca ON ca.id = la.associate_id
WHERE la.associate_id IS NOT NULL AND ca.id IS NULL
UNION ALL
SELECT 'listing_images_without_listing', COUNT(*)
FROM migration.listing_images li
LEFT JOIN migration.core_listings cl ON cl.id = li.listing_id
WHERE cl.id IS NULL
UNION ALL
SELECT 'listing_marketing_urls_without_listing', COUNT(*)
FROM migration.listing_marketing_urls lmu
LEFT JOIN migration.core_listings cl ON cl.id = lmu.listing_id
WHERE cl.id IS NULL;

-- 5) Transaction participants and financial details integrity
SELECT 'transaction_agents_without_transaction' AS check_name, COUNT(*) AS issue_count
FROM migration.transaction_agents ta
LEFT JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
WHERE ct.id IS NULL
UNION ALL
SELECT 'transaction_agent_calculations_without_agent', COUNT(*)
FROM migration.transaction_agent_calculations tac
LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
WHERE tac.transaction_agent_id IS NOT NULL AND ta.id IS NULL
UNION ALL
SELECT 'payment_rows_without_calc', COUNT(*)
FROM staging.transaction_associate_payment_details_raw tapd
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tapd.source_transaction_id::text
LEFT JOIN migration.transaction_agents ta
  ON ta.transaction_id = ct.id
 AND ta.source_associate_id::text = tapd.source_associate_id::text
LEFT JOIN migration.transaction_agent_calculations tac
  ON tac.transaction_id = ct.id
 AND tac.transaction_agent_id = ta.id
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tapd.batch_id = current_setting('migration.batch', true)
  )
  AND tac.id IS NULL;

-- 6) NULL listing_id media preserved in rejections
SELECT
  entity_name,
  reason,
  COUNT(*) AS rejection_count
FROM migration.load_rejections
WHERE entity_name IN ('listing_images_raw_source', 'listing_images_raw', 'listing_marketing_urls_raw')
GROUP BY entity_name, reason
ORDER BY entity_name, reason;

-- 7) Sample rows for spot-checking (10 each)
SELECT * FROM migration.core_associates ORDER BY updated_at DESC NULLS LAST LIMIT 10;
SELECT * FROM migration.core_listings ORDER BY updated_at DESC NULLS LAST LIMIT 10;
SELECT * FROM migration.core_transactions ORDER BY updated_at DESC NULLS LAST LIMIT 10;
SELECT * FROM migration.listing_images ORDER BY uploaded_at DESC NULLS LAST LIMIT 10;
