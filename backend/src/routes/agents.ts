import { Router, type ErrorRequestHandler } from 'express';
import { type PoolClient } from 'pg';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { recomputeAllTransactionAgentCalculations } from '../services/transactionCalculations.js';
import { getOptionalPgPool } from '../config/db.js';
import { ensureLocalUploadDirs, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { env } from '../config/env.js';

const router = Router();
const pool = getOptionalPgPool();

// File upload setup
const imagesDir = resolveLocalUploadDir('images');
const documentsDir = resolveLocalUploadDir('documents');

// Ensure upload directories exist
async function ensureUploadDirs(): Promise<void> {
  try {
    await ensureLocalUploadDirs('images', 'documents');
  } catch (error) {
    console.error('Failed to create upload directories:', error);
  }
}

// Initialize directories on module load
await ensureUploadDirs();

// Configure multer storage — use memory storage when GCS is enabled
const imageStorageEngine = storageConfig.localUploadsEnabled
  ? multer.diskStorage({
      destination: imagesDir,
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const ext = path.extname(file.originalname);
        cb(null, `image-${uniqueSuffix}${ext}`);
      },
    })
  : multer.memoryStorage();

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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
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
    } else {
      cb(new Error('Only PDF, JPEG, and PNG files are allowed'));
    }
  },
});

async function runUploadMiddleware(req: unknown, res: unknown, middleware: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (middleware as (req: unknown, res: unknown, next: (error?: unknown) => void) => void)(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

type SocialMediaInput = { platform: string | null; url: string | null };
type DocumentInput = { document_type: string; document_name: string | null; document_url: string | null };

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDate(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
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

/** Strip all whitespace from a phone number string before persisting. */
function toPhone(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  return text.replace(/\s+/g, '') || null;
}

function toSocialMediaEntries(value: unknown): SocialMediaInput[] {
  if (!Array.isArray(value)) return [];
  const parsed: SocialMediaInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as { platform?: unknown; url?: unknown };
    const platform = toText(raw.platform);
    const url = toText(raw.url);
    if (!platform && !url) continue;
    parsed.push({ platform, url });
  }
  return parsed;
}

function toDocumentEntries(value: unknown): DocumentInput[] {
  if (!Array.isArray(value)) return [];
  const parsed: DocumentInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as { document_type?: unknown; document_name?: unknown; document_url?: unknown };
    const documentType = toText(raw.document_type);
    if (!documentType) continue;
    parsed.push({
      document_type: documentType,
      document_name: toText(raw.document_name),
      document_url: toText(raw.document_url),
    });
  }
  return parsed;
}

function buildManualAssociateId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `MAN-ASSOC-${ts}-${rand}`;
}

function buildUtcDate(year: number, monthIndex: number, dayOfMonth: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const safeDay = Math.max(1, Math.min(dayOfMonth, lastDayOfMonth));
  return new Date(Date.UTC(year, monthIndex, safeDay));
}

function computeActiveCapCycle(capDateRaw: string | null): { start: string; end: string } | null {
  if (!capDateRaw) {
    return null;
  }

  const capDateValue = new Date(capDateRaw);
  if (Number.isNaN(capDateValue.getTime())) {
    return null;
  }

  const monthIndex = capDateValue.getUTCMonth();
  const dayOfMonth = capDateValue.getUTCDate();
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const thisYearReset = buildUtcDate(todayUtc.getUTCFullYear(), monthIndex, dayOfMonth);

  const periodStart = todayUtc >= thisYearReset
    ? thisYearReset
    : buildUtcDate(todayUtc.getUTCFullYear() - 1, monthIndex, dayOfMonth);
  const periodEnd = addDays(buildUtcDate(periodStart.getUTCFullYear() + 1, monthIndex, dayOfMonth), -1);

  return {
    start: toIsoDate(periodStart),
    end: toIsoDate(periodEnd),
  };
}

// ─── Property24 Agent Sync Helpers ────────────────────────────────────────────

function buildP24AuthHeaders(apiKey: string, userGroupId: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(apiKey, 'utf8').toString('base64')}`,
  };
  if (userGroupId) headers['P24-UserGroupId'] = userGroupId;
  return headers;
}

async function resolveP24AgencyIdForMC(
  pgPool: import('pg').Pool,
  sourceMarketCenterId: string | null,
): Promise<number | null> {
  if (!sourceMarketCenterId) return null;
  try {
    const r = await pgPool.query<{ market_center_property24_id: string | null }>(
      `SELECT market_center_property24_id FROM migration.core_market_centers
       WHERE source_market_center_id = $1 LIMIT 1`,
      [sourceMarketCenterId],
    );
    const raw = r.rows[0]?.market_center_property24_id;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

interface P24AgentFields {
  firstName: string | null;
  lastName: string | null;
  kwsaEmail: string | null;
  mobileNumber: string | null;
  officeNumber: string | null;
  nationalId: string | null;
  ffcNumber: string | null;
  sourceAssociateId: string | null;
  sourceMarketCenterId: string | null;
  kwuid: string | null;
  jobTitles: string[];
  statusName: string | null;
}

function buildP24AgentBody(
  fields: P24AgentFields,
  agencyId: number | null,
  p24Status: 'Active' | 'Inactive',
): Record<string, unknown> {
  const mc = fields.sourceMarketCenterId ?? '';
  const uid = fields.kwuid ?? fields.sourceAssociateId ?? '';
  return {
    firstname: fields.firstName ?? '',
    lastname: fields.lastName ?? '',
    emailAddress: fields.kwsaEmail ?? '',
    mobileNumber: (fields.mobileNumber ?? '').replace(/[()]/g, ''),
    workNumber: (fields.officeNumber ?? '').replace(/[()]/g, ''),
    agencyId: agencyId ?? 0,
    sourceReference: `KW_${mc}_${uid}`.replace(/_+$/, ''),
    fidelityFundCertificationNumber: fields.ffcNumber ?? '',
    idNumber: fields.nationalId ?? '',
    jobTitle: fields.jobTitles.join(', '),
    published: true,
    receiveStatsMail: true,
    status: p24Status,
  };
}

async function loadJobTitlesForAssociate(pgPool: import('pg').Pool, associateId: number): Promise<string[]> {
  try {
    const r = await pgPool.query<{ job_title: string }>(
      `SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1 ORDER BY id ASC`,
      [associateId],
    );
    return r.rows.map((row) => row.job_title);
  } catch {
    return [];
  }
}

/** Register a new agent on Property24. Returns the numeric P24 agent ID on success, or null. */
async function callP24CreateAgent(
  fields: P24AgentFields,
  agencyId: number | null,
  apiBase: string,
  apiKey: string,
  userGroupId: string | null | undefined,
): Promise<number | null> {
  try {
    const body = buildP24AgentBody(fields, agencyId, 'Active');
    const resp = await fetch(`${apiBase.replace(/\/$/, '')}/agents`, {
      method: 'POST',
      headers: buildP24AuthHeaders(apiKey, userGroupId),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(`[P24] Create agent HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return null;
    }
    const text = await resp.text();
    // P24 returns the new agent ID as a plain integer in the response body
    const parsed = Number(text.trim().replace(/[^0-9]/g, ''));
    return parsed > 0 ? parsed : null;
  } catch (err) {
    console.warn('[P24] Create agent error:', err);
    return null;
  }
}

/** Update an existing agent on Property24 (MC transfer, status change, profile update). */
async function callP24UpdateAgent(
  p24AgentId: number,
  fields: P24AgentFields,
  agencyId: number | null,
  p24Status: 'Active' | 'Inactive',
  apiBase: string,
  apiKey: string,
  userGroupId: string | null | undefined,
): Promise<boolean> {
  try {
    const body = buildP24AgentBody(fields, agencyId, p24Status);
    const resp = await fetch(`${apiBase.replace(/\/$/, '')}/agents/${p24AgentId}`, {
      method: 'PUT',
      headers: buildP24AuthHeaders(apiKey, userGroupId),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(`[P24] Update agent ${p24AgentId} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    return resp.ok;
  } catch (err) {
    console.warn('[P24] Update agent error:', err);
    return false;
  }
}

/**
 * Load the P24AgentFields for an associate directly from the DB.
 * sourceMarketCenterId can be overridden (e.g., after a transfer).
 */
async function loadP24AgentFields(
  pgPool: import('pg').Pool,
  associateId: number,
  sourceMarketCenterIdOverride?: string | null,
): Promise<P24AgentFields | null> {
  try {
    const r = await pgPool.query<{
      first_name: string | null; last_name: string | null; kwsa_email: string | null;
      mobile_number: string | null; office_number: string | null; national_id: string | null;
      ffc_number: string | null; source_associate_id: string | null;
      source_market_center_id: string | null; kwuid: string | null; status_name: string | null;
    }>(
      `SELECT first_name, last_name, kwsa_email, mobile_number, office_number, national_id,
              ffc_number, source_associate_id, source_market_center_id, kwuid, status_name
       FROM migration.core_associates WHERE id = $1 LIMIT 1`,
      [associateId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const jobTitles = await loadJobTitlesForAssociate(pgPool, associateId);
    return {
      firstName: row.first_name,
      lastName: row.last_name,
      kwsaEmail: row.kwsa_email,
      mobileNumber: row.mobile_number,
      officeNumber: row.office_number,
      nationalId: row.national_id,
      ffcNumber: row.ffc_number,
      sourceAssociateId: row.source_associate_id,
      sourceMarketCenterId: sourceMarketCenterIdOverride !== undefined
        ? sourceMarketCenterIdOverride
        : row.source_market_center_id,
      kwuid: row.kwuid,
      jobTitles,
      statusName: row.status_name,
    };
  } catch {
    return null;
  }
}

/**
 * Send a withdraw to P24 for every active P24-linked listing where the associate is primary agent.
 * Updates property24_sync_status on each listing. Non-fatal — errors are logged.
 */
async function withdrawP24ListingsForAgent(
  pgPool: import('pg').Pool,
  associateId: number,
  apiBase: string,
  apiKey: string,
  userGroupId: string | null | undefined,
  defaultAgencyId: string | null | undefined,
): Promise<void> {
  let rows: Array<{
    id: string; listing_number: string | null; property24_ref1: string | null;
    sale_or_rent: string | null; market_center_property24_id: string | null;
  }>;
  try {
    const r = await pgPool.query(
      `SELECT cl.id::text, cl.listing_number, cl.property24_ref1, cl.sale_or_rent,
              mc.market_center_property24_id
       FROM migration.listing_agents la
       INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
       LEFT JOIN migration.core_market_centers mc
         ON mc.source_market_center_id = cl.source_market_center_id
       WHERE la.associate_id = $1
         AND la.is_primary = true
         AND cl.feed_to_property24 = true
         AND NULLIF(TRIM(COALESCE(cl.property24_ref1, '')), '') IS NOT NULL
         AND LOWER(TRIM(COALESCE(cl.listing_status_tag, cl.status_name, '')))
               NOT IN ('withdrawn', 'inactive', 'archived')`,
      [associateId],
    );
    rows = r.rows as typeof rows;
  } catch (err) {
    console.warn('[P24] Withdraw listings query error:', err);
    return;
  }

  const base = apiBase.replace(/\/$/, '');
  const authHeaders = buildP24AuthHeaders(apiKey, userGroupId);

  for (const row of rows) {
    const p24Ref = row.property24_ref1;
    if (!p24Ref) continue;
    const agencyId = Number(row.market_center_property24_id ?? defaultAgencyId ?? 0);
    const listingType = (row.sale_or_rent ?? '').toLowerCase().includes('rent') ? 'Rental' : 'ResidentialSale';
    const withdrawPayload = {
      agencyId,
      listingNumber: Number(p24Ref),
      listingType,
      status: 'Withdrawn',
    };
    try {
      const resp = await fetch(`${base}/listings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(withdrawPayload),
      });
      const syncMsg = resp.ok
        ? `Withdrawn by agent deactivation ${new Date().toISOString().slice(0, 10)}`
        : `Withdraw failed HTTP ${resp.status}`;
      await pgPool.query(
        `UPDATE migration.core_listings SET property24_sync_status = $1, updated_at = NOW() WHERE id = $2`,
        [syncMsg, row.id],
      );
      if (!resp.ok) {
        console.warn(`[P24] Withdraw listing ${p24Ref} HTTP ${resp.status}`);
      }
    } catch (err) {
      console.warn(`[P24] Withdraw listing ${p24Ref} error:`, err);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────

const HOME_TRANSACTION_STATUSES = ['Start', 'Working', 'Submitted', 'Pending', 'Registered'] as const;

async function saveCollections(client: PoolClient, associateId: number, body: Record<string, unknown>): Promise<void> {
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
    await client.query(
      `INSERT INTO migration.associate_social_media (associate_id, platform, url, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [associateId, socialMedia[i].platform, socialMedia[i].url, i]
    );
  }

  for (const role of roles) {
    await client.query(`INSERT INTO migration.associate_roles (associate_id, role_name) VALUES ($1, $2)`, [associateId, role]);
  }

  for (const title of jobTitles) {
    await client.query(`INSERT INTO migration.associate_job_titles (associate_id, job_title) VALUES ($1, $2)`, [associateId, title]);
  }

  for (const community of serviceCommunities) {
    await client.query(
      `INSERT INTO migration.associate_service_communities (associate_id, community_name) VALUES ($1, $2)`,
      [associateId, community]
    );
  }

  for (const sourceMarketCenterId of adminMarketCenters) {
    await client.query(
      `INSERT INTO migration.associate_admin_market_centers (associate_id, source_market_center_id)
       VALUES ($1, $2)`,
      [associateId, sourceMarketCenterId]
    );
  }

  for (const sourceTeamId of adminTeams) {
    await client.query(
      `INSERT INTO migration.associate_admin_teams (associate_id, source_team_id)
       VALUES ($1, $2)`,
      [associateId, sourceTeamId]
    );
  }

  for (const document of documents) {
    await client.query(
      `INSERT INTO migration.associate_documents (associate_id, document_type, document_name, document_url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [associateId, document.document_type, document.document_name, document.document_url, 'console-user']
    );
  }

  for (const note of commissionNotes) {
    await client.query(
      `INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'commission', $2, $3)`,
      [associateId, note, 'console-user']
    );
  }

  for (const note of dateNotes) {
    await client.query(
      `INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'dates', $2, $3)`,
      [associateId, note, 'console-user']
    );
  }

  for (const note of documentNotes) {
    await client.query(
      `INSERT INTO migration.associate_notes (associate_id, note_type, note_text, created_by)
       VALUES ($1, 'documents', $2, $3)`,
      [associateId, note, 'console-user']
    );
  }
}

router.get('/options', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const statusInput = String(req.query.status ?? '').trim().toLowerCase();

  try {
    const result = await pool.query<{
      id: string;
      source_associate_id: string;
      full_name: string | null;
      market_center_id: string | null;
      source_market_center_id: string | null;
      market_center_name: string | null;
    }>(
      `
      SELECT
        a.id::text AS id,
        a.source_associate_id,
        a.full_name,
        a.market_center_id::text AS market_center_id,
        a.source_market_center_id,
        mc.name AS market_center_name
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      ${statusInput === 'active' ? "WHERE (LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active' OR TRIM(COALESCE(a.status_name, '')) = '1')" : ''}
      ORDER BY a.full_name ASC NULLS LAST, a.source_associate_id ASC
      `
    );

    return res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        source_associate_id: row.source_associate_id,
        full_name: row.full_name,
        market_center_id: row.market_center_id,
        source_market_center_id: row.source_market_center_id,
        market_center_name: row.market_center_name,
      })),
    });
  } catch (error) {
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

  try {
    const associateResult = await pool.query<{
      id: string;
      source_associate_id: string;
      full_name: string | null;
      status_name: string | null;
      kwsa_email: string | null;
      private_email: string | null;
      email: string | null;
      source_market_center_id: string | null;
      source_team_id: string | null;
      cap_date: string | null;
      total_cap_amount: string | null;
    }>(
      `
      SELECT
        a.id::text,
        a.source_associate_id,
        a.full_name,
        a.status_name,
        a.kwsa_email,
        a.private_email,
        a.email,
        a.source_market_center_id,
        a.source_team_id,
        a.cap_date::text,
        a.total_cap_amount::text
      FROM migration.core_associates a
      WHERE LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(a.private_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(a.email, ''))) = $1
      ORDER BY
        CASE
          WHEN LOWER(TRIM(COALESCE(a.kwsa_email, ''))) = $1 THEN 0
          WHEN LOWER(TRIM(COALESCE(a.private_email, ''))) = $1 THEN 1
          ELSE 2
        END,
        a.updated_at DESC,
        a.id DESC
      LIMIT 1
      `,
      [userEmail]
    );

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
        transactions_by_status: statusDefaults,
      });
    }

    const associateId = Number(associate.id);

    const homeSchemaResult = await pool.query<{
      has_listing_agents: boolean;
      has_tac_table: boolean;
      has_tac_cap_cycle_start_date: boolean;
      has_tac_cap_cycle_end_date: boolean;
      has_tac_cap_amount: boolean;
      has_tac_cap_remaining: boolean;
      has_tac_gci_after_fees_excl_vat: boolean;
      has_tac_effective_reporting_date: boolean;
    }>(
      `
      SELECT
        to_regclass('migration.listing_agents') IS NOT NULL AS has_listing_agents,
        to_regclass('migration.transaction_agent_calculations') IS NOT NULL AS has_tac_table,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'cap_cycle_start_date'
        ) AS has_tac_cap_cycle_start_date,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'cap_cycle_end_date'
        ) AS has_tac_cap_cycle_end_date,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'cap_amount'
        ) AS has_tac_cap_amount,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'cap_remaining'
        ) AS has_tac_cap_remaining,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'gci_after_fees_excl_vat'
        ) AS has_tac_gci_after_fees_excl_vat,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'migration'
            AND table_name = 'transaction_agent_calculations'
            AND column_name = 'effective_reporting_date'
        ) AS has_tac_effective_reporting_date
      `
    );

    const homeSchema = homeSchemaResult.rows[0] ?? {
      has_listing_agents: false,
      has_tac_table: false,
      has_tac_cap_cycle_start_date: false,
      has_tac_cap_cycle_end_date: false,
      has_tac_cap_amount: false,
      has_tac_cap_remaining: false,
      has_tac_gci_after_fees_excl_vat: false,
      has_tac_effective_reporting_date: false,
    };

    const activeCapCycle = computeActiveCapCycle(associate.cap_date);
    const totalCapAmount = Math.max(Number(associate.total_cap_amount ?? 0) || 0, 0);

    const canUseTacGci = homeSchema.has_tac_table && homeSchema.has_tac_gci_after_fees_excl_vat;

    const [capAchievedResult, listingCountResult, listingsResult, txStatusResult] = await Promise.all([
      activeCapCycle && homeSchema.has_tac_table && homeSchema.has_tac_effective_reporting_date
        ? pool.query<{
            cap_achieved: string;
          }>(
            `
            SELECT
              COALESCE(SUM(tac.market_center_dollar), 0)::text AS cap_achieved
            FROM migration.transaction_agent_calculations tac
            WHERE tac.associate_id = $1
              AND tac.is_registered = true
              AND tac.effective_reporting_date >= $2::date
              AND tac.effective_reporting_date <= $3::date
              AND tac.market_center_dollar IS NOT NULL
            `,
            [associateId, activeCapCycle.start, activeCapCycle.end]
          )
        : Promise.resolve({ rows: [{ cap_achieved: '0' }] }),
      homeSchema.has_listing_agents
        ? pool.query<{ total: string }>(
            `
            SELECT COUNT(DISTINCT la.listing_id)::text AS total
            FROM migration.listing_agents la
            INNER JOIN migration.core_listings cl ON cl.id = la.listing_id
            WHERE la.associate_id = $1
              AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
            `,
            [associateId]
          )
        : Promise.resolve({ rows: [{ total: '0' }] }),
      homeSchema.has_listing_agents
        ? pool.query<{
            id: string;
            source_listing_id: string | null;
            listing_number: string | null;
            status_name: string | null;
            listing_status_tag: string | null;
            address_line: string | null;
            suburb: string | null;
            city: string | null;
            price: string | null;
          }>(
            `
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
            `,
            [associateId]
          )
        : Promise.resolve({ rows: [] }),
      pool.query<{
        status_key: string;
        total_transactions: string;
        total_gci: string;
      }>(
        canUseTacGci
          ? `
            SELECT
              LOWER(TRIM(COALESCE(ct.transaction_status, ''))) AS status_key,
              COUNT(DISTINCT ct.id)::text AS total_transactions,
              COALESCE(SUM(COALESCE(tac.gci_after_fees_excl_vat, ct.total_gci, 0)), 0)::text AS total_gci
            FROM migration.transaction_agents ta
            INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
            LEFT JOIN migration.transaction_agent_calculations tac ON tac.transaction_agent_id = ta.id
            WHERE ta.associate_id = $1
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) IN ('start', 'working', 'submitted', 'pending', 'registered')
            GROUP BY LOWER(TRIM(COALESCE(ct.transaction_status, '')))
            `
          : `
            SELECT
              LOWER(TRIM(COALESCE(ct.transaction_status, ''))) AS status_key,
              COUNT(DISTINCT ct.id)::text AS total_transactions,
              COALESCE(SUM(COALESCE(ct.total_gci, 0)), 0)::text AS total_gci
            FROM migration.transaction_agents ta
            INNER JOIN migration.core_transactions ct ON ct.id = ta.transaction_id
            WHERE ta.associate_id = $1
              AND LOWER(TRIM(COALESCE(ct.transaction_status, ''))) IN ('start', 'working', 'submitted', 'pending', 'registered')
            GROUP BY LOWER(TRIM(COALESCE(ct.transaction_status, '')))
            `,
        [associateId]
      ),
    ]);

    const capAchieved = Math.max(Number(capAchievedResult.rows[0]?.cap_achieved ?? 0) || 0, 0);
    const capRemaining = totalCapAmount > 0 ? Math.max(totalCapAmount - capAchieved, 0) : 0;
    const progressPct = totalCapAmount > 0 ? Math.min((capAchieved / totalCapAmount) * 100, 100) : 0;

    const statusMap = new Map(
      statusDefaults.map((entry) => [entry.status.toLowerCase(), entry] as const)
    );
    for (const row of txStatusResult.rows) {
      const current = statusMap.get(row.status_key);
      if (!current) continue;
      current.total_transactions = Number(row.total_transactions ?? 0);
      current.total_gci = Number(row.total_gci ?? 0);
    }

    return res.json({
      generated_at: new Date().toISOString(),
      email: userEmail,
      associate,
      cap: {
        period_start_date: activeCapCycle?.start ?? null,
        period_end_date: activeCapCycle?.end ?? null,
        total_cap_amount: totalCapAmount,
        cap_achieved: capAchieved,
        cap_remaining: capRemaining,
        progress_pct: Number(progressPct.toFixed(2)),
      },
      active_listings: {
        total: Number(listingCountResult.rows[0]?.total ?? 0),
        items: listingsResult.rows,
      },
      transactions_by_status: HOME_TRANSACTION_STATUSES.map((status) => statusMap.get(status.toLowerCase())!),
    });
  } catch (error) {
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

  try {
    const base = await pool.query(
      `
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
        COALESCE(a.agent_entegral_portals, ARRAY[]::TEXT[]) AS agent_entegral_portals,
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
        a.cap_date::text,
        COALESCE(mc.entegral_portals, ARRAY[]::TEXT[]) AS mc_entegral_portals
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = a.source_market_center_id
      WHERE a.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (base.rowCount === 0) {
      return res.status(404).json({ error: 'Associate not found.' });
    }

    const [socialMedia, roles, jobTitles, serviceCommunities, adminMarketCenters, adminTeams, documents, notes] = await Promise.all([
      pool.query<{ platform: string | null; url: string | null }>(
        `SELECT platform, url FROM migration.associate_social_media WHERE associate_id = $1 ORDER BY sort_order ASC, id ASC`,
        [id]
      ),
      pool.query<{ role_name: string }>(`SELECT role_name FROM migration.associate_roles WHERE associate_id = $1 ORDER BY id ASC`, [id]),
      pool.query<{ job_title: string }>(`SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1 ORDER BY id ASC`, [id]),
      pool.query<{ community_name: string }>(
        `SELECT community_name FROM migration.associate_service_communities WHERE associate_id = $1 ORDER BY id ASC`,
        [id]
      ),
      pool.query<{ source_market_center_id: string }>(
        `SELECT source_market_center_id FROM migration.associate_admin_market_centers WHERE associate_id = $1 ORDER BY id ASC`,
        [id]
      ),
      pool.query<{ source_team_id: string }>(
        `SELECT source_team_id FROM migration.associate_admin_teams WHERE associate_id = $1 ORDER BY id ASC`,
        [id]
      ),
      pool.query<{ document_type: string; document_name: string | null; document_url: string | null; uploaded_by: string | null; uploaded_at: string }>(
        `
        SELECT document_type, document_name, document_url, uploaded_by, uploaded_at::text
        FROM migration.associate_documents
        WHERE associate_id = $1
        ORDER BY uploaded_at DESC, id DESC
        `,
        [id]
      ),
      pool.query<{ note_type: string; note_text: string; created_by: string | null; created_at: string }>(
        `
        SELECT note_type, note_text, created_by, created_at::text
        FROM migration.associate_notes
        WHERE associate_id = $1
        ORDER BY created_at DESC, id DESC
        `,
        [id]
      ),
    ]);

    const payload = base.rows[0] as Record<string, unknown>;
    const commissionNotes = notes.rows.filter((n) => n.note_type === 'commission');
    const dateNotes = notes.rows.filter((n) => n.note_type === 'dates');
    const documentNotes = notes.rows.filter((n) => n.note_type === 'documents');

    // Determine whether the requesting user has admin-level visibility over this associate.
    // Admin access means: GLOBAL scope, or MARKET_CENTRE scope for the associate's own MC,
    // or the user is viewing their own record (OWN scope + matching id).
    const perms = req.permissions!;
    const targetMcId = (payload.source_market_center_id as string | null) ?? null;
    const isOwnRecord = (payload.id as string) === perms.associateDbId;
    const hasAdminView =
      perms.scope === 'GLOBAL' ||
      (perms.scope === 'MARKET_CENTRE' && targetMcId === perms.marketCenterId) ||
      isOwnRecord;

    // Fields visible only to users with admin-level access for this associate
    const sensitiveFields: Record<string, unknown> = hasAdminView
      ? {
          national_id: payload.national_id,
          private_email: payload.private_email,
          growth_share_sponsor: payload.growth_share_sponsor,
          temporary_growth_share_sponsor: payload.temporary_growth_share_sponsor,
          proposed_growth_share_sponsor: payload.proposed_growth_share_sponsor,
          vested: payload.vested,
          vesting_period_start_date: payload.vesting_period_start_date,
          listing_approval_required: payload.listing_approval_required,
          exclude_from_individual_reports: payload.exclude_from_individual_reports,
          cap: payload.cap,
          manual_cap: payload.manual_cap,
          agent_split: payload.agent_split,
          projected_cos: payload.projected_cos,
          projected_cap: payload.projected_cap,
          start_date: payload.start_date,
          end_date: payload.end_date,
          anniversary_date: payload.anniversary_date,
          cap_date: payload.cap_date,
          documents: documents.rows,
          commission_notes: commissionNotes,
          date_notes: dateNotes,
          document_notes: documentNotes,
        }
      : {
          national_id: null,
          private_email: null,
          growth_share_sponsor: null,
          temporary_growth_share_sponsor: null,
          proposed_growth_share_sponsor: null,
          vested: null,
          vesting_period_start_date: null,
          listing_approval_required: null,
          exclude_from_individual_reports: null,
          cap: null,
          manual_cap: null,
          agent_split: null,
          projected_cos: null,
          projected_cap: null,
          start_date: null,
          end_date: null,
          anniversary_date: null,
          cap_date: null,
          documents: [],
          commission_notes: [],
          date_notes: [],
          document_notes: [],
        };

    return res.json({
      ...payload,
      ...sensitiveFields,
      // canEdit: lets the frontend know whether to show the edit form
      canEdit: hasAdminView || isOwnRecord,
      social_media: socialMedia.rows,
      roles: roles.rows.map((row) => row.role_name),
      job_titles: jobTitles.rows.map((row) => row.job_title),
      service_communities: serviceCommunities.rows.map((row) => row.community_name),
      admin_market_centers: adminMarketCenters.rows.map((row) => row.source_market_center_id),
      admin_teams: adminTeams.rows.map((row) => row.source_team_id),
    });
  } catch (error) {
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
    const exists = await pool.query<{ exists: string | null }>(`SELECT to_regclass('migration.core_associates') AS exists`);

    if (!exists.rows[0]?.exists) {
      return res.json({ total: 0, limit, offset, items: [] });
    }

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (searchInput.length > 0) {
      params.push(`%${searchInput}%`);
      const searchParam = `$${params.length}`;
      whereClauses.push(
        `(a.full_name ILIKE ${searchParam} OR a.first_name ILIKE ${searchParam} OR a.last_name ILIKE ${searchParam} OR a.email ILIKE ${searchParam} OR a.kwuid ILIKE ${searchParam} OR a.source_associate_id ILIKE ${searchParam} OR mc.name ILIKE ${searchParam})`
      );
    }

    if (statusInput === 'active') {
      whereClauses.push(`(LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active' OR TRIM(COALESCE(a.status_name, '')) = '1')`);
    } else if (statusInput === 'inactive') {
      whereClauses.push(`(LOWER(TRIM(COALESCE(a.status_name, ''))) = 'inactive' OR TRIM(COALESCE(a.status_name, '')) = '2')`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalResult = await pool.query<{ total: string }>(
      `
      SELECT COUNT(*)::text AS total
      FROM migration.core_associates a
      LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
      ${whereSql}
      `,
      params
    );

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataResult = await pool.query<{
      id: string;
      source_associate_id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      status_name: string | null;
      kwuid: string | null;
      source_market_center_id: string | null;
      source_team_id: string | null;
      market_center_name: string | null;
      market_center_logo_url: string | null;
      active_listing_count: number;
      registered_transaction_count: number;
      image_url: string | null;
      mobile_number: string | null;
      updated_at: string;
    }>(
      `
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
        a.source_market_center_id,
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

router.post('/', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  // Only Regional Admin or Office Admin may create new associates
  const perms = req.permissions!;
  if (perms.scope === 'OWN') {
    return res.status(403).json({ error: 'Permission denied: only admins may create new associates' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const firstName = toText(body.first_name);
  const lastName = toText(body.last_name);
  const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fullName = toText(body.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null);
  const sourceAssociateId = toText(body.source_associate_id) ?? buildManualAssociateId();
  const sourceMarketCenterId = toText(body.source_market_center_id);
  const sourceTeamId = toText(body.source_team_id);

  // MARKET_CENTRE scope: Office Admin may only create associates in their own MC
  if (perms.scope === 'MARKET_CENTRE' && sourceMarketCenterId && sourceMarketCenterId !== perms.marketCenterId) {
    return res.status(403).json({ error: 'Permission denied: you may only create associates in your assigned market centre' });
  }

  if (!fullName) {
    return res.status(400).json({ error: 'full_name (or first_name/last_name) is required.' });
  }

  const nationalId = toText(body.national_id);
  const ffcNumber = toText(body.ffc_number);
  const kwsaEmail = toText(body.kwsa_email) ?? toText(body.email);
  const privateEmail = toText(body.private_email);
  const mobileNumber = toPhone(body.mobile_number);
  const officeNumber = toPhone(body.office_number);
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
      ? await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [sourceMarketCenterId]
        )
      : { rows: [] as Array<{ id: string }> };
    const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

    const insert = await client.query<{ id: string }>(
      `
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
        agent_entegral_portals,
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
        $31,$32,$33,$34,$35,$36,$37,$38,$39::date,$40::date,$41::date,$42::date,
        NOW()
      )
      RETURNING id::text
      `,
      [
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
        toTextArray(body.agent_entegral_portals),
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
      ]
    );

    const associateId = Number(insert.rows[0].id);

    await saveCollections(client, associateId, body);
    await recomputeAllTransactionAgentCalculations(client);

    await client.query('COMMIT');

    // P24: auto-register agent when opted in and no P24 ID was provided manually
    let resolvedP24Id = agentProperty24Id;
    if (property24OptIn && !agentProperty24Id && env.property24.baseUrl && env.property24.apiKey && pool) {
      try {
        const jobTitles = await loadJobTitlesForAssociate(pool, associateId);
        const agencyId = await resolveP24AgencyIdForMC(pool, sourceMarketCenterId)
          ?? (env.property24.defaultAgencyId ? Number(env.property24.defaultAgencyId) : null);
        const fields: P24AgentFields = {
          firstName, lastName, kwsaEmail, mobileNumber, officeNumber: toText(body.office_number),
          nationalId, ffcNumber, sourceAssociateId, sourceMarketCenterId, kwuid,
          jobTitles, statusName: toText(body.status_name),
        };
        const p24Id = await callP24CreateAgent(fields, agencyId, env.property24.baseUrl, env.property24.apiKey, env.property24.userGroupId);
        if (p24Id) {
          resolvedP24Id = String(p24Id);
          await pool.query(
            `UPDATE migration.core_associates
             SET agent_property24_id = $1, property24_status = 'Registered', updated_at = NOW()
             WHERE id = $2`,
            [resolvedP24Id, associateId],
          );
          console.info(`[P24] Registered new agent ${String(associateId)} → P24 ID ${p24Id}`);
        } else {
          await pool.query(
            `UPDATE migration.core_associates
             SET property24_status = 'Registration failed - retry via profile', updated_at = NOW()
             WHERE id = $1`,
            [associateId],
          );
        }
      } catch (p24Err) {
        console.warn('[P24] Auto-register on create error:', p24Err);
      }
    }

    return res.status(201).json({ id: insert.rows[0].id, source_associate_id: sourceAssociateId, agent_property24_id: resolvedP24Id });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

router.put('/:id', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid associate id.' });
  }

  // Enforce edit permission: look up the target associate's MC and verify scope
  const perms = req.permissions!;
  if (perms.scope !== 'GLOBAL') {
    const targetAssoc = await pool.query<{ id: string; source_market_center_id: string | null }>(
      `SELECT id::text, source_market_center_id FROM migration.core_associates WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!targetAssoc.rows[0]) {
      return res.status(404).json({ error: 'Associate not found.' });
    }
    const targetMcId = targetAssoc.rows[0].source_market_center_id;
    const isOwnRecord = targetAssoc.rows[0].id === perms.associateDbId;

    if (perms.scope === 'OWN') {
      if (!isOwnRecord) {
        return res.status(403).json({ error: 'Permission denied: you may only edit your own profile' });
      }
    } else if (perms.scope === 'MARKET_CENTRE') {
      if (targetMcId !== perms.marketCenterId && !isOwnRecord) {
        return res.status(403).json({ error: 'Permission denied: associate is not in your market centre' });
      }
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // ── Role / title edit restrictions ─────────────────────────────────────────
  // Agents cannot modify roles, job titles, or admin market centers at all.
  // Office Admins can modify job titles and admin market centers but may not
  // assign or remove the Regional Admin role.
  // Only Regional Admins may set the Regional Admin role.
  if (perms.scope === 'OWN') {
    // Strip any attempt to change roles, job_titles or admin_market_centers
    delete (body as Record<string, unknown>).roles;
    delete (body as Record<string, unknown>).job_titles;
    delete (body as Record<string, unknown>).admin_market_centers;
  } else if (perms.scope === 'MARKET_CENTRE') {
    const submittedRoles = Array.isArray(body.roles) ? (body.roles as unknown[]).map(String) : null;
    if (submittedRoles !== null) {
      // Fetch the current roles for this associate so we can preserve any
      // Regional Admin role that was already set (they cannot add or remove it).
      const currentRolesResult = await pool.query<{ role_name: string }>(
        `SELECT role_name FROM migration.associate_roles WHERE associate_id = $1`,
        [id]
      );
      const currentRoles = currentRolesResult.rows.map((r) => r.role_name);
      const hasCurrentRegionalAdmin = currentRoles.some((r) => r.trim().toUpperCase().replace(/\s+/g, '_') === 'REGIONAL_ADMIN');
      // Prevent adding Regional Admin
      const filteredRoles = submittedRoles.filter((r) => r.trim().toUpperCase().replace(/\s+/g, '_') !== 'REGIONAL_ADMIN');
      // Re-add Regional Admin if it was already present (preserve it, don't strip it)
      if (hasCurrentRegionalAdmin) filteredRoles.push('Regional Admin');
      (body as Record<string, unknown>).roles = filteredRoles;
    }
  }
  // GLOBAL scope: no restrictions — all fields allowed as submitted.
  // ───────────────────────────────────────────────────────────────────────────

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

    // Load prior state so we can detect MC transfer and deactivation after commit
    const priorStateResult = await client.query<{
      source_market_center_id: string | null;
      status_name: string | null;
      agent_property24_id: string | null;
      property24_opt_in: boolean | null;
    }>(
      `SELECT source_market_center_id, status_name, agent_property24_id, property24_opt_in
       FROM migration.core_associates WHERE id = $1 LIMIT 1`,
      [id],
    );
    const prevMC = priorStateResult.rows[0]?.source_market_center_id ?? null;
    const prevStatusRaw = (priorStateResult.rows[0]?.status_name ?? '').toLowerCase().trim();
    const prevP24Id = toText(priorStateResult.rows[0]?.agent_property24_id);

    const mcLookup = sourceMarketCenterId
      ? await client.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [sourceMarketCenterId]
        )
      : { rows: [] as Array<{ id: string }> };
    const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

    const result = await client.query<{ id: string }>(
      `
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
        agent_entegral_portals = $30,
        private_property_opt_in = $31,
        private_property_status = $32,
        cap = $33,
        manual_cap = $34,
        agent_split = $35,
        projected_cos = $36,
        projected_cap = $37,
        start_date = $38::date,
        end_date = $39::date,
        anniversary_date = $40::date,
        cap_date = $41::date,
        updated_at = NOW()
      WHERE id = $42
      RETURNING id::text
      `,
      [
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
        toPhone(body.mobile_number),
        toText(body.national_id),
        toText(body.ffc_number),
        toText(body.kwsa_email) ?? toText(body.email),
        toText(body.private_email),
        toPhone(body.office_number),
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
        toTextArray(body.agent_entegral_portals),
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
      ]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Associate not found.' });
    }

    await saveCollections(client, id, body);
  await recomputeAllTransactionAgentCalculations(client);
    await client.query('COMMIT');

    // P24 sync — runs after commit, best-effort (errors don't fail the response)
    const p24Base = env.property24.baseUrl;
    const p24Key = env.property24.apiKey;
    if (pool && p24Base && p24Key) {
      try {
        const newP24OptIn = toBool(body.property24_opt_in);
        const newP24IdRaw = toText(body.agent_property24_id) ?? prevP24Id;
        const newP24Id = newP24IdRaw ? Number(newP24IdRaw) : 0;
        const newMC = toText(body.source_market_center_id);
        const newStatusRaw = (toText(body.status_name) ?? '').toLowerCase().trim();

        // Deactivation: was active/working, now inactive/withdrawn
        const activeStatuses = new Set(['active', '1', 'working', '']);
        const inactiveStatuses = new Set(['inactive', 'withdrawn', '0', 'archived', 'terminated']);
        const wasActive = activeStatuses.has(prevStatusRaw);
        const isNowInactive = inactiveStatuses.has(newStatusRaw);
        const isDeactivating = wasActive && isNowInactive;

        if (newP24OptIn && newP24Id > 0) {
          const agencyId = await resolveP24AgencyIdForMC(pool, newMC)
            ?? (env.property24.defaultAgencyId ? Number(env.property24.defaultAgencyId) : null);

          if (isDeactivating) {
            // 1. Mark agent inactive on P24
            const fields = await loadP24AgentFields(pool, id, newMC);
            if (fields) {
              await callP24UpdateAgent(newP24Id, fields, agencyId, 'Inactive', p24Base, p24Key, env.property24.userGroupId);
              console.info(`[P24] Deactivated agent ${id} (P24 ID ${newP24Id})`);
            }
            // 2. Withdraw all active P24-linked listings for this agent
            await withdrawP24ListingsForAgent(pool, id, p24Base, p24Key, env.property24.userGroupId, env.property24.defaultAgencyId);
            await pool.query(
              `UPDATE migration.core_associates SET property24_status = 'Deactivated', updated_at = NOW() WHERE id = $1`,
              [id],
            );
          } else if (newMC !== prevMC) {
            // MC transfer: update agencyId on P24 so listings continue under the new office
            const fields = await loadP24AgentFields(pool, id, newMC);
            if (fields) {
              const ok = await callP24UpdateAgent(newP24Id, fields, agencyId, 'Active', p24Base, p24Key, env.property24.userGroupId);
              const statusMsg = ok ? `Updated - MC transfer to ${newMC ?? '?'}` : `Update failed - MC transfer`;
              await pool.query(
                `UPDATE migration.core_associates SET property24_status = $1, updated_at = NOW() WHERE id = $2`,
                [statusMsg, id],
              );
              console.info(`[P24] MC transfer for agent ${id} → new MC ${newMC ?? '?'} (${ok ? 'ok' : 'failed'})`);
            }
          }
        } else if (newP24OptIn && newP24Id <= 0) {
          // Opted in but no P24 ID yet — auto-register
          const fields = await loadP24AgentFields(pool, id, newMC);
          if (fields) {
            const agencyId = await resolveP24AgencyIdForMC(pool, newMC)
              ?? (env.property24.defaultAgencyId ? Number(env.property24.defaultAgencyId) : null);
            const p24Id = await callP24CreateAgent(fields, agencyId, p24Base, p24Key, env.property24.userGroupId);
            if (p24Id) {
              await pool.query(
                `UPDATE migration.core_associates SET agent_property24_id = $1, property24_status = 'Registered', updated_at = NOW() WHERE id = $2`,
                [String(p24Id), id],
              );
              console.info(`[P24] Registered agent ${id} → P24 ID ${p24Id}`);
            } else {
              await pool.query(
                `UPDATE migration.core_associates SET property24_status = 'Registration failed - retry via profile', updated_at = NOW() WHERE id = $1`,
                [id],
              );
            }
          }
        }
      } catch (p24Err) {
        console.warn('[P24] Agent sync error on update:', p24Err);
      }
    }

    return res.json({ id: result.rows[0].id });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

// Manual P24 registration / re-sync endpoint
router.post('/:id/register-on-property24', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid associate id.' });

  const p24Base = env.property24.baseUrl;
  const p24Key = env.property24.apiKey;
  if (!p24Base || !p24Key) {
    return res.status(503).json({ error: 'Property24 API is not configured. Set PROPERTY24_BASE_URL and PROPERTY24_API_KEY.' });
  }

  try {
    const fields = await loadP24AgentFields(pool, id);
    if (!fields) return res.status(404).json({ error: 'Associate not found.' });

    const existingResult = await pool.query<{ agent_property24_id: string | null; property24_opt_in: boolean | null }>(
      `SELECT agent_property24_id, property24_opt_in FROM migration.core_associates WHERE id = $1 LIMIT 1`,
      [id],
    );
    const existingP24Id = toText(existingResult.rows[0]?.agent_property24_id);
    const agencyId = await resolveP24AgencyIdForMC(pool, fields.sourceMarketCenterId)
      ?? (env.property24.defaultAgencyId ? Number(env.property24.defaultAgencyId) : null);

    if (existingP24Id && Number(existingP24Id) > 0) {
      // Already has a P24 ID — update instead
      const ok = await callP24UpdateAgent(Number(existingP24Id), fields, agencyId, 'Active', p24Base, p24Key, env.property24.userGroupId);
      await pool.query(
        `UPDATE migration.core_associates SET property24_status = $1, updated_at = NOW() WHERE id = $2`,
        [ok ? 'Re-synced' : 'Re-sync failed', id],
      );
      return res.json({ success: ok, agent_property24_id: existingP24Id, action: 'updated' });
    }

    // No P24 ID — register new
    const p24Id = await callP24CreateAgent(fields, agencyId, p24Base, p24Key, env.property24.userGroupId);
    if (p24Id) {
      await pool.query(
        `UPDATE migration.core_associates SET agent_property24_id = $1, property24_opt_in = true,
         property24_status = 'Registered', updated_at = NOW() WHERE id = $2`,
        [String(p24Id), id],
      );
      return res.json({ success: true, agent_property24_id: String(p24Id), action: 'created' });
    }
    await pool.query(
      `UPDATE migration.core_associates SET property24_status = 'Registration failed', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return res.status(422).json({ success: false, error: 'Property24 agent registration failed. Check agent data and P24 credentials.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/upload-image', async (req, res, next) => {
  const isGcs = !storageConfig.localUploadsEnabled;

  try {
    await runUploadMiddleware(req, res, uploadImage.single('image'));
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
    return res.status(400).json({ error: 'Invalid associate id.' });
  }

  try {
    let imageUrl: string;

    if (isGcs) {
      const { publicUrl } = await uploadToGcs(
        req.file.buffer,
        req.file.originalname,
        'image',
        req.file.mimetype
      );
      imageUrl = publicUrl;
    } else {
      imageUrl = `/uploads/images/${req.file.filename}`;
    }

    // Update the image_url in the database
    const result = await pool.query(
      `UPDATE migration.core_associates SET image_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id::text`,
      [imageUrl, id]
    );

    if (result.rowCount === 0) {
      if (!isGcs && req.file.path) {
        await fs.unlink(req.file.path).catch(() => undefined);
      }
      return res.status(404).json({ error: 'Associate not found.' });
    }

    return res.json({ image_url: imageUrl });
  } catch (error) {
    if (!isGcs && req.file.path) {
      await fs.unlink(req.file.path).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/upload-document', async (req, res, next) => {
  const isGcs = !storageConfig.localUploadsEnabled;

  try {
    await runUploadMiddleware(req, res, uploadDocument.single('document'));
  } catch (error) {
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
    let documentUrl: string;

    if (isGcs) {
      const { publicUrl } = await uploadToGcs(
        req.file.buffer,
        req.file.originalname,
        'doc',
        req.file.mimetype
      );
      documentUrl = publicUrl;
    } else {
      documentUrl = `/uploads/documents/${req.file.filename}`;
    }

    // Insert document record
    const result = await pool.query(
      `INSERT INTO migration.associate_documents (associate_id, document_type, document_name, document_url, uploaded_by)
       VALUES ($1, $2, $3, $4, 'console-upload')
       RETURNING id::text`,
      [id, documentType, req.file.originalname, documentUrl]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Failed to save document record.' });
    }

    return res.json({ document_url: documentUrl });
  } catch (error) {
    if (!isGcs && req.file.path) {
      await fs.unlink(req.file.path).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/sync-to-entegral  — push agent to Entegral (create or update)
// ---------------------------------------------------------------------------

router.post('/:id/sync-to-entegral', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid associate id.' });

  const entegralBaseUrl = env.entegral.baseUrl;
  const entegralGlobalAuth = env.entegral.globalAuth;

  if (!entegralBaseUrl || !entegralGlobalAuth) {
    return res.status(501).json({
      success: false,
      error: 'Entegral integration is not configured. Set ENTEGRAL_BASE_URL and ENTEGRAL_GLOBAL_AUTH.',
    });
  }

  const authHeader = `Basic ${Buffer.from(entegralGlobalAuth).toString('base64')}`;
  const entegralUrl = (segment: string) => `${entegralBaseUrl.replace(/\/$/, '')}/${segment}`;

  try {
    // Load agent
    const agentResult = await pool.query(
      `SELECT a.id::text, a.first_name, a.last_name, a.full_name, a.status_name,
              a.kwsa_email, a.mobile_number, a.office_number, a.image_url,
              a.source_associate_id, a.source_market_center_id, a.market_center_id,
              a.agent_entegral_id, a.entegral_opt_in, a.entegral_status,
              a.updated_at::text
       FROM migration.core_associates a WHERE a.id = $1 LIMIT 1`,
      [id]
    );

    if (agentResult.rowCount === 0) {
      return res.status(404).json({ error: 'Associate not found.' });
    }

    const agent = agentResult.rows[0] as Record<string, unknown>;

    // Determine action
    const statusName = (toText(agent.status_name) ?? '').toLowerCase();
    const isDeactivate = req.body?.action === 'delete' ||
      statusName === 'inactive' || statusName === 'terminated';
    const existingEntegralId = toText(agent.agent_entegral_id);
    const action = isDeactivate ? 'delete' : existingEntegralId ? 'update' : 'create';

    // Load market center (for clientOfficeID and portalAgent list)
    const mcLookupId = toText(agent.market_center_id);
    let marketCenter: Record<string, unknown> | undefined;
    let entegralPortals: string[] = [];

    if (mcLookupId) {
      const mcColResult = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'migration' AND table_name = 'core_market_centers'
           AND column_name IN ('source_market_center_id', 'name', 'entegral_portals', 'contact_number', 'contact_email')`
      );
      const mcCols = new Set(mcColResult.rows.map((r) => r.column_name));
      const optSelect = ['entegral_portals', 'contact_number', 'contact_email']
        .map((c) => (mcCols.has(c) ? c : `NULL AS ${c}`))
        .join(', ');

      const mcResult = await pool.query(
        `SELECT id::text, source_market_center_id, name, ${optSelect}
         FROM migration.core_market_centers WHERE id::text = $1 LIMIT 1`,
        [mcLookupId]
      );
      marketCenter = mcResult.rows[0] as Record<string, unknown> | undefined;

      const rawPortals = marketCenter?.entegral_portals;
      if (Array.isArray(rawPortals)) {
        entegralPortals = rawPortals.map(String).filter(Boolean);
      } else if (typeof rawPortals === 'string' && rawPortals) {
        entegralPortals = rawPortals
          .replace(/^\{|\}$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }
    }

    // Load job titles
    const jobTitleResult = await pool.query<{ job_title: string }>(
      `SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1 ORDER BY id ASC`,
      [id]
    );
    const role = jobTitleResult.rows.map((r) => r.job_title).join(', ') || 'Agent';

    const clientAgentID = existingEntegralId ?? toText(agent.source_associate_id) ?? String(id);
    const clientOfficeID = toText(agent.source_market_center_id) ?? toText(marketCenter?.source_market_center_id) ?? '';
    const firstName = toText(agent.first_name) ?? '';
    const lastName = toText(agent.last_name) ?? '';
    const fullName = toText(agent.full_name) ?? `${firstName} ${lastName}`.trim();

    const entegralPayload: Record<string, unknown> = {
      clientAgentID,
      clientOfficeID,
      fullName,
      lastName,
      role,
      cell: toText(agent.mobile_number) ?? '',
      email: toText(agent.kwsa_email) ?? '',
      officeTel: toText(agent.office_number) ?? toText(marketCenter?.contact_number) ?? '',
      officeEmail: toText(marketCenter?.contact_email) ?? '',
      profile: '',
      action,
      photo: toText(agent.image_url) ?? '',
      timeStamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      portalAgent: entegralPortals.map((p) => ({ name: p, id: p })),
    };

    // POST agent to Entegral
    const entegralResponse = await fetch(entegralUrl('agents'), {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(entegralPayload),
      signal: AbortSignal.timeout(30000),
    });

    const rawResponseBody = await entegralResponse.text();
    let parsedResponse: unknown;
    try { parsedResponse = JSON.parse(rawResponseBody); } catch { parsedResponse = rawResponseBody; }

    const success = entegralResponse.ok;
    const newStatus = success
      ? (isDeactivate ? 'Deactivated' : existingEntegralId ? 'Updated' : 'Synced')
      : `Error ${entegralResponse.status}`;

    // Persist new entegral ID if this was a create
    let newEntegralId = existingEntegralId;
    if (success && action === 'create') {
      const body = parsedResponse as Record<string, unknown> | null;
      newEntegralId = (typeof body?.clientAgentID === 'string' ? body.clientAgentID : null) ?? clientAgentID;
    }

    await pool.query(
      `UPDATE migration.core_associates
       SET agent_entegral_id = $1, entegral_status = $2, updated_at = NOW()
       WHERE id = $3`,
      [newEntegralId, newStatus, id]
    );

    return res.status(success ? 200 : 422).json({
      success,
      message: success
        ? `Agent ${action === 'delete' ? 'deactivated on' : action === 'update' ? 'updated on' : 'registered on'} Entegral.`
        : `Entegral responded with status ${entegralResponse.status}`,
      agent_entegral_id: newEntegralId,
      action,
      ...(process.env.NODE_ENV !== 'production' ? { rawResponse: parsedResponse, payload: entegralPayload } : {}),
    });
  } catch (err) {
    console.error('[sync-to-entegral] Error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});

const uploadErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
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
