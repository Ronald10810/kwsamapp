import { closePool, runInTransaction } from './db.js';
const preserveExistingCoreData = (process.env.PRESERVE_CORE_EDITS ?? '').trim().toLowerCase() === 'true';
async function clearRejections() {
    await runInTransaction(async (client) => {
        await client.query('DELETE FROM migration.load_rejections');
    });
}
async function loadMarketCenters() {
    await runInTransaction(async (client) => {
        const { rows } = await client.query(`SELECT source_market_center_id, name, status_name, frontdoor_id, company_registered_name, address_source_id, logo_document_id, contact_number, contact_email, kw_office_id FROM migration.market_centers_prepared`);
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
        RETURNING id
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
}
async function loadTeams() {
    await runInTransaction(async (client) => {
        const { rows } = await client.query(`SELECT source_team_id, source_market_center_id, name, status_name FROM migration.teams_prepared`);
        for (const row of rows) {
            if (!row.name || row.name.trim().length === 0) {
                await client.query(`INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('team', $1, 'Missing team name', $2::jsonb)`, [row.source_team_id, JSON.stringify(row)]);
                continue;
            }
            const marketCenterLookup = row.source_market_center_id
                ? await client.query(`SELECT core_market_center_id FROM migration.id_map_market_centers WHERE source_market_center_id = $1`, [row.source_market_center_id])
                : { rows: [] };
            const marketCenterId = marketCenterLookup.rows[0]?.core_market_center_id
                ? Number(marketCenterLookup.rows[0].core_market_center_id)
                : null;
            if (row.source_market_center_id && !marketCenterId) {
                await client.query(`INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('team', $1, 'Referenced market center not loaded', $2::jsonb)`, [row.source_team_id, JSON.stringify(row)]);
                continue;
            }
            let upsert = await client.query(`
        INSERT INTO migration.core_teams (
          source_team_id,
          source_market_center_id,
          market_center_id,
          name,
          status_name,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (source_team_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          source_market_center_id = EXCLUDED.source_market_center_id,\n          market_center_id = EXCLUDED.market_center_id,\n          name = EXCLUDED.name,\n          status_name = EXCLUDED.status_name,\n          updated_at = NOW()'}
        RETURNING id
        `, [row.source_team_id, row.source_market_center_id, marketCenterId, row.name.trim(), row.status_name]);
            if (upsert.rowCount === 0) {
                upsert = await client.query(`SELECT id::text AS id FROM migration.core_teams WHERE source_team_id = $1 LIMIT 1`, [row.source_team_id]);
            }
            await client.query(`
        INSERT INTO migration.id_map_teams (source_team_id, core_team_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_team_id)
        DO UPDATE SET core_team_id = EXCLUDED.core_team_id, mapped_at = NOW()
        `, [row.source_team_id, Number(upsert.rows[0].id)]);
        }
    });
}
async function loadAssociates() {
    await runInTransaction(async (client) => {
        const { rows } = await client.query(`SELECT source_associate_id, first_name, last_name, full_name, email, status_name, market_center_name, team_name, kwuid, image_url, mobile_number
       FROM migration.associates_prepared`);
        for (const row of rows) {
            const marketCenterLookup = row.market_center_name
                ? await client.query(`SELECT id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`, [row.market_center_name])
                : { rows: [] };
            const teamLookup = row.team_name
                ? await client.query(`SELECT id, source_team_id FROM migration.core_teams WHERE name = $1 LIMIT 1`, [row.team_name])
                : { rows: [] };
            const marketCenterId = marketCenterLookup.rows[0]?.id ? Number(marketCenterLookup.rows[0].id) : null;
            const sourceMarketCenterId = marketCenterLookup.rows[0]?.source_market_center_id ?? null;
            const teamId = teamLookup.rows[0]?.id ? Number(teamLookup.rows[0].id) : null;
            const sourceTeamId = teamLookup.rows[0]?.source_team_id ?? null;
            if (!marketCenterId && row.market_center_name) {
                await client.query(`INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('associate', $1, 'Market center not mapped; associate loaded without center link', $2::jsonb)`, [row.source_associate_id, JSON.stringify(row)]);
            }
            let upsert = await client.query(`
        INSERT INTO migration.core_associates (
          source_associate_id,
          source_market_center_id,
          source_team_id,
          market_center_id,
          team_id,
          first_name,
          last_name,
          full_name,
          email,
          status_name,
          kwuid,
          image_url,
          mobile_number,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (source_associate_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          source_market_center_id = EXCLUDED.source_market_center_id,\n          source_team_id = EXCLUDED.source_team_id,\n          market_center_id = EXCLUDED.market_center_id,\n          team_id = EXCLUDED.team_id,\n          first_name = EXCLUDED.first_name,\n          last_name = EXCLUDED.last_name,\n          full_name = EXCLUDED.full_name,\n          email = EXCLUDED.email,\n          status_name = EXCLUDED.status_name,\n          kwuid = EXCLUDED.kwuid,\n          image_url = EXCLUDED.image_url,\n          mobile_number = EXCLUDED.mobile_number,\n          updated_at = NOW()'}
        RETURNING id
        `, [
                row.source_associate_id,
                sourceMarketCenterId,
                sourceTeamId,
                marketCenterId,
                teamId,
                row.first_name,
                row.last_name,
                row.full_name,
                row.email,
                row.status_name,
                row.kwuid,
                row.image_url,
                row.mobile_number,
            ]);
            if (upsert.rowCount === 0) {
                upsert = await client.query(`SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`, [row.source_associate_id]);
            }
            await client.query(`
        INSERT INTO migration.id_map_associates (source_associate_id, core_associate_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_associate_id)
        DO UPDATE SET core_associate_id = EXCLUDED.core_associate_id, mapped_at = NOW()
        `, [row.source_associate_id, Number(upsert.rows[0].id)]);
        }
    });
}
async function loadListings() {
    await runInTransaction(async (client) => {
        const { rows } = await client.query(`SELECT source_listing_id, listing_number, status_name, market_center_name, sale_or_rent,
              address_line, suburb, city, province, country, price::text, expiry_date::text,
              property_title, short_title, property_description, listing_images_json, listing_payload
       FROM migration.listings_prepared`);
        for (const row of rows) {
            const marketCenterLookup = row.market_center_name
                ? await client.query(`SELECT id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`, [row.market_center_name])
                : { rows: [] };
            const marketCenterId = marketCenterLookup.rows[0]?.id ? Number(marketCenterLookup.rows[0].id) : null;
            const sourceMarketCenterId = marketCenterLookup.rows[0]?.source_market_center_id ?? null;
            if (!marketCenterId && row.market_center_name) {
                await client.query(`INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('listing', $1, 'Referenced market center name not loaded', $2::jsonb)`, [row.source_listing_id, JSON.stringify(row)]);
                continue;
            }
            let upsert = await client.query(`
        INSERT INTO migration.core_listings (
          source_listing_id,
          source_market_center_id,
          market_center_id,
          listing_number,
          status_name,
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
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13::date,$14,$15,$16,$17::jsonb,$18::jsonb,NOW())
        ON CONFLICT (source_listing_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          source_market_center_id = EXCLUDED.source_market_center_id,\n          market_center_id = EXCLUDED.market_center_id,\n          listing_number = EXCLUDED.listing_number,\n          status_name = EXCLUDED.status_name,\n          sale_or_rent = EXCLUDED.sale_or_rent,\n          address_line = EXCLUDED.address_line,\n          suburb = EXCLUDED.suburb,\n          city = EXCLUDED.city,\n          province = EXCLUDED.province,\n          country = EXCLUDED.country,\n          price = EXCLUDED.price,\n          expiry_date = EXCLUDED.expiry_date,\n          property_title = EXCLUDED.property_title,\n          short_title = EXCLUDED.short_title,\n          property_description = EXCLUDED.property_description,\n          listing_images_json = EXCLUDED.listing_images_json,\n          listing_payload = EXCLUDED.listing_payload,\n          updated_at = NOW()'}
        RETURNING id
        `, [
                row.source_listing_id,
                sourceMarketCenterId,
                marketCenterId,
                row.listing_number,
                row.status_name,
                row.sale_or_rent,
                row.address_line,
                row.suburb,
                row.city,
                row.province,
                row.country,
                row.price,
                row.expiry_date,
                row.property_title,
                row.short_title,
                row.property_description,
                JSON.stringify(row.listing_images_json ?? []),
                JSON.stringify(row.listing_payload ?? {}),
            ]);
            if (upsert.rowCount === 0) {
                upsert = await client.query(`SELECT id::text AS id FROM migration.core_listings WHERE source_listing_id = $1 LIMIT 1`, [row.source_listing_id]);
            }
            await client.query(`
        INSERT INTO migration.id_map_listings (source_listing_id, core_listing_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_listing_id)
        DO UPDATE SET core_listing_id = EXCLUDED.core_listing_id, mapped_at = NOW()
        `, [row.source_listing_id, Number(upsert.rows[0].id)]);
        }
    });
}
async function loadTransactions() {
    await runInTransaction(async (client) => {
        await client.query(`
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        source_associate_id,
        associate_id,
        market_center_id,
        transaction_number,
        transaction_status,
        transaction_type,
        source_listing_id,
        listing_number,
        address,
        suburb,
        city,
        sales_price,
        list_price,
        gci_excl_vat,
        split_percentage,
        net_comm,
        total_gci,
        sale_type,
        agent_type,
        buyer,
        seller,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        updated_at
      )
      SELECT
        tp.source_transaction_id,
        COALESCE(tp.source_associate_id, ''),
        ia.core_associate_id::bigint,
        imc.core_market_center_id::bigint,
        tp.transaction_number,
        tp.transaction_status,
        tp.transaction_type,
        tp.source_listing_id,
        tp.listing_number,
        tp.address,
        tp.suburb,
        tp.city,
        tp.sales_price,
        tp.list_price,
        tp.gci_excl_vat,
        tp.split_percentage,
        tp.net_comm,
        tp.total_gci,
        tp.sale_type,
        tp.agent_type,
        tp.buyer,
        tp.seller,
        tp.list_date,
        tp.transaction_date,
        tp.status_change_date,
        tp.expected_date,
        NOW()
      FROM migration.transactions_prepared tp
      LEFT JOIN migration.id_map_associates ia
        ON ia.source_associate_id = tp.source_associate_id
      LEFT JOIN migration.id_map_market_centers imc
        ON imc.source_market_center_id = tp.source_market_center_id
      ON CONFLICT (source_transaction_id, source_associate_id)
      DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET'}
      ${preserveExistingCoreData ? '' : `
        associate_id       = EXCLUDED.associate_id,
        market_center_id   = EXCLUDED.market_center_id,
        transaction_number = EXCLUDED.transaction_number,
        transaction_status = EXCLUDED.transaction_status,
        transaction_type   = EXCLUDED.transaction_type,
        source_listing_id  = EXCLUDED.source_listing_id,
        listing_number     = EXCLUDED.listing_number,
        address            = EXCLUDED.address,
        suburb             = EXCLUDED.suburb,
        city               = EXCLUDED.city,
        sales_price        = EXCLUDED.sales_price,
        list_price         = EXCLUDED.list_price,
        gci_excl_vat       = EXCLUDED.gci_excl_vat,
        split_percentage   = EXCLUDED.split_percentage,
        net_comm           = EXCLUDED.net_comm,
        total_gci          = EXCLUDED.total_gci,
        sale_type          = EXCLUDED.sale_type,
        agent_type         = EXCLUDED.agent_type,
        buyer              = EXCLUDED.buyer,
        seller             = EXCLUDED.seller,
        list_date          = EXCLUDED.list_date,
        transaction_date   = EXCLUDED.transaction_date,
        status_change_date = EXCLUDED.status_change_date,
        expected_date      = EXCLUDED.expected_date,
        updated_at         = NOW()`}
    `);
    });
}
async function main() {
    if (preserveExistingCoreData) {
        console.log('PRESERVE_CORE_EDITS=true -> existing core records will not be overwritten by loadCore.');
    }
    await clearRejections();
    await loadMarketCenters();
    await loadTeams();
    await loadAssociates();
    await loadListings();
    await loadTransactions();
    console.log('Loaded prepared datasets into migration.core_* with id maps and rejection logging.');
}
main()
    .catch((error) => {
    console.error('Failed to load prepared data into core tables:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await closePool();
});
//# sourceMappingURL=loadCore.js.map