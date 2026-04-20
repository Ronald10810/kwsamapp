import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.market_centers_prepared (
        source_market_center_id,
        name,
        status_name,
        frontdoor_id,
        company_registered_name,
        address_source_id,
        logo_document_id,
        contact_number,
        contact_email,
        kw_office_id,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_market_center_id)
        source_market_center_id,
        name,
        status_name,
        frontdoor_id,
        NULLIF(TRIM(COALESCE(raw_payload->>'RegisteredName', '')), '') AS company_registered_name,
        NULLIF(TRIM(COALESCE(raw_payload->>'AddressId', '')), '') AS address_source_id,
        NULLIF(TRIM(COALESCE(raw_payload->>'LogoDocumentId', '')), '') AS logo_document_id,
        NULLIF(TRIM(COALESCE(raw_payload->>'ContactNumber', '')), '') AS contact_number,
        NULLIF(TRIM(COALESCE(raw_payload->>'ContactEmail', '')), '') AS contact_email,
        NULLIF(TRIM(COALESCE(raw_payload->>'KWOfficeId', '')), '') AS kw_office_id,
        COALESCE(source_updated_at, loaded_at) AS last_seen_at,
        NOW() AS prepared_at
      FROM staging.market_centers_raw
      ORDER BY source_market_center_id, COALESCE(source_updated_at, loaded_at) DESC
      ON CONFLICT (source_market_center_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status_name = EXCLUDED.status_name,
        frontdoor_id = EXCLUDED.frontdoor_id,
        company_registered_name = EXCLUDED.company_registered_name,
        address_source_id = EXCLUDED.address_source_id,
        logo_document_id = EXCLUDED.logo_document_id,
        contact_number = EXCLUDED.contact_number,
        contact_email = EXCLUDED.contact_email,
        kw_office_id = EXCLUDED.kw_office_id,
        last_seen_at = EXCLUDED.last_seen_at,
        prepared_at = NOW();
    `);
    });
    console.log('Market centers transformed into migration.market_centers_prepared.');
}
main()
    .catch((error) => {
    console.error('Failed to transform market centers:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformMarketCenters.js.map