import { closePool, runInTransaction } from './db.js';
async function main() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.listings_prepared (
        source_listing_id,
        listing_number,
        status_name,
        market_center_name,
        sale_or_rent,
        address_line,
        suburb,
        city,
        province,
        country,
        price,
        expiry_date,
        property_title,
        short_title,
        property_description,
        listing_images_json,
        listing_payload,
        last_seen_at,
        prepared_at
      )
      SELECT DISTINCT ON (source_listing_id)
        source_listing_id,
        listing_number,
        status_name,
        market_center_name,
        sale_or_rent,
        CONCAT_WS(' ', street_number, street_name) AS address_line,
        suburb,
        city,
        province,
        country,
        price,
        expiry_date,
        COALESCE(
          property_title,
          NULLIF(TRIM(COALESCE(raw_payload->>'PropertyTitle', raw_payload->>'property_title', raw_payload->>'PropertyTitleP24Header', raw_payload->>'title', '')), '')
        ) AS property_title,
        COALESCE(
          short_title,
          NULLIF(TRIM(COALESCE(raw_payload->>'ShortTitle', raw_payload->>'short_title', '')), '')
        ) AS short_title,
        COALESCE(
          property_description,
          NULLIF(TRIM(COALESCE(raw_payload->>'PropertyDescription', raw_payload->>'property_description', raw_payload->>'description', '')), '')
        ) AS property_description,
        COALESCE(
          listing_images_json,
          to_jsonb(
            array_remove(
              regexp_split_to_array(
                regexp_replace(COALESCE(raw_payload->>'ListingImages', raw_payload->>'listing_images', ''), '[\[\]"]', '', 'g'),
                '\\s*[|;,]\\s*'
              ),
              ''
            )
          )
        ) AS listing_images_json,
        raw_payload AS listing_payload,
        COALESCE(source_updated_at, loaded_at) AS last_seen_at,
        NOW() AS prepared_at
      FROM staging.listings_raw
      ORDER BY source_listing_id, COALESCE(source_updated_at, loaded_at) DESC, loaded_at DESC
      ON CONFLICT (source_listing_id)
      DO UPDATE SET
        listing_number = EXCLUDED.listing_number,
        status_name = EXCLUDED.status_name,
        market_center_name = EXCLUDED.market_center_name,
        sale_or_rent = EXCLUDED.sale_or_rent,
        address_line = EXCLUDED.address_line,
        suburb = EXCLUDED.suburb,
        city = EXCLUDED.city,
        province = EXCLUDED.province,
        country = EXCLUDED.country,
        price = EXCLUDED.price,
        expiry_date = EXCLUDED.expiry_date,
        property_title = EXCLUDED.property_title,
        short_title = EXCLUDED.short_title,
        property_description = EXCLUDED.property_description,
        listing_images_json = EXCLUDED.listing_images_json,
        listing_payload = EXCLUDED.listing_payload,
        last_seen_at = EXCLUDED.last_seen_at,
        prepared_at = NOW();
    `);
    });
    console.log('Listings transformed into migration.listings_prepared.');
}
main()
    .catch((error) => {
    console.error('Failed to transform listings:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=transformListings.js.map