import { Router } from 'express';
import { Pool } from 'pg';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const router = Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
// File upload setup
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const documentsDir = path.join(uploadsDir, 'documents');
// Ensure upload directories exist
async function ensureUploadDirs() {
    try {
        await fs.mkdir(imagesDir, { recursive: true });
        await fs.mkdir(documentsDir, { recursive: true });
    }
    catch (error) {
        console.error('Failed to create upload directories:', error);
    }
}
// Initialize directories on module load
await ensureUploadDirs();
// Configure multer storage
const imageStorage = multer.diskStorage({
    destination: imagesDir,
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const ext = path.extname(file.originalname);
        cb(null, `image-${uniqueSuffix}${ext}`);
    },
});
const documentStorage = multer.diskStorage({
    destination: documentsDir,
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const ext = path.extname(file.originalname);
        cb(null, `doc-${uniqueSuffix}${ext}`);
    },
});
const uploadImage = multer({
    storage: imageStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
const uploadDocument = multer({
    storage: documentStorage,
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
function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => toText(entry))
        .filter((entry) => Boolean(entry));
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
async function saveCollections(client, associateId, body) {
    const socialMedia = toSocialMediaEntries(body.social_media);
    const roles = toStringArray(body.roles);
    const jobTitles = toStringArray(body.job_titles);
    const serviceCommunities = toStringArray(body.service_communities);
    const adminMarketCenters = toStringArray(body.admin_market_centers);
    const adminTeams = toStringArray(body.admin_teams);
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
        a.source_associate_id,
        a.full_name,
        a.source_market_center_id,
        mc.name AS market_center_name
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      ORDER BY a.full_name ASC NULLS LAST, a.source_associate_id ASC
      `);
        return res.json({
            items: result.rows.map((row) => ({
                source_associate_id: row.source_associate_id,
                full_name: row.full_name,
                source_market_center_id: row.source_market_center_id,
                market_center_name: row.market_center_name,
            })),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.get('/:id/details', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
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
        a.manual_cap::text,
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
            pool.query(`SELECT source_market_center_id FROM migration.associate_admin_market_centers WHERE associate_id = $1 ORDER BY id ASC`, [id]),
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
        return res.json({
            ...payload,
            social_media: socialMedia.rows,
            roles: roles.rows.map((row) => row.role_name),
            job_titles: jobTitles.rows.map((row) => row.job_title),
            service_communities: serviceCommunities.rows.map((row) => row.community_name),
            admin_market_centers: adminMarketCenters.rows.map((row) => row.source_market_center_id),
            admin_teams: adminTeams.rows.map((row) => row.source_team_id),
            documents: documents.rows,
            commission_notes: commissionNotes,
            date_notes: dateNotes,
            document_notes: documentNotes,
        });
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
      SELECT
        a.id,
        a.source_associate_id,
        a.full_name,
        a.first_name,
        a.last_name,
        COALESCE(a.kwsa_email, a.email) AS email,
        a.status_name,
        a.kwuid,
        a.source_market_center_id,
        a.source_team_id,
        a.image_url,
        a.mobile_number,
        mc.name AS market_center_name,
        a.updated_at::text
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
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
router.post('/', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const body = (req.body ?? {});
    const firstName = toText(body.first_name);
    const lastName = toText(body.last_name);
    const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fullName = toText(body.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null);
    const sourceAssociateId = toText(body.source_associate_id) ?? buildManualAssociateId();
    const sourceMarketCenterId = toText(body.source_market_center_id);
    const sourceTeamId = toText(body.source_team_id);
    if (!fullName) {
        return res.status(400).json({ error: 'full_name (or first_name/last_name) is required.' });
    }
    const nationalId = toText(body.national_id);
    const ffcNumber = toText(body.ffc_number);
    const kwsaEmail = toText(body.kwsa_email) ?? toText(body.email);
    const privateEmail = toText(body.private_email);
    const mobileNumber = toText(body.mobile_number);
    const officeNumber = toText(body.office_number);
    const imageUrl = toText(body.image_url);
    const growthShareSponsor = toText(body.growth_share_sponsor);
    const temporaryGrowthShareSponsor = toText(body.temporary_growth_share_sponsor);
    const proposedGrowthShareSponsor = toText(body.proposed_growth_share_sponsor);
    const kwuid = toText(body.kwuid);
    const vested = toBool(body.vested);
    const vestingPeriodStartDate = toDate(body.vesting_period_start_date);
    const listingApprovalRequired = toBool(body.listing_approval_required);
    const excludeFromIndividualReports = toBool(body.exclude_from_individual_reports);
    const property24OptIn = toBool(body.property24_opt_in);
    const agentProperty24Id = toText(body.agent_property24_id);
    const property24Status = toText(body.property24_status);
    const entegralOptIn = toBool(body.entegral_opt_in);
    const agentEntegralId = toText(body.agent_entegral_id);
    const entegralStatus = toText(body.entegral_status);
    const privatePropertyOptIn = toBool(body.private_property_opt_in);
    const privatePropertyStatus = toText(body.private_property_status);
    const cap = toNumber(body.cap);
    const manualCap = toNumber(body.manual_cap);
    const agentSplit = toNumber(body.agent_split);
    const projectedCos = toNumber(body.projected_cos);
    const projectedCap = toNumber(body.projected_cap);
    const startDate = toDate(body.start_date);
    const endDate = toDate(body.end_date);
    const anniversaryDate = toDate(body.anniversary_date);
    const capDate = toDate(body.cap_date);
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
        return res.status(201).json({ id: insert.rows[0].id, source_associate_id: sourceAssociateId });
    }
    catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
    finally {
        client.release();
    }
});
router.put('/:id', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid associate id.' });
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
            toText(body.kwsa_email) ?? toText(body.email),
            toText(body.status_name),
            toText(body.kwuid),
            toText(body.image_url),
            toText(body.mobile_number),
            toText(body.national_id),
            toText(body.ffc_number),
            toText(body.kwsa_email) ?? toText(body.email),
            toText(body.private_email),
            toText(body.office_number),
            toText(body.growth_share_sponsor),
            toText(body.temporary_growth_share_sponsor),
            toText(body.proposed_growth_share_sponsor),
            toBool(body.vested),
            toDate(body.vesting_period_start_date),
            toBool(body.listing_approval_required),
            toBool(body.exclude_from_individual_reports),
            toBool(body.property24_opt_in),
            toText(body.agent_property24_id),
            toText(body.property24_status),
            toBool(body.entegral_opt_in),
            toText(body.agent_entegral_id),
            toText(body.entegral_status),
            toBool(body.private_property_opt_in),
            toText(body.private_property_status),
            toNumber(body.cap),
            toNumber(body.manual_cap),
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
        return res.json({ id: result.rows[0].id });
    }
    catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
    finally {
        client.release();
    }
});
router.post('/:id/upload-image', uploadImage.single('image'), async (req, res) => {
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
        const imageUrl = `/uploads/images/${req.file.filename}`;
        // Update the image_url in the database
        const result = await pool.query(`UPDATE migration.core_associates SET image_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id::text`, [imageUrl, id]);
        if (result.rowCount === 0) {
            // Clean up the uploaded file if associate doesn't exist
            await fs.unlink(req.file.path).catch(() => undefined);
            return res.status(404).json({ error: 'Associate not found.' });
        }
        return res.json({ image_url: imageUrl });
    }
    catch (error) {
        // Clean up the uploaded file on error
        await fs.unlink(req.file.path).catch(() => undefined);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/:id/upload-document', uploadDocument.single('document'), async (req, res) => {
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
        const documentUrl = `/uploads/documents/${req.file.filename}`;
        // Insert document record
        const result = await pool.query(`INSERT INTO migration.associate_documents (associate_id, document_type, document_name, document_url, uploaded_by)
       VALUES ($1, $2, $3, $4, 'console-upload')
       RETURNING id::text`, [id, documentType, req.file.originalname, documentUrl]);
        if (result.rowCount === 0) {
            // Clean up the uploaded file if insert failed
            await fs.unlink(req.file.path).catch(() => undefined);
            return res.status(400).json({ error: 'Failed to save document record.' });
        }
        return res.json({ document_url: documentUrl });
    }
    catch (error) {
        // Clean up the uploaded file on error
        await fs.unlink(req.file.path).catch(() => undefined);
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