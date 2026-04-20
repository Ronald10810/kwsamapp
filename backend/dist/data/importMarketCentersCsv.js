import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';
function buildBatchId() {
    return `market_centers_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}
async function main() {
    const filePath = optionalArg('--file', 'data/incoming/market-centers.csv');
    const batchId = optionalArg('--batch', buildBatchId());
    const rows = await readCsvRows(filePath);
    if (rows.length === 0) {
        throw new Error(`No rows found in ${filePath}`);
    }
    await runInTransaction(async (client) => {
        for (const row of rows) {
            const sourceMarketCenterId = getValue(row, [
                'market_center_id',
                'marketCentreId',
                'id',
                'Id',
                'MarketCenterId',
            ]);
            if (!sourceMarketCenterId) {
                continue;
            }
            const name = getValue(row, ['name', 'Name', 'market_center_name', 'MarketCenterName']);
            const statusName = getValue(row, ['status', 'status_name', 'Status', 'MarketCenterStatusId']);
            const frontdoorId = getValue(row, ['frontdoor_id', 'frontdoorId', 'FrontDoorId', 'FrontdoorId']);
            const sourceUpdatedAt = getValue(row, ['updated_at', 'source_updated_at', 'UpdatedAt', 'WhenUpdated']);
            await client.query(`
        INSERT INTO staging.market_centers_raw (
          batch_id,
          source_market_center_id,
          name,
          status_name,
          frontdoor_id,
          source_updated_at,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::timestamptz,
          $7::jsonb
        )
      `, [
                batchId,
                sourceMarketCenterId,
                name,
                statusName,
                frontdoorId,
                sourceUpdatedAt,
                JSON.stringify(row),
            ]);
        }
    });
    console.log(`Imported ${rows.length} rows into staging.market_centers_raw (batch: ${batchId}).`);
}
main()
    .catch((error) => {
    console.error('Failed to import market centers CSV:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=importMarketCentersCsv.js.map