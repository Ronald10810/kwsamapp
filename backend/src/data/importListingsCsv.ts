import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { closePool, withClient } from './db.js';
import { optionalArg } from './args.js';
import { getValue, toNumeric } from './csv.js';

function parseImageUrls(raw: string | null): string[] {
  if (!raw) return [];

  const normalized = raw
    .replace(/[\[\]"]/g, ' ')
    .replace(/\r?\n/g, '|')
    .trim();

  if (!normalized) return [];

  const parts = normalized
    .split(/\s*[|;,]\s*/)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  for (const part of parts) {
    if (/^https?:\/\//i.test(part)) {
      unique.add(part);
    }
  }

  return [...unique];
}

function buildBatchId(): string {
  return `listings_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
}

async function main(): Promise<void> {
  const filePath = optionalArg('--file', 'data/incoming/listings.csv');
  const batchId = optionalArg('--batch', buildBatchId());
  const commitBatchSize = Number(optionalArg('--commit-batch', '2000'));
  const onlyStatus = optionalArg('--only-status', '').trim().toLowerCase();
  const maxRows = Number(optionalArg('--max-rows', '0'));
  let importedCount = 0;
  let pendingInTransaction = 0;

  // Source CSV is Latin-1/Windows-1252 — must specify encoding here so that
  // accented characters (é, â, ä, ² etc.) are decoded correctly.
  const parser = createReadStream(filePath, { encoding: 'latin1' }).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
  );

  await withClient(async (client) => {
    await client.query('BEGIN');

    try {
      for await (const row of parser) {
        const sourceListingId = getValue(row, ['listing_id', 'id', 'ListingId']);
        if (!sourceListingId) {
          continue;
        }

        const listingNumber = getValue(row, ['listing_number', 'listingNo', 'ListingNumber']);
        const statusName = getValue(row, ['status', 'status_name', 'Status', 'ListingStatus', 'listing_status']);
        const marketCenterName = getValue(row, ['market_center', 'market_center_name', 'MarketCenter', 'ListingMarketCenter']);
        const saleOrRent = getValue(row, ['sale_or_rent', 'saleOrRent', 'SaleOrRent', 'SaleType', 'ListingStatusTag']);
        const streetNumber = getValue(row, ['street_number', 'streetNo', 'StreetNumber']);
        const streetName = getValue(row, ['street_name', 'StreetName']);
        const suburb = getValue(row, ['suburb', 'Suburb']);
        const city = getValue(row, ['city', 'City']);
        const province = getValue(row, ['province', 'Province']);
        const country = getValue(row, ['country', 'Country']);
        const price = toNumeric(getValue(row, ['price', 'Price', 'ListPrice', 'AskingPrice']));
        const expiryDate = getValue(row, ['expiry_date', 'ExpiryDate', 'ExpirationDate']);
        const sourceUpdatedAt = getValue(row, ['updated_at', 'source_updated_at', 'UpdatedAt', 'ListDate', 'ListDateUtc']);
        const propertyTitle = getValue(row, ['property_title', 'PropertyTitle', 'PropertyTitleP24Header', 'title', 'Title']);
        const shortTitle = getValue(row, ['short_title', 'ShortTitle']);
        const propertyDescription = getValue(row, ['property_description', 'PropertyDescription', 'description', 'Description']);
        const listingImagesRaw = getValue(row, ['listing_images', 'ListingImages', 'images', 'Images', 'ImageURLs', 'ImageUrls']);
        const listingImages = parseImageUrls(listingImagesRaw);

        if (onlyStatus.length > 0) {
          const normalizedStatus = (statusName ?? '').trim().toLowerCase();
          if (normalizedStatus !== onlyStatus) {
            continue;
          }
        }

        await client.query(
          `
          INSERT INTO staging.listings_raw (
            batch_id,
            source_listing_id,
            listing_number,
            status_name,
            market_center_name,
            sale_or_rent,
            street_number,
            street_name,
            suburb,
            city,
            province,
            country,
            price,
            expiry_date,
            source_updated_at,
            property_title,
            short_title,
            property_description,
            listing_images_json,
            raw_payload
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            $14::date,
            $15::timestamptz,
            $16,
            $17,
            $18,
            $19::jsonb,
            $20::jsonb
          )
        `,
          [
            batchId,
            sourceListingId,
            listingNumber,
            statusName,
            marketCenterName,
            saleOrRent,
            streetNumber,
            streetName,
            suburb,
            city,
            province,
            country,
            price,
            expiryDate,
            sourceUpdatedAt,
            propertyTitle,
            shortTitle,
            propertyDescription,
            JSON.stringify(listingImages),
            JSON.stringify(row),
          ]
        );

        importedCount += 1;
        pendingInTransaction += 1;

        if (pendingInTransaction >= commitBatchSize) {
          await client.query('COMMIT');
          console.log(`Imported ${importedCount.toLocaleString()} listings so far...`);
          await client.query('BEGIN');
          pendingInTransaction = 0;
        }

        if (maxRows > 0 && importedCount >= maxRows) {
          break;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (importedCount === 0) {
    throw new Error(`No rows found in ${filePath}`);
  }

  console.log(`Imported ${importedCount} rows into staging.listings_raw (batch: ${batchId}).`);
}

main()
  .catch((error) => {
    console.error('Failed to import listings CSV:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
