import { closePool, runInTransaction } from './db.js';

type CountRow = { count: string };

type ExistsRow = { exists: string | null };

function readSnapshotTableName(): string {
  const snapshotTable = process.env.TAC_SNAPSHOT_TABLE?.trim();
  if (!snapshotTable) {
    throw new Error('TAC_SNAPSHOT_TABLE is required. Example: TAC_SNAPSHOT_TABLE=transaction_agent_calculations_snapshot_20260712_153000');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(snapshotTable)) {
    throw new Error('Invalid TAC_SNAPSHOT_TABLE value. Only letters, numbers, and underscores are allowed.');
  }
  return snapshotTable;
}

async function main(): Promise<void> {
  const snapshotTable = readSnapshotTableName();

  await runInTransaction(async (client) => {
    const existsResult = await client.query<ExistsRow>(
      `SELECT to_regclass('migration.${snapshotTable}') AS exists`
    );

    if (!existsResult.rows[0]?.exists) {
      throw new Error(`Snapshot table migration.${snapshotTable} does not exist.`);
    }

    const snapshotCountResult = await client.query<CountRow>(
      `SELECT COUNT(*)::text AS count FROM migration.${snapshotTable}`
    );
    const snapshotCount = Number(snapshotCountResult.rows[0]?.count ?? 0);

    await client.query('TRUNCATE TABLE migration.transaction_agent_calculations');
    await client.query(
      `INSERT INTO migration.transaction_agent_calculations SELECT * FROM migration.${snapshotTable}`
    );

    const restoredCountResult = await client.query<CountRow>(
      'SELECT COUNT(*)::text AS count FROM migration.transaction_agent_calculations'
    );
    const restoredCount = Number(restoredCountResult.rows[0]?.count ?? 0);

    console.log(JSON.stringify({
      ok: true,
      snapshot_table: `migration.${snapshotTable}`,
      snapshot_count: snapshotCount,
      restored_count: restoredCount,
    }, null, 2));
  });
}

main()
  .catch((error) => {
    console.error('Failed to rollback TAC from snapshot:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
