/**
 * Backfill building info columns in core_listings from Listings.csv
 * Only updates rows where the column is currently NULL
 * Run: node --require dotenv/config src/data/backfillBuildingInfo.ts
 * (or compile first)
 */
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { closePool, runInTransaction } from './db.js';
import { getValue, toNumeric } from './csv.js';

interface BuildingRow {
  source_listing_id: string;
  erf_size: number | null;
  floor_area: number | null;
}

async function main(): Promise<void> {
  const filePath = 'data/incoming/listings.csv';

  const rows: BuildingRow[] = [];

  const parser = createReadStream(filePath, { encoding: 'latin1' }).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
  );

  for await (const row of parser) {
    const sourceListingId = getValue(row, ['listing_id', 'id', 'ListingId']);
    if (!sourceListingId) continue;

    const erfSize = toNumeric(getValue(row, ['ErfSize', 'erf_size', 'erfSize']));
    const floorArea = toNumeric(getValue(row, ['FloorArea', 'floor_area', 'floorArea']));

    if (erfSize !== null || floorArea !== null) {
      rows.push({ source_listing_id: sourceListingId, erf_size: erfSize, floor_area: floorArea });
    }
  }

  // Deduplicate by source_listing_id (keep last non-null)
  const deduped = new Map<string, BuildingRow>();
  for (const r of rows) {
    const existing = deduped.get(r.source_listing_id);
    if (!existing) {
      deduped.set(r.source_listing_id, r);
    } else {
      deduped.set(r.source_listing_id, {
        source_listing_id: r.source_listing_id,
        erf_size: r.erf_size ?? existing.erf_size,
        floor_area: r.floor_area ?? existing.floor_area,
      });
    }
  }
  const uniqueRows = [...deduped.values()];

  console.log(`Found ${rows.length} CSV rows → ${uniqueRows.length} unique listings with building info to backfill.`);

  let updated = 0;
  // Use a temp table + JOIN UPDATE for performance instead of individual queries
  await runInTransaction(async (client) => {
    // Create temp table
    await client.query(`
      CREATE TEMP TABLE _building_backfill (
        source_listing_id text PRIMARY KEY,
        erf_size numeric,
        floor_area numeric
      ) ON COMMIT DROP
    `);

    // Bulk insert in chunks of 5000
    const CHUNK = 5000;
    for (let i = 0; i < uniqueRows.length; i += CHUNK) {
      const chunk = uniqueRows.slice(i, i + CHUNK);
      const values = chunk
        .map((_r, j) => `($${j * 3 + 1}, $${j * 3 + 2}::numeric, $${j * 3 + 3}::numeric)`)
        .join(', ');
      const params = chunk.flatMap((r) => [r.source_listing_id, r.erf_size, r.floor_area]);
      await client.query(
        `INSERT INTO _building_backfill (source_listing_id, erf_size, floor_area) VALUES ${values}`,
        params
      );
    }

    // Single bulk UPDATE join
    const res = await client.query(`
      UPDATE migration.core_listings cl
      SET
        erf_size = COALESCE(cl.erf_size, b.erf_size),
        floor_area = COALESCE(cl.floor_area, b.floor_area),
        updated_at = NOW()
      FROM _building_backfill b
      WHERE cl.source_listing_id = b.source_listing_id
        AND (b.erf_size IS NOT NULL OR b.floor_area IS NOT NULL)
    `);
    updated = res.rowCount ?? 0;
  });

  console.log(`Updated ${updated} listings with building info.`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
