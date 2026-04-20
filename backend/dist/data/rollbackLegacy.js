import { closePool, runInTransaction, withClient } from './db.js';
import { getArgValue } from './args.js';
function hasDryRunFlag() {
    return process.argv.includes('--dry-run');
}
function sourceFilter(tableName, sourceColumn, batchPrefix) {
    if (!batchPrefix) {
        return { clause: '', params: [] };
    }
    return {
        clause: `WHERE m.${sourceColumn} IN (SELECT DISTINCT ${sourceColumn} FROM staging.${tableName} WHERE batch_id LIKE $1 || '%')`,
        params: [batchPrefix],
    };
}
async function getTargetLegacyIds(batchPrefix) {
    return withClient(async (client) => {
        const liFilter = sourceFilter('listings_raw', 'source_listing_id', batchPrefix);
        const asFilter = sourceFilter('associates_raw', 'source_associate_id', batchPrefix);
        const mcFilter = sourceFilter('market_centers_raw', 'source_market_center_id', batchPrefix);
        const listings = await client.query(`SELECT m.legacy_listing_id AS legacy_id FROM migration.id_map_legacy_listings m ${liFilter.clause}`, liFilter.params);
        const associates = await client.query(`SELECT m.legacy_associate_id AS legacy_id FROM migration.id_map_legacy_associates m ${asFilter.clause}`, asFilter.params);
        const marketCenters = await client.query(`SELECT m.legacy_market_center_id AS legacy_id FROM migration.id_map_legacy_market_centers m ${mcFilter.clause}`, mcFilter.params);
        return {
            listingIds: listings.rows.map((r) => r.legacy_id),
            associateIds: associates.rows.map((r) => r.legacy_id),
            marketCenterIds: marketCenters.rows.map((r) => r.legacy_id),
        };
    });
}
async function reportLegacyCounts(label) {
    await withClient(async (client) => {
        const marketCenterCount = await client.query('SELECT COUNT(*)::text AS value FROM "MarketCentre"');
        const associateCount = await client.query('SELECT COUNT(*)::text AS value FROM "Associate"');
        const listingCount = await client.query('SELECT COUNT(*)::text AS value FROM "Listing"');
        console.log(`${label}:`);
        console.log(`  MarketCentre: ${marketCenterCount.rows[0].value}`);
        console.log(`  Associate   : ${associateCount.rows[0].value}`);
        console.log(`  Listing     : ${listingCount.rows[0].value}`);
    });
}
async function rollback(batchPrefix) {
    const ids = await getTargetLegacyIds(batchPrefix);
    await runInTransaction(async (client) => {
        if (ids.listingIds.length > 0) {
            await client.query('DELETE FROM "Listing" WHERE id = ANY($1::text[])', [ids.listingIds]);
            await client.query('DELETE FROM migration.id_map_legacy_listings WHERE legacy_listing_id = ANY($1::text[])', [ids.listingIds]);
        }
        if (ids.associateIds.length > 0) {
            await client.query('DELETE FROM "Associate" WHERE id = ANY($1::text[])', [ids.associateIds]);
            await client.query('DELETE FROM migration.id_map_legacy_associates WHERE legacy_associate_id = ANY($1::text[])', [ids.associateIds]);
        }
        if (ids.marketCenterIds.length > 0) {
            const deletableMc = await client.query(`
        SELECT mc.id AS legacy_id
        FROM "MarketCentre" mc
        WHERE mc.id = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM "Associate" a WHERE a."marketCentreId" = mc.id)
          AND NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."marketCentreId" = mc.id)
        `, [ids.marketCenterIds]);
            const deletableIds = deletableMc.rows.map((r) => r.legacy_id);
            if (deletableIds.length > 0) {
                await client.query('DELETE FROM "MarketCentre" WHERE id = ANY($1::text[])', [deletableIds]);
                await client.query('DELETE FROM migration.id_map_legacy_market_centers WHERE legacy_market_center_id = ANY($1::text[])', [deletableIds]);
            }
        }
    });
}
async function main() {
    const dryRun = hasDryRunFlag();
    const batchPrefix = getArgValue('--batch-prefix');
    await reportLegacyCounts('Legacy table counts before rollback');
    const ids = await getTargetLegacyIds(batchPrefix);
    console.log('Rollback candidates:');
    if (batchPrefix) {
        console.log(`  Batch prefix filter: ${batchPrefix}`);
    }
    console.log(`  Listing IDs      : ${ids.listingIds.length}`);
    console.log(`  Associate IDs    : ${ids.associateIds.length}`);
    console.log(`  MarketCentre IDs : ${ids.marketCenterIds.length}`);
    if (dryRun) {
        console.log('Dry run completed. No legacy tables were modified.');
        return;
    }
    await rollback(batchPrefix);
    await reportLegacyCounts('Legacy table counts after rollback');
}
main()
    .catch((error) => {
    console.error('Failed to rollback legacy publish:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=rollbackLegacy.js.map