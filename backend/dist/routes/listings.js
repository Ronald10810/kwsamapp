import { Router } from 'express';
import { Pool } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const router = Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
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
function toDateValue(value) {
    const text = toText(value);
    if (!text)
        return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString();
}
function parseImageUrls(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => /^https?:\/\//i.test(entry) || entry.startsWith('/uploads/'));
    }
    if (typeof value === 'string') {
        const cleaned = value
            .replace(/[\[\]"]/g, ' ')
            .replace(/\r?\n/g, '|')
            .trim();
        if (!cleaned)
            return [];
        return cleaned
            .split(/\s*[|;,]\s*/)
            .map((entry) => entry.trim())
            .filter((entry) => /^https?:\/\//i.test(entry) || entry.startsWith('/uploads/'));
    }
    return [];
}
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function extensionFromMimeType(mimeType) {
    if (!mimeType)
        return '.jpg';
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('png'))
        return '.png';
    if (normalized.includes('webp'))
        return '.webp';
    if (normalized.includes('gif'))
        return '.gif';
    if (normalized.includes('jpeg') || normalized.includes('jpg'))
        return '.jpg';
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
async function storeUploadedFiles(files) {
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'listings');
    await mkdir(uploadDir, { recursive: true });
    const urls = [];
    for (const file of files) {
        const content = decodeBase64Image(file.contentBase64);
        if (!content)
            continue;
        const originalName = file.name ? sanitizeFileName(file.name) : 'listing-image';
        const ext = path.extname(originalName) || extensionFromMimeType(file.mimeType);
        const base = path.basename(originalName, path.extname(originalName)) || 'listing-image';
        const unique = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const targetPath = path.join(uploadDir, unique);
        await writeFile(targetPath, content);
        urls.push(`/uploads/listings/${unique}`);
    }
    return urls;
}
function buildManualListingId() {
    const ts = Date.now().toString();
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `MAN-LIST-${ts}-${rand}`;
}
router.get('/', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const searchInput = String(req.query.search ?? '').trim();
    const statusInput = String(req.query.status ?? '').trim();
    const saleOrRentInput = String(req.query.saleOrRent ?? req.query.sale_or_rent ?? '').trim();
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_listings') AS exists`);
        if (!exists.rows[0]?.exists) {
            return res.json({ total: 0, limit, offset, items: [] });
        }
        const whereClauses = [];
        const params = [];
        if (searchInput.length > 0) {
            params.push(`%${searchInput}%`);
            const searchParam = `$${params.length}`;
            whereClauses.push(`(listing_number ILIKE ${searchParam} OR source_listing_id ILIKE ${searchParam} OR address_line ILIKE ${searchParam} OR suburb ILIKE ${searchParam} OR city ILIKE ${searchParam} OR status_name ILIKE ${searchParam} OR property_title ILIKE ${searchParam} OR short_title ILIKE ${searchParam})`);
        }
        if (statusInput.length > 0) {
            params.push(statusInput);
            whereClauses.push(`LOWER(TRIM(COALESCE(status_name, ''))) = LOWER(TRIM($${params.length}))`);
        }
        if (saleOrRentInput.length > 0) {
            params.push(saleOrRentInput);
            whereClauses.push(`LOWER(TRIM(COALESCE(sale_or_rent, ''))) = LOWER(TRIM($${params.length}))`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`SELECT COUNT(*)::text AS total FROM migration.core_listings ${whereSql}`, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`
      SELECT
        id,
        source_listing_id,
        listing_number,
        status_name,
        sale_or_rent,
        address_line,
        suburb,
        city,
        province,
        country,
        price::text,
        expiry_date::text,
        property_title,
        short_title,
        property_description,
        listing_images_json,
        listing_payload->>'ListingAgent' AS listing_agent,
        updated_at::text
      FROM migration.core_listings
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params);
        return res.json({
            total: Number(totalResult.rows[0]?.total ?? 0),
            limit,
            offset,
            items: dataResult.rows.map((row) => {
                const imageUrls = parseImageUrls(row.listing_images_json);
                return {
                    ...row,
                    image_urls: imageUrls,
                    thumbnail_url: imageUrls[0] ?? null,
                };
            }),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/:id', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid listing id.' });
    }
    try {
        const result = await pool.query(`
      SELECT
        id::text,
        source_listing_id,
        source_market_center_id,
        listing_number,
        status_name,
        sale_or_rent,
        address_line,
        suburb,
        city,
        province,
        country,
        price::text,
        expiry_date::text,
        property_title,
        short_title,
        property_description,
        listing_images_json,
        listing_payload,
        listing_payload->>'ListingAgent' AS listing_agent,
        updated_at::text
      FROM migration.core_listings
      WHERE id = $1
      LIMIT 1
      `, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Listing not found.' });
        }
        const row = result.rows[0];
        const imageUrls = parseImageUrls(row.listing_images_json);
        return res.json({
            ...row,
            image_urls: imageUrls,
            thumbnail_url: imageUrls[0] ?? null,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/images/upload', async (req, res) => {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) {
        return res.status(400).json({ error: 'No files were provided.' });
    }
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
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid listing id.' });
    }
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) {
        return res.status(400).json({ error: 'No files were provided.' });
    }
    try {
        const existingResult = await pool.query(`SELECT listing_images_json FROM migration.core_listings WHERE id = $1 LIMIT 1`, [id]);
        if (existingResult.rowCount === 0) {
            return res.status(404).json({ error: 'Listing not found.' });
        }
        const existingUrls = parseImageUrls(existingResult.rows[0].listing_images_json);
        const newUrls = await storeUploadedFiles(files);
        const merged = [...existingUrls, ...newUrls];
        await pool.query(`UPDATE migration.core_listings SET listing_images_json = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(merged), id]);
        return res.status(201).json({ image_urls: merged, uploaded_urls: newUrls });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const sourceListingId = toText(req.body?.source_listing_id) ?? buildManualListingId();
    const sourceMarketCenterId = toText(req.body?.source_market_center_id);
    const marketCenterName = toText(req.body?.market_center_name);
    const listingNumber = toText(req.body?.listing_number);
    const statusName = toText(req.body?.status_name);
    const saleOrRent = toText(req.body?.sale_or_rent);
    const addressLine = toText(req.body?.address_line);
    const suburb = toText(req.body?.suburb);
    const city = toText(req.body?.city);
    const province = toText(req.body?.province);
    const country = toText(req.body?.country);
    const price = toNumber(req.body?.price);
    const expiryDate = toDateValue(req.body?.expiry_date);
    const propertyTitle = toText(req.body?.property_title);
    const shortTitle = toText(req.body?.short_title);
    const propertyDescription = toText(req.body?.property_description);
    const imageUrls = parseImageUrls(req.body?.image_urls ?? req.body?.listing_images_json ?? req.body?.ListingImages);
    const listingPayload = req.body?.listing_payload && typeof req.body.listing_payload === 'object'
        ? req.body.listing_payload
        : null;
    try {
        let marketCenterId = null;
        let mappedSourceMarketCenterId = sourceMarketCenterId;
        if (sourceMarketCenterId) {
            const mcLookup = await pool.query(`SELECT id::text AS id, source_market_center_id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
            marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
            mappedSourceMarketCenterId = mcLookup.rows[0]?.source_market_center_id ?? sourceMarketCenterId;
        }
        else if (marketCenterName) {
            const mcLookup = await pool.query(`SELECT id::text AS id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`, [marketCenterName]);
            marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
            mappedSourceMarketCenterId = mcLookup.rows[0]?.source_market_center_id ?? null;
        }
        const insert = await pool.query(`
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
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13::timestamptz,$14,$15,$16,$17::jsonb,$18::jsonb,NOW()
      )
      RETURNING id::text
      `, [
            sourceListingId,
            mappedSourceMarketCenterId,
            marketCenterId,
            listingNumber,
            statusName,
            saleOrRent,
            addressLine,
            suburb,
            city,
            province,
            country,
            price,
            expiryDate,
            propertyTitle,
            shortTitle,
            propertyDescription,
            JSON.stringify(imageUrls),
            JSON.stringify(listingPayload ?? {}),
        ]);
        return res.status(201).json({ id: insert.rows[0].id, source_listing_id: sourceListingId });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.put('/:id', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid listing id.' });
    }
    const sourceMarketCenterId = toText(req.body?.source_market_center_id);
    const marketCenterName = toText(req.body?.market_center_name);
    const listingNumber = toText(req.body?.listing_number);
    const statusName = toText(req.body?.status_name);
    const saleOrRent = toText(req.body?.sale_or_rent);
    const addressLine = toText(req.body?.address_line);
    const suburb = toText(req.body?.suburb);
    const city = toText(req.body?.city);
    const province = toText(req.body?.province);
    const country = toText(req.body?.country);
    const price = toNumber(req.body?.price);
    const expiryDate = toDateValue(req.body?.expiry_date);
    const propertyTitle = toText(req.body?.property_title);
    const shortTitle = toText(req.body?.short_title);
    const propertyDescription = toText(req.body?.property_description);
    const imageUrls = parseImageUrls(req.body?.image_urls ?? req.body?.listing_images_json ?? req.body?.ListingImages);
    const listingPayload = req.body?.listing_payload && typeof req.body.listing_payload === 'object'
        ? req.body.listing_payload
        : null;
    try {
        let marketCenterId = null;
        let mappedSourceMarketCenterId = sourceMarketCenterId;
        if (sourceMarketCenterId) {
            const mcLookup = await pool.query(`SELECT id::text AS id, source_market_center_id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId]);
            marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
            mappedSourceMarketCenterId = mcLookup.rows[0]?.source_market_center_id ?? sourceMarketCenterId;
        }
        else if (marketCenterName) {
            const mcLookup = await pool.query(`SELECT id::text AS id, source_market_center_id FROM migration.core_market_centers WHERE name = $1 LIMIT 1`, [marketCenterName]);
            marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
            mappedSourceMarketCenterId = mcLookup.rows[0]?.source_market_center_id ?? null;
        }
        const update = await pool.query(`
      UPDATE migration.core_listings
      SET
        source_market_center_id = $1,
        market_center_id = $2,
        listing_number = $3,
        status_name = $4,
        sale_or_rent = $5,
        address_line = $6,
        suburb = $7,
        city = $8,
        province = $9,
        country = $10,
        price = $11::numeric,
        expiry_date = $12::timestamptz,
        property_title = $13,
        short_title = $14,
        property_description = $15,
        listing_images_json = $16::jsonb,
        listing_payload = $17::jsonb,
        updated_at = NOW()
      WHERE id = $18
      RETURNING id::text
      `, [
            mappedSourceMarketCenterId,
            marketCenterId,
            listingNumber,
            statusName,
            saleOrRent,
            addressLine,
            suburb,
            city,
            province,
            country,
            price,
            expiryDate,
            propertyTitle,
            shortTitle,
            propertyDescription,
            JSON.stringify(imageUrls),
            JSON.stringify(listingPayload ?? {}),
            id,
        ]);
        if (update.rowCount === 0) {
            return res.status(404).json({ error: 'Listing not found.' });
        }
        return res.json({ id: update.rows[0].id });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=listings.js.map