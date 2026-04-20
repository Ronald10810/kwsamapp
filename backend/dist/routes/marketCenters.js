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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');
const marketCenterImagesDir = path.join(uploadsDir, 'market-centers');
async function ensureUploadDirs() {
    try {
        await fs.mkdir(marketCenterImagesDir, { recursive: true });
    }
    catch (error) {
        console.error('Failed to create market center upload directory:', error);
    }
}
await ensureUploadDirs();
const logoStorage = multer.diskStorage({
    destination: marketCenterImagesDir,
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const ext = path.extname(file.originalname);
        cb(null, `market-center-${uniqueSuffix}${ext}`);
    },
});
const uploadLogo = multer({
    storage: logoStorage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
const uploadLogoMiddleware = uploadLogo.single('image');
const ACTIVE_ASSOCIATE_WHERE = `(
  LOWER(TRIM(COALESCE(status_name, ''))) = 'active'
  OR TRIM(COALESCE(status_name, '')) = '1'
)`;
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
        const trimmed = value.trim();
        if (trimmed.length === 0)
            return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
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
function buildManualMarketCenterId() {
    const ts = Date.now().toString();
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `MAN-MC-${ts}-${rand}`;
}
async function saveNotes(marketCenterId, notes) {
    if (!pool)
        return;
    await pool.query(`DELETE FROM migration.market_center_notes WHERE market_center_id = $1`, [marketCenterId]);
    for (const note of notes) {
        await pool.query(`INSERT INTO migration.market_center_notes (market_center_id, note_text, created_by)
       VALUES ($1, $2, $3)`, [marketCenterId, note, 'console-user']);
    }
}
router.get('/', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const limitInput = Number(req.query.limit ?? 25);
    const offsetInput = Number(req.query.offset ?? 0);
    const searchInput = String(req.query.search ?? '').trim();
    const statusInput = String(req.query.status ?? '').trim().toLowerCase();
    const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 250) : 25;
    const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;
    try {
        const exists = await pool.query(`SELECT to_regclass('migration.core_market_centers') AS exists`);
        if (!exists.rows[0]?.exists) {
            return res.json({ total: 0, limit, offset, items: [] });
        }
        const whereClauses = [];
        const params = [];
        if (searchInput.length > 0) {
            params.push(`%${searchInput}%`);
            const searchParam = `$${params.length}`;
            whereClauses.push(`(
          mc.name ILIKE ${searchParam}
          OR mc.company_registered_name ILIKE ${searchParam}
          OR mc.source_market_center_id ILIKE ${searchParam}
          OR mc.status_name ILIKE ${searchParam}
          OR mc.frontdoor_id ILIKE ${searchParam}
          OR mc.kw_office_id ILIKE ${searchParam}
          OR mc.market_center_property24_id ILIKE ${searchParam}
          OR mc.city ILIKE ${searchParam}
        )`);
        }
        if (statusInput === 'active') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(mc.status_name, ''))) = 'active' OR TRIM(COALESCE(mc.status_name, '')) = '1')`);
        }
        else if (statusInput === 'inactive') {
            whereClauses.push(`(LOWER(TRIM(COALESCE(mc.status_name, ''))) = 'inactive' OR TRIM(COALESCE(mc.status_name, '')) = '2')`);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const totalResult = await pool.query(`SELECT COUNT(*)::text AS total FROM migration.core_market_centers mc ${whereSql}`, params);
        params.push(limit);
        const limitParam = `$${params.length}`;
        params.push(offset);
        const offsetParam = `$${params.length}`;
        const dataResult = await pool.query(`
      SELECT
        mc.id::text,
        mc.source_market_center_id,
        mc.name,
        mc.status_name,
        mc.company_registered_name,
        mc.frontdoor_id,
        mc.contact_number,
        mc.contact_email,
        mc.kw_office_id,
        mc.city,
        mc.logo_image_url,
        mc.market_center_property24_id,
        mc.property24_opt_in,
        COALESCE(agent_totals.agent_count, 0)::text AS agent_count,
        COALESCE(team_totals.team_count, 0)::text AS team_count,
        mc.updated_at::text
      FROM migration.core_market_centers mc
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS agent_count
        FROM migration.core_associates a
        WHERE a.market_center_id = mc.id
          AND (
            LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
            OR TRIM(COALESCE(a.status_name, '')) = '1'
          )
      ) agent_totals ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS team_count
        FROM migration.core_teams t
        WHERE t.market_center_id = mc.id
      ) team_totals ON TRUE
      ${whereSql}
      ORDER BY mc.name ASC
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
router.get('/:id/details', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid market center id.' });
    }
    try {
        const base = await pool.query(`
      SELECT
        mc.id::text,
        mc.source_market_center_id,
        mc.name,
        mc.status_name,
        mc.company_registered_name,
        mc.kw_office_id,
        mc.frontdoor_id,
        mc.contact_number,
        mc.contact_email,
        mc.has_individual_cap,
        mc.agent_default_cap::text,
        mc.market_center_default_split::text,
        mc.agent_default_split::text,
        mc.productivity_coach,
        mc.property24_opt_in,
        mc.property24_auction_approved,
        mc.market_center_property24_id,
        mc.private_property_id,
        mc.entegral_opt_in,
        mc.entegral_url,
        COALESCE(mc.entegral_portals, ARRAY[]::text[]) AS entegral_portals,
        mc.logo_image_url,
        mc.logo_document_id,
        mc.address_source_id,
        mc.country,
        mc.province,
        mc.city,
        mc.suburb,
        mc.erf_number,
        mc.unit_number,
        mc.door_number,
        mc.estate_name,
        mc.street_number,
        mc.street_name,
        mc.postal_code,
        mc.longitude::text,
        mc.latitude::text,
        mc.override_display_location,
        mc.display_longitude::text,
        mc.display_latitude::text
      FROM migration.core_market_centers mc
      WHERE mc.id = $1
      `, [id]);
        if (base.rowCount === 0) {
            return res.status(404).json({ error: 'Market center not found.' });
        }
        const [notes, teams, agents] = await Promise.all([
            pool.query(`SELECT note_text, created_by, created_at::text FROM migration.market_center_notes WHERE market_center_id = $1 ORDER BY id ASC`, [id]),
            pool.query(`
        SELECT
          t.id::text,
          t.source_team_id,
          t.name,
          t.status_name,
          COUNT(a.id)::text AS agent_count
        FROM migration.core_teams t
        LEFT JOIN migration.core_associates a
          ON a.team_id = t.id
         AND (
           LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
           OR TRIM(COALESCE(a.status_name, '')) = '1'
         )
        WHERE t.market_center_id = $1
        GROUP BY t.id
        ORDER BY t.name ASC
        `, [id]),
            pool.query(`
        SELECT
          a.id::text,
          a.full_name,
          a.email,
          a.mobile_number,
          a.image_url,
          a.status_name,
          t.name AS team_name
        FROM migration.core_associates a
        LEFT JOIN migration.core_teams t ON t.id = a.team_id
        WHERE a.market_center_id = $1
          AND (
            LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
            OR TRIM(COALESCE(a.status_name, '')) = '1'
          )
        ORDER BY a.full_name ASC NULLS LAST, a.source_associate_id ASC
        `, [id]),
        ]);
        return res.json({
            ...base.rows[0],
            notes: notes.rows,
            teams: teams.rows,
            agents: agents.rows,
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
    const name = toText(req.body?.name);
    const sourceMarketCenterId = toText(req.body?.source_market_center_id) ?? buildManualMarketCenterId();
    if (!name) {
        return res.status(400).json({ error: 'name is required.' });
    }
    try {
        const insert = await pool.query(`
      INSERT INTO migration.core_market_centers (
        source_market_center_id,
        name,
        status_name,
        company_registered_name,
        kw_office_id,
        frontdoor_id,
        contact_number,
        contact_email,
        has_individual_cap,
        agent_default_cap,
        market_center_default_split,
        agent_default_split,
        productivity_coach,
        property24_opt_in,
        property24_auction_approved,
        market_center_property24_id,
        private_property_id,
        entegral_opt_in,
        entegral_url,
        entegral_portals,
        logo_image_url,
        country,
        province,
        city,
        suburb,
        erf_number,
        unit_number,
        door_number,
        estate_name,
        street_number,
        street_name,
        postal_code,
        longitude,
        latitude,
        override_display_location,
        display_longitude,
        display_latitude,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,NOW()
      )
      RETURNING id::text
      `, [
            sourceMarketCenterId,
            name,
            toText(req.body?.status_name),
            toText(req.body?.company_registered_name),
            toText(req.body?.kw_office_id),
            toText(req.body?.frontdoor_id),
            toText(req.body?.contact_number),
            toText(req.body?.contact_email),
            toBool(req.body?.has_individual_cap),
            toNumber(req.body?.agent_default_cap),
            toNumber(req.body?.market_center_default_split),
            toNumber(req.body?.agent_default_split),
            toText(req.body?.productivity_coach),
            toBool(req.body?.property24_opt_in),
            toBool(req.body?.property24_auction_approved),
            toText(req.body?.market_center_property24_id),
            toText(req.body?.private_property_id),
            toBool(req.body?.entegral_opt_in),
            toText(req.body?.entegral_url),
            toStringArray(req.body?.entegral_portals),
            toText(req.body?.logo_image_url),
            toText(req.body?.country),
            toText(req.body?.province),
            toText(req.body?.city),
            toText(req.body?.suburb),
            toText(req.body?.erf_number),
            toText(req.body?.unit_number),
            toText(req.body?.door_number),
            toText(req.body?.estate_name),
            toText(req.body?.street_number),
            toText(req.body?.street_name),
            toText(req.body?.postal_code),
            toNumber(req.body?.longitude),
            toNumber(req.body?.latitude),
            toBool(req.body?.override_display_location),
            toNumber(req.body?.display_longitude),
            toNumber(req.body?.display_latitude),
        ]);
        await saveNotes(Number(insert.rows[0].id), toStringArray(req.body?.notes));
        return res.status(201).json({ id: insert.rows[0].id, source_market_center_id: sourceMarketCenterId });
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
        return res.status(400).json({ error: 'Invalid market center id.' });
    }
    const name = toText(req.body?.name);
    if (!name) {
        return res.status(400).json({ error: 'name is required.' });
    }
    try {
        const update = await pool.query(`
      UPDATE migration.core_market_centers
      SET
        name = $1,
        status_name = $2,
        company_registered_name = $3,
        kw_office_id = $4,
        frontdoor_id = $5,
        contact_number = $6,
        contact_email = $7,
        has_individual_cap = $8,
        agent_default_cap = $9,
        market_center_default_split = $10,
        agent_default_split = $11,
        productivity_coach = $12,
        property24_opt_in = $13,
        property24_auction_approved = $14,
        market_center_property24_id = $15,
        private_property_id = $16,
        entegral_opt_in = $17,
        entegral_url = $18,
        entegral_portals = $19,
        logo_image_url = $20,
        country = $21,
        province = $22,
        city = $23,
        suburb = $24,
        erf_number = $25,
        unit_number = $26,
        door_number = $27,
        estate_name = $28,
        street_number = $29,
        street_name = $30,
        postal_code = $31,
        longitude = $32,
        latitude = $33,
        override_display_location = $34,
        display_longitude = $35,
        display_latitude = $36,
        updated_at = NOW()
      WHERE id = $37
      RETURNING id::text
      `, [
            name,
            toText(req.body?.status_name),
            toText(req.body?.company_registered_name),
            toText(req.body?.kw_office_id),
            toText(req.body?.frontdoor_id),
            toText(req.body?.contact_number),
            toText(req.body?.contact_email),
            toBool(req.body?.has_individual_cap),
            toNumber(req.body?.agent_default_cap),
            toNumber(req.body?.market_center_default_split),
            toNumber(req.body?.agent_default_split),
            toText(req.body?.productivity_coach),
            toBool(req.body?.property24_opt_in),
            toBool(req.body?.property24_auction_approved),
            toText(req.body?.market_center_property24_id),
            toText(req.body?.private_property_id),
            toBool(req.body?.entegral_opt_in),
            toText(req.body?.entegral_url),
            toStringArray(req.body?.entegral_portals),
            toText(req.body?.logo_image_url),
            toText(req.body?.country),
            toText(req.body?.province),
            toText(req.body?.city),
            toText(req.body?.suburb),
            toText(req.body?.erf_number),
            toText(req.body?.unit_number),
            toText(req.body?.door_number),
            toText(req.body?.estate_name),
            toText(req.body?.street_number),
            toText(req.body?.street_name),
            toText(req.body?.postal_code),
            toNumber(req.body?.longitude),
            toNumber(req.body?.latitude),
            toBool(req.body?.override_display_location),
            toNumber(req.body?.display_longitude),
            toNumber(req.body?.display_latitude),
            id,
        ]);
        if (update.rowCount === 0) {
            return res.status(404).json({ error: 'Market center not found.' });
        }
        await saveNotes(id, toStringArray(req.body?.notes));
        return res.json({ id: update.rows[0].id });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
router.post('/:id/upload-logo', uploadLogoMiddleware, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid market center id.' });
    }
    try {
        const imageUrl = `/uploads/market-centers/${req.file.filename}`;
        const result = await pool.query(`UPDATE migration.core_market_centers SET logo_image_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id::text`, [imageUrl, id]);
        if (result.rowCount === 0) {
            await fs.unlink(req.file.path).catch(() => undefined);
            return res.status(404).json({ error: 'Market center not found.' });
        }
        return res.json({ logo_image_url: imageUrl });
    }
    catch (error) {
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
            return res.status(413).json({ error: 'File too large. Maximum image size is 15MB.' });
        }
        return res.status(400).json({ error: err.message || 'Invalid upload payload.' });
    }
    if (err instanceof Error) {
        return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Unexpected upload error.' });
};
router.use(uploadErrorHandler);
export default router;
//# sourceMappingURL=marketCenters.js.map