-- transform-staging-to-migration.sql
-- Transforms staging.* tables into migration.core_* tables.
-- Run AFTER load-staging-from-csv.cjs and BEFORE insert-migration-to-public.sql
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/transform-staging-to-migration.sql
-- Optional explicit batch:
--   psql "$DATABASE_URL" -c "SET migration.batch='azure-2026-05-01';" -f scripts/transform-staging-to-migration.sql
-- (defaults to the most recent batch_id when migration.batch is not set)

-- ── resolve batch ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_batch TEXT;
BEGIN
  v_batch := current_setting('migration.batch', true);
  IF v_batch IS NULL OR v_batch = '' THEN
    SELECT batch_id INTO v_batch FROM staging.associates_raw ORDER BY loaded_at DESC LIMIT 1;
  END IF;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'No data found in staging.associates_raw — run load-staging-from-csv.cjs first';
  END IF;
  PERFORM set_config('migration.batch', v_batch, false);
  RAISE NOTICE 'Using batch: %', v_batch;
END $$;

-- ============================================================
-- 1. MARKET CENTERS  →  migration.core_market_centers
-- ============================================================
INSERT INTO migration.core_market_centers (
    source_market_center_id,
    name,
    status_name,
    frontdoor_id
)
SELECT DISTINCT ON (source_market_center_id)
    source_market_center_id,
    name,
    status_name,
    frontdoor_id
FROM staging.market_centers_raw
WHERE batch_id = current_setting('migration.batch')
  AND source_market_center_id IS NOT NULL
ON CONFLICT (source_market_center_id) DO UPDATE
    SET name        = EXCLUDED.name,
        status_name = EXCLUDED.status_name,
        frontdoor_id= EXCLUDED.frontdoor_id,
        updated_at  = now();

-- id mapping
INSERT INTO migration.id_map_market_centers (source_market_center_id, core_market_center_id)
SELECT source_market_center_id, id
FROM   migration.core_market_centers
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. TEAMS  →  migration.core_teams
-- ============================================================
INSERT INTO migration.core_teams (
    source_team_id,
    source_market_center_id,
    market_center_id,
    name,
    status_name
)
SELECT DISTINCT ON (t.source_team_id)
    t.source_team_id,
    t.source_market_center_id,
    mc.id   AS market_center_id,
    t.name,
    t.status_name
FROM staging.teams_raw t
LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = t.source_market_center_id
WHERE t.batch_id = current_setting('migration.batch')
  AND t.source_team_id IS NOT NULL
ON CONFLICT (source_team_id) DO UPDATE
    SET name              = EXCLUDED.name,
        status_name       = EXCLUDED.status_name,
        market_center_id  = EXCLUDED.market_center_id,
        updated_at        = now();

INSERT INTO migration.id_map_teams (source_team_id, core_team_id)
SELECT source_team_id, id FROM migration.core_teams ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. ASSOCIATES  →  migration.core_associates
-- ============================================================
INSERT INTO migration.core_associates (
    source_associate_id,
    source_market_center_id,
    source_team_id,
    market_center_id,
    team_id,
    first_name,
    last_name,
    full_name,
    email,
    kwuid,
    status_name,
    national_id,
    ffc_number,
    private_email,
    mobile_number,
    office_number,
    proposed_growth_share_sponsor,
    temporary_growth_share_sponsor,
    vested,
    vesting_period_start_date,
    listing_approval_required,
    exclude_from_individual_reports
)
SELECT DISTINCT ON (a.source_associate_id)
    a.source_associate_id,
    a.raw_payload->>'source_market_center_id'                   AS source_market_center_id,
    a.raw_payload->>'source_team_id'                            AS source_team_id,
    mc.id                                                       AS market_center_id,
    t.id                                                        AS team_id,
    a.first_name,
    a.last_name,
    TRIM(COALESCE(a.first_name,'') || ' ' || COALESCE(a.last_name,'')) AS full_name,
    a.email,
    a.kwuid,
    a.status_name,
    a.raw_payload->>'national_id'                               AS national_id,
    a.raw_payload->>'ffc_number'                                AS ffc_number,
    a.raw_payload->>'private_email'                             AS private_email,
    a.raw_payload->>'mobile_number'                             AS mobile_number,
    a.raw_payload->>'office_number'                             AS office_number,
    a.raw_payload->>'proposed_growth_share_sponsor'             AS proposed_growth_share_sponsor,
    CASE LOWER(COALESCE(a.raw_payload->>'temporary_growth_share_sponsor',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE null END AS temporary_growth_share_sponsor,
    CASE LOWER(COALESCE(a.raw_payload->>'vested',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE null END AS vested,
    CASE
      WHEN NULLIF(a.raw_payload->>'vesting_start_period', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (a.raw_payload->>'vesting_start_period')::date
      ELSE NULL
    END                                                       AS vesting_period_start_date,
    CASE LOWER(COALESCE(a.raw_payload->>'listing_approval_required',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE null END AS listing_approval_required,
    CASE LOWER(COALESCE(a.raw_payload->>'exclude_from_individual_reports',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE null END AS exclude_from_individual_reports
FROM staging.associates_raw a
LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = a.raw_payload->>'source_market_center_id'
LEFT JOIN migration.core_teams          t  ON t.source_team_id  = a.raw_payload->>'source_team_id'
WHERE a.batch_id = current_setting('migration.batch')
  AND a.source_associate_id IS NOT NULL
ON CONFLICT (source_associate_id) DO UPDATE
    SET first_name                     = EXCLUDED.first_name,
        last_name                      = EXCLUDED.last_name,
        full_name                      = EXCLUDED.full_name,
        email                          = EXCLUDED.email,
        kwuid                          = EXCLUDED.kwuid,
        status_name                    = EXCLUDED.status_name,
        market_center_id               = EXCLUDED.market_center_id,
        team_id                        = EXCLUDED.team_id,
        national_id                    = EXCLUDED.national_id,
        ffc_number                     = EXCLUDED.ffc_number,
        private_email                  = EXCLUDED.private_email,
        mobile_number                  = EXCLUDED.mobile_number,
        office_number                  = EXCLUDED.office_number,
        proposed_growth_share_sponsor  = EXCLUDED.proposed_growth_share_sponsor,
        vested                         = EXCLUDED.vested,
        vesting_period_start_date      = EXCLUDED.vesting_period_start_date,
        listing_approval_required      = EXCLUDED.listing_approval_required,
        exclude_from_individual_reports= EXCLUDED.exclude_from_individual_reports,
        updated_at                     = now();

INSERT INTO migration.id_map_associates (source_associate_id, core_associate_id)
SELECT source_associate_id, id FROM migration.core_associates ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. LISTINGS  →  migration.core_listings
-- ============================================================
INSERT INTO migration.core_listings (
    source_listing_id,
    source_market_center_id,
    market_center_id,
    listing_number,
    status_name,
    sale_or_rent,
    street_number,
    street_name,
    suburb,
    city,
    province,
    country,
    price,
    expiry_date,
    property_title,
    short_title,
    property_description,
    agent_property_valuation,
    poa,
    no_transfer_duty,
    signed_date,
    on_market_since_date,
    rates_and_taxes,
    monthly_levy,
    mandate_type,
    listing_payload
)
SELECT DISTINCT ON (l.source_listing_id)
    l.source_listing_id,
    l.raw_payload->>'source_market_center_id'                   AS source_market_center_id,
    mc.id                                                       AS market_center_id,
    l.listing_number,
    l.status_name,
    l.sale_or_rent,
    l.street_number,
    l.street_name,
    l.suburb,
    l.city,
    l.province,
    l.country,
    l.price,
    CASE
      WHEN NULLIF(l.raw_payload->>'expiry_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (l.raw_payload->>'expiry_date')::date
      ELSE NULL
    END                                                       AS expiry_date,
    l.property_title,
    l.short_title,
    l.property_description,
    CASE
      WHEN NULLIF(l.raw_payload->>'agent_property_valuation','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (l.raw_payload->>'agent_property_valuation')::numeric
      ELSE NULL
    END                                                       AS agent_property_valuation,
    CASE LOWER(COALESCE(l.raw_payload->>'poa',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE false END AS poa,
    CASE LOWER(COALESCE(l.raw_payload->>'no_transfer_duty',''))
      WHEN 'true' THEN true WHEN 'false' THEN false ELSE false END AS no_transfer_duty,
    CASE
      WHEN NULLIF(l.raw_payload->>'signed_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (l.raw_payload->>'signed_date')::date
      ELSE NULL
    END                                                       AS signed_date,
    CASE
      WHEN NULLIF(l.raw_payload->>'on_market_since', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (l.raw_payload->>'on_market_since')::date
      ELSE NULL
    END                                                       AS on_market_since_date,
    CASE
      WHEN NULLIF(l.raw_payload->>'rates_taxes','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (l.raw_payload->>'rates_taxes')::numeric
      ELSE NULL
    END                                                       AS rates_and_taxes,
    CASE
      WHEN NULLIF(l.raw_payload->>'monthly_levy','') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (l.raw_payload->>'monthly_levy')::numeric
      ELSE NULL
    END                                                       AS monthly_levy,
    l.raw_payload->>'mandate_type'                              AS mandate_type,
    l.raw_payload                                               AS listing_payload
FROM staging.listings_raw l
LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = l.raw_payload->>'source_market_center_id'
WHERE l.batch_id = current_setting('migration.batch')
  AND l.source_listing_id IS NOT NULL
ON CONFLICT (source_listing_id) DO UPDATE
    SET listing_number         = EXCLUDED.listing_number,
        status_name            = EXCLUDED.status_name,
        sale_or_rent           = EXCLUDED.sale_or_rent,
        price                  = EXCLUDED.price,
        market_center_id       = EXCLUDED.market_center_id,
        agent_property_valuation = EXCLUDED.agent_property_valuation,
        poa                    = EXCLUDED.poa,
        no_transfer_duty       = EXCLUDED.no_transfer_duty,
        signed_date            = EXCLUDED.signed_date,
        on_market_since_date   = EXCLUDED.on_market_since_date,
        rates_and_taxes        = EXCLUDED.rates_and_taxes,
        monthly_levy           = EXCLUDED.monthly_levy,
        mandate_type           = EXCLUDED.mandate_type,
        listing_payload        = EXCLUDED.listing_payload,
        updated_at             = now();

INSERT INTO migration.id_map_listings (source_listing_id, core_listing_id)
SELECT source_listing_id, id FROM migration.core_listings ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. TRANSACTIONS  →  migration.core_transactions
-- ============================================================
INSERT INTO migration.core_transactions (
    source_transaction_id,
    source_associate_id,
    associate_id,
    market_center_id,
    transaction_number,
    transaction_status,
    source_listing_id,
    listing_number,
    address,
    suburb,
    city,
    sales_price,
    list_price,
    gci_excl_vat,
    split_percentage,
    sale_type,
    list_date,
    transaction_date,
    status_change_date,
    expected_date
)
SELECT DISTINCT ON (tr.source_transaction_id)
    tr.source_transaction_id,
    COALESCE(tr.source_associate_id, '')        AS source_associate_id,
    a.id                                        AS associate_id,
    mc.id                                       AS market_center_id,
    tr.transaction_number,
    tr.transaction_status,
    tr.source_listing_id,
    tr.listing_number,
    tr.address,
    tr.suburb,
    tr.city,
    tr.sales_price,
    tr.list_price,
    tr.gci_excl_vat,
    tr.split_percentage,
    tr.sale_type,
    tr.list_date,
    tr.transaction_date,
    tr.status_change_date,
    tr.expected_date
FROM staging.transactions_raw tr
LEFT JOIN migration.core_associates a  ON a.source_associate_id  = tr.source_associate_id
LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = tr.source_market_center_id
WHERE tr.batch_id = current_setting('migration.batch')
  AND tr.source_transaction_id IS NOT NULL
ON CONFLICT (source_transaction_id) DO UPDATE
    SET transaction_status  = EXCLUDED.transaction_status,
        sales_price         = EXCLUDED.sales_price,
        list_price          = EXCLUDED.list_price,
        gci_excl_vat        = EXCLUDED.gci_excl_vat,
        split_percentage    = EXCLUDED.split_percentage,
        transaction_date    = EXCLUDED.transaction_date,
        status_change_date  = EXCLUDED.status_change_date,
        expected_date       = EXCLUDED.expected_date,
        updated_at          = now();

-- ============================================================
-- summary
-- ============================================================
SELECT 'migration.core_market_centers' AS "table", COUNT(*) FROM migration.core_market_centers
UNION ALL
SELECT 'migration.core_teams',          COUNT(*) FROM migration.core_teams
UNION ALL
SELECT 'migration.core_associates',     COUNT(*) FROM migration.core_associates
UNION ALL
SELECT 'migration.core_listings',       COUNT(*) FROM migration.core_listings
UNION ALL
SELECT 'migration.core_transactions',   COUNT(*) FROM migration.core_transactions;
