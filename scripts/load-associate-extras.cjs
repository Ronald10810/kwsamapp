'use strict';
// load-associate-extras.cjs
// Creates staging tables and loads the associate-extra CSVs into PostgreSQL.
// Usage:
//   node scripts/load-associate-extras.cjs
//   node scripts/load-associate-extras.cjs --truncate   (re-load even if rows exist)

const path = require('path');
const fs   = require('fs');
const { Client } = require('pg');
const { parse }  = require('csv-parse');

const DB_URL  = process.env.DATABASE_URL;
const CSV_DIR = path.join(__dirname, 'azure-export');
const FORCE   = process.argv.includes('--truncate');

if (!DB_URL) {
  console.error('[load] ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

// ── helpers ───────────────────────────────────────────────────────────────

function toTextOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function toBoolOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function toNumericOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  // Accept ISO date strings like 2023-01-15 or 2023-01-15T00:00:00
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Stream a CSV file, inserting rows in batches via COPY-style unnest inserts
async function streamCsvInsert(client, csvFile, tableName, columns, rowMapper) {
  const filePath = path.join(CSV_DIR, csvFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`[load] SKIP: ${csvFile} not found`);
    return 0;
  }

  return new Promise((resolve, reject) => {
    let rowCount = 0;
    const BATCH  = 2000;
    let batch    = [];

    async function flushBatch(finalFlush) {
      if (batch.length === 0) return;
      // Build parameterised INSERT from batch
      const params = [];
      const rows   = batch.map((row) => {
        const vals = columns.map(() => {
          params.push(row[params.length / columns.length | 0] !== undefined
            ? row[Math.floor(params.length / columns.length)]
            : null);
          // Fix: rebuild properly
          return null;
        });
        return vals;
      });

      // Simpler approach: build VALUES manually
      const valueRows = batch.map((row) => {
        const placeholders = row.map((_, i) => `$${params.length - row.length + i + 1}`);
        return `(${placeholders.join(',')})`;
      });
      // Reset and rebuild
      params.length = 0;
      const valueRows2 = batch.map((row) => {
        const start = params.length + 1;
        row.forEach((v) => params.push(v));
        const placeholders = row.map((_, i) => `$${start + i}`);
        return `(${placeholders.join(',')})`;
      });

      const sql = `INSERT INTO staging.${tableName} (${columns.join(',')}) VALUES ${valueRows2.join(',')} ON CONFLICT DO NOTHING`;
      await client.query(sql, params);
      rowCount += batch.length;
      batch = [];
    }

    const parser = parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });

    parser.on('readable', async () => {
      let record;
      while ((record = parser.read()) !== null) {
        const mapped = rowMapper(record);
        if (mapped) batch.push(mapped);
        if (batch.length >= BATCH) {
          parser.pause();
          try {
            await flushBatch(false);
          } catch (err) {
            reject(err);
            return;
          }
          parser.resume();
        }
      }
    });

    parser.on('end', async () => {
      try {
        await flushBatch(true);
        resolve(rowCount);
      } catch (err) {
        reject(err);
      }
    });

    parser.on('error', reject);

    fs.createReadStream(filePath).pipe(parser);
  });
}

// Simpler streaming insert without the flush complexity
async function loadCsv(client, csvFile, tableName, columns, rowMapper) {
  const filePath = path.join(CSV_DIR, csvFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`[load] SKIP: ${csvFile} not found`);
    return 0;
  }

  const rows = await new Promise((resolve, reject) => {
    const results = [];
    const parser = parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
    parser.on('readable', () => {
      let rec;
      while ((rec = parser.read()) !== null) {
        const mapped = rowMapper(rec);
        if (mapped) results.push(mapped);
      }
    });
    parser.on('end', () => resolve(results));
    parser.on('error', reject);
    fs.createReadStream(filePath).pipe(parser);
  });

  if (rows.length === 0) return 0;

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const valueRows = chunk.map((row) => {
      const start = params.length + 1;
      row.forEach((v) => params.push(v));
      return `(${row.map((_, idx) => `$${start + idx}`).join(',')})`;
    });
    await client.query(
      `INSERT INTO staging.${tableName} (${columns.join(',')}) VALUES ${valueRows.join(',')} ON CONFLICT DO NOTHING`,
      params
    );
    inserted += chunk.length;
  }
  return inserted;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('[load] Connected to PostgreSQL.');

  try {
    // ── Create staging tables if they don't exist ──────────────────────────

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_third_party_raw (
        source_associate_id    TEXT,
        feed_to_p24            TEXT,
        p24_agent_id           TEXT,
        entegral_agent_id      TEXT,
        feed_to_entegral       TEXT,
        entegral_sync_message  TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_commissions_raw (
        source_associate_id  TEXT,
        commission_split_pct TEXT,
        total_cap_amount     TEXT,
        manual_cap           TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_business_details_raw (
        source_associate_id               TEXT,
        kwuid                             TEXT,
        growth_share_sponsor_source_id    TEXT,
        proposed_growth_share_sponsor     TEXT,
        temporary_growth_share_sponsor    TEXT,
        vested                            TEXT,
        vesting_start_period              TEXT,
        listing_approval_required         TEXT,
        exclude_from_individual_reports   TEXT,
        source_market_center_id           TEXT,
        source_team_id                    TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_roles_raw (
        source_associate_id TEXT,
        role_name           TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_job_titles_raw (
        source_associate_id TEXT,
        job_title_name      TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_service_communities_raw (
        source_associate_id    TEXT,
        service_community_name TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_admin_market_centers_raw (
        source_associate_id    TEXT,
        source_market_center_id TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_admin_teams_raw (
        source_associate_id TEXT,
        source_team_id      TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staging.associate_dates_raw (
        source_associate_id TEXT,
        start_date          TEXT,
        end_date            TEXT,
        anniversary_date    TEXT,
        cap_date            TEXT
      );
    `);

    console.log('[load] Staging tables ready.');

    // ── Optionally truncate ──────────────────────────────────────────────────
    if (FORCE) {
      const tables = [
        'associate_third_party_raw', 'associate_commissions_raw', 'associate_business_details_raw',
        'associate_roles_raw', 'associate_job_titles_raw',
        'associate_service_communities_raw', 'associate_admin_market_centers_raw',
        'associate_admin_teams_raw', 'associate_dates_raw',
      ];
      for (const t of tables) {
        await client.query(`TRUNCATE staging.${t}`);
        console.log(`[load] Truncated staging.${t}`);
      }
    }

    // ── Load CSVs ──────────────────────────────────────────────────────────

    let n;

    n = await loadCsv(client, 'associate_third_party_raw.csv', 'associate_third_party_raw',
      ['source_associate_id','feed_to_p24','p24_agent_id','entegral_agent_id','feed_to_entegral','entegral_sync_message'],
      (r) => [
        toTextOrNull(r.source_associate_id),
        toTextOrNull(r.feed_to_p24),
        toTextOrNull(r.p24_agent_id),
        toTextOrNull(r.entegral_agent_id),
        toTextOrNull(r.feed_to_entegral),
        toTextOrNull(r.entegral_sync_message),
      ]
    );
    console.log(`[load] associate_third_party_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_commissions_raw.csv', 'associate_commissions_raw',
      ['source_associate_id','commission_split_pct','total_cap_amount','manual_cap'],
      (r) => [
        toTextOrNull(r.source_associate_id),
        toTextOrNull(r.commission_split_pct),
        toTextOrNull(r.total_cap_amount),
        toTextOrNull(r.manual_cap),
      ]
    );
    console.log(`[load] associate_commissions_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_business_details_raw.csv', 'associate_business_details_raw',
      [
        'source_associate_id','kwuid','growth_share_sponsor_source_id','proposed_growth_share_sponsor',
        'temporary_growth_share_sponsor','vested','vesting_start_period','listing_approval_required',
        'exclude_from_individual_reports','source_market_center_id','source_team_id'
      ],
      (r) => [
        toTextOrNull(r.source_associate_id),
        toTextOrNull(r.kwuid),
        toTextOrNull(r.growth_share_sponsor_source_id),
        toTextOrNull(r.proposed_growth_share_sponsor),
        toTextOrNull(r.temporary_growth_share_sponsor),
        toTextOrNull(r.vested),
        toTextOrNull(r.vesting_start_period),
        toTextOrNull(r.listing_approval_required),
        toTextOrNull(r.exclude_from_individual_reports),
        toTextOrNull(r.source_market_center_id),
        toTextOrNull(r.source_team_id),
      ]
    );
    console.log(`[load] associate_business_details_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_roles_raw.csv', 'associate_roles_raw',
      ['source_associate_id','role_name'],
      (r) => [toTextOrNull(r.source_associate_id), toTextOrNull(r.role_name)]
    );
    console.log(`[load] associate_roles_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_job_titles_raw.csv', 'associate_job_titles_raw',
      ['source_associate_id','job_title_name'],
      (r) => [toTextOrNull(r.source_associate_id), toTextOrNull(r.job_title_name)]
    );
    console.log(`[load] associate_job_titles_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_service_communities_raw.csv', 'associate_service_communities_raw',
      ['source_associate_id','service_community_name'],
      (r) => [toTextOrNull(r.source_associate_id), toTextOrNull(r.service_community_name)]
    );
    console.log(`[load] associate_service_communities_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_admin_market_centers_raw.csv', 'associate_admin_market_centers_raw',
      ['source_associate_id','source_market_center_id'],
      (r) => [toTextOrNull(r.source_associate_id), toTextOrNull(r.source_market_center_id)]
    );
    console.log(`[load] associate_admin_market_centers_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_admin_teams_raw.csv', 'associate_admin_teams_raw',
      ['source_associate_id','source_team_id'],
      (r) => [toTextOrNull(r.source_associate_id), toTextOrNull(r.source_team_id)]
    );
    console.log(`[load] associate_admin_teams_raw: ${n} rows`);

    n = await loadCsv(client, 'associate_dates_raw.csv', 'associate_dates_raw',
      ['source_associate_id','start_date','end_date','anniversary_date','cap_date'],
      (r) => [
        toTextOrNull(r.source_associate_id),
        toTextOrNull(r.start_date),
        toTextOrNull(r.end_date),
        toTextOrNull(r.anniversary_date),
        toTextOrNull(r.cap_date),
      ]
    );
    console.log(`[load] associate_dates_raw: ${n} rows`);

    console.log('[load] Done. Next step: node scripts/run-sql.cjs scripts/enrich-associate-migration.sql');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[load] FATAL:', err);
  process.exit(1);
});
