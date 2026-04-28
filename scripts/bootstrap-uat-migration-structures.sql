-- bootstrap-uat-migration-structures.sql
-- Creates the minimum staging.* and migration.* structures required by:
--   - load-staging-from-csv.cjs
--   - transform-staging-to-migration.sql
--   - insert-migration-to-public.sql

CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS migration;

-- =========================
-- staging raw tables
-- =========================

CREATE TABLE IF NOT EXISTS staging.market_centers_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_market_center_id TEXT,
  name TEXT,
  status_name TEXT,
  frontdoor_id TEXT,
  source_updated_at TIMESTAMPTZ,
  raw_payload JSONB,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_centers_raw_batch ON staging.market_centers_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_market_centers_raw_source ON staging.market_centers_raw(source_market_center_id);

CREATE TABLE IF NOT EXISTS staging.teams_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_team_id TEXT,
  source_market_center_id TEXT,
  name TEXT,
  status_name TEXT,
  source_updated_at TIMESTAMPTZ,
  raw_payload JSONB,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_raw_batch ON staging.teams_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_teams_raw_source ON staging.teams_raw(source_team_id);

CREATE TABLE IF NOT EXISTS staging.associates_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_associate_id TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  status_name TEXT,
  market_center_name TEXT,
  team_name TEXT,
  kwuid TEXT,
  source_updated_at TIMESTAMPTZ,
  raw_payload JSONB,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_associates_raw_batch ON staging.associates_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_associates_raw_source ON staging.associates_raw(source_associate_id);

CREATE TABLE IF NOT EXISTS staging.listings_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_listing_id TEXT,
  listing_number TEXT,
  status_name TEXT,
  market_center_name TEXT,
  sale_or_rent TEXT,
  street_number TEXT,
  street_name TEXT,
  suburb TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  price NUMERIC(18,2),
  expiry_date TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  property_title TEXT,
  short_title TEXT,
  property_description TEXT,
  listing_images_json JSONB,
  raw_payload JSONB,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_raw_batch ON staging.listings_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_listings_raw_source ON staging.listings_raw(source_listing_id);

CREATE TABLE IF NOT EXISTS staging.transactions_raw (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_transaction_id TEXT,
  transaction_number TEXT,
  source_market_center_id TEXT,
  market_center_name TEXT,
  source_associate_id TEXT,
  associate_name TEXT,
  transaction_status TEXT,
  source_listing_id TEXT,
  listing_number TEXT,
  list_date TIMESTAMPTZ,
  transaction_date TIMESTAMPTZ,
  status_change_date TIMESTAMPTZ,
  expected_date TIMESTAMPTZ,
  transaction_type TEXT,
  address TEXT,
  suburb TEXT,
  city TEXT,
  sales_price NUMERIC(18,2),
  list_price NUMERIC(18,2),
  gci_excl_vat NUMERIC(18,2),
  split_percentage NUMERIC(10,4),
  net_comm NUMERIC(18,2),
  total_gci NUMERIC(18,2),
  sale_type TEXT,
  agent_type TEXT,
  buyer TEXT,
  seller TEXT,
  raw_payload JSONB,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_raw_batch ON staging.transactions_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_raw_source ON staging.transactions_raw(source_transaction_id);

CREATE TABLE IF NOT EXISTS staging.transaction_agents (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,
  source_associate_id TEXT,
  associate_name TEXT,
  split_percentage NUMERIC(10,4),
  agent_type TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_agents_tx ON staging.transaction_agents(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_agents_assoc ON staging.transaction_agents(source_associate_id);

-- Optional supporting staging tables for completeness
CREATE TABLE IF NOT EXISTS staging.transaction_associate_payment_details (
  id BIGSERIAL PRIMARY KEY,
  source_transaction_id TEXT,
  source_associate_id TEXT,
  split_percentage NUMERIC(10,4),
  gci_before_fees NUMERIC(18,2),
  production_royalties NUMERIC(18,2),
  growth_share NUMERIC(18,2),
  gci_after_fees_excl_vat NUMERIC(18,2),
  cap_remaining NUMERIC(18,2),
  associate_dollar NUMERIC(18,2),
  team_dollar NUMERIC(18,2),
  mc_dollar NUMERIC(18,2),
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.listing_associates (
  id BIGSERIAL PRIMARY KEY,
  source_listing_id TEXT,
  source_associate_id TEXT,
  associate_name TEXT,
  is_primary BOOLEAN,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- migration core tables
-- =========================

CREATE TABLE IF NOT EXISTS migration.core_market_centers (
  id BIGSERIAL PRIMARY KEY,
  source_market_center_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status_name TEXT,
  frontdoor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration.core_teams (
  id BIGSERIAL PRIMARY KEY,
  source_team_id TEXT NOT NULL UNIQUE,
  source_market_center_id TEXT,
  market_center_id BIGINT,
  name TEXT NOT NULL,
  status_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration.core_associates (
  id BIGSERIAL PRIMARY KEY,
  source_associate_id TEXT NOT NULL UNIQUE,
  source_market_center_id TEXT,
  source_team_id TEXT,
  market_center_id BIGINT,
  team_id BIGINT,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT,
  status_name TEXT,
  kwuid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  national_id TEXT,
  ffc_number TEXT,
  private_email TEXT,
  mobile_number TEXT,
  office_number TEXT,
  proposed_growth_share_sponsor TEXT,
  temporary_growth_share_sponsor BOOLEAN,
  vested BOOLEAN DEFAULT false NOT NULL,
  vesting_period_start_date DATE,
  listing_approval_required BOOLEAN DEFAULT false NOT NULL,
  exclude_from_individual_reports BOOLEAN DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.core_listings (
  id BIGSERIAL PRIMARY KEY,
  source_listing_id TEXT NOT NULL UNIQUE,
  source_market_center_id TEXT,
  market_center_id BIGINT,
  listing_number TEXT,
  status_name TEXT,
  sale_or_rent TEXT,
  street_number TEXT,
  street_name TEXT,
  suburb TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  price NUMERIC(18,2),
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  property_title TEXT,
  short_title TEXT,
  property_description TEXT,
  listing_images_json JSONB,
  listing_payload JSONB,
  agent_property_valuation NUMERIC(18,2),
  poa BOOLEAN DEFAULT false NOT NULL,
  no_transfer_duty BOOLEAN DEFAULT false NOT NULL,
  signed_date DATE,
  on_market_since_date DATE,
  rates_and_taxes NUMERIC(18,2),
  monthly_levy NUMERIC(18,2),
  mandate_type TEXT
);

CREATE TABLE IF NOT EXISTS migration.core_transactions (
  id BIGSERIAL PRIMARY KEY,
  source_transaction_id TEXT NOT NULL UNIQUE,
  source_associate_id TEXT NOT NULL DEFAULT '',
  associate_id BIGINT,
  market_center_id BIGINT,
  transaction_number TEXT,
  transaction_status TEXT,
  transaction_type TEXT,
  source_listing_id TEXT,
  listing_number TEXT,
  address TEXT,
  suburb TEXT,
  city TEXT,
  sales_price NUMERIC(18,2),
  list_price NUMERIC(18,2),
  gci_excl_vat NUMERIC(18,2),
  split_percentage NUMERIC(10,4),
  net_comm NUMERIC(18,2),
  total_gci NUMERIC(18,2),
  sale_type TEXT,
  agent_type TEXT,
  buyer TEXT,
  seller TEXT,
  list_date TIMESTAMPTZ,
  transaction_date TIMESTAMPTZ,
  status_change_date TIMESTAMPTZ,
  expected_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  primary_market_center_id BIGINT
);

-- =========================
-- migration id maps
-- =========================

CREATE TABLE IF NOT EXISTS migration.id_map_market_centers (
  source_market_center_id TEXT PRIMARY KEY,
  core_market_center_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.id_map_teams (
  source_team_id TEXT PRIMARY KEY,
  core_team_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.id_map_associates (
  source_associate_id TEXT PRIMARY KEY,
  core_associate_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration.id_map_listings (
  source_listing_id TEXT PRIMARY KEY,
  core_listing_id BIGINT NOT NULL
);