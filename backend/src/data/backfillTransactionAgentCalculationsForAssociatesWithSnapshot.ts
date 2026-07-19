import { closePool, runInTransaction } from './db.js';
import { recomputeScopedTransactionAgentCalculationsForAssociateIds } from '../services/transactionCalculations.js';

type CountRow = { count: string };

function buildSnapshotTableName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const yyyy = now.getUTCFullYear();
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `transaction_agent_calculations_snapshot_${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function parseAssociateIds(rawValue: string | undefined): number[] {
  if (!rawValue) {
    return [];
  }

  return Array.from(new Set(
    rawValue
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
  ));
}

async function main(): Promise<void> {
  const snapshotTable = process.env.TAC_SNAPSHOT_TABLE?.trim() || buildSnapshotTableName();
  const associateIds = parseAssociateIds(process.env.TAC_ASSOCIATE_IDS);

  if (!/^[a-zA-Z0-9_]+$/.test(snapshotTable)) {
    throw new Error('Invalid TAC_SNAPSHOT_TABLE value. Only letters, numbers, and underscores are allowed.');
  }

  if (associateIds.length === 0) {
    throw new Error('TAC_ASSOCIATE_IDS is required. Example: TAC_ASSOCIATE_IDS=123,456');
  }

  await runInTransaction(async (client) => {
    const beforeCountResult = await client.query<CountRow>(
      'SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations'
    );
    const beforeCount = Number(beforeCountResult.rows[0]?.count ?? 0);

    await client.query(`CREATE TABLE migration.${snapshotTable} AS TABLE migration.transaction_agent_calculations WITH DATA`);

    const recomputeResult = await recomputeScopedTransactionAgentCalculationsForAssociateIds(client, associateIds);

    const afterCountResult = await client.query<CountRow>(
      'SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations'
    );
    const afterCount = Number(afterCountResult.rows[0]?.count ?? 0);

    console.log(JSON.stringify({
      ok: true,
      snapshot_table: `migration.${snapshotTable}`,
      associate_ids: associateIds,
      before_count: beforeCount,
      after_count: afterCount,
      affected_rows_count: recomputeResult.affected_rows_count,
      affected_transaction_ids: recomputeResult.affected_transaction_ids,
    }, null, 2));
  });
}

main()
  .catch((error) => {
    console.error('Failed to run associate-scoped TAC backfill with snapshot:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });