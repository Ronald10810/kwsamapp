-- enrich-migration-schema.sql
-- Adds missing columns and creates all supporting migration.* tables
-- required for the frontend console and backend APIs to work fully.
--
-- Run AFTER insert-migration-to-public.sql (or independently of it; targets migration.* only)
--
-- Usage:
--   node scripts/run-sql.cjs scripts/enrich-migration-schema.sql
--
-- SAFE TO RE-RUN: uses ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS.

-- ============================================================
-- 1.  core_listings  –  add missing columns
-- ============================================================

ALTER TABLE migration.core_listings
  ADD COLUMN IF NOT EXISTS address_line                    TEXT,
  ADD COLUMN IF NOT EXISTS listing_status_tag              TEXT,
  ADD COLUMN IF NOT EXISTS ownership_type                  TEXT,
  ADD COLUMN IF NOT EXISTS property_type                   TEXT,
  ADD COLUMN IF NOT EXISTS property_sub_type               TEXT,
  ADD COLUMN IF NOT EXISTS descriptive_feature             TEXT,
  ADD COLUMN IF NOT EXISTS retirement_living               BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS short_description               TEXT,
  ADD COLUMN IF NOT EXISTS erf_number                      TEXT,
  ADD COLUMN IF NOT EXISTS unit_number                     TEXT,
  ADD COLUMN IF NOT EXISTS door_number                     TEXT,
  ADD COLUMN IF NOT EXISTS estate_name                     TEXT,
  ADD COLUMN IF NOT EXISTS postal_code                     TEXT,
  ADD COLUMN IF NOT EXISTS longitude                       NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS latitude                        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS override_display_location       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_display_longitude      NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS override_display_latitude       NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS loom_validation_status          TEXT,
  ADD COLUMN IF NOT EXISTS loom_property_id                TEXT,
  ADD COLUMN IF NOT EXISTS loom_address                    TEXT,
  ADD COLUMN IF NOT EXISTS display_address_on_website      BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS viewing_instructions            TEXT,
  ADD COLUMN IF NOT EXISTS viewing_directions              TEXT,
  ADD COLUMN IF NOT EXISTS feed_to_private_property        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS private_property_ref1           TEXT,
  ADD COLUMN IF NOT EXISTS private_property_ref2           TEXT,
  ADD COLUMN IF NOT EXISTS private_property_sync_status    TEXT,
  ADD COLUMN IF NOT EXISTS feed_to_kww                     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS kww_property_reference          TEXT,
  ADD COLUMN IF NOT EXISTS kww_ref1                        TEXT,
  ADD COLUMN IF NOT EXISTS kww_ref2                        TEXT,
  ADD COLUMN IF NOT EXISTS kww_sync_status                 TEXT,
  ADD COLUMN IF NOT EXISTS feed_to_entegral                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS entegral_sync_status            TEXT,
  ADD COLUMN IF NOT EXISTS feed_to_property24              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS property24_ref1                 TEXT,
  ADD COLUMN IF NOT EXISTS property24_ref2                 TEXT,
  ADD COLUMN IF NOT EXISTS property24_sync_status          TEXT,
  ADD COLUMN IF NOT EXISTS reduced_date                    DATE,
  ADD COLUMN IF NOT EXISTS property_auction                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS occupation_date                 DATE,
  ADD COLUMN IF NOT EXISTS erf_size                        NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS floor_area                      NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS construction_date               DATE,
  ADD COLUMN IF NOT EXISTS height_restriction              NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS out_building_size               NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS zoning_type                     TEXT,
  ADD COLUMN IF NOT EXISTS is_furnished                    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pet_friendly                    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_standalone_building         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_flatlet                     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_backup_water                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS wheelchair_accessible           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_generator                   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_borehole                    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_gas_geyser                  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_solar_panels                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_backup_battery_or_inverter  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_solar_geyser                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_water_tank                  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS adsl                            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fibre                           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS isdn                            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dialup                          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_wimax                     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS satellite                       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nearby_bus_service              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nearby_minibus_taxi_service     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nearby_train_service            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_draft                        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_published                    BOOLEAN DEFAULT true;

-- Populate derived / payload-based values
UPDATE migration.core_listings SET
  address_line = TRIM(COALESCE(NULLIF(TRIM(street_number),''), '') || ' ' || COALESCE(NULLIF(TRIM(street_name),''), '')),
  listing_status_tag = COALESCE(
    NULLIF(TRIM(listing_payload->>'listing_status_tag'), ''),
    NULLIF(TRIM(listing_payload->>'ListingStatusTag'), '')
  ),
  ownership_type = COALESCE(
    NULLIF(TRIM(listing_payload->>'ownership_type'), ''),
    NULLIF(TRIM(listing_payload->>'OwnershipType'), '')
  ),
  property_type = COALESCE(
    NULLIF(TRIM(listing_payload->>'property_type'), ''),
    NULLIF(TRIM(listing_payload->>'PropertyType'), ''),
    NULLIF(TRIM(listing_payload->>'ListingType'), '')
  ),
  property_sub_type = COALESCE(
    NULLIF(TRIM(listing_payload->>'property_sub_type'), ''),
    NULLIF(TRIM(listing_payload->>'PropertySubType'), ''),
    NULLIF(TRIM(listing_payload->>'SubType'), '')
  ),
  descriptive_feature = COALESCE(
    NULLIF(TRIM(listing_payload->>'descriptive_feature'), ''),
    NULLIF(TRIM(listing_payload->>'DescriptiveFeature'), '')
  ),
  retirement_living = CASE LOWER(COALESCE(listing_payload->>'retirement_living', listing_payload->>'RetirementLiving', ''))
    WHEN 'true' THEN true ELSE false END,
  short_description = COALESCE(
    NULLIF(TRIM(listing_payload->>'short_description'), ''),
    NULLIF(TRIM(listing_payload->>'ShortDescription'), ''),
    NULLIF(TRIM(listing_payload->>'short_title'), ''),
    short_title
  ),
  erf_number = COALESCE(
    NULLIF(TRIM(listing_payload->>'erf_number'), ''),
    NULLIF(TRIM(listing_payload->>'ErfNumber'), '')
  ),
  unit_number = COALESCE(
    NULLIF(TRIM(listing_payload->>'unit_number'), ''),
    NULLIF(TRIM(listing_payload->>'UnitNumber'), '')
  ),
  door_number = COALESCE(
    NULLIF(TRIM(listing_payload->>'door_number'), ''),
    NULLIF(TRIM(listing_payload->>'DoorNumber'), '')
  ),
  estate_name = COALESCE(
    NULLIF(TRIM(listing_payload->>'estate_name'), ''),
    NULLIF(TRIM(listing_payload->>'EstateName'), '')
  ),
  postal_code = COALESCE(
    NULLIF(TRIM(listing_payload->>'postal_code'), ''),
    NULLIF(TRIM(listing_payload->>'PostalCode'), '')
  ),
  longitude = CASE
    WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'longitude', listing_payload->>'Longitude', ''), '[^0-9.\-]', '', 'g'), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'longitude', listing_payload->>'Longitude', ''), '[^0-9.\-]', '', 'g'), '')::numeric(10,7)
    ELSE NULL END,
  latitude = CASE
    WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'latitude', listing_payload->>'Latitude', ''), '[^0-9.\-]', '', 'g'), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'latitude', listing_payload->>'Latitude', ''), '[^0-9.\-]', '', 'g'), '')::numeric(10,7)
    ELSE NULL END,
  -- portal references
  private_property_ref1 = COALESCE(
    NULLIF(TRIM(listing_payload->>'PrivatePropertyId'), ''),
    NULLIF(TRIM(listing_payload->>'private_property_ref1'), '')
  ),
  property24_ref1 = COALESCE(
    NULLIF(TRIM(listing_payload->>'Property24Id'), ''),
    NULLIF(TRIM(listing_payload->>'property24_ref1'), '')
  ),
  kww_property_reference = COALESCE(
    NULLIF(TRIM(listing_payload->>'KWWId'), ''),
    NULLIF(TRIM(listing_payload->>'kww_property_reference'), '')
  ),
  -- erf/floor sizes
  erf_size = CASE
    WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'erf_size', listing_payload->>'ErfSize', ''), '[^0-9.]', '', 'g'), '') ~ '^[0-9]+(\.[0-9]+)?$'
    THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'erf_size', listing_payload->>'ErfSize', ''), '[^0-9.]', '', 'g'), '')::numeric(18,2)
    ELSE NULL END,
  floor_area = CASE
    WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'floor_area', listing_payload->>'FloorArea', ''), '[^0-9.]', '', 'g'), '') ~ '^[0-9]+(\.[0-9]+)?$'
    THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'floor_area', listing_payload->>'FloorArea', ''), '[^0-9.]', '', 'g'), '')::numeric(18,2)
    ELSE NULL END,
  -- boolean property features from payload
  is_furnished                   = CASE LOWER(COALESCE(listing_payload->>'is_furnished', listing_payload->>'IsFurnished', '')) WHEN 'true' THEN true ELSE false END,
  pet_friendly                   = CASE LOWER(COALESCE(listing_payload->>'pet_friendly', listing_payload->>'PetFriendly', '')) WHEN 'true' THEN true ELSE false END,
  has_generator                  = CASE LOWER(COALESCE(listing_payload->>'has_generator', listing_payload->>'HasGenerator', '')) WHEN 'true' THEN true ELSE false END,
  has_borehole                   = CASE LOWER(COALESCE(listing_payload->>'has_borehole', listing_payload->>'HasBorehole', '')) WHEN 'true' THEN true ELSE false END,
  has_solar_panels               = CASE LOWER(COALESCE(listing_payload->>'has_solar_panels', listing_payload->>'HasSolarPanels', '')) WHEN 'true' THEN true ELSE false END,
  has_backup_battery_or_inverter = CASE LOWER(COALESCE(listing_payload->>'has_backup_battery_or_inverter', listing_payload->>'HasBackupBatteryOrInverter', '')) WHEN 'true' THEN true ELSE false END,
  has_solar_geyser               = CASE LOWER(COALESCE(listing_payload->>'has_solar_geyser', listing_payload->>'HasSolarGeyser', '')) WHEN 'true' THEN true ELSE false END,
  has_water_tank                 = CASE LOWER(COALESCE(listing_payload->>'has_water_tank', listing_payload->>'HasWaterTank', '')) WHEN 'true' THEN true ELSE false END,
  has_flatlet                    = CASE LOWER(COALESCE(listing_payload->>'has_flatlet', listing_payload->>'HasFlatlet', '')) WHEN 'true' THEN true ELSE false END,
  has_gas_geyser                 = CASE LOWER(COALESCE(listing_payload->>'has_gas_geyser', listing_payload->>'HasGasGeyser', '')) WHEN 'true' THEN true ELSE false END,
  -- status flags: migrated listings are published (not drafts)
  is_draft      = false,
  is_published  = true;

-- Index on address_line for search
CREATE INDEX IF NOT EXISTS idx_core_listings_address_line ON migration.core_listings (address_line);
CREATE INDEX IF NOT EXISTS idx_core_listings_property_type ON migration.core_listings (property_type);

-- ============================================================
-- 2.  core_associates  –  add missing columns
-- ============================================================

ALTER TABLE migration.core_associates
  ADD COLUMN IF NOT EXISTS image_url   TEXT,
  ADD COLUMN IF NOT EXISTS kwsa_email  TEXT;

-- Populate kwsa_email from email if not set
UPDATE migration.core_associates
SET kwsa_email = email
WHERE kwsa_email IS NULL AND email IS NOT NULL AND email <> '';

-- ============================================================
-- 3.  core_market_centers  –  add logo column
-- ============================================================

ALTER TABLE migration.core_market_centers
  ADD COLUMN IF NOT EXISTS logo_image_url TEXT;

-- ============================================================
-- 4.  listing_agents  –  from staging.listing_associates
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.listing_agents (
  id              BIGSERIAL PRIMARY KEY,
  listing_id      BIGINT    NOT NULL,
  associate_id    BIGINT,
  agent_name      TEXT,
  agent_role      TEXT      DEFAULT 'Agent',
  is_primary      BOOLEAN   DEFAULT false,
  market_center_id BIGINT,
  sort_order      INT       DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_agents_listing ON migration.listing_agents (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_agents_associate ON migration.listing_agents (associate_id);

INSERT INTO migration.listing_agents (listing_id, associate_id, agent_name, agent_role, is_primary, market_center_id, sort_order)
SELECT
  cl.id                   AS listing_id,
  ca.id                   AS associate_id,
  COALESCE(ca.full_name, la.associate_name) AS agent_name,
  'Agent'                 AS agent_role,
  la.is_primary,
  ca.market_center_id,
  ROW_NUMBER() OVER (PARTITION BY la.source_listing_id ORDER BY la.is_primary DESC, la.id)::int - 1 AS sort_order
FROM staging.listing_associates la
JOIN migration.core_listings    cl ON cl.source_listing_id  = la.source_listing_id
JOIN migration.core_associates  ca ON ca.source_associate_id = la.source_associate_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5.  listing_images  –  from staging.listing_images_raw
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.listing_images (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    BIGINT    NOT NULL,
  file_name     TEXT,
  file_url      TEXT,
  media_type    TEXT      DEFAULT 'image/jpeg',
  sort_order    INT       DEFAULT 0,
  uploaded_by   TEXT      DEFAULT 'migration',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON migration.listing_images (listing_id);

INSERT INTO migration.listing_images (listing_id, file_name, file_url, media_type, sort_order)
SELECT
  cl.id,
  COALESCE(
    NULLIF(TRIM(lir.image_url), ''),
    'image-' || lir.document_id
  ) AS file_name,
  COALESCE(NULLIF(TRIM(lir.preview_url), ''), NULLIF(TRIM(lir.image_url), '')) AS file_url,
  'image/jpeg',
  COALESCE(lir.order_number, 0)
FROM staging.listing_images_raw lir
JOIN migration.core_listings cl ON cl.source_listing_id = lir.source_listing_id
WHERE lir.image_url IS NOT NULL AND lir.image_url <> ''
ON CONFLICT DO NOTHING;

-- Also rebuild listing_images_json on core_listings from the images table for the API thumbnail
UPDATE migration.core_listings cl
SET listing_images_json = (
  SELECT jsonb_agg(li.file_url ORDER BY li.sort_order)
  FROM migration.listing_images li
  WHERE li.listing_id = cl.id
)
WHERE EXISTS (SELECT 1 FROM migration.listing_images li WHERE li.listing_id = cl.id);

-- ============================================================
-- 6.  listing_marketing_urls  –  from staging.listing_marketing_urls_raw
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.listing_marketing_urls (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    BIGINT    NOT NULL,
  url           TEXT,
  url_type      TEXT,
  display_name  TEXT,
  sort_order    INT       DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_listing_marketing_urls_listing ON migration.listing_marketing_urls (listing_id);

INSERT INTO migration.listing_marketing_urls (listing_id, url, url_type, display_name, sort_order)
SELECT
  cl.id,
  lmu.url,
  lmu.marketing_url_type_id,
  lmu.url,
  ROW_NUMBER() OVER (PARTITION BY lmu.source_listing_id ORDER BY lmu.id)::int - 1
FROM staging.listing_marketing_urls_raw lmu
JOIN migration.core_listings cl ON cl.source_listing_id = lmu.source_listing_id
WHERE lmu.url IS NOT NULL AND lmu.url <> ''
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7.  Stub tables  –  no source data, created for API compatibility
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.listing_contacts (
  id             BIGSERIAL PRIMARY KEY,
  listing_id     BIGINT    NOT NULL,
  full_name      TEXT,
  phone_number   TEXT,
  email_address  TEXT,
  sort_order     INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_contacts_listing ON migration.listing_contacts (listing_id);

CREATE TABLE IF NOT EXISTS migration.listing_show_times (
  id             BIGSERIAL PRIMARY KEY,
  listing_id     BIGINT    NOT NULL,
  from_date      DATE,
  from_time      TEXT,
  to_date        DATE,
  to_time        TEXT,
  catch_phrase   TEXT,
  sort_order     INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_show_times_listing ON migration.listing_show_times (listing_id);

CREATE TABLE IF NOT EXISTS migration.listing_open_house (
  id              BIGSERIAL PRIMARY KEY,
  listing_id      BIGINT    NOT NULL,
  open_house_date DATE,
  from_time       TEXT,
  to_time         TEXT,
  average_price   TEXT,
  comments        TEXT,
  sort_order      INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_open_house_listing ON migration.listing_open_house (listing_id);

CREATE TABLE IF NOT EXISTS migration.listing_mandate_documents (
  id           BIGSERIAL PRIMARY KEY,
  listing_id   BIGINT    NOT NULL,
  file_name    TEXT,
  file_url     TEXT,
  file_type    TEXT,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_order   INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_mandate_docs_listing ON migration.listing_mandate_documents (listing_id);

CREATE TABLE IF NOT EXISTS migration.listing_features (
  id                BIGSERIAL PRIMARY KEY,
  listing_id        BIGINT    NOT NULL,
  feature_category  TEXT,
  feature_value     TEXT,
  sort_order        INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_features_listing ON migration.listing_features (listing_id);

-- ============================================================
-- 8.  listing_property_areas  –  bedrooms, bathrooms, garages
--     from listing_payload where available
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.listing_property_areas (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    BIGINT    NOT NULL,
  area_type     TEXT,
  count         INT,
  size          NUMERIC(18,2),
  description   TEXT,
  sub_features  JSONB,
  sort_order    INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_property_areas_listing ON migration.listing_property_areas (listing_id);

-- Extract bedroom/bathroom/garage from payload (handles both camelCase and snake_case keys)
INSERT INTO migration.listing_property_areas (listing_id, area_type, count, sort_order)
SELECT id, 'bedroom', bedroom_count, 0
FROM (
  SELECT id,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'BedroomCount', listing_payload->>'bedroom_count', listing_payload->>'Bedrooms', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'BedroomCount', listing_payload->>'bedroom_count', listing_payload->>'Bedrooms', ''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS bedroom_count
  FROM migration.core_listings
) sub
WHERE bedroom_count IS NOT NULL AND bedroom_count > 0
ON CONFLICT DO NOTHING;

INSERT INTO migration.listing_property_areas (listing_id, area_type, count, sort_order)
SELECT id, 'bathroom', bathroom_count, 1
FROM (
  SELECT id,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'BathroomCount', listing_payload->>'bathroom_count', listing_payload->>'Bathrooms', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'BathroomCount', listing_payload->>'bathroom_count', listing_payload->>'Bathrooms', ''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS bathroom_count
  FROM migration.core_listings
) sub
WHERE bathroom_count IS NOT NULL AND bathroom_count > 0
ON CONFLICT DO NOTHING;

INSERT INTO migration.listing_property_areas (listing_id, area_type, count, sort_order)
SELECT id, 'garage', garage_count, 2
FROM (
  SELECT id,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'GarageCount', listing_payload->>'garage_count', listing_payload->>'Garages', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'GarageCount', listing_payload->>'garage_count', listing_payload->>'Garages', ''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS garage_count
  FROM migration.core_listings
) sub
WHERE garage_count IS NOT NULL AND garage_count > 0
ON CONFLICT DO NOTHING;

INSERT INTO migration.listing_property_areas (listing_id, area_type, count, sort_order)
SELECT id, 'parking', parking_count, 3
FROM (
  SELECT id,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(listing_payload->>'ParkingCount', listing_payload->>'parking_count', listing_payload->>'ParkingBays', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      THEN NULLIF(regexp_replace(COALESCE(listing_payload->>'ParkingCount', listing_payload->>'parking_count', listing_payload->>'ParkingBays', ''), '[^0-9]', '', 'g'), '')::int
      ELSE NULL
    END AS parking_count
  FROM migration.core_listings
) sub
WHERE parking_count IS NOT NULL AND parking_count > 0
ON CONFLICT DO NOTHING;


UPDATE migration.core_listings cl
SET listing_images_json = (
  SELECT jsonb_agg(url_entry ORDER BY idx)
  FROM (
    SELECT arr.url_entry, arr.idx
    FROM jsonb_array_elements_text(listing_payload->'ListingImages') WITH ORDINALITY AS arr(url_entry, idx)
    WHERE jsonb_typeof(listing_payload->'ListingImages') = 'array'

    UNION ALL

    SELECT split.url_entry, split.idx
    FROM regexp_split_to_table(
           regexp_replace(COALESCE(listing_payload->>'ListingImages', ''), '[\[\]"]', '', 'g'),
           '\s*[|;,]\s*'
         ) WITH ORDINALITY AS split(url_entry, idx)
    WHERE NULLIF(TRIM(listing_payload->>'ListingImages'), '') IS NOT NULL
  ) img_sub
  WHERE url_entry IS NOT NULL AND url_entry <> ''
    AND url_entry ~ '^https?://'
)
WHERE listing_images_json IS NULL
  AND (
    listing_payload ? 'ListingImages'
    OR listing_payload ? 'listing_images'
  );

-- ============================================================
-- 10. migration.transaction_agents  –  from staging.transaction_agents
--     (this is the migration-tier version, keyed to core_transactions.id
--      and core_associates.id rather than staging IDs)
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.transaction_agents (
  id                  BIGSERIAL PRIMARY KEY,
  transaction_id      BIGINT NOT NULL,
  associate_id        BIGINT,
  source_associate_id TEXT,
  agent_name          TEXT,
  agent_role          TEXT,
  split_percentage    NUMERIC(10,4) DEFAULT 0,
  outside_agency      BOOLEAN DEFAULT false,
  sort_order          INT DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_ta_tx      ON migration.transaction_agents (transaction_id);
CREATE INDEX IF NOT EXISTS idx_migration_ta_assoc   ON migration.transaction_agents (associate_id);

INSERT INTO migration.transaction_agents
  (transaction_id, associate_id, source_associate_id, agent_name, agent_role, split_percentage, sort_order)
SELECT
  ct.id                                     AS transaction_id,
  ca.id                                     AS associate_id,
  sta.source_associate_id,
  COALESCE(ca.full_name, sta.associate_name) AS agent_name,
  COALESCE(NULLIF(TRIM(sta.agent_type), ''), 'Agent') AS agent_role,
  COALESCE(sta.split_percentage, 0),
  sta.sort_order
FROM staging.transaction_agents sta
JOIN staging.transactions_raw   str ON str.id = sta.transaction_id
JOIN migration.core_transactions ct  ON ct.source_transaction_id = str.source_transaction_id
LEFT JOIN migration.core_associates ca ON ca.source_associate_id = sta.source_associate_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- 11. migration.transaction_agent_calculations
--     Populated from staging.transaction_associate_payment_details
--     plus derived financial fields from core_transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.transaction_agent_calculations (
  id                          BIGSERIAL PRIMARY KEY,
  transaction_id              BIGINT,
  transaction_agent_id        BIGINT,
  associate_id                BIGINT,
  agent_name                  TEXT,
  office_name                 TEXT,
  transaction_side            TEXT,
  effective_reporting_date    DATE,
  is_registered               BOOLEAN DEFAULT false,
  split_percentage            NUMERIC(10,4),
  variance_sale_list_pct      NUMERIC(10,4),
  transaction_gci_before_fees NUMERIC(18,2),
  average_commission_pct      NUMERIC(10,4),
  production_royalties        NUMERIC(18,2),
  growth_share                NUMERIC(18,2),
  total_pr_and_gs             NUMERIC(18,2),
  gci_after_fees_excl_vat     NUMERIC(18,2),
  associate_dollar            NUMERIC(18,2),
  cap_amount                  NUMERIC(18,2),
  cap_remaining               NUMERIC(18,2),
  team_dollar                 NUMERIC(18,2),
  market_center_dollar        NUMERIC(18,2),
  is_outside_agent            BOOLEAN DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tac_tx         ON migration.transaction_agent_calculations (transaction_id);
CREATE INDEX IF NOT EXISTS idx_tac_ta         ON migration.transaction_agent_calculations (transaction_agent_id);
CREATE INDEX IF NOT EXISTS idx_tac_assoc      ON migration.transaction_agent_calculations (associate_id);
CREATE INDEX IF NOT EXISTS idx_tac_report_dt  ON migration.transaction_agent_calculations (effective_reporting_date);

-- Populate from staging payment details joined to migration agents
INSERT INTO migration.transaction_agent_calculations (
  transaction_id, transaction_agent_id, associate_id, agent_name, office_name,
  transaction_side, effective_reporting_date, is_registered,
  split_percentage, transaction_gci_before_fees,
  production_royalties, growth_share,
  total_pr_and_gs, gci_after_fees_excl_vat,
  associate_dollar, cap_remaining, team_dollar, market_center_dollar
)
SELECT
  ta.transaction_id,
  ta.id                                                         AS transaction_agent_id,
  ta.associate_id,
  ta.agent_name,
  mc.name                                                       AS office_name,
  COALESCE(NULLIF(TRIM(ct.sale_type), ''), ta.agent_role)       AS transaction_side,
  COALESCE(ct.status_change_date::date, ct.transaction_date::date, ct.created_at::date) AS effective_reporting_date,
  CASE WHEN LOWER(TRIM(COALESCE(ct.transaction_status, ''))) IN ('registered', 'paid') THEN true ELSE false END AS is_registered,
  tapd.split_percentage,
  tapd.gci_before_fees,
  tapd.production_royalties,
  tapd.growth_share,
  COALESCE(tapd.production_royalties, 0) + COALESCE(tapd.growth_share, 0) AS total_pr_and_gs,
  tapd.gci_after_fees_excl_vat,
  tapd.associate_dollar,
  tapd.cap_remaining,
  tapd.team_dollar,
  tapd.mc_dollar
FROM migration.transaction_agents ta
JOIN migration.core_transactions  ct  ON ct.id = ta.transaction_id
LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
LEFT JOIN staging.transaction_associate_payment_details tapd
  ON tapd.source_transaction_id = ct.source_transaction_id
  AND tapd.source_associate_id  = ta.source_associate_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- 12.  Associate sub-tables  –  empty stubs (write-on-demand by the API)
-- ============================================================

CREATE TABLE IF NOT EXISTS migration.associate_social_media (
  id            BIGSERIAL PRIMARY KEY,
  associate_id  BIGINT NOT NULL,
  platform      TEXT,
  url           TEXT,
  sort_order    INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assoc_social_media ON migration.associate_social_media (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_roles (
  id            BIGSERIAL PRIMARY KEY,
  associate_id  BIGINT NOT NULL,
  role_name     TEXT
);
CREATE INDEX IF NOT EXISTS idx_assoc_roles ON migration.associate_roles (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_job_titles (
  id            BIGSERIAL PRIMARY KEY,
  associate_id  BIGINT NOT NULL,
  job_title     TEXT
);
CREATE INDEX IF NOT EXISTS idx_assoc_job_titles ON migration.associate_job_titles (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_service_communities (
  id              BIGSERIAL PRIMARY KEY,
  associate_id    BIGINT NOT NULL,
  community_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_assoc_service_comm ON migration.associate_service_communities (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_admin_market_centers (
  id                      BIGSERIAL PRIMARY KEY,
  associate_id            BIGINT NOT NULL,
  source_market_center_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_assoc_admin_mc ON migration.associate_admin_market_centers (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_admin_teams (
  id              BIGSERIAL PRIMARY KEY,
  associate_id    BIGINT NOT NULL,
  source_team_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_assoc_admin_teams ON migration.associate_admin_teams (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_documents (
  id              BIGSERIAL PRIMARY KEY,
  associate_id    BIGINT NOT NULL,
  document_type   TEXT,
  document_name   TEXT,
  document_url    TEXT,
  uploaded_by     TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assoc_documents ON migration.associate_documents (associate_id);

CREATE TABLE IF NOT EXISTS migration.associate_notes (
  id            BIGSERIAL PRIMARY KEY,
  associate_id  BIGINT NOT NULL,
  note_type     TEXT,
  note_text     TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assoc_notes ON migration.associate_notes (associate_id);

-- ============================================================
-- 13.  Summary counts
-- ============================================================

SELECT 'migration.core_listings'                AS "table", COUNT(*) FROM migration.core_listings
UNION ALL SELECT 'migration.listing_agents',               COUNT(*) FROM migration.listing_agents
UNION ALL SELECT 'migration.listing_images',               COUNT(*) FROM migration.listing_images
UNION ALL SELECT 'migration.listing_marketing_urls',       COUNT(*) FROM migration.listing_marketing_urls
UNION ALL SELECT 'migration.listing_property_areas',       COUNT(*) FROM migration.listing_property_areas
UNION ALL SELECT 'migration.core_associates',              COUNT(*) FROM migration.core_associates
UNION ALL SELECT 'migration.core_market_centers',          COUNT(*) FROM migration.core_market_centers
UNION ALL SELECT 'migration.core_transactions',            COUNT(*) FROM migration.core_transactions
UNION ALL SELECT 'migration.transaction_agents',           COUNT(*) FROM migration.transaction_agents
UNION ALL SELECT 'migration.transaction_agent_calculations', COUNT(*) FROM migration.transaction_agent_calculations
ORDER BY 1;
