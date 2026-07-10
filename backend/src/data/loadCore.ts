import { closePool, runInTransaction } from './db.js';

const preserveExistingCoreData =
  (process.env.PRESERVE_CORE_EDITS ?? '').trim().toLowerCase() === 'true';

type LoadMode = 'full' | 'associates';

function parseLoadMode(args: string[]): LoadMode {
  const onlyIndex = args.indexOf('--only');
  if (onlyIndex === -1) {
    return 'full';
  }

  const onlyValue = (args[onlyIndex + 1] ?? '').trim().toLowerCase();
  if (onlyValue === 'associates') {
    return 'associates';
  }

  throw new Error(
    `Unsupported --only value "${onlyValue || '(missing)'}". Supported: associates.`
  );
}

type AgentCandidate = {
  sourceAssociateId: string | null;
  agentName: string | null;
  phone: string | null;
  email: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value);
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const match = text.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  const text = normalizeText(value)?.toLowerCase();
  if (!text) return null;
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return null;
}

function normalizeZoningType(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const zoningTypeMap: Record<string, string> = {
    '1': 'Single Residential',
    '2': 'General Residential',
    '3': 'Local Business',
    '4': 'General Business',
    '5': 'General Industrial',
    '6': 'Heavy Industrial',
    '7': 'Agriculture',
    '8': 'Rural',
    '9': 'Mixed Use',
  };

  return zoningTypeMap[text] ?? text;
}

function fallbackZoningTypeFromPropertyType(value: unknown): string {
  const propertyType = normalizeText(value)?.toLowerCase() ?? '';

  if (propertyType === 'residential') return 'Single Residential';
  if (propertyType === 'commercial' || propertyType === 'business') return 'General Business';
  if (propertyType === 'industrial') return 'General Industrial';
  if (propertyType === 'farm') return 'Agriculture';
  return 'Single Residential';
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function payloadText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return null;
}

function payloadNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = normalizeNumeric(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function payloadDate(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeDate(record[key]);
    if (value) return value;
  }
  return null;
}

function payloadBool(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = normalizeBoolean(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function payloadObject(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function payloadArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function toTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = entry as Record<string, unknown>;
        const label = payloadText(obj, ['Name', 'name', 'Value', 'value', 'P24Tag', 'p24_tag']);
        if (label) items.push(label);
        continue;
      }

      const text = normalizeText(entry);
      if (text) items.push(text);
    }
    return items;
  }

  const text = normalizeText(value);
  if (!text) return [];

  return text
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueText(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function syncAssociateCollectionsFromCsvPayload(
  client: { query: (...args: unknown[]) => Promise<{ rows: Array<{ raw_payload: unknown }> }> },
  associateId: number,
  sourceAssociateId: string
): Promise<void> {
  const latestRaw = await client.query(
    `SELECT raw_payload
     FROM staging.associates_raw
     WHERE source_associate_id = $1
       AND raw_payload IS NOT NULL
     ORDER BY
       CASE
         WHEN NULLIF(BTRIM(COALESCE(raw_payload->>'Roles', raw_payload->>'_ext_role', '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(raw_payload->>'JobTitles', raw_payload->>'_ext_job_title', '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(raw_payload->>'ServiceCommunities', raw_payload->>'_ext_service_community', '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(raw_payload->>'AdminMCs', raw_payload->>'admin_market_centers', '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(raw_payload->>'AdminTeams', raw_payload->>'admin_teams', '')), '') IS NOT NULL
           THEN 0
         ELSE 1
       END,
       loaded_at DESC
     LIMIT 1`,
    [sourceAssociateId]
  );

  const payload = payloadRecord(latestRaw.rows[0]?.raw_payload);

  const roles = uniqueText([
    ...toTextList(payload['Roles']),
    ...toTextList(payload['_ext_role']),
    ...toTextList(payload['role']),
    ...toTextList(payload['RoleName']),
  ]);
  const jobTitles = uniqueText([
    ...toTextList(payload['JobTitles']),
    ...toTextList(payload['_ext_job_title']),
    ...toTextList(payload['job_title']),
  ]);
  const communities = uniqueText([
    ...toTextList(payload['ServiceCommunities']),
    ...toTextList(payload['_ext_service_community']),
    ...toTextList(payload['service_community']),
  ]);
  const adminMarketCenters = uniqueText([
    ...toTextList(payload['AdminMCs']),
    ...toTextList(payload['admin_market_centers']),
  ]);
  const adminTeams = uniqueText([
    ...toTextList(payload['AdminTeams']),
    ...toTextList(payload['admin_teams']),
  ]);

  if (roles.length > 0) {
    await client.query(`DELETE FROM migration.associate_roles WHERE associate_id = $1`, [associateId]);
    for (const role of roles) {
      await client.query(`INSERT INTO migration.associate_roles (associate_id, role_name) VALUES ($1, $2)`, [associateId, role]);
    }
  }

  if (jobTitles.length > 0) {
    await client.query(`DELETE FROM migration.associate_job_titles WHERE associate_id = $1`, [associateId]);
    for (const title of jobTitles) {
      await client.query(`INSERT INTO migration.associate_job_titles (associate_id, job_title) VALUES ($1, $2)`, [associateId, title]);
    }
  }

  if (communities.length > 0) {
    await client.query(`DELETE FROM migration.associate_service_communities WHERE associate_id = $1`, [associateId]);
    for (const community of communities) {
      await client.query(
        `INSERT INTO migration.associate_service_communities (associate_id, community_name) VALUES ($1, $2)`,
        [associateId, community]
      );
    }
  }

  if (adminMarketCenters.length > 0) {
    await client.query(`DELETE FROM migration.associate_admin_market_centers WHERE associate_id = $1`, [associateId]);
    for (const sourceMarketCenterId of adminMarketCenters) {
      await client.query(
        `INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id) VALUES ($1, $2)`,
        [associateId, sourceMarketCenterId]
      );
    }
  }

  if (adminTeams.length > 0) {
    await client.query(`DELETE FROM migration.associate_admin_teams WHERE associate_id = $1`, [associateId]);
    for (const sourceTeamId of adminTeams) {
      await client.query(
        `INSERT INTO migration.associate_admin_teams (associate_id, source_team_id) VALUES ($1, $2)`,
        [associateId, sourceTeamId]
      );
    }
  }
}

function areaTypeFromLegacyId(id: number | null): string | null {
  if (id === null) return null;

  const map: Record<number, string> = {
    1: 'Bedroom',
    2: 'Bathroom',
    3: 'Bar',
    4: 'Braai Room',
    5: 'Dining Room',
    7: 'Garage',
    9: 'Kitchen',
    10: 'Lounge',
    12: 'Office',
    13: 'Outbuilding',
    14: 'Pool',
    16: 'Parking',
    17: 'Security',
    23: 'Family TV Room',
    24: 'Entrance Hall',
  };

  return map[id] ?? null;
}

async function syncListingCoreDetailsFromPayload(): Promise<void> {
  await runInTransaction(async (client) => {
    const ssmsBuildingInfoRows = await client.query<{
      source_listing_id: string | null;
      listing_number: string | null;
      zoning_type: string | null;
    }>(
      `SELECT source_listing_id, listing_number, zoning_type
       FROM staging.ssms_listing_building_info_raw
       WHERE NULLIF(TRIM(zoning_type), '') IS NOT NULL`
    );

    const ssmsZoningBySourceListingId = new Map<string, string>();
    const ssmsZoningByListingNumber = new Map<string, string>();

    for (const row of ssmsBuildingInfoRows.rows) {
      const normalizedZoningType = normalizeZoningType(row.zoning_type);
      if (!normalizedZoningType) continue;

      const sourceListingId = normalizeText(row.source_listing_id);
      if (sourceListingId && !ssmsZoningBySourceListingId.has(sourceListingId)) {
        ssmsZoningBySourceListingId.set(sourceListingId, normalizedZoningType);
      }

      const listingNumber = normalizeText(row.listing_number);
      if (listingNumber && !ssmsZoningByListingNumber.has(listingNumber)) {
        ssmsZoningByListingNumber.set(listingNumber, normalizedZoningType);
      }
    }

    const listingRows = await client.query<{
      id: string;
      source_listing_id: string | null;
      listing_number: string | null;
      listing_payload: unknown;
    }>(
      `SELECT id::text, source_listing_id, listing_number, listing_payload FROM migration.core_listings`
    );

    for (const listing of listingRows.rows) {
      const payload = payloadRecord(listing.listing_payload);
      const buildingInfo = payloadObject(payload, ['ListingBuildingInfo', 'listing_building_info']);
      const sustainabilityInfo = payloadObject(payload, [
        'ListingBuildingInfoSustainability',
        'listing_building_info_sustainability',
      ]);
      const internetInfo = payloadObject(payload, ['ListingBuildingInfoInternet', 'listing_building_info_internet']);
      const publicTransportInfo = payloadObject(payload, [
        'ListingBuildingInfoPublicTransport',
        'listing_building_info_public_transport',
      ]);
      const zoningObj = payloadObject(buildingInfo, ['ListingBuildingZoningType', 'listing_building_zoning_type']);

      // Fall back to top-level payload keys for CSV-imported listings where building info is not nested
      const erfSize = payloadNumber(buildingInfo, ['ErfSize', 'erf_size']) ?? payloadNumber(payload, ['ErfSize', 'erf_size']);
      const floorArea = payloadNumber(buildingInfo, ['FloorArea', 'floor_area']) ?? payloadNumber(payload, ['FloorArea', 'floor_area']);
      const constructionDate = payloadDate(buildingInfo, [
        'ConstructionYear',
        'ConstructionDate',
        'construction_year',
        'construction_date',
      ]) ?? payloadDate(payload, ['ConstructionYear', 'ConstructionDate', 'construction_year', 'construction_date']);
      const heightRestriction = payloadNumber(buildingInfo, [
        'HeightRestriction',
        'HeighRestriction',
        'height_restriction',
      ]) ?? payloadNumber(payload, ['HeightRestriction', 'HeighRestriction', 'height_restriction']);
      const outBuildingSize = payloadNumber(buildingInfo, ['OutBuildingSize', 'out_building_size']) ?? payloadNumber(payload, ['OutBuildingSize', 'out_building_size']);

      const zoningType =
        normalizeZoningType(payloadText(zoningObj, ['Name', 'name'])) ??
        normalizeZoningType(payloadText(buildingInfo, ['ZoningType', 'zoning_type', 'ListingBuildingZoningType'])) ??
        normalizeZoningType(payloadText(payload, ['ZoningType', 'zoning_type'])) ??
        ssmsZoningBySourceListingId.get(normalizeText(listing.source_listing_id) ?? '') ??
        ssmsZoningByListingNumber.get(normalizeText(listing.listing_number) ?? '') ??
        fallbackZoningTypeFromPropertyType(
          payloadText(payload, ['PropertyType', 'property_type', 'PropType', 'prop_type'])
        );

      const isFurnished = payloadBool(buildingInfo, ['FurnishedProperty', 'is_furnished', 'IsFurnished']);
      const petFriendly = payloadBool(buildingInfo, ['PetFriendly', 'pet_friendly']);
      const hasStandaloneBuilding = payloadBool(buildingInfo, [
        'HasStandaloneBuilding',
        'has_standalone_building',
      ]);
      const hasFlatlet = payloadBool(buildingInfo, ['HasFlatlet', 'has_flatlet']);
      const hasBackupWater = payloadBool(buildingInfo, ['HasBackupWater', 'has_backup_water']);
      const wheelchairAccessible = payloadBool(buildingInfo, [
        'WheelChairAccessible',
        'WheelchairAccessible',
        'wheelchair_accessible',
      ]);
      const hasGenerator = payloadBool(buildingInfo, ['HasGenerator', 'has_generator']);

      const hasBorehole = payloadBool(sustainabilityInfo, ['HasBorehole', 'has_borehole']);
      const hasGasGeyser = payloadBool(sustainabilityInfo, ['HasGasGeyser', 'has_gas_geyser']);
      const hasSolarPanels = payloadBool(sustainabilityInfo, ['HasSolarPanels', 'has_solar_panels']);
      const hasBackupBatteryOrInverter = payloadBool(sustainabilityInfo, [
        'HasBackupBatteryOrInverter',
        'has_backup_battery_or_inverter',
      ]);
      const hasSolarGeyser = payloadBool(sustainabilityInfo, ['HasSolarGeyser', 'has_solar_geyser']);
      const hasWaterTank = payloadBool(sustainabilityInfo, ['HasWaterTank', 'has_water_tank']);

      const adsl = payloadBool(internetInfo, ['ADSL', 'adsl']);
      const fibre = payloadBool(internetInfo, ['Fibre', 'fibre']);
      const isdn = payloadBool(internetInfo, ['ISDN', 'isdn']);
      const dialup = payloadBool(internetInfo, ['DialUp', 'dialup']);
      const fixedWimax = payloadBool(internetInfo, ['FixedWiMax', 'fixed_wimax']);
      const satellite = payloadBool(internetInfo, ['Satellite', 'satellite']);

      const nearbyBusService = payloadBool(publicTransportInfo, ['HasNearbyBusService', 'nearby_bus_service']);
      const nearbyMinibusTaxiService = payloadBool(publicTransportInfo, [
        'HasNearbyMinibusTaxiService',
        'nearby_minibus_taxi_service',
      ]);
      const nearbyTrainService = payloadBool(publicTransportInfo, ['HasNearbyTrainService', 'nearby_train_service']);

      await client.query(
        `UPDATE migration.core_listings
         SET
           erf_size = COALESCE($2::numeric, erf_size),
           floor_area = COALESCE($3::numeric, floor_area),
           construction_date = COALESCE($4::date, construction_date),
           height_restriction = COALESCE($5::numeric, height_restriction),
           out_building_size = COALESCE($6::numeric, out_building_size),
           zoning_type = COALESCE($7, zoning_type),
           is_furnished = COALESCE($8, is_furnished),
           pet_friendly = COALESCE($9, pet_friendly),
           has_standalone_building = COALESCE($10, has_standalone_building),
           has_flatlet = COALESCE($11, has_flatlet),
           has_backup_water = COALESCE($12, has_backup_water),
           wheelchair_accessible = COALESCE($13, wheelchair_accessible),
           has_generator = COALESCE($14, has_generator),
           has_borehole = COALESCE($15, has_borehole),
           has_gas_geyser = COALESCE($16, has_gas_geyser),
           has_solar_panels = COALESCE($17, has_solar_panels),
           has_backup_battery_or_inverter = COALESCE($18, has_backup_battery_or_inverter),
           has_solar_geyser = COALESCE($19, has_solar_geyser),
           has_water_tank = COALESCE($20, has_water_tank),
           adsl = COALESCE($21, adsl),
           fibre = COALESCE($22, fibre),
           isdn = COALESCE($23, isdn),
           dialup = COALESCE($24, dialup),
           fixed_wimax = COALESCE($25, fixed_wimax),
           satellite = COALESCE($26, satellite),
           nearby_bus_service = COALESCE($27, nearby_bus_service),
           nearby_minibus_taxi_service = COALESCE($28, nearby_minibus_taxi_service),
           nearby_train_service = COALESCE($29, nearby_train_service),
           updated_at = NOW()
         WHERE id = $1`,
        [
          Number(listing.id),
          erfSize,
          floorArea,
          constructionDate,
          heightRestriction,
          outBuildingSize,
          zoningType,
          isFurnished,
          petFriendly,
          hasStandaloneBuilding,
          hasFlatlet,
          hasBackupWater,
          wheelchairAccessible,
          hasGenerator,
          hasBorehole,
          hasGasGeyser,
          hasSolarPanels,
          hasBackupBatteryOrInverter,
          hasSolarGeyser,
          hasWaterTank,
          adsl,
          fibre,
          isdn,
          dialup,
          fixedWimax,
          satellite,
          nearbyBusService,
          nearbyMinibusTaxiService,
          nearbyTrainService,
        ]
      );
    }
  });
}

async function syncListingFeaturesFromPayload(): Promise<void> {
  await runInTransaction(async (client) => {
    const listingRows = await client.query<{
      id: string;
      listing_payload: unknown;
    }>(
      `SELECT id::text, listing_payload FROM migration.core_listings`
    );

    for (const listing of listingRows.rows) {
      const listingId = Number(listing.id);
      const existingFeatures = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM migration.listing_features WHERE listing_id = $1`,
        [listingId]
      );

      if (Number(existingFeatures.rows[0]?.count ?? '0') > 0) continue;

      const payload = payloadRecord(listing.listing_payload);
      const buildingInfo = payloadObject(payload, ['ListingBuildingInfo', 'listing_building_info']);

      const buildingFeatures = uniqueText([
        ...toTextList(payload['BuildingFeatures']),
        ...toTextList(payload['building_features']),
        ...toTextList(payload['ListingBuildingAreaFeatures']),
        ...toTextList(payload['listing_building_area_features']),
        ...toTextList(buildingInfo['ListingBuildingInfoAreaFeatures']),
      ]);

      const propertyDescriptives = uniqueText([
        ...toTextList(payload['PropertyDescriptives']),
        ...toTextList(payload['property_descriptives']),
        ...toTextList(payload['DescriptiveFeatures']),
        ...toTextList(payload['descriptive_features']),
      ]);

      const lifestyleTags = uniqueText([
        ...toTextList(payload['LifestyleTags']),
        ...toTextList(payload['lifestyle_tags']),
        ...toTextList(payload['Lifestyle']),
        ...toTextList(payload['lifestyle']),
      ]);

      const categories: Array<{ category: string; values: string[] }> = [
        { category: 'Building Features', values: buildingFeatures },
        { category: 'Property Descriptives', values: propertyDescriptives },
        { category: 'Lifestyle Tags', values: lifestyleTags },
      ];

      for (const category of categories) {
        for (const [index, value] of category.values.entries()) {
          await client.query(
            `INSERT INTO migration.listing_features (
               listing_id,
               feature_category,
               feature_value,
               sort_order
             ) VALUES ($1, $2, $3, $4)`,
            [listingId, category.category, value, index]
          );
        }
      }
    }
  });
}

function readObjectValue(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return null;
}

function addCandidate(
  target: AgentCandidate[],
  seen: Set<string>,
  candidate: AgentCandidate
): void {
  const key = `${(candidate.sourceAssociateId ?? '').toLowerCase()}|${(candidate.agentName ?? '').toLowerCase()}|${(candidate.email ?? '').toLowerCase()}|${(candidate.phone ?? '').toLowerCase()}`;
  if (key === '|||') return;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(candidate);
}

function candidateFromObject(record: Record<string, unknown>): AgentCandidate {
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

function extractAgentCandidates(payload: unknown): AgentCandidate[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];

  const root = payload as Record<string, unknown>;
  const candidates: AgentCandidate[] = [];
  const seen = new Set<string>();

  addCandidate(candidates, seen, candidateFromObject(root));

  const containerKeys = [
    'agent', 'Agent', 'associate', 'Associate', 'primary_agent', 'PrimaryAgent',
    'listing_agent', 'ListingAgent', 'agent_info', 'AgentInfo',
  ];
  for (const key of containerKeys) {
    const value = root[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      addCandidate(candidates, seen, candidateFromObject(value as Record<string, unknown>));
    }
  }

  const arrayKeys = ['agents', 'Agents', 'associates', 'Associates', 'listing_agents', 'ListingAgents', 'agent_list', 'AgentList'];
  for (const key of arrayKeys) {
    const value = root[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        addCandidate(candidates, seen, candidateFromObject(entry as Record<string, unknown>));
      }
    }
  }

  return candidates.filter((c) => c.sourceAssociateId || c.agentName);
}

async function syncListingAgentsFromPayload(): Promise<void> {
  await runInTransaction(async (client) => {
    const listingRows = await client.query<{
      id: string;
      source_market_center_id: string | null;
      listing_payload: unknown;
    }>(
      `SELECT id::text, source_market_center_id, listing_payload
       FROM migration.core_listings`
    );

    for (const listing of listingRows.rows) {
      const listingId = Number(listing.id);
      const existingAgents = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM migration.listing_agents WHERE listing_id = $1`,
        [listingId]
      );

      if (Number(existingAgents.rows[0]?.count ?? '0') > 0) continue;

      const candidates = extractAgentCandidates(listing.listing_payload);
      if (candidates.length === 0) continue;

      let primaryResolvedAssociate: {
        full_name: string | null;
        mobile_number: string | null;
        office_number: string | null;
        email: string | null;
      } | null = null;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];

        let associateLookup: {
          id: string;
          full_name: string | null;
          market_center_id: string | null;
          mobile_number: string | null;
          office_number: string | null;
          email: string | null;
        } | null = null;

        if (candidate.sourceAssociateId) {
          const bySourceId = await client.query<{
            id: string;
            full_name: string | null;
            market_center_id: string | null;
            mobile_number: string | null;
            office_number: string | null;
            email: string | null;
          }>(
            `SELECT id::text,
                    full_name,
                    market_center_id::text,
                    mobile_number,
                    office_number,
                    COALESCE(kwsa_email, private_email, email) AS email
             FROM migration.core_associates
             WHERE source_associate_id = $1
             LIMIT 1`,
            [candidate.sourceAssociateId]
          );
          associateLookup = bySourceId.rows[0] ?? null;
        }

        if (!associateLookup && candidate.agentName) {
          const byName = await client.query<{
            id: string;
            full_name: string | null;
            market_center_id: string | null;
            mobile_number: string | null;
            office_number: string | null;
            email: string | null;
          }>(
            `SELECT id::text,
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
             LIMIT 1`,
            [candidate.agentName, listing.source_market_center_id]
          );
          associateLookup = byName.rows[0] ?? null;
        }

        if (!associateLookup && !candidate.agentName) continue;

        const agentName = candidate.agentName ?? associateLookup?.full_name ?? null;
        if (!agentName) continue;

        await client.query(
          `INSERT INTO migration.listing_agents (
             listing_id,
             associate_id,
             agent_name,
             agent_role,
             is_primary,
             market_center_id,
             sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            listingId,
            associateLookup ? Number(associateLookup.id) : null,
            agentName,
            index === 0 ? 'Primary' : 'Secondary',
            index === 0,
            associateLookup?.market_center_id ? Number(associateLookup.market_center_id) : null,
            index,
          ]
        );

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

        const existingContacts = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM migration.listing_contacts WHERE listing_id = $1`,
          [listingId]
        );

        if (Number(existingContacts.rows[0]?.count ?? '0') === 0) {
          await client.query(
            `INSERT INTO migration.listing_contacts (
               listing_id,
               full_name,
               phone_number,
               email_address,
               sort_order
             ) VALUES ($1, $2, $3, $4, 0)`,
            [
              listingId,
              sellerName ?? primaryResolvedAssociate.full_name,
              sellerPhone ?? primaryResolvedAssociate.mobile_number ?? primaryResolvedAssociate.office_number,
              sellerEmail ?? primaryResolvedAssociate.email,
            ]
          );
        }
      }
    }
  });
}

async function syncListingPropertyAreasFromPayload(): Promise<void> {
  await runInTransaction(async (client) => {
    const listingRows = await client.query<{
      id: string;
      listing_payload: unknown;
    }>(
      `SELECT id::text, listing_payload FROM migration.core_listings`
    );

    const areaMapping: Array<{ areaType: string; keys: string[] }> = [
      { areaType: 'Bedroom', keys: ['Bedrooms', 'BedroomCount', 'bedrooms'] },
      { areaType: 'Bathroom', keys: ['Bathrooms', 'BathroomCount', 'bathrooms'] },
      { areaType: 'Garage', keys: ['Garages', 'GarageCount', 'garages'] },
      { areaType: 'Parking', keys: ['ParkingBays', 'ParkingCount', 'parking_bays', 'parking_count'] },
      { areaType: 'Kitchen', keys: ['Kitchens', 'KitchenCount', 'kitchens'] },
      { areaType: 'Bar', keys: ['Bars', 'BarCount', 'bars'] },
      { areaType: 'Office', keys: ['Offices', 'OfficeCount', 'offices'] },
      { areaType: 'Outbuilding', keys: ['Outbuildings', 'OutBuildingCount', 'outbuildings'] },
      { areaType: 'Security', keys: ['SecurityRooms', 'SecurityCount', 'security'] },
      { areaType: 'Pool', keys: ['Pools', 'PoolCount', 'pools'] },
      { areaType: 'Dining Room', keys: ['DiningRooms', 'DiningRoomCount', 'dining_rooms'] },
      { areaType: 'Family TV Room', keys: ['FamilyRooms', 'FamilyRoomCount', 'family_rooms'] },
      { areaType: 'Lounge', keys: ['Lounges', 'LoungeCount', 'lounges'] },
    ];

    for (const listing of listingRows.rows) {
      const listingId = Number(listing.id);
      const payload = payloadRecord(listing.listing_payload);

      const existingRows = await client.query<{ area_type: string }>(
        `SELECT area_type FROM migration.listing_property_areas WHERE listing_id = $1`,
        [listingId]
      );
      const existingAreaTypes = new Set(
        existingRows.rows
          .map((row) => normalizeText(row.area_type)?.toLowerCase())
          .filter((value): value is string => Boolean(value))
      );

      const sortOrderLookup = await client.query<{ max_sort: string | null }>(
        `SELECT MAX(sort_order)::text AS max_sort FROM migration.listing_property_areas WHERE listing_id = $1`,
        [listingId]
      );
      let sortOrder = Number(sortOrderLookup.rows[0]?.max_sort ?? '-1') + 1;

      for (const mapping of areaMapping) {
        const countValue = payloadNumber(payload, mapping.keys);
        if (countValue === null || countValue <= 0) continue;
        if (existingAreaTypes.has(mapping.areaType.toLowerCase())) continue;

        await client.query(
          `INSERT INTO migration.listing_property_areas (
             listing_id,
             area_type,
             count,
             size,
             description,
             sub_features,
             sort_order
           ) VALUES ($1, $2, $3, NULL, NULL, ARRAY[]::TEXT[], $4)`,
          [listingId, mapping.areaType, Math.floor(countValue), sortOrder]
        );

        existingAreaTypes.add(mapping.areaType.toLowerCase());
        sortOrder += 1;
      }

      const payloadAreas = payloadArray(payload, ['ListingPropertyAreas', 'listing_property_areas', 'PropertyAreas']);
      for (const area of payloadAreas) {
        if (!area || typeof area !== 'object' || Array.isArray(area)) continue;
        const areaRecord = area as Record<string, unknown>;

        const areaTypeObject = payloadObject(areaRecord, ['ListingPropertyAreaType', 'listing_property_area_type']);
        const areaTypeId =
          payloadNumber(areaRecord, ['ListingPropertyAreaTypeId', 'listing_property_area_type_id']) ??
          payloadNumber(areaTypeObject, ['Id', 'id']);

        const areaType =
          payloadText(areaRecord, ['AreaName', 'area_name', 'AreaType', 'area_type']) ??
          payloadText(areaTypeObject, ['Name', 'name']) ??
          areaTypeFromLegacyId(areaTypeId !== null ? Math.floor(areaTypeId) : null);

        if (!areaType) continue;
        if (existingAreaTypes.has(areaType.toLowerCase())) continue;

        const areaCount = payloadNumber(areaRecord, ['Count', 'count', 'Quantity', 'quantity']);
        const areaSize = payloadNumber(areaRecord, ['Size', 'size']);
        const areaDescription = payloadText(areaRecord, ['Description', 'description']);

        const subFeatures = uniqueText([
          ...toTextList(areaRecord['SubFeatures']),
          ...toTextList(areaRecord['sub_features']),
          ...toTextList(areaRecord['Features']),
          ...toTextList(areaRecord['features']),
          ...toTextList(areaRecord['ListingPropertyFeatures']),
          ...toTextList(areaRecord['listing_property_features']),
        ]);

        await client.query(
          `INSERT INTO migration.listing_property_areas (
             listing_id,
             area_type,
             count,
             size,
             description,
             sub_features,
             sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            listingId,
            areaType,
            areaCount !== null ? Math.floor(areaCount) : null,
            areaSize,
            areaDescription,
            subFeatures,
            sortOrder,
          ]
        );

        existingAreaTypes.add(areaType.toLowerCase());
        sortOrder += 1;
      }
    }
  });
}

async function clearRejections(): Promise<void> {
  await runInTransaction(async (client) => {
    await client.query('DELETE FROM migration.load_rejections');
  });
}

async function loadMarketCenters(): Promise<void> {
  await runInTransaction(async (client) => {
    const { rows } = await client.query<{
      source_market_center_id: string;
      name: string | null;
      status_name: string | null;
      frontdoor_id: string | null;
      company_registered_name: string | null;
      address_source_id: string | null;
      logo_document_id: string | null;
      contact_number: string | null;
      contact_email: string | null;
      kw_office_id: string | null;
    }>(`SELECT source_market_center_id, name, status_name, frontdoor_id, company_registered_name, address_source_id, logo_document_id, contact_number, contact_email, kw_office_id FROM migration.market_centers_prepared`);

    for (const row of rows) {
      if (!row.name || row.name.trim().length === 0) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('market_center', $1, 'Missing market center name', $2::jsonb)`,
          [row.source_market_center_id, JSON.stringify(row)]
        );
        continue;
      }

      let upsert = await client.query<{ id: string }>(
        `
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
        `,
        [
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
        ]
      );

      if (upsert.rowCount === 0) {
        upsert = await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [row.source_market_center_id]
        );
      }

      await client.query(
        `
        INSERT INTO migration.id_map_market_centers (source_market_center_id, core_market_center_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_market_center_id)
        DO UPDATE SET core_market_center_id = EXCLUDED.core_market_center_id, mapped_at = NOW()
        `,
        [row.source_market_center_id, Number(upsert.rows[0].id)]
      );
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

async function loadTeams(): Promise<void> {
  await runInTransaction(async (client) => {
    const { rows } = await client.query<{
      source_team_id: string;
      source_market_center_id: string | null;
      name: string | null;
      status_name: string | null;
    }>(`SELECT source_team_id, source_market_center_id, name, status_name FROM migration.teams_prepared`);

    for (const row of rows) {
      if (!row.name || row.name.trim().length === 0) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('team', $1, 'Missing team name', $2::jsonb)`,
          [row.source_team_id, JSON.stringify(row)]
        );
        continue;
      }

      const marketCenterLookup = row.source_market_center_id
        ? await client.query<{ core_market_center_id: string }>(
            `SELECT core_market_center_id FROM migration.id_map_market_centers WHERE source_market_center_id = $1`,
            [row.source_market_center_id]
          )
        : { rows: [] };

      const marketCenterId = marketCenterLookup.rows[0]?.core_market_center_id
        ? Number(marketCenterLookup.rows[0].core_market_center_id)
        : null;

      if (row.source_market_center_id && !marketCenterId) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('team', $1, 'Referenced market center not loaded', $2::jsonb)`,
          [row.source_team_id, JSON.stringify(row)]
        );
        continue;
      }

      let upsert = await client.query<{ id: string }>(
        `
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
        `,
        [row.source_team_id, row.source_market_center_id, marketCenterId, row.name.trim(), row.status_name]
      );

      if (upsert.rowCount === 0) {
        upsert = await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_teams WHERE source_team_id = $1 LIMIT 1`,
          [row.source_team_id]
        );
      }

      await client.query(
        `
        INSERT INTO migration.id_map_teams (source_team_id, core_team_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_team_id)
        DO UPDATE SET core_team_id = EXCLUDED.core_team_id, mapped_at = NOW()
        `,
        [row.source_team_id, Number(upsert.rows[0].id)]
      );
    }
  });
}

async function loadAssociates(): Promise<void> {
  await runInTransaction(async (client) => {
    const { rows } = await client.query<{
      source_associate_id: string;
      first_name: string | null;
      last_name: string | null;
      full_name: string | null;
      email: string | null;
      status_name: string | null;
      market_center_name: string | null;
      team_name: string | null;
      kwuid: string | null;
      image_url: string | null;
      mobile_number: string | null;
      office_number: string | null;
      national_id: string | null;
      ffc_number: string | null;
      kwsa_email: string | null;
      private_email: string | null;
      growth_share_sponsor: string | null;
      proposed_growth_share_sponsor: string | null;
      temporary_growth_share_sponsor: string | null;
      start_date: string | null;
      end_date: string | null;
      anniversary_date: string | null;
      cap_date: string | null;
      total_cap_amount: string | null;
      manual_cap: boolean | null;
      agent_split: string | null;
    }>(
      `SELECT source_associate_id, first_name, last_name, full_name, email, status_name, market_center_name, team_name, kwuid, image_url, mobile_number,
              office_number, national_id, ffc_number, kwsa_email, private_email,
              growth_share_sponsor, proposed_growth_share_sponsor, temporary_growth_share_sponsor,
              start_date::text, end_date::text, anniversary_date::text, cap_date::text,
              total_cap_amount::text, manual_cap, agent_split::text
       FROM migration.associates_prepared`
    );

    for (const row of rows) {

      const marketCenterLookup = row.market_center_name
        ? await client.query<{ id: string; source_market_center_id: string }>(
            `SELECT id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`,
            [row.market_center_name]
          )
        : { rows: [] };

      const teamLookup = row.team_name
        ? await client.query<{ id: string; source_team_id: string }>(
            `SELECT id, source_team_id FROM migration.core_teams WHERE name = $1 LIMIT 1`,
            [row.team_name]
          )
        : { rows: [] };

      const marketCenterId = marketCenterLookup.rows[0]?.id ? Number(marketCenterLookup.rows[0].id) : null;
      const sourceMarketCenterId = marketCenterLookup.rows[0]?.source_market_center_id ?? null;
      const teamId = teamLookup.rows[0]?.id ? Number(teamLookup.rows[0].id) : null;
      const sourceTeamId = teamLookup.rows[0]?.source_team_id ?? null;

      if (!marketCenterId && row.market_center_name) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('associate', $1, 'Market center not mapped; associate loaded without center link', $2::jsonb)`,
          [row.source_associate_id, JSON.stringify(row)]
        );
      }

      let upsert = await client.query<{ id: string }>(
        `
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
        `,
        [
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
          row.manual_cap ?? null,
          row.agent_split ? Number(row.agent_split) : null,
        ]
      );

      if (upsert.rowCount === 0) {
        upsert = await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
          [row.source_associate_id]
        );
      }

      await client.query(
        `
        INSERT INTO migration.id_map_associates (source_associate_id, core_associate_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_associate_id)
        DO UPDATE SET core_associate_id = EXCLUDED.core_associate_id, mapped_at = NOW()
        `,
        [row.source_associate_id, Number(upsert.rows[0].id)]
      );

      await syncAssociateCollectionsFromCsvPayload(client, Number(upsert.rows[0].id), row.source_associate_id);
    }
  });
}

async function loadListings(): Promise<void> {
  await runInTransaction(async (client) => {
    const { rows } = await client.query<{
      source_listing_id: string;
      listing_number: string | null;
      status_name: string | null;
      market_center_name: string | null;
      sale_or_rent: string | null;
      address_line: string | null;
      erf_number: string | null;
      unit_number: string | null;
      door_number: string | null;
      estate_name: string | null;
      street_number: string | null;
      street_name: string | null;
      postal_code: string | null;
      suburb: string | null;
      city: string | null;
      province: string | null;
      country: string | null;
      longitude: string | null;
      latitude: string | null;
      price: string | null;
      expiry_date: string | null;
      property_title: string | null;
      short_title: string | null;
      property_description: string | null;
      listing_images_json: unknown;
      listing_payload: unknown;
      ssms_status_name: string | null;
      ssms_listing_status_tag: string | null;
      ssms_sale_or_rent: string | null;
    }>(
      `SELECT p.source_listing_id, p.listing_number, p.status_name, p.market_center_name, p.sale_or_rent,
              p.address_line, p.erf_number, p.unit_number, p.door_number, p.estate_name, p.street_number, p.street_name, p.postal_code,
              p.suburb, p.city, p.province, p.country, p.longitude::text, p.latitude::text, p.price::text, p.expiry_date::text,
              p.property_title, p.short_title, p.property_description, p.listing_images_json, p.listing_payload,
              ssms.status_name AS ssms_status_name,
              ssms.listing_status_tag AS ssms_listing_status_tag,
              ssms.sale_or_rent AS ssms_sale_or_rent
       FROM migration.listings_prepared p
       LEFT JOIN LATERAL (
         SELECT
           NULLIF(TRIM(d.status_name), '') AS status_name,
           NULLIF(TRIM(d.listing_status_tag), '') AS listing_status_tag,
           NULLIF(TRIM(d.sale_or_rent), '') AS sale_or_rent
         FROM staging.ssms_listing_details_raw d
         WHERE (
           NULLIF(TRIM(d.source_listing_id), '') IS NOT NULL
           AND p.source_listing_id = NULLIF(TRIM(d.source_listing_id), '')
         ) OR (
           NULLIF(TRIM(d.listing_number), '') IS NOT NULL
           AND p.listing_number = NULLIF(TRIM(d.listing_number), '')
         )
         ORDER BY
           (NULLIF(TRIM(d.source_listing_id), '') = p.source_listing_id) DESC,
           (NULLIF(TRIM(d.listing_status_tag), '') IS NOT NULL) DESC,
           (NULLIF(TRIM(d.status_name), '') IS NOT NULL) DESC
         LIMIT 1
       ) ssms ON TRUE`
    );

    for (const row of rows) {
      const payload = payloadRecord(row.listing_payload);
      const resolvedStatusName = row.ssms_status_name ?? row.status_name;
      const resolvedListingStatusTag =
        row.ssms_listing_status_tag
        ?? payloadText(payload, ['listing_status_tag', 'ListingStatusTag', 'status_tag', 'StatusTag']);
      const resolvedSaleOrRent =
        row.ssms_sale_or_rent
        ?? row.sale_or_rent
        ?? payloadText(payload, ['sale_or_rent', 'SaleOrRent', 'SaleType']);
      const resolvedListingPayload = {
        ...payload,
        ...(resolvedStatusName ? { status_name: resolvedStatusName } : {}),
        ...(resolvedListingStatusTag ? { listing_status_tag: resolvedListingStatusTag } : {}),
        ...(resolvedSaleOrRent ? { sale_or_rent: resolvedSaleOrRent } : {}),
      };

      const signedDate = payloadDate(payload, ['SignedDate', 'signed_date']);
      const onMarketSinceDate = payloadDate(payload, ['OnMarketSinceDate', 'OnMarketSince', 'on_market_since_date', 'ListDate']);
      const propertyType = payloadText(payload, ['property_type', 'PropertyType', 'ListingType', 'listing_type']);
      const propertySubType = payloadText(payload, ['property_sub_type', 'PropertySubType', 'SubType']);
      const bedrooms = payloadNumber(payload, ['BedroomCount', 'bedroom_count', 'Bedrooms', 'bedrooms']);
      const bathrooms = payloadNumber(payload, ['BathroomCount', 'bathroom_count', 'Bathrooms', 'bathrooms']);
      const garages = payloadNumber(payload, ['GarageCount', 'garage_count', 'Garages', 'garages']);
      const parking = payloadNumber(payload, ['ParkingCount', 'parking_count', 'ParkingBays', 'parking_bays']);
      const ratesAndTaxes = payloadNumber(payload, ['RatesandTaxes', 'RatesAndTaxes', 'rates_and_taxes']);
      const monthlyLevy = payloadNumber(payload, ['MonthlyLevy', 'monthly_levy']);
      const erfSize = payloadNumber(payload, ['ErfSize', 'erf_size']);
      const floorArea = payloadNumber(payload, ['FloorArea', 'floor_area']);

      const marketCenterLookup = row.market_center_name
        ? await client.query<{ id: string; source_market_center_id: string }>(
            `SELECT id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`,
            [row.market_center_name]
          )
        : { rows: [] };

      const marketCenterId = marketCenterLookup.rows[0]?.id ? Number(marketCenterLookup.rows[0].id) : null;
      const sourceMarketCenterId = marketCenterLookup.rows[0]?.source_market_center_id ?? null;

      if (!marketCenterId && row.market_center_name) {
        await client.query(
          `INSERT INTO migration.load_rejections (entity_name, source_id, reason, payload)
           VALUES ('listing', $1, 'Referenced market center name not loaded', $2::jsonb)`,
          [row.source_listing_id, JSON.stringify(row)]
        );
        continue;
      }

      let upsert = await client.query<{ id: string }>(
        `
        INSERT INTO migration.core_listings (
          source_listing_id,
          source_market_center_id,
          market_center_id,
          listing_number,
          status_name,
          listing_status_tag,
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
          property_type,
          property_sub_type,
          bedrooms,
          bathrooms,
          garages,
          parking,
          listing_images_json,
          listing_payload,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::numeric,$21::numeric,$22::numeric,$23::date,$24::date,$25::date,$26::numeric,$27::numeric,$28::numeric,$29::numeric,$30,$31,$32,$33,$34,$35::int,$36::int,$37::int,$38::int,$39::jsonb,$40::jsonb,NOW())
        ON CONFLICT (source_listing_id)
        DO ${preserveExistingCoreData ? 'NOTHING' : 'UPDATE SET\n          source_market_center_id = EXCLUDED.source_market_center_id,\n          market_center_id = EXCLUDED.market_center_id,\n          listing_number = EXCLUDED.listing_number,\n          status_name = EXCLUDED.status_name,\n          listing_status_tag = EXCLUDED.listing_status_tag,\n          sale_or_rent = EXCLUDED.sale_or_rent,\n          address_line = EXCLUDED.address_line,\n          erf_number = EXCLUDED.erf_number,\n          unit_number = EXCLUDED.unit_number,\n          door_number = EXCLUDED.door_number,\n          estate_name = EXCLUDED.estate_name,\n          street_number = EXCLUDED.street_number,\n          street_name = EXCLUDED.street_name,\n          postal_code = EXCLUDED.postal_code,\n          suburb = EXCLUDED.suburb,\n          city = EXCLUDED.city,\n          province = EXCLUDED.province,\n          country = EXCLUDED.country,\n          longitude = EXCLUDED.longitude,\n          latitude = EXCLUDED.latitude,\n          price = COALESCE(EXCLUDED.price, migration.core_listings.price),\n          expiry_date = EXCLUDED.expiry_date,\n          signed_date = COALESCE(EXCLUDED.signed_date, migration.core_listings.signed_date),\n          on_market_since_date = COALESCE(EXCLUDED.on_market_since_date, migration.core_listings.on_market_since_date),\n          rates_and_taxes = EXCLUDED.rates_and_taxes,\n          monthly_levy = EXCLUDED.monthly_levy,\n          erf_size = COALESCE(EXCLUDED.erf_size, migration.core_listings.erf_size),\n          floor_area = COALESCE(EXCLUDED.floor_area, migration.core_listings.floor_area),\n          property_title = EXCLUDED.property_title,\n          short_title = EXCLUDED.short_title,\n          property_description = EXCLUDED.property_description,\n          property_type = COALESCE(EXCLUDED.property_type, migration.core_listings.property_type),\n          property_sub_type = COALESCE(EXCLUDED.property_sub_type, migration.core_listings.property_sub_type),\n          bedrooms = COALESCE(EXCLUDED.bedrooms, migration.core_listings.bedrooms),\n          bathrooms = COALESCE(EXCLUDED.bathrooms, migration.core_listings.bathrooms),\n          garages = COALESCE(EXCLUDED.garages, migration.core_listings.garages),\n          parking = COALESCE(EXCLUDED.parking, migration.core_listings.parking),\n          listing_images_json = EXCLUDED.listing_images_json,\n          listing_payload = EXCLUDED.listing_payload,\n          updated_at = NOW()'}
        RETURNING id
        `,
        [
          row.source_listing_id,
          sourceMarketCenterId,
          marketCenterId,
          row.listing_number,
          resolvedStatusName,
          resolvedListingStatusTag,
          resolvedSaleOrRent,
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
          propertyType,
          propertySubType,
          bedrooms,
          bathrooms,
          garages,
          parking,
          JSON.stringify(row.listing_images_json ?? []),
          JSON.stringify(resolvedListingPayload),
        ]
      );

      if (upsert.rowCount === 0) {
        upsert = await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_listings WHERE source_listing_id = $1 LIMIT 1`,
          [row.source_listing_id]
        );
      }

      await client.query(
        `
        INSERT INTO migration.id_map_listings (source_listing_id, core_listing_id, mapped_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (source_listing_id)
        DO UPDATE SET core_listing_id = EXCLUDED.core_listing_id, mapped_at = NOW()
        `,
        [row.source_listing_id, Number(upsert.rows[0].id)]
      );
    }
  });
}

async function loadTransactions(): Promise<void> {
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

async function main(): Promise<void> {
  const mode = parseLoadMode(process.argv.slice(2));

  if (preserveExistingCoreData) {
    console.log('PRESERVE_CORE_EDITS=true -> existing core records will not be overwritten by loadCore.');
  }

  if (mode === 'associates') {
    await loadAssociates();
    console.log('Loaded associates prepared dataset into migration.core_associates only.');
    return;
  }

  await clearRejections();
  await loadMarketCenters();
  await loadTeams();
  await loadAssociates();
  await loadListings();
  await syncListingCoreDetailsFromPayload();
  await syncListingFeaturesFromPayload();
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
