import { closePool, runInTransaction } from './db.js';
import { optionalArg } from './args.js';
import { getValue, readCsvRows } from './csv.js';

function buildBatchId(): string {
  return `teams_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}

async function main(): Promise<void> {
  const filePath = optionalArg('--file', 'data/incoming/teams.csv');
  const batchId = optionalArg('--batch', buildBatchId());
  const rows = await readCsvRows(filePath);

  if (rows.length === 0) {
    throw new Error(`No rows found in ${filePath}`);
  }

  await runInTransaction(async (client) => {
    for (const row of rows) {
      const sourceTeamId = getValue(row, ['team_id', 'id', 'TeamId']);
      if (!sourceTeamId) {
        continue;
      }

      const sourceMarketCenterId = getValue(row, [
        'market_center_id',
        'marketCentreId',
        'MarketCenterId',
      ]);
      const name = getValue(row, ['name', 'team_name', 'TeamName']);
      const statusName = getValue(row, ['status', 'status_name', 'Status']);
      const sourceUpdatedAt = getValue(row, ['updated_at', 'source_updated_at', 'UpdatedAt']);

      await client.query(
        `
        INSERT INTO staging.teams_raw (
          batch_id,
          source_team_id,
          source_market_center_id,
          name,
          status_name,
          source_updated_at,
          raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::timestamptz,
          $7::jsonb
        )
      `,
        [
          batchId,
          sourceTeamId,
          sourceMarketCenterId,
          name,
          statusName,
          sourceUpdatedAt,
          JSON.stringify(row),
        ]
      );
    }
  });

  console.log(`Imported ${rows.length} rows into staging.teams_raw (batch: ${batchId}).`);
}

main()
  .catch((error) => {
    console.error('Failed to import teams CSV:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
