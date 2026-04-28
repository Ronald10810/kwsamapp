-- insert-migration-to-public.sql
-- Promotes data from migration.core_* tables into the public Prisma tables.
-- Run AFTER transform-staging-to-migration.sql
--
-- Dependency order:
--   1. Seed reference/lookup tables
--   2. geography: countries → provinces → cities → suburbs
--   3. addresses
--   4. market_centers
--   5. teams
--   6. associates + contact details + business details
--   7. listings + price details + descriptions + mandate info
--   8. transactions + descriptions + agents + payment details
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/insert-migration-to-public.sql
--
-- SAFE TO RE-RUN: all inserts use ON CONFLICT DO NOTHING or DO UPDATE.

-- ============================================================
-- 1. REFERENCE / LOOKUP TABLES  (seed if empty)
-- ============================================================

-- market_center_statuses
INSERT INTO market_center_statuses (id, name) VALUES
  (1, 'Active'),
  (2, 'Inactive')
ON CONFLICT (id) DO NOTHING;

-- team_statuses
INSERT INTO team_statuses (id, name) VALUES
  (1, 'Active'),
  (2, 'Inactive')
ON CONFLICT (id) DO NOTHING;

-- associate_statuses
INSERT INTO associate_statuses (id, name) VALUES
  (1, 'Active'),
  (2, 'Inactive'),
  (3, 'Registration'),
  (4, 'Draft'),
  (5, 'Reactivation')
ON CONFLICT (id) DO NOTHING;

-- listing_statuses
INSERT INTO listing_statuses (id, name) VALUES
  (1, 'Active'),
  (2, 'Inactive'),
  (3, 'Draft')
ON CONFLICT (id) DO NOTHING;

-- listing_sale_or_rent_types
INSERT INTO listing_sale_or_rent_types (id, name) VALUES
  (1, 'For Sale'),
  (2, 'Procurement Rental'),
  (3, 'Management Rental')
ON CONFLICT (id) DO NOTHING;

-- listing_mandate_types
INSERT INTO listing_mandate_types (id, name) VALUES
  (1, 'Sole Mandate'),
  (2, 'Open Mandate'),
  (3, 'Dual Mandate'),
  (4, 'Multi Listing'),
  (5, 'Sole and Exclusive Mandate'),
  (6, 'No Mandate')
ON CONFLICT (id) DO NOTHING;

-- transaction_statuses (from legacy)
INSERT INTO transaction_statuses (id, name) VALUES
  (1, 'Pending'),
  (2, 'Active'),
  (3, 'Paid'),
  (4, 'Returned'),
  (5, 'Cancelled'),
  (6, 'Archived')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. GEOGRAPHY  (seed from distinct values in migration data)
-- ============================================================

-- countries
INSERT INTO countries (name, "updatedAt")
SELECT DISTINCT country
    , now()
FROM migration.core_listings
WHERE country IS NOT NULL AND country <> ''
ON CONFLICT DO NOTHING;

-- provinces
INSERT INTO provinces (name, "countryId", "updatedAt")
SELECT DISTINCT
    cl.province,
    c.id,
    now()
FROM migration.core_listings cl
JOIN countries c ON c.name = cl.country
WHERE cl.province IS NOT NULL AND cl.province <> ''
ON CONFLICT DO NOTHING;

-- cities
INSERT INTO cities (name, "provinceId", "updatedAt")
SELECT DISTINCT
    cl.city,
    p.id,
    now()
FROM migration.core_listings cl
JOIN provinces p ON p.name = cl.province
WHERE cl.city IS NOT NULL AND cl.city <> ''
ON CONFLICT DO NOTHING;

-- suburbs
INSERT INTO suburbs (name, "cityId", "updatedAt")
SELECT DISTINCT
    cl.suburb,
    ci.id,
    now()
FROM migration.core_listings cl
JOIN cities ci ON ci.name = cl.city
WHERE cl.suburb IS NOT NULL AND cl.suburb <> ''
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. ADDRESSES  (one per unique listing address)
-- ============================================================
-- Create a temporary mapping table for this run
CREATE TEMP TABLE IF NOT EXISTS _addr_map (
    source_listing_id   TEXT PRIMARY KEY,
    address_id          INT
);

-- Insert addresses for listings that don't have one yet
WITH new_addrs AS (
    INSERT INTO addresses (
        "streetNumber", "streetName", "suburbId", "cityId", "provinceId", "countryId", "updatedAt"
    )
    SELECT DISTINCT ON (cl.source_listing_id)
        COALESCE(cl.street_number, '')::TEXT,
        COALESCE(cl.street_name,   '')::TEXT,
        sb.id,
        ci.id,
        p.id,
        co.id,
        now()
    FROM migration.core_listings cl
    JOIN suburbs  sb ON sb.name = cl.suburb
    JOIN cities   ci ON ci.id   = sb."cityId"
    JOIN provinces p ON p.id    = ci."provinceId"
    JOIN countries co ON co.id  = p."countryId"
    WHERE NOT EXISTS (
        SELECT 1 FROM _addr_map m WHERE m.source_listing_id = cl.source_listing_id
    )
    RETURNING id, "streetNumber", "streetName"
)
SELECT 'Addresses inserted: ' || COUNT(*) FROM new_addrs;

-- Rebuild address map using street_number + street_name + suburb
INSERT INTO _addr_map (source_listing_id, address_id)
SELECT cl.source_listing_id, a.id
FROM migration.core_listings cl
JOIN suburbs  sb ON sb.name = cl.suburb
JOIN addresses a ON a."suburbId" = sb.id
    AND a."streetNumber" = COALESCE(cl.street_number,'')
    AND a."streetName"   = COALESCE(cl.street_name,'')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. MARKET CENTERS
-- ============================================================

-- Need a placeholder address for each MC (use first listing address in that MC if available)
CREATE TEMP TABLE IF NOT EXISTS _mc_addr AS
SELECT DISTINCT ON (mc.source_market_center_id)
    mc.source_market_center_id,
    a.id AS address_id
FROM migration.core_market_centers mc
JOIN migration.core_listings cl ON cl.source_market_center_id = mc.source_market_center_id
JOIN _addr_map am ON am.source_listing_id = cl.source_listing_id
JOIN addresses a ON a.id = am.address_id;

-- Fallback: for MCs with no listings, create a minimal address row
INSERT INTO addresses ("streetNumber","streetName","suburbId","cityId","provinceId","countryId", "updatedAt")
SELECT '', mc.name,
    (SELECT id FROM suburbs  LIMIT 1),
    (SELECT id FROM cities   LIMIT 1),
    (SELECT id FROM provinces LIMIT 1),
    (SELECT id FROM countries LIMIT 1),
    now()
FROM migration.core_market_centers mc
WHERE NOT EXISTS (SELECT 1 FROM _mc_addr a WHERE a.source_market_center_id = mc.source_market_center_id)
RETURNING id;

INSERT INTO _mc_addr (source_market_center_id, address_id)
SELECT mc.source_market_center_id,
    (SELECT MAX(id) FROM addresses WHERE "streetName" = mc.name)
FROM migration.core_market_centers mc
WHERE NOT EXISTS (SELECT 1 FROM _mc_addr a WHERE a.source_market_center_id = mc.source_market_center_id);

-- Upsert market_centers
INSERT INTO market_centers (name, "addressId", "statusId", "updatedAt")
SELECT
    mc.name,
    ma.address_id,
    COALESCE((
        SELECT id FROM market_center_statuses
        WHERE LOWER(name) = LOWER(COALESCE(mc.status_name,'Active'))
        LIMIT 1
    ), 1),
    now()
FROM migration.core_market_centers mc
JOIN _mc_addr ma ON ma.source_market_center_id = mc.source_market_center_id
ON CONFLICT DO NOTHING;

-- Build mc source → public id map
CREATE TEMP TABLE IF NOT EXISTS _pub_mc AS
SELECT DISTINCT ON (mc.source_market_center_id)
    mc.source_market_center_id, pm.id AS public_id
FROM migration.core_market_centers mc
JOIN market_centers pm ON pm.name = mc.name
ORDER BY mc.source_market_center_id, pm.id;

-- ============================================================
-- 5. TEAMS
-- ============================================================
INSERT INTO teams (name, "marketCenterId", "statusId", "updatedAt")
SELECT
    ct.name,
    pm.public_id,
    COALESCE((
        SELECT id FROM team_statuses
        WHERE LOWER(name) = LOWER(COALESCE(ct.status_name,'Active'))
        LIMIT 1
    ), 1),
    now()
FROM migration.core_teams ct
JOIN _pub_mc pm ON pm.source_market_center_id = ct.source_market_center_id
ON CONFLICT DO NOTHING;

-- Build team source → public id map
CREATE TEMP TABLE IF NOT EXISTS _pub_team AS
SELECT DISTINCT ON (ct.source_team_id)
       ct.source_team_id, pt.id AS public_id
FROM migration.core_teams ct
JOIN teams pt ON pt.name = ct.name AND pt."marketCenterId" = (
    SELECT public_id FROM _pub_mc WHERE source_market_center_id = ct.source_market_center_id
)
ORDER BY ct.source_team_id, pt.id;

-- ============================================================
-- 6. ASSOCIATES
-- ============================================================
INSERT INTO associates (
    "firstName", "lastName", "nationalId", "ffcNumber",
    "statusId", "marketCenterId", "teamId", "updatedAt"
)
SELECT
    ca.first_name,
    ca.last_name,
    ca.national_id,
    ca.ffc_number,
    COALESCE((
        SELECT id FROM associate_statuses
        WHERE LOWER(name) = LOWER(COALESCE(ca.status_name,'Active'))
        LIMIT 1
    ), 1),
    pm.public_id,
    pt.public_id,
    now()
FROM migration.core_associates ca
JOIN _pub_mc pm ON pm.source_market_center_id = ca.source_market_center_id
LEFT JOIN _pub_team pt ON pt.source_team_id = ca.source_team_id
ON CONFLICT DO NOTHING;

-- Build associate source → public id map
CREATE TEMP TABLE IF NOT EXISTS _pub_assoc AS
SELECT DISTINCT ON (ca.source_associate_id)
       ca.source_associate_id, pa.id AS public_id
FROM migration.core_associates ca
JOIN associates pa ON pa."firstName" = ca.first_name
    AND pa."lastName" = ca.last_name
    AND pa."marketCenterId" = (
        SELECT public_id FROM _pub_mc WHERE source_market_center_id = ca.source_market_center_id
    )
ORDER BY ca.source_associate_id, pa.id;

-- associate_contact_details
INSERT INTO associate_contact_details (
    "associateId", email, "privateEmail", phone, "updatedAt"
)
SELECT
    ap.public_id,
    ca.email,
    ca.private_email,
    ca.mobile_number,
    now()
FROM migration.core_associates ca
JOIN _pub_assoc ap ON ap.source_associate_id = ca.source_associate_id
WHERE ca.email IS NOT NULL OR ca.mobile_number IS NOT NULL
ON CONFLICT ("associateId") DO NOTHING;

-- associate_business_details
INSERT INTO associate_business_details (
    "associateId", kwuid,
    "proposedGrowthShareSponsor",
    "temporaryGrowthShareSponsor",
    vested, "vestingStartPeriod",
    "listingApprovalRequired",
    "excludeFromIndividualReports",
    "updatedAt"
)
SELECT
    ap.public_id,
    ca.kwuid,
    ca.proposed_growth_share_sponsor,
    COALESCE(ca.temporary_growth_share_sponsor, false),
    COALESCE(ca.vested, false),
    ca.vesting_period_start_date,
    COALESCE(ca.listing_approval_required, false),
    COALESCE(ca.exclude_from_individual_reports, false),
    now()
FROM migration.core_associates ca
JOIN _pub_assoc ap ON ap.source_associate_id = ca.source_associate_id
ON CONFLICT ("associateId") DO NOTHING;

-- ============================================================
-- 7. LISTINGS
-- ============================================================
INSERT INTO listings (
    "listingNumber",
    "addressId",
    "marketCenterId",
    "statusId",
    "saleOrRentTypeId",
    "mandateTypeId",
    "listingDate",
    "expiryDate",
    "updatedAt"
)
SELECT
    cl.listing_number,
    am.address_id,
    pm.public_id,
    COALESCE((
        SELECT id FROM listing_statuses
        WHERE LOWER(name) = LOWER(COALESCE(cl.status_name,'Active'))
        LIMIT 1
    ), 1),
    COALESCE((
        SELECT id FROM listing_sale_or_rent_types
        WHERE LOWER(name) LIKE '%' || LOWER(COALESCE(cl.sale_or_rent,'For Sale')) || '%'
        LIMIT 1
    ), 1),
    COALESCE((
        SELECT id FROM listing_mandate_types
        WHERE LOWER(name) = LOWER(COALESCE(cl.mandate_type,'No Mandate'))
        LIMIT 1
    ), 6),
    (cl.listing_payload->>'listing_date')::TIMESTAMP,
    cl.expiry_date,
    now()
FROM migration.core_listings cl
JOIN _addr_map am ON am.source_listing_id = cl.source_listing_id
JOIN _pub_mc   pm ON pm.source_market_center_id = cl.source_market_center_id
ON CONFLICT ("listingNumber") DO NOTHING;

-- Build listing source → public id map
CREATE TEMP TABLE IF NOT EXISTS _pub_listing AS
SELECT DISTINCT ON (cl.source_listing_id)
    cl.source_listing_id, pl.id AS public_id
FROM migration.core_listings cl
JOIN listings pl ON pl."listingNumber" = cl.listing_number
ORDER BY cl.source_listing_id, pl.id;

-- listing_price_details
INSERT INTO listing_price_details (
    "listingId", price, poa, "noTransferDuty", "agentPropertyValuation", "updatedAt"
)
SELECT
    lp.public_id,
    COALESCE(cl.price, 0),
    COALESCE(cl.poa, false),
    COALESCE(cl.no_transfer_duty, false),
    cl.agent_property_valuation,
    now()
FROM migration.core_listings cl
JOIN _pub_listing lp ON lp.source_listing_id = cl.source_listing_id
ON CONFLICT ("listingId") DO NOTHING;

-- listing_mandate_infos
INSERT INTO listing_mandate_infos (
    "listingId", "mandateTypeId", "signedDate", "onMarketSince",
    "ratesTaxes", "monthlyLevy", "updatedAt"
)
SELECT
    lp.public_id,
    COALESCE((
        SELECT id FROM listing_mandate_types
        WHERE LOWER(name) = LOWER(COALESCE(cl.mandate_type,'No Mandate'))
        LIMIT 1
    ), 6),
    cl.signed_date,
    cl.on_market_since_date,
    cl.rates_and_taxes,
    cl.monthly_levy,
    now()
FROM migration.core_listings cl
JOIN _pub_listing lp ON lp.source_listing_id = cl.source_listing_id
ON CONFLICT ("listingId") DO NOTHING;

-- listing_associates  (from staging.listings_raw raw_payload joining to listing_associates CSV)
-- Note: run load-staging-from-csv.cjs with listing_associates.csv for full data
INSERT INTO listing_associates ("listingId", "associateId", "isPrimary")
SELECT DISTINCT
    lp.public_id,
    ap.public_id,
    false
FROM staging.listings_raw lr
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(lr.raw_payload->'agents') = 'array'
         THEN lr.raw_payload->'agents' ELSE '[]'::jsonb END
) AS agent_id
JOIN _pub_listing  lp ON lp.source_listing_id = lr.source_listing_id
JOIN _pub_assoc    ap ON ap.source_associate_id = agent_id
ON CONFLICT ("listingId","associateId") DO NOTHING;

-- ============================================================
-- 8. TRANSACTIONS
-- ============================================================
INSERT INTO transactions (
    "transactionNumber",
    "listingId",
    "statusId",
    "updatedAt",
    "whenUpdated"
)
SELECT
    ct.transaction_number,
    lp.public_id,
    COALESCE((
        SELECT id FROM transaction_statuses
        WHERE LOWER(name) = LOWER(COALESCE(ct.transaction_status,'Active'))
        LIMIT 1
    ), 2),
    now(),
    now()
FROM migration.core_transactions ct
JOIN _pub_listing lp ON lp.source_listing_id = ct.source_listing_id
WHERE ct.transaction_number IS NOT NULL
ON CONFLICT DO NOTHING;

-- Build transaction source → public id map
CREATE TEMP TABLE IF NOT EXISTS _pub_tx AS
SELECT DISTINCT ON (ct.source_transaction_id)
    ct.source_transaction_id, pt.id AS public_id
FROM migration.core_transactions ct
JOIN transactions pt ON pt."transactionNumber" = ct.transaction_number
ORDER BY ct.source_transaction_id, pt.id;

-- transaction_descriptions
INSERT INTO transaction_descriptions (
    "transactionId",
    "soldPrice",
    "contractGCIExclVAT",
    "transactionDate",
    "soldDate",
    "expectedDate",
    "updatedAt"
)
SELECT
    tp.public_id,
    COALESCE(ct.sales_price, 0),
    COALESCE(ct.gci_excl_vat, 0),
    ct.transaction_date,
    ct.status_change_date,
    ct.expected_date,
    now()
FROM migration.core_transactions ct
JOIN _pub_tx tp ON tp.source_transaction_id = ct.source_transaction_id
ON CONFLICT ("transactionId") DO NOTHING;

-- transaction_associates (from staging)
INSERT INTO transaction_associates (
    "transactionId",
    "associateId",
    "transactionAssociateTypeId",
    "splitPercentage",
    "outsideAgency",
    "marketCenterId",
    "updatedAt"
)
SELECT
    tp.public_id,
    ap.public_id,
    1,  -- default type; update if transaction_associate_types are seeded
    COALESCE(ta.split_percentage, 0),
    ta.outside_agency,
    ap2."marketCenterId",
    now()
FROM staging.transaction_agents ta
JOIN staging.transactions_raw tr  ON tr.id = ta.transaction_id
JOIN _pub_tx    tp ON tp.source_transaction_id = tr.source_transaction_id
JOIN _pub_assoc ap ON ap.source_associate_id   = ta.source_associate_id
JOIN associates ap2 ON ap2.id = ap.public_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- final row counts
-- ============================================================
SELECT 'market_centers'   AS "table", COUNT(*) FROM market_centers
UNION ALL SELECT 'teams',              COUNT(*) FROM teams
UNION ALL SELECT 'associates',         COUNT(*) FROM associates
UNION ALL SELECT 'listings',           COUNT(*) FROM listings
UNION ALL SELECT 'transactions',       COUNT(*) FROM transactions
ORDER BY 1;
