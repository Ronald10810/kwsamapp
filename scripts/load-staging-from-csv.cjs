#!/usr/bin/env node
// load-staging-from-csv.cjs
// Reads Azure export CSVs and inserts them into staging.* tables on GCP PostgreSQL.
//
// Usage (run from kwsa-cloud-console root):
//   $env:NODE_TLS_REJECT_UNAUTHORIZED="0"
//   $env:DATABASE_URL="postgresql://kwsa_uat:123456789@34.35.113.173:5432/kwsa_uat?sslmode=require"
//   node scripts/load-staging-from-csv.cjs --csv-dir scripts/azure-export --batch-id "azure-2026-04-28-v2" --truncate

'use strict';

const fs       = require('fs');
const path     = require('path');
const { Client } = require('pg');
const { parse } = require('csv-parse');
const { parse: parseSync } = require('csv-parse/sync');

// args
const args     = process.argv.slice(2);
const getArg   = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : def; };
const hasFlag  = (flag) => args.includes(flag);

const csvDir   = getArg('--csv-dir',  path.join(__dirname, 'azure-export'));
const batchId  = getArg('--batch-id', `azure-${new Date().toISOString().slice(0,10)}`);
const dbUrl    = getArg('--db-url',   process.env.DATABASE_URL);
const truncate = hasFlag('--truncate');

if (!dbUrl) {
  console.error('Error: DATABASE_URL not set. Pass --db-url or set DATABASE_URL in environment.');
  process.exit(1);
}

// CSV line parser
function parseLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
          if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map(c => c === '' ? null : c);
}

// in-memory CSV parser
function parseCSV(filePath) {
  const raw   = fs.readFileSync(filePath, 'utf8');
  return parseSync(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax: true,
    relax_column_count: true,
  });
}

function toTimestampOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// batch insert
async function batchInsert(client, table, columns, rows, chunkSize = 500) {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk        = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, ri) =>
      `(${columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(',')})`
    ).join(',');
    const values = chunk.flatMap(row => columns.map(c => row[c]));
    await client.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      values
    );
    inserted += chunk.length;
  }
  return inserted;
}

// streaming CSV inserter backed by csv-parse for robust multiline/quoted fields
async function streamCsvInsert(client, table, columns, csvFile, rowMapper, chunkSize = 1000) {
  const parser = fs.createReadStream(csvFile, { encoding: 'utf8' }).pipe(parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax: true,
    relax_column_count: true,
  }));

  let chunk = [];
  let total = 0;
  let rowCount = 0;

  const flush = async () => {
    if (!chunk.length) return;
    const batch = chunk.splice(0);
    const mapped = batch.map(rowMapper).filter(r => r !== null);
    if (mapped.length) {
      total += await batchInsert(client, table, columns, mapped, mapped.length);
    }
  };

  for await (const row of parser) {
    rowCount++;
    chunk.push(row);
    if (chunk.length >= chunkSize) {
      await flush();
    }
    if (rowCount % 50000 === 0) process.stdout.write(`\r  ...    ${table}: ${rowCount} rows`);
  }

  await flush();
  process.stdout.write(`\r  [ok]   ${table}: ${total} rows          \n`);
  return total;
}

// main
async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`[load] Connected to database`);
  console.log(`[load] Batch ID: ${batchId}`);
  console.log(`[load] CSV dir:  ${csvDir}`);
  console.log(`[load] Truncate: ${truncate}`);

  function csvFile(name) { return path.join(csvDir, `${name}.csv`); }
  function exists(name)  { return fs.existsSync(csvFile(name)); }

  try {
    // create missing staging tables
    await client.query(`CREATE TABLE IF NOT EXISTS staging.listing_images_raw (id BIGSERIAL PRIMARY KEY, source_listing_id TEXT, document_id TEXT, image_url TEXT, preview_url TEXT, order_number INTEGER, image_caption TEXT, loaded_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listing_images_raw_listing ON staging.listing_images_raw(source_listing_id)`);
    await client.query(`CREATE TABLE IF NOT EXISTS staging.listing_marketing_urls_raw (id BIGSERIAL PRIMARY KEY, source_listing_id TEXT, url TEXT, marketing_url_type_id TEXT, loaded_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listing_mkt_urls_listing ON staging.listing_marketing_urls_raw(source_listing_id)`);
    console.log('[load] Staging tables ensured.');

    if (truncate) {
      console.log('[load] Truncating all staging tables...');
      await client.query(`TRUNCATE staging.market_centers_raw, staging.teams_raw, staging.associates_raw, staging.listings_raw, staging.transactions_raw, staging.transaction_agents, staging.transaction_associate_payment_details, staging.listing_associates, staging.listing_images_raw, staging.listing_marketing_urls_raw RESTART IDENTITY CASCADE`);
      console.log('[load] Staging tables cleared.');
    }

    // market_centers_raw
    if (exists('market_centers_raw')) {
      const rows = parseCSV(csvFile('market_centers_raw'));
      const mapped = rows.map(r => ({ batch_id: batchId, source_market_center_id: r.source_market_center_id, name: r.name, status_name: r.status_name, frontdoor_id: r.frontdoor_id, source_updated_at: r.source_updated_at || null, raw_payload: JSON.stringify(r) }));
      const n = await batchInsert(client, 'staging.market_centers_raw', ['batch_id','source_market_center_id','name','status_name','frontdoor_id','source_updated_at','raw_payload'], mapped);
      console.log(`  [ok]   staging.market_centers_raw: ${n} rows`);
    }

    // teams_raw
    if (exists('teams_raw')) {
      const rows = parseCSV(csvFile('teams_raw'));
      const mapped = rows.map(r => ({ batch_id: batchId, source_team_id: r.source_team_id, source_market_center_id: r.source_market_center_id, name: r.name, status_name: r.status_name, source_updated_at: r.source_updated_at || null, raw_payload: JSON.stringify(r) }));
      const n = await batchInsert(client, 'staging.teams_raw', ['batch_id','source_team_id','source_market_center_id','name','status_name','source_updated_at','raw_payload'], mapped);
      console.log(`  [ok]   staging.teams_raw: ${n} rows`);
    }

    // associates_raw
    if (exists('associates_raw')) {
      const rows = parseCSV(csvFile('associates_raw'));
      const mapped = rows.map(r => ({ batch_id: batchId, source_associate_id: r.source_associate_id, first_name: r.first_name, last_name: r.last_name, email: r.email, status_name: r.status_name, market_center_name: r.market_center_name, team_name: r.team_name, kwuid: r.kwuid, source_updated_at: toTimestampOrNull(r.source_updated_at), raw_payload: JSON.stringify(r) }));
      const n = await batchInsert(client, 'staging.associates_raw', ['batch_id','source_associate_id','first_name','last_name','email','status_name','market_center_name','team_name','kwuid','source_updated_at','raw_payload'], mapped);
      console.log(`  [ok]   staging.associates_raw: ${n} rows`);
    }

    // listings_raw (stream - large file)
    if (exists('listings_raw')) {
      console.log('  [...]  staging.listings_raw: streaming large file...');
      await streamCsvInsert(client, 'staging.listings_raw',
        ['batch_id','source_listing_id','listing_number','status_name','market_center_name','sale_or_rent','street_number','street_name','suburb','city','province','country','price','expiry_date','source_updated_at','property_title','short_title','property_description','listing_images_json','raw_payload'],
        csvFile('listings_raw'),
        r => ({ batch_id: batchId, source_listing_id: r.source_listing_id, listing_number: r.listing_number, status_name: r.status_name, market_center_name: r.market_center_name, sale_or_rent: r.sale_or_rent, street_number: r.street_number, street_name: r.street_name, suburb: r.suburb, city: r.city, province: r.province, country: r.country, price: toNumberOrNull(r.price), expiry_date: toTimestampOrNull(r.expiry_date), source_updated_at: toTimestampOrNull(r.source_updated_at), property_title: r.property_title, short_title: r.short_title, property_description: r.property_description, listing_images_json: null, raw_payload: JSON.stringify(r) }),
        500
      );
    }

    // transactions_raw
    if (exists('transactions_raw')) {
      const rows = parseCSV(csvFile('transactions_raw'));
      const mapped = rows.map(r => ({ batch_id: batchId, source_transaction_id: r.source_transaction_id, transaction_number: r.transaction_number, source_market_center_id: r.source_market_center_id, market_center_name: r.market_center_name, source_associate_id: null, associate_name: null, transaction_status: r.transaction_status, source_listing_id: r.source_listing_id, listing_number: r.listing_number, list_date: toTimestampOrNull(r.list_date), transaction_date: toTimestampOrNull(r.transaction_date), status_change_date: toTimestampOrNull(r.status_change_date), expected_date: toTimestampOrNull(r.expected_date), transaction_type: null, address: r.address, suburb: r.suburb, city: r.city, sales_price: toNumberOrNull(r.sales_price), list_price: toNumberOrNull(r.list_price), gci_excl_vat: toNumberOrNull(r.gci_excl_vat), split_percentage: null, net_comm: null, total_gci: null, sale_type: r.sale_type, agent_type: null, buyer: null, seller: null, raw_payload: JSON.stringify(r) }));
      const n = await batchInsert(client, 'staging.transactions_raw', ['batch_id','source_transaction_id','transaction_number','source_market_center_id','market_center_name','source_associate_id','associate_name','transaction_status','source_listing_id','listing_number','list_date','transaction_date','status_change_date','expected_date','transaction_type','address','suburb','city','sales_price','list_price','gci_excl_vat','split_percentage','net_comm','total_gci','sale_type','agent_type','buyer','seller','raw_payload'], mapped);
      console.log(`  [ok]   staging.transactions_raw: ${n} rows`);
    }

    // transaction_agents
    if (exists('transaction_agents')) {
      const txMap = {};
      const txRes = await client.query(`SELECT id, source_transaction_id FROM staging.transactions_raw WHERE batch_id = $1`, [batchId]);
      txRes.rows.forEach(r => { txMap[r.source_transaction_id] = r.id; });
      const rows = parseCSV(csvFile('transaction_agents'));
      const mapped = rows.filter(r => txMap[r.transaction_id]).map((r, i) => ({ transaction_id: txMap[r.transaction_id], source_associate_id: r.source_associate_id, associate_name: r.associate_name, split_percentage: toNumberOrNull(r.split_percentage) ?? 0, agent_type: r.agent_type, sort_order: toIntOrNull(r.sort_order) ?? i }));
      const n = await batchInsert(client, 'staging.transaction_agents', ['transaction_id','source_associate_id','associate_name','split_percentage','agent_type','sort_order'], mapped);
      console.log(`  [ok]   staging.transaction_agents: ${n} rows`);
      await client.query(`UPDATE staging.transactions_raw tr SET source_associate_id = ta.source_associate_id, associate_name = ta.associate_name, split_percentage = ta.split_percentage, agent_type = ta.agent_type FROM staging.transaction_agents ta WHERE ta.transaction_id = tr.id AND ta.sort_order = 1 AND tr.batch_id = $1`, [batchId]);
      console.log('  [ok]   back-filled primary agent on transactions_raw');
    }

    // transaction_associate_payment_details
    if (exists('transaction_associate_payment_details')) {
      const rows = parseCSV(csvFile('transaction_associate_payment_details'));
      const mapped = rows.map(r => ({ source_transaction_id: r.source_transaction_id, source_associate_id: r.source_associate_id, split_percentage: toNumberOrNull(r.split_percentage), gci_before_fees: toNumberOrNull(r.gci_before_fees), production_royalties: toNumberOrNull(r.production_royalties), growth_share: toNumberOrNull(r.growth_share), gci_after_fees_excl_vat: toNumberOrNull(r.gci_after_fees_excl_vat), cap_remaining: toNumberOrNull(r.cap_remaining), associate_dollar: toNumberOrNull(r.associate_dollar), team_dollar: toNumberOrNull(r.team_dollar), mc_dollar: toNumberOrNull(r.mc_dollar) }));
      const n = await batchInsert(client, 'staging.transaction_associate_payment_details', ['source_transaction_id','source_associate_id','split_percentage','gci_before_fees','production_royalties','growth_share','gci_after_fees_excl_vat','cap_remaining','associate_dollar','team_dollar','mc_dollar'], mapped);
      console.log(`  [ok]   staging.transaction_associate_payment_details: ${n} rows`);
    }

    // listing_associates
    if (exists('listing_associates')) {
      const rows = parseCSV(csvFile('listing_associates'));
      const mapped = rows.map(r => ({ source_listing_id: r.source_listing_id, source_associate_id: r.source_associate_id, associate_name: r.associate_name, is_primary: r.is_primary === 'true' }));
      const n = await batchInsert(client, 'staging.listing_associates', ['source_listing_id','source_associate_id','associate_name','is_primary'], mapped);
      console.log(`  [ok]   staging.listing_associates: ${n} rows`);
    }

    // listing_images_raw (stream - 2.6M rows)
    if (exists('listing_images_raw')) {
      console.log('  [...]  staging.listing_images_raw: streaming ~2.6M rows...');
      await streamCsvInsert(client, 'staging.listing_images_raw',
        ['source_listing_id','document_id','image_url','preview_url','order_number','image_caption'],
        csvFile('listing_images_raw'),
        r => ({ source_listing_id: r.source_listing_id, document_id: r.document_id, image_url: r.image_url, preview_url: r.preview_url, order_number: toIntOrNull(r.order_number), image_caption: r.image_caption }),
        2000
      );
    }

    // listing_marketing_urls_raw
    if (exists('listing_marketing_urls_raw')) {
      const rows = parseCSV(csvFile('listing_marketing_urls_raw'));
      const mapped = rows.map(r => ({ source_listing_id: r.source_listing_id, url: r.url, marketing_url_type_id: r.marketing_url_type_id }));
      const n = await batchInsert(client, 'staging.listing_marketing_urls_raw', ['source_listing_id','url','marketing_url_type_id'], mapped);
      console.log(`  [ok]   staging.listing_marketing_urls_raw: ${n} rows`);
    }

  } finally {
    await client.end();
  }

  console.log('');
  console.log('[load] All staging tables loaded.');
  console.log('[load] Next: node scripts/run-sql.cjs scripts/transform-staging-to-migration.sql');
}

main().catch(err => { console.error(err); process.exit(1); });