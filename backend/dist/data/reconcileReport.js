import { closePool, withClient } from './db.js';
import { getArgValue } from './args.js';
async function scalar(query, sql, params = []) {
    const result = await query(sql, params);
    return Number(result.rows[0]?.value ?? 0);
}
function section(title) {
    console.log('');
    console.log('============================================================');
    console.log(title);
    console.log('============================================================');
}
function pct(part, whole) {
    if (whole === 0) {
        return 'n/a';
    }
    return `${((part / whole) * 100).toFixed(1)}%`;
}
async function main() {
    const batchPrefix = getArgValue('--batch-prefix');
    await withClient(async (client) => {
        const query = async (sql, params = []) => {
            const result = await client.query(sql, params);
            return { rows: result.rows };
        };
        section('Data Reconciliation Report');
        if (batchPrefix) {
            console.log(`Filter: batch prefix '${batchPrefix}'`);
        }
        else {
            console.log('Filter: all batches');
        }
        const batchFilterClause = batchPrefix ? 'WHERE batch_id LIKE $1 || \'%\'' : '';
        const batchParams = batchPrefix ? [batchPrefix] : [];
        section('Raw Layer Counts');
        const rawCounts = [
            {
                key: 'staging.market_centers_raw',
                value: await scalar(query, `SELECT COUNT(*)::text AS value FROM staging.market_centers_raw ${batchFilterClause}`, batchParams),
            },
            {
                key: 'staging.teams_raw',
                value: await scalar(query, `SELECT COUNT(*)::text AS value FROM staging.teams_raw ${batchFilterClause}`, batchParams),
            },
            {
                key: 'staging.associates_raw',
                value: await scalar(query, `SELECT COUNT(*)::text AS value FROM staging.associates_raw ${batchFilterClause}`, batchParams),
            },
            {
                key: 'staging.listings_raw',
                value: await scalar(query, `SELECT COUNT(*)::text AS value FROM staging.listings_raw ${batchFilterClause}`, batchParams),
            },
        ];
        rawCounts.forEach((item) => {
            console.log(`${item.key.padEnd(34)} : ${item.value}`);
        });
        section('Prepared Layer Counts');
        const preparedCounts = [
            { key: 'migration.market_centers_prepared', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.market_centers_prepared') },
            { key: 'migration.teams_prepared', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.teams_prepared') },
            { key: 'migration.associates_prepared', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.associates_prepared') },
            { key: 'migration.listings_prepared', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.listings_prepared') },
        ];
        preparedCounts.forEach((item) => {
            console.log(`${item.key.padEnd(34)} : ${item.value}`);
        });
        section('Curated Core Counts');
        const coreCounts = [
            { key: 'migration.core_market_centers', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_market_centers') },
            { key: 'migration.core_teams', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_teams') },
            { key: 'migration.core_associates', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_associates') },
            { key: 'migration.core_listings', value: await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.core_listings') },
        ];
        coreCounts.forEach((item) => {
            console.log(`${item.key.padEnd(34)} : ${item.value}`);
        });
        section('Mapping Coverage');
        const preparedMarketCenters = Number(preparedCounts[0].value);
        const preparedTeams = Number(preparedCounts[1].value);
        const preparedAssociates = Number(preparedCounts[2].value);
        const preparedListings = Number(preparedCounts[3].value);
        const mappedMarketCenters = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.id_map_market_centers');
        const mappedTeams = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.id_map_teams');
        const mappedAssociates = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.id_map_associates');
        const mappedListings = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.id_map_listings');
        console.log(`market_centers mapped ${String(mappedMarketCenters).padStart(6)} / ${String(preparedMarketCenters).padEnd(6)} (${pct(mappedMarketCenters, preparedMarketCenters)})`);
        console.log(`teams          mapped ${String(mappedTeams).padStart(6)} / ${String(preparedTeams).padEnd(6)} (${pct(mappedTeams, preparedTeams)})`);
        console.log(`associates     mapped ${String(mappedAssociates).padStart(6)} / ${String(preparedAssociates).padEnd(6)} (${pct(mappedAssociates, preparedAssociates)})`);
        console.log(`listings       mapped ${String(mappedListings).padStart(6)} / ${String(preparedListings).padEnd(6)} (${pct(mappedListings, preparedListings)})`);
        section('Reference Integrity Checks');
        const orphanTeams = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.teams_prepared t
      LEFT JOIN migration.market_centers_prepared m
        ON m.source_market_center_id = t.source_market_center_id
      WHERE COALESCE(t.source_market_center_id, '') <> ''
        AND m.source_market_center_id IS NULL
      `);
        const unresolvedAssociateMarketCenter = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.associates_prepared a
      LEFT JOIN migration.core_market_centers c
        ON c.name = a.market_center_name
      WHERE COALESCE(a.market_center_name, '') <> ''
        AND c.id IS NULL
      `);
        const unresolvedListingMarketCenter = await scalar(query, `
      SELECT COUNT(*)::text AS value
      FROM migration.listings_prepared l
      LEFT JOIN migration.core_market_centers c
        ON c.name = l.market_center_name
      WHERE COALESCE(l.market_center_name, '') <> ''
        AND c.id IS NULL
      `);
        console.log(`orphan teams in prepared layer          : ${orphanTeams}`);
        console.log(`associates unresolved market center name: ${unresolvedAssociateMarketCenter}`);
        console.log(`listings unresolved market center name  : ${unresolvedListingMarketCenter}`);
        section('Rejection Summary');
        const rejectionTotal = await scalar(query, 'SELECT COUNT(*)::text AS value FROM migration.load_rejections');
        console.log(`total rejections: ${rejectionTotal}`);
        const rejectionSummary = await client.query(`
      SELECT entity_name, reason, COUNT(*)::text AS count
      FROM migration.load_rejections
      GROUP BY entity_name, reason
      ORDER BY entity_name, reason
      `);
        if (rejectionSummary.rows.length === 0) {
            console.log('no rejection records found');
        }
        else {
            rejectionSummary.rows.forEach((row) => {
                console.log(`${row.entity_name.padEnd(18)} | ${row.reason.padEnd(45)} | ${row.count}`);
            });
        }
        const rejectionSamples = await client.query(`
      SELECT rejected_at::text, entity_name, source_id, reason
      FROM migration.load_rejections
      ORDER BY rejected_at DESC
      LIMIT 10
      `);
        if (rejectionSamples.rows.length > 0) {
            section('Latest Rejection Samples (Top 10)');
            rejectionSamples.rows.forEach((row) => {
                console.log(`${row.rejected_at} | ${row.entity_name} | ${row.source_id ?? 'n/a'} | ${row.reason}`);
            });
        }
    });
}
main()
    .catch((error) => {
    console.error('Failed to produce reconciliation report:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=reconcileReport.js.map