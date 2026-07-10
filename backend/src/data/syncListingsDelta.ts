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
const SYNC_NAME = 'listings-daily-incremental';

function buildPgConnectionString(): string {
  return `postgresql://${encodeURIComponent(PG.user)}:${encodeURIComponent(PG.password)}@${PG.host}:${PG.port}/${PG.database}`;
}

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

async function ensureCheckpointTable(client: Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS migration;
    CREATE TABLE IF NOT EXISTS migration.listing_sync_state (
      sync_name TEXT PRIMARY KEY,
      last_source_updated_at TIMESTAMPTZ NOT NULL DEFAULT '1900-01-01T00:00:00Z'::timestamptz,
      last_source_listing_id BIGINT NOT NULL DEFAULT 0,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_run_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function loadCheckpoint(client: Client, syncName: string): Promise<{ last_source_updated_at: string; last_source_listing_id: string } | null> {
  const result = await client.query(
    `SELECT last_source_updated_at::text AS last_source_updated_at, last_source_listing_id::text AS last_source_listing_id
     FROM migration.listing_sync_state
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
  listingId: number,
  runCount: number
): Promise<void> {
  await client.query(
    `INSERT INTO migration.listing_sync_state (
       sync_name, last_source_updated_at, last_source_listing_id, last_run_at, last_run_count
     ) VALUES ($1, $2::timestamptz, $3::bigint, NOW(), $4)
     ON CONFLICT (sync_name) DO UPDATE SET
       last_source_updated_at = EXCLUDED.last_source_updated_at,
       last_source_listing_id = EXCLUDED.last_source_listing_id,
       last_run_at = EXCLUDED.last_run_at,
       last_run_count = EXCLUDED.last_run_count`,
    [syncName, updatedAt, listingId, runCount]
  );
}

function runOnePassImport(listingNumber: string): void {
  const result = spawnSync(
    process.execPath,
    [resolve(backendRoot, 'scripts', 'one-pass-listing-import.cjs'), listingNumber],
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
    throw new Error(`Failed to run one-pass import for ${listingNumber}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`One-pass import failed for ${listingNumber} with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const sinceArg = parseSinceArg(optionalArg('--since', ''));
  const dryRun = (optionalArg('--dry-run', '').trim().toLowerCase() === 'true') || process.argv.includes('--dry-run');
  const limitArg = Number(optionalArg('--limit', '0'));
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.trunc(limitArg) : 0;

  const az = await sql.connect(AZURE);
  const pg = new Client(PG);
  await pg.connect();

  try {
    await ensureCheckpointTable(pg);

    const checkpoint = sinceArg
      ? { last_source_updated_at: sinceArg.toISOString(), last_source_listing_id: '0' }
      : await loadCheckpoint(pg, SYNC_NAME);

    const effectiveSince = checkpoint?.last_source_updated_at ?? defaultSince().toISOString();
    const effectiveId = Number(checkpoint?.last_source_listing_id ?? '0') || 0;

    const topClause = limit > 0 ? `TOP (${limit})` : 'TOP (2147483647)';
    const deltaQuery = `
      SELECT ${topClause}
        l.Id AS ListingId,
        l.ListingNumber,
        l.WhenUpdated
      FROM dbo.Listing l
      WHERE l.WhenUpdated > @sinceUpdated
         OR (l.WhenUpdated = @sinceUpdated AND l.Id > @sinceListingId)
      ORDER BY l.WhenUpdated, l.Id
    `;

    const delta = await az.request()
      .input('sinceUpdated', sql.DateTime2, new Date(effectiveSince))
      .input('sinceListingId', sql.Int, effectiveId)
      .query(deltaQuery);

    console.log('============================================================');
    console.log('KWSA Listing Incremental Sync');
    console.log('============================================================');
    console.log(`sync-name : ${SYNC_NAME}`);
    console.log(`since      : ${effectiveSince}`);
    console.log(`since-id   : ${effectiveId}`);
    console.log(`target-db  : ${PG.host}:${PG.port}/${PG.database}`);
    console.log(`dry-run    : ${dryRun}`);
    console.log(`delta rows : ${delta.recordset.length}`);
    console.log('============================================================');

    if (delta.recordset.length > 0) {
      const preview = delta.recordset.slice(0, 10).map((row: { ListingNumber: string; WhenUpdated: Date }) => ({
        listing_number: row.ListingNumber,
        when_updated: row.WhenUpdated,
      }));
      console.table(preview);
    }

    if (dryRun) {
      console.log('Dry run only. No listings were imported.');
      return;
    }

    let processed = 0;
    let lastUpdatedAt = effectiveSince;
    let lastListingId = effectiveId;

    for (const row of delta.recordset as Array<{ ListingId: number; ListingNumber: string; WhenUpdated: Date }>) {
      console.log(`\n[sync] Importing ${row.ListingNumber} (Azure id ${row.ListingId})`);
      runOnePassImport(String(row.ListingNumber));
      processed += 1;
      lastUpdatedAt = new Date(row.WhenUpdated).toISOString();
      lastListingId = row.ListingId;
      await saveCheckpoint(pg, SYNC_NAME, lastUpdatedAt, lastListingId, processed);
    }

    console.log('\nIncremental sync completed successfully.');
    console.log(`Processed: ${processed}`);
    console.log(`Checkpoint: ${lastUpdatedAt} / ${lastListingId}`);
  } finally {
    await az.close();
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Incremental sync failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});