import { closePool, runInTransaction } from './db.js';
const preserveExistingCoreData = (process.env.PRESERVE_CORE_EDITS ?? '').trim().toLowerCase() === 'true';
async function main() {
    await runInTransaction(async (client) => {
        const { rows } = await client.query(`SELECT source_market_center_id, name, status_name, frontdoor_id, company_registered_name, address_source_id, logo_document_id, contact_number, contact_email, kw_office_id
       FROM migration.market_centers_prepared`);
        for (const row of rows) {
            if (!row.name || row.name.trim().length === 0) {
                await client.query(`INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('market_center', $1, 'Missing market center name', $2::jsonb)`, [row.source_market_center_id, JSON.stringify(row)]);
                continue;
            }
            let upsert = await client.query(`
        INSERT INTO migration.core_market_centers (
          source_market_center_id,
          name,
          status_name,
          frontdoor_id,
          company_registered_name,
          address_source_id,
          logo_document_id,
          contact_number,
          contact_email,
          kw_office_id,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (source_market_center_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          name = EXCLUDED.name,\n          status_name = COALESCE(EXCLUDED.status_name, migration.core_market_centers.status_name),\n          frontdoor_id = COALESCE(EXCLUDED.frontdoor_id, migration.core_market_centers.frontdoor_id),\n          company_registered_name = COALESCE(EXCLUDED.company_registered_name, migration.core_market_centers.company_registered_name),\n          address_source_id = COALESCE(EXCLUDED.address_source_id, migration.core_market_centers.address_source_id),\n          logo_document_id = COALESCE(EXCLUDED.logo_document_id, migration.core_market_centers.logo_document_id),\n          contact_number = COALESCE(EXCLUDED.contact_number, migration.core_market_centers.contact_number),\n          contact_email = COALESCE(EXCLUDED.contact_email, migration.core_market_centers.contact_email),\n          kw_office_id = COALESCE(EXCLUDED.kw_office_id, migration.core_market_centers.kw_office_id),\n          updated_at = NOW()'}
        RETURNING id::text
        `, [
                row.source_market_center_id,
                row.name.trim(),
                row.status_name,
                row.frontdoor_id,
                row.company_registered_name,
                row.address_source_id,
                row.logo_document_id,
                row.contact_number,
                row.contact_email,
                row.kw_office_id,
            ]);
            if (upsert.rowCount === 0) {
                upsert = await client.query(`SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [row.source_market_center_id]);
            }
            await client.query(`
        INSERT INTO migration.id_map_market_centers (source_market_center_id, core_market_center_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_market_center_id)
        DO UPDATE SET core_market_center_id = EXCLUDED.core_market_center_id, mapped_at = NOW()
        `, [row.source_market_center_id, Number(upsert.rows[0].id)]);
        }
        await client.query(`
      UPDATE migration.core_market_centers AS core
      SET
        name = prepared.name,
        status_name = COALESCE(prepared.status_name, core.status_name),
        frontdoor_id = COALESCE(prepared.frontdoor_id, core.frontdoor_id),
        company_registered_name = COALESCE(prepared.company_registered_name, core.company_registered_name),
        address_source_id = COALESCE(prepared.address_source_id, core.address_source_id),
        logo_document_id = COALESCE(prepared.logo_document_id, core.logo_document_id),
        contact_number = COALESCE(prepared.contact_number, core.contact_number),
        contact_email = COALESCE(prepared.contact_email, core.contact_email),
        kw_office_id = COALESCE(prepared.kw_office_id, core.kw_office_id),
        updated_at = NOW()
      FROM migration.market_centers_prepared AS prepared
      WHERE prepared.source_market_center_id = core.source_market_center_id
    `);
    });
    console.log('Market centers loaded into migration.core_market_centers.');
}
main()
    .catch((error) => {
    console.error('Failed to load market centers:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=loadMarketCenters.js.map