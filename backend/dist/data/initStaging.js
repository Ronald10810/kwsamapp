import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      CREATE SCHEMA IF NOT EXISTS staging;
      CREATE SCHEMA IF NOT EXISTS migration;

      CREATE TABLE IF NOT EXISTS staging.associates_raw (
        id BIGSERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_associate_id TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        status_name TEXT,
        market_center_name TEXT,
        team_name TEXT,
        kwuid TEXT,
        source_updated_at TIMESTAMPTZ,
        raw_payload JSONB,
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_associates_raw_source
        ON staging.associates_raw(source_associate_id);
      CREATE INDEX IF NOT EXISTS idx_associates_raw_batch
        ON staging.associates_raw(batch_id);

      CREATE TABLE IF NOT EXISTS staging.market_centers_raw (
        id BIGSERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_market_center_id TEXT NOT NULL,
        name TEXT,
        status_name TEXT,
        frontdoor_id TEXT,
        source_updated_at TIMESTAMPTZ,
        raw_payload JSONB,
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_market_centers_raw_source
        ON staging.market_centers_raw(source_market_center_id);
      CREATE INDEX IF NOT EXISTS idx_market_centers_raw_batch
        ON staging.market_centers_raw(batch_id);

      CREATE TABLE IF NOT EXISTS staging.teams_raw (
        id BIGSERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_team_id TEXT NOT NULL,
        source_market_center_id TEXT,
        name TEXT,
        status_name TEXT,
        source_updated_at TIMESTAMPTZ,
        raw_payload JSONB,
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_teams_raw_source
        ON staging.teams_raw(source_team_id);
      CREATE INDEX IF NOT EXISTS idx_teams_raw_mc
        ON staging.teams_raw(source_market_center_id);
      CREATE INDEX IF NOT EXISTS idx_teams_raw_batch
        ON staging.teams_raw(batch_id);

      CREATE TABLE IF NOT EXISTS staging.listings_raw (
        id BIGSERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_listing_id TEXT NOT NULL,
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
        price NUMERIC(18, 2),
        expiry_date DATE,
        source_updated_at TIMESTAMPTZ,
        property_title TEXT,
        short_title TEXT,
        property_description TEXT,
        listing_images_json JSONB,
        raw_payload JSONB,
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_listings_raw_source
        ON staging.listings_raw(source_listing_id);
      CREATE INDEX IF NOT EXISTS idx_listings_raw_batch
        ON staging.listings_raw(batch_id);

      CREATE TABLE IF NOT EXISTS migration.associates_prepared (
        source_associate_id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT,
        email TEXT,
        status_name TEXT,
        market_center_name TEXT,
        team_name TEXT,
        kwuid TEXT,
        last_seen_at TIMESTAMPTZ,
        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.listings_prepared (
        source_listing_id TEXT PRIMARY KEY,
        listing_number TEXT,
        status_name TEXT,
        market_center_name TEXT,
        sale_or_rent TEXT,
        address_line TEXT,
        erf_number TEXT,
        unit_number TEXT,
        door_number TEXT,
        estate_name TEXT,
        street_number TEXT,
        street_name TEXT,
        postal_code TEXT,
        suburb TEXT,
        city TEXT,
        province TEXT,
        country TEXT,
        longitude NUMERIC(10, 7),
        latitude NUMERIC(10, 7),
        price NUMERIC(18, 2),
        expiry_date DATE,
        property_title TEXT,
        short_title TEXT,
        property_description TEXT,
        listing_images_json JSONB,
        listing_payload JSONB,
        last_seen_at TIMESTAMPTZ,
        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.market_centers_prepared (
        source_market_center_id TEXT PRIMARY KEY,
        name TEXT,
        status_name TEXT,
        frontdoor_id TEXT,
        company_registered_name TEXT,
        address_source_id TEXT,
        logo_document_id TEXT,
        contact_number TEXT,
        contact_email TEXT,
        kw_office_id TEXT,
        last_seen_at TIMESTAMPTZ,
        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.teams_prepared (
        source_team_id TEXT PRIMARY KEY,
        source_market_center_id TEXT,
        name TEXT,
        status_name TEXT,
        last_seen_at TIMESTAMPTZ,
        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.load_rejections (
        id BIGSERIAL PRIMARY KEY,
        entity_name TEXT NOT NULL,
        source_id TEXT,
        reason TEXT NOT NULL,
        payload JSONB,
        rejected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_market_centers (
        source_market_center_id TEXT PRIMARY KEY,
        core_market_center_id BIGINT NOT NULL,
        mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_teams (
        source_team_id TEXT PRIMARY KEY,
        core_team_id BIGINT NOT NULL,
        mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_associates (
        source_associate_id TEXT PRIMARY KEY,
        core_associate_id BIGINT NOT NULL,
        mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_listings (
        source_listing_id TEXT PRIMARY KEY,
        core_listing_id BIGINT NOT NULL,
        mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_legacy_market_centers (
        source_market_center_id TEXT PRIMARY KEY,
        legacy_market_center_id TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_legacy_associates (
        source_associate_id TEXT PRIMARY KEY,
        legacy_associate_id TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.id_map_legacy_listings (
        source_listing_id TEXT PRIMARY KEY,
        legacy_listing_id TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.core_market_centers (
        id BIGSERIAL PRIMARY KEY,
        source_market_center_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status_name TEXT,
        frontdoor_id TEXT,
        company_registered_name TEXT,
        address_source_id TEXT,
        logo_document_id TEXT,
        contact_number TEXT,
        contact_email TEXT,
        kw_office_id TEXT,
        has_individual_cap BOOLEAN NOT NULL DEFAULT false,
        agent_default_cap NUMERIC(18,2),
        market_center_default_split NUMERIC(10,4),
        agent_default_split NUMERIC(10,4),
        productivity_coach TEXT,
        property24_opt_in BOOLEAN NOT NULL DEFAULT false,
        property24_auction_approved BOOLEAN NOT NULL DEFAULT false,
        market_center_property24_id TEXT,
        private_property_id TEXT,
        entegral_opt_in BOOLEAN NOT NULL DEFAULT false,
        entegral_url TEXT,
        entegral_portals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        logo_image_url TEXT,
        country TEXT,
        province TEXT,
        city TEXT,
        suburb TEXT,
        erf_number TEXT,
        unit_number TEXT,
        door_number TEXT,
        estate_name TEXT,
        street_number TEXT,
        street_name TEXT,
        postal_code TEXT,
        longitude NUMERIC(10,7),
        latitude NUMERIC(10,7),
        override_display_location BOOLEAN NOT NULL DEFAULT false,
        display_longitude NUMERIC(10,7),
        display_latitude NUMERIC(10,7),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.core_teams (
        id BIGSERIAL PRIMARY KEY,
        source_team_id TEXT NOT NULL UNIQUE,
        source_market_center_id TEXT,
        market_center_id BIGINT REFERENCES migration.core_market_centers(id),
        name TEXT NOT NULL,
        status_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.core_associates (
        id BIGSERIAL PRIMARY KEY,
        source_associate_id TEXT NOT NULL UNIQUE,
        source_market_center_id TEXT,
        source_team_id TEXT,
        market_center_id BIGINT REFERENCES migration.core_market_centers(id),
        team_id BIGINT REFERENCES migration.core_teams(id),
        first_name TEXT,
        last_name TEXT,
        full_name TEXT,
        email TEXT,
        status_name TEXT,
        kwuid TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.core_listings (
        id BIGSERIAL PRIMARY KEY,
        source_listing_id TEXT NOT NULL UNIQUE,
        source_market_center_id TEXT,
        market_center_id BIGINT REFERENCES migration.core_market_centers(id),
        listing_number TEXT,
        status_name TEXT,
        sale_or_rent TEXT,
        address_line TEXT,
        suburb TEXT,
        city TEXT,
        province TEXT,
        country TEXT,
        price NUMERIC(18,2),
        expiry_date DATE,
        property_title TEXT,
        short_title TEXT,
        property_description TEXT,
        listing_images_json JSONB,
        listing_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_social_media (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        platform TEXT,
        url TEXT,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_roles (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        role_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_job_titles (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        job_title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_service_communities (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        community_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_admin_market_centers (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        source_market_center_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_admin_teams (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        source_team_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_documents (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL,
        document_name TEXT,
        document_url TEXT,
        uploaded_by TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.associate_notes (
        id BIGSERIAL PRIMARY KEY,
        associate_id BIGINT NOT NULL REFERENCES migration.core_associates(id) ON DELETE CASCADE,
        note_type TEXT NOT NULL,
        note_text TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.market_center_notes (
        id BIGSERIAL PRIMARY KEY,
        market_center_id BIGINT NOT NULL REFERENCES migration.core_market_centers(id) ON DELETE CASCADE,
        note_text TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_associate_social_media_associate
        ON migration.associate_social_media(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_roles_associate
        ON migration.associate_roles(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_job_titles_associate
        ON migration.associate_job_titles(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_service_communities_associate
        ON migration.associate_service_communities(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_admin_market_centers_associate
        ON migration.associate_admin_market_centers(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_admin_teams_associate
        ON migration.associate_admin_teams(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_documents_associate
        ON migration.associate_documents(associate_id);
      CREATE INDEX IF NOT EXISTS idx_associate_notes_associate
        ON migration.associate_notes(associate_id);
      CREATE INDEX IF NOT EXISTS idx_market_center_notes_market_center
        ON migration.market_center_notes(market_center_id);
    `);
    });
    // Add new columns idempotently (safe to run multiple times)
    await runInTransaction(async (client) => {
        await client.query(`
      ALTER TABLE migration.associates_prepared
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS mobile_number TEXT,
        ADD COLUMN IF NOT EXISTS office_number TEXT,
        ADD COLUMN IF NOT EXISTS national_id TEXT,
        ADD COLUMN IF NOT EXISTS ffc_number TEXT,
        ADD COLUMN IF NOT EXISTS kwsa_email TEXT,
        ADD COLUMN IF NOT EXISTS private_email TEXT,
        ADD COLUMN IF NOT EXISTS growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS proposed_growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS temporary_growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS end_date DATE,
        ADD COLUMN IF NOT EXISTS anniversary_date DATE,
        ADD COLUMN IF NOT EXISTS cap_date DATE,
        ADD COLUMN IF NOT EXISTS total_cap_amount NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS manual_cap NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS agent_split NUMERIC(10,4);

      ALTER TABLE migration.core_associates
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS mobile_number TEXT,
        ADD COLUMN IF NOT EXISTS national_id TEXT,
        ADD COLUMN IF NOT EXISTS ffc_number TEXT,
        ADD COLUMN IF NOT EXISTS kwsa_email TEXT,
        ADD COLUMN IF NOT EXISTS private_email TEXT,
        ADD COLUMN IF NOT EXISTS office_number TEXT,
        ADD COLUMN IF NOT EXISTS growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS temporary_growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS proposed_growth_share_sponsor TEXT,
        ADD COLUMN IF NOT EXISTS vested BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS vesting_period_start_date DATE,
        ADD COLUMN IF NOT EXISTS listing_approval_required BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS exclude_from_individual_reports BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS property24_opt_in BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS agent_property24_id TEXT,
        ADD COLUMN IF NOT EXISTS property24_status TEXT,
        ADD COLUMN IF NOT EXISTS entegral_opt_in BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS agent_entegral_id TEXT,
        ADD COLUMN IF NOT EXISTS entegral_status TEXT,
        ADD COLUMN IF NOT EXISTS private_property_opt_in BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS private_property_status TEXT,
        ADD COLUMN IF NOT EXISTS cap NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS manual_cap NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS agent_split NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS projected_cos NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS projected_cap NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS end_date DATE,
        ADD COLUMN IF NOT EXISTS anniversary_date DATE,
        ADD COLUMN IF NOT EXISTS cap_date DATE;

      ALTER TABLE migration.market_centers_prepared
        ADD COLUMN IF NOT EXISTS company_registered_name TEXT,
        ADD COLUMN IF NOT EXISTS address_source_id TEXT,
        ADD COLUMN IF NOT EXISTS logo_document_id TEXT,
        ADD COLUMN IF NOT EXISTS contact_number TEXT,
        ADD COLUMN IF NOT EXISTS contact_email TEXT,
        ADD COLUMN IF NOT EXISTS kw_office_id TEXT;

      ALTER TABLE migration.core_market_centers
        ADD COLUMN IF NOT EXISTS company_registered_name TEXT,
        ADD COLUMN IF NOT EXISTS address_source_id TEXT,
        ADD COLUMN IF NOT EXISTS logo_document_id TEXT,
        ADD COLUMN IF NOT EXISTS contact_number TEXT,
        ADD COLUMN IF NOT EXISTS contact_email TEXT,
        ADD COLUMN IF NOT EXISTS kw_office_id TEXT,
        ADD COLUMN IF NOT EXISTS has_individual_cap BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS agent_default_cap NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS market_center_default_split NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS agent_default_split NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS productivity_coach TEXT,
        ADD COLUMN IF NOT EXISTS property24_opt_in BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS property24_auction_approved BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS market_center_property24_id TEXT,
        ADD COLUMN IF NOT EXISTS private_property_id TEXT,
        ADD COLUMN IF NOT EXISTS entegral_opt_in BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS entegral_url TEXT,
        ADD COLUMN IF NOT EXISTS entegral_portals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        ADD COLUMN IF NOT EXISTS logo_image_url TEXT,
        ADD COLUMN IF NOT EXISTS country TEXT,
        ADD COLUMN IF NOT EXISTS province TEXT,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS suburb TEXT,
        ADD COLUMN IF NOT EXISTS erf_number TEXT,
        ADD COLUMN IF NOT EXISTS unit_number TEXT,
        ADD COLUMN IF NOT EXISTS door_number TEXT,
        ADD COLUMN IF NOT EXISTS estate_name TEXT,
        ADD COLUMN IF NOT EXISTS street_number TEXT,
        ADD COLUMN IF NOT EXISTS street_name TEXT,
        ADD COLUMN IF NOT EXISTS postal_code TEXT,
        ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS override_display_location BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS display_longitude NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS display_latitude NUMERIC(10,7);

      ALTER TABLE staging.listings_raw
        ADD COLUMN IF NOT EXISTS property_title TEXT,
        ADD COLUMN IF NOT EXISTS short_title TEXT,
        ADD COLUMN IF NOT EXISTS property_description TEXT,
        ADD COLUMN IF NOT EXISTS listing_images_json JSONB;

      ALTER TABLE migration.listings_prepared
        ADD COLUMN IF NOT EXISTS property_title TEXT,
        ADD COLUMN IF NOT EXISTS short_title TEXT,
        ADD COLUMN IF NOT EXISTS property_description TEXT,
        ADD COLUMN IF NOT EXISTS listing_images_json JSONB,
        ADD COLUMN IF NOT EXISTS listing_payload JSONB,
        ADD COLUMN IF NOT EXISTS erf_number TEXT,
        ADD COLUMN IF NOT EXISTS unit_number TEXT,
        ADD COLUMN IF NOT EXISTS door_number TEXT,
        ADD COLUMN IF NOT EXISTS estate_name TEXT,
        ADD COLUMN IF NOT EXISTS street_number TEXT,
        ADD COLUMN IF NOT EXISTS street_name TEXT,
        ADD COLUMN IF NOT EXISTS postal_code TEXT,
        ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
        ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);

      ALTER TABLE migration.core_listings
        ADD COLUMN IF NOT EXISTS property_title TEXT,
        ADD COLUMN IF NOT EXISTS short_title TEXT,
        ADD COLUMN IF NOT EXISTS property_description TEXT,
        ADD COLUMN IF NOT EXISTS listing_images_json JSONB,
        ADD COLUMN IF NOT EXISTS listing_payload JSONB;
    `);
    });
    // Transactions staging + core tables
    await runInTransaction(async (client) => {
        await client.query(`
      CREATE TABLE IF NOT EXISTS staging.transactions_raw (
        id BIGSERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_transaction_id TEXT NOT NULL,
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
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_raw_source
        ON staging.transactions_raw(source_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_raw_batch
        ON staging.transactions_raw(batch_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_raw_mc
        ON staging.transactions_raw(source_market_center_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_raw_associate
        ON staging.transactions_raw(source_associate_id);

      CREATE TABLE IF NOT EXISTS staging.transaction_agents (
        id BIGSERIAL PRIMARY KEY,
        transaction_id BIGINT REFERENCES staging.transactions_raw(id) ON DELETE CASCADE,
        source_associate_id TEXT,
        associate_name TEXT,
        split_percentage NUMERIC(10,4),
        agent_type TEXT,
        sort_order INT DEFAULT 0,
        loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_staging_transaction_agents_tx
        ON staging.transaction_agents(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_staging_transaction_agents_associate
        ON staging.transaction_agents(source_associate_id);

      CREATE TABLE IF NOT EXISTS migration.transactions_prepared (
        source_transaction_id TEXT NOT NULL,
        source_associate_id TEXT NOT NULL DEFAULT '',
        transaction_number TEXT,
        source_market_center_id TEXT,
        market_center_name TEXT,
        associate_name TEXT,
        transaction_status TEXT,
        source_listing_id TEXT,
        listing_number TEXT,
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
        list_date TIMESTAMPTZ,
        transaction_date TIMESTAMPTZ,
        status_change_date TIMESTAMPTZ,
        expected_date TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_transaction_id, source_associate_id)
      );

      CREATE TABLE IF NOT EXISTS migration.core_transactions (
        id BIGSERIAL PRIMARY KEY,
        source_transaction_id TEXT NOT NULL UNIQUE,
        primary_market_center_id BIGINT REFERENCES migration.core_market_centers(id),
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
        net_comm NUMERIC(18,2),
        total_gci NUMERIC(18,2),
        sale_type TEXT,
        buyer TEXT,
        seller TEXT,
        list_date TIMESTAMPTZ,
        transaction_date TIMESTAMPTZ,
        status_change_date TIMESTAMPTZ,
        expected_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS migration.transaction_agents (
        id BIGSERIAL PRIMARY KEY,
        transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
        associate_id BIGINT REFERENCES migration.core_associates(id),
        source_associate_id TEXT,
        agent_role TEXT,
        split_percentage NUMERIC(10,4),
        net_comm NUMERIC(18,2),
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (transaction_id, source_associate_id)
      );

      CREATE INDEX IF NOT EXISTS idx_core_transactions_date
        ON migration.core_transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_core_transactions_status
        ON migration.core_transactions(transaction_status);
      CREATE INDEX IF NOT EXISTS idx_transaction_agents_transaction
        ON migration.transaction_agents(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_agents_associate
        ON migration.transaction_agents(associate_id);
    `);
        // Ensure new columns exist on core_transactions (idempotent migration for older DBs)
        await client.query(`
      ALTER TABLE migration.core_transactions
        ADD COLUMN IF NOT EXISTS primary_market_center_id BIGINT REFERENCES migration.core_market_centers(id);
    `);
        // Outside agency contacts table
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.outside_agency_contacts (
        id BIGSERIAL PRIMARY KEY,
        transaction_agent_id BIGINT REFERENCES migration.transaction_agents(id) ON DELETE CASCADE,
        transaction_id BIGINT REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        phone TEXT,
        agency_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_outside_agency_tx
        ON migration.outside_agency_contacts(transaction_id);

      CREATE TABLE IF NOT EXISTS migration.transaction_agent_calculations (
        id BIGSERIAL PRIMARY KEY,
        transaction_agent_id BIGINT NOT NULL UNIQUE REFERENCES migration.transaction_agents(id) ON DELETE CASCADE,
        transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
        associate_id BIGINT REFERENCES migration.core_associates(id),
        source_associate_id TEXT,
        is_outside_agent BOOLEAN NOT NULL DEFAULT false,
        agent_name TEXT,
        office_name TEXT,
        transaction_side TEXT,
        split_percentage NUMERIC(10,4) NOT NULL DEFAULT 0,
        variance_sale_list_pct NUMERIC(12,6) NOT NULL DEFAULT 0,
        sales_value_component NUMERIC(18,2) NOT NULL DEFAULT 0,
        transaction_gci_before_fees NUMERIC(18,2) NOT NULL DEFAULT 0,
        average_commission_pct NUMERIC(12,6) NOT NULL DEFAULT 0,
        production_royalties NUMERIC(18,2) NOT NULL DEFAULT 0,
        growth_share NUMERIC(18,2) NOT NULL DEFAULT 0,
        total_pr_and_gs NUMERIC(18,2) NOT NULL DEFAULT 0,
        gci_after_fees_excl_vat NUMERIC(18,2) NOT NULL DEFAULT 0,
        associate_split_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
        market_center_split_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
        associate_dollar NUMERIC(18,2) NOT NULL DEFAULT 0,
        cap_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        cap_contribution NUMERIC(18,2) NOT NULL DEFAULT 0,
        cap_remaining NUMERIC(18,2) NOT NULL DEFAULT 0,
        team_dollar NUMERIC(18,2) NOT NULL DEFAULT 0,
        market_center_dollar NUMERIC(18,2) NOT NULL DEFAULT 0,
        cap_cycle_start_date DATE,
        cap_cycle_end_date DATE,
        effective_reporting_date DATE,
        is_registered BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tx_calc_transaction_id
        ON migration.transaction_agent_calculations(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_tx_calc_associate_id
        ON migration.transaction_agent_calculations(associate_id);
      CREATE INDEX IF NOT EXISTS idx_tx_calc_reporting_date
        ON migration.transaction_agent_calculations(effective_reporting_date);
      CREATE INDEX IF NOT EXISTS idx_tx_calc_registered
        ON migration.transaction_agent_calculations(is_registered);
      CREATE INDEX IF NOT EXISTS idx_tx_calc_office
        ON migration.transaction_agent_calculations(office_name);
    `);
    });
    // Listing sub-tables and expanded core_listings columns
    await runInTransaction(async (client) => {
        // Expand core_listings with all new scalar fields
        await client.query(`
      ALTER TABLE migration.core_listings
        ADD COLUMN IF NOT EXISTS listing_status_tag      TEXT,
        ADD COLUMN IF NOT EXISTS ownership_type          TEXT,
        ADD COLUMN IF NOT EXISTS is_draft                BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS is_published            BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS agent_property_valuation NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS reduced_date            DATE,
        ADD COLUMN IF NOT EXISTS no_transfer_duty        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS property_auction        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS poa                     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS short_description       TEXT,
        ADD COLUMN IF NOT EXISTS property_type           TEXT,
        ADD COLUMN IF NOT EXISTS property_sub_type       TEXT,
        ADD COLUMN IF NOT EXISTS descriptive_feature     TEXT,
        ADD COLUMN IF NOT EXISTS retirement_living       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS erf_number              TEXT,
        ADD COLUMN IF NOT EXISTS unit_number             TEXT,
        ADD COLUMN IF NOT EXISTS door_number             TEXT,
        ADD COLUMN IF NOT EXISTS estate_name             TEXT,
        ADD COLUMN IF NOT EXISTS street_number           TEXT,
        ADD COLUMN IF NOT EXISTS street_name             TEXT,
        ADD COLUMN IF NOT EXISTS postal_code             TEXT,
        ADD COLUMN IF NOT EXISTS longitude               NUMERIC(12,7),
        ADD COLUMN IF NOT EXISTS latitude                NUMERIC(12,7),
        ADD COLUMN IF NOT EXISTS override_display_location BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS override_display_longitude NUMERIC(12,7),
        ADD COLUMN IF NOT EXISTS override_display_latitude  NUMERIC(12,7),
        ADD COLUMN IF NOT EXISTS loom_validation_status  TEXT,
        ADD COLUMN IF NOT EXISTS loom_property_id        TEXT,
        ADD COLUMN IF NOT EXISTS loom_address            TEXT,
        ADD COLUMN IF NOT EXISTS display_address_on_website BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS viewing_instructions    TEXT,
        ADD COLUMN IF NOT EXISTS viewing_directions      TEXT,
        ADD COLUMN IF NOT EXISTS feed_to_private_property BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS private_property_ref1   TEXT,
        ADD COLUMN IF NOT EXISTS private_property_ref2   TEXT,
        ADD COLUMN IF NOT EXISTS private_property_sync_status TEXT,
        ADD COLUMN IF NOT EXISTS feed_to_kww             BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS kww_property_reference  TEXT,
        ADD COLUMN IF NOT EXISTS kww_ref1                TEXT,
        ADD COLUMN IF NOT EXISTS kww_ref2                TEXT,
        ADD COLUMN IF NOT EXISTS kww_sync_status         TEXT,
        ADD COLUMN IF NOT EXISTS feed_to_entegral        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS entegral_sync_status    TEXT,
        ADD COLUMN IF NOT EXISTS feed_to_property24      BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS property24_ref1         TEXT,
        ADD COLUMN IF NOT EXISTS property24_ref2         TEXT,
        ADD COLUMN IF NOT EXISTS property24_sync_status  TEXT,
        ADD COLUMN IF NOT EXISTS signed_date             DATE,
        ADD COLUMN IF NOT EXISTS on_market_since_date    DATE,
        ADD COLUMN IF NOT EXISTS rates_and_taxes         NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS monthly_levy            NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS occupation_date         DATE,
        ADD COLUMN IF NOT EXISTS mandate_type            TEXT,
        ADD COLUMN IF NOT EXISTS erf_size                NUMERIC(18,4),
        ADD COLUMN IF NOT EXISTS floor_area              NUMERIC(18,4),
        ADD COLUMN IF NOT EXISTS construction_date       DATE,
        ADD COLUMN IF NOT EXISTS height_restriction      NUMERIC(18,4),
        ADD COLUMN IF NOT EXISTS out_building_size       NUMERIC(18,4),
        ADD COLUMN IF NOT EXISTS zoning_type             TEXT,
        ADD COLUMN IF NOT EXISTS is_furnished            BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS pet_friendly            BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_standalone_building BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_flatlet             BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_backup_water        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS wheelchair_accessible   BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_generator           BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_borehole            BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_gas_geyser          BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_solar_panels        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_backup_battery_or_inverter BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_solar_geyser        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS has_water_tank          BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS adsl                    BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS fibre                   BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS isdn                    BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS dialup                  BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS fixed_wimax             BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS satellite               BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS nearby_bus_service      BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS nearby_minibus_taxi_service BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS nearby_train_service    BOOLEAN NOT NULL DEFAULT false;
    `);
        // Listing images — normalized table (replaces listing_images_json for new records)
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_images (
        id BIGSERIAL PRIMARY KEY,
        listing_id BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        file_name   TEXT,
        file_url    TEXT NOT NULL,
        media_type  TEXT NOT NULL DEFAULT 'image',
        sort_order  INT  NOT NULL DEFAULT 0,
        uploaded_by TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON migration.listing_images(listing_id);
    `);
        // Listing agents junction
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_agents (
        id BIGSERIAL PRIMARY KEY,
        listing_id        BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        associate_id      BIGINT REFERENCES migration.core_associates(id),
        agent_name        TEXT,
        agent_role        TEXT NOT NULL DEFAULT 'Primary',
        is_primary        BOOLEAN NOT NULL DEFAULT false,
        market_center_id  BIGINT REFERENCES migration.core_market_centers(id),
        sort_order        INT NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_agents_listing   ON migration.listing_agents(listing_id);
      CREATE INDEX IF NOT EXISTS idx_listing_agents_associate ON migration.listing_agents(associate_id);
    `);
        // Listing contacts
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_contacts (
        id           BIGSERIAL PRIMARY KEY,
        listing_id   BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        full_name    TEXT,
        phone_number TEXT,
        email_address TEXT,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_contacts_listing ON migration.listing_contacts(listing_id);
    `);
        // Listing show times
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_show_times (
        id           BIGSERIAL PRIMARY KEY,
        listing_id   BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        from_date    DATE,
        from_time    TEXT,
        to_date      DATE,
        to_time      TEXT,
        catch_phrase TEXT,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_show_times_listing ON migration.listing_show_times(listing_id);
    `);
        // Listing open house
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_open_house (
        id               BIGSERIAL PRIMARY KEY,
        listing_id       BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        open_house_date  DATE,
        from_time        TEXT,
        to_time          TEXT,
        average_price    TEXT,
        comments         TEXT,
        sort_order       INT NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_open_house_listing ON migration.listing_open_house(listing_id);
    `);
        // Listing marketing URLs
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_marketing_urls (
        id           BIGSERIAL PRIMARY KEY,
        listing_id   BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        url          TEXT NOT NULL,
        url_type     TEXT,
        display_name TEXT,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_marketing_urls_listing ON migration.listing_marketing_urls(listing_id);
    `);
        // Listing mandate documents
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_mandate_documents (
        id           BIGSERIAL PRIMARY KEY,
        listing_id   BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        file_name    TEXT,
        file_url     TEXT NOT NULL,
        file_type    TEXT,
        uploaded_by  TEXT,
        sort_order   INT NOT NULL DEFAULT 0,
        uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listing_mandate_docs_listing ON migration.listing_mandate_documents(listing_id);
    `);
        // Listing features (facing, roof, style, walls, windows, lifestyle, property_features)
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_features (
        id               BIGSERIAL PRIMARY KEY,
        listing_id       BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        feature_category TEXT NOT NULL,
        feature_value    TEXT NOT NULL,
        sort_order       INT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_listing_features_listing  ON migration.listing_features(listing_id);
      CREATE INDEX IF NOT EXISTS idx_listing_features_category ON migration.listing_features(listing_id, feature_category);
    `);
        // Listing property areas (rooms with counts)
        await client.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_property_areas (
        id          BIGSERIAL PRIMARY KEY,
        listing_id  BIGINT NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
        area_type   TEXT NOT NULL,
        count       INT,
        size        NUMERIC(12,2),
        description TEXT,
        sub_features TEXT[],
        sort_order  INT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_listing_property_areas_listing ON migration.listing_property_areas(listing_id);
    `);
        await client.query(`
      ALTER TABLE migration.listing_property_areas
      ADD COLUMN IF NOT EXISTS sub_features TEXT[];
    `);
    });
    console.log('Staging and migration schemas are ready.');
}
main()
    .catch((error) => {
    console.error('Failed to initialize staging schema:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=initStaging.js.map