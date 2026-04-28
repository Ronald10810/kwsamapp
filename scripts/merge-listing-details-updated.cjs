'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function requireWorkspacePackage(packageName) {
  try {
    return require(packageName);
  } catch {
    const backendRequire = createRequire(path.join(__dirname, '..', 'backend', 'package.json'));
    return backendRequire(packageName);
  }
}

const { Client } = requireWorkspacePackage('pg');
const { parse } = requireWorkspacePackage('csv-parse');

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  return args[idx + 1] ?? fallback;
};

const DB_URL = process.env.DATABASE_URL;
const csvPathArg = getArg('--csv');
const activeOnly = args.includes('--active-only');

if (!DB_URL) {
  console.error('[merge-listings] ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

if (!csvPathArg) {
  console.error('[merge-listings] Usage: node scripts/merge-listing-details-updated.cjs --csv "C:\\path\\Listing Details Updated.csv"');
  process.exit(1);
}

const csvPath = path.resolve(csvPathArg);
if (!fs.existsSync(csvPath)) {
  console.error(`[merge-listings] ERROR: CSV not found at ${csvPath}`);
  process.exit(1);
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toBoolOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  const v = s.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return null;
}

function toNumericOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(value) {
  const s = toTextOrNull(value);
  if (!s) return null;
  const normalized = s.replace(/\//g, '-');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function inferFeedFlag(reference, syncStatus) {
  if (reference) return true;
  if (syncStatus) return true;
  return null;
}

async function batchInsert(client, tableName, columns, rows) {
  if (rows.length === 0) return 0;
  const params = [];
  const valuesSql = rows
    .map((row) => {
      const start = params.length + 1;
      columns.forEach((col) => params.push(row[col] ?? null));
      return `(${columns.map((_, idx) => `$${start + idx}`).join(',')})`;
    })
    .join(',');

  await client.query(`INSERT INTO ${tableName} (${columns.join(',')}) VALUES ${valuesSql}`, params);
  return rows.length;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let parsedRows = 0;
  let stagedRows = 0;

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE tmp_listing_details_updated (
        source_listing_id TEXT,
        listing_number TEXT,
        property_title TEXT,
        short_title TEXT,
        short_description TEXT,
        property_description TEXT,
        status_name TEXT,
        listing_status_tag TEXT,
        mandate_type TEXT,
        ownership_type TEXT,
        sale_or_rent TEXT,
        price NUMERIC(18,2),
        expiration_date DATE,
        reduced_date DATE,
        sold_date DATE,
        sold_price NUMERIC(18,2),
        address_line TEXT,
        suburb TEXT,
        city TEXT,
        estate_name TEXT,
        erf_number TEXT,
        unit_number TEXT,
        door_number TEXT,
        street_number TEXT,
        street_name TEXT,
        country TEXT,
        province TEXT,
        postal_code TEXT,
        no_transfer_duty BOOLEAN,
        property_auction BOOLEAN,
        poa BOOLEAN,
        retirement_living BOOLEAN,
        property24_ref1 TEXT,
        private_property_ref1 TEXT,
        entegral_reference TEXT,
        kww_property_reference TEXT,
        property24_sync_status TEXT,
        private_property_sync_status TEXT,
        entegral_sync_status TEXT,
        kww_sync_status TEXT,
        feed_to_property24 BOOLEAN,
        feed_to_private_property BOOLEAN,
        feed_to_entegral BOOLEAN,
        feed_to_kww BOOLEAN,
        signed_date DATE,
        on_market_since_date DATE,
        occupation_date DATE,
        rates_and_taxes NUMERIC(18,2),
        monthly_levy NUMERIC(18,2),
        erf_size NUMERIC(18,2),
        floor_area NUMERIC(18,2),
        listing_payload JSONB
      ) ON COMMIT DROP
    `);

    const parser = fs.createReadStream(csvPath).pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }));

    const batch = [];
    const BATCH_SIZE = 1000;

    for await (const row of parser) {
      parsedRows += 1;

      if (activeOnly) {
        const listingStatus = toTextOrNull(row.ListingStatus);
        if ((listingStatus || '').toLowerCase() !== 'active') {
          continue;
        }
      }

      const sourceListingId = toTextOrNull(row.ListingId);
      const listingNumber = toTextOrNull(row.ListingNumber);
      if (!sourceListingId && !listingNumber) continue;

      const property24Ref = toTextOrNull(row.Property24Reference);
      const privatePropertyRef = toTextOrNull(row.PrivatePropertyReference);
      const entegralReference = toTextOrNull(row.EntegralReference);
      const kwwPropertyReference = toTextOrNull(row.KwwPropertyReference);
      const property24SyncStatus = toTextOrNull(row.P24SyncMessage);
      const privatePropertySyncStatus = toTextOrNull(row.PrivatePropertySyncMessage);
      const entegralSyncStatus = toTextOrNull(row.EntegralSyncMessage);
      const kwwSyncStatus = toTextOrNull(row.KwwSyncMessage);

      batch.push({
        source_listing_id: sourceListingId,
        listing_number: listingNumber,
        property_title: toTextOrNull(row.PropertyTitle),
        short_title: toTextOrNull(row.ShortTitle),
        short_description: toTextOrNull(row.ShortDescription),
        property_description: toTextOrNull(row.PropertyDescription),
        status_name: toTextOrNull(row.ListingStatus),
        listing_status_tag: toTextOrNull(row.ListingStatusTag),
        mandate_type: toTextOrNull(row.ListingMandateType),
        ownership_type: toTextOrNull(row.OwnershipType),
        sale_or_rent: toTextOrNull(row.SaleType),
        price: toNumericOrNull(row.ListPrice),
        expiration_date: toDateOrNull(row.ExpirationDate),
        reduced_date: toDateOrNull(row.ReducedDate),
        sold_date: toDateOrNull(row.SoldDate),
        sold_price: toNumericOrNull(row.SoldPrice),
        address_line: toTextOrNull(row.FullAddress),
        suburb: toTextOrNull(row.Suburb),
        city: toTextOrNull(row.City),
        estate_name: toTextOrNull(row.EstateName),
        erf_number: toTextOrNull(row.ErfNumber),
        unit_number: toTextOrNull(row.UnitNumber),
        door_number: toTextOrNull(row.DoorNumber),
        street_number: toTextOrNull(row.StreetNumber),
        street_name: toTextOrNull(row.StreetName),
        country: toTextOrNull(row.Country),
        province: toTextOrNull(row.Province),
        postal_code: toTextOrNull(row.PostalCode),
        no_transfer_duty: toBoolOrNull(row.NoTransferDuty),
        property_auction: toBoolOrNull(row.PropertyAuction),
        poa: toBoolOrNull(row.POA),
        retirement_living: toBoolOrNull(row.RetirementLiving),
        property24_ref1: property24Ref,
        private_property_ref1: privatePropertyRef,
        entegral_reference: entegralReference,
        kww_property_reference: kwwPropertyReference,
        property24_sync_status: property24SyncStatus,
        private_property_sync_status: privatePropertySyncStatus,
        entegral_sync_status: entegralSyncStatus,
        kww_sync_status: kwwSyncStatus,
        feed_to_property24: inferFeedFlag(property24Ref, property24SyncStatus),
        feed_to_private_property: inferFeedFlag(privatePropertyRef, privatePropertySyncStatus),
        feed_to_entegral: inferFeedFlag(entegralReference, entegralSyncStatus),
        feed_to_kww: inferFeedFlag(kwwPropertyReference, kwwSyncStatus),
        signed_date: toDateOrNull(row.SignedDate),
        on_market_since_date: toDateOrNull(row.OnMarketSince),
        occupation_date: toDateOrNull(row.OccupationDate),
        rates_and_taxes: toNumericOrNull(row.RatesandTaxes),
        monthly_levy: toNumericOrNull(row.MonthlyLevy),
        erf_size: toNumericOrNull(row.ErfSize),
        floor_area: toNumericOrNull(row.FloorArea),
        listing_payload: JSON.stringify(row),
      });

      if (batch.length >= BATCH_SIZE) {
        stagedRows += await batchInsert(client, 'tmp_listing_details_updated', [
          'source_listing_id', 'listing_number', 'property_title', 'short_title', 'short_description', 'property_description',
          'status_name', 'listing_status_tag', 'mandate_type', 'ownership_type', 'sale_or_rent', 'price', 'expiration_date',
          'reduced_date', 'sold_date', 'sold_price', 'address_line', 'suburb', 'city', 'estate_name', 'erf_number', 'unit_number',
          'door_number', 'street_number', 'street_name', 'country', 'province', 'postal_code', 'no_transfer_duty', 'property_auction',
          'poa', 'retirement_living', 'property24_ref1', 'private_property_ref1', 'entegral_reference', 'kww_property_reference',
          'property24_sync_status', 'private_property_sync_status', 'entegral_sync_status', 'kww_sync_status', 'feed_to_property24',
          'feed_to_private_property', 'feed_to_entegral', 'feed_to_kww', 'signed_date', 'on_market_since_date', 'occupation_date',
          'rates_and_taxes', 'monthly_levy', 'erf_size', 'floor_area', 'listing_payload'
        ], batch.splice(0, batch.length));
      }
    }

    if (batch.length > 0) {
      stagedRows += await batchInsert(client, 'tmp_listing_details_updated', [
        'source_listing_id', 'listing_number', 'property_title', 'short_title', 'short_description', 'property_description',
        'status_name', 'listing_status_tag', 'mandate_type', 'ownership_type', 'sale_or_rent', 'price', 'expiration_date',
        'reduced_date', 'sold_date', 'sold_price', 'address_line', 'suburb', 'city', 'estate_name', 'erf_number', 'unit_number',
        'door_number', 'street_number', 'street_name', 'country', 'province', 'postal_code', 'no_transfer_duty', 'property_auction',
        'poa', 'retirement_living', 'property24_ref1', 'private_property_ref1', 'entegral_reference', 'kww_property_reference',
        'property24_sync_status', 'private_property_sync_status', 'entegral_sync_status', 'kww_sync_status', 'feed_to_property24',
        'feed_to_private_property', 'feed_to_entegral', 'feed_to_kww', 'signed_date', 'on_market_since_date', 'occupation_date',
        'rates_and_taxes', 'monthly_levy', 'erf_size', 'floor_area', 'listing_payload'
      ], batch.splice(0, batch.length));
    }

    const updateResult = await client.query(`
      UPDATE migration.core_listings cl
      SET
        property_title = COALESCE(NULLIF(cl.property_title, ''), NULLIF(t.property_title, '')),
        short_title = COALESCE(NULLIF(cl.short_title, ''), NULLIF(t.short_title, '')),
        short_description = COALESCE(NULLIF(cl.short_description, ''), NULLIF(t.short_description, '')),
        property_description = COALESCE(NULLIF(cl.property_description, ''), NULLIF(t.property_description, '')),
        status_name = COALESCE(NULLIF(cl.status_name, ''), NULLIF(t.status_name, '')),
        listing_status_tag = COALESCE(NULLIF(cl.listing_status_tag, ''), NULLIF(t.listing_status_tag, '')),
        mandate_type = COALESCE(NULLIF(cl.mandate_type, ''), NULLIF(t.mandate_type, '')),
        ownership_type = COALESCE(NULLIF(cl.ownership_type, ''), NULLIF(t.ownership_type, '')),
        sale_or_rent = COALESCE(NULLIF(cl.sale_or_rent, ''), NULLIF(t.sale_or_rent, '')),
        price = COALESCE(cl.price, t.price),
        expiry_date = COALESCE(cl.expiry_date, t.expiration_date),
        reduced_date = COALESCE(cl.reduced_date, t.reduced_date),
        address_line = COALESCE(NULLIF(cl.address_line, ''), NULLIF(t.address_line, '')),
        suburb = COALESCE(NULLIF(cl.suburb, ''), NULLIF(t.suburb, '')),
        city = COALESCE(NULLIF(cl.city, ''), NULLIF(t.city, '')),
        estate_name = COALESCE(NULLIF(cl.estate_name, ''), NULLIF(t.estate_name, '')),
        erf_number = COALESCE(NULLIF(cl.erf_number, ''), NULLIF(t.erf_number, '')),
        unit_number = COALESCE(NULLIF(cl.unit_number, ''), NULLIF(t.unit_number, '')),
        door_number = COALESCE(NULLIF(cl.door_number, ''), NULLIF(t.door_number, '')),
        street_number = COALESCE(NULLIF(cl.street_number, ''), NULLIF(t.street_number, '')),
        street_name = COALESCE(NULLIF(cl.street_name, ''), NULLIF(t.street_name, '')),
        country = COALESCE(NULLIF(cl.country, ''), NULLIF(t.country, '')),
        province = COALESCE(NULLIF(cl.province, ''), NULLIF(t.province, '')),
        postal_code = COALESCE(NULLIF(cl.postal_code, ''), NULLIF(t.postal_code, '')),
        no_transfer_duty = COALESCE(cl.no_transfer_duty, t.no_transfer_duty),
        property_auction = COALESCE(cl.property_auction, t.property_auction),
        poa = COALESCE(cl.poa, t.poa),
        retirement_living = COALESCE(cl.retirement_living, t.retirement_living),
        property24_ref1 = COALESCE(NULLIF(cl.property24_ref1, ''), NULLIF(t.property24_ref1, '')),
        private_property_ref1 = COALESCE(NULLIF(cl.private_property_ref1, ''), NULLIF(t.private_property_ref1, '')),
        kww_property_reference = COALESCE(NULLIF(cl.kww_property_reference, ''), NULLIF(t.kww_property_reference, '')),
        property24_sync_status = COALESCE(NULLIF(cl.property24_sync_status, ''), NULLIF(t.property24_sync_status, '')),
        private_property_sync_status = COALESCE(NULLIF(cl.private_property_sync_status, ''), NULLIF(t.private_property_sync_status, '')),
        entegral_sync_status = COALESCE(NULLIF(cl.entegral_sync_status, ''), NULLIF(t.entegral_sync_status, '')),
        kww_sync_status = COALESCE(NULLIF(cl.kww_sync_status, ''), NULLIF(t.kww_sync_status, '')),
        feed_to_property24 = COALESCE(cl.feed_to_property24, false) OR COALESCE(t.feed_to_property24, false),
        feed_to_private_property = COALESCE(cl.feed_to_private_property, false) OR COALESCE(t.feed_to_private_property, false),
        feed_to_entegral = COALESCE(cl.feed_to_entegral, false) OR COALESCE(t.feed_to_entegral, false),
        feed_to_kww = COALESCE(cl.feed_to_kww, false) OR COALESCE(t.feed_to_kww, false),
        signed_date = COALESCE(cl.signed_date, t.signed_date),
        on_market_since_date = COALESCE(cl.on_market_since_date, t.on_market_since_date),
        occupation_date = COALESCE(cl.occupation_date, t.occupation_date),
        rates_and_taxes = COALESCE(cl.rates_and_taxes, t.rates_and_taxes),
        monthly_levy = COALESCE(cl.monthly_levy, t.monthly_levy),
        erf_size = COALESCE(cl.erf_size, t.erf_size),
        floor_area = COALESCE(cl.floor_area, t.floor_area),
        listing_payload = COALESCE(cl.listing_payload, t.listing_payload),
        updated_at = now()
      FROM tmp_listing_details_updated t
      WHERE (
          (cl.source_listing_id = t.source_listing_id AND t.source_listing_id IS NOT NULL)
        OR (cl.listing_number = t.listing_number AND t.listing_number IS NOT NULL)
      )
        ${activeOnly ? "AND LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'" : ''}
    `);

    await client.query(`
      UPDATE migration.core_listings cl
      SET entegral_reference_id = COALESCE(NULLIF(cl.entegral_reference_id, ''), NULLIF(t.entegral_reference, ''))
      FROM tmp_listing_details_updated t
      WHERE (
          (cl.source_listing_id = t.source_listing_id AND t.source_listing_id IS NOT NULL)
        OR (cl.listing_number = t.listing_number AND t.listing_number IS NOT NULL)
      )
        ${activeOnly ? "AND LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'" : ''}
    `).catch(() => {
      // Column may not exist in this schema variant; ignore.
    });

    await client.query('COMMIT');

    console.log(`[merge-listings] CSV rows parsed: ${parsedRows}`);
    console.log(`[merge-listings] Listing rows staged: ${stagedRows}`);
    console.log(`[merge-listings] Listings merged: ${updateResult.rowCount}`);
    console.log(`[merge-listings] Active-only mode: ${activeOnly ? 'yes' : 'no'}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[merge-listings] FATAL:', error.message);
  process.exit(1);
});
