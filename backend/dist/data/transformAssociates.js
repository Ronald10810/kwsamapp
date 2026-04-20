import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.associates_prepared (
        source_associate_id,
        first_name,
        last_name,
        full_name,
        email,
        status_name,
        market_center_name,
        team_name,
        kwuid,
        image_url,
        mobile_number,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_associate_id)
        source_associate_id,
        first_name,
        last_name,
        CONCAT_WS(' ', first_name, last_name) AS full_name,
        email,
        status_name,
        market_center_name,
        team_name,
        kwuid,
        NULLIF(TRIM(COALESCE(raw_payload->>'AssociateImageUrl', raw_payload->>'AssociateImagePreviewUrl', '')), '') AS image_url,
        NULLIF(TRIM(COALESCE(raw_payload->>'MobileNumber', '')), '') AS mobile_number,
        COALESCE(source_updated_at, loaded_at) AS last_seen_at,
        NOW() AS prepared_at
      FROM staging.associates_raw
      ORDER BY source_associate_id, COALESCE(source_updated_at, loaded_at) DESC
      ON CONFLICT (source_associate_id)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        status_name = EXCLUDED.status_name,
        market_center_name = EXCLUDED.market_center_name,
        team_name = EXCLUDED.team_name,
        kwuid = EXCLUDED.kwuid,
        image_url = EXCLUDED.image_url,
        mobile_number = EXCLUDED.mobile_number,
        last_seen_at = EXCLUDED.last_seen_at,
        prepared_at = NOW();
    `);
    });
    console.log('Associates transformed into migration.associates_prepared.');
}
main()
    .catch((error) => {
    console.error('Failed to transform associates:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformAssociates.js.map