const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const { Client } = req('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const result = await client.query(
    SELECT listing_number, source_listing_id, sale_or_rent, listing_status_tag,
           feed_to_private_property, private_property_ref1, private_property_ref2, private_property_sync_status,
           feed_to_kww, kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
           feed_to_entegral, entegral_sync_status,
           feed_to_property24, property24_ref1, property24_ref2, property24_sync_status,
           listing_payload
    FROM migration.core_listings
    WHERE listing_number IN ('KWL316691', 'KWL3166466', 'KWL3166475')
    ORDER BY listing_number
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
