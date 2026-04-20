import { closePool, runInTransaction, withClient } from './db.js';
import { getArgValue } from './args.js';

type CoreMarketCenter = {
  source_market_center_id: string;
  name: string;
};

type CoreAssociate = {
  source_associate_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  source_market_center_id: string | null;
};

type CoreListing = {
  source_listing_id: string;
  listing_number: string | null;
  status_name: string | null;
  sale_or_rent: string | null;
  address_line: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  price: string | null;
  source_market_center_id: string | null;
};

function hasDryRunFlag(): boolean {
  return process.argv.includes('--dry-run');
}

function legacyMarketCenterId(sourceId: string): string {
  return `MC-${sourceId}`;
}

function legacyAssociateId(sourceId: string): string {
  return `AS-${sourceId}`;
}

function legacyListingId(sourceId: string): string {
  return `LI-${sourceId}`;
}

function associateName(row: CoreAssociate): string {
  if (row.full_name && row.full_name.trim().length > 0) {
    return row.full_name.trim();
  }

  return [row.first_name ?? '', row.last_name ?? ''].join(' ').trim() || `Associate ${row.source_associate_id}`;
}

function listingTitle(row: CoreListing): string {
  if (row.listing_number && row.listing_number.trim().length > 0) {
    return row.listing_number.trim();
  }

  const area = [row.suburb ?? '', row.city ?? ''].join(' ').trim();
  if (area.length > 0) {
    return `Listing ${area}`;
  }

  return `Listing ${row.source_listing_id}`;
}

function listingDescription(row: CoreListing): string {
  const parts = [
    row.status_name ? `Status: ${row.status_name}` : null,
    row.sale_or_rent ? `Type: ${row.sale_or_rent}` : null,
    row.address_line ? `Address: ${row.address_line}` : null,
    row.suburb,
    row.city,
    row.province,
    row.country,
  ].filter((item) => item && item.trim().length > 0) as string[];

  return parts.join(' | ');
}

function sourceFilter(tableName: string, sourceColumn: string, batchPrefix?: string): { clause: string; params: unknown[] } {
  if (!batchPrefix) {
    return { clause: '', params: [] };
  }

  return {
    clause: `WHERE ${sourceColumn} IN (SELECT DISTINCT ${sourceColumn} FROM staging.${tableName} WHERE batch_id LIKE $1 || '%')`,
    params: [batchPrefix],
  };
}

async function reportCurrentLegacyCounts(): Promise<void> {
  await withClient(async (client) => {
    const marketCenterCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "MarketCentre"');
    const associateCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "Associate"');
    const listingCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "Listing"');

    console.log('Legacy table counts before publish:');
    console.log(`  MarketCentre: ${marketCenterCount.rows[0].value}`);
    console.log(`  Associate   : ${associateCount.rows[0].value}`);
    console.log(`  Listing     : ${listingCount.rows[0].value}`);
  });
}

async function selectCoreRows(batchPrefix?: string): Promise<{
  marketCenters: CoreMarketCenter[];
  associates: CoreAssociate[];
  listings: CoreListing[];
}> {
  return withClient(async (client) => {
    const mcFilter = sourceFilter('market_centers_raw', 'source_market_center_id', batchPrefix);
    const asFilter = sourceFilter('associates_raw', 'source_associate_id', batchPrefix);
    const liFilter = sourceFilter('listings_raw', 'source_listing_id', batchPrefix);

    const marketCenters = await client.query<CoreMarketCenter>(
      `SELECT source_market_center_id, name FROM migration.core_market_centers ${mcFilter.clause} ORDER BY source_market_center_id`,
      mcFilter.params
    );

    const associates = await client.query<CoreAssociate>(
      `SELECT source_associate_id, first_name, last_name, full_name, email, source_market_center_id
       FROM migration.core_associates
       ${asFilter.clause}
       ORDER BY source_associate_id`,
      asFilter.params
    );

    const listings = await client.query<CoreListing>(
      `SELECT source_listing_id, listing_number, status_name, sale_or_rent, address_line,
              suburb, city, province, country, price::text, source_market_center_id
       FROM migration.core_listings
       ${liFilter.clause}
       ORDER BY source_listing_id`,
      liFilter.params
    );

    return {
      marketCenters: marketCenters.rows,
      associates: associates.rows,
      listings: listings.rows,
    };
  });
}

async function dryRunReport(batchPrefix?: string): Promise<void> {
  const { marketCenters, associates, listings } = await selectCoreRows(batchPrefix);

  console.log('Dry run publish summary (no writes performed):');
  if (batchPrefix) {
    console.log(`  Batch prefix filter: ${batchPrefix}`);
  }
  console.log(`  Market centres to publish: ${marketCenters.length}`);
  console.log(`  Associates to publish    : ${associates.length}`);
  console.log(`  Listings to publish      : ${listings.length}`);

  const missingAssociateMc = associates.filter((row) => !row.source_market_center_id).length;
  const missingListingMc = listings.filter((row) => !row.source_market_center_id).length;

  console.log(`  Associates missing source market center: ${missingAssociateMc}`);
  console.log(`  Listings missing source market center  : ${missingListingMc}`);

  const sampleMc = marketCenters.slice(0, 3).map((row) => `${legacyMarketCenterId(row.source_market_center_id)} <= ${row.source_market_center_id}`);
  const sampleAs = associates.slice(0, 3).map((row) => `${legacyAssociateId(row.source_associate_id)} <= ${row.source_associate_id}`);
  const sampleLi = listings.slice(0, 3).map((row) => `${legacyListingId(row.source_listing_id)} <= ${row.source_listing_id}`);

  if (sampleMc.length > 0) {
    console.log('  Sample market center IDs:');
    sampleMc.forEach((item) => console.log(`    - ${item}`));
  }
  if (sampleAs.length > 0) {
    console.log('  Sample associate IDs:');
    sampleAs.forEach((item) => console.log(`    - ${item}`));
  }
  if (sampleLi.length > 0) {
    console.log('  Sample listing IDs:');
    sampleLi.forEach((item) => console.log(`    - ${item}`));
  }
}

async function publish(batchPrefix?: string): Promise<void> {
  const { marketCenters, associates, listings } = await selectCoreRows(batchPrefix);

  await runInTransaction(async (client) => {
    for (const row of marketCenters) {
      const legacyId = legacyMarketCenterId(row.source_market_center_id);

      await client.query(
        `
        INSERT INTO "MarketCentre" (id, name, address, "updatedAt")
        VALUES ($1, $2, NULL, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          "updatedAt" = NOW()
        `,
        [legacyId, row.name]
      );

      await client.query(
        `
        INSERT INTO migration.id_map_legacy_market_centers (source_market_center_id, legacy_market_center_id, published_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_market_center_id)
        DO UPDATE SET legacy_market_center_id = EXCLUDED.legacy_market_center_id, published_at = NOW()
        `,
        [row.source_market_center_id, legacyId]
      );
    }

    for (const row of associates) {
      if (!row.source_market_center_id) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('publish_associate', $1, 'Missing source market center id for legacy publish', $2::jsonb)`,
          [row.source_associate_id, JSON.stringify(row)]
        );
        continue;
      }

      const legacyMc = legacyMarketCenterId(row.source_market_center_id);
      const legacyAs = legacyAssociateId(row.source_associate_id);

      await client.query(
        `
        INSERT INTO "Associate" (id, name, email, "marketCentreId", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          "marketCentreId" = EXCLUDED."marketCentreId",
          "updatedAt" = NOW()
        `,
        [legacyAs, associateName(row), row.email ?? `${legacyAs}@local.invalid`, legacyMc]
      );

      await client.query(
        `
        INSERT INTO migration.id_map_legacy_associates (source_associate_id, legacy_associate_id, published_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_associate_id)
        DO UPDATE SET legacy_associate_id = EXCLUDED.legacy_associate_id, published_at = NOW()
        `,
        [row.source_associate_id, legacyAs]
      );
    }

    for (const row of listings) {
      if (!row.source_market_center_id) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('publish_listing', $1, 'Missing source market center id for legacy publish', $2::jsonb)`,
          [row.source_listing_id, JSON.stringify(row)]
        );
        continue;
      }

      const legacyMc = legacyMarketCenterId(row.source_market_center_id);
      const legacyLi = legacyListingId(row.source_listing_id);
      const price = row.price ? Number(row.price) : null;

      await client.query(
        `
        INSERT INTO "Listing" (id, title, description, price, "marketCentreId", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          "marketCentreId" = EXCLUDED."marketCentreId",
          "updatedAt" = NOW()
        `,
        [legacyLi, listingTitle(row), listingDescription(row), price, legacyMc]
      );

      await client.query(
        `
        INSERT INTO migration.id_map_legacy_listings (source_listing_id, legacy_listing_id, published_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_listing_id)
        DO UPDATE SET legacy_listing_id = EXCLUDED.legacy_listing_id, published_at = NOW()
        `,
        [row.source_listing_id, legacyLi]
      );
    }
  });

  console.log('Published migration.core_* data into legacy public tables (MarketCentre, Associate, Listing).');
}

async function main(): Promise<void> {
  const dryRun = hasDryRunFlag();
  const batchPrefix = getArgValue('--batch-prefix');

  await reportCurrentLegacyCounts();

  if (dryRun) {
    await dryRunReport(batchPrefix);
    console.log('Dry run completed. No legacy tables were modified.');
    return;
  }

  await publish(batchPrefix);

  await withClient(async (client) => {
    const marketCenterCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "MarketCentre"');
    const associateCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "Associate"');
    const listingCount = await client.query<{ value: string }>('SELECT COUNT(*)::text AS value FROM "Listing"');

    console.log('Legacy table counts after publish:');
    console.log(`  MarketCentre: ${marketCenterCount.rows[0].value}`);
    console.log(`  Associate   : ${associateCount.rows[0].value}`);
    console.log(`  Listing     : ${listingCount.rows[0].value}`);
  });
}

main()
  .catch((error) => {
    console.error('Failed to publish data into legacy tables:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
