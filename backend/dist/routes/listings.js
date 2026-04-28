import { Router } from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOptionalPgPool } from '../config/db.js';
import { assertLocalUploadStorageEnabled, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
const router = Router();
const pool = getOptionalPgPool();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/[, ]/g, '').trim();
        if (!normalized)
            return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function toBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (value === 1 || value === '1' || value === 'true' || value === 'yes')
        return true;
    return false;
}
function toDateValue(value) {
    const text = toText(value);
    if (!text)
        return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString().slice(0, 10);
}
function parseImageUrls(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => /^https?:\/\//i.test(entry) || entry.startsWith('/uploads/'));
    }
    if (typeof value === 'string') {
        const cleaned = value.replace(/[\[\]"]/g, ' ').replace(/\r?\n/g, '|').trim();
        if (!cleaned)
            return [];
        return cleaned
            .split(/\s*[|;,]\s*/)
            .map((e) => e.trim())
            .filter((e) => /^https?:\/\//i.test(e) || e.startsWith('/uploads/'));
    }
    return [];
}
function parseTextArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => entry.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return [];
}
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function extensionFromMimeType(mimeType) {
    if (!mimeType)
        return '.jpg';
    const n = mimeType.toLowerCase();
    if (n.includes('png'))
        return '.png';
    if (n.includes('webp'))
        return '.webp';
    if (n.includes('gif'))
        return '.gif';
    return '.jpg';
}
function decodeBase64Image(input) {
    if (!input)
        return null;
    const cleaned = input.includes(',') ? input.split(',').slice(1).join(',') : input;
    try {
        const buffer = Buffer.from(cleaned, 'base64');
        return buffer.length > 0 ? buffer : null;
    }
    catch {
        return null;
    }
}
async function storeUploadedFiles(files, subdir = 'listings') {
    assertLocalUploadStorageEnabled();
    const uploadDir = resolveLocalUploadDir(subdir);
    await mkdir(uploadDir, { recursive: true });
    const urls = [];
    for (const file of files) {
        const content = decodeBase64Image(file.contentBase64);
        if (!content)
            continue;
        const originalName = file.name ? sanitizeFileName(file.name) : 'file';
        const ext = path.extname(originalName) || extensionFromMimeType(file.mimeType);
        const base = path.basename(originalName, path.extname(originalName)) || 'file';
        const unique = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        await writeFile(path.join(uploadDir, unique), content);
        urls.push(`/uploads/${subdir}/${unique}`);
    }
    return urls;
}
async function generateNextListingNumber() {
    if (!pool)
        return 'KWLM9000';
    const result = await pool.query(`SELECT MAX(CAST(SUBSTRING(listing_number FROM 5) AS INTEGER))::text AS max_num
     FROM migration.core_listings
     WHERE listing_number ~ '^KWLM[0-9]+$'`);
    const current = Number(result.rows[0]?.max_num ?? 0);
    const next = Math.max(current + 1, 9000);
    return `KWLM${next}`;
}
// ---------------------------------------------------------------------------
// Reference Data
// ---------------------------------------------------------------------------
router.get('/options', async (_req, res) => {
    const base = {
        listing_statuses: ['Active', 'Inactive', 'Draft'],
        listing_status_tags: ['For Sale', 'To Rent', 'Reduced', 'Under Offer', 'Sold', 'Withdrawn', 'Expired', 'Pending Approval', 'Approval Declined'],
        ownership_types: ['Full Title', 'Sectional Title', 'Fractional', 'Leasehold', 'Share Block', 'Time Share'],
        sale_or_rent_types: ['For Sale', 'Procurement Rental', 'Management Rental'],
        property_types: ['Residential', 'Commercial', 'Industrial', 'Business', 'Farm'],
        property_sub_types: {
            Residential: ['House', 'TownHouse', 'Flat/Apartment', 'Cluster', 'Vacant Land', 'Luxury Home'],
            Commercial: ['Commercial'],
            Industrial: ['Industrial'],
            Business: ['Business'],
            Farm: ['Farm'],
        },
        mandate_types: ['Sole Mandate', 'Open Mandate', 'Dual Mandate', 'Multi Listing', 'Sole and Exclusive Mandate', 'No Mandate'],
        zoning_types: ['Single Residential', 'General Residential', 'Local Business', 'General Business', 'General Industrial', 'Heavy Industrial', 'Agriculture', 'Rural', 'Mixed Use'],
        marketing_url_types: ['YouTube', 'MatterPort', 'EyeSpy360', 'Virtual Tours'],
        agent_roles: ['Primary', 'Secondary', 'Third', 'Fourth', 'Referral'],
        facing_options: ['Above Road', 'Below Road', 'East', 'Green Belt', 'Level Road', 'Mountain View', 'North', 'Sea', 'South', 'Street Front', 'Water', 'West'],
        roof_options: ['A-frame', 'Aluminium', 'Asbestos', 'Brown Built', 'Concrete', 'Fibreglass', 'Flat Roof', 'Glass Dome', 'Insulation', 'Iron', 'Shingles', 'Slate', 'Thatch', 'Tile', 'Waterproofing', 'Zinc'],
        style_options: ['A-frame', 'Architect-designed', 'Balinese', 'Cape Dutch', 'Classical', 'Colonial', 'Contemporary', 'Conventional', 'Cottage', 'Mediterranean', 'Modern', 'Open Plan', 'Provencal', 'Spanish', 'Split Level', 'Traditional', 'Tuscan', 'Ultra Modern', 'Victorian'],
        walls_options: ['Asbestos', 'Brick', 'Concrete', 'Face Brick', 'Glass', 'Iron', 'Plaster', 'Stone', 'Wood'],
        windows_options: ['Aluminium', 'Bay', 'Cottage', 'Dormer', 'Double Glazed', 'Lead', 'Picture', 'Sash', 'Skylight', 'Stained', 'Steel', 'Wood'],
        lifestyle_options: [
            'Aquatic Activities', 'Casino Estate', 'Coastal/Beach', 'Complex', 'Country Club', 'Country Living',
            'Cul-de-sac', 'Dual Living', 'Eco Estate', 'Equestrian/Polo Estate', 'Estate', 'Fishing Estate',
            'Game/Stock Farm', 'Gated Community', 'Golf Estate', 'Holiday Home', 'Holiday Resort', 'Island Estate',
            'Lakefront', 'Lifestyle Farm', 'Marina', 'Metropolitan', 'Mountain', 'Nature Reserve', 'Retirement Living',
            'River frontage', 'Security Complex', 'Security Estate', 'Shared Living', 'Smallholding', 'Student Accommodation',
            'Suburban', 'University/College Community', 'Waterfront', 'Wellness estate', 'Wildlife Estate', 'Winelands',
        ],
        property_feature_options: [],
        property_descriptives: {
            House: ['Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Dual Living', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse', 'Multi Storey', 'Semi Detached', 'Simplex', 'Single Storey', 'Smallholding', 'Townhouse', 'Villa'],
            Townhouse: ['Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse', 'Multi Storey', 'New Development', 'Semi Detached', 'Simplex', 'Single Storey', 'Villa'],
            Apartment: ['Bachelor/Studio', 'Duplex', 'First Floor', 'Garden Flat', 'Ground Floor', 'Loft/Warehouse', 'New Development', 'Penthouse', 'Second floor and above', 'Simplex', 'Stacked Simplex', 'Third Floor', 'Top Floor'],
            Farm: ['Aquaculture', 'Cash Crops', 'Dairy Farm', 'Flower Farm', 'Fruit Farm', 'Game Farm', 'Irrigation Farm', 'Live Stock Farm', 'Nature Reserve', 'New Development', 'Smallholding', 'Stud Farm', 'Vegetable Farm', 'Wine Farm'],
            'Vacant Land': ['Farming', 'New Development', 'Residential', 'Smallholding'],
            Commercial: ['Distribution Centre', 'Factory', 'Guesthouse', 'Hotel', 'New Development', 'Office', 'Retail', 'Smallholding', 'Storage', 'Warehouse', 'Yard'],
            Industrial: ['Distribution Centre', 'Factory', 'New Development', 'Office', 'Smallholding', 'Storage', 'Warehouse', 'Yard'],
        },
        property_area_types: ['Bedroom', 'Bathroom', 'Bar', 'Closet', 'Dining Room', 'Family TV Room', 'Garage', 'Garden', 'Kitchen', 'Lounge', 'Loft', 'Office', 'Outbuilding', 'Pool', 'Entrance Hall', 'Parking', 'Security', 'Sewing Room', 'Special Feature', 'Temperature Control', 'Utility Room', 'Braai Room', 'Other'],
        average_price_options: ['Below Market Value', 'At Market Value', 'Above Market Value'],
        property_area_sub_features: {
            Bedroom: ['Air Conditioner', 'Balcony', 'Blinds', 'Built-in Cupboards', 'Carpets', 'Curtain Rails', 'Double Bedroom', 'Fan', 'Fireplace', 'Half Bedroom', 'Internet Port', 'King Bedroom', 'Laminated Floors', 'Main en Suite', 'Open Plan', 'Parquet Floors', 'Queen Bedroom', 'Single Bedroom', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Walk-in-closet', 'Wooden Floors'],
            Bathroom: ['Basin', 'Bath', 'Bath, Toilet and Basin', 'Bidet', 'Common Toilet', 'Communal Bathrooms', 'Domestic Bathroom', 'Double Basin', 'En suite', 'Executive Bathrooms', 'Full', 'Guest Toilet', 'Half Bathroom', 'In Unit Bathrooms', 'Jacuzzi Bath', 'Main en Suite', 'Outside Toilets', 'Separate Toilet', 'Shower', 'Shower, Toilet and Basin', 'Toilet', 'Unisex Bathrooms', 'Urinal'],
            Bar: ['Bar Counter', 'Built In Bar', 'Cellar', 'Projector'],
            Closet: ['Built-in Cupboards', 'Walk-in-closet'],
            'Dining Room': ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
            'Family TV Room': ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
            Garage: ['Carport', 'Double', 'Electric Door', 'Hollywood Garage', 'Roll up', 'Single', 'Tandem', 'Tip up', 'Triple Parking', 'Workshop'],
            Garden: ['Communal braai area', 'Courtyard', 'Covered', 'Exposed', 'Garden Services', 'Immaculate Condition', 'Irrigation system', 'Landscaped', 'Lighting', 'Patio', 'Sculpture', 'Sprinkler System', 'Water Feature', 'Zen Garden'],
            Kitchen: ['Breakfast Nook', 'Centre Island', 'Coffee Machine', 'Dishwasher Connection', 'Extractor Fan', 'Eye Level Oven', 'Fridge', 'Garbage Disposal', 'Gas Hob', 'Gas Oven', 'Granite Tops', 'Grill', 'Hob', 'Icemaker', 'Laundry', 'Open Plan', 'Oven & Hob', 'Pantry', 'Pizza Oven', 'Scullery', 'Sink', 'Under Counter Oven', 'Washing Machine Connection'],
            Lounge: ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
            Loft: ['A-frame', 'Ladder', 'Open Plan', 'Skylight', 'Spacious', 'Staircase'],
            Office: ['Air Conditioner', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
            Outbuilding: ['Bath, Toilet and Basin', 'Boathouse', 'Change Rooms', 'Clubhouse', 'Cellar', 'Cottage', 'Domestic Bathroom', 'Flatlet', 'Gazebo', 'Granny flat', 'Greenhouse', 'Lapa', 'Office', 'Pool Shed', 'School', 'Second House', 'Septic Tank', 'Shed', 'Shower, Toilet and Basin', 'Squash Court', 'Stables', 'Staff Quarters/Domestic Rooms', 'Storeroom', 'Studio', 'Teenpad', 'Toilet', 'Wendy House', 'Workshop'],
            Pool: ['Auto Cleaning Equipment', 'Chlorinator', 'Communal Pool', 'Fenced', 'Fibreglass in Ground', 'Gunite in Ground', 'Heated', 'Portapool', 'Rock Pool', 'Safety Net', 'Splash Pool'],
            'Entrance Hall': ['Fireplace', 'Spacious', 'Staircase'],
            Parking: ['Carport', 'Communal', 'Double Parking', 'On Street Parking', 'Secure Parking', 'Shade Net Covered', 'Single Parking', 'Tandem Parking', 'Triple Parking', 'Underground Parking', 'Visitors Parking'],
            Security: ['24 Hour Access', '24 Hour Response', 'Alarm System', 'Boomed Area', 'Burglar Bars', 'Closed Circuit TV', 'Electric Gate', 'Electric fencing', 'Guard', 'Guard House', 'Intercom', 'Security Gate'],
            'Sewing Room': ['Built-in Cupboards'],
            'Special Feature': ['Atrium', 'Balcony', 'Boat Launch', 'BoatLaunch', 'Central Vacuum System', 'Country Style', 'Driveway', 'Indoor Beams', 'Irrigation system', 'Jacuzzi', 'Jetty', 'Linen Room', 'Outdoor Beams', 'Paveway', 'Perimeter Wall', 'Piped Gas', 'Recreation Room', 'Safe', 'Sauna', 'Sliding Doors', 'Spa Pool', 'Special Doors', 'Special Lights', 'Strong Room', 'Subdivision Rights', 'Tennis Court', 'Totally Walled', 'Tumble Dryer', 'TV Antenna', 'Veranda', 'Water Cooler', 'Satellite Dish'],
            'Temperature Control': ['Air Conditioning Unit', 'Anthracite', 'Cooling Fans', 'Fireplace', 'Oil', 'Solar Heating', 'Under Floor Heating'],
            'Utility Room': ['Laundry', 'Tumble Dryer', 'Washing Machine Connection'],
            'Braai Room': ['Built-in Braai', 'Communal braai area'],
            Other: [],
        },
        commercial_industrial_options: {
            building_grade_options: ['A', 'B', 'C', 'P'],
            lease_type_options: ['Gross', 'Net', 'Triple Net'],
            truck_access_options: ['Superlink', 'Interlink', 'Rigid', 'Limited Access'],
            power_availability_options: ['Single Phase', 'Three Phase', 'Generator Ready'],
        },
    };
    if (!pool) {
        return res.json({
            ...base,
            provinces: [],
            cities: [],
            suburbs: [],
            city_by_province: {},
            suburb_by_city: {},
            suburb_by_province: {},
        });
    }
    try {
        const combinations = await pool.query(`SELECT DISTINCT
        NULLIF(TRIM(province), '') AS province,
        NULLIF(TRIM(city), '') AS city,
        NULLIF(TRIM(suburb), '') AS suburb
       FROM migration.core_listings`);
        const provinces = new Set();
        const cities = new Set();
        const suburbs = new Set();
        const cityByProvince = {};
        const suburbByCity = {};
        const suburbByProvince = {};
        for (const row of combinations.rows) {
            const province = row.province ?? '';
            const city = row.city ?? '';
            const suburb = row.suburb ?? '';
            if (province)
                provinces.add(province);
            if (city)
                cities.add(city);
            if (suburb)
                suburbs.add(suburb);
            if (province && city) {
                cityByProvince[province] ?? (cityByProvince[province] = new Set());
                cityByProvince[province].add(city);
            }
            if (city && suburb) {
                suburbByCity[city] ?? (suburbByCity[city] = new Set());
                suburbByCity[city].add(suburb);
            }
            if (province && suburb) {
                suburbByProvince[province] ?? (suburbByProvince[province] = new Set());
                suburbByProvince[province].add(suburb);
            }
        }
        const normalizeMap = (input) => {
            const result = {};
            for (const key of Object.keys(input)) {
                result[key] = [...input[key]].sort((a, b) => a.localeCompare(b));
            }
            return result;
        };
        return res.json({
            ...base,
            provinces: [...provinces].sort((a, b) => a.localeCompare(b)),
            cities: [...cities].sort((a, b) => a.localeCompare(b)),
            suburbs: [...suburbs].sort((a, b) => a.localeCompare(b)),
            city_by_province: normalizeMap(cityByProvince),
            suburb_by_city: normalizeMap(suburbByCity),
            suburb_by_province: normalizeMap(suburbByProvince),
        });
    }
    catch {
        return res.json({
            ...base,
            provinces: [],
            cities: [],
            suburbs: [],
            city_by_province: {},
            suburb_by_city: {},
            suburb_by_province: {},
        });
    }
});
// ---------------------------------------------------------------------------
// Quick search endpoint for transaction listing selector
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const q = String(req.query.q ?? '').trim();
    if (!q)
        return res.json({ items: [] });
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_listings') AS exists`);
        if (!exists.rows[0]?.exists)
            return res.json({ items: [] });
        const result = await pool.query(`SELECT
         cl.id,
         cl.source_listing_id,
         cl.listing_number,
         COALESCE(cl.address_line, TRIM(CONCAT_WS(' ', cl.street_number, cl.street_name))) AS address,
         cl.suburb,
         cl.city,
         cl.price AS list_price
       FROM migration.core_listings cl
       WHERE (
         cl.listing_number ILIKE $1
         OR cl.source_listing_id ILIKE $1
         OR COALESCE(cl.address_line, '') ILIKE $1
         OR COALESCE(cl.street_name, '') ILIKE $1
         OR COALESCE(cl.suburb, '') ILIKE $1
         OR cl.property_title ILIKE $1
       )
       ORDER BY cl.listing_number
       LIMIT 20`, [`%${q}%`]);
        return res.json({ items: result.rows });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Generate listing number
// ---------------------------------------------------------------------------
router.get('/next-number', async (_req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        const number = await generateNextListingNumber();
        return res.json({ listing_number: number });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// List listings
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const searchInput = String(req.query.search ?? '').trim();
    const statusInput = String(req.query.status ?? '').trim();
    const saleOrRentInput = String(req.query.saleOrRent ?? req.query.sale_or_rent ?? '').trim();
    const propertyTypeInput = String(req.query.propertyType ?? req.query.property_type ?? '').trim();
    const minPriceInput = String(req.query.minPrice ?? req.query.min_price ?? '').trim();
    const maxPriceInput = String(req.query.maxPrice ?? req.query.max_price ?? '').trim();
    const minBedroomsInput = Number(req.query.minBedrooms ?? req.query.min_bedrooms ?? 0);
    const minBathroomsInput = Number(req.query.minBathrooms ?? req.query.min_bathrooms ?? 0);
    const flag = (value) => {
        const v = String(value ?? '').trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
    };
    const petFriendlyInput = flag(req.query.petFriendly ?? req.query.pet_friendly);
    const poolInput = flag(req.query.pool);
    const gardenInput = flag(req.query.garden);
    const flatletInput = flag(req.query.flatlet);
    const retirementInput = flag(req.query.retirement);
    const onShowInput = flag(req.query.onShow ?? req.query.on_show);
    const auctionInput = flag(req.query.auction);
    const securityEstateInput = flag(req.query.securityEstate ?? req.query.security_estate);
    const repossessedInput = flag(req.query.repossessed);
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_listings') AS exists`);
        if (!exists.rows[0]?.exists)
            return res.json({ total: 0, limit, offset, items: [] });
        const whereClauses = [];
        const params = [];
        if (searchInput) {
            params.push(`%${searchInput}%`);
            const p = `$${params.length}`;
            whereClauses.push(`(
        cl.listing_number ILIKE ${p}
        OR cl.source_listing_id ILIKE ${p}
        OR cl.address_line ILIKE ${p}
        OR cl.street_number ILIKE ${p}
        OR cl.street_name ILIKE ${p}
        OR cl.suburb ILIKE ${p}
        OR cl.city ILIKE ${p}
        OR cl.status_name ILIKE ${p}
        OR cl.listing_status_tag ILIKE ${p}
        OR cl.sale_or_rent ILIKE ${p}
        OR cl.property_title ILIKE ${p}
        OR cl.short_title ILIKE ${p}
        OR cl.property24_ref1 ILIKE ${p}
        OR cl.private_property_ref1 ILIKE ${p}
        OR cl.kww_property_reference ILIKE ${p}
        OR cl.listing_payload->>'Property24Id' ILIKE ${p}
        OR cl.listing_payload->>'PrivatePropertyId' ILIKE ${p}
        OR cl.listing_payload->>'KWWId' ILIKE ${p}
        OR EXISTS (
          SELECT 1
          FROM migration.listing_agents la
          WHERE la.listing_id = cl.id
            AND COALESCE(la.agent_name, '') ILIKE ${p}
        )
        OR EXISTS (
          SELECT 1
          FROM migration.listing_contacts lc
          WHERE lc.listing_id = cl.id
            AND (
              COALESCE(lc.full_name, '') ILIKE ${p}
              OR COALESCE(lc.phone_number, '') ILIKE ${p}
              OR COALESCE(lc.email_address, '') ILIKE ${p}
            )
        )
      )`);
        }
        if (statusInput) {
            params.push(statusInput);
            whereClauses.push(`LOWER(TRIM(COALESCE(cl.status_name, ''))) = LOWER(TRIM($${params.length}))`);
        }
        if (saleOrRentInput) {
            params.push(saleOrRentInput);
            whereClauses.push(`LOWER(TRIM(COALESCE(cl.sale_or_rent, ''))) = LOWER(TRIM($${params.length}))`);
        }
        if (propertyTypeInput) {
            params.push(propertyTypeInput);
            const p = `$${params.length}`;
            whereClauses.push(`(LOWER(TRIM(COALESCE(cl.property_type, ''))) = LOWER(TRIM(${p})) OR LOWER(TRIM(COALESCE(cl.property_sub_type, ''))) = LOWER(TRIM(${p})))`);
        }
        const minPrice = Number(minPriceInput);
        if (minPriceInput && Number.isFinite(minPrice)) {
            params.push(minPrice);
            whereClauses.push(`COALESCE(cl.price, 0) >= $${params.length}`);
        }
        const maxPrice = Number(maxPriceInput);
        if (maxPriceInput && Number.isFinite(maxPrice)) {
            params.push(maxPrice);
            whereClauses.push(`COALESCE(cl.price, 0) <= $${params.length}`);
        }
        if (Number.isFinite(minBedroomsInput) && minBedroomsInput > 0) {
            params.push(minBedroomsInput);
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
          AND COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(lpa.count::text, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}
      )`);
        }
        if (Number.isFinite(minBathroomsInput) && minBathroomsInput > 0) {
            params.push(minBathroomsInput);
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
          AND COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(lpa.count::text, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}
      )`);
        }
        if (petFriendlyInput)
            whereClauses.push(`COALESCE(cl.pet_friendly, false) = true`);
        if (flatletInput)
            whereClauses.push(`COALESCE(cl.has_flatlet, false) = true`);
        if (retirementInput)
            whereClauses.push(`COALESCE(cl.retirement_living, false) = true`);
        if (auctionInput)
            whereClauses.push(`COALESCE(cl.property_auction, false) = true`);
        if (repossessedInput)
            whereClauses.push(`LOWER(TRIM(COALESCE(cl.listing_status_tag, ''))) = 'repossessed'`);
        if (onShowInput) {
            whereClauses.push(`EXISTS (SELECT 1 FROM migration.listing_show_times lst WHERE lst.listing_id = cl.id)`);
        }
        if (poolInput) {
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'pool'
      )`);
        }
        if (gardenInput) {
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garden'
      )`);
        }
        if (securityEstateInput) {
            whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_features lf
        WHERE lf.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lf.feature_category, ''))) = 'lifestyle'
          AND LOWER(TRIM(COALESCE(lf.feature_value, ''))) IN ('security estate', 'security complex', 'gated community', 'complex')
      )`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`SELECT COUNT(*)::text AS total FROM migration.core_listings cl ${whereSql}`, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`SELECT id::text, source_listing_id, listing_number, status_name, listing_status_tag,
        sale_or_rent, address_line, street_number, street_name, suburb, city, province, country,
        price::text, expiry_date::text, property_title, short_title,
        property_description, short_description, property_type, property_sub_type,
        COALESCE(
          NULLIF(TRIM(property24_ref1), ''),
          NULLIF(TRIM(property24_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'Property24Id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'Property24Reference'), '')
        ) AS property24_reference_id,
        COALESCE(
          NULLIF(TRIM(private_property_ref1), ''),
          NULLIF(TRIM(private_property_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'privatePropertyReference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'PrivatePropertyId'), ''),
          NULLIF(TRIM(cl.listing_payload->>'PrivatePropertyReference'), '')
        ) AS private_property_reference_id,
        COALESCE(
          NULLIF(TRIM(kww_property_reference), ''),
          NULLIF(TRIM(kww_ref1), ''),
          NULLIF(TRIM(kww_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'KWWId'), ''),
          NULLIF(TRIM(cl.listing_payload->>'KWWReference'), '')
        ) AS kww_reference_id,
        COALESCE(NULLIF(TRIM(cl.listing_payload->>'EntegralId'), ''), NULLIF(TRIM(cl.listing_payload->>'entegral_id'), ''), NULLIF(TRIM(cl.listing_payload->>'EntegralReference'), '')) AS entegral_reference_id,
        (SELECT COALESCE(a.full_name, la.agent_name)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_name,
        (SELECT a.image_url
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_image_url,
        (SELECT COALESCE(a.mobile_number, a.office_number)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_phone,
        (SELECT COALESCE(a.kwsa_email, a.private_email, a.email)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_email,
        COALESCE(
          (SELECT mc.logo_image_url
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           LEFT JOIN migration.core_market_centers mc ON mc.id = COALESCE(a.market_center_id, la.market_center_id)
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1),
          (SELECT mc.logo_image_url
           FROM migration.core_market_centers mc
           WHERE mc.id = cl.market_center_id
           LIMIT 1)
        ) AS market_center_logo_url,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersName'), ''),
          (SELECT lc.full_name
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.full_name, la.agent_name)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_name,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersPhone'), ''),
          (SELECT lc.phone_number
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.mobile_number, a.office_number)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_phone,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersEmail'), ''),
          (SELECT lc.email_address
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.kwsa_email, a.private_email, a.email)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_email,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
        ) AS bedroom_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
        ) AS bathroom_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage'
        ) AS garage_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'parking'
        ) AS parking_count,
        cl.erf_size::text,
        cl.floor_area::text,
        is_draft, is_published, mandate_type,
        listing_images_json, updated_at::text
       FROM migration.core_listings cl
       ${whereSql}
       ORDER BY cl.updated_at DESC, cl.id DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`, params);
        return res.json({
            total: Number(totalResult.rows[0]?.total ?? 0),
            limit,
            offset,
            items: dataResult.rows.map((row) => {
                const imageUrls = parseImageUrls(row.listing_images_json);
                return { ...row, image_urls: imageUrls, thumbnail_url: imageUrls[0] ?? null };
            }),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Get single listing with all sub-tables
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid listing id.' });
    try {
        const result = await pool.query(`SELECT
        id::text, source_listing_id, source_market_center_id, market_center_id::text,
        listing_number, status_name, listing_status_tag, ownership_type,
        sale_or_rent, address_line, street_number, street_name, suburb, city, province, country,
        price::text, expiry_date::text, reduced_date::text,
        agent_property_valuation::text,
        no_transfer_duty, property_auction, poa,
        property_title, short_title, property_description, short_description,
        property_type, property_sub_type, descriptive_feature, retirement_living,
        erf_number, unit_number, door_number, estate_name, street_number, street_name,
        postal_code, longitude::text, latitude::text,
        override_display_location, override_display_longitude::text, override_display_latitude::text,
        loom_validation_status, loom_property_id, loom_address,
        display_address_on_website, viewing_instructions, viewing_directions,
        feed_to_private_property, private_property_ref1, private_property_ref2, private_property_sync_status,
        feed_to_kww, kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
        feed_to_entegral, entegral_sync_status,
        feed_to_property24, property24_ref1, property24_ref2, property24_sync_status,
        signed_date::text, on_market_since_date::text, rates_and_taxes::text,
        monthly_levy::text, occupation_date::text, mandate_type,
        erf_size::text, floor_area::text, construction_date::text,
        height_restriction::text, out_building_size::text, zoning_type,
        is_furnished, pet_friendly, has_standalone_building, has_flatlet,
        has_backup_water, wheelchair_accessible, has_generator,
        has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
        has_solar_geyser, has_water_tank,
        adsl, fibre, isdn, dialup, fixed_wimax, satellite,
        nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
        is_draft, is_published,
        listing_images_json, listing_payload,
        created_at::text, updated_at::text
       FROM migration.core_listings WHERE id = $1 LIMIT 1`, [id]);
        if (result.rowCount === 0)
            return res.status(404).json({ error: 'Listing not found.' });
        const row = result.rows[0];
        const imageUrls = parseImageUrls(row.listing_images_json);
        const [agents, contacts, images, showTimes, openHouse, marketingUrls, mandateDocs, features, areas] = await Promise.all([
            pool.query(`SELECT la.id::text, la.associate_id::text, COALESCE(a.full_name, la.agent_name) AS agent_name,
                  la.agent_role, la.is_primary, la.market_center_id::text, la.sort_order
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = $1 ORDER BY la.is_primary DESC, la.sort_order`, [id]),
            pool.query(`SELECT id::text, full_name, phone_number, email_address, sort_order
           FROM migration.listing_contacts WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, file_name, file_url, media_type, sort_order, uploaded_by, uploaded_at::text
           FROM migration.listing_images WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, from_date::text, from_time, to_date::text, to_time, catch_phrase, sort_order
           FROM migration.listing_show_times WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, open_house_date::text, from_time, to_time, average_price, comments, sort_order
           FROM migration.listing_open_house WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, url, url_type, display_name, sort_order
           FROM migration.listing_marketing_urls WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, file_name, file_url, file_type, uploaded_by, uploaded_at::text, sort_order
           FROM migration.listing_mandate_documents WHERE listing_id = $1 ORDER BY sort_order`, [id]),
            pool.query(`SELECT id::text, feature_category, feature_value, sort_order
           FROM migration.listing_features WHERE listing_id = $1 ORDER BY feature_category, sort_order`, [id]),
            pool.query(`SELECT id::text, area_type, count, size::text, description, sub_features, sort_order
           FROM migration.listing_property_areas WHERE listing_id = $1 ORDER BY sort_order`, [id]),
        ]);
        return res.json({
            ...row,
            image_urls: imageUrls,
            thumbnail_url: imageUrls[0] ?? null,
            agents: agents.rows,
            contacts: contacts.rows,
            normalized_images: images.rows,
            show_times: showTimes.rows,
            open_house: openHouse.rows,
            marketing_urls: marketingUrls.rows,
            mandate_documents: mandateDocs.rows,
            features: features.rows,
            property_areas: areas.rows,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Create listing
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const b = req.body;
    let sourceMarketCenterId = toText(b.source_market_center_id);
    let marketCenterId = null;
    if (sourceMarketCenterId) {
        const mc = await pool.query(`SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
        marketCenterId = mc.rows[0]?.id ? Number(mc.rows[0].id) : null;
    }
    const listingNumber = toText(b.listing_number);
    const isDraft = toBool(b.is_draft ?? true);
    const isPublished = toBool(b.is_published ?? false);
    const imageUrls = parseImageUrls(b.image_urls ?? b.listing_images_json);
    try {
        const params = buildListingParams(b, sourceMarketCenterId, marketCenterId, listingNumber, isDraft, isPublished, imageUrls);
        const insert = await pool.query(`INSERT INTO migration.core_listings (
        source_listing_id, source_market_center_id, market_center_id,
        listing_number, status_name, listing_status_tag, ownership_type,
        sale_or_rent, price, expiry_date, reduced_date, agent_property_valuation,
        no_transfer_duty, property_auction, poa,
        property_title, short_title, property_description, short_description,
        property_type, property_sub_type, descriptive_feature, retirement_living,
        address_line, suburb, city, province, country,
        erf_number, unit_number, door_number, estate_name, street_number, street_name,
        postal_code, longitude, latitude,
        override_display_location, override_display_longitude, override_display_latitude,
        loom_validation_status, loom_property_id, loom_address,
        display_address_on_website, viewing_instructions, viewing_directions,
        feed_to_private_property, private_property_ref1, private_property_ref2, private_property_sync_status,
        feed_to_kww, kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
        feed_to_entegral, entegral_sync_status,
        feed_to_property24, property24_ref1, property24_ref2, property24_sync_status,
        signed_date, on_market_since_date, rates_and_taxes, monthly_levy, occupation_date, mandate_type,
        erf_size, floor_area, construction_date, height_restriction, out_building_size, zoning_type,
        is_furnished, pet_friendly, has_standalone_building, has_flatlet,
        has_backup_water, wheelchair_accessible, has_generator,
        has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
        has_solar_geyser, has_water_tank,
        adsl, fibre, isdn, dialup, fixed_wimax, satellite,
        nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
        is_draft, is_published,
        listing_images_json, listing_payload
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::date,$11::date,$12::numeric,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::numeric,$37::numeric,
        $38,$39::numeric,$40::numeric,$41,$42,$43,
        $44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,
        $61::date,$62::date,$63::numeric,$64::numeric,$65::date,$66,
        $67::numeric,$68::numeric,$69::date,$70::numeric,$71::numeric,$72,
        $73,$74,$75,$76,$77,$78,$79,$80,$81,$82,$83,$84,$85,$86,$87,$88,$89,$90,$91,$92,
        $93,$94,$95::jsonb,$96::jsonb
      ) RETURNING id::text`, params);
        const newId = insert.rows[0].id;
        await saveSubTables(pool, Number(newId), b);
        return res.status(201).json({ id: newId });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Update listing
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid listing id.' });
    const b = req.body;
    let sourceMarketCenterId = toText(b.source_market_center_id);
    let marketCenterId = null;
    if (sourceMarketCenterId) {
        const mc = await pool.query(`SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
        marketCenterId = mc.rows[0]?.id ? Number(mc.rows[0].id) : null;
    }
    const listingNumber = toText(b.listing_number);
    const isDraft = toBool(b.is_draft ?? false);
    const isPublished = toBool(b.is_published ?? false);
    const imageUrls = parseImageUrls(b.image_urls ?? b.listing_images_json);
    try {
        const params = buildListingParams(b, sourceMarketCenterId, marketCenterId, listingNumber, isDraft, isPublished, imageUrls);
        const update = await pool.query(`UPDATE migration.core_listings SET
        source_market_center_id=$2, market_center_id=$3,
        listing_number=$4, status_name=$5, listing_status_tag=$6, ownership_type=$7,
        sale_or_rent=$8, price=$9::numeric, expiry_date=$10::date, reduced_date=$11::date,
        agent_property_valuation=$12::numeric,
        no_transfer_duty=$13, property_auction=$14, poa=$15,
        property_title=$16, short_title=$17, property_description=$18, short_description=$19,
        property_type=$20, property_sub_type=$21, descriptive_feature=$22, retirement_living=$23,
        address_line=$24, suburb=$25, city=$26, province=$27, country=$28,
        erf_number=$29, unit_number=$30, door_number=$31, estate_name=$32, street_number=$33,
        street_name=$34, postal_code=$35, longitude=$36::numeric, latitude=$37::numeric,
        override_display_location=$38, override_display_longitude=$39::numeric, override_display_latitude=$40::numeric,
        loom_validation_status=$41, loom_property_id=$42, loom_address=$43,
        display_address_on_website=$44, viewing_instructions=$45, viewing_directions=$46,
        feed_to_private_property=$47, private_property_ref1=$48, private_property_ref2=$49, private_property_sync_status=$50,
        feed_to_kww=$51, kww_property_reference=$52, kww_ref1=$53, kww_ref2=$54, kww_sync_status=$55,
        feed_to_entegral=$56, entegral_sync_status=$57,
        feed_to_property24=$58, property24_ref1=$59, property24_ref2=$60, property24_sync_status=$61,
        signed_date=$62::date, on_market_since_date=$63::date, rates_and_taxes=$64::numeric,
        monthly_levy=$65::numeric, occupation_date=$66::date, mandate_type=$67,
        erf_size=$68::numeric, floor_area=$69::numeric, construction_date=$70::date,
        height_restriction=$71::numeric, out_building_size=$72::numeric, zoning_type=$73,
        is_furnished=$74, pet_friendly=$75, has_standalone_building=$76, has_flatlet=$77,
        has_backup_water=$78, wheelchair_accessible=$79, has_generator=$80,
        has_borehole=$81, has_gas_geyser=$82, has_solar_panels=$83, has_backup_battery_or_inverter=$84,
        has_solar_geyser=$85, has_water_tank=$86,
        adsl=$87, fibre=$88, isdn=$89, dialup=$90, fixed_wimax=$91, satellite=$92,
        nearby_bus_service=$93, nearby_minibus_taxi_service=$94, nearby_train_service=$95,
        is_draft=$96, is_published=$97,
        listing_images_json=$98::jsonb, listing_payload=$99::jsonb,
        updated_at=NOW()
       WHERE id=$1 RETURNING id::text`, [id, ...params.slice(1)]);
        if (update.rowCount === 0)
            return res.status(404).json({ error: 'Listing not found.' });
        await saveSubTables(pool, id, b);
        return res.json({ id: update.rows[0].id });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// ---------------------------------------------------------------------------
// Sub-table helpers
// ---------------------------------------------------------------------------
function buildListingParams(b, sourceMarketCenterId, marketCenterId, listingNumber, isDraft, isPublished, imageUrls) {
    const sourceListingId = toText(b.source_listing_id) ?? `MAN-${Date.now()}`;
    return [
        sourceListingId, sourceMarketCenterId, marketCenterId, listingNumber,
        toText(b.status_name), toText(b.listing_status_tag), toText(b.ownership_type),
        toText(b.sale_or_rent), toNumber(b.price),
        toDateValue(b.expiry_date), toDateValue(b.reduced_date), toNumber(b.agent_property_valuation),
        toBool(b.no_transfer_duty), toBool(b.property_auction), toBool(b.poa),
        toText(b.property_title), toText(b.short_title), toText(b.property_description), toText(b.short_description),
        toText(b.property_type), toText(b.property_sub_type), toText(b.descriptive_feature), toBool(b.retirement_living),
        toText(b.address_line), toText(b.suburb), toText(b.city), toText(b.province), toText(b.country),
        toText(b.erf_number), toText(b.unit_number), toText(b.door_number), toText(b.estate_name),
        toText(b.street_number), toText(b.street_name), toText(b.postal_code),
        toNumber(b.longitude), toNumber(b.latitude),
        toBool(b.override_display_location), toNumber(b.override_display_longitude), toNumber(b.override_display_latitude),
        toText(b.loom_validation_status), toText(b.loom_property_id), toText(b.loom_address),
        toBool(b.display_address_on_website ?? true), toText(b.viewing_instructions), toText(b.viewing_directions),
        toBool(b.feed_to_private_property), toText(b.private_property_ref1), toText(b.private_property_ref2), toText(b.private_property_sync_status),
        toBool(b.feed_to_kww), toText(b.kww_property_reference), toText(b.kww_ref1), toText(b.kww_ref2), toText(b.kww_sync_status),
        toBool(b.feed_to_entegral), toText(b.entegral_sync_status),
        toBool(b.feed_to_property24), toText(b.property24_ref1), toText(b.property24_ref2), toText(b.property24_sync_status),
        toDateValue(b.signed_date), toDateValue(b.on_market_since_date), toNumber(b.rates_and_taxes), toNumber(b.monthly_levy),
        toDateValue(b.occupation_date), toText(b.mandate_type),
        toNumber(b.erf_size), toNumber(b.floor_area), toDateValue(b.construction_date),
        toNumber(b.height_restriction), toNumber(b.out_building_size), toText(b.zoning_type),
        toBool(b.is_furnished), toBool(b.pet_friendly), toBool(b.has_standalone_building), toBool(b.has_flatlet),
        toBool(b.has_backup_water), toBool(b.wheelchair_accessible), toBool(b.has_generator),
        toBool(b.has_borehole), toBool(b.has_gas_geyser), toBool(b.has_solar_panels), toBool(b.has_backup_battery_or_inverter),
        toBool(b.has_solar_geyser), toBool(b.has_water_tank),
        toBool(b.adsl), toBool(b.fibre), toBool(b.isdn), toBool(b.dialup), toBool(b.fixed_wimax), toBool(b.satellite),
        toBool(b.nearby_bus_service), toBool(b.nearby_minibus_taxi_service), toBool(b.nearby_train_service),
        isDraft, isPublished,
        JSON.stringify(imageUrls),
        JSON.stringify(typeof b.listing_payload === 'object' && b.listing_payload ? b.listing_payload : {}),
    ];
}
async function saveSubTables(pg, listingId, b) {
    if (Array.isArray(b.agents)) {
        await pg.query(`DELETE FROM migration.listing_agents WHERE listing_id = $1`, [listingId]);
        for (const [i, agent] of b.agents.entries()) {
            await pg.query(`INSERT INTO migration.listing_agents (listing_id, associate_id, agent_name, agent_role, is_primary, market_center_id, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [listingId, toNumber(agent.associate_id), toText(agent.agent_name), toText(agent.agent_role) ?? 'Primary', toBool(agent.is_primary), toNumber(agent.market_center_id), agent.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.contacts)) {
        await pg.query(`DELETE FROM migration.listing_contacts WHERE listing_id = $1`, [listingId]);
        for (const [i, c] of b.contacts.entries()) {
            await pg.query(`INSERT INTO migration.listing_contacts (listing_id, full_name, phone_number, email_address, sort_order) VALUES ($1,$2,$3,$4,$5)`, [listingId, toText(c.full_name), toText(c.phone_number), toText(c.email_address), c.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.show_times)) {
        await pg.query(`DELETE FROM migration.listing_show_times WHERE listing_id = $1`, [listingId]);
        for (const [i, st] of b.show_times.entries()) {
            await pg.query(`INSERT INTO migration.listing_show_times (listing_id, from_date, from_time, to_date, to_time, catch_phrase, sort_order)
         VALUES ($1,$2::date,$3,$4::date,$5,$6,$7)`, [listingId, toDateValue(st.from_date), toText(st.from_time), toDateValue(st.to_date), toText(st.to_time), toText(st.catch_phrase), st.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.open_house)) {
        await pg.query(`DELETE FROM migration.listing_open_house WHERE listing_id = $1`, [listingId]);
        for (const [i, oh] of b.open_house.entries()) {
            await pg.query(`INSERT INTO migration.listing_open_house (listing_id, open_house_date, from_time, to_time, average_price, comments, sort_order)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7)`, [listingId, toDateValue(oh.open_house_date), toText(oh.from_time), toText(oh.to_time), toText(oh.average_price), toText(oh.comments), oh.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.marketing_urls)) {
        await pg.query(`DELETE FROM migration.listing_marketing_urls WHERE listing_id = $1`, [listingId]);
        for (const [i, mu] of b.marketing_urls.entries()) {
            if (!toText(mu.url))
                continue;
            await pg.query(`INSERT INTO migration.listing_marketing_urls (listing_id, url, url_type, display_name, sort_order) VALUES ($1,$2,$3,$4,$5)`, [listingId, toText(mu.url), toText(mu.url_type), toText(mu.display_name), mu.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.features)) {
        await pg.query(`DELETE FROM migration.listing_features WHERE listing_id = $1`, [listingId]);
        for (const [i, f] of b.features.entries()) {
            if (!toText(f.feature_category) || !toText(f.feature_value))
                continue;
            await pg.query(`INSERT INTO migration.listing_features (listing_id, feature_category, feature_value, sort_order) VALUES ($1,$2,$3,$4)`, [listingId, toText(f.feature_category), toText(f.feature_value), f.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.property_areas)) {
        await pg.query(`DELETE FROM migration.listing_property_areas WHERE listing_id = $1`, [listingId]);
        for (const [i, pa] of b.property_areas.entries()) {
            if (!toText(pa.area_type))
                continue;
            const subFeatures = parseTextArray(pa.sub_features);
            await pg.query(`INSERT INTO migration.listing_property_areas (listing_id, area_type, count, size, description, sub_features, sort_order) VALUES ($1,$2,$3,$4::numeric,$5,$6,$7)`, [listingId, toText(pa.area_type), pa.count ?? null, toNumber(pa.size), toText(pa.description), subFeatures, pa.sort_order ?? i]);
        }
    }
    if (Array.isArray(b.normalized_images)) {
        await pg.query(`DELETE FROM migration.listing_images WHERE listing_id = $1`, [listingId]);
        for (const [i, img] of b.normalized_images.entries()) {
            if (!toText(img.file_url))
                continue;
            await pg.query(`INSERT INTO migration.listing_images (listing_id, file_name, file_url, media_type, sort_order, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`, [listingId, toText(img.file_name), toText(img.file_url), toText(img.media_type) ?? 'image', img.sort_order ?? i, toText(img.uploaded_by)]);
        }
    }
}
// ---------------------------------------------------------------------------
// Image upload endpoints
// ---------------------------------------------------------------------------
router.post('/images/upload', async (req, res) => {
    if (!storageConfig.localUploadsEnabled) {
        return res.status(503).json({ error: 'Local file uploads are disabled in this environment. Configure managed storage before using upload endpoints.' });
    }
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0)
        return res.status(400).json({ error: 'No files were provided.' });
    try {
        const urls = await storeUploadedFiles(files);
        return res.status(201).json({ image_urls: urls });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/:id/images/upload', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    if (!storageConfig.localUploadsEnabled) {
        return res.status(503).json({ error: 'Local file uploads are disabled in this environment. Configure managed storage before using upload endpoints.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid listing id.' });
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0)
        return res.status(400).json({ error: 'No files were provided.' });
    try {
        const newUrls = await storeUploadedFiles(files);
        for (const url of newUrls) {
            const fileName = url.split('/').pop() ?? '';
            await pool.query(`INSERT INTO migration.listing_images (listing_id, file_name, file_url, sort_order)
         VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM migration.listing_images WHERE listing_id=$1))`, [id, fileName, url]);
        }
        await pool.query(`UPDATE migration.core_listings SET updated_at=NOW() WHERE id=$1`, [id]);
        return res.status(201).json({ image_urls: newUrls });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/:id/mandate-documents/upload', async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    if (!storageConfig.localUploadsEnabled) {
        return res.status(503).json({ error: 'Local file uploads are disabled in this environment. Configure managed storage before using upload endpoints.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'Invalid listing id.' });
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0)
        return res.status(400).json({ error: 'No files were provided.' });
    try {
        const newUrls = await storeUploadedFiles(files, 'mandate-docs');
        for (const [i, url] of newUrls.entries()) {
            const file = files[i];
            const fileName = toText(file?.name) ?? url.split('/').pop() ?? '';
            await pool.query(`INSERT INTO migration.listing_mandate_documents (listing_id, file_name, file_url, file_type, sort_order)
         VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM migration.listing_mandate_documents WHERE listing_id=$1))`, [id, fileName, url, toText(file?.mimeType)]);
        }
        return res.status(201).json({ document_urls: newUrls });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=listings.js.map