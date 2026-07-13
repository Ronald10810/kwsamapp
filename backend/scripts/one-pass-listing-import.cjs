'use strict';

const sql = require('mssql');
const { Client } = require('pg');

const AZURE = {
  server: 'kwsa.database.windows.net',
  port: 1433,
  database: 'dbMappProd',
  user: 'kwsaReadOnly',
  password: 'W4Km3jUnYyt+x8=',
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 30000,
  connectionTimeout: 30000,
};

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || '9470'),
  database: process.env.PGDATABASE || 'kwsa_uat',
  user: process.env.PGUSER || 'kwsa_uat',
  password: process.env.PGPASSWORD || '123456789',
  ssl: false,
};

const LISTING_NUMBER = String(process.argv[2] || 'KWL318657').trim().toUpperCase();

const STYLE_OPTIONS = new Set([
  'A-frame', 'Architect-designed', 'Balinese', 'Cape Dutch', 'Classical', 'Colonial', 'Contemporary', 'Conventional',
  'Cottage', 'Mediterranean', 'Modern', 'Open Plan', 'Provencal', 'Spanish', 'Split Level', 'Traditional', 'Tuscan',
  'Ultra Modern', 'Victorian',
]);
const FACING_OPTIONS = new Set([
  'Above Road', 'Below Road', 'East', 'Green Belt', 'Level Road', 'Mountain View', 'North', 'Sea', 'South',
  'Street Front', 'Water', 'West',
]);
const ROOF_OPTIONS = new Set([
  'A-frame', 'Aluminium', 'Asbestos', 'Brown Built', 'Concrete', 'Fibreglass', 'Flat Roof', 'Glass Dome',
  'Insulation', 'Iron', 'Shingles', 'Slate', 'Thatch', 'Tile', 'Waterproofing', 'Zinc',
]);
const WALLS_OPTIONS = new Set(['Asbestos', 'Brick', 'Concrete', 'Face Brick', 'Glass', 'Iron', 'Plaster', 'Stone', 'Wood']);
const WINDOWS_OPTIONS = new Set([
  'Aluminium', 'Bay', 'Cottage', 'Dormer', 'Double Glazed', 'Lead', 'Picture', 'Sash', 'Skylight',
  'Stained', 'Steel', 'Wood',
]);
const LIFESTYLE_OPTIONS = new Set([
  'Aquatic Activities', 'Casino Estate', 'Coastal/Beach', 'Complex', 'Country Club', 'Country Living',
  'Cul-de-sac', 'Dual Living', 'Eco Estate', 'Equestrian/Polo Estate', 'Estate', 'Fishing Estate',
  'Game/Stock Farm', 'Gated Community', 'Golf Estate', 'Holiday Home', 'Holiday Resort', 'Island Estate',
  'Lakefront', 'Lifestyle Farm', 'Marina', 'Metropolitan', 'Mountain', 'Nature Reserve', 'Retirement Living',
  'River frontage', 'Security Complex', 'Security Estate', 'Shared Living', 'Smallholding', 'Student Accommodation',
  'Suburban', 'University/College Community', 'Waterfront', 'Wellness estate', 'Wildlife Estate', 'Winelands',
]);

const PROPERTY_DESCRIPTIVE_OPTIONS = new Set([
  'Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Dual Living', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse',
  'Multi Storey', 'Semi Detached', 'Simplex', 'Single Storey', 'Smallholding', 'Townhouse', 'Villa',
  'Bachelor/Studio', 'First Floor', 'Garden Flat', 'Ground Floor', 'Loft/Warehouse', 'New Development', 'Penthouse',
  'Second floor and above', 'Stacked Simplex', 'Third Floor', 'Top Floor', 'Distribution Centre', 'Factory', 'Hotel',
  'Office', 'Retail', 'Storage', 'Warehouse', 'Yard', 'Aquaculture', 'Cash Crops', 'Dairy Farm', 'Flower Farm',
  'Fruit Farm', 'Game Farm', 'Irrigation Farm', 'Live Stock Farm', 'Nature Reserve', 'Residential', 'Farming',
]);

function uniqText(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const v = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function classifyFeature(value) {
  if (STYLE_OPTIONS.has(value)) return 'Style';
  if (FACING_OPTIONS.has(value)) return 'Facing';
  if (ROOF_OPTIONS.has(value)) return 'Roof';
  if (WALLS_OPTIONS.has(value)) return 'Walls';
  if (WINDOWS_OPTIONS.has(value)) return 'Windows';
  if (PROPERTY_DESCRIPTIVE_OPTIONS.has(value)) return 'Property Descriptive';
  if (LIFESTYLE_OPTIONS.has(value)) return 'Lifestyle';
  return null;
}

function bool(v) {
  return v === true || v === 1 || v === '1';
}

const CANONICAL_RENTAL_RATE_OPTIONS = ['Monthly', 'Weekly', 'Daily', 'Yearly', 'Per Square Meter'];

function normalizeRentalRate(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return null;

  const direct = CANONICAL_RENTAL_RATE_OPTIONS.find((v) => v.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;

  if (/^[0-4]$/.test(raw)) {
    return CANONICAL_RENTAL_RATE_OPTIONS[Number(raw)] ?? null;
  }

  return null;
}

function todayInJohannesburg() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

function normalizeCoordinate(rawValue, kind) {
  if (rawValue == null) return null;
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return null;

  const abs = Math.abs(n);
  const scaledDown = abs > 1000 ? n / 1e7 : n;
  const limit = kind === 'lat' ? 90 : 180;

  return Math.abs(scaledDown) <= limit ? scaledDown : null;
}

(async () => {
  let az;
  let pg;

  try {
    az = await sql.connect(AZURE);
    pg = new Client(PG);
    await pg.connect();

    console.log('[1] Connected to Azure and UAT');

    const listingCore = await az.request().input('listingNumber', sql.NVarChar, LISTING_NUMBER).query(`
      SELECT TOP 1
        l.Id AS ListingId,
        l.ListingNumber,
        l.ListingStatusId,
        ls.Name AS StatusName,
        l.ListingStatusTagId,
        stag.Name AS StatusTag,
        l.ListingOwnershipTypeId,
        lot.Name AS OwnershipType,
        l.SaleOrRentTypeId,
        srt.Name AS SaleOrRent,
        l.ListingDate,
        l.ExpiryDate,
        l.WithdrawnDate,
        l.OccupationDate,
        pd.Price,
        pd.POA,
        pd.NoTransferDuty,
        ld.PropertyTitle,
        ld.ShortTitle,
        ld.PropertyDescription,
        ld.ShortDescription,
        lt.Name AS PropertyType,
        lsub.Name AS PropertySubType,
        a.StreetNumber,
        a.StreetName,
        a.SuburbId,
        sub.Name AS Suburb,
        city.Name AS City,
        prov.Name AS Province,
        ctry.Name AS Country,
        a.UnitNumber,
        a.DoorNumber,
        a.EstateName,
        a.PostalCode,
        a.ErfNumber,
        a.Latitude,
        a.Longitude,
        a.OverrideDisplayLocation,
        a.OverrideDisplayLatitude,
        a.OverrideDisplayLongitude,
        l.WhenUpdated,
        l.WhenCreated,
        mc.Id AS SourceMarketCenterId,
        mc.Name AS SourceMarketCenterName
      FROM dbo.Listing l
      LEFT JOIN dbo.ListingStatus ls ON ls.Id = l.ListingStatusId
      LEFT JOIN dbo.ListingStatusTag stag ON stag.Id = l.ListingStatusTagId
      LEFT JOIN dbo.ListingOwnershipTypes lot ON lot.Id = l.ListingOwnershipTypeId
      LEFT JOIN dbo.ListingSaleOrRentTypes srt ON srt.Id = l.SaleOrRentTypeId
      LEFT JOIN dbo.ListingPriceDetails pd ON pd.ListingId = l.Id
      LEFT JOIN dbo.ListingDescription ld ON ld.ListingId = l.Id
      LEFT JOIN dbo.ListingType lt ON lt.Id = ld.ListingTypeId
      LEFT JOIN dbo.ListingSubType lsub ON lsub.Id = ld.ListingSubTypeId
      LEFT JOIN dbo.Address a ON a.Id = l.AddressId
      LEFT JOIN dbo.Suburb sub ON sub.Id = a.SuburbId
      LEFT JOIN dbo.City city ON city.Id = a.CityId
      LEFT JOIN dbo.Province prov ON prov.Id = a.ProvinceId
      LEFT JOIN dbo.Country ctry ON ctry.Id = a.CountryId
      LEFT JOIN dbo.ListingAssociate la ON la.ListingId = l.Id AND la.ListingAssociateTypeId = 1 AND (la.SoftDelete IS NULL OR la.SoftDelete = 0)
      LEFT JOIN dbo.AssociateAdminMarketCenter amc ON amc.AdminsId = la.AssociateId
      LEFT JOIN dbo.MarketCenter mc ON mc.Id = amc.AdminMarketCentersId
      WHERE l.ListingNumber = @listingNumber
    `);

    if (!listingCore.recordset.length) {
      throw new Error(`Source listing ${LISTING_NUMBER} not found`);
    }

    const src = listingCore.recordset[0];
    const azListingId = src.ListingId;
    const initialOnMarketSinceDate = src.ListingDate || todayInJohannesburg();
    console.log(`[2] Source listing found: ${LISTING_NUMBER} (Azure Id ${azListingId})`);

    const [buildingInfoQ, mandateQ, rentalInfoQ, tpiQ, areasQ, areaFeaturesQ, marketingQ, agentsQ, imagesQ, contactsQ, mandateDocsQ] = await Promise.all([
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT bi.*, z.Name AS ZoningType
        FROM dbo.ListingBuildingInfo bi
        LEFT JOIN dbo.ListingBuildingZoningType z ON z.Id = bi.ListingBuildingZoningTypeId
        WHERE bi.ListingId = @id
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT mi.*, mt.Name AS MandateTypeName
        FROM dbo.ListingMandateInfo mi
        LEFT JOIN dbo.ListingMandateType mt ON mt.Id = mi.ListingMandateTypeId
        WHERE mi.ListingId = @id
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT TOP 1 RentalRate, LeasePeriod, DepositRequirements
        FROM dbo.ListingRentalInfo
        WHERE ListingId = @id
        ORDER BY Id DESC
      `),
      az.request().input('id', sql.Int, azListingId).query(`SELECT * FROM dbo.ListingThirdPartyIntegration WHERE ListingId=@id`),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT pa.Id AS AreaId, pat.Name AS AreaType
        FROM dbo.ListingPropertyArea pa
        LEFT JOIN dbo.ListingPropertyAreaType pat ON pat.Id = pa.ListingPropertyAreaTypeId
        WHERE pa.ListingId = @id AND (pa.SoftDelete IS NULL OR pa.SoftDelete = 0)
        ORDER BY pa.Id
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT pa.Id AS AreaId, pf.Name AS FeatureName
        FROM dbo.ListingPropertyArea pa
        LEFT JOIN dbo.ListingPropertyAreaListingPropertyFeature paff ON paff.ListingPropertyAreasId = pa.Id
        LEFT JOIN dbo.ListingPropertyFeature pf ON pf.Id = paff.ListingPropertyFeaturesId
        WHERE pa.ListingId = @id AND (pa.SoftDelete IS NULL OR pa.SoftDelete = 0)
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT mu.Url, mut.Name AS UrlType
        FROM dbo.ListingMarketingUrl mu
        LEFT JOIN dbo.ListingMarketingUrlType mut ON mut.Id = mu.MarketingUrlTypeId
        WHERE mu.ListingId = @id AND (mu.SoftDelete IS NULL OR mu.SoftDelete = 0)
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT la.AssociateId, a.FirstName, a.LastName, lat.Name AS RoleName
        FROM dbo.ListingAssociate la
        LEFT JOIN dbo.Associate a ON a.Id = la.AssociateId
        LEFT JOIN dbo.ListingAssociateType lat ON lat.Id = la.ListingAssociateTypeId
        WHERE la.ListingId = @id AND (la.SoftDelete IS NULL OR la.SoftDelete = 0)
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT li.Id AS ListingImageId, d.Url, d.Name AS FileName
        FROM dbo.ListingImage li
        JOIN dbo.Document d ON d.Id = li.DocumentId
        WHERE li.ListingId = @id AND (li.SoftDelete IS NULL OR li.SoftDelete = 0)
        ORDER BY li.Id
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT c.FirstName, c.LastName, c.Email, c.PhoneNumber
        FROM dbo.ListingContact lc
        JOIN dbo.Contact c ON c.Id = lc.ContactId
        WHERE lc.ListingId = @id AND (lc.SoftDelete IS NULL OR lc.SoftDelete = 0)
      `),
      az.request().input('id', sql.Int, azListingId).query(`
        SELECT
          ld.Id AS ListingDocumentId,
          ldt.Name AS ListingDocumentType,
          d.Name AS FileName,
          d.Url AS Url,
          d.WhenCreated
        FROM dbo.ListingDocument ld
        JOIN dbo.ListingMandateInfo mi ON mi.Id = ld.ListingMandateInfoId
        LEFT JOIN dbo.ListingDocumentType ldt ON ldt.Id = ld.ListingDocumentTypeId
        LEFT JOIN dbo.Document d ON d.Id = ld.DocumentId
        WHERE mi.ListingId = @id
          AND (ld.SoftDelete IS NULL OR ld.SoftDelete = 0)
          AND (d.SoftDelete IS NULL OR d.SoftDelete = 0)
        ORDER BY ld.Id
      `),
    ]);

    const bi = buildingInfoQ.recordset[0] || {};
    const mandate = mandateQ.recordset[0] || {};
    const rentalInfo = rentalInfoQ.recordset[0] || {};
    const tpi = tpiQ.recordset[0] || {};

    const sourceMcId = src.SourceMarketCenterId ? String(src.SourceMarketCenterId) : null;
    let uatMarketCenterId = null;
    if (sourceMcId) {
      const mcQ = await pg.query(
        'SELECT id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1',
        [sourceMcId]
      );
      if (mcQ.rows.length) uatMarketCenterId = mcQ.rows[0].id;
    }

    const sourceMatchQ = await pg.query(
      'SELECT id, on_market_since_date FROM migration.core_listings WHERE source_listing_id = $1 LIMIT 1',
      [String(azListingId)]
    );
    const listingNumberMatchQ = await pg.query(
      'SELECT id, on_market_since_date FROM migration.core_listings WHERE listing_number = $1 LIMIT 1',
      [LISTING_NUMBER]
    );

    const existingRow = sourceMatchQ.rows[0] || listingNumberMatchQ.rows[0] || null;

    if (sourceMatchQ.rows[0] && listingNumberMatchQ.rows[0] && sourceMatchQ.rows[0].id !== listingNumberMatchQ.rows[0].id) {
      console.warn(
        `[3] Listing conflict detected for ${LISTING_NUMBER}: source-id row ${sourceMatchQ.rows[0].id} differs from listing-number row ${listingNumberMatchQ.rows[0].id}. Using source-id match.`
      );
    }

    let uatListingId;
    if (existingRow) {
      uatListingId = existingRow.id;
      console.log(`[3] Existing UAT listing found: id=${uatListingId}`);
    } else {
      const ins = await pg.query(
        `INSERT INTO migration.core_listings (
           source_listing_id, source_market_center_id, market_center_id, listing_number, status_name, sale_or_rent,
           street_number, street_name, suburb, city, province, country, price, expiry_date,
           property_title, short_title, property_description, on_market_since_date, listing_payload, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,NOW(),NOW())
         RETURNING id`,
        [
          String(azListingId),
          sourceMcId,
          uatMarketCenterId,
          LISTING_NUMBER,
          src.StatusName || 'Active',
          src.SaleOrRent || 'For Sale',
          src.StreetNumber || null,
          src.StreetName || null,
          src.Suburb || null,
          src.City || null,
          src.Province || null,
          src.Country || 'South Africa',
          src.Price != null ? String(src.Price) : null,
          src.ExpiryDate || null,
          src.PropertyTitle || null,
          src.ShortTitle || null,
          src.PropertyDescription || null,
          initialOnMarketSinceDate,
          JSON.stringify({ source: 'one-pass-test', listing_number: LISTING_NUMBER }),
        ]
      );
      uatListingId = ins.rows[0].id;
      console.log(`[3] Inserted new UAT listing: id=${uatListingId}`);
    }

    const existingOnMarketSinceDate = existingRow?.on_market_since_date || null;
    const resolvedOnMarketSinceDate = src.ListingDate || existingOnMarketSinceDate || todayInJohannesburg();

    const areaCounts = {};
    for (const a of areasQ.recordset) {
      const key = String(a.AreaType || '').trim();
      if (!key) continue;
      areaCounts[key] = (areaCounts[key] || 0) + 1;
    }

    const buildingAreaFeaturesQ = await az.request().input('id', sql.Int, azListingId).query(`
      SELECT DISTINCT baf.Name AS FeatureName
      FROM dbo.ListingBuildingInfo bi
      JOIN dbo.ListingBuildingInfoAreaFeature ibaf
        ON ibaf.ListingBuildingInfoId = bi.Id
       AND (ibaf.SoftDelete IS NULL OR ibaf.SoftDelete = 0)
      JOIN dbo.ListingBuildingAreaFeature baf ON baf.Id = ibaf.ListingBuildingAreaFeatureId
      WHERE bi.ListingId = @id
    `);

    const allFeatureCandidates = [];
    for (const r of buildingAreaFeaturesQ.recordset) allFeatureCandidates.push(r.FeatureName);

    for (const r of areaFeaturesQ.recordset) {
      if (r.FeatureName) allFeatureCandidates.push(r.FeatureName);
    }

    const descriptivePieces = String(src.ShortDescription || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    allFeatureCandidates.push(...descriptivePieces);

    const uniqueFeatureCandidates = uniqText(allFeatureCandidates);
    const classifiedFeatures = [];
    for (const v of uniqueFeatureCandidates) {
      const category = classifyFeature(v);
      if (category) classifiedFeatures.push({ feature_category: category, feature_value: v });
    }

    const propertyDescFromOtherArea = [];
    const areaById = new Map();
    for (const a of areasQ.recordset) areaById.set(a.AreaId, a);
    for (const f of areaFeaturesQ.recordset) {
      const a = areaById.get(f.AreaId);
      const areaType = String(a?.AreaType || '').trim().toLowerCase();
      if (areaType === 'other' && f.FeatureName) {
        propertyDescFromOtherArea.push(f.FeatureName);
      }
    }

    const extraPropertyDesc = uniqText(propertyDescFromOtherArea)
      .filter((v) => PROPERTY_DESCRIPTIVE_OPTIONS.has(v))
      .map((v) => ({ feature_category: 'Property Descriptive', feature_value: v }));
    const extraLifestyle = uniqText(propertyDescFromOtherArea)
      .filter((v) => LIFESTYLE_OPTIONS.has(v))
      .map((v) => ({ feature_category: 'Lifestyle', feature_value: v }));

    const mergedFeatures = uniqText(
      [...classifiedFeatures, ...extraPropertyDesc, ...extraLifestyle].map((x) => `${x.feature_category}|${x.feature_value}`)
    ).map((entry) => {
      const [feature_category, feature_value] = entry.split('|');
      return { feature_category, feature_value };
    });

    const descriptiveFeatureValue =
      mergedFeatures.find((f) => String(f.feature_category).toLowerCase() === 'property descriptive')?.feature_value ?? null;

    await pg.query('BEGIN');

    await pg.query(
      `UPDATE migration.core_listings SET
         source_listing_id=$1,
         source_market_center_id=$2,
         market_center_id=$3,
         status_name=$4,
         sale_or_rent=$5,
         listing_status_tag=$6,
         ownership_type=$7,
         property_type=$8,
         property_sub_type=$9,
         street_number=$10,
         street_name=$11,
         suburb=$12,
         city=$13,
         province=$14,
         country=$15,
         price=$16,
         expiry_date=$17,
         property_title=$18,
         short_title=$19,
         property_description=$20,
         short_description=$21,
         descriptive_feature=$22,
         address_line=$23,
         erf_number=$24,
         unit_number=$25,
         door_number=$26,
         estate_name=$27,
         postal_code=$28,
         latitude=$29,
         longitude=$30,
         override_display_location=$31,
         override_display_latitude=$32,
         override_display_longitude=$33,
         poa=$34,
         no_transfer_duty=$35,
         occupation_date=$36,
         mandate_type=$37,
         signed_date=$38,
         on_market_since_date=$39,
         rates_and_taxes=$40,
         monthly_levy=$41,
         zoning_type=$42,
         erf_size=$43,
         floor_area=$44,
         is_furnished=$45,
         pet_friendly=$46,
         has_standalone_building=$47,
         has_flatlet=$48,
         has_backup_water=$49,
         wheelchair_accessible=$50,
         has_generator=$51,
         has_borehole=$52,
         has_gas_geyser=$53,
         has_solar_panels=$54,
         has_backup_battery_or_inverter=$55,
         has_solar_geyser=$56,
         has_water_tank=$57,
         adsl=$58,
         fibre=$59,
         isdn=$60,
         dialup=$61,
         fixed_wimax=$62,
         satellite=$63,
         nearby_bus_service=$64,
         nearby_minibus_taxi_service=$65,
         nearby_train_service=$66,
         feed_to_property24=$67,
         property24_ref1=$68,
         property24_ref2=$69,
         property24_sync_status=$70,
         feed_to_kww=$71,
         kww_property_reference=$72,
         kww_ref1=$73,
         kww_ref2=$74,
         kww_sync_status=$75,
         feed_to_private_property=$76,
         private_property_ref1=$77,
         private_property_ref2=$78,
         private_property_sync_status=$79,
         feed_to_entegral=$80,
         entegral_sync_status=$81,
         bedrooms=$82,
         bathrooms=$83,
         garages=$84,
         parking=$85,
         is_published=$86,
         is_draft=$87,
         rental_rate=$88,
         lease_period=$89,
         deposit_requirements=$90,
         updated_at=NOW()
       WHERE id=$91`,
      [
        String(azListingId),
        sourceMcId,
        uatMarketCenterId,
        src.StatusName || null,
        src.SaleOrRent || null,
        src.StatusTag || null,
        src.OwnershipType || null,
        src.PropertyType || null,
        src.PropertySubType || null,
        src.StreetNumber || null,
        src.StreetName || null,
        src.Suburb || null,
        src.City || null,
        src.Province || null,
        src.Country || 'South Africa',
        src.Price != null ? String(src.Price) : null,
        src.ExpiryDate || null,
        src.PropertyTitle || null,
        src.ShortTitle || null,
        src.PropertyDescription || null,
        src.ShortDescription || null,
        descriptiveFeatureValue,
        [src.StreetNumber, src.StreetName, src.Suburb, src.City].filter(Boolean).join(' ') || null,
        src.ErfNumber || null,
        src.UnitNumber || null,
        src.DoorNumber || null,
        src.EstateName || null,
        src.PostalCode || null,
        normalizeCoordinate(src.Latitude, 'lat'),
        normalizeCoordinate(src.Longitude, 'lon'),
        bool(src.OverrideDisplayLocation),
        normalizeCoordinate(src.OverrideDisplayLatitude, 'lat'),
        normalizeCoordinate(src.OverrideDisplayLongitude, 'lon'),
        bool(src.POA),
        src.NoTransferDuty != null ? bool(src.NoTransferDuty) : true,
        src.OccupationDate || null,
        mandate.MandateTypeName || null,
        mandate.SignedDate || null,
        resolvedOnMarketSinceDate,
        mandate.RatesTaxes != null ? String(mandate.RatesTaxes) : null,
        mandate.MonthlyLevy != null ? String(mandate.MonthlyLevy) : null,
        bi.ZoningType || null,
        bi.ErfSize != null ? String(bi.ErfSize) : null,
        bi.FloorArea != null ? String(bi.FloorArea) : null,
        bool(bi.FurnishedProperty),
        bool(bi.PetFriendly),
        bool(bi.HasStandaloneBuilding),
        bool(bi.HasFlatlet),
        bool(bi.HasBackupWater),
        bool(bi.WheelChairAccessible),
        bool(bi.HasGenerator),
        bool(bi.Borehole),
        bool(bi.GasGeyser),
        bool(bi.SolarPanels),
        bool(bi.BackupBatteryOrInverter),
        bool(bi.SolarGeyser),
        bool(bi.WaterTank),
        bool(bi.ADSL),
        bool(bi.Fibre),
        bool(bi.ISDN),
        bool(bi.DialUp),
        bool(bi.FixedWimax),
        bool(bi.Satellite),
        bool(bi.BusService),
        bool(bi.MinibusTaxiService),
        bool(bi.TrainService),
        bool(tpi.FeedToProperty24),
        tpi.Property24Reference ? String(tpi.Property24Reference) : null,
        tpi.P24Reference2 ? String(tpi.P24Reference2) : null,
        tpi.P24SyncMessage || null,
        bool(tpi.FeedToKWW),
        tpi.KwwPropertyReference || null,
        tpi.KwwRef1 || null,
        tpi.KwwRef2 || null,
        tpi.KwwSyncMessage || null,
        bool(tpi.FeedToPrivateProperty),
        tpi.PrivatePropertyReference || null,
        tpi.PrivatePropertyRef2 || null,
        tpi.PrivatePropertySyncMessage || null,
        bool(tpi.FeedToEntegral),
        tpi.EntegralSyncMessage || null,
        areaCounts.Bedroom || null,
        areaCounts.Bathroom || null,
        areaCounts.Garage || null,
        areaCounts.Parking || null,
        bool(tpi.DisplayOnWebsite),
        false,
        normalizeRentalRate(rentalInfo.RentalRate),
        rentalInfo.LeasePeriod ? String(rentalInfo.LeasePeriod) : null,
        rentalInfo.DepositRequirements ? String(rentalInfo.DepositRequirements) : null,
        uatListingId,
      ]
    );

    await pg.query('DELETE FROM migration.listing_agents WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_images WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_features WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_property_areas WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_marketing_urls WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_contacts WHERE listing_id=$1', [uatListingId]);
    await pg.query('DELETE FROM migration.listing_mandate_documents WHERE listing_id=$1', [uatListingId]);

    for (let i = 0; i < agentsQ.recordset.length; i++) {
      const a = agentsQ.recordset[i];
      const fullName = `${String(a.FirstName || '').trim()} ${String(a.LastName || '').trim()}`.trim();
      let associateId = null;
      if (a.AssociateId != null) {
        const mapQ = await pg.query(
          'SELECT id FROM migration.core_associates WHERE source_associate_id=$1 LIMIT 1',
          [String(a.AssociateId)]
        );
        if (mapQ.rows.length) associateId = mapQ.rows[0].id;
      }

      await pg.query(
        `INSERT INTO migration.listing_agents (
           listing_id, associate_id, agent_name, agent_role, is_primary, market_center_id, sort_order, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
        [
          uatListingId,
          associateId,
          fullName || null,
          a.RoleName || 'Agent',
          i === 0,
          uatMarketCenterId,
          i,
        ]
      );
    }

    const seenImageUrls = new Set();
    let imageInsertIdx = 0;
    for (let i = 0; i < imagesQ.recordset.length; i++) {
      const img = imagesQ.recordset[i];
      const url = String(img.Url || '').trim();
      const fileName = String(img.FileName || '').trim() || null;
      if (!url && !fileName) continue;
      // Skip duplicate URLs to avoid unique constraint violations
      if (url && seenImageUrls.has(url)) continue;
      if (url) seenImageUrls.add(url);
      
      await pg.query(
        `INSERT INTO migration.listing_images (
           listing_id, file_name, file_url, media_type, sort_order, uploaded_by, uploaded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [uatListingId, fileName, url || null, 'image', imageInsertIdx++, null]
      );
    }

    const featureRows = mergedFeatures.map((f, idx) => ({ ...f, sort_order: idx }));
    for (const f of featureRows) {
      await pg.query(
        'INSERT INTO migration.listing_features (listing_id, feature_category, feature_value, sort_order) VALUES ($1,$2,$3,$4)',
        [uatListingId, f.feature_category, f.feature_value, f.sort_order]
      );
    }

    const areaFeatureMap = new Map();
    for (const row of areaFeaturesQ.recordset) {
      if (!areaFeatureMap.has(row.AreaId)) areaFeatureMap.set(row.AreaId, []);
      if (row.FeatureName) areaFeatureMap.get(row.AreaId).push(String(row.FeatureName).trim());
    }

    for (let i = 0; i < areasQ.recordset.length; i++) {
      const a = areasQ.recordset[i];
      const sf = uniqText(areaFeatureMap.get(a.AreaId) || []);
      await pg.query(
        `INSERT INTO migration.listing_property_areas (
           listing_id, area_type, count, size, description, sub_features, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          uatListingId,
          a.AreaType || null,
          1,
          null,
          null,
          JSON.stringify(sf),
          i,
        ]
      );
    }

    for (let i = 0; i < marketingQ.recordset.length; i++) {
      const u = marketingQ.recordset[i];
      const url = String(u.Url || '').trim();
      if (!url) continue;
      await pg.query(
        `INSERT INTO migration.listing_marketing_urls (listing_id, url, url_type, display_name, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [uatListingId, url, u.UrlType || null, null, i]
      );
    }

    for (let i = 0; i < contactsQ.recordset.length; i++) {
      const c = contactsQ.recordset[i];
      const fullName = `${String(c.FirstName || '').trim()} ${String(c.LastName || '').trim()}`.trim();
      await pg.query(
        `INSERT INTO migration.listing_contacts (listing_id, full_name, phone_number, email_address, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [uatListingId, fullName || null, c.PhoneNumber || null, c.Email || null, i]
      );
    }

    for (let i = 0; i < mandateDocsQ.recordset.length; i++) {
      const d = mandateDocsQ.recordset[i];
      const fileUrl = String(d.Url || '').trim();
      if (!fileUrl) continue;
      await pg.query(
        `INSERT INTO migration.listing_mandate_documents (
           listing_id, file_name, file_url, file_type, uploaded_by, sort_order, uploaded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, NOW()))`,
        [
          uatListingId,
          d.FileName || null,
          fileUrl,
          d.ListingDocumentType || null,
          null,
          i,
          d.WhenCreated || null,
        ]
      );
    }

    await pg.query('COMMIT');

    const auditQ = await pg.query(
      `SELECT
         (SELECT COUNT(*) FROM migration.listing_agents WHERE listing_id=$1)::int AS agents_count,
         (SELECT COUNT(*) FROM migration.listing_images WHERE listing_id=$1)::int AS images_count,
         (SELECT COUNT(*) FROM migration.listing_property_areas WHERE listing_id=$1)::int AS areas_count,
         (SELECT COUNT(*) FROM migration.listing_marketing_urls WHERE listing_id=$1)::int AS marketing_urls_count,
         (SELECT COUNT(*) FROM migration.listing_mandate_documents WHERE listing_id=$1)::int AS mandate_docs_count,
         (SELECT COUNT(*) FROM migration.listing_contacts WHERE listing_id=$1)::int AS contacts_count,
         (SELECT COUNT(*) FROM migration.listing_features WHERE listing_id=$1)::int AS features_count,
         (SELECT COUNT(*) FROM migration.listing_features WHERE listing_id=$1 AND lower(trim(feature_category))='lifestyle')::int AS lifestyle_count,
         (SELECT COUNT(*) FROM migration.listing_features WHERE listing_id=$1 AND lower(trim(feature_category))='property descriptive')::int AS property_descriptive_count,
         (SELECT COUNT(*) FROM migration.listing_features WHERE listing_id=$1 AND lower(trim(feature_category)) IN ('style','facing','roof','walls','windows'))::int AS building_features_count`,
      [uatListingId]
    );

    const coreVerify = await pg.query(
      `SELECT listing_number, source_listing_id, status_name, sale_or_rent, listing_status_tag, ownership_type,
              property_type, property_sub_type, short_description, mandate_type, zoning_type,
              bedrooms, bathrooms, garages, parking, price, is_published,
              feed_to_property24, feed_to_kww, feed_to_private_property
       FROM migration.core_listings WHERE id=$1`,
      [uatListingId]
    );

    console.log('\n=== ONE-PASS RESULT ===');
    console.log('Listing:', coreVerify.rows[0].listing_number, '| UAT id:', uatListingId, '| Source id:', coreVerify.rows[0].source_listing_id);
    console.log('Core:', coreVerify.rows[0]);
    console.log('Audit:', auditQ.rows[0]);

    const a = auditQ.rows[0];
    const gaps = [];
    if (a.areas_count === 0) gaps.push('property_areas');
    if (a.images_count === 0) gaps.push('images');
    if (a.agents_count === 0) gaps.push('agents');
    if (a.contacts_count === 0) gaps.push('contacts');
    if (a.marketing_urls_count === 0) gaps.push('marketing_urls');

    if (gaps.length) {
      console.log('GAPS:', gaps.join(', '));
    } else {
      console.log('GAPS: none in mandatory sections');
    }

    console.log('Feature coverage:', {
      building_features_count: a.building_features_count,
      property_descriptive_count: a.property_descriptive_count,
      lifestyle_count: a.lifestyle_count,
      total_features_count: a.features_count,
    });

    console.log('Done.');
  } catch (err) {
    try {
      if (pg) await pg.query('ROLLBACK');
    } catch (_) {
      // ignore rollback errors
    }
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  } finally {
    try { if (az) await az.close(); } catch (_) {}
    try { if (pg) await pg.end(); } catch (_) {}
  }
})();