import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { Client } from 'pg';
import { optionalArg } from './args.js';

const AZURE = {
  server: 'kwsa.database.windows.net',
  port: 1433,
  database: 'dbMappProd',
  user: 'kwsaReadOnly',
  password: 'W4Km3jUnYyt+x8=',
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 30000,
  connectionTimeout: 30000,
};

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || '9470'),
  database: process.env.PGDATABASE || 'kwsa_uat',
  user: process.env.PGUSER || 'kwsa_uat',
  password: process.env.PGPASSWORD || '123456789',
  ssl: false,
};

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_NAME = 'transactions-daily-incremental';

function parseSinceArg(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --since value: ${value}`);
  }
  return date;
}

function defaultSince(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function buildPgConnectionString(): string {
  return `postgresql://${encodeURIComponent(PG.user)}:${encodeURIComponent(PG.password)}@${PG.host}:${PG.port}/${PG.database}`;
}

async function ensureCheckpointTable(client: Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS migration;
    CREATE TABLE IF NOT EXISTS migration.transaction_sync_state (
      sync_name TEXT PRIMARY KEY,
      last_source_updated_at TIMESTAMPTZ NOT NULL DEFAULT '1900-01-01T00:00:00Z'::timestamptz,
      last_source_transaction_id BIGINT NOT NULL DEFAULT 0,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_run_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function loadCheckpoint(client: Client, syncName: string): Promise<{ last_source_updated_at: string; last_source_transaction_id: string } | null> {
  const result = await client.query(
    `SELECT last_source_updated_at::text AS last_source_updated_at, last_source_transaction_id::text AS last_source_transaction_id
     FROM migration.transaction_sync_state
     WHERE sync_name = $1
     LIMIT 1`,
    [syncName]
  );

  return result.rows[0] ?? null;
}

async function saveCheckpoint(
  client: Client,
  syncName: string,
  updatedAt: string,
  transactionId: number,
  runCount: number
): Promise<void> {
  await client.query(
    `INSERT INTO migration.transaction_sync_state (
       sync_name, last_source_updated_at, last_source_transaction_id, last_run_at, last_run_count
     ) VALUES ($1, $2::timestamptz, $3::bigint, NOW(), $4)
     ON CONFLICT (sync_name) DO UPDATE SET
       last_source_updated_at = EXCLUDED.last_source_updated_at,
       last_source_transaction_id = EXCLUDED.last_source_transaction_id,
       last_run_at = EXCLUDED.last_run_at,
       last_run_count = EXCLUDED.last_run_count`,
    [syncName, updatedAt, transactionId, runCount]
  );
}

function runOnePassTransactionImport(transactionId: number): void {
  const result = spawnSync(
    process.execPath,
    [resolve(backendRoot, 'scripts', 'one-pass-transaction-import.cjs'), String(transactionId)],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PGHOST: String(PG.host),
        PGPORT: String(PG.port),
        PGDATABASE: String(PG.database),
        PGUSER: String(PG.user),
        PGPASSWORD: String(PG.password),
        DATABASE_URL: process.env.DATABASE_URL || buildPgConnectionString(),
      },
      stdio: 'inherit',
      shell: false,
    }
  );

  if (result.error) {
    throw new Error(`Failed to run one-pass transaction import for ${transactionId}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`One-pass transaction import failed for ${transactionId} with exit code ${result.status}`);
  }
}

function runTransactionCalculationBackfill(): void {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let result = spawnSync(
    npmCmd,
    ['run', 'data:recalculate:transaction-calculations'],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PGHOST: String(PG.host),
        PGPORT: String(PG.port),
        PGDATABASE: String(PG.database),
        PGUSER: String(PG.user),
        PGPASSWORD: String(PG.password),
        DATABASE_URL: process.env.DATABASE_URL || buildPgConnectionString(),
      },
      stdio: 'inherit',
      shell: false,
    }
  );

  // Some Windows environments throw EINVAL on direct npm.cmd spawn.
  if (result.error && process.platform === 'win32') {
    result = spawnSync(
      'cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd run data:recalculate:transaction-calculations'],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          PGHOST: String(PG.host),
          PGPORT: String(PG.port),
          PGDATABASE: String(PG.database),
          PGUSER: String(PG.user),
          PGPASSWORD: String(PG.password),
          DATABASE_URL: process.env.DATABASE_URL || buildPgConnectionString(),
        },
        stdio: 'inherit',
        shell: false,
      }
    );
  }

  if (result.error) {
    throw new Error(`Failed to run transaction calculation backfill: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Transaction calculation backfill failed with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const sinceArg = parseSinceArg(optionalArg('--since', ''));
  const dryRun = (optionalArg('--dry-run', '').trim().toLowerCase() === 'true') || process.argv.includes('--dry-run');
  const skipRecalculate = (optionalArg('--skip-recalculate', '').trim().toLowerCase() === 'true') || process.argv.includes('--skip-recalculate');
  const limitArg = Number(optionalArg('--limit', '0'));
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.trunc(limitArg) : 0;

  const az = await sql.connect(AZURE);
  const pg = new Client(PG);
  await pg.connect();

  try {
    await ensureCheckpointTable(pg);

    const checkpoint = sinceArg
      ? { last_source_updated_at: sinceArg.toISOString(), last_source_transaction_id: '0' }
      : await loadCheckpoint(pg, SYNC_NAME);

    const effectiveSince = checkpoint?.last_source_updated_at ?? defaultSince().toISOString();
    const effectiveId = Number(checkpoint?.last_source_transaction_id ?? '0') || 0;

    const topClause = limit > 0 ? `TOP (${limit})` : 'TOP (2147483647)';
    const deltaQuery = `
      SELECT ${topClause}
        t.Id AS TransactionId,
        t.TransactionNumber,
        t.WhenUpdated
      FROM dbo.[Transaction] t
      WHERE CAST(t.WhenUpdated AS datetime2(3)) > @sinceUpdated
         OR (CAST(t.WhenUpdated AS datetime2(3)) = @sinceUpdated AND t.Id > @sinceTransactionId)
      ORDER BY t.WhenUpdated, t.Id
    `;

    const delta = await az.request()
      .input('sinceUpdated', sql.DateTime2, new Date(effectiveSince))
      .input('sinceTransactionId', sql.Int, effectiveId)
      .query(deltaQuery);

    console.log('============================================================');
    console.log('KWSA Transaction Incremental Sync');
    console.log('============================================================');
    console.log(`sync-name : ${SYNC_NAME}`);
    console.log(`since      : ${effectiveSince}`);
    console.log(`since-id   : ${effectiveId}`);
    console.log(`target-db  : ${PG.host}:${PG.port}/${PG.database}`);
    console.log(`dry-run    : ${dryRun}`);
    console.log(`recalculate: ${skipRecalculate ? 'skip' : 'auto'}`);
    console.log(`delta rows : ${delta.recordset.length}`);
    console.log('============================================================');

    if (delta.recordset.length > 0) {
      const preview = delta.recordset.slice(0, 10).map((row: { TransactionNumber: string; WhenUpdated: Date }) => ({
        transaction_number: row.TransactionNumber,
        when_updated: row.WhenUpdated,
      }));
      console.table(preview);
    }

    if (dryRun) {
      console.log('Dry run only. No transactions were imported.');
      return;
    }

    let processed = 0;
    let lastUpdatedAt = effectiveSince;
    let lastTransactionId = effectiveId;

    for (const row of delta.recordset as Array<{ TransactionId: number; TransactionNumber: string; WhenUpdated: Date }>) {
      console.log(`\n[sync] Importing ${row.TransactionNumber} (Azure id ${row.TransactionId})`);
      runOnePassTransactionImport(row.TransactionId);
      processed += 1;
      lastUpdatedAt = new Date(row.WhenUpdated).toISOString();
      lastTransactionId = row.TransactionId;
      await saveCheckpoint(pg, SYNC_NAME, lastUpdatedAt, lastTransactionId, processed);
    }

    if (processed > 0 && !skipRecalculate) {
      console.log('\n[sync] Recalculating transaction summary metrics...');
      runTransactionCalculationBackfill();
      console.log('[sync] Transaction summary metrics recalculated.');
    }

    console.log('\nIncremental transaction sync completed successfully.');
    console.log(`Processed: ${processed}`);
    console.log(`Checkpoint: ${lastUpdatedAt} / ${lastTransactionId}`);
  } finally {
    await az.close();
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Incremental transaction sync failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
