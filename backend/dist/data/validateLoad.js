import { closePool, withClient } from './db.js';
async function scalar(clientQuery, sql) {
    const result = await clientQuery(sql);
    return Number(result.rows[0]?.value ?? 0);
}
async function main() {
    await withClient(async (client) => {
        const query = async (sql) => {
            const result = await client.query(sql);
            return { rows: result.rows };
        };
        const stagingAssociates = await scalar(query, 'SELECT COUNT(*)::text AS value FROM staging.associates_raw');
        const stagingListings = await scalar(query, 'SELECT COUNT(*)::text AS value FROM staging.listings_raw');
        const stagingMarketCenters = await scalar(query, 'SELECT COUNT(*)::text AS value FROM staging.market_centers_raw');
        const stagingTeams = await scalar(query, 'SELECT COUNT(*)::text AS value FROM staging.teams_raw');
        const preparedAssociates = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.associates_prepared');
        const preparedListings = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.listings_prepared');
        const preparedMarketCenters = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.market_centers_prepared');
        const preparedTeams = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.teams_prepared');
        const coreMarketCenters = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_market_centers');
        const coreTeams = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_teams');
        const coreAssociates = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_associates');
        const coreListings = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_listings');
        const loadRejections = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.load_rejections');
        const duplicateAssociates = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM (
        SELECT source_associate_id
        FROM staging.associates_raw
        GROUP BY source_associate_id
        HAVING COUNT(*) > 1
      ) t
      `);
        const duplicateListings = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM (
        SELECT source_listing_id
        FROM staging.listings_raw
        GROUP BY source_listing_id
        HAVING COUNT(*) > 1
      ) t
      `);
        const duplicateMarketCenters = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM (
        SELECT source_market_center_id
        FROM staging.market_centers_raw
        GROUP BY source_market_center_id
        HAVING COUNT(*) > 1
      ) t
      `);
        const duplicateTeams = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM (
        SELECT source_team_id
        FROM staging.teams_raw
        GROUP BY source_team_id
        HAVING COUNT(*) > 1
      ) t
      `);
        const missingAssociateNames = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.associates_prepared
      WHERE COALESCE(first_name, '') = '' AND COALESCE(last_name, '') = ''
      `);
        const missingListingNumbers = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.listings_prepared
      WHERE COALESCE(listing_number, '') = ''
      `);
        const orphanTeams = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.teams_prepared t
      LEFT JOIN migration.market_centers_prepared m
        ON m.source_market_center_id = t.source_market_center_id
      WHERE COALESCE(t.source_market_center_id, '') <> ''
        AND m.source_market_center_id IS NULL
      `);
        console.log('----------------------------------------------');
        console.log('Dataset load validation');
        console.log('----------------------------------------------');
        console.log(`staging.market_centers_raw   : ${stagingMarketCenters}`);
        console.log(`migration.market_centers_prepared: ${preparedMarketCenters}`);
        console.log(`market center duplicates (raw): ${duplicateMarketCenters}`);
        console.log('----------------------------------------------');
        console.log(`staging.teams_raw            : ${stagingTeams}`);
        console.log(`migration.teams_prepared     : ${preparedTeams}`);
        console.log(`team duplicates (raw)        : ${duplicateTeams}`);
        console.log(`orphan teams (prepared)      : ${orphanTeams}`);
        console.log('----------------------------------------------');
        console.log(`staging.associates_raw      : ${stagingAssociates}`);
        console.log(`migration.associates_prepared: ${preparedAssociates}`);
        console.log(`associate duplicates (raw)  : ${duplicateAssociates}`);
        console.log(`associate missing names     : ${missingAssociateNames}`);
        console.log('----------------------------------------------');
        console.log(`staging.listings_raw        : ${stagingListings}`);
        console.log(`migration.listings_prepared : ${preparedListings}`);
        console.log(`listing duplicates (raw)    : ${duplicateListings}`);
        console.log(`listing missing numbers     : ${missingListingNumbers}`);
        console.log('----------------------------------------------');
        console.log(`core.market_centers         : ${coreMarketCenters}`);
        console.log(`core.teams                  : ${coreTeams}`);
        console.log(`core.associates             : ${coreAssociates}`);
        console.log(`core.listings               : ${coreListings}`);
        console.log(`load rejections             : ${loadRejections}`);
        console.log('----------------------------------------------');
    });
}
main()
    .catch((error) => {
    console.error('Failed to validate loaded data:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=validateLoad.js.map