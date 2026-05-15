-- Phase 4 patch: Group C mappings using current staging table shapes.
-- Covers listing_associates, listing_images_raw_source/listing_images_raw, listing_marketing_urls_raw.

-- ============================================================
-- 1) Listing agents from staging.listing_associates
--    staging keys are listing_id and associate_id (text source keys).
-- ============================================================
INSERT INTO migration.listing_agents (
  listing_id,
  associate_id,
  agent_name,
  agent_role,
  is_primary,
  market_center_id,
  sort_order,
  created_at,
  updated_at
)
SELECT
  cl.id AS listing_id,
  ca.id AS associate_id,
  COALESCE(ca.full_name, '') AS agent_name,
  COALESCE(NULLIF(BTRIM(la.role), ''), 'Agent') AS agent_role,
  CASE
    WHEN LOWER(COALESCE(la.role, '')) IN ('primary', 'primary agent', 'listing agent', 'lead') THEN true
    ELSE false
  END AS is_primary,
  ca.market_center_id,
  ROW_NUMBER() OVER (
    PARTITION BY la.listing_id
    ORDER BY
      CASE WHEN LOWER(COALESCE(la.role, '')) IN ('primary', 'primary agent', 'listing agent', 'lead') THEN 0 ELSE 1 END,
      la.id
  )::int - 1 AS sort_order,
  now(),
  now()
FROM staging.listing_associates la
JOIN migration.core_listings cl
  ON cl.source_listing_id::text = la.listing_id::text
JOIN migration.core_associates ca
  ON ca.source_associate_id::text = la.associate_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR la.batch_id = current_setting('migration.batch', true)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM migration.listing_agents existing
    WHERE existing.listing_id = cl.id
      AND COALESCE(existing.associate_id, -1) = COALESCE(ca.id, -1)
      AND COALESCE(LOWER(existing.agent_role), '') = COALESCE(LOWER(COALESCE(NULLIF(BTRIM(la.role), ''), 'Agent')), '')
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'listing_associates',
  CONCAT_WS(':', COALESCE(la.listing_id, ''), COALESCE(la.associate_id, '')),
  'Unresolved listing_id or associate_id in listing_associates',
  jsonb_build_object(
    'listing_id', la.listing_id,
    'associate_id', la.associate_id,
    'role', la.role,
    'batch_id', la.batch_id
  )
FROM staging.listing_associates la
LEFT JOIN migration.core_listings cl
  ON cl.source_listing_id::text = la.listing_id::text
LEFT JOIN migration.core_associates ca
  ON ca.source_associate_id::text = la.associate_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR la.batch_id = current_setting('migration.batch', true)
  )
  AND (cl.id IS NULL OR ca.id IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'listing_associates'
      AND r.source_id = CONCAT_WS(':', COALESCE(la.listing_id, ''), COALESCE(la.associate_id, ''))
      AND r.reason = 'Unresolved listing_id or associate_id in listing_associates'
  );

-- ============================================================
-- 2) Listing images primary source: staging.listing_images_raw_source
-- ============================================================
INSERT INTO migration.listing_images (
  listing_id,
  file_name,
  file_url,
  media_type,
  sort_order,
  uploaded_by,
  uploaded_at
)
SELECT
  cl.id,
  COALESCE(
    NULLIF(BTRIM(lis.image_caption), ''),
    CASE WHEN lis.document_id IS NOT NULL THEN 'image-' || lis.document_id::text ELSE NULL END,
    NULLIF(BTRIM(lis.image_url), ''),
    'image-' || lis.id::text
  ) AS file_name,
  COALESCE(NULLIF(BTRIM(lis.preview_url), ''), NULLIF(BTRIM(lis.image_url), '')) AS file_url,
  'image/jpeg',
  COALESCE(lis.order_number, 0),
  'migration-phase4',
  now()
FROM staging.listing_images_raw_source lis
JOIN migration.core_listings cl
  ON cl.source_listing_id::text = lis.source_listing_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lis.batch_id = current_setting('migration.batch', true)
  )
  AND COALESCE(NULLIF(BTRIM(lis.preview_url), ''), NULLIF(BTRIM(lis.image_url), '')) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.listing_images existing
    WHERE existing.listing_id = cl.id
      AND COALESCE(existing.file_url, '') = COALESCE(NULLIF(BTRIM(lis.preview_url), ''), NULLIF(BTRIM(lis.image_url), ''), '')
      AND COALESCE(existing.sort_order, -1) = COALESCE(lis.order_number, 0)
  );

-- Fallback source for any legacy image rows not already inserted
INSERT INTO migration.listing_images (
  listing_id,
  file_name,
  file_url,
  media_type,
  sort_order,
  uploaded_by,
  uploaded_at
)
SELECT
  cl.id,
  COALESCE(NULLIF(BTRIM(lir.description), ''), 'legacy-image-' || lir.id::text) AS file_name,
  NULLIF(BTRIM(lir.image_url), '') AS file_url,
  'image/jpeg',
  ROW_NUMBER() OVER (PARTITION BY lir.listing_id ORDER BY lir.id)::int - 1,
  'migration-phase4-fallback',
  now()
FROM staging.listing_images_raw lir
JOIN migration.core_listings cl
  ON cl.source_listing_id::text = lir.listing_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lir.batch_id = current_setting('migration.batch', true)
  )
  AND NULLIF(BTRIM(lir.image_url), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.listing_images existing
    WHERE existing.listing_id = cl.id
      AND COALESCE(existing.file_url, '') = COALESCE(NULLIF(BTRIM(lir.image_url), ''), '')
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'listing_images_raw_source',
  lis.id::text,
  'NULL source_listing_id preserved and not mapped',
  COALESCE(lis.raw_payload, jsonb_build_object('id', lis.id, 'image_url', lis.image_url, 'preview_url', lis.preview_url))
FROM staging.listing_images_raw_source lis
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lis.batch_id = current_setting('migration.batch', true)
  )
  AND lis.source_listing_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'listing_images_raw_source'
      AND r.source_id = lis.id::text
      AND r.reason = 'NULL source_listing_id preserved and not mapped'
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'listing_images_raw',
  lir.id::text,
  'NULL listing_id preserved and not mapped',
  jsonb_build_object(
    'id', lir.id,
    'listing_id', lir.listing_id,
    'image_url', lir.image_url,
    'description', lir.description,
    'batch_id', lir.batch_id
  )
FROM staging.listing_images_raw lir
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lir.batch_id = current_setting('migration.batch', true)
  )
  AND NULLIF(BTRIM(lir.listing_id), '') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'listing_images_raw'
      AND r.source_id = lir.id::text
      AND r.reason = 'NULL listing_id preserved and not mapped'
  );

-- ============================================================
-- 3) Listing marketing URLs from staging.listing_marketing_urls_raw
-- ============================================================
INSERT INTO migration.listing_marketing_urls (
  listing_id,
  url,
  url_type,
  display_name,
  sort_order
)
SELECT
  cl.id,
  lmu.url,
  COALESCE(NULLIF(BTRIM(lmu.type), ''), 'Marketing'),
  lmu.url,
  ROW_NUMBER() OVER (PARTITION BY lmu.listing_id ORDER BY lmu.id)::int - 1
FROM staging.listing_marketing_urls_raw lmu
JOIN migration.core_listings cl
  ON cl.source_listing_id::text = lmu.listing_id::text
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lmu.batch_id = current_setting('migration.batch', true)
  )
  AND NULLIF(BTRIM(lmu.url), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.listing_marketing_urls existing
    WHERE existing.listing_id = cl.id
      AND COALESCE(existing.url, '') = COALESCE(lmu.url, '')
      AND COALESCE(existing.url_type, '') = COALESCE(NULLIF(BTRIM(lmu.type), ''), 'Marketing')
  );

INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
SELECT
  'listing_marketing_urls_raw',
  lmu.id::text,
  'NULL listing_id preserved and not mapped',
  jsonb_build_object(
    'id', lmu.id,
    'listing_id', lmu.listing_id,
    'url', lmu.url,
    'type', lmu.type,
    'batch_id', lmu.batch_id
  )
FROM staging.listing_marketing_urls_raw lmu
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR lmu.batch_id = current_setting('migration.batch', true)
  )
  AND NULLIF(BTRIM(lmu.listing_id), '') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.load_rejections r
    WHERE r.entity_name = 'listing_marketing_urls_raw'
      AND r.source_id = lmu.id::text
      AND r.reason = 'NULL listing_id preserved and not mapped'
  );

-- Keep listing_images_json synchronized after image loads.
UPDATE migration.core_listings cl
SET listing_images_json = (
  SELECT jsonb_agg(li.file_url ORDER BY li.sort_order)
  FROM migration.listing_images li
  WHERE li.listing_id = cl.id
)
WHERE EXISTS (
  SELECT 1
  FROM migration.listing_images li
  WHERE li.listing_id = cl.id
);
