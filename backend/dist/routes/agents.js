import { Router } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { scheduleTransactionAgentRecompute } from '../services/transactionRecomputeQueue.js';
import { getOptionalPgPool } from '../config/db.js';
import { ensureLocalUploadDirs, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { clearAssociateAccessCache } from '../middleware/requireAuth.js';
import { getTodayInAppTimeZone } from '../utils/timeZone.js';
const router = Router();
const pool = getOptionalPgPool();
const LOCAL_ASSOCIATE_SUSPENSION_ENABLED = String(process.env.LOCAL_ASSOCIATE_SUSPENSION_ENABLED ?? 'false').trim().toLowerCase() === 'true';
// File upload setup
const imagesDir = resolveLocalUploadDir('images');
const documentsDir = resolveLocalUploadDir('documents');
// Ensure upload directories exist
async function ensureUploadDirs() {
    try {
        await ensureLocalUploadDirs('images', 'documents');
    }
    catch (error) {
        console.error('Failed to create upload directories:', error);
    }
}
// Initialize directories on module load
await ensureUploadDirs();
// Image uploads must be processed by Sharp before persisting, so keep them in memory.
const imageStorageEngine = multer.memoryStorage();
const documentStorageEngine = storageConfig.localUploadsEnabled
    ? multer.diskStorage({
        destination: documentsDir,
        filename: (_req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
            const ext = path.extname(file.originalname);
            cb(null, `doc-${uniqueSuffix}${ext}`);
        },
    })
    : multer.memoryStorage();
const uploadImage = multer({
    storage: imageStorageEngine,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB - aligned with portal requirements
    fileFilter: (_req, file, cb) => {
        // Portal requirement: JPEG only
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
            cb(null, true);
        }
        else {
            cb(new Error('Only JPEG images are allowed. Please convert your image to JPEG format.'));
        }
    },
});
const uploadDocument = multer({
    storage: documentStorageEngine,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, JPEG, and PNG files are allowed'));
        }
    },
});
// Helper function to compress and validate agent image (1080x1080px JPEG, max 2MB for portals)
async function processAgentImage(inputBuffer) {
    const maxDimension = 1080;
    const maxFileSize = 2 * 1024 * 1024; // 2MB
    try {
        // Get image metadata
        const metadata = await sharp(inputBuffer).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width === 0 || height === 0) {
            throw new Error('Invalid image dimensions');
        }
        // Check if image needs resizing to square
        let pipeline = sharp(inputBuffer);
        // If not square, resize and add white background to make it square
        if (width !== height) {
            const size = Math.max(width, height);
            pipeline = pipeline
                .resize(size, size, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
            });
        }
        // Resize to 1080x1080 if larger
        if (width > maxDimension || height > maxDimension) {
            pipeline = pipeline.resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true });
        }
        // Convert to JPEG with high quality but compressed for portals
        const compressedBuffer = await pipeline
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
        if (compressedBuffer.length > maxFileSize) {
            throw new Error(`Compressed image exceeds 2MB limit (${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB). Please use a lower resolution image.`);
        }
        return {
            buffer: compressedBuffer,
            width: maxDimension,
            height: maxDimension,
            size: compressedBuffer.length,
        };
    }
    catch (error) {
        if (error instanceof Error) {
            throw new Error(`Image processing failed: ${error.message}`);
        }
        throw error;
    }
}
async function runUploadMiddleware(req, res, middleware) {
    await new Promise((resolve, reject) => {
        middleware(req, res, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
function toText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toEmail(value) {
    const text = toText(value);
    if (!text)
        return null;
    const compact = text.replace(/\s+/g, '');
    return compact.length > 0 ? compact : null;
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function toDate(value) {
    const text = toText(value);
    if (!text)
        return null;
    const d = new Date(text);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString().slice(0, 10);
}
function firstOfNextMonthFromDateText(dateText) {
    const [yearText, monthText] = dateText.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return dateText;
    }
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}
function toBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }
    if (typeof value === 'number')
        return value === 1;
    return false;
}
function toNullableBool(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (value === 1)
            return true;
        if (value === 0)
            return false;
        return null;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized || normalized === 'not applicable' || normalized === 'n/a' || normalized === 'na')
            return null;
        if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on')
            return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off')
            return false;
    }
    return null;
}
function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => toText(entry))
        .filter((entry) => Boolean(entry));
}
function normalizeListKey(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
function uniqueNormalizedStrings(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed)
            continue;
        const key = normalizeListKey(trimmed);
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(trimmed);
    }
    return output;
}
function normalizeIdentifier(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function resolveEffectiveScopeMarketCenterId(perms) {
    const value = perms.homeMcId ?? perms.marketCenterId ?? null;
    return value && value.trim().length > 0 ? value.trim() : null;
}
async function resolveMarketCenterScopeMatch(client, targetAssociateId, activeMarketCenterId) {
    const targetResult = await client.query(`SELECT
       COALESCE(NULLIF(TRIM(a.source_market_center_id), ''), NULLIF(TRIM(mc.source_market_center_id), '')) AS source_market_center_id,
       a.market_center_id::text AS market_center_id
     FROM migration.core_associates a
     LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
     WHERE a.id = $1
     LIMIT 1`, [targetAssociateId]);
    const target = targetResult.rows[0];
    if (!target) {
        return { allowed: false, notFound: true };
    }
    const activeMcRaw = String(activeMarketCenterId ?? '').trim();
    const activeMcNorm = normalizeIdentifier(activeMcRaw);
    const targetSourceNorm = normalizeIdentifier(target.source_market_center_id);
    let activeMcDbId = null;
    let activeResolvedSourceNorm = '';
    const activeBySource = await client.query(`SELECT id::text AS id, source_market_center_id
       FROM migration.core_market_centers
      WHERE source_market_center_id = $1
      LIMIT 1`, [activeMcRaw]);
    if (activeBySource.rows[0]) {
        activeMcDbId = Number(activeBySource.rows[0].id);
        activeResolvedSourceNorm = normalizeIdentifier(activeBySource.rows[0].source_market_center_id);
    }
    else {
        const activeById = await client.query(`SELECT id::text AS id, source_market_center_id
         FROM migration.core_market_centers
        WHERE id::text = $1
        LIMIT 1`, [activeMcRaw]);
        if (activeById.rows[0]) {
            activeMcDbId = Number(activeById.rows[0].id);
            activeResolvedSourceNorm = normalizeIdentifier(activeById.rows[0].source_market_center_id);
        }
    }
    const targetMcDbId = target.market_center_id ? Number(target.market_center_id) : null;
    const sourceMatch = Boolean(targetSourceNorm) && (targetSourceNorm === activeMcNorm
        || (Boolean(activeResolvedSourceNorm) && targetSourceNorm === activeResolvedSourceNorm));
    const dbIdMatch = activeMcDbId !== null && targetMcDbId !== null && activeMcDbId === targetMcDbId;
    return { allowed: sourceMatch || dbIdMatch, notFound: false };
}
async function resolveAdminMarketCenterIds(client, values) {
    const requested = uniqueNormalizedStrings(values);
    if (requested.length === 0)
        return [];
    const result = await client.query(`SELECT
       input.raw_value,
       resolved.source_market_center_id
     FROM UNNEST($1::text[]) AS input(raw_value)
     LEFT JOIN LATERAL (
       SELECT mc.source_market_center_id, mc.id
       FROM migration.core_market_centers mc
       WHERE LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(input.raw_value))
          OR LOWER(TRIM(COALESCE(mc.name, ''))) = LOWER(TRIM(input.raw_value))
       ORDER BY
         CASE
           WHEN LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(input.raw_value)) THEN 0
           ELSE 1
         END,
         mc.id ASC
       LIMIT 1
     ) resolved ON TRUE`, [requested]);
    return uniqueNormalizedStrings(result.rows.map((row) => (row.source_market_center_id ?? row.raw_value).trim()).filter(Boolean));
}
/** Strip all whitespace from a phone number string before persisting. */
function toPhone(value) {
    const text = toText(value);
    if (!text)
        return null;
    return text.replace(/\s+/g, '') || null;
}
function normalizeProperty24Fields(property24OptIn, rawAgentProperty24Id, rawProperty24Status) {
    if (!property24OptIn) {
        return {
            agentProperty24Id: null,
            property24Status: 'Not opted in',
        };
    }
    const directId = toText(rawAgentProperty24Id);
    const statusText = toText(rawProperty24Status);
    const statusNumericId = statusText && /^\d+$/.test(statusText) ? statusText : null;
    const agentProperty24Id = directId ?? statusNumericId;
    return {
        agentProperty24Id,
        property24Status: statusText ?? (agentProperty24Id ? 'Registered' : 'Pending registration'),
    };
}
function toSocialMediaEntries(value) {
    if (!Array.isArray(value))
        return [];
    const parsed = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object')
            continue;
        const raw = entry;
        const platform = toText(raw.platform);
        const url = toText(raw.url);
        if (!platform && !url)
            continue;
        parsed.push({ platform, url });
    }
    return parsed;
}
function toDocumentEntries(value) {
    if (!Array.isArray(value))
        return [];
    const parsed = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object')
            continue;
        const raw = entry;
        const documentType = toText(raw.document_type);
        if (!documentType)
            continue;
        parsed.push({
            document_type: documentType,
            document_name: toText(raw.document_name),
            document_url: toText(raw.document_url),
        });
    }
    return parsed;
}
function buildManualAssociateId() {
    const ts = Date.now().toString();
    const rand = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    return `MAN-ASSOC-${ts}-${rand}`;
}
const HOME_TRANSACTION_STATUSES = ['Start', 'Working', 'Submitted', 'Pending', 'Registered'];
async function ensureAssociateAccessSuspensionTable() {
    if (!pool || !LOCAL_ASSOCIATE_SUSPENSION_ENABLED)
        return;
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migration.associate_access_suspension (
      associate_id BIGINT PRIMARY KEY REFERENCES migration.core_associates(id) ON DELETE CASCADE,
      is_temporarily_suspended BOOLEAN NOT NULL DEFAULT false,
      suspended_reason TEXT NULL,
      suspended_by_email TEXT NULL,
      suspended_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
async function getMappAccessPayload(associateId) {
    if (!pool || !LOCAL_ASSOCIATE_SUSPENSION_ENABLED) {
        return {
            feature_enabled: LOCAL_ASSOCIATE_SUSPENSION_ENABLED,
            is_temporarily_suspended: false,
            suspended_reason: null,
            suspended_by_email: null,
            suspended_at: null,
        };
    }
    await ensureAssociateAccessSuspensionTable();
    const suspension = await pool.query(`
    SELECT
      is_temporarily_suspended,
      suspended_reason,
      suspended_by_email,
      suspended_at::text
    FROM migration.associate_access_suspension
    WHERE associate_id = $1
    LIMIT 1
    `, [associateId]);
    const row = suspension.rows[0];
    return {
        feature_enabled: LOCAL_ASSOCIATE_SUSPENSION_ENABLED,
        is_temporarily_suspended: Boolean(row?.is_temporarily_suspended),
        suspended_reason: row?.suspended_reason ?? null,
        suspended_by_email: row?.suspended_by_email ?? null,
        suspended_at: row?.suspended_at ?? null,
    };
}
async function resolveCurrentAssociateByEmail(userEmail) {
    if (!pool)
        return null;
    const associateResult = await pool.query(`
    SELECT a.id::text, a.kwuid
    FROM migration.core_associates a
    WHERE LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1
       OR (
         LOWER(TRIM(COALESCE(a.email, ''))) = $1
         AND LOWER(TRIM(COALESCE(a.email, ''))) LIKE '%@kwsa.co.za'
       )
    ORDER BY
      CASE
        WHEN LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1 THEN 0
        ELSE 1
      END,
      a.updated_at DESC,
      a.id DESC
    LIMIT 1
    `, [userEmail]);
    const row = associateResult.rows[0];
    if (!row)
        return null;
    const id = Number(row.id);
    if (!Number.isFinite(id))
        return null;
    return { id, kwuid: row.kwuid ?? null };
}
async function fetchFeaturedListingsForAssociate(associateId) {
    if (!pool)
        return [];
    const result = await pool.query(`
    SELECT
      cl.id::text AS listing_id,
      cl.listing_number,
      cl.status_name,
      cl.listing_status_tag,
      cl.address_line,
      cl.suburb,
      cl.city,
      cl.price::text,
      CASE
        WHEN cl.listing_images_json IS NOT NULL
          AND cl.listing_images_json::text NOT IN ('[]', 'null', '')
        THEN (
          SELECT value
          FROM jsonb_array_elements_text(cl.listing_images_json) AS value
          WHERE COALESCE(TRIM(value), '') <> ''
          LIMIT 1
        )
        ELSE (
          SELECT li.file_url
          FROM migration.listing_images li
          WHERE li.listing_id = cl.id
            AND COALESCE(TRIM(li.file_url), '') <> ''
          ORDER BY li.sort_order ASC, li.id ASC
          LIMIT 1
        )
      END AS main_image_url
    FROM migration.associate_featured_listings afl
    INNER JOIN migration.core_listings cl ON cl.id = afl.listing_id
    WHERE afl.associate_id = $1
    ORDER BY afl.id ASC
    `, [associateId]);
    return result.rows
        .map((row) => {
        const listingId = Number(row.listing_id);
        if (!Number.isFinite(listingId))
            return null;
        return {
            listingId,
            listingNumber: row.listing_number,
            statusName: row.status_name,
            listingStatusTag: row.listing_status_tag,
            addressLine: row.address_line,
            suburb: row.suburb,
            city: row.city,
            price: row.price !== null ? Number(row.price) : null,
            mainImageUrl: row.main_image_url,
            selected: true,
        };
    })
        .filter((row) => Boolean(row));
}
async function saveCollections(client, associateId, body) {
    const socialMedia = toSocialMediaEntries(body.social_media);
    const roles = uniqueNormalizedStrings(toStringArray(body.roles));
    const jobTitles = uniqueNormalizedStrings(toStringArray(body.job_titles));
    const serviceCommunities = uniqueNormalizedStrings(toStringArray(body.service_communities));
    const adminMarketCenters = await resolveAdminMarketCenterIds(client, toStringArray(body.admin_market_centers));
    const adminTeams = uniqueNormalizedStrings(toStringArray(body.admin_teams));
    const commissionNotes = toStringArray(body.commission_notes);
    const dateNotes = toStringArray(body.date_notes);
    const documentNotes = toStringArray(body.document_notes);
    const documents = toDocumentEntries(body.documents);
    await client.query(`DELETE FROM migration.associate_social_media WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_roles WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_job_titles WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_service_communities WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_admin_market_centers WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_admin_teams WHERE associate_id = $1`, [associateId]);
    await client.query(`DELETE FROM migration.associate_documents WHERE associate_id = $1`, [associateId]);
    for (let i = 0; i < socialMedia.length; i += 1) {
        await client.query(`INSERT INTO migration.associate_social_media (associate_id, platform, url, sort_order)
       VALUES ($1, $2, $3, $4)`, [associateId, socialMedia[i].platform, socialMedia[i].url, i]);
    }
    for (const role of roles) {
        await client.query(`INSERT INTO migration.associate_roles (associate_id, role_name) VALUES ($1, $2)`, [associateId, role]);
    }
    for (const title of jobTitles) {
        await client.query(`INSERT INTO migration.associate_job_titles (associate_id, job_title) VALUES ($1, $2)`, [associateId, title]);
    }
    for (const community of serviceCommunities) {
        await client.query(`INSERT INTO migration.associate_service_communities (associate_id, community_name) VALUES ($1, $2)`, [associateId, community]);
    }
    for (const sourceMarketCenterId of adminMarketCenters) {
        await client.query(`INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id)
       VALUES ($1, $2)`, [associateId, sourceMarketCenterId]);
    }
    for (const sourceTeamId of adminTeams) {
        await client.query(`INSERT INTO migration.associate_admin_teams (associate_id, source_team_id)
       VALUES ($1, $2)`, [associateId, sourceTeamId]);
    }
    for (const document of documents) {
        await client.query(`INSERT INTO migration.associate_documents (associate_id, document_type, document_name, document_url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)`, [associateId, document.document_type, document.document_name, document.document_url, 'console-user']);
    }
    for (const note of commissionNotes) {
        await client.query(`INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'commission', $2, $3)`, [associateId, note, 'console-user']);
    }
    for (const note of dateNotes) {
        await client.query(`INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'dates', $2, $3)`, [associateId, note, 'console-user']);
    }
    for (const note of documentNotes) {
        await client.query(`INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'documents', $2, $3)`, [associateId, note, 'console-user']);
    }
}
router.get('/options', async (_req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    try {
        const result = await pool.query(`
      SELECT
        a.id::text AS id,
        a.source_associate_id,
        a.full_name,
        a.source_market_center_id,
        a.market_center_id::text AS market_center_id,
        mc.name AS market_center_name
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      ORDER BY a.full_name ASC NULLS LAST, a.source_associate_id ASC
      `);
        return res.json({
            items: result.rows.map((row) => ({
                id: row.id,
                source_associate_id: row.source_associate_id,
                full_name: row.full_name,
                source_market_center_id: row.source_market_center_id,
                market_center_id: row.market_center_id,
                market_center_name: row.market_center_name,
            })),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/me/home', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    const activeContextId = req.headers['x-active-context']?.trim().toLowerCase() ?? '';
    const isTeamContext = /^(lead_agent|team_agent|team_admin)(_.+)?$/.test(activeContextId);
    try {
        const associateResult = await pool.query(`
      SELECT
        a.id::text,
        a.source_associate_id,
        a.kwuid,
        a.full_name,
        a.status_name,
        a.listing_approval_required,
        a.kwsa_email,
        a.private_email,
        a.email,
        a.source_market_center_id,
        a.source_team_id,
        ct.id::text AS team_id,
        ct.name AS team_name,
        mc.name AS market_center_name,
        mc.logo_image_url AS market_center_logo_image_url,
        mc.document_logo_image_url AS market_center_document_logo_image_url
      FROM migration.core_associates a
      LEFT JOIN migration.core_teams ct ON ct.source_team_id = a.source_team_id
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      WHERE LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1
         OR (
           LOWER(TRIM(COALESCE(a.email, ''))) = $1
           AND LOWER(TRIM(COALESCE(a.email, ''))) LIKE '%@kwsa.co.za'
         )
      ORDER BY
        CASE
          WHEN LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1 THEN 0
          ELSE 1
        END,
        a.updated_at DESC,
        a.id DESC
      LIMIT 1
      `, [userEmail]);
        const associate = associateResult.rows[0] ?? null;
        const statusDefaults = HOME_TRANSACTION_STATUSES.map((status) => ({
            status,
            total_transactions: 0,
            total_gci: 0,
        }));
        if (!associate) {
            return res.json({
                generated_at: new Date().toISOString(),
                email: userEmail,
                associate: null,
                market_center: null,
                cap_type: 'individual',
                team_name: null,
                cap: {
                    period_start_date: null,
                    period_end_date: null,
                    total_cap_amount: 0,
                    cap_achieved: 0,
                    cap_remaining: 0,
                    progress_pct: 0,
                },
                active_listings: {
                    total: 0,
                    items: [],
                },
                registered_mtd: {
                    total_transactions: 0,
                    total_gci: 0,
                },
                transactions_by_status: statusDefaults,
            });
        }
        const associateId = Number(associate.id);
        let resolvedTeamSourceId = associate.source_team_id ?? null;
        let resolvedTeamDbId = associate.team_id ? Number(associate.team_id) : null;
        let resolvedTeamName = associate.team_name ?? null;
        if (isTeamContext && Number.isFinite(associateId)) {
            const contextMatch = /^(lead_agent|team_agent|team_admin)(?:_(.+))?$/.exec(activeContextId);
            const teamToken = contextMatch?.[2]?.trim() ?? '';
            const allowedTeamsResult = await pool.query(`WITH allowed_source_teams AS (
           SELECT source_team_id
           FROM migration.core_associates
           WHERE id = $1::bigint
             AND source_team_id IS NOT NULL
           UNION
           SELECT source_team_id
           FROM migration.associate_admin_teams
           WHERE associate_id = $1::bigint
         )
         SELECT
           t.source_team_id,
           t.id::text AS team_db_id,
           t.name AS team_name
         FROM migration.core_teams t
         INNER JOIN allowed_source_teams a ON a.source_team_id = t.source_team_id`, [associateId]);
            const normalize = (value) => (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
            const normalizedToken = normalize(teamToken);
            const matchedTeam = normalizedToken
                ? allowedTeamsResult.rows.find((row) => normalize(row.source_team_id) === normalizedToken || normalize(row.team_db_id) === normalizedToken)
                : allowedTeamsResult.rows.find((row) => (row.source_team_id ?? '').trim().length > 0);
            if (matchedTeam) {
                resolvedTeamSourceId = matchedTeam.source_team_id ?? resolvedTeamSourceId;
                resolvedTeamDbId = matchedTeam.team_db_id ? Number(matchedTeam.team_db_id) : resolvedTeamDbId;
                resolvedTeamName = matchedTeam.team_name ?? resolvedTeamName;
            }
        }
        const useTeamCap = isTeamContext && !!resolvedTeamSourceId;
        // ── TEAM CAP BRANCH ────────────────────────────────────────────────────
        if (useTeamCap) {
            const [teamCapResult, listingCountResult, listingsResult, txStatusResult, registeredMtdResult] = await Promise.all([
                pool.query(`
          WITH cap_base AS (
            SELECT
              ca.id AS associate_id,
              ca.cap_date,
              GREATEST(COALESCE(ca.cap, 0), 0)::numeric(18,2) AS associate_cap_amount,
              CASE
                WHEN ca.cap_date IS NULL THEN NULL::date
                ELSE make_date(
                  EXTRACT(YEAR FROM CURRENT_DATE)::int,
                  EXTRACT(MONTH FROM ca.cap_date)::int,
                  EXTRACT(DAY FROM ca.cap_date)::int
                )
              END AS anniversary_this_year
            FROM migration.core_associates ca
            WHERE ca.team_id = $1
          ),
          cycle_windows AS (
            SELECT
              cb.associate_id,
              cb.cap_date,
              cb.associate_cap_amount,
              CASE
                WHEN cb.cap_date IS NULL THEN NULL::date
                WHEN cb.anniversary_this_year >= CURRENT_DATE THEN cb.anniversary_this_year
                ELSE (cb.anniversary_this_year + INTERVAL '1 year')::date
              END AS next_cap_date
            FROM cap_base cb
          ),
          latest_caps AS (
            SELECT
              tac.associate_id,
              COALESCE(tac.cap_amount, 0) AS cap_amount,
              COALESCE(tac.cap_remaining, 0) AS cap_remaining,
              tac.cap_cycle_end_date,
              ROW_NUMBER() OVER (
                PARTITION BY tac.associate_id
                ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
              ) AS rn
            FROM migration.transaction_agent_calculations tac
            WHERE tac.associate_id IS NOT NULL
          ),
          latest_cycle_registered_caps AS (
            SELECT
              tac.associate_id,
              COALESCE(tac.cap_amount, 0) AS cap_amount,
              COALESCE(tac.cap_remaining, 0) AS cap_remaining,
              ROW_NUMBER() OVER (
                PARTITION BY tac.associate_id
                ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
              ) AS rn
            FROM migration.transaction_agent_calculations tac
            INNER JOIN cycle_windows cw ON cw.associate_id = tac.associate_id
            WHERE tac.associate_id IS NOT NULL
              AND tac.is_registered = true
              AND cw.next_cap_date IS NOT NULL
              AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
              AND tac.effective_reporting_date::date < cw.next_cap_date
          ),
          associate_base AS (
            SELECT
              ca.id,
              ca.team_id,
              COALESCE(cw.next_cap_date, ca.cap_date, lc.cap_cycle_end_date) AS cap_date
            FROM migration.core_associates ca
            LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
            LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
            LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
            WHERE ca.team_id = $1
              AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          ),
          latest_team_cap AS (
            SELECT
              tc.team_id,
              COALESCE(tc.team_cap_amount, 0)::numeric(18,2) AS team_cap_amount,
              tc.cap_year,
              ROW_NUMBER() OVER (
                PARTITION BY tc.team_id
                ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
              ) AS rn
            FROM migration.team_caps tc
            WHERE tc.team_id = $1
          ),
          team_member_counts AS (
            SELECT
              ab.team_id,
              MIN(ab.cap_date) AS cap_date
            FROM associate_base ab
            WHERE ab.team_id IS NOT NULL
            GROUP BY ab.team_id
          ),
          team_base AS (
            SELECT
              t.id AS team_id,
              GREATEST(COALESCE(ltc.team_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
              ltc.cap_year,
              tmc.cap_date
            FROM migration.core_teams t
            INNER JOIN team_member_counts tmc ON tmc.team_id = t.id
            LEFT JOIN latest_team_cap ltc ON ltc.team_id = t.id AND ltc.rn = 1
            WHERE t.id = $1
            GROUP BY t.id, ltc.team_cap_amount, ltc.cap_year, tmc.cap_date
          ),
          team_achieved AS (
            SELECT
              tb.team_id,
              COALESCE(SUM(tac.market_center_dollar), 0)::text AS team_cap_achieved
            FROM team_base tb
            INNER JOIN migration.core_associates ca ON ca.team_id = tb.team_id
            INNER JOIN migration.transaction_agent_calculations tac ON tac.associate_id = ca.id
            WHERE tac.is_registered = true
              AND (
                tb.cap_date IS NULL
                OR (
                  tac.effective_reporting_date::date >= (tb.cap_date - INTERVAL '1 year')::date
                  AND tac.effective_reporting_date::date < tb.cap_date
                )
              )
            GROUP BY tb.team_id
          )
          SELECT
            tb.cap_year::text,
            tb.cap_amount::text AS team_cap_amount,
            tb.cap_date::text AS cap_date,
            CASE
              WHEN tb.cap_date IS NULL THEN NULL
              ELSE (tb.cap_date - INTERVAL '1 year')::date::text
            END AS period_start_date,
            CASE
              WHEN tb.cap_date IS NULL THEN NULL
              ELSE (tb.cap_date - INTERVAL '1 day')::date::text
            END AS period_end_date,
            COALESCE(ta.team_cap_achieved, '0') AS team_cap_achieved
          FROM team_base tb
          LEFT JOIN team_achieved ta ON ta.team_id = tb.team_id
          LIMIT 1
          `, [resolvedTeamDbId]),
                pool.query(`
          SELECT COUNT(DISTINCT la.listing_id)::text AS total
          FROM migration.listing_agents la
          INNER JOIN migration.core_associates ca ON ca.id = la.associate_id
          INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
          WHERE ca.source_team_id = $1
            AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
          `, [resolvedTeamSourceId]),
                pool.query(`
          SELECT
            cl.id::text,
            cl.source_listing_id,
            cl.listing_number,
            cl.status_name,
            cl.listing_status_tag,
            cl.address_line,
            cl.suburb,
            cl.city,
            cl.price::text
          FROM migration.listing_agents la
          INNER JOIN migration.core_associates ca ON ca.id = la.associate_id
          INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
          WHERE ca.source_team_id = $1
            AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
          ORDER BY cl.updated_at DESC, cl.id DESC
          LIMIT 25
          `, [resolvedTeamSourceId]),
                pool.query(`
          SELECT
            LOWER(TRIM(COALESCE(ct.transaction_status, ''))) AS status_key,
            COUNT(DISTINCT ct.id)::text AS total_transactions,
            COALESCE(SUM(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, ct.total_gci, 0)), 0)::text AS total_gci
          FROM migration.transaction_agents ta
          INNER JOIN migration.core_associates ca ON ca.id = ta.associate_id
          INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
          LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
          WHERE ca.source_team_id = $1
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date, ct.transaction_date::date) >= date_trunc('month', CURRENT_DATE)::date
            AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) IN ('start', 'working', 'submitted', 'pending', 'registered')
          GROUP BY LOWER(TRIM(COALESCE(ct.transaction_status, '')))
          `, [resolvedTeamSourceId]),
                pool.query(`
          SELECT
            COUNT(DISTINCT ct.id)::text AS total_transactions,
            COALESCE(SUM(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, ct.total_gci, 0)), 0)::text AS total_gci
          FROM migration.transaction_agents ta
          INNER JOIN migration.core_associates ca ON ca.id = ta.associate_id
          INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
          LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
          WHERE ca.source_team_id = $1
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date, ct.transaction_date::date) >= date_trunc('month', CURRENT_DATE)::date
            AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
          `, [resolvedTeamSourceId]),
            ]);
            const teamCapAmount = Number(teamCapResult.rows[0]?.team_cap_amount ?? 0) || 0;
            const teamCapAchieved = Number(teamCapResult.rows[0]?.team_cap_achieved ?? 0) || 0;
            const teamCapRemaining = Math.max(teamCapAmount - teamCapAchieved, 0);
            const teamProgressPct = teamCapAmount > 0 ? Math.min((teamCapAchieved / teamCapAmount) * 100, 100) : 0;
            const capYear = teamCapResult.rows[0]?.cap_year ? Number(teamCapResult.rows[0].cap_year) : new Date().getFullYear();
            const teamPeriodStartDate = teamCapResult.rows[0]?.period_start_date ?? `${capYear}-01-01`;
            const teamPeriodEndDate = teamCapResult.rows[0]?.period_end_date ?? `${capYear}-12-31`;
            const registeredMtdRow = registeredMtdResult.rows[0];
            const statusMap = new Map(statusDefaults.map((entry) => [entry.status.toLowerCase(), entry]));
            for (const row of txStatusResult.rows) {
                const current = statusMap.get(row.status_key);
                if (!current)
                    continue;
                current.total_transactions = Number(row.total_transactions ?? 0);
                current.total_gci = Number(row.total_gci ?? 0);
            }
            return res.json({
                generated_at: new Date().toISOString(),
                email: userEmail,
                associate,
                market_center: {
                    source_market_center_id: associate.source_market_center_id ?? null,
                    name: associate.market_center_name ?? null,
                    logo_image_url: associate.market_center_logo_image_url ?? null,
                    document_logo_image_url: associate.market_center_document_logo_image_url ?? null,
                },
                cap_type: 'team',
                team_name: resolvedTeamName ?? null,
                cap: {
                    period_start_date: teamPeriodStartDate,
                    period_end_date: teamPeriodEndDate,
                    total_cap_amount: teamCapAmount,
                    cap_achieved: teamCapAchieved,
                    cap_remaining: teamCapRemaining,
                    progress_pct: Number(teamProgressPct.toFixed(2)),
                },
                active_listings: {
                    total: Number(listingCountResult.rows[0]?.total ?? 0),
                    items: listingsResult.rows,
                },
                registered_mtd: {
                    total_transactions: Number(registeredMtdRow?.total_transactions ?? 0),
                    total_gci: Number(registeredMtdRow?.total_gci ?? 0),
                },
                transactions_by_status: HOME_TRANSACTION_STATUSES.map((status) => statusMap.get(status.toLowerCase())),
            });
        }
        // ── END TEAM CAP BRANCH ────────────────────────────────────────────────
        const [capResult, listingCountResult, listingsResult, txStatusResult, registeredMtdResult] = await Promise.all([
            pool.query(`
        WITH cap_base AS (
          SELECT
            ca.id AS associate_id,
            ca.cap_date,
            GREATEST(COALESCE(ca.cap, 0), 0)::numeric(18,2) AS associate_cap_amount,
            CASE
              WHEN ca.cap_date IS NULL THEN NULL::date
              ELSE make_date(
                EXTRACT(YEAR FROM CURRENT_DATE)::int,
                EXTRACT(MONTH FROM ca.cap_date)::int,
                EXTRACT(DAY FROM ca.cap_date)::int
              )
            END AS anniversary_this_year
          FROM migration.core_associates ca
          WHERE ca.id = $1
        ),
        cycle_windows AS (
          SELECT
            cb.associate_id,
            cb.associate_cap_amount,
            CASE
              WHEN cb.cap_date IS NULL THEN NULL::date
              WHEN cb.anniversary_this_year >= CURRENT_DATE THEN cb.anniversary_this_year
              ELSE (cb.anniversary_this_year + INTERVAL '1 year')::date
            END AS next_cap_date
          FROM cap_base cb
        ),
        latest_caps AS (
          SELECT
            tac.associate_id,
            COALESCE(tac.cap_amount, 0) AS cap_amount,
            COALESCE(tac.cap_remaining, 0) AS cap_remaining,
            ROW_NUMBER() OVER (
              PARTITION BY tac.associate_id
              ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
            ) AS rn
          FROM migration.transaction_agent_calculations tac
          WHERE tac.associate_id = $1
        ),
        latest_cycle_registered_caps AS (
          SELECT
            tac.associate_id,
            COALESCE(tac.cap_amount, 0) AS cap_amount,
            COALESCE(tac.cap_remaining, 0) AS cap_remaining,
            ROW_NUMBER() OVER (
              PARTITION BY tac.associate_id
              ORDER BY tac.effective_reporting_date DESC NULLS LAST, tac.updated_at DESC, tac.id DESC
            ) AS rn
          FROM migration.transaction_agent_calculations tac
          INNER JOIN cycle_windows cw ON cw.associate_id = tac.associate_id
          WHERE tac.associate_id = $1
            AND tac.is_registered = true
            AND cw.next_cap_date IS NOT NULL
            AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
            AND tac.effective_reporting_date::date < cw.next_cap_date
        )
        SELECT
          CASE
            WHEN cw.next_cap_date IS NULL THEN NULL
            ELSE (cw.next_cap_date - INTERVAL '1 year')::date::text
          END AS cap_cycle_start_date,
          CASE
            WHEN cw.next_cap_date IS NULL THEN NULL
            ELSE (cw.next_cap_date - INTERVAL '1 day')::date::text
          END AS cap_cycle_end_date,
          GREATEST(COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::text AS cap_amount,
          GREATEST(
            COALESCE(
              lrc.cap_remaining,
              COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)
            ),
            0
          )::text AS cap_remaining
        FROM migration.core_associates ca
        LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
        LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
        LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
        WHERE ca.id = $1
        LIMIT 1
        `, [associateId]),
            pool.query(`
        SELECT COUNT(DISTINCT la.listing_id)::text AS total
        FROM migration.listing_agents la
        INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
        WHERE la.associate_id = $1
          AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
        `, [associateId]),
            pool.query(`
        SELECT
          cl.id::text,
          cl.source_listing_id,
          cl.listing_number,
          cl.status_name,
          cl.listing_status_tag,
          cl.address_line,
          cl.suburb,
          cl.city,
          cl.price::text
        FROM migration.listing_agents la
        INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
        WHERE la.associate_id = $1
          AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
        ORDER BY cl.updated_at DESC, cl.id DESC
        LIMIT 25
        `, [associateId]),
            pool.query(`
        SELECT
          LOWER(TRIM(COALESCE(ct.transaction_status, ''))) AS status_key,
          COUNT(DISTINCT ct.id)::text AS total_transactions,
          COALESCE(SUM(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, ct.total_gci, 0)), 0)::text AS total_gci
        FROM migration.transaction_agents ta
        INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
        LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
        WHERE ta.associate_id = $1
          AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date, ct.transaction_date::date) >= date_trunc('month', CURRENT_DATE)::date
          AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) IN ('start', 'working', 'submitted', 'pending', 'registered')
        GROUP BY LOWER(TRIM(COALESCE(ct.transaction_status, '')))
        `, [associateId]),
            pool.query(`
        SELECT
          COUNT(DISTINCT ct.id)::text AS total_transactions,
          COALESCE(SUM(COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, ct.total_gci, 0)), 0)::text AS total_gci
        FROM migration.transaction_agents ta
        INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
        LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
        WHERE ta.associate_id = $1
          AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date, ct.transaction_date::date) >= date_trunc('month', CURRENT_DATE)::date
          AND (tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
        `, [associateId]),
        ]);
        const capRow = capResult.rows[0];
        const capAmount = Number(capRow?.cap_amount ?? 0) || 0;
        const capRemaining = Number(capRow?.cap_remaining ?? 0) || 0;
        const capAchieved = Math.max(capAmount - capRemaining, 0);
        const progressPct = capAmount > 0 ? Math.min((capAchieved / capAmount) * 100, 100) : 0;
        const registeredMtdRow = registeredMtdResult.rows[0];
        const statusMap = new Map(statusDefaults.map((entry) => [entry.status.toLowerCase(), entry]));
        for (const row of txStatusResult.rows) {
            const current = statusMap.get(row.status_key);
            if (!current)
                continue;
            current.total_transactions = Number(row.total_transactions ?? 0);
            current.total_gci = Number(row.total_gci ?? 0);
        }
        return res.json({
            generated_at: new Date().toISOString(),
            email: userEmail,
            associate,
            market_center: {
                source_market_center_id: associate.source_market_center_id ?? null,
                name: associate.market_center_name ?? null,
                logo_image_url: associate.market_center_logo_image_url ?? null,
                document_logo_image_url: associate.market_center_document_logo_image_url ?? null,
            },
            cap_type: 'individual',
            team_name: associate.team_name ?? null,
            cap: {
                period_start_date: capRow?.cap_cycle_start_date ?? null,
                period_end_date: capRow?.cap_cycle_end_date ?? null,
                total_cap_amount: capAmount,
                cap_achieved: capAchieved,
                cap_remaining: Math.max(capRemaining, 0),
                progress_pct: Number(progressPct.toFixed(2)),
            },
            active_listings: {
                total: Number(listingCountResult.rows[0]?.total ?? 0),
                items: listingsResult.rows,
            },
            registered_mtd: {
                total_transactions: Number(registeredMtdRow?.total_transactions ?? 0),
                total_gci: Number(registeredMtdRow?.total_gci ?? 0),
            },
            transactions_by_status: HOME_TRANSACTION_STATUSES.map((status) => statusMap.get(status.toLowerCase())),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/me/featured-listings', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    try {
        const associate = await resolveCurrentAssociateByEmail(userEmail);
        if (!associate)
            return res.json({ items: [] });
        const items = await fetchFeaturedListingsForAssociate(associate.id);
        return res.json({ items });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/me/featured-listings/search', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    const q = String(req.query.q ?? '').trim();
    try {
        const associate = await resolveCurrentAssociateByEmail(userEmail);
        if (!associate)
            return res.json({ items: [] });
        const result = await pool.query(`
      SELECT
        cl.id::text AS listing_id,
        cl.listing_number,
        cl.status_name,
        cl.listing_status_tag,
        cl.address_line,
        cl.suburb,
        cl.city,
        cl.price::text,
        CASE
          WHEN cl.listing_images_json IS NOT NULL
            AND cl.listing_images_json::text NOT IN ('[]', 'null', '')
          THEN (
            SELECT value
            FROM jsonb_array_elements_text(cl.listing_images_json) AS value
            WHERE COALESCE(TRIM(value), '') <> ''
            LIMIT 1
          )
          ELSE (
            SELECT li.file_url
            FROM migration.listing_images li
            WHERE li.listing_id = cl.id
              AND COALESCE(TRIM(li.file_url), '') <> ''
            ORDER BY li.sort_order ASC, li.id ASC
            LIMIT 1
          )
        END AS main_image_url,
        CASE WHEN afl.listing_id IS NULL THEN false ELSE true END AS selected
      FROM migration.core_listings cl
      LEFT JOIN migration.associate_featured_listings afl
        ON afl.associate_id = $1 AND afl.listing_id = cl.id
      WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
        AND (
          $2 = ''
          OR cl.listing_number ILIKE ('%' || $2 || '%')
          OR cl.address_line ILIKE ('%' || $2 || '%')
          OR cl.suburb ILIKE ('%' || $2 || '%')
          OR cl.city ILIKE ('%' || $2 || '%')
        )
      ORDER BY
        CASE WHEN afl.listing_id IS NULL THEN 1 ELSE 0 END,
        cl.updated_at DESC,
        cl.id DESC
      LIMIT 60
      `, [associate.id, q]);
        const items = result.rows
            .map((row) => {
            const listingId = Number(row.listing_id);
            if (!Number.isFinite(listingId))
                return null;
            return {
                listingId,
                listingNumber: row.listing_number,
                statusName: row.status_name,
                listingStatusTag: row.listing_status_tag,
                addressLine: row.address_line,
                suburb: row.suburb,
                city: row.city,
                price: row.price !== null ? Number(row.price) : null,
                mainImageUrl: row.main_image_url,
                selected: row.selected,
            };
        })
            .filter((row) => Boolean(row));
        return res.json({ items });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.put('/me/featured-listings', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    const body = (req.body ?? {});
    const listingIds = Array.isArray(body.listingIds)
        ? body.listingIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
        : [];
    const uniqueListingIds = [...new Set(listingIds)];
    if (uniqueListingIds.length > 6) {
        return res.status(400).json({ error: 'You can select up to 6 featured listings.' });
    }
    try {
        const associate = await resolveCurrentAssociateByEmail(userEmail);
        if (!associate) {
            return res.status(404).json({ error: 'Associate profile not found for current user.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM migration.associate_featured_listings WHERE associate_id = $1`, [associate.id]);
            if (uniqueListingIds.length > 0) {
                const validListings = await client.query(`
          SELECT cl.id::text AS id
          FROM migration.core_listings cl
          WHERE cl.id = ANY($1::bigint[])
            AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
          `, [uniqueListingIds]);
                const validSet = new Set(validListings.rows.map((row) => Number(row.id)));
                for (const listingId of uniqueListingIds) {
                    if (!validSet.has(listingId))
                        continue;
                    await client.query(`
            INSERT INTO migration.associate_featured_listings (associate_id, listing_id)
            VALUES ($1, $2)
            `, [associate.id, listingId]);
                }
            }
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        const items = await fetchFeaturedListingsForAssociate(associate.id);
        return res.json({ items });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/:id/details', resolvePermissions, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
    }
    const perms = req.permissions;
    if (!perms) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const effectiveScopeMarketCenterId = resolveEffectiveScopeMarketCenterId(perms);
    const useOfficeAdminMarketCenterFallback = perms.scope === 'OWN' && perms.isOfficeAdmin && Boolean(effectiveScopeMarketCenterId);
    if (perms.scope === 'OWN' && !useOfficeAdminMarketCenterFallback) {
        const currentAssociateId = Number(perms.associateDbId ?? 0);
        if (!Number.isFinite(currentAssociateId) || currentAssociateId !== id) {
            return res.status(403).json({ error: 'Permission denied: you may only access your own associate profile.' });
        }
    }
    if (perms.scope === 'MARKET_CENTRE' || useOfficeAdminMarketCenterFallback) {
        if (!effectiveScopeMarketCenterId) {
            return res.status(403).json({ error: 'Permission denied: no active office admin market centre context.' });
        }
        const scopeMatch = await resolveMarketCenterScopeMatch(pool, id, effectiveScopeMarketCenterId);
        if (scopeMatch.notFound) {
            return res.status(404).json({ error: 'Associate not found.' });
        }
        if (!scopeMatch.allowed) {
            return res.status(403).json({ error: 'Permission denied: associate is not in your market centre' });
        }
    }
    try {
        const base = await pool.query(`
      SELECT
        a.id::text,
        a.source_associate_id,
        a.source_market_center_id,
        a.source_team_id,
        a.first_name,
        a.last_name,
        a.full_name,
        a.status_name,
        a.national_id,
        a.ffc_number,
        a.kwsa_email,
        a.private_email,
        a.mobile_number,
        a.office_number,
        a.image_url,
        a.growth_share_sponsor,
        a.temporary_growth_share_sponsor,
        a.proposed_growth_share_sponsor,
        a.kwuid,
        a.vested,
        a.vesting_period_start_date::text,
        a.listing_approval_required,
        a.exclude_from_individual_reports,
        a.property24_opt_in,
        a.agent_property24_id,
        a.property24_status,
        a.entegral_opt_in,
        a.agent_entegral_id,
        a.entegral_status,
        a.private_property_opt_in,
        a.private_property_status,
        a.cap::text,
        a.manual_cap,
        a.agent_split::text,
        a.projected_cos::text,
        a.projected_cap::text,
        a.start_date::text,
        a.end_date::text,
        a.anniversary_date::text,
        a.cap_date::text
      FROM migration.core_associates a
      WHERE a.id = $1
      LIMIT 1
      `, [id]);
        if (base.rowCount === 0) {
            return res.status(404).json({ error: 'Associate not found.' });
        }
        const [socialMedia, roles, jobTitles, serviceCommunities, adminMarketCenters, adminTeams, documents, notes] = await Promise.all([
            pool.query(`SELECT platform, url FROM migration.associate_social_media WHERE associate_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
            pool.query(`SELECT role_name FROM migration.associate_roles WHERE associate_id = $1 ORDER BY id ASC`, [id]),
            pool.query(`SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1 ORDER BY id ASC`, [id]),
            pool.query(`SELECT community_name FROM migration.associate_service_communities WHERE associate_id = $1 ORDER BY id ASC`, [id]),
            pool.query(`SELECT COALESCE(resolved.source_market_center_id, amc.source_market_center_id) AS source_market_center_id
         FROM migration.associate_admin_market_centers amc
         LEFT JOIN LATERAL (
           SELECT mc.source_market_center_id, mc.id
           FROM migration.core_market_centers mc
           WHERE LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, '')))
              OR LOWER(TRIM(COALESCE(mc.name, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, '')))
           ORDER BY
             CASE
               WHEN LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, ''))) THEN 0
               ELSE 1
             END,
             mc.id ASC
           LIMIT 1
         ) resolved ON TRUE
         WHERE amc.associate_id = $1
         ORDER BY amc.id ASC`, [id]),
            pool.query(`SELECT source_team_id FROM migration.associate_admin_teams WHERE associate_id = $1 ORDER BY id ASC`, [id]),
            pool.query(`
        SELECT document_type, document_name, document_url, uploaded_by, uploaded_at::text
        FROM migration.associate_documents
        WHERE associate_id = $1
        ORDER BY uploaded_at DESC, id DESC
        `, [id]),
            pool.query(`
        SELECT note_type, note_text, created_by, created_at::text
        FROM migration.associate_notes
        WHERE associate_id = $1
        ORDER BY created_at DESC, id DESC
        `, [id]),
        ]);
        const payload = base.rows[0];
        const commissionNotes = notes.rows.filter((n) => n.note_type === 'commission');
        const dateNotes = notes.rows.filter((n) => n.note_type === 'dates');
        const documentNotes = notes.rows.filter((n) => n.note_type === 'documents');
        const mappAccess = await getMappAccessPayload(id);
        return res.json({
            ...payload,
            social_media: socialMedia.rows,
            roles: uniqueNormalizedStrings(roles.rows.map((row) => row.role_name)),
            job_titles: uniqueNormalizedStrings(jobTitles.rows.map((row) => row.job_title)),
            service_communities: uniqueNormalizedStrings(serviceCommunities.rows.map((row) => row.community_name)),
            admin_market_centers: uniqueNormalizedStrings(adminMarketCenters.rows.map((row) => row.source_market_center_id)),
            admin_teams: uniqueNormalizedStrings(adminTeams.rows.map((row) => row.source_team_id)),
            documents: documents.rows,
            commission_notes: commissionNotes,
            date_notes: dateNotes,
            document_notes: documentNotes,
            mapp_access: mappAccess,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.patch('/:id/access-suspension', resolvePermissions, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    if (!LOCAL_ASSOCIATE_SUSPENSION_ENABLED) {
        return res.status(400).json({
            error: 'Local feature flag is currently off. Enable LOCAL_ASSOCIATE_SUSPENSION_ENABLED in backend env to test suspension controls.',
        });
    }
    const perms = req.permissions;
    if (!perms || (!perms.isRegionalAdmin && !perms.isOfficeAdmin)) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
    }
    const body = (req.body ?? {});
    const isTemporarilySuspended = toBool(body.is_temporarily_suspended);
    const suspendedReason = isTemporarilySuspended ? toText(body.suspended_reason) : null;
    if (isTemporarilySuspended && !suspendedReason) {
        return res.status(400).json({ error: 'Suspension reason is required when suspending access.' });
    }
    const suspendedByEmail = req.user?.email?.trim().toLowerCase() ?? null;
    try {
        await ensureAssociateAccessSuspensionTable();
        await pool.query(`
      INSERT INTO migration.associate_access_suspension (
        associate_id,
        is_temporarily_suspended,
        suspended_reason,
        suspended_by_email,
        suspended_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, CASE WHEN $2 THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (associate_id)
      DO UPDATE SET
        is_temporarily_suspended = EXCLUDED.is_temporarily_suspended,
        suspended_reason = EXCLUDED.suspended_reason,
        suspended_by_email = EXCLUDED.suspended_by_email,
        suspended_at = CASE WHEN EXCLUDED.is_temporarily_suspended THEN NOW() ELSE NULL END,
        updated_at = NOW()
      `, [id, isTemporarilySuspended, suspendedReason, suspendedByEmail]);
        clearAssociateAccessCache();
        const mappAccess = await getMappAccessPayload(id);
        return res.json({ mapp_access: mappAccess });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const searchInput = String(req.query.search ?? '').trim();
    const statusInput = String(req.query.status ?? '').trim().toLowerCase();
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_associates') AS exists`);
        if (!exists.rows[0]?.exists) {
            return res.json({ total: 0, limit, offset, items: [] });
        }
        const whereClauses = [];
        const params = [];
        if (searchInput.length > 0) {
            params.push(`%${searchInput}%`);
            const searchParam = `$${params.length}`;
            whereClauses.push(`(a.full_name ILIKE ${searchParam} OR a.first_name ILIKE ${searchParam} OR a.last_name ILIKE ${searchParam} OR a.email ILIKE ${searchParam} OR a.kwuid ILIKE ${searchParam} OR a.source_associate_id ILIKE ${searchParam} OR mc.name ILIKE ${searchParam})`);
        }
        if (statusInput === 'active') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active' OR TRIM(COALESCE(a.status_name, '')) = '1')`);
        }
        else if (statusInput === 'inactive') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(a.status_name, ''))) = 'inactive' OR TRIM(COALESCE(a.status_name, '')) = '2')`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`
      SELECT COUNT(*)::text AS total
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      ${whereSql}
      `, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`
      WITH listing_metrics AS (
        SELECT
          la.associate_id,
          COUNT(DISTINCT la.listing_id)::int AS active_listing_count
        FROM migration.listing_agents la
        INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
        WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
        GROUP BY la.associate_id
      ),
      transaction_metrics AS (
        SELECT
          ta.associate_id,
          COUNT(DISTINCT ta.transaction_id)::int AS registered_transaction_count
        FROM migration.transaction_agents ta
        INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
        WHERE LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'
        GROUP BY ta.associate_id
      )
      SELECT
        a.id,
        a.source_associate_id,
        a.full_name,
        a.first_name,
        a.last_name,
        COALESCE(a.kwsa_email, a.email) AS email,
        a.status_name,
        a.kwuid,
        COALESCE(NULLIF(TRIM(a.source_market_center_id), ''), NULLIF(TRIM(mc.source_market_center_id), '')) AS source_market_center_id,
        a.source_team_id,
        a.image_url,
        a.mobile_number,
        mc.name AS market_center_name,
        mc.logo_image_url AS market_center_logo_url,
        COALESCE(lm.active_listing_count, 0) AS active_listing_count,
        COALESCE(tm.registered_transaction_count, 0) AS registered_transaction_count,
        a.updated_at::text
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      LEFT JOIN listing_metrics lm ON lm.associate_id = a.id
      LEFT JOIN transaction_metrics tm ON tm.associate_id = a.id
      ${whereSql}
      ORDER BY a.full_name ASC NULLS LAST, a.id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params);
        return res.json({
            total: Number(totalResult.rows[0]?.total ?? 0),
            limit,
            offset,
            items: dataResult.rows,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/', resolvePermissions, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const perms = req.permissions;
    if (!perms || (!perms.isRegionalAdmin && !perms.isOfficeAdmin)) {
        return res.status(403).json({ error: 'Permission denied: only regional or office admins can create associates.' });
    }
    if (perms.scope === 'OWN') {
        return res.status(403).json({ error: 'Permission denied: active context cannot create associates.' });
    }
    const body = (req.body ?? {});
    const firstName = toText(body.first_name);
    const lastName = toText(body.last_name);
    const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fullName = toText(body.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null);
    const sourceAssociateId = toText(body.source_associate_id) ?? buildManualAssociateId();
    let sourceMarketCenterId = toText(body.source_market_center_id);
    const sourceTeamId = toText(body.source_team_id);
    if (perms.scope === 'MARKET_CENTRE') {
        const effectiveScopeMarketCenterId = resolveEffectiveScopeMarketCenterId(perms);
        if (!effectiveScopeMarketCenterId) {
            return res.status(403).json({ error: 'Permission denied: no active office admin market centre context.' });
        }
        sourceMarketCenterId = effectiveScopeMarketCenterId;
    }
    if (!fullName) {
        return res.status(400).json({ error: 'full_name (or first_name/last_name) is required.' });
    }
    const nationalId = toText(body.national_id);
    const ffcNumber = toText(body.ffc_number);
    const kwsaEmail = toEmail(body.kwsa_email) ?? toEmail(body.email);
    const privateEmail = toEmail(body.private_email);
    const mobileNumber = toPhone(body.mobile_number);
    const officeNumber = toPhone(body.office_number);
    const imageUrl = toText(body.image_url);
    const growthShareSponsor = toText(body.growth_share_sponsor);
    const temporaryGrowthShareSponsor = toNullableBool(body.temporary_growth_share_sponsor);
    const proposedGrowthShareSponsor = toText(body.proposed_growth_share_sponsor);
    const kwuid = toText(body.kwuid);
    const vested = toBool(body.vested);
    const vestingPeriodStartDate = toDate(body.vesting_period_start_date);
    const listingApprovalRequired = toBool(body.listing_approval_required);
    const excludeFromIndividualReports = toBool(body.exclude_from_individual_reports);
    const property24OptIn = toBool(body.property24_opt_in);
    const normalizedP24 = normalizeProperty24Fields(property24OptIn, body.agent_property24_id, body.property24_status);
    const agentProperty24Id = normalizedP24.agentProperty24Id;
    const property24Status = normalizedP24.property24Status;
    const entegralOptIn = toBool(body.entegral_opt_in);
    const agentEntegralId = null;
    const entegralStatus = entegralOptIn ? 'Pending registration' : 'Not opted in';
    const privatePropertyOptIn = toBool(body.private_property_opt_in);
    const privatePropertyStatus = privatePropertyOptIn ? 'Pending activation' : 'Not opted in';
    const cap = toNumber(body.cap);
    const manualCap = toBool(body.manual_cap);
    const agentSplit = toNumber(body.agent_split);
    const projectedCos = toNumber(body.projected_cos);
    const projectedCap = toNumber(body.projected_cap);
    const startDate = getTodayInAppTimeZone();
    const endDate = toDate(body.end_date);
    const firstOfNextMonth = firstOfNextMonthFromDateText(startDate);
    const anniversaryDate = firstOfNextMonth;
    const capDate = firstOfNextMonth;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const mcLookup = sourceMarketCenterId
            ? await client.query(`SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId])
            : { rows: [] };
        const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
        const insert = await client.query(`
      INSERT INTO migration.core_associates (
        source_associate_id,
        source_market_center_id,
        source_team_id,
        market_center_id,
        first_name,
        last_name,
        full_name,
        email,
        status_name,
        kwuid,
        image_url,
        mobile_number,
        national_id,
        ffc_number,
        kwsa_email,
        private_email,
        office_number,
        growth_share_sponsor,
        temporary_growth_share_sponsor,
        proposed_growth_share_sponsor,
        vested,
        vesting_period_start_date,
        listing_approval_required,
        exclude_from_individual_reports,
        property24_opt_in,
        agent_property24_id,
        property24_status,
        entegral_opt_in,
        agent_entegral_id,
        entegral_status,
        private_property_opt_in,
        private_property_status,
        cap,
        manual_cap,
        agent_split,
        projected_cos,
        projected_cap,
        start_date,
        end_date,
        anniversary_date,
        cap_date,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22::date,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38::date,$39::date,$40::date,$41::date,
        NOW()
      )
      RETURNING id::text
      `, [
            sourceAssociateId,
            sourceMarketCenterId,
            sourceTeamId,
            marketCenterId,
            firstName,
            lastName,
            fullName,
            kwsaEmail,
            toText(body.status_name),
            kwuid,
            imageUrl,
            mobileNumber,
            nationalId,
            ffcNumber,
            kwsaEmail,
            privateEmail,
            officeNumber,
            growthShareSponsor,
            temporaryGrowthShareSponsor,
            proposedGrowthShareSponsor,
            vested,
            vestingPeriodStartDate,
            listingApprovalRequired,
            excludeFromIndividualReports,
            property24OptIn,
            agentProperty24Id,
            property24Status,
            entegralOptIn,
            agentEntegralId,
            entegralStatus,
            privatePropertyOptIn,
            privatePropertyStatus,
            cap,
            manualCap,
            agentSplit,
            projectedCos,
            projectedCap,
            startDate,
            endDate,
            anniversaryDate,
            capDate,
        ]);
        const associateId = Number(insert.rows[0].id);
        await saveCollections(client, associateId, body);
        await client.query('COMMIT');
        res.status(201).json({ id: insert.rows[0].id, source_associate_id: sourceAssociateId });
    }
    catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
    finally {
        client.release();
    }
    // Fire background recalculation after response — do not block the save.
    scheduleTransactionAgentRecompute('agents-create');
    return;
});
router.put('/:id', resolvePermissions, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
    }
    const perms = req.permissions;
    if (!perms) {
        return res.status(403).json({ error: 'Permission denied.' });
    }
    const effectiveScopeMarketCenterId = resolveEffectiveScopeMarketCenterId(perms);
    const useOfficeAdminMarketCenterFallback = perms.scope === 'OWN' && perms.isOfficeAdmin && Boolean(effectiveScopeMarketCenterId);
    if (perms.scope === 'OWN' && !useOfficeAdminMarketCenterFallback) {
        return res.status(403).json({ error: 'Permission denied: active context cannot edit associates.' });
    }
    if (perms.scope === 'MARKET_CENTRE' || useOfficeAdminMarketCenterFallback) {
        if (!effectiveScopeMarketCenterId) {
            return res.status(403).json({ error: 'Permission denied: no active office admin market centre context.' });
        }
        const scopeMatch = await resolveMarketCenterScopeMatch(pool, id, effectiveScopeMarketCenterId);
        if (scopeMatch.notFound) {
            return res.status(404).json({ error: 'Associate not found.' });
        }
        if (!scopeMatch.allowed) {
            return res.status(403).json({ error: 'Permission denied: associate is not in your market centre' });
        }
    }
    const body = (req.body ?? {});
    const firstName = toText(body.first_name);
    const lastName = toText(body.last_name);
    const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fullName = toText(body.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null);
    if (!fullName) {
        return res.status(400).json({ error: 'full_name (or first_name/last_name) is required.' });
    }
    const sourceMarketCenterId = toText(body.source_market_center_id);
    const property24OptIn = toBool(body.property24_opt_in);
    const normalizedP24 = normalizeProperty24Fields(property24OptIn, body.agent_property24_id, body.property24_status);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const mcLookup = sourceMarketCenterId
            ? await client.query(`SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`, [sourceMarketCenterId])
            : { rows: [] };
        const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
        const result = await client.query(`
      UPDATE migration.core_associates
      SET
        source_market_center_id = $1,
        source_team_id = $2,
        market_center_id = $3,
        first_name = $4,
        last_name = $5,
        full_name = $6,
        email = $7,
        status_name = $8,
        kwuid = $9,
        image_url = $10,
        mobile_number = $11,
        national_id = $12,
        ffc_number = $13,
        kwsa_email = $14,
        private_email = $15,
        office_number = $16,
        growth_share_sponsor = $17,
        temporary_growth_share_sponsor = $18,
        proposed_growth_share_sponsor = $19,
        vested = $20,
        vesting_period_start_date = $21::date,
        listing_approval_required = $22,
        exclude_from_individual_reports = $23,
        property24_opt_in = $24,
        agent_property24_id = $25,
        property24_status = $26,
        entegral_opt_in = $27,
        agent_entegral_id = $28,
        entegral_status = $29,
        private_property_opt_in = $30,
        private_property_status = $31,
        cap = $32,
        manual_cap = $33,
        agent_split = $34,
        projected_cos = $35,
        projected_cap = $36,
        start_date = $37::date,
        end_date = $38::date,
        anniversary_date = $39::date,
        cap_date = $40::date,
        updated_at = NOW()
      WHERE id = $41
      RETURNING id::text
      `, [
            sourceMarketCenterId,
            toText(body.source_team_id),
            marketCenterId,
            firstName,
            lastName,
            fullName,
            toEmail(body.kwsa_email) ?? toEmail(body.email),
            toText(body.status_name),
            toText(body.kwuid),
            toText(body.image_url),
            toPhone(body.mobile_number),
            toText(body.national_id),
            toText(body.ffc_number),
            toEmail(body.kwsa_email) ?? toEmail(body.email),
            toEmail(body.private_email),
            toPhone(body.office_number),
            toText(body.growth_share_sponsor),
            toNullableBool(body.temporary_growth_share_sponsor),
            toText(body.proposed_growth_share_sponsor),
            toBool(body.vested),
            toDate(body.vesting_period_start_date),
            toBool(body.listing_approval_required),
            toBool(body.exclude_from_individual_reports),
            property24OptIn,
            normalizedP24.agentProperty24Id,
            normalizedP24.property24Status,
            toBool(body.entegral_opt_in),
            toText(body.agent_entegral_id),
            toText(body.entegral_status),
            toBool(body.private_property_opt_in),
            toText(body.private_property_status),
            toNumber(body.cap),
            toBool(body.manual_cap),
            toNumber(body.agent_split),
            toNumber(body.projected_cos),
            toNumber(body.projected_cap),
            toDate(body.start_date),
            toDate(body.end_date),
            toDate(body.anniversary_date),
            toDate(body.cap_date),
            id,
        ]);
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Associate not found.' });
        }
        await saveCollections(client, id, body);
        await client.query('COMMIT');
        res.json({ id: result.rows[0].id });
    }
    catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
    finally {
        client.release();
    }
    // Fire background recalculation after response is sent — do not block the save.
    scheduleTransactionAgentRecompute('agents-update');
    return;
});
router.post('/:id/upload-image', async (req, res, next) => {
    const isGcs = !storageConfig.localUploadsEnabled;
    try {
        await runUploadMiddleware(req, res, uploadImage.single('image'));
    }
    catch (error) {
        return next(error);
    }
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
    }
    try {
        const rawImageBuffer = req.file.buffer?.length
            ? req.file.buffer
            : (req.file.path ? await fs.readFile(req.file.path) : null);
        if (!rawImageBuffer) {
            return res.status(400).json({ error: 'Could not read uploaded image data.' });
        }
        // Process and compress the image to portal specifications (1080x1080 JPEG, max 2MB)
        const processedImage = await processAgentImage(rawImageBuffer);
        const filename = `agent-profile-${id}-${Date.now()}.jpg`;
        let imageUrl;
        if (isGcs) {
            const { publicUrl } = await uploadToGcs(processedImage.buffer, filename, 'image', 'image/jpeg');
            imageUrl = publicUrl;
        }
        else {
            // Write compressed image to disk
            if (storageConfig.localUploadsEnabled) {
                const outputPath = path.join(imagesDir, filename);
                await fs.writeFile(outputPath, processedImage.buffer);
            }
            imageUrl = `/uploads/images/${filename}`;
        }
        // Update the image_url in the database
        const result = await pool.query(`UPDATE migration.core_associates SET image_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id::text`, [imageUrl, id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Associate not found.' });
        }
        return res.json({
            image_url: imageUrl,
            message: `Image successfully processed and optimized for portals (1080x1080px JPEG, ${(processedImage.size / 1024).toFixed(0)}KB)`,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[agents] Image upload/processing error for associate ${id}:`, message);
        return res.status(500).json({ error: message });
    }
});
router.post('/:id/upload-document', async (req, res, next) => {
    const isGcs = !storageConfig.localUploadsEnabled;
    try {
        await runUploadMiddleware(req, res, uploadDocument.single('document'));
    }
    catch (error) {
        return next(error);
    }
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No document file provided.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
    }
    const documentType = req.body.document_type || 'Unknown';
    try {
        let documentUrl;
        if (isGcs) {
            const { publicUrl } = await uploadToGcs(req.file.buffer, req.file.originalname, 'doc', req.file.mimetype);
            documentUrl = publicUrl;
        }
        else {
            documentUrl = `/uploads/documents/${req.file.filename}`;
        }
        // Insert document record
        const result = await pool.query(`INSERT INTO migration.associate_documents (associate_id, document_type, document_name, document_url, uploaded_by)
       VALUES ($1, $2, $3, $4, 'console-upload')
       RETURNING id::text`, [id, documentType, req.file.originalname, documentUrl]);
        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'Failed to save document record.' });
        }
        return res.json({ document_url: documentUrl });
    }
    catch (error) {
        if (!isGcs && req.file.path) {
            await fs.unlink(req.file.path).catch(() => undefined);
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/upload-document-temp', async (req, res, next) => {
    const isGcs = !storageConfig.localUploadsEnabled;
    try {
        await runUploadMiddleware(req, res, uploadDocument.single('document'));
    }
    catch (error) {
        return next(error);
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No document file provided.' });
    }
    try {
        let documentUrl;
        if (isGcs) {
            const { publicUrl } = await uploadToGcs(req.file.buffer, req.file.originalname, 'doc', req.file.mimetype);
            documentUrl = publicUrl;
        }
        else {
            documentUrl = `/uploads/documents/${req.file.filename}`;
        }
        // Return a URL that can be attached to the create payload before the associate exists.
        return res.json({ document_url: documentUrl, document_name: req.file.originalname });
    }
    catch (error) {
        if (!isGcs && req.file.path) {
            await fs.unlink(req.file.path).catch(() => undefined);
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
const uploadErrorHandler = (err, _req, res, next) => {
    if (!err) {
        return next();
    }
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum image size is 15MB and maximum document size is 10MB.' });
        }
        return res.status(400).json({ error: err.message || 'Invalid upload payload.' });
    }
    if (err instanceof Error) {
        return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    return next(err);
};
router.use(uploadErrorHandler);
export default router;
//# sourceMappingURL=agents.js.map