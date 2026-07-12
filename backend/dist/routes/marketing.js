import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getRequiredPgPool } from '../config/db.js';
import { storageConfig } from '../config/storage.js';
import { logger } from '../config/logger.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { buildMarketingPlanDocument } from '../services/docx-marketing.js';
import { generateListingSocialCopy, sanitizeSocialCopyText, validateGeneratedSocialCopy } from '../services/openai-social-copy.js';
const router = Router();
const ENSURE_MARKETING_TABLE = `
  CREATE TABLE IF NOT EXISTS public.marketing_plan_documents (
    id                  SERIAL PRIMARY KEY,
    associate_email     TEXT NOT NULL,
    associate_db_id     TEXT,
    property_address    TEXT,
    seller_name         TEXT,
    source_cma_id       INTEGER,
    file_name           TEXT NOT NULL,
    file_url            TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
let tableReady = false;
async function ensureTable() {
    if (tableReady)
        return;
    const pool = getRequiredPgPool();
    await pool.query(ENSURE_MARKETING_TABLE);
    tableReady = true;
}
// Ensures cma_documents exists with all required columns before querying it
const ENSURE_CMA_TABLE = `
  CREATE TABLE IF NOT EXISTS public.cma_documents (
    id              SERIAL PRIMARY KEY,
    associate_email TEXT NOT NULL,
    associate_db_id TEXT,
    property_address TEXT,
    seller_name     TEXT,
    file_name       TEXT NOT NULL,
    file_url        TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
const CMA_ALTER_STATEMENTS = [
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_first_name TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_last_name TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_email TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS seller_phone TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS loom_file_url TEXT`,
    `ALTER TABLE public.cma_documents ADD COLUMN IF NOT EXISTS loom_original_name TEXT`,
];
let cmaTableReady = false;
async function ensureCmaTable() {
    if (cmaTableReady)
        return;
    const pool = getRequiredPgPool();
    await pool.query(ENSURE_CMA_TABLE);
    for (const stmt of CMA_ALTER_STATEMENTS) {
        await pool.query(stmt);
    }
    cmaTableReady = true;
}
const ENSURE_SOCIAL_COPY_TABLE = `
  CREATE TABLE IF NOT EXISTS migration.listing_social_ai_copy (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES migration.core_listings(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES migration.core_associates(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    status_pill TEXT NOT NULL,
    tone TEXT NOT NULL,
    include_emojis BOOLEAN NOT NULL DEFAULT false,
    include_hashtags BOOLEAN NOT NULL DEFAULT false,
    generated_copy TEXT NOT NULL,
    edited_copy TEXT,
    listing_link TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
const SOCIAL_COPY_ALTER_STATEMENTS = [
    `CREATE UNIQUE INDEX IF NOT EXISTS listing_social_ai_copy_unique_idx ON migration.listing_social_ai_copy (listing_id, platform, status_pill)`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES migration.core_associates(id) ON DELETE SET NULL`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS tone TEXT NOT NULL DEFAULT 'Professional / Engaging'`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS include_emojis BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS include_hashtags BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS edited_copy TEXT`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS listing_link TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `ALTER TABLE migration.listing_social_ai_copy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
];
let socialCopyTableReady = false;
async function ensureSocialCopyTable() {
    if (socialCopyTableReady)
        return;
    const pool = getRequiredPgPool();
    await pool.query(ENSURE_SOCIAL_COPY_TABLE);
    for (const stmt of SOCIAL_COPY_ALTER_STATEMENTS) {
        await pool.query(stmt);
    }
    socialCopyTableReady = true;
}
const uploadDocs = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const lower = file.originalname.toLowerCase();
        if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF and DOCX files are accepted.'));
        }
    },
});
const SOCIAL_COPY_TONE_OPTIONS = new Set([
    'Professional / Engaging',
    'Professional / Formal',
    'Friendly / Warm',
    'Short / Punchy',
]);
const SOCIAL_COPY_STATUS_MAP = new Map([
    ['just listed', 'Just Listed'],
    ['for sale', 'For Sale'],
    ['price reduced', 'Price Reduced'],
    ['sold', 'Sold'],
    ['under offer', 'Under Offer'],
    ['pending', 'Pending'],
    ['to let', 'To Let'],
    ['new rental', 'New Rental'],
    ['rented', 'Rented'],
    ['open house', 'Open House'],
    ['available now', 'Available Now'],
]);
async function resolveAgentProfile(email, name) {
    const pool = getRequiredPgPool();
    const normalizedEmail = email.trim().toLowerCase();
    let assocResult = await pool.query(`SELECT id::text, first_name, full_name, email, kwsa_email, private_email, mobile_number, source_market_center_id, kwuid::text
       FROM migration.core_associates
      WHERE LOWER(TRIM(COALESCE(kwsa_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(private_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(email, ''))) = $1
      ORDER BY CASE
        WHEN LOWER(TRIM(COALESCE(kwsa_email, ''))) = $1 THEN 0
        WHEN LOWER(TRIM(COALESCE(private_email, ''))) = $1 THEN 1
        ELSE 2
      END
      LIMIT 1`, [normalizedEmail]);
    if (!assocResult.rows[0] && name?.trim()) {
        assocResult = await pool.query(`SELECT id::text, first_name, full_name, email, kwsa_email, private_email, mobile_number, source_market_center_id, kwuid::text
         FROM migration.core_associates
        WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1))
        LIMIT 1`, [name.trim()]);
    }
    if (!assocResult.rows[0])
        return null;
    const assoc = assocResult.rows[0];
    const [jobTitleResult, mcResult] = await Promise.all([
        pool.query(`SELECT job_title FROM migration.associate_job_titles
        WHERE associate_id = $1
        ORDER BY id ASC LIMIT 1`, [assoc.id]),
        assoc.source_market_center_id
            ? pool.query(`SELECT name, logo_image_url, document_logo_image_url, white_logo_image_url
             FROM migration.core_market_centers
            WHERE source_market_center_id = $1
            LIMIT 1`, [assoc.source_market_center_id])
            : Promise.resolve({ rows: [] }),
    ]);
    return {
        associateDbId: assoc.id,
        firstName: assoc.first_name?.trim() || assoc.full_name?.trim().split(/\s+/)[0] || '',
        agentName: assoc.full_name ?? email,
        agentEmail: assoc.kwsa_email ?? assoc.email ?? assoc.private_email ?? email,
        agentPhone: assoc.mobile_number ?? '',
        agentTitle: jobTitleResult.rows[0]?.job_title ?? 'Agent',
        marketCentre: mcResult.rows[0]?.name ?? '',
        logoUrl: mcResult.rows[0]?.document_logo_image_url ?? mcResult.rows[0]?.logo_image_url ?? null,
        whiteLogoUrl: mcResult.rows[0]?.white_logo_image_url ?? null,
        kwuid: assoc.kwuid ?? null,
    };
}
function normalizeSocialCopyPlatform(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'instagram')
        return 'instagram';
    if (normalized === 'facebook')
        return 'facebook';
    return null;
}
function normalizeSocialCopyStatusPill(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return SOCIAL_COPY_STATUS_MAP.get(normalized) ?? null;
}
function normalizeSocialCopyTone(value) {
    const normalized = String(value ?? '').trim();
    return SOCIAL_COPY_TONE_OPTIONS.has(normalized) ? normalized : null;
}
function parseBooleanFlag(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
function normalizeFreeText(value) {
    const trimmed = String(value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
}
function uniqueNonEmpty(values) {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
function buildPublicKwHomesBaseUrl() {
    const configured = String(process.env.KWHOMES_BASE_URL ?? process.env.PUBLIC_KWHOMES_BASE_URL ?? '').trim();
    return configured || 'https://kwhomes.co.za';
}
function buildAgentListingLink(kwuid, listingNumber) {
    const normalizedKwuid = normalizeFreeText(kwuid);
    const normalizedListingNumber = normalizeFreeText(listingNumber);
    if (!normalizedKwuid || !normalizedListingNumber)
        return null;
    const baseUrl = buildPublicKwHomesBaseUrl().replace(/\/+$/, '');
    return `${baseUrl}/${encodeURIComponent(normalizedKwuid)}/${encodeURIComponent(normalizedListingNumber)}`;
}
async function resolveListingForSocialCopy(listingId, perms) {
    const pool = getRequiredPgPool();
    const baseResult = await pool.query(`SELECT
        cl.id::text,
        cl.source_market_center_id,
        cl.market_center_id::text,
        cl.listing_number,
        cl.status_name,
        cl.listing_status_tag,
        cl.sale_or_rent,
        cl.price::text,
        cl.property_title,
        cl.short_title,
        cl.property_description,
        cl.short_description,
        cl.property_type,
        cl.property_sub_type,
        cl.descriptive_feature,
        cl.mandate_type,
        cl.suburb,
        cl.city,
        cl.province,
        cl.bedrooms::text,
        cl.bathrooms::text,
        cl.garages::text,
        cl.parking::text
      FROM migration.core_listings cl
      WHERE cl.id = $1
      LIMIT 1`, [listingId]);
    const row = baseResult.rows[0];
    if (!row) {
        return { listing: null, allowed: false, notFound: true };
    }
    let allowed = perms.scope === 'GLOBAL';
    if (perms.scope === 'OWN' && perms.associateDbId) {
        const ownAccess = await pool.query(`SELECT EXISTS(
          SELECT 1
            FROM migration.listing_agents la
           WHERE la.listing_id = $1
             AND la.associate_id = $2
        )::text AS exists`, [listingId, perms.associateDbId]);
        allowed = ownAccess.rows[0]?.exists === 'true';
    }
    if (perms.scope === 'MARKET_CENTRE') {
        const marketCenterId = perms.marketCenterId ?? perms.homeMcId ?? '';
        const scopeResult = await pool.query(`SELECT EXISTS(
          SELECT 1
            FROM migration.core_listings cl
            LEFT JOIN migration.listing_agents la ON la.listing_id = cl.id
            LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE cl.id = $1
             AND (
               REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')
               OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')
             )
        )::text AS exists`, [listingId, marketCenterId]);
        allowed = scopeResult.rows[0]?.exists === 'true';
    }
    if (!allowed) {
        return { listing: null, allowed: false, notFound: false };
    }
    const featureResult = await pool.query(`SELECT feature_value
       FROM migration.listing_features
      WHERE listing_id = $1
      ORDER BY feature_category, sort_order
      LIMIT 12`, [listingId]);
    return {
        allowed: true,
        notFound: false,
        listing: {
            id: Number(row.id),
            sourceMarketCenterId: row.source_market_center_id,
            marketCenterId: row.market_center_id,
            listingNumber: row.listing_number,
            statusName: row.status_name,
            listingStatusTag: row.listing_status_tag,
            saleOrRent: row.sale_or_rent,
            price: row.price,
            propertyTitle: row.property_title,
            shortTitle: row.short_title,
            propertyDescription: row.property_description,
            shortDescription: row.short_description,
            propertyType: row.property_type,
            propertySubType: row.property_sub_type,
            descriptiveFeature: row.descriptive_feature,
            mandateType: row.mandate_type,
            suburb: row.suburb,
            city: row.city,
            province: row.province,
            bedroomCount: row.bedrooms,
            bathroomCount: row.bathrooms,
            garageCount: row.garages,
            parkingCount: row.parking,
            features: uniqueNonEmpty(featureResult.rows.map((feature) => feature.feature_value)),
        },
    };
}
async function findSocialCopyRecord(listingId, platform, statusPill) {
    const pool = getRequiredPgPool();
    const result = await pool.query(`SELECT id, listing_id, agent_id, platform, status_pill, tone, include_emojis, include_hashtags,
            generated_copy, edited_copy, listing_link, created_by, created_at::text, updated_at::text
       FROM migration.listing_social_ai_copy
      WHERE listing_id = $1 AND platform = $2 AND status_pill = $3
      LIMIT 1`, [listingId, platform, statusPill]);
    return result.rows[0] ?? null;
}
function serializeSocialCopyRecord(row) {
    const effectiveCopy = row.edited_copy?.trim() ? row.edited_copy : row.generated_copy;
    return {
        id: row.id,
        listingId: row.listing_id,
        agentId: row.agent_id,
        platform: row.platform,
        statusPill: row.status_pill,
        tone: row.tone,
        includeEmojis: row.include_emojis,
        includeHashtags: row.include_hashtags,
        generatedCopy: sanitizeSocialCopyText(row.generated_copy),
        editedCopy: row.edited_copy ? sanitizeSocialCopyText(row.edited_copy) : row.edited_copy,
        effectiveCopy: sanitizeSocialCopyText(effectiveCopy),
        listingLink: row.listing_link,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
async function repairInvalidStoredSocialCopy(record, listing, profile) {
    const { promptData, listingLink } = buildListingSocialPromptData(listing, profile, record.platform, record.status_pill, record.tone, record.include_emojis, record.include_hashtags);
    if (!listingLink) {
        return record;
    }
    const regenerated = await generateListingSocialCopy(promptData);
    const pool = getRequiredPgPool();
    const updated = await pool.query(`UPDATE migration.listing_social_ai_copy
        SET generated_copy = $2,
            listing_link = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, listing_id, agent_id, platform, status_pill, tone, include_emojis, include_hashtags,
                generated_copy, edited_copy, listing_link, created_by, created_at::text, updated_at::text`, [record.id, regenerated, listingLink]);
    return updated.rows[0] ?? record;
}
async function deleteSocialCopyRecord(recordId) {
    const pool = getRequiredPgPool();
    await pool.query(`DELETE FROM migration.listing_social_ai_copy WHERE id = $1`, [recordId]);
}
function buildListingSocialPromptData(listing, profile, platform, statusPill, tone, includeEmojis, includeHashtags) {
    const listingTitle = normalizeFreeText(listing.propertyTitle) ?? normalizeFreeText(listing.shortTitle) ?? `Listing ${listing.listingNumber ?? listing.id}`;
    const propertyType = normalizeFreeText(listing.propertySubType) ?? normalizeFreeText(listing.propertyType);
    const description = normalizeFreeText(listing.propertyDescription) ?? normalizeFreeText(listing.shortDescription);
    const parking = uniqueNonEmpty([listing.garageCount ? `${listing.garageCount} Garages` : null, listing.parkingCount ? `${listing.parkingCount} Parking` : null]).join(', ') || null;
    const cityProvince = uniqueNonEmpty([listing.city, listing.province]).join(', ') || null;
    const statusDetail = normalizeFreeText(listing.statusName) ?? normalizeFreeText(listing.listingStatusTag) ?? normalizeFreeText(listing.mandateType);
    const listingLink = buildAgentListingLink(profile.kwuid, listing.listingNumber);
    return {
        promptData: {
            platform,
            statusPill,
            tone,
            includeEmojis,
            includeHashtags,
            listingTitle,
            propertyType,
            saleOrRent: normalizeFreeText(listing.saleOrRent),
            price: normalizeFreeText(listing.price),
            bedrooms: normalizeFreeText(listing.bedroomCount),
            bathrooms: normalizeFreeText(listing.bathroomCount),
            parking,
            suburb: normalizeFreeText(listing.suburb),
            cityProvince,
            description,
            keyFeatures: uniqueNonEmpty([listing.descriptiveFeature, ...listing.features]),
            mandateOrStatus: statusDetail,
            listingNumber: String(listing.listingNumber ?? listing.id),
            agentListingLink: listingLink ?? '',
            agentFirstName: profile.firstName || profile.agentName.split(/\s+/)[0] || 'Agent',
            agentFullName: profile.agentName,
            agentPhone: profile.agentPhone,
            agentEmail: profile.agentEmail,
            marketCentreName: normalizeFreeText(profile.marketCentre),
        },
        listingLink,
    };
}
function buildMarketingFileName(propertyAddress) {
    const safeBase = (propertyAddress || 'property-address')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
    return `Marketing_Plan_${safeBase || 'property_address'}.docx`;
}
async function getBufferFromStoredUrl(fileUrl) {
    if (fileUrl.startsWith('/uploads/')) {
        const localPath = path.join(storageConfig.uploadsDir, fileUrl.replace(/^\/uploads\//, ''));
        if (!fs.existsSync(localPath)) {
            throw new Error('Stored file was not found on local disk.');
        }
        const buffer = fs.readFileSync(localPath);
        return { buffer, fileName: path.basename(localPath) };
    }
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
        throw new Error('Failed to download the selected CMA document.');
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const nameMatch = /filename="?([^";\n]+)"?/i.exec(disposition);
    const remoteName = path.basename(new URL(fileUrl).pathname);
    const fileName = nameMatch?.[1] ?? (remoteName || 'selected-cma.docx');
    return { buffer: Buffer.from(await res.arrayBuffer()), fileName };
}
async function fetchLogoBuffer(url) {
    try {
        if (url.startsWith('/uploads/')) {
            const localPath = path.join(storageConfig.uploadsDir, url.replace(/^\/uploads\//, ''));
            if (!fs.existsSync(localPath))
                return null;
            return fs.readFileSync(localPath);
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok)
            return null;
        return Buffer.from(await res.arrayBuffer());
    }
    catch {
        return null;
    }
}
router.get('/profile', async (req, res) => {
    const { email, name } = req.user;
    try {
        const profile = await resolveAgentProfile(email, name);
        if (profile) {
            res.json({ profile, partial: false });
            return;
        }
        res.json({
            profile: {
                associateDbId: null,
                firstName: name?.trim().split(/\s+/)[0] ?? '',
                agentName: name ?? email,
                agentEmail: email,
                agentPhone: '',
                agentTitle: '',
                marketCentre: '',
                logoUrl: null,
                whiteLogoUrl: null,
                kwuid: null,
            },
            partial: true,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load agent profile.' });
    }
});
router.get('/cma-history', async (req, res) => {
    await ensureCmaTable();
    const email = req.user.email;
    try {
        const pool = getRequiredPgPool();
        const result = await pool.query(`SELECT id, property_address, seller_name,
              seller_first_name, seller_last_name, seller_email, seller_phone,
              loom_file_url, loom_original_name,
              file_name, file_url, created_at::text
         FROM public.cma_documents
        WHERE LOWER(associate_email) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 100`, [email]);
        res.json({ items: result.rows });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load CMA history.' });
    }
});
router.post('/generate', (req, res, next) => {
    uploadDocs.fields([
        { name: 'loomReport', maxCount: 1 },
        { name: 'cmaDocument', maxCount: 1 },
    ])(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        next();
    });
}, async (req, res) => {
    await ensureTable();
    const files = req.files;
    const loomFile = files?.loomReport?.[0];
    const uploadedCmaFile = files?.cmaDocument?.[0];
    const body = req.body;
    const selectedCmaIdRaw = body.selectedCmaId?.trim() ?? '';
    const selectedCmaId = selectedCmaIdRaw ? Number(selectedCmaIdRaw) : null;
    if (!uploadedCmaFile?.buffer && !selectedCmaId) {
        res.status(400).json({ error: 'Please upload a CMA document or select one from your generated CMA history.' });
        return;
    }
    if (!body.propertyAddress?.trim()) {
        res.status(400).json({ error: 'Property Address is required.' });
        return;
    }
    const email = req.user.email;
    const requestId = crypto.randomBytes(4).toString('hex');
    const startedAt = Date.now();
    let stage = 'start';
    // Lazy-load OpenAI/PDF parsing module only when this endpoint is called.
    // This keeps backend startup fast and avoids blocking login if that module stalls on import.
    const { generateMarketingPlanData } = await import('../services/openai-marketing.js');
    req.on('close', () => {
        if (!res.writableEnded) {
            logger.warn({ requestId, email, stage }, 'Marketing plan request closed by client before completion');
        }
    });
    try {
        stage = 'resolve-profile';
        const { name } = req.user;
        const profile = await resolveAgentProfile(email, name);
        const logoBuffer = profile?.logoUrl ? await fetchLogoBuffer(profile.logoUrl) : null;
        let cmaBuffer;
        let cmaFileName;
        let sourceCmaId = null;
        let storedLoomUrl = null;
        let storedLoomOriginalName = null;
        if (uploadedCmaFile?.buffer) {
            stage = 'use-uploaded-cma';
            cmaBuffer = uploadedCmaFile.buffer;
            cmaFileName = uploadedCmaFile.originalname;
        }
        else {
            stage = 'load-selected-cma';
            const pool = getRequiredPgPool();
            const cmaRow = await pool.query(`SELECT id, file_url, file_name, loom_file_url, loom_original_name
             FROM public.cma_documents
            WHERE id = $1 AND LOWER(associate_email) = LOWER($2)
            LIMIT 1`, [selectedCmaId, email]);
            if (!cmaRow.rows[0]) {
                res.status(404).json({ error: 'Selected CMA was not found for your user profile.' });
                return;
            }
            const downloaded = await getBufferFromStoredUrl(cmaRow.rows[0].file_url);
            cmaBuffer = downloaded.buffer;
            cmaFileName = cmaRow.rows[0].file_name || downloaded.fileName;
            sourceCmaId = cmaRow.rows[0].id;
            storedLoomUrl = cmaRow.rows[0].loom_file_url;
            storedLoomOriginalName = cmaRow.rows[0].loom_original_name;
        }
        // Resolve LOOM: fresh upload takes priority, fall back to stored LOOM from selected CMA
        let loomBuffer;
        let loomOriginalName;
        if (loomFile?.buffer) {
            stage = 'use-uploaded-loom';
            loomBuffer = loomFile.buffer;
            loomOriginalName = loomFile.originalname;
        }
        else if (storedLoomUrl) {
            stage = 'load-stored-loom';
            const fetched = await getBufferFromStoredUrl(storedLoomUrl);
            loomBuffer = fetched.buffer;
            loomOriginalName = storedLoomOriginalName || fetched.fileName;
        }
        else {
            res.status(400).json({ error: 'Please upload the LOOM report, or select a CMA that already has a saved LOOM report.' });
            return;
        }
        const formData = {
            agentName: body.agentName?.trim() || profile?.agentName || email,
            agencyBrand: body.agencyBrand?.trim() || profile?.marketCentre || '',
            agentPhone: body.agentPhone?.trim() || profile?.agentPhone || '',
            agentEmail: body.agentEmail?.trim() || profile?.agentEmail || email,
            propertyAddress: body.propertyAddress?.trim() ?? '',
            suburbArea: body.suburbArea?.trim() ?? '',
            sellerName: body.sellerName?.trim() ?? '',
            sellerSurname: body.sellerSurname?.trim() ?? '',
            sellerEmail: body.sellerEmail?.trim() ?? '',
            sellerPhone: body.sellerPhone?.trim() ?? '',
            customPromptInput: body.customPromptInput?.trim() ?? '',
        };
        stage = 'generate-marketing-data';
        const marketingPlanData = await generateMarketingPlanData({
            formData,
            cmaBuffer,
            cmaOriginalName: cmaFileName,
            loomReportBuffer: loomBuffer,
            loomReportOriginalName: loomOriginalName,
        });
        stage = 'build-docx';
        const docxBuffer = await buildMarketingPlanDocument({ marketingPlanData, formData, logoBuffer });
        const fileName = buildMarketingFileName(formData.propertyAddress);
        let fileUrl;
        if (storageConfig.localUploadsEnabled) {
            stage = 'store-local';
            const uploadsDir = path.join(storageConfig.uploadsDir, 'marketing-plans');
            fs.mkdirSync(uploadsDir, { recursive: true });
            const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
            const localPath = path.join(uploadsDir, uniqueName);
            fs.writeFileSync(localPath, docxBuffer);
            fileUrl = `/uploads/marketing-plans/${uniqueName}`;
        }
        else {
            stage = 'store-gcs';
            const result = await uploadToGcs(docxBuffer, fileName, 'marketing-plans', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            fileUrl = result.publicUrl;
        }
        stage = 'insert-db-record';
        const pool = getRequiredPgPool();
        await pool.query(`INSERT INTO public.marketing_plan_documents
          (associate_email, associate_db_id, property_address, seller_name, source_cma_id, file_name, file_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            email,
            profile?.associateDbId ?? null,
            formData.propertyAddress || null,
            [formData.sellerName, formData.sellerSurname].filter(Boolean).join(' ') || null,
            sourceCmaId,
            fileName,
            fileUrl,
        ]);
        stage = 'send-response';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(docxBuffer);
        logger.info({
            requestId,
            email,
            selectedCmaId,
            sourceCmaId,
            durationMs: Date.now() - startedAt,
            fileName,
            fileUrl,
        }, 'Marketing plan generated successfully');
    }
    catch (error) {
        logger.error({
            requestId,
            email,
            selectedCmaId,
            stage,
            durationMs: Date.now() - startedAt,
            err: error,
        }, 'Marketing plan generation failed');
        res.status(500).json({
            error: error.message || 'Failed to generate marketing plan.',
            requestId,
            stage,
        });
    }
});
router.get('/history', async (req, res) => {
    await ensureTable();
    const email = req.user.email;
    try {
        const pool = getRequiredPgPool();
        const result = await pool.query(`SELECT id, property_address, seller_name, source_cma_id, file_name, file_url, created_at::text
         FROM public.marketing_plan_documents
        WHERE LOWER(associate_email) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 100`, [email]);
        res.json({ items: result.rows });
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load marketing plan history.' });
    }
});
router.get('/listings/:listingId/social-copy', resolvePermissions, async (req, res) => {
    await ensureSocialCopyTable();
    const listingId = Number(req.params.listingId);
    if (!Number.isFinite(listingId)) {
        res.status(400).json({ error: 'Invalid listing id.' });
        return;
    }
    const platform = normalizeSocialCopyPlatform(req.query.platform);
    const statusPill = normalizeSocialCopyStatusPill(req.query.statusPill ?? req.query.status_pill);
    if (!platform || !statusPill) {
        res.status(400).json({ error: 'Valid platform and statusPill are required.' });
        return;
    }
    const perms = req.permissions;
    if (!perms) {
        res.status(403).json({ error: 'Permission denied.' });
        return;
    }
    const access = await resolveListingForSocialCopy(listingId, perms);
    if (access.notFound) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
    }
    if (!access.allowed) {
        res.status(403).json({ error: 'Permission denied for this listing.' });
        return;
    }
    const record = await findSocialCopyRecord(listingId, platform, statusPill);
    if (!record) {
        res.json({ item: null });
        return;
    }
    if (!record.edited_copy?.trim()) {
        const profile = await resolveAgentProfile(req.user.email, req.user.name);
        if (profile && access.listing) {
            const { promptData } = buildListingSocialPromptData(access.listing, profile, platform, statusPill, record.tone, record.include_emojis, record.include_hashtags);
            const validation = validateGeneratedSocialCopy(record.generated_copy, promptData);
            if (!validation.valid) {
                try {
                    const repaired = await repairInvalidStoredSocialCopy(record, access.listing, profile);
                    res.json({ item: serializeSocialCopyRecord(repaired) });
                    return;
                }
                catch {
                    await deleteSocialCopyRecord(record.id);
                    res.json({ item: null, repaired: false, invalidated: true });
                    return;
                }
            }
        }
    }
    res.json({ item: serializeSocialCopyRecord(record) });
});
router.post('/listings/:listingId/social-copy/generate', resolvePermissions, async (req, res) => {
    await ensureSocialCopyTable();
    const listingId = Number(req.params.listingId);
    if (!Number.isFinite(listingId)) {
        res.status(400).json({ error: 'Invalid listing id.' });
        return;
    }
    const platform = normalizeSocialCopyPlatform(req.body?.platform);
    const statusPill = normalizeSocialCopyStatusPill(req.body?.statusPill ?? req.body?.status_pill);
    const tone = normalizeSocialCopyTone(req.body?.tone);
    if (!platform || !statusPill || !tone) {
        res.status(400).json({ error: 'Valid platform, statusPill, and tone are required.' });
        return;
    }
    const perms = req.permissions;
    if (!perms) {
        res.status(403).json({ error: 'Permission denied.' });
        return;
    }
    const access = await resolveListingForSocialCopy(listingId, perms);
    if (access.notFound) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
    }
    if (!access.allowed) {
        res.status(403).json({ error: 'Permission denied for this listing.' });
        return;
    }
    if (!access.listing) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
    }
    const existingRecord = await findSocialCopyRecord(listingId, platform, statusPill);
    if (existingRecord) {
        if (!existingRecord.edited_copy?.trim()) {
            const profile = await resolveAgentProfile(req.user.email, req.user.name);
            if (profile && access.listing) {
                const { promptData } = buildListingSocialPromptData(access.listing, profile, platform, statusPill, existingRecord.tone, existingRecord.include_emojis, existingRecord.include_hashtags);
                const validation = validateGeneratedSocialCopy(existingRecord.generated_copy, promptData);
                if (!validation.valid) {
                    try {
                        const repaired = await repairInvalidStoredSocialCopy(existingRecord, access.listing, profile);
                        res.json({ item: serializeSocialCopyRecord(repaired), generated: false, repaired: true });
                        return;
                    }
                    catch {
                        await deleteSocialCopyRecord(existingRecord.id);
                    }
                }
            }
        }
        res.json({ item: serializeSocialCopyRecord(existingRecord), generated: false });
        return;
    }
    try {
        const profile = await resolveAgentProfile(req.user.email, req.user.name);
        if (!profile) {
            res.status(400).json({ error: 'Could not resolve the logged-in agent profile for social copy generation.' });
            return;
        }
        const { promptData, listingLink } = buildListingSocialPromptData(access.listing, profile, platform, statusPill, tone, parseBooleanFlag(req.body?.includeEmojis), parseBooleanFlag(req.body?.includeHashtags));
        if (!listingLink) {
            res.status(400).json({ error: 'The logged-in agent KWUID or listing number is missing, so the KWHomes link could not be built.' });
            return;
        }
        if (!normalizeFreeText(profile.agentPhone) || !normalizeFreeText(profile.agentEmail)) {
            res.status(400).json({ error: 'The logged-in agent profile is missing phone or email details required for social copy.' });
            return;
        }
        const generatedCopy = await generateListingSocialCopy(promptData);
        const pool = getRequiredPgPool();
        const inserted = await pool.query(`INSERT INTO migration.listing_social_ai_copy
        (listing_id, agent_id, platform, status_pill, tone, include_emojis, include_hashtags, generated_copy, edited_copy, listing_link, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, NOW(), NOW())
       RETURNING id, listing_id, agent_id, platform, status_pill, tone, include_emojis, include_hashtags,
                 generated_copy, edited_copy, listing_link, created_by, created_at::text, updated_at::text`, [
            listingId,
            profile.associateDbId ? Number(profile.associateDbId) : null,
            platform,
            statusPill,
            tone,
            parseBooleanFlag(req.body?.includeEmojis),
            parseBooleanFlag(req.body?.includeHashtags),
            generatedCopy,
            listingLink,
            req.user.email,
        ]);
        res.status(201).json({ item: serializeSocialCopyRecord(inserted.rows[0]), generated: true });
    }
    catch (error) {
        const pgCode = typeof error === 'object' && error && 'code' in error ? String(error.code ?? '') : '';
        if (pgCode === '23505') {
            const record = await findSocialCopyRecord(listingId, platform, statusPill);
            res.json({ item: record ? serializeSocialCopyRecord(record) : null, generated: false });
            return;
        }
        const message = error instanceof Error ? error.message : 'Failed to generate social copy.';
        const statusCode = /OPENAI_SOCIAL_COPY_API_KEY/.test(message) ? 503 : 500;
        res.status(statusCode).json({ error: message });
    }
});
router.put('/listings/:listingId/social-copy', resolvePermissions, async (req, res) => {
    await ensureSocialCopyTable();
    const listingId = Number(req.params.listingId);
    if (!Number.isFinite(listingId)) {
        res.status(400).json({ error: 'Invalid listing id.' });
        return;
    }
    const platform = normalizeSocialCopyPlatform(req.body?.platform);
    const statusPill = normalizeSocialCopyStatusPill(req.body?.statusPill ?? req.body?.status_pill);
    const tone = normalizeSocialCopyTone(req.body?.tone);
    const editedCopy = normalizeFreeText(req.body?.editedCopy ?? req.body?.edited_copy);
    if (!platform || !statusPill || !tone || !editedCopy) {
        res.status(400).json({ error: 'Valid platform, statusPill, tone, and editedCopy are required.' });
        return;
    }
    const perms = req.permissions;
    if (!perms) {
        res.status(403).json({ error: 'Permission denied.' });
        return;
    }
    const access = await resolveListingForSocialCopy(listingId, perms);
    if (access.notFound) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
    }
    if (!access.allowed) {
        res.status(403).json({ error: 'Permission denied for this listing.' });
        return;
    }
    const pool = getRequiredPgPool();
    const updated = await pool.query(`UPDATE migration.listing_social_ai_copy
        SET edited_copy = $4,
            tone = $5,
            include_emojis = $6,
            include_hashtags = $7,
            updated_at = NOW()
      WHERE listing_id = $1
        AND platform = $2
        AND status_pill = $3
      RETURNING id, listing_id, agent_id, platform, status_pill, tone, include_emojis, include_hashtags,
                generated_copy, edited_copy, listing_link, created_by, created_at::text, updated_at::text`, [
        listingId,
        platform,
        statusPill,
        editedCopy,
        tone,
        parseBooleanFlag(req.body?.includeEmojis),
        parseBooleanFlag(req.body?.includeHashtags),
    ]);
    if (!updated.rows[0]) {
        res.status(404).json({ error: 'No generated social copy exists yet for this listing, platform, and status.' });
        return;
    }
    res.json({ item: serializeSocialCopyRecord(updated.rows[0]) });
});
export default router;
//# sourceMappingURL=marketing.js.map