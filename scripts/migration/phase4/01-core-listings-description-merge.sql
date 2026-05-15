-- Phase 4 patch: merge listing descriptions into migration.core_listings
-- Critical rule: join by source_listing_id only (never by row order).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migration.core_listings LIMIT 1) THEN
    RAISE EXCEPTION
      'Prerequisite failed: migration.core_listings is empty. Run scripts/transform-staging-to-migration.sql before Phase 4 script 01.';
  END IF;
END $$;

WITH latest_descriptions AS (
  SELECT DISTINCT ON (d.source_listing_id)
    d.source_listing_id,
    d.property_title,
    d.short_title,
    d.property_description,
    d.agent_property_valuation,
    d.property24_sync_status,
    d.entegral_sync_status,
    d.kww_sync_status,
    d.raw_payload,
    d.loaded_at
  FROM staging.listing_descriptions_raw_source d
  WHERE d.source_listing_id IS NOT NULL
    AND (
      current_setting('migration.batch', true) IS NULL
      OR current_setting('migration.batch', true) = ''
      OR d.batch_id = current_setting('migration.batch', true)
    )
  ORDER BY d.source_listing_id, d.loaded_at DESC, d.id DESC
)
UPDATE migration.core_listings cl
SET
  property_title = COALESCE(NULLIF(BTRIM(ld.property_title), ''), cl.property_title),
  short_title = COALESCE(NULLIF(BTRIM(ld.short_title), ''), cl.short_title),
  property_description = COALESCE(NULLIF(BTRIM(ld.property_description), ''), cl.property_description),
  agent_property_valuation = COALESCE(
    CASE
      WHEN NULLIF(ld.agent_property_valuation, '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (ld.agent_property_valuation)::numeric
      ELSE NULL
    END,
    cl.agent_property_valuation
  ),
  property24_sync_status = COALESCE(NULLIF(BTRIM(ld.property24_sync_status), ''), cl.property24_sync_status),
  entegral_sync_status = COALESCE(NULLIF(BTRIM(ld.entegral_sync_status), ''), cl.entegral_sync_status),
  kww_sync_status = COALESCE(NULLIF(BTRIM(ld.kww_sync_status), ''), cl.kww_sync_status),
  listing_payload = COALESCE(cl.listing_payload, '{}'::jsonb) || COALESCE(ld.raw_payload, '{}'::jsonb),
  updated_at = now()
FROM latest_descriptions ld
WHERE cl.source_listing_id::text = ld.source_listing_id::text;

-- Optional visibility query after execution:
-- SELECT COUNT(*) AS updated_rows FROM migration.core_listings cl
-- JOIN staging.listing_descriptions_raw_source d ON d.source_listing_id::text = cl.source_listing_id::text;
