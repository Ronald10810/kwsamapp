/**
 * repairEncoding.ts
 *
 * One-shot repair script that fixes Unicode replacement characters (U+FFFD)
 * that ended up in the database because the original Latin-1/Windows-1252 CSV
 * exports were previously read as UTF-8.
 *
 * Run from the backend directory:
 *   npm run data:repair:encoding -- \
 *     --associates  "C:\path\to\Associates.csv" \
 *     --listings    "C:\path\to\Listings.csv" \
 *     --transactions "C:\path\to\Transactions.csv"
 */

import { readFileSync, createReadStream } from 'node:fs';
import { parse as parseCsvSync, parse as parseCsvStream } from 'csv-parse';
import { closePool, withClient } from './db.js';
import { optionalArg } from './args.js';

const REPLACEMENT_CHAR = '\uFFFD';

function hasReplacement(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes(REPLACEMENT_CHAR);
}

// ---------------------------------------------------------------------------
// Associates
// ---------------------------------------------------------------------------
async function repairAssociates(csvPath: string): Promise<void> {
  console.log(`\n[associates] Reading ${csvPath} …`);

  const rawBuffer = readFileSync(csvPath);
  const content = rawBuffer.toString('latin1');

  const rows: Record<string, string>[] = await new Promise((resolve, reject) => {
    (parseCsvSync as Function)(
      content,
      { columns: true, skip_empty_lines: true, trim: true, bom: true },
      (err: Error | null, records: Record<string, string>[]) => {
        if (err) reject(err);
        else resolve(records);
      }
    );
  });

  console.log(`[associates] ${rows.length} rows in CSV`);

  let updated = 0;

  await withClient(async (client) => {
    for (const row of rows) {
      const sourceId = row['AssociateId'] || row['associate_id'] || row['id'];
      if (!sourceId) continue;

      const firstName = (row['FirstName'] || row['first_name'] || '').trim();
      const lastName  = (row['LastName']  || row['last_name']  || '').trim();
      const fullName  = (row['Fullname']  || row['full_name']  || `${firstName} ${lastName}`.trim());

      const existing = await client.query<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        full_name: string | null;
      }>(
        `SELECT id, first_name, last_name, full_name
         FROM migration.core_associates
         WHERE source_associate_id = $1`,
        [sourceId]
      );

      if (existing.rows.length === 0) continue;

      const rec = existing.rows[0];
      const needsUpdate =
        (firstName && hasReplacement(rec.first_name)) ||
        (lastName  && hasReplacement(rec.last_name))  ||
        (fullName  && hasReplacement(rec.full_name));

      if (!needsUpdate) continue;

      await client.query(
        `UPDATE migration.core_associates
         SET
           first_name = CASE WHEN first_name LIKE $2 THEN $3 ELSE first_name END,
           last_name  = CASE WHEN last_name  LIKE $4 THEN $5 ELSE last_name  END,
           full_name  = CASE WHEN full_name  LIKE $6 THEN $7 ELSE full_name  END,
           updated_at = NOW()
         WHERE id = $1`,
        [
          rec.id,
          `%${REPLACEMENT_CHAR}%`, firstName,
          `%${REPLACEMENT_CHAR}%`, lastName,
          `%${REPLACEMENT_CHAR}%`, fullName,
        ]
      );

      updated++;
    }
  });

  console.log(`[associates] Updated ${updated} records.`);
}

// ---------------------------------------------------------------------------
// Listings  (streamed — file is too large to load into memory at once)
// ---------------------------------------------------------------------------
async function repairListings(csvPath: string): Promise<void> {
  console.log(`\n[listings] Streaming ${csvPath} …`);

  let processed = 0;
  let updated   = 0;

  await withClient(async (client) => {
    await new Promise<void>((resolve, reject) => {
      const parser = createReadStream(csvPath, { encoding: 'latin1' }).pipe(
        parseCsvStream({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        })
      );

      parser.on('data', async (row: Record<string, string>) => {
        parser.pause();
        processed++;

        try {
          const sourceId = row['ListingId'] || row['listing_id'];
          if (!sourceId) { parser.resume(); return; }

          const title       = (row['PropertyTitle']       || '').trim();
          const description = (row['PropertyDescription'] || '').trim();
          const suburb      = (row['Suburb']              || '').trim();
          const city        = (row['City']                || '').trim();
          const estateName  = (row['EstateName']          || '').trim();
          const addressLine = (row['FullAddress']         || '').trim();

          const existing = await client.query<{
            id: string;
            property_title:       string | null;
            property_description: string | null;
            suburb:               string | null;
            city:                 string | null;
            estate_name:          string | null;
            address_line:         string | null;
          }>(
            `SELECT id, property_title, property_description, suburb, city, estate_name, address_line
             FROM migration.core_listings
             WHERE source_listing_id = $1`,
            [sourceId]
          );

          if (existing.rows.length === 0) { parser.resume(); return; }

          const rec = existing.rows[0];
          const needsUpdate =
            (title       && hasReplacement(rec.property_title))       ||
            (description && hasReplacement(rec.property_description)) ||
            (suburb      && hasReplacement(rec.suburb))               ||
            (city        && hasReplacement(rec.city))                 ||
            (estateName  && hasReplacement(rec.estate_name))          ||
            (addressLine && hasReplacement(rec.address_line));

          if (!needsUpdate) { parser.resume(); return; }

          await client.query(
            `UPDATE migration.core_listings
             SET
               property_title       = CASE WHEN property_title       LIKE $2 THEN $3  ELSE property_title       END,
               property_description = CASE WHEN property_description LIKE $4 THEN $5  ELSE property_description END,
               suburb               = CASE WHEN suburb               LIKE $6 THEN $7  ELSE suburb               END,
               city                 = CASE WHEN city                 LIKE $8 THEN $9  ELSE city                 END,
               estate_name          = CASE WHEN estate_name          LIKE $2 THEN $10 ELSE estate_name          END,
               address_line         = CASE WHEN address_line         LIKE $2 THEN $11 ELSE address_line         END,
               updated_at           = NOW()
             WHERE id = $1`,
            [
              rec.id,
              `%${REPLACEMENT_CHAR}%`, title,
              `%${REPLACEMENT_CHAR}%`, description,
              `%${REPLACEMENT_CHAR}%`, suburb,
              `%${REPLACEMENT_CHAR}%`, city,
              estateName,
              addressLine,
            ]
          );

          updated++;
          if (processed % 500 === 0) {
            console.log(`[listings] processed ${processed} …`);
          }
        } catch (err) {
          console.error('[listings] row error:', (err as Error).message);
        }

        parser.resume();
      });

      parser.on('error', reject);
      parser.on('end', resolve);
    });
  });

  console.log(`[listings] Processed ${processed} rows, updated ${updated} records.`);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
async function repairTransactions(csvPath: string): Promise<void> {
  console.log(`\n[transactions] Reading ${csvPath} …`);

  const rawBuffer = readFileSync(csvPath);
  const content = rawBuffer.toString('latin1');

  const rows: Record<string, string>[] = await new Promise((resolve, reject) => {
    (parseCsvSync as Function)(
      content,
      { columns: true, skip_empty_lines: true, trim: true, bom: true },
      (err: Error | null, records: Record<string, string>[]) => {
        if (err) reject(err);
        else resolve(records);
      }
    );
  });

  console.log(`[transactions] ${rows.length} rows in CSV`);

  // Discover what columns exist on core_transactions
  let updated = 0;

  await withClient(async (client) => {
    for (const row of rows) {
      const sourceId = row['TransactionId'] || row['transaction_id'];
      if (!sourceId) continue;

      const description = (row['Description'] || row['PropertyTitle'] || '').trim();
      if (!description) continue;

      const res = await client.query<{ id: string; description: string | null }>(
        `SELECT id, description
         FROM migration.core_transactions
         WHERE source_transaction_id = $1`,
        [sourceId]
      );

      if (res.rows.length === 0) continue;
      const rec = res.rows[0];
      if (!hasReplacement(rec.description)) continue;

      await client.query(
        `UPDATE migration.core_transactions SET description = $2, updated_at = NOW() WHERE id = $1`,
        [rec.id, description]
      );
      updated++;
    }
  });

  console.log(`[transactions] Updated ${updated} records.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const associatesPath   = optionalArg('--associates',   '');
  const listingsPath     = optionalArg('--listings',     '');
  const transactionsPath = optionalArg('--transactions', '');

  if (![associatesPath, listingsPath, transactionsPath].some(Boolean)) {
    console.log(`
Usage: npm run data:repair:encoding -- [flags]

  --associates    <path>   Path to Associates.csv
  --listings      <path>   Path to Listings.csv
  --transactions  <path>   Path to Transactions.csv

At least one flag is required.
`);
    process.exit(1);
  }

  if (associatesPath)   await repairAssociates(associatesPath);
  if (listingsPath)     await repairListings(listingsPath);
  if (transactionsPath) await repairTransactions(transactionsPath);

  console.log('\n[repair] Done.');
  await closePool();
}

main().catch((err) => {
  console.error('[repair] Fatal error:', err);
  process.exit(1);
});
