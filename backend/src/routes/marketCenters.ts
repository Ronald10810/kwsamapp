import { Router, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getOptionalPgPool } from '../config/db.js';
import { ensureLocalUploadDirs, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';

const router = Router();
const pool = getOptionalPgPool();

let marketCenterColumnCache: Set<string> | null = null;
let marketCenterNotesTableExistsCache: boolean | null = null;

async function getMarketCenterColumns(): Promise<Set<string>> {
  if (!pool) return new Set();
  if (marketCenterColumnCache) return marketCenterColumnCache;

  const result = await pool.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'migration'
      AND table_name = 'core_market_centers'
    `
  );

  marketCenterColumnCache = new Set(result.rows.map((row) => row.column_name));
  return marketCenterColumnCache;
}

async function hasMarketCenterNotesTable(): Promise<boolean> {
  if (!pool) return false;
  if (marketCenterNotesTableExistsCache !== null) return marketCenterNotesTableExistsCache;

  const result = await pool.query<{ exists: string | null }>(
    `SELECT to_regclass('migration.market_center_notes') AS exists`
  );

  marketCenterNotesTableExistsCache = Boolean(result.rows[0]?.exists);
  return marketCenterNotesTableExistsCache;
}

function optionalMarketCenterTextColumn(columns: Set<string>, columnName: string): string {
  return columns.has(columnName) ? `mc.${columnName}` : `NULL::text AS ${columnName}`;
}

function optionalMarketCenterBooleanColumn(columns: Set<string>, columnName: string): string {
  return columns.has(columnName) ? `COALESCE(mc.${columnName}, FALSE) AS ${columnName}` : `FALSE AS ${columnName}`;
}

function optionalMarketCenterNumericTextColumn(columns: Set<string>, columnName: string): string {
  return columns.has(columnName) ? `mc.${columnName}::text AS ${columnName}` : `NULL::text AS ${columnName}`;
}

function optionalMarketCenterTextArrayColumn(columns: Set<string>, columnName: string): string {
  return columns.has(columnName) ? `COALESCE(mc.${columnName}, ARRAY[]::text[]) AS ${columnName}` : `ARRAY[]::text[] AS ${columnName}`;
}

const marketCenterImagesDir = resolveLocalUploadDir('market-centers');

async function ensureUploadDirs(): Promise<void> {
  try {
    await ensureLocalUploadDirs('market-centers');
  } catch (error) {
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

// Use memory storage when uploading to GCS; disk storage for local dev.
const logoStorageEngine = storageConfig.localUploadsEnabled ? logoStorage : multer.memoryStorage();

const uploadLogo = multer({
  storage: logoStorageEngine,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

async function runUploadMiddleware(req: unknown, res: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    uploadLogo.single('image')(req as never, res as never, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function buildManualMarketCenterId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `MAN-MC-${ts}-${rand}`;
}

async function saveNotes(marketCenterId: number, notes: string[]): Promise<void> {
  if (!pool) return;
  if (!(await hasMarketCenterNotesTable())) return;

  await pool.query(`DELETE FROM migration.market_center_notes WHERE market_center_id = $1`, [marketCenterId]);
  for (const note of notes) {
    await pool.query(
      `INSERT INTO migration.market_center_notes (market_center_id, note_text, created_by)
       VALUES ($1, $2, $3)`,
      [marketCenterId, note, 'console-user']
    );
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
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_market_centers') AS exists`
    );

    if (!exists.rows[0]?.exists) {
      return res.json({ total: 0, limit, offset, items: [] });
    }

    const marketCenterColumns = await getMarketCenterColumns();

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (searchInput.length > 0) {
      params.push(`%${searchInput}%`);
      const searchParam = `$${params.length}`;
      const searchColumns = [
        'name',
        'company_registered_name',
        'source_market_center_id',
        'status_name',
        'frontdoor_id',
        'kw_office_id',
        'market_center_property24_id',
        'city',
      ].filter((columnName) => marketCenterColumns.has(columnName));

      if (searchColumns.length > 0) {
        const conditions = searchColumns.map((columnName) => `mc.${columnName} ILIKE ${searchParam}`);
        whereClauses.push(`(${conditions.join(' OR ')})`);
      }
    }

    if (statusInput === 'active') {
      whereClauses.push(`(LOWER(TRIM(COALESCE(mc.status_name, ''))) = 'active' OR TRIM(COALESCE(mc.status_name, '')) = '1')`);
    } else if (statusInput === 'inactive') {
      whereClauses.push(`(LOWER(TRIM(COALESCE(mc.status_name, ''))) = 'inactive' OR TRIM(COALESCE(mc.status_name, '')) = '2')`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM migration.core_market_centers mc ${whereSql}`,
      params
    );

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataResult = await pool.query<{
      id: string;
      source_market_center_id: string;
      name: string;
      status_name: string | null;
      company_registered_name: string | null;
      frontdoor_id: string | null;
      contact_number: string | null;
      contact_email: string | null;
      kw_office_id: string | null;
      city: string | null;
      logo_image_url: string | null;
      market_center_property24_id: string | null;
      property24_opt_in: boolean;
      agent_count: string;
      team_count: string;
      updated_at: string;
    }>(
      `
      SELECT
        mc.id::text,
        mc.source_market_center_id,
        mc.name,
        mc.status_name,
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'company_registered_name')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'frontdoor_id')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'contact_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'contact_email')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'kw_office_id')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'city')},
        mc.logo_image_url,
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'market_center_property24_id')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'property24_opt_in')},
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
      `,
      params
    );

    return res.json({
      total: Number(totalResult.rows[0]?.total ?? 0),
      limit,
      offset,
      items: dataResult.rows,
    });
  } catch (error) {
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
    const marketCenterColumns = await getMarketCenterColumns();

    const base = await pool.query(
      `
      SELECT
        mc.id::text,
        mc.source_market_center_id,
        mc.name,
        mc.status_name,
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'company_registered_name')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'kw_office_id')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'frontdoor_id')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'contact_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'contact_email')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'has_individual_cap')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'agent_default_cap')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'market_center_default_split')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'agent_default_split')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'productivity_coach')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'property24_opt_in')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'property24_auction_approved')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'market_center_property24_id')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'private_property_id')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'entegral_opt_in')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'entegral_url')},
        ${optionalMarketCenterTextArrayColumn(marketCenterColumns, 'entegral_portals')},
        mc.logo_image_url,
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'country')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'province')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'city')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'suburb')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'erf_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'unit_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'door_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'estate_name')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'street_number')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'street_name')},
        ${optionalMarketCenterTextColumn(marketCenterColumns, 'postal_code')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'longitude')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'latitude')},
        ${optionalMarketCenterBooleanColumn(marketCenterColumns, 'override_display_location')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'display_longitude')},
        ${optionalMarketCenterNumericTextColumn(marketCenterColumns, 'display_latitude')}
      FROM migration.core_market_centers mc
      WHERE mc.id = $1
      `,
      [id]
    );

    if (base.rowCount === 0) {
      return res.status(404).json({ error: 'Market center not found.' });
    }

    const notesTableExists = await hasMarketCenterNotesTable();

    const [notes, teams, agents] = await Promise.all([
      notesTableExists
        ? pool.query<{ note_text: string; created_by: string | null; created_at: string }>(
            `SELECT note_text, created_by, created_at::text FROM migration.market_center_notes WHERE market_center_id = $1 ORDER BY id ASC`,
            [id]
          )
        : Promise.resolve({ rows: [] } as { rows: Array<{ note_text: string; created_by: string | null; created_at: string }> }),
      pool.query<{
        id: string;
        source_team_id: string;
        name: string;
        status_name: string | null;
        agent_count: string;
      }>(
        `
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
        `,
        [id]
      ),
      pool.query<{
        id: string;
        full_name: string | null;
        email: string | null;
        mobile_number: string | null;
        image_url: string | null;
        status_name: string | null;
        team_name: string | null;
      }>(
        `
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
        `,
        [id]
      ),
    ]);

    return res.json({
      ...base.rows[0],
      notes: notes.rows,
      teams: teams.rows,
      agents: agents.rows,
    });
  } catch (error) {
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
    const marketCenterColumns = await getMarketCenterColumns();
    const values: unknown[] = [];
    const insertColumns: string[] = [];
    const insertValueSql: string[] = [];
    const addInsertValue = (columnName: string, value: unknown): void => {
      if (!marketCenterColumns.has(columnName)) return;
      values.push(value);
      insertColumns.push(columnName);
      insertValueSql.push(`$${values.length}`);
    };

    addInsertValue('source_market_center_id', sourceMarketCenterId);
    addInsertValue('name', name);
    addInsertValue('status_name', toText(req.body?.status_name));
    addInsertValue('company_registered_name', toText(req.body?.company_registered_name));
    addInsertValue('kw_office_id', toText(req.body?.kw_office_id));
    addInsertValue('frontdoor_id', toText(req.body?.frontdoor_id));
    addInsertValue('contact_number', toText(req.body?.contact_number));
    addInsertValue('contact_email', toText(req.body?.contact_email));
    addInsertValue('has_individual_cap', toBool(req.body?.has_individual_cap));
    addInsertValue('agent_default_cap', toNumber(req.body?.agent_default_cap));
    addInsertValue('market_center_default_split', toNumber(req.body?.market_center_default_split));
    addInsertValue('agent_default_split', toNumber(req.body?.agent_default_split));
    addInsertValue('productivity_coach', toText(req.body?.productivity_coach));
    addInsertValue('property24_opt_in', toBool(req.body?.property24_opt_in));
    addInsertValue('property24_auction_approved', toBool(req.body?.property24_auction_approved));
    addInsertValue('market_center_property24_id', toText(req.body?.market_center_property24_id));
    addInsertValue('private_property_id', toText(req.body?.private_property_id));
    addInsertValue('entegral_opt_in', toBool(req.body?.entegral_opt_in));
    addInsertValue('entegral_url', toText(req.body?.entegral_url));
    addInsertValue('entegral_portals', toStringArray(req.body?.entegral_portals));
    addInsertValue('logo_image_url', toText(req.body?.logo_image_url));
    addInsertValue('country', toText(req.body?.country));
    addInsertValue('province', toText(req.body?.province));
    addInsertValue('city', toText(req.body?.city));
    addInsertValue('suburb', toText(req.body?.suburb));
    addInsertValue('erf_number', toText(req.body?.erf_number));
    addInsertValue('unit_number', toText(req.body?.unit_number));
    addInsertValue('door_number', toText(req.body?.door_number));
    addInsertValue('estate_name', toText(req.body?.estate_name));
    addInsertValue('street_number', toText(req.body?.street_number));
    addInsertValue('street_name', toText(req.body?.street_name));
    addInsertValue('postal_code', toText(req.body?.postal_code));
    addInsertValue('longitude', toNumber(req.body?.longitude));
    addInsertValue('latitude', toNumber(req.body?.latitude));
    addInsertValue('override_display_location', toBool(req.body?.override_display_location));
    addInsertValue('display_longitude', toNumber(req.body?.display_longitude));
    addInsertValue('display_latitude', toNumber(req.body?.display_latitude));

    if (marketCenterColumns.has('updated_at')) {
      insertColumns.push('updated_at');
      insertValueSql.push('NOW()');
    }

    const insert = await pool.query<{ id: string }>(
      `
      INSERT INTO migration.core_market_centers (
        ${insertColumns.join(',\n        ')}
      ) VALUES (
        ${insertValueSql.join(',')}
      )
      RETURNING id::text
      `,
      values
    );

    await saveNotes(Number(insert.rows[0].id), toStringArray(req.body?.notes));

    return res.status(201).json({ id: insert.rows[0].id, source_market_center_id: sourceMarketCenterId });
  } catch (error) {
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
    const marketCenterColumns = await getMarketCenterColumns();
    const values: unknown[] = [];
    const setClauses: string[] = [];
    const addSetValue = (columnName: string, value: unknown): void => {
      if (!marketCenterColumns.has(columnName)) return;
      values.push(value);
      setClauses.push(`${columnName} = $${values.length}`);
    };

    addSetValue('name', name);
    addSetValue('status_name', toText(req.body?.status_name));
    addSetValue('company_registered_name', toText(req.body?.company_registered_name));
    addSetValue('kw_office_id', toText(req.body?.kw_office_id));
    addSetValue('frontdoor_id', toText(req.body?.frontdoor_id));
    addSetValue('contact_number', toText(req.body?.contact_number));
    addSetValue('contact_email', toText(req.body?.contact_email));
    addSetValue('has_individual_cap', toBool(req.body?.has_individual_cap));
    addSetValue('agent_default_cap', toNumber(req.body?.agent_default_cap));
    addSetValue('market_center_default_split', toNumber(req.body?.market_center_default_split));
    addSetValue('agent_default_split', toNumber(req.body?.agent_default_split));
    addSetValue('productivity_coach', toText(req.body?.productivity_coach));
    addSetValue('property24_opt_in', toBool(req.body?.property24_opt_in));
    addSetValue('property24_auction_approved', toBool(req.body?.property24_auction_approved));
    addSetValue('market_center_property24_id', toText(req.body?.market_center_property24_id));
    addSetValue('private_property_id', toText(req.body?.private_property_id));
    addSetValue('entegral_opt_in', toBool(req.body?.entegral_opt_in));
    addSetValue('entegral_url', toText(req.body?.entegral_url));
    addSetValue('entegral_portals', toStringArray(req.body?.entegral_portals));
    addSetValue('logo_image_url', toText(req.body?.logo_image_url));
    addSetValue('country', toText(req.body?.country));
    addSetValue('province', toText(req.body?.province));
    addSetValue('city', toText(req.body?.city));
    addSetValue('suburb', toText(req.body?.suburb));
    addSetValue('erf_number', toText(req.body?.erf_number));
    addSetValue('unit_number', toText(req.body?.unit_number));
    addSetValue('door_number', toText(req.body?.door_number));
    addSetValue('estate_name', toText(req.body?.estate_name));
    addSetValue('street_number', toText(req.body?.street_number));
    addSetValue('street_name', toText(req.body?.street_name));
    addSetValue('postal_code', toText(req.body?.postal_code));
    addSetValue('longitude', toNumber(req.body?.longitude));
    addSetValue('latitude', toNumber(req.body?.latitude));
    addSetValue('override_display_location', toBool(req.body?.override_display_location));
    addSetValue('display_longitude', toNumber(req.body?.display_longitude));
    addSetValue('display_latitude', toNumber(req.body?.display_latitude));

    if (marketCenterColumns.has('updated_at')) {
      setClauses.push('updated_at = NOW()');
    }

    values.push(id);
    const update = await pool.query<{ id: string }>(
      `
      UPDATE migration.core_market_centers
      SET
        ${setClauses.join(',\n        ')}
      WHERE id = $${values.length}
      RETURNING id::text
      `,
      values
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ error: 'Market center not found.' });
    }

    await saveNotes(id, toStringArray(req.body?.notes));

    return res.json({ id: update.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/upload-logo', async (req, res, next) => {
  const isGcs = !storageConfig.localUploadsEnabled;

  try {
    await runUploadMiddleware(req, res);
  } catch (error) {
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
    return res.status(400).json({ error: 'Invalid market center id.' });
  }

  try {
    let imageUrl: string;

    if (isGcs) {
      // Upload buffer to GCS
      const { publicUrl } = await uploadToGcs(
        req.file.buffer,
        req.file.originalname,
        'market-center',
        req.file.mimetype
      );
      imageUrl = publicUrl;
    } else {
      imageUrl = `/uploads/market-centers/${req.file.filename}`;
    }

    const result = await pool.query(
      `UPDATE migration.core_market_centers SET logo_image_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id::text`,
      [imageUrl, id]
    );

    if (result.rowCount === 0) {
      if (!isGcs && req.file.path) {
        await fs.unlink(req.file.path).catch(() => undefined);
      }
      return res.status(404).json({ error: 'Market center not found.' });
    }

    return res.json({ logo_image_url: imageUrl });
  } catch (error) {
    if (!isGcs && req.file.path) {
      await fs.unlink(req.file.path).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

const uploadErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
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
