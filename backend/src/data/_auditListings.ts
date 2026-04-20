import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    // ── 1. Core listing field population ─────────────────────────────────────
    const totals = await client.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(NULLIF(listing_images_json::text,'[]'))        AS has_images,
        COUNT(property_title)                                AS has_title,
        COUNT(property_description)                          AS has_description,
        COUNT(price)                                         AS has_price,
        COUNT(status_name)                                   AS has_status,
        COUNT(sale_or_rent)                                  AS has_sale_or_rent,
        COUNT(suburb)                                        AS has_suburb,
        COUNT(city)                                          AS has_city,
        COUNT(*) AS placeholder
      FROM migration.core_listings
    `);
    console.log('\n=== Core listing field population (1087 rows) ===');
    console.table(totals.rows);

    // ── 2. Image distribution ─────────────────────────────────────────────────
    const images = await client.query(`
      SELECT
        jsonb_array_length(listing_images_json) AS image_count,
        COUNT(*) AS listings
      FROM migration.core_listings
      WHERE listing_images_json IS NOT NULL
      GROUP BY 1
      ORDER BY image_count DESC
      LIMIT 15
    `);
    console.log('\n=== Image count distribution (top 15) ===');
    console.table(images.rows);

    // ── 3. Agent links ────────────────────────────────────────────────────────
    const agentLinks = await client.query(`
      SELECT
        COUNT(DISTINCT core_listing_id)  AS listings_with_agents,
        COUNT(*)                         AS total_agent_links
      FROM migration.core_listing_agents
    `).catch(() => ({ rows: [{ listings_with_agents: 'TABLE NOT FOUND', total_agent_links: 'N/A' }] }));
    console.log('\n=== Agent links on listings ===');
    console.table(agentLinks.rows);

    // ── 4. Primary contact / agent fields from payload ────────────────────────
    const agentPayload = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE listing_payload->>'AgentName' IS NOT NULL AND listing_payload->>'AgentName' <> '')       AS has_agent_name,
        COUNT(*) FILTER (WHERE listing_payload->>'AgentEmail' IS NOT NULL AND listing_payload->>'AgentEmail' <> '')     AS has_agent_email,
        COUNT(*) FILTER (WHERE listing_payload->>'AgentCellphone' IS NOT NULL AND listing_payload->>'AgentCellphone' <> '') AS has_agent_phone,
        COUNT(*) FILTER (WHERE listing_payload->>'AgentPhotoUrl' IS NOT NULL AND listing_payload->>'AgentPhotoUrl' <> '')  AS has_agent_photo,
        COUNT(*) FILTER (WHERE primary_contact_name IS NOT NULL)  AS has_primary_contact_name,
        COUNT(*) FILTER (WHERE primary_contact_email IS NOT NULL) AS has_primary_contact_email,
        COUNT(*) FILTER (WHERE primary_contact_phone IS NOT NULL) AS has_primary_contact_phone,
        COUNT(*) FILTER (WHERE primary_agent_image_url IS NOT NULL) AS has_primary_agent_image
      FROM migration.core_listings
    `).catch(() => ({ rows: [{ note: 'primary_contact columns may not exist yet in core_listings' }] }));
    console.log('\n=== Agent / contact field population ===');
    console.table(agentPayload.rows);

    // ── 5. Schema columns ──────────────────────────────────────────────────
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'migration' AND table_name = 'core_listings'
      ORDER BY ordinal_position
    `);
    console.log('\n=== core_listings schema columns ===');
    cols.rows.forEach((r: { column_name: string; data_type: string }) =>
      console.log(`  ${r.column_name.padEnd(45)} ${r.data_type}`)
    );

    // ── 6. Sample row ─────────────────────────────────────────────────────────
    const sample = await client.query(`
      SELECT
        listing_number,
        status_name,
        sale_or_rent,
        suburb,
        city,
        price::text,
        jsonb_array_length(listing_images_json) AS images,
        SUBSTRING(listing_payload::text, 1, 200) AS payload_preview
      FROM migration.core_listings
      WHERE listing_images_json IS NOT NULL AND jsonb_array_length(listing_images_json) > 0
      LIMIT 4
    `);
    console.log('\n=== Sample rows with images ===');
    console.table(sample.rows);

    // ── 7. Top payload keys ───────────────────────────────────────────────────
    const keys = await client.query(`
      SELECT key, COUNT(*)::int AS frequency
      FROM migration.core_listings, jsonb_object_keys(listing_payload) AS key
      GROUP BY key
      ORDER BY frequency DESC
      LIMIT 50
    `);
    console.log('\n=== Payload keys available (top 50 by frequency) ===');
    keys.rows.forEach((r: { key: string; frequency: number }) =>
      console.log(`  ${r.key.padEnd(40)} ${r.frequency}`)
    );

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
