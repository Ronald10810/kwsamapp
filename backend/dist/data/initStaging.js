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
        suburb TEXT,
        city TEXT,
        province TEXT,
        country TEXT,
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
        ADD COLUMN IF NOT EXISTS mobile_number TEXT;

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
        ADD COLUMN IF NOT EXISTS listing_payload JSONB;

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
        source_transaction_id TEXT NOT NULL,
        source_associate_id TEXT NOT NULL DEFAULT '',
        associate_id BIGINT REFERENCES migration.core_associates(id),
        market_center_id BIGINT REFERENCES migration.core_market_centers(id),
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_transaction_id, source_associate_id)
      );

      CREATE INDEX IF NOT EXISTS idx_core_transactions_associate
        ON migration.core_transactions(associate_id);
      CREATE INDEX IF NOT EXISTS idx_core_transactions_mc
        ON migration.core_transactions(market_center_id);
      CREATE INDEX IF NOT EXISTS idx_core_transactions_date
        ON migration.core_transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_core_transactions_status
        ON migration.core_transactions(transaction_status);
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