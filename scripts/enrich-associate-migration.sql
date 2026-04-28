-- enrich-associate-migration.sql
-- Populates missing associate columns and sub-tables in migration.* from
-- the new staging tables loaded by load-associate-extras.cjs.
--
-- Run after:
--   1. export-azure-associate-extras.ps1  (exports CSVs)
--   2. load-associate-extras.cjs          (loads CSVs into staging)
--
-- Run with:
--   node scripts/run-sql.cjs scripts/enrich-associate-migration.sql

-- ── 1. Add missing columns to core_associates ──────────────────────────────

ALTER TABLE migration.core_associates
  ADD COLUMN IF NOT EXISTS property24_opt_in      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_property24_id    TEXT,
  ADD COLUMN IF NOT EXISTS property24_status      TEXT,
  ADD COLUMN IF NOT EXISTS entegral_opt_in        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_entegral_id      TEXT,
  ADD COLUMN IF NOT EXISTS entegral_status        TEXT,
  ADD COLUMN IF NOT EXISTS private_property_opt_in BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS private_property_status TEXT,
  ADD COLUMN IF NOT EXISTS cap                    NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS manual_cap             BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_split            NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS projected_cos          NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS projected_cap          NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS start_date             DATE,
  ADD COLUMN IF NOT EXISTS end_date               DATE,
  ADD COLUMN IF NOT EXISTS anniversary_date       DATE,
  ADD COLUMN IF NOT EXISTS cap_date               DATE,
  ADD COLUMN IF NOT EXISTS growth_share_sponsor   TEXT,
  ADD COLUMN IF NOT EXISTS temporary_growth_share_sponsor  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS proposed_growth_share_sponsor   TEXT,
  ADD COLUMN IF NOT EXISTS kwuid                  TEXT,
  ADD COLUMN IF NOT EXISTS vested                 BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vesting_period_start_date DATE,
  ADD COLUMN IF NOT EXISTS listing_approval_required      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exclude_from_individual_reports BOOLEAN DEFAULT FALSE;

-- ── 2. Populate third-party integration columns from staging ───────────────

UPDATE migration.core_associates ca
SET
  property24_opt_in   = CASE LOWER(COALESCE(s.feed_to_p24,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  agent_property24_id = NULLIF(TRIM(COALESCE(s.p24_agent_id,'')), ''),
  entegral_opt_in     = CASE LOWER(COALESCE(s.feed_to_entegral,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  agent_entegral_id   = NULLIF(TRIM(COALESCE(s.entegral_agent_id,'')), ''),
  entegral_status     = NULLIF(TRIM(COALESCE(s.entegral_sync_message,'')), '')
FROM staging.associate_third_party_raw s
WHERE s.source_associate_id IS NOT NULL
  AND ca.source_associate_id = s.source_associate_id;

-- ── 3. Populate commission columns from staging ────────────────────────────

UPDATE migration.core_associates ca
SET
  agent_split = CASE
    WHEN NULLIF(TRIM(COALESCE(s.commission_split_pct,'')), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN TRIM(s.commission_split_pct)::NUMERIC(18,2)
    ELSE NULL
  END,
  cap = CASE
    WHEN NULLIF(TRIM(COALESCE(s.total_cap_amount,'')), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN TRIM(s.total_cap_amount)::NUMERIC(18,2)
    ELSE NULL
  END,
  manual_cap = CASE LOWER(COALESCE(s.manual_cap,'')) WHEN 'true' THEN TRUE ELSE FALSE END
FROM staging.associate_commissions_raw s
WHERE s.source_associate_id IS NOT NULL
  AND ca.source_associate_id = s.source_associate_id;

-- ── 4. Populate date columns from staging ─────────────────────────────────

UPDATE migration.core_associates ca
SET
  start_date = CASE
    WHEN NULLIF(TRIM(COALESCE(s.start_date,'')), '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN SUBSTRING(TRIM(s.start_date), 1, 10)::DATE
    ELSE NULL
  END,
  end_date = CASE
    WHEN NULLIF(TRIM(COALESCE(s.end_date,'')), '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN SUBSTRING(TRIM(s.end_date), 1, 10)::DATE
    ELSE NULL
  END,
  anniversary_date = CASE
    WHEN NULLIF(TRIM(COALESCE(s.anniversary_date,'')), '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN SUBSTRING(TRIM(s.anniversary_date), 1, 10)::DATE
    ELSE NULL
  END,
  cap_date = CASE
    WHEN NULLIF(TRIM(COALESCE(s.cap_date,'')), '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN SUBSTRING(TRIM(s.cap_date), 1, 10)::DATE
    ELSE NULL
  END
FROM staging.associate_dates_raw s
WHERE s.source_associate_id IS NOT NULL
  AND ca.source_associate_id = s.source_associate_id;

-- ── 5. Populate business detail columns from associate_business_details_raw ─

-- Resolve growth_share_sponsor name from sponsor source id
UPDATE migration.core_associates ca
SET growth_share_sponsor = sponsor.full_name
FROM staging.associate_business_details_raw s
JOIN migration.core_associates sponsor
  ON sponsor.source_associate_id = s.growth_share_sponsor_source_id
WHERE s.source_associate_id IS NOT NULL
  AND ca.source_associate_id = s.source_associate_id
  AND NULLIF(TRIM(COALESCE(s.growth_share_sponsor_source_id,'')), '') IS NOT NULL;

-- Fill in the other business-detail fields from associate_business_details_raw
UPDATE migration.core_associates ca
SET
  kwuid = NULLIF(TRIM(COALESCE(s.kwuid,'')), ''),
  temporary_growth_share_sponsor = CASE LOWER(COALESCE(s.temporary_growth_share_sponsor,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  proposed_growth_share_sponsor  = NULLIF(TRIM(COALESCE(s.proposed_growth_share_sponsor,'')), ''),
  vested                         = CASE LOWER(COALESCE(s.vested,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  vesting_period_start_date      = CASE
    WHEN NULLIF(TRIM(COALESCE(s.vesting_start_period,'')), '') ~ '^\d{4}-\d{2}-\d{2}'
    THEN SUBSTRING(TRIM(s.vesting_start_period), 1, 10)::DATE
    ELSE NULL
  END,
  listing_approval_required      = CASE LOWER(COALESCE(s.listing_approval_required,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  exclude_from_individual_reports = CASE LOWER(COALESCE(s.exclude_from_individual_reports,'')) WHEN 'true' THEN TRUE ELSE FALSE END,
  source_market_center_id = COALESCE(NULLIF(TRIM(COALESCE(s.source_market_center_id,'')), ''), ca.source_market_center_id),
  source_team_id = COALESCE(NULLIF(TRIM(COALESCE(s.source_team_id,'')), ''), ca.source_team_id)
FROM staging.associate_business_details_raw s
WHERE s.source_associate_id IS NOT NULL
  AND ca.source_associate_id = s.source_associate_id;

-- ── 6. Create sub-tables if they don't exist (already done in enrich-migration-schema.sql
--       but CREATE IF NOT EXISTS is idempotent) ───────────────────────────

CREATE TABLE IF NOT EXISTS migration.associate_roles (
  id           SERIAL PRIMARY KEY,
  associate_id INTEGER NOT NULL,
  role_name    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.associate_job_titles (
  id           SERIAL PRIMARY KEY,
  associate_id INTEGER NOT NULL,
  job_title    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.associate_service_communities (
  id             SERIAL PRIMARY KEY,
  associate_id   INTEGER NOT NULL,
  community_name TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.associate_admin_market_centers (
  id                     SERIAL PRIMARY KEY,
  associate_id           INTEGER NOT NULL,
  source_market_center_id TEXT   NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.associate_admin_teams (
  id             SERIAL PRIMARY KEY,
  associate_id   INTEGER NOT NULL,
  source_team_id TEXT    NOT NULL
);

-- ── 7. Populate associate_roles from staging ───────────────────────────────

TRUNCATE migration.associate_roles;

INSERT INTO migration.associate_roles (associate_id, role_name)
SELECT ca.id, s.role_name
FROM staging.associate_roles_raw s
JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
WHERE s.role_name IS NOT NULL
  AND s.source_associate_id IS NOT NULL;

-- ── 8. Populate associate_job_titles from staging ──────────────────────────

TRUNCATE migration.associate_job_titles;

INSERT INTO migration.associate_job_titles (associate_id, job_title)
SELECT ca.id, s.job_title_name
FROM staging.associate_job_titles_raw s
JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
WHERE s.job_title_name IS NOT NULL
  AND s.source_associate_id IS NOT NULL;

-- ── 9. Populate associate_service_communities from staging ─────────────────

TRUNCATE migration.associate_service_communities;

INSERT INTO migration.associate_service_communities (associate_id, community_name)
SELECT ca.id, s.service_community_name
FROM staging.associate_service_communities_raw s
JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
WHERE s.service_community_name IS NOT NULL
  AND s.source_associate_id IS NOT NULL;

-- ── 10. Populate associate_admin_market_centers from staging ───────────────

TRUNCATE migration.associate_admin_market_centers;

INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id)
SELECT ca.id, s.source_market_center_id
FROM staging.associate_admin_market_centers_raw s
JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
WHERE s.source_market_center_id IS NOT NULL
  AND s.source_associate_id IS NOT NULL;

-- ── 11. Populate associate_admin_teams from staging ────────────────────────

TRUNCATE migration.associate_admin_teams;

INSERT INTO migration.associate_admin_teams (associate_id, source_team_id)
SELECT ca.id, s.source_team_id
FROM staging.associate_admin_teams_raw s
JOIN migration.core_associates ca ON ca.source_associate_id = s.source_associate_id
WHERE s.source_team_id IS NOT NULL
  AND s.source_associate_id IS NOT NULL;

-- ── 12. Summary ────────────────────────────────────────────────────────────

SELECT 'core_associates (with p24_opt_in populated)'      AS "table",
       COUNT(*) FILTER (WHERE property24_opt_in = TRUE)   AS "p24_opted_in",
       COUNT(*) FILTER (WHERE entegral_opt_in = TRUE)     AS "entegral_opted_in",
       COUNT(*) FILTER (WHERE cap IS NOT NULL)            AS "have_cap",
       COUNT(*) FILTER (WHERE agent_split IS NOT NULL)    AS "have_split",
       COUNT(*) FILTER (WHERE start_date IS NOT NULL)     AS "have_start_date"
FROM migration.core_associates;

SELECT 'associate_roles'              AS "table", COUNT(*) AS rows FROM migration.associate_roles
UNION ALL SELECT 'associate_job_titles',           COUNT(*) FROM migration.associate_job_titles
UNION ALL SELECT 'associate_service_communities',  COUNT(*) FROM migration.associate_service_communities
UNION ALL SELECT 'associate_admin_market_centers', COUNT(*) FROM migration.associate_admin_market_centers
UNION ALL SELECT 'associate_admin_teams',          COUNT(*) FROM migration.associate_admin_teams
ORDER BY 1;
