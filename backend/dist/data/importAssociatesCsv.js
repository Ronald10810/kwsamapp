import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';
function buildBatchId() {
    return `associates_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}
async function main() {
    const filePath = optionalArg('--file', 'data/incoming/associates.csv');
    const batchId = optionalArg('--batch', buildBatchId());
    const rows = await readCsvRows(filePath);
    if (rows.length === 0) {
        throw new Error(`No rows found in ${filePath}`);
    }
    await runInTransaction(async (client) => {
        for (const row of rows) {
            const sourceAssociateId = getValue(row, ['associate_id', 'id', 'AssociateId']);
            if (!sourceAssociateId) {
                continue;
            }
            const firstName = getValue(row, ['first_name', 'firstName', 'FirstName']);
            const lastName = getValue(row, ['last_name', 'lastName', 'LastName']);
            const email = getValue(row, ['email', 'Email', 'KWSAEmail', 'PrivateEmail']);
            const statusName = getValue(row, ['status', 'status_name', 'Status', 'AssociateStatus']);
            const marketCenterName = getValue(row, ['market_center', 'market_center_name', 'MarketCenter', 'MarketCentre']);
            const teamName = getValue(row, ['team', 'team_name', 'Team', 'TeamName']);
            const kwuid = getValue(row, ['kwuid', 'KWUID']);
            const sourceUpdatedAt = getValue(row, ['updated_at', 'source_updated_at', 'UpdatedAt', 'AssociateStartDate', 'StartDate']);
            await client.query(`
        INSERT INTO staging.associates_raw (
          batch_id,
          source_associate_id,
          first_name,
          last_name,
          email,
          status_name,
          market_center_name,
          team_name,
          kwuid,
          source_updated_at,
          raw_payload
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10::timestamptz,
          $11::jsonb
        )
      `, [
                batchId,
                sourceAssociateId,
                firstName,
                lastName,
                email,
                statusName,
                marketCenterName,
                teamName,
                kwuid,
                sourceUpdatedAt,
                JSON.stringify(row),
            ]);
        }
    });
    console.log(`Imported ${rows.length} rows into staging.associates_raw (batch: ${batchId}).`);
}
main()
    .catch((error) => {
    console.error('Failed to import associates CSV:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=importAssociatesCsv.js.map