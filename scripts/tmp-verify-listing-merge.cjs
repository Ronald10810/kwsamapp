const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const { Client } = req('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sample = await client.query("select listing_number, source_listing_id, feed_to_private_property, private_property_ref1, private_property_sync_status, feed_to_kww, kww_property_reference, kww_sync_status, feed_to_entegral, entegral_sync_status, feed_to_property24, property24_ref1, property24_sync_status, property_title, short_title, sale_or_rent, status_name from migration.core_listings where listing_number in ('KWL316691','KWL3166466','KWL3166475') order by listing_number");
  const totals = await client.query("select count(*) filter (where feed_to_property24 = true) as p24_feed_true, count(*) filter (where coalesce(nullif(property24_ref1,''),'') <> '') as p24_ref_count, count(*) filter (where feed_to_private_property = true) as pp_feed_true, count(*) filter (where coalesce(nullif(private_property_ref1,''),'') <> '') as pp_ref_count, count(*) filter (where feed_to_kww = true) as kww_feed_true, count(*) filter (where coalesce(nullif(kww_property_reference,''),'') <> '') as kww_ref_count, count(*) filter (where feed_to_entegral = true) as entegral_feed_true, count(*) filter (where coalesce(nullif(entegral_sync_status,''),'') <> '') as entegral_status_count from migration.core_listings");
  console.log('SAMPLE');
  console.log(JSON.stringify(sample.rows, null, 2));
  console.log('TOTALS');
  console.log(JSON.stringify(totals.rows[0], null, 2));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
