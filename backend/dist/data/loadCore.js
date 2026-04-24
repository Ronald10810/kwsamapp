import { closePool, runInTransaction } from './db.js';
const preserveExistingCoreData = (process.env.PRESERVE_CORE_EDITS ?? '').trim().toLowerCase() === 'true';
function normalizeText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeNumeric(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const text = normalizeText(value);
    if (!text)
        return null;
    const cleaned = text.replace(/[^0-9.\-]/g, '');
    if (!cleaned)
        return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeDate(value) {
    const text = normalizeText(value);
    if (!text)
        return null;
    const match = text.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString().slice(0, 10);
}
function payloadRecord(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return {};
    return payload;
}
function payloadText(record, keys) {
    for (const key of keys) {
        const value = normalizeText(record[key]);
        if (value)
            return value;
    }
    return null;
}
function payloadNumber(record, keys) {
    for (const key of keys) {
        const value = normalizeNumeric(record[key]);
        if (value !== null)
            return value;
    }
    return null;
}
function payloadDate(record, keys) {
    for (const key of keys) {
        const value = normalizeDate(record[key]);
        if (value)
            return value;
    }
    return null;
}
function readObjectValue(record, keys) {
    for (const key of keys) {
        const value = normalizeText(record[key]);
        if (value)
            return value;
    }
    return null;
}
function addCandidate(target, seen, candidate) {
    const key = `${(candidate.sourceAssociateId ?? '').toLowerCase()}|${(candidate.agentName ?? '').toLowerCase()}|${(candidate.email ?? '').toLowerCase()}|${(candidate.phone ?? '').toLowerCase()}`;
    if (key === '|||')
        return;
    if (seen.has(key))
        return;
    seen.add(key);
    target.push(candidate);
}
function candidateFromObject(record) {
    const sourceAssociateId = readObjectValue(record, [
        'source_associate_id',
        'SourceAssociateId',
        'associate_id',
        'AssociateId',
        'agent_id',
        'AgentId',
        'agentId',
        '_ext_source_associate_id',
    ]);
    const agentName = readObjectValue(record, [
        'agent_name',
        'AgentName',
        'associate_name',
        'AssociateName',
        'full_name',
        'FullName',
        'name',
        'Name',
    ]);
    const phone = readObjectValue(record, [
        'phone_number',
        'PhoneNumber',
        'mobile_number',
        'MobileNumber',
        'phone',
        'Phone',
    ]);
    const email = readObjectValue(record, [
        'email',
        'Email',
        'email_address',
        'EmailAddress',
        'kwsa_email',
        'KWSAEmail',
        'private_email',
        'PrivateEmail',
    ]);
    return { sourceAssociateId, agentName, phone, email };
}
function extractAgentCandidates(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return [];
    const root = payload;
    const candidates = [];
    const seen = new Set();
    addCandidate(candidates, seen, candidateFromObject(root));
    const containerKeys = [
        'agent', 'Agent', 'associate', 'Associate', 'primary_agent', 'PrimaryAgent',
        'listing_agent', 'ListingAgent', 'agent_info', 'AgentInfo',
    ];
    for (const key of containerKeys) {
        const value = root[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            addCandidate(candidates, seen, candidateFromObject(value));
        }
    }
    const arrayKeys = ['agents', 'Agents', 'associates', 'Associates', 'listing_agents', 'ListingAgents', 'agent_list', 'AgentList'];
    for (const key of arrayKeys) {
        const value = root[key];
        if (!Array.isArray(value))
            continue;
        for (const entry of value) {
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                addCandidate(candidates, seen, candidateFromObject(entry));
            }
        }
    }
    return candidates.filter((c) => c.sourceAssociateId || c.agentName);
}
async function syncListingAgentsFromPayload() {
    await runInTransaction(async (client) => {
        const listingRows = await client.query(`SELECT id::text, source_market_center_id, listing_payload
       FROM migration.core_listings`);
        for (const listing of listingRows.rows) {
            const listingId = Number(listing.id);
            const existingAgents = await client.query(`SELECT COUNT(*)::text AS count FROM migration.listing_agents WHERE listing_id = $1`, [listingId]);
            if (Number(existingAgents.rows[0]?.count ?? '0') > 0)
                continue;
            const candidates = extractAgentCandidates(listing.listing_payload);
            if (candidates.length === 0)
                continue;
            let primaryResolvedAssociate = null;
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                let associateLookup = null;
                if (candidate.sourceAssociateId) {
                    const bySourceId = await client.query(`SELECT id::text,
                    full_name,
                    market_center_id::text,
                    mobile_number,
                    office_number,
                    COALESCE(kwsa_email, private_email, email) AS email
             FROM migration.core_associates
             WHERE source_associate_id = $1
             LIMIT 1`, [candidate.sourceAssociateId]);
                    associateLookup = bySourceId.rows[0] ?? null;
                }
                if (!associateLookup && candidate.agentName) {
                    const byName = await client.query(`SELECT id::text,
                    full_name,
                    market_center_id::text,
                    mobile_number,
                    office_number,
                    COALESCE(kwsa_email, private_email, email) AS email
             FROM migration.core_associates
             WHERE LOWER(TRIM(COALESCE(full_name, ''))) = LOWER(TRIM($1))
             ORDER BY CASE
               WHEN $2 IS NOT NULL AND source_market_center_id = $2 THEN 0
               ELSE 1
             END,
             id
             LIMIT 1`, [candidate.agentName, listing.source_market_center_id]);
                    associateLookup = byName.rows[0] ?? null;
                }
                if (!associateLookup && !candidate.agentName)
                    continue;
                const agentName = candidate.agentName ?? associateLookup?.full_name ?? null;
                if (!agentName)
                    continue;
                await client.query(`INSERT INTO migration.listing_agents (
             listing_id,
             associate_id,
             agent_name,
             agent_role,
             is_primary,
             market_center_id,
             sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                    listingId,
                    associateLookup ? Number(associateLookup.id) : null,
                    agentName,
                    index === 0 ? 'Primary' : 'Secondary',
                    index === 0,
                    associateLookup?.market_center_id ? Number(associateLookup.market_center_id) : null,
                    index,
                ]);
                if (index === 0) {
                    primaryResolvedAssociate = associateLookup
                        ? {
                            full_name: associateLookup.full_name,
                            mobile_number: associateLookup.mobile_number,
                            office_number: associateLookup.office_number,
                            email: associateLookup.email,
                        }
                        : {
                            full_name: agentName,
                            mobile_number: candidate.phone,
                            office_number: null,
                            email: candidate.email,
                        };
                }
            }
            if (primaryResolvedAssociate) {
                const payload = payloadRecord(listing.listing_payload);
                const sellerName = payloadText(payload, ['SellersName', 'sellers_name']);
                const sellerPhone = payloadText(payload, ['SellersPhone', 'sellers_phone']);
                const sellerEmail = payloadText(payload, ['SellersEmail', 'sellers_email']);
                const existingContacts = await client.query(`SELECT COUNT(*)::text AS count FROM migration.listing_contacts WHERE listing_id = $1`, [listingId]);
                if (Number(existingContacts.rows[0]?.count ?? '0') === 0) {
                    await client.query(`INSERT INTO migration.listing_contacts (
               listing_id,
               full_name,
               phone_number,
               email_address,
               sort_order
             ) VALUES ($1, $2, $3, $4, 0)`, [
                        listingId,
                        sellerName ?? primaryResolvedAssociate.full_name,
                        sellerPhone ?? primaryResolvedAssociate.mobile_number ?? primaryResolvedAssociate.office_number,
                        sellerEmail ?? primaryResolvedAssociate.email,
                    ]);
                }
            }
        }
    });
}
async function syncListingPropertyAreasFromPayload() {
    await runInTransaction(async (client) => {
        const listingRows = await client.query(`SELECT id::text, listing_payload FROM migration.core_listings`);
        const areaMapping = [
            { areaType: 'Bedroom', keys: ['Bedrooms', 'BedroomCount', 'bedrooms'] },
            { areaType: 'Bathroom', keys: ['Bathrooms', 'BathroomCount', 'bathrooms'] },
            { areaType: 'Garage', keys: ['Garages', 'GarageCount', 'garages'] },
            { areaType: 'Pool', keys: ['Pools', 'PoolCount', 'pools'] },
            { areaType: 'Dining Room', keys: ['DiningRooms', 'DiningRoomCount', 'dining_rooms'] },
            { areaType: 'Family TV Room', keys: ['FamilyRooms', 'FamilyRoomCount', 'family_rooms'] },
            { areaType: 'Lounge', keys: ['Lounges', 'LoungeCount', 'lounges'] },
        ];
        for (const listing of listingRows.rows) {
            const listingId = Number(listing.id);
            const existingAreas = await client.query(`SELECT COUNT(*)::text AS count FROM migration.listing_property_areas WHERE listing_id = $1`, [listingId]);
            if (Number(existingAreas.rows[0]?.count ?? '0') > 0)
                continue;
            const payload = payloadRecord(listing.listing_payload);
            let sortOrder = 0;
            for (const mapping of areaMapping) {
                const countValue = payloadNumber(payload, mapping.keys);
                if (countValue === null || countValue <= 0)
                    continue;
                await client.query(`INSERT INTO migration.listing_property_areas (
             listing_id,
             area_type,
             count,
             size,
             description,
             sub_features,
             sort_order
           ) VALUES ($1, $2, $3, NULL, NULL, ARRAY[]::TEXT[], $4)`, [listingId, mapping.areaType, Math.floor(countValue), sortOrder]);
                sortOrder += 1;
            }
        }
    });
}
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
        const { rows } = await client.query(`SELECT source_associate_id, first_name, last_name, full_name, email, status_name, market_center_name, team_name, kwuid, image_url, mobile_number,
              office_number, national_id, ffc_number, kwsa_email, private_email,
              growth_share_sponsor, proposed_growth_share_sponsor, temporary_growth_share_sponsor,
              start_date::text, end_date::text, anniversary_date::text, cap_date::text,
              total_cap_amount::text, manual_cap::text, agent_split::text
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
          office_number,
          national_id,
          ffc_number,
          kwsa_email,
          private_email,
          growth_share_sponsor,
          proposed_growth_share_sponsor,
          temporary_growth_share_sponsor,
          start_date,
          end_date,
          anniversary_date,
          cap_date,
          cap,
          manual_cap,
          agent_split,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::date,$23::date,$24::date,$25::date,$26,$27,$28,NOW())
        ON CONFLICT (source_associate_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : `UPDATE SET
          source_market_center_id = EXCLUDED.source_market_center_id,
          source_team_id = EXCLUDED.source_team_id,
          market_center_id = EXCLUDED.market_center_id,
          team_id = EXCLUDED.team_id,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          status_name = EXCLUDED.status_name,
          kwuid = EXCLUDED.kwuid,
          image_url = COALESCE(EXCLUDED.image_url, migration.core_associates.image_url),
          mobile_number = COALESCE(EXCLUDED.mobile_number, migration.core_associates.mobile_number),
          office_number = COALESCE(EXCLUDED.office_number, migration.core_associates.office_number),
          national_id = COALESCE(EXCLUDED.national_id, migration.core_associates.national_id),
          ffc_number = COALESCE(EXCLUDED.ffc_number, migration.core_associates.ffc_number),
          kwsa_email = COALESCE(EXCLUDED.kwsa_email, migration.core_associates.kwsa_email),
          private_email = COALESCE(EXCLUDED.private_email, migration.core_associates.private_email),
          growth_share_sponsor = COALESCE(EXCLUDED.growth_share_sponsor, migration.core_associates.growth_share_sponsor),
          proposed_growth_share_sponsor = COALESCE(EXCLUDED.proposed_growth_share_sponsor, migration.core_associates.proposed_growth_share_sponsor),
          temporary_growth_share_sponsor = COALESCE(EXCLUDED.temporary_growth_share_sponsor, migration.core_associates.temporary_growth_share_sponsor),
          start_date = COALESCE(EXCLUDED.start_date, migration.core_associates.start_date),
          end_date = COALESCE(EXCLUDED.end_date, migration.core_associates.end_date),
          anniversary_date = COALESCE(EXCLUDED.anniversary_date, migration.core_associates.anniversary_date),
          cap_date = COALESCE(EXCLUDED.cap_date, migration.core_associates.cap_date),
          cap = COALESCE(EXCLUDED.cap, migration.core_associates.cap),
          manual_cap = COALESCE(EXCLUDED.manual_cap, migration.core_associates.manual_cap),
          agent_split = COALESCE(EXCLUDED.agent_split, migration.core_associates.agent_split),
          updated_at = NOW()`}
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
                row.office_number,
                row.national_id,
                row.ffc_number,
                row.kwsa_email,
                row.private_email,
                row.growth_share_sponsor,
                row.proposed_growth_share_sponsor,
                row.temporary_growth_share_sponsor,
                row.start_date,
                row.end_date,
                row.anniversary_date,
                row.cap_date,
                row.total_cap_amount ? Number(row.total_cap_amount) : null,
                row.manual_cap ? Number(row.manual_cap) : null,
                row.agent_split ? Number(row.agent_split) : null,
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
              address_line, erf_number, unit_number, door_number, estate_name, street_number, street_name, postal_code,
              suburb, city, province, country, longitude::text, latitude::text, price::text, expiry_date::text,
              property_title, short_title, property_description, listing_images_json, listing_payload
       FROM migration.listings_prepared`);
        for (const row of rows) {
            const payload = payloadRecord(row.listing_payload);
            const signedDate = payloadDate(payload, ['SignedDate', 'signed_date']);
            const onMarketSinceDate = payloadDate(payload, ['OnMarketSinceDate', 'OnMarketSince', 'on_market_since_date', 'ListDate']);
            const ratesAndTaxes = payloadNumber(payload, ['RatesandTaxes', 'RatesAndTaxes', 'rates_and_taxes']);
            const monthlyLevy = payloadNumber(payload, ['MonthlyLevy', 'monthly_levy']);
            const erfSize = payloadNumber(payload, ['ErfSize', 'erf_size']);
            const floorArea = payloadNumber(payload, ['FloorArea', 'floor_area']);
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
          erf_number,
          unit_number,
          door_number,
          estate_name,
          street_number,
          street_name,
          postal_code,
          suburb,
          city,
          province,
          country,
          longitude,
          latitude,
          price,
          expiry_date,
          signed_date,
          on_market_since_date,
          rates_and_taxes,
          monthly_levy,
          erf_size,
          floor_area,
          property_title,
          short_title,
          property_description,
          listing_images_json,
          listing_payload,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::numeric,$20::numeric,$21::numeric,$22::date,$23::date,$24::date,$25::numeric,$26::numeric,$27::numeric,$28::numeric,$29,$30,$31,$32::jsonb,$33::jsonb,NOW())
        ON CONFLICT (source_listing_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          source_market_center_id = EXCLUDED.source_market_center_id,\n          market_center_id = EXCLUDED.market_center_id,\n          listing_number = EXCLUDED.listing_number,\n          status_name = EXCLUDED.status_name,\n          sale_or_rent = EXCLUDED.sale_or_rent,\n          address_line = EXCLUDED.address_line,\n          erf_number = EXCLUDED.erf_number,\n          unit_number = EXCLUDED.unit_number,\n          door_number = EXCLUDED.door_number,\n          estate_name = EXCLUDED.estate_name,\n          street_number = EXCLUDED.street_number,\n          street_name = EXCLUDED.street_name,\n          postal_code = EXCLUDED.postal_code,\n          suburb = EXCLUDED.suburb,\n          city = EXCLUDED.city,\n          province = EXCLUDED.province,\n          country = EXCLUDED.country,\n          longitude = EXCLUDED.longitude,\n          latitude = EXCLUDED.latitude,\n          price = EXCLUDED.price,\n          expiry_date = EXCLUDED.expiry_date,\n          signed_date = EXCLUDED.signed_date,\n          on_market_since_date = EXCLUDED.on_market_since_date,\n          rates_and_taxes = EXCLUDED.rates_and_taxes,\n          monthly_levy = EXCLUDED.monthly_levy,\n          erf_size = EXCLUDED.erf_size,\n          floor_area = EXCLUDED.floor_area,\n          property_title = EXCLUDED.property_title,\n          short_title = EXCLUDED.short_title,\n          property_description = EXCLUDED.property_description,\n          listing_images_json = EXCLUDED.listing_images_json,\n          listing_payload = EXCLUDED.listing_payload,\n          updated_at = NOW()'}
        RETURNING id
        `, [
                row.source_listing_id,
                sourceMarketCenterId,
                marketCenterId,
                row.listing_number,
                row.status_name,
                row.sale_or_rent,
                row.address_line,
                row.erf_number,
                row.unit_number,
                row.door_number,
                row.estate_name,
                row.street_number,
                row.street_name,
                row.postal_code,
                row.suburb,
                row.city,
                row.province,
                row.country,
                row.longitude,
                row.latitude,
                row.price,
                row.expiry_date,
                signedDate,
                onMarketSinceDate,
                ratesAndTaxes,
                monthlyLevy,
                erfSize,
                floorArea,
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
    await syncListingPropertyAreasFromPayload();
    await syncListingAgentsFromPayload();
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