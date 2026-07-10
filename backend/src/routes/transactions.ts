import { Router, type Request, type Response } from 'express';
import { type Pool } from 'pg';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { scheduleTransactionAgentRecompute } from '../services/transactionRecomputeQueue.js';
import {
  applyCapRefresh,
  canApplyCapRefresh,
  dryRunCapRefresh,
  loadCapRefreshRoleNames,
} from '../services/capRefresh/index.js';
import { env } from '../config/env.js';
import { getOptionalPgPool } from '../config/db.js';
import { resolvePermissions, type UserPermissions } from '../middleware/permissions.js';
import { getTodayInAppTimeZone } from '../utils/timeZone.js';
import { salesOnlyTransactionExclusionSql, transactionAgentCalculationDedupCte } from './reportingSql.js';
import { resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';

const router = Router();
const pool = getOptionalPgPool();
const transactionDocumentsDir = resolveLocalUploadDir('documents');

export function buildStatusChangeDateUpdateClause(opts: {
  isRegionalAdmin: boolean;
  statusChangeDateInput: string | null | undefined;
  transactionStatus: string | null | undefined;
}): { statusChangeDateValue: string | null; statusChangeUpdateSql: string } {
  if (opts.isRegionalAdmin && opts.statusChangeDateInput) {
    return { statusChangeDateValue: opts.statusChangeDateInput, statusChangeUpdateSql: '$55::timestamptz' };
  }
  if (opts.transactionStatus) {
    return {
      statusChangeDateValue: null,
      statusChangeUpdateSql: 'CASE WHEN transaction_status IS DISTINCT FROM $2 THEN NOW() ELSE COALESCE($55::timestamptz, status_change_date) END',
    };
  }
  return { statusChangeDateValue: null, statusChangeUpdateSql: 'COALESCE($55::timestamptz, status_change_date)' };
}

const uploadTransactionDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF, DOC, DOCX, JPEG and PNG files are allowed.'));
  },
});

const ALLOWED_STATUSES = [
  'Start',
  'Working',
  'Submitted',
  'Registered',
  'Accepted',
  'Rejected',
  'Withdrawn',
  'Pending',
] as const;

type ReportingWindowRow = {
  start_date: string;
  end_date: string;
  end_exclusive: string;
  basis: 'registered' | 'allStatuses';
};

function reportingDateSql(alias: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${alias}.transaction_status, ''))) = 'registered'
      THEN COALESCE(${alias}.status_change_date, ${alias}.transaction_date, ${alias}.created_at)
    ELSE COALESCE(${alias}.transaction_date, ${alias}.status_change_date, ${alias}.created_at)
  END`;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeAssociateSplitPct(rawSplit: number): number {
  if (rawSplit <= 0) return 70;
  if (rawSplit <= 1) return rawSplit * 100;
  return Math.max(Math.min(rawSplit, 100), 0);
}

function normalizeTeamSplitPct(rawSplit: number): number {
  if (rawSplit <= 0) return 0;
  if (rawSplit <= 1) return Math.max(Math.min(rawSplit * 100, 100), 0);
  return Math.max(Math.min(rawSplit, 100), 0);
}

function normalizeAgentSplitPct(rawSplit: number, splitSum: number, count: number): number {
  if (rawSplit > 0 && splitSum > 0) {
    return (rawSplit / splitSum) * 100;
  }
  if (count <= 0) return 100;
  return 100 / count;
}

function toDateValue(value: unknown): string | null {
  const t = toText(value);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeTransactionType(value: string | null): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'buyer':
      return 'Buyer';
    case 'seller':
      return 'Seller';
    case 'both':
      return 'Both';
    case 'other':
      return 'Other';
    case 'referral':
      return 'Referral';
    default:
      return value;
  }
}

function inferTransactionTypeFromAgents(agents: unknown[]): string | null {
  const roles = new Set(
    agents
      .map((agent) => toText((agent as Record<string, unknown>)?.agent_role)?.trim().toLowerCase())
      .filter((role): role is string => Boolean(role))
  );

  if (roles.has('both') || (roles.has('buyer') && roles.has('seller'))) return 'Both';
  if (roles.has('buyer')) return 'Buyer';
  if (roles.has('seller')) return 'Seller';
  if (roles.has('referral')) return 'Referral';
  if (roles.has('other')) return 'Other';
  return null;
}

function deriveSaleType(transactionType: string | null, saleType: string | null): string | null {
  if (saleType) return saleType;
  const normalized = (transactionType ?? '').trim().toLowerCase();
  if (['buyer', 'seller', 'both', 'other', 'referral'].includes(normalized)) {
    return 'For Sale';
  }
  return null;
}

function composeDisplayName(firstName: string | null, lastName: string | null): string | null {
  const value = [firstName, lastName].filter(Boolean).join(' ').trim();
  return value.length > 0 ? value : null;
}

type PartyContactPayload = {
  first_name: string | null;
  last_name: string | null;
  contact_number: string | null;
  email_address: string | null;
  company_name: string | null;
};

function splitFullName(value: string | null): { first_name: string | null; last_name: string | null } {
  if (!value) return { first_name: null, last_name: null };
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, last_name: null };
  return {
    first_name: parts[0] ?? null,
    last_name: parts.slice(1).join(' ') || null,
  };
}

function normalizePartyContactInput(value: unknown): PartyContactPayload {
  if (!value || typeof value !== 'object') {
    return { first_name: null, last_name: null, contact_number: null, email_address: null, company_name: null };
  }

  const record = value as Record<string, unknown>;
  return {
    first_name: toText(record.first_name),
    last_name: toText(record.last_name),
    contact_number: toText(record.contact_number) ?? toText(record.phone),
    email_address: toText(record.email_address) ?? toText(record.email),
    company_name: toText(record.company_name),
  };
}

function normalizePartyContactListInput(value: unknown): PartyContactPayload[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePartyContactInput(entry));
  }
  if (value && typeof value === 'object') {
    return [normalizePartyContactInput(value)];
  }
  return [];
}

function buildManualTransactionId(): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `MAN-TX-${ts}-${rand}`;
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveEffectiveScopeMarketCenterId(perms: UserPermissions): string {
  return (perms.homeMcId ?? perms.marketCenterId ?? '').trim();
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseTeamContextToken(activeContextId: string): string | null {
  const normalized = activeContextId.trim().toLowerCase();
  const match = /^(lead_agent|team_admin|team_agent)(?:_(.+))?$/.exec(normalized);
  if (!match) return null;
  const token = (match[2] ?? '').trim();
  return token.length > 0 ? token : null;
}

async function resolveTeamContextSourceId(db: Pool, activeContextId: string, associateDbId: string | null): Promise<string | null> {
  if (!associateDbId) return null;
  const teamToken = parseTeamContextToken(activeContextId);
  if (!teamToken) return null;

  const allowedTeamsResult = await db.query<{ source_team_id: string | null; team_db_id: string | null }>(
    `WITH allowed_source_teams AS (
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
       t.id::text AS team_db_id
     FROM migration.core_teams t
     INNER JOIN allowed_source_teams a ON a.source_team_id = t.source_team_id`,
    [associateDbId]
  );

  const normalizedToken = normalizeKey(teamToken);
  const matched = allowedTeamsResult.rows.find((row) =>
    normalizeKey(row.source_team_id) === normalizedToken || normalizeKey(row.team_db_id) === normalizedToken
  );

  return matched?.source_team_id ?? null;
}

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

async function ensureTransactionAuxTables(db: Pool): Promise<void> {
  await db.query(`
    ALTER TABLE migration.core_transactions
      ADD COLUMN IF NOT EXISTS transaction_category TEXT,
      ADD COLUMN IF NOT EXISTS source_type TEXT,
      ADD COLUMN IF NOT EXISTS source_rental_id BIGINT,
      ADD COLUMN IF NOT EXISTS source_rental_payment_schedule_id BIGINT,
      ADD COLUMN IF NOT EXISTS counts_toward_cap BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS source_market_center_id TEXT,
      ADD COLUMN IF NOT EXISTS market_center_name TEXT,
      ADD COLUMN IF NOT EXISTS source_team_id TEXT,
      ADD COLUMN IF NOT EXISTS team_name TEXT,
      ADD COLUMN IF NOT EXISTS current_source_market_center_id TEXT,
      ADD COLUMN IF NOT EXISTS current_market_center_name TEXT,
      ADD COLUMN IF NOT EXISTS current_source_team_id TEXT,
      ADD COLUMN IF NOT EXISTS current_team_name TEXT,
      ADD COLUMN IF NOT EXISTS listing_office_name TEXT,
      ADD COLUMN IF NOT EXISTS variance_per NUMERIC(18,6),
      ADD COLUMN IF NOT EXISTS contract_gci_excl_vat NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS avg_comms_per NUMERIC(18,6),
      ADD COLUMN IF NOT EXISTS transaction_gci_excl_vat NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS growth_share NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS production_royalties NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS cap_remaining NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS associate_dollar NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS mc_dollar NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS company_dollar NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS team_dollar NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS transfer_attorney TEXT,
      ADD COLUMN IF NOT EXISTS ta_mobile_phone TEXT,
      ADD COLUMN IF NOT EXISTS ta_email TEXT,
      ADD COLUMN IF NOT EXISTS bond_attorney_contact_id TEXT,
      ADD COLUMN IF NOT EXISTS bond_attorney TEXT,
      ADD COLUMN IF NOT EXISTS ba_mobile_phone TEXT,
      ADD COLUMN IF NOT EXISTS ba_email TEXT,
      ADD COLUMN IF NOT EXISTS bond_originator TEXT,
      ADD COLUMN IF NOT EXISTS bond_due_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS bond_amount NUMERIC(18,2),
      ADD COLUMN IF NOT EXISTS transaction_financial_institution_id TEXT,
      ADD COLUMN IF NOT EXISTS transaction_financial_institution TEXT,
      ADD COLUMN IF NOT EXISTS financial_institution_other TEXT,
      ADD COLUMN IF NOT EXISTS transaction_financing_type_id TEXT,
      ADD COLUMN IF NOT EXISTS transaction_financing_type TEXT,
      ADD COLUMN IF NOT EXISTS all_parties_invoiced TEXT,
      ADD COLUMN IF NOT EXISTS party_contact_details JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS manual_financial_override BOOLEAN DEFAULT FALSE;
  `);

  await db.query(`
    ALTER TABLE migration.core_transactions
      ALTER COLUMN variance_per TYPE NUMERIC(18,6),
      ALTER COLUMN avg_comms_per TYPE NUMERIC(18,6);
  `);

  await db.query(`
    UPDATE migration.core_transactions t
       SET party_contact_details = jsonb_build_object(
         'buyer', jsonb_build_object(
           'first_name', NULLIF(TRIM(t.buyer), ''),
           'last_name', NULL,
           'contact_number', NULL,
           'email_address', NULL,
           'company_name', NULL
         ),
         'seller', jsonb_build_object(
           'first_name', NULLIF(TRIM(t.seller), ''),
           'last_name', NULL,
           'contact_number', NULL,
           'email_address', NULL,
           'company_name', NULL
         ),
         'buyer_contacts', jsonb_build_array(
           jsonb_build_object(
             'first_name', NULLIF(TRIM(t.buyer), ''),
             'last_name', NULL,
             'contact_number', NULL,
             'email_address', NULL,
             'company_name', NULL
           )
         ),
         'seller_contacts', jsonb_build_array(
           jsonb_build_object(
             'first_name', NULLIF(TRIM(t.seller), ''),
             'last_name', NULL,
             'contact_number', NULL,
             'email_address', NULL,
             'company_name', NULL
           )
         ),
         'transfer_attorney', jsonb_build_object(
           'first_name', NULLIF(TRIM(t.transfer_attorney), ''),
           'last_name', NULL,
           'contact_number', NULLIF(TRIM(t.ta_mobile_phone), ''),
           'email_address', NULLIF(TRIM(t.ta_email), ''),
           'company_name', NULL
         ),
         'bond_attorney', jsonb_build_object(
           'first_name', NULLIF(TRIM(t.bond_attorney), ''),
           'last_name', NULL,
           'contact_number', NULLIF(TRIM(t.ba_mobile_phone), ''),
           'email_address', NULLIF(TRIM(t.ba_email), ''),
           'company_name', NULL
         ),
         'bond_originator', jsonb_build_object(
           'first_name', NULLIF(TRIM(t.bond_originator), ''),
           'last_name', NULL,
           'contact_number', NULL,
           'email_address', NULL,
           'company_name', NULL
         )
       )
     WHERE t.party_contact_details IS NULL OR t.party_contact_details = '{}'::jsonb;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS migration.transaction_status_history (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      changed_by TEXT,
      changed_by_user_id TEXT,
      changed_by_email TEXT,
      notes TEXT
    )
  `);

  await db.query(`
    ALTER TABLE migration.transaction_status_history
      ADD COLUMN IF NOT EXISTS changed_by_user_id TEXT,
      ADD COLUMN IF NOT EXISTS changed_by_email TEXT
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS migration.transaction_documents (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
      source_document_id TEXT,
      source_transaction_document_type_id TEXT,
      transaction_document_type TEXT,
      file_name TEXT,
      document_url TEXT,
      preview_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS migration.outside_agency_contacts (
      id BIGSERIAL PRIMARY KEY,
      transaction_agent_id BIGINT NOT NULL REFERENCES migration.transaction_agents(id) ON DELETE CASCADE,
      transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      agency_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    INSERT INTO migration.outside_agency_contacts (
      transaction_agent_id,
      transaction_id,
      first_name,
      last_name,
      email,
      phone,
      agency_name
    )
    SELECT
      ta.id,
      ta.transaction_id,
      NULLIF(SPLIT_PART(TRIM(COALESCE(ta.agent_name, ta.source_associate_id, '')), ' ', 1), ''),
      NULLIF(TRIM(REGEXP_REPLACE(TRIM(COALESCE(ta.agent_name, ta.source_associate_id, '')), '^[^ ]+\\s*', '')), ''),
      NULL,
      NULL,
      NULL
    FROM migration.transaction_agents ta
    LEFT JOIN migration.outside_agency_contacts oa ON oa.transaction_agent_id = ta.id
    WHERE oa.id IS NULL
      AND (
        LOWER(TRIM(COALESCE(ta.agent_role, ''))) IN ('outside agency referral', 'outside agent')
        OR COALESCE(ta.outside_agency, false) = true
      )
      AND NULLIF(TRIM(COALESCE(ta.agent_name, ta.source_associate_id, '')), '') IS NOT NULL
  `);
}

async function canAccessTransactionByScope(
  db: Pool,
  transactionId: number,
  perms: UserPermissions,
  teamSourceId: string | null = null
): Promise<boolean> {
  if (perms.scope === 'GLOBAL') return true;

  if (perms.scope === 'OWN') {
    if (teamSourceId) {
      const team = await db.query(
        `SELECT 1
           FROM migration.transaction_agents ta
           INNER JOIN migration.core_associates ca ON ca.id = ta.associate_id
          WHERE ta.transaction_id = $1
            AND ca.source_team_id = $2
          LIMIT 1`,
        [transactionId, teamSourceId]
      );
      return (team.rowCount ?? 0) > 0;
    }

    if (!perms.associateDbId) return false;
    const own = await db.query(
      `SELECT 1
         FROM migration.transaction_agents ta
        WHERE ta.transaction_id = $1
          AND ta.associate_id = $2
        LIMIT 1`,
      [transactionId, perms.associateDbId]
    );
    return (own.rowCount ?? 0) > 0;
  }

  const effectiveScopeMarketCenterId = resolveEffectiveScopeMarketCenterId(perms);
  const mcKey = normalizeKey(effectiveScopeMarketCenterId);
  if (!mcKey) return false;

  const mcLookup = await db.query<{ id: string }>(
    `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
    [effectiveScopeMarketCenterId]
  );
  const mcDbId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

  const matched = await db.query(
    `SELECT 1
       FROM migration.core_transactions ct
      WHERE ct.id = $1
        AND (
          REGEXP_REPLACE(LOWER(TRIM(COALESCE((SELECT mc.source_market_center_id
                                               FROM migration.core_market_centers mc
                                              WHERE mc.id = ct.primary_market_center_id
                                              LIMIT 1), ''))), '[^a-z0-9]+', '', 'g') = $2
          OR ($3::int IS NOT NULL AND ct.primary_market_center_id = $3)
          OR EXISTS (
              SELECT 1
                FROM migration.transaction_agents ta
                LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
               WHERE ta.transaction_id = ct.id
                 AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = $2
          )
        )
      LIMIT 1`,
    [transactionId, mcKey, mcDbId]
  );

  return (matched.rowCount ?? 0) > 0;
}

function buildCapRefreshActor(req: Express.Request, perms: UserPermissions, roleNames: string[]) {
  return {
    associateDbId: perms.associateDbId,
    email: req.user?.email ?? null,
    roleNames,
    isRegionalAdmin: perms.isRegionalAdmin,
    isOfficeAdmin: perms.isOfficeAdmin,
  };
}

function capRefreshDisabledResponse() {
  return {
    error: 'Cap refresh feature is disabled. Enable CAP_REFRESH_ENABLED to use this endpoint.',
    feature_enabled: false,
  };
}

function validateAgentSplits(agents: Array<Record<string, unknown>>): string | null {
  if (agents.length === 0) {
    return null;
  }

  let splitSum = 0;
  for (const agent of agents) {
    const splitValue = toNumber(agent?.split_percentage);
    if (splitValue === null || splitValue < 0 || splitValue > 100) {
      return 'Each agent split_percentage must be between 0 and 100.';
    }
    splitSum += splitValue;
  }

  if (Math.abs(splitSum - 100) > 0.01) {
    return `Total split percentage must equal 100. Current total: ${splitSum.toFixed(2)}.`;
  }

  return null;
}

async function getNextTransactionNumber(db: Pool): Promise<string> {
  const result = await db.query<{ max_number: string | null }>(
    `
    SELECT MAX(CAST(SUBSTRING(transaction_number FROM 3) AS INTEGER))::text AS max_number
    FROM migration.core_transactions
    WHERE transaction_number ~ '^TH[0-9]+$'
    `
  );
  const currentMax = Number(result.rows[0]?.max_number ?? 8999);
  const nextValue = Number.isFinite(currentMax) ? Math.max(currentMax + 1, 9000) : 9000;
  return `TH${nextValue}`;
}

type QueryRunner = Pick<Pool, 'query'>;

function normalizePocketListingToken(...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    const normalized = (candidate ?? '').trim().toUpperCase();
    if (/^KWPL[0-9]+$/.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

async function getNextPocketListingNumber(db: QueryRunner): Promise<string> {
  const result = await db.query<{ max_number: string | null }>(
    `
    WITH maxima AS (
      SELECT MAX(CAST(SUBSTRING(ct.listing_number FROM 5) AS INTEGER)) AS max_num
      FROM migration.core_transactions ct
      WHERE ct.listing_number ~ '^KWPL[0-9]+$'

      UNION ALL

      SELECT MAX(CAST(SUBSTRING(ct.source_listing_id FROM 5) AS INTEGER)) AS max_num
      FROM migration.core_transactions ct
      WHERE ct.source_listing_id ~ '^KWPL[0-9]+$'

      UNION ALL

      SELECT MAX(CAST(SUBSTRING(cl.listing_number FROM 5) AS INTEGER)) AS max_num
      FROM migration.core_listings cl
      WHERE cl.listing_number ~ '^KWPL[0-9]+$'

      UNION ALL

      SELECT MAX(CAST(SUBSTRING(cl.source_listing_id FROM 5) AS INTEGER)) AS max_num
      FROM migration.core_listings cl
      WHERE cl.source_listing_id ~ '^KWPL[0-9]+$'
    )
    SELECT MAX(max_num)::text AS max_number
    FROM maxima
    `
  );

  const currentMax = Number(result.rows[0]?.max_number ?? 1000);
  const nextValue = Number.isFinite(currentMax) ? Math.max(currentMax + 1, 1001) : 1001;
  return `KWPL${nextValue}`;
}

async function pocketListingExistsElsewhere(db: QueryRunner, pocketListingNumber: string, transactionIdToExclude?: number): Promise<boolean> {
  const txCheck = await db.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM migration.core_transactions ct
      WHERE (
        UPPER(TRIM(COALESCE(ct.listing_number, ''))) = $1
        OR UPPER(TRIM(COALESCE(ct.source_listing_id, ''))) = $1
      )
      AND ($2::bigint IS NULL OR ct.id <> $2::bigint)
    ) AS exists
    `,
    [pocketListingNumber, transactionIdToExclude ?? null]
  );

  if (txCheck.rows[0]?.exists) {
    return true;
  }

  const listingCheck = await db.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM migration.core_listings cl
      WHERE UPPER(TRIM(COALESCE(cl.listing_number, ''))) = $1
         OR UPPER(TRIM(COALESCE(cl.source_listing_id, ''))) = $1
    ) AS exists
    `,
    [pocketListingNumber]
  );

  return Boolean(listingCheck.rows[0]?.exists);
}

router.get('/next-number', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }
  try {
    const nextTransactionNumber = await getNextTransactionNumber(pool);
    return res.json({ next_transaction_number: nextTransactionNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

async function handleNextPocketListingNumber(_req: Request, res: Response): Promise<void> {
  if (!pool) {
    res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize generation requests so concurrent users do not receive the same candidate number.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['transactions-pocket-listing-number']);

    const nextPocketListingNumber = await getNextPocketListingNumber(client);
    await client.query('COMMIT');

    res.json({ pocket_listing_number: nextPocketListingNumber });
    return;
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
    return;
  } finally {
    client.release();
  }
}

router.post('/pocket-listing-number/next', resolvePermissions, handleNextPocketListingNumber);
// Backward/forward-compatible alias used as a fallback from frontend when proxies/cache layers miss the canonical path.
router.post('/next-pocket-listing-number', resolvePermissions, handleNextPocketListingNumber);

router.get('/summary', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  try {
    const summaryCategoryFilter = String(req.query.category ?? 'sales').trim().toLowerCase();
    const normalizedSaleTypeSql = `LOWER(TRIM(COALESCE(
      NULLIF(ct.sale_type, ''),
      CASE
        WHEN LOWER(TRIM(COALESCE(ct.transaction_type, ''))) IN ('buyer', 'seller', 'both', 'other', 'referral') THEN 'For Sale'
        ELSE NULLIF(ct.transaction_type, '')
      END,
      ''
    )))`;
    const summaryCategoryFilterSql = summaryCategoryFilter === 'rentals'
      ? `(
        LOWER(TRIM(COALESCE(ct.transaction_category, ''))) = 'rentals'
        OR LOWER(TRIM(COALESCE(ct.source_type, ''))) = 'rental_payment'
        OR ct.source_rental_id IS NOT NULL
        OR ct.source_rental_payment_schedule_id IS NOT NULL
      )`
      : summaryCategoryFilter === 'all'
        ? 'TRUE'
        : salesOnlyTransactionExclusionSql;
    const summarySaleTypeFilterSql = summaryCategoryFilter === 'sales'
      ? `${normalizedSaleTypeSql} = 'for sale'`
      : 'TRUE';

    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_transactions') AS exists`
    );
    if (!exists.rows[0]?.exists) {
      return res.json({
        totals: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        mtd_registered_active: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        by_status: [],
        by_type: [],
        market_center_performance: [],
        associate_performance: [],
        expected_closings_90_days: [],
        reporting_window: null,
        performance_basis: 'registered',
      });
    }

    const perms = req.permissions!;
    const activeContextId = String(req.headers['x-active-context'] ?? '');
    const teamSourceId = perms.scope === 'OWN'
      ? await resolveTeamContextSourceId(pool, activeContextId, perms.associateDbId)
      : null;
    let visibleTransactionIds: number[] | null = null;

    if (perms.scope === 'OWN') {
      if (teamSourceId) {
        const teamResult = await pool.query<{ transaction_id: string }>(
          `SELECT DISTINCT ta.transaction_id::text
             FROM migration.transaction_agents ta
             INNER JOIN migration.core_associates ca ON ca.id = ta.associate_id
            WHERE ca.source_team_id = $1`,
          [teamSourceId]
        );
        visibleTransactionIds = teamResult.rows
          .map((row) => Number(row.transaction_id))
          .filter((id) => Number.isFinite(id));
      } else if (!perms.associateDbId) {
        visibleTransactionIds = [];
      } else {
        const ownResult = await pool.query<{ transaction_id: string }>(
          `SELECT DISTINCT transaction_id::text
             FROM migration.transaction_agents
            WHERE associate_id = $1`,
          [perms.associateDbId]
        );
        visibleTransactionIds = ownResult.rows
          .map((row) => Number(row.transaction_id))
          .filter((id) => Number.isFinite(id));
      }
    } else if (perms.scope === 'MARKET_CENTRE') {
      const mcSource = resolveEffectiveScopeMarketCenterId(perms);
      const mcLookup = await pool.query<{ id: string }>(
        `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
        [mcSource]
      );
      const mcDbId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

      const mcResult = await pool.query<{ id: string }>(
        `SELECT DISTINCT ct.id::text
           FROM migration.core_transactions ct
           LEFT JOIN migration.core_market_centers pmc ON pmc.id = ct.primary_market_center_id
           LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
           LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
          WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(pmc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1)), '[^a-z0-9]+', '', 'g')
             OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(ca.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($1)), '[^a-z0-9]+', '', 'g')
             OR ($2::int IS NOT NULL AND (ct.primary_market_center_id = $2 OR ca.market_center_id = $2))`,
        [mcSource, mcDbId]
      );
      visibleTransactionIds = mcResult.rows
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id));
    }

    if (visibleTransactionIds && visibleTransactionIds.length === 0) {
      return res.json({
        totals: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        mtd_registered_active: {
          total_transactions: 0,
          total_sales_value: 0,
          total_net_commission: 0,
          average_split_percentage: 0,
        },
        by_status: [],
        by_type: [],
        market_center_performance: [],
        associate_performance: [],
        expected_closings_90_days: [],
        reporting_window: null,
        performance_basis: 'registered',
      });
    }

    const reportingWindowResult = await pool.query<ReportingWindowRow>(
      `
      WITH ${transactionAgentCalculationDedupCte},
      limits AS (
        SELECT
          date_trunc('month', CURRENT_DATE)::date AS month_start,
          LEAST(
            CURRENT_DATE,
            (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month' - INTERVAL '1 day')::date
          ) AS as_of_date,
          (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date AS month_end
      ),
      eligible AS (
        SELECT COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) AS report_date,
               tac.is_registered
        FROM tac_dedup tac
        LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
        LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
        LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
        WHERE COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) IS NOT NULL
          AND ca.id IS NOT NULL
          AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
          AND (mc.id IS NULL OR LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1'))
          AND ${summaryCategoryFilterSql}
          AND ${summarySaleTypeFilterSql}
      ),
      reporting_window AS (
        SELECT
          CASE
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE is_registered = true
                AND report_date >= limits.month_start
                AND report_date < (limits.as_of_date + INTERVAL '1 day')
            ) THEN 'registered'
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE report_date >= limits.month_start
                AND report_date < (limits.as_of_date + INTERVAL '1 day')
            ) THEN 'allStatuses'
            WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN 'registered'
            ELSE 'allStatuses'
          END AS basis,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM eligible, limits
              WHERE report_date >= limits.month_start
                AND report_date < (limits.as_of_date + INTERVAL '1 day')
            ) THEN (SELECT month_start FROM limits)
            WHEN EXISTS (SELECT 1 FROM eligible WHERE is_registered = true) THEN (
              SELECT date_trunc('month', MAX(report_date))::date
              FROM eligible
              WHERE is_registered = true
            )
            ELSE COALESCE((SELECT date_trunc('month', MAX(report_date))::date FROM eligible), (SELECT month_start FROM limits))
          END AS start_date
      )
      SELECT
        start_date::text,
        (
          CASE
            WHEN start_date = (SELECT month_start FROM limits)
              THEN (SELECT as_of_date FROM limits)
            ELSE (start_date + INTERVAL '1 month' - INTERVAL '1 day')::date
          END
        )::text AS end_date,
        (
          CASE
            WHEN start_date = (SELECT month_start FROM limits)
              THEN ((SELECT as_of_date FROM limits) + INTERVAL '1 day')::date
            ELSE (start_date + INTERVAL '1 month')::date
          END
        )::text AS end_exclusive,
        basis
      FROM reporting_window
      `
    );

    const todayInAppTimeZone = getTodayInAppTimeZone();
    const reportingWindow = reportingWindowResult.rows[0] ?? {
      start_date: todayInAppTimeZone,
      end_date: todayInAppTimeZone,
      end_exclusive: todayInAppTimeZone,
      basis: 'registered',
    };
    const summaryBasis: ReportingWindowRow['basis'] = 'registered';

    const reportingWindowParams = [reportingWindow.start_date, reportingWindow.end_exclusive, summaryBasis];
    const scopedIds = visibleTransactionIds;

    const totalsParams: Array<string | number | number[]> = scopedIds ? [scopedIds] : [];
    const mtdParams: Array<string | number | number[]> = scopedIds
      ? [...reportingWindowParams, scopedIds]
      : [...reportingWindowParams];
    const statusParams: Array<string | number | number[]> = scopedIds ? [scopedIds] : [];
    const typeParams: Array<string | number | number[]> = scopedIds ? [scopedIds] : [];
    const marketParams: Array<string | number | number[]> = scopedIds
      ? [...reportingWindowParams, scopedIds]
      : [...reportingWindowParams];
    const associateParams: Array<string | number | number[]> = scopedIds
      ? [...reportingWindowParams, scopedIds]
      : [...reportingWindowParams];
    const closingsParams: Array<string | number | number[]> = scopedIds ? [scopedIds] : [];

    const [totalsResult, mtdResult, statusResult, typeResult, marketCenterResult, associateResult, closingsResult] = await Promise.all([
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        filtered_tac AS (
          SELECT
            ct.id AS transaction_id,
            ct.sales_price,
            tac.gci_after_fees_excl_vat,
            tac.split_percentage
          FROM migration.core_transactions ct
          LEFT JOIN tac_dedup tac ON tac.transaction_id = ct.id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          WHERE ${summaryCategoryFilterSql}
            AND (tac.transaction_agent_id IS NULL OR ca.id IS NOT NULL)
            ${scopedIds ? 'AND ct.id = ANY($1::int[])' : ''}
        ),
        grouped_tx AS (
          SELECT
            transaction_id,
            MAX(sales_price) AS sales_price
          FROM filtered_tac
          GROUP BY transaction_id
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM grouped_tx), 0)::text AS total_transactions,
          COALESCE((SELECT SUM(sales_price) FROM grouped_tx), 0)::text AS total_sales_value,
          COALESCE((SELECT SUM(gci_after_fees_excl_vat) FROM filtered_tac), 0)::text AS total_net_commission,
          COALESCE((SELECT AVG(COALESCE(split_percentage, 0)) FROM filtered_tac), 0)::text AS average_split_percentage
        `,
        totalsParams
      ),
      pool.query<{
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        average_split_percentage: string;
      }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        filtered_tac AS (
          SELECT
            tac.transaction_id,
            COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0) AS total_gci,
            tac.split_percentage
          FROM tac_dedup tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true)
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $1::date
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) < $2::date
            AND ca.id IS NOT NULL
            AND ${summaryCategoryFilterSql}
            AND ${summarySaleTypeFilterSql}
            ${scopedIds ? 'AND tac.transaction_id = ANY($4::int[])' : ''}
        ),
        grouped_tx AS (
          SELECT
            ft.transaction_id,
            MAX(ct.sales_price) AS sales_price
          FROM filtered_tac ft
          LEFT JOIN migration.core_transactions ct ON ct.id = ft.transaction_id
          GROUP BY ft.transaction_id
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM grouped_tx), 0)::text AS total_transactions,
          COALESCE((SELECT SUM(sales_price) FROM grouped_tx), 0)::text AS total_sales_value,
          COALESCE((SELECT SUM(total_gci) FROM filtered_tac), 0)::text AS total_net_commission,
          COALESCE((SELECT AVG(COALESCE(split_percentage, 0)) FROM filtered_tac), 0)::text AS average_split_percentage
        `,
        mtdParams
      ),
      pool.query<{ label: string; count: string }>(
        `
        SELECT
          COALESCE(transaction_status, 'Unknown') AS label,
          COUNT(*)::text AS count
        FROM migration.core_transactions
        ${scopedIds ? 'WHERE id = ANY($1::int[])' : ''}
        GROUP BY COALESCE(transaction_status, 'Unknown')
        ORDER BY COUNT(*) DESC
        `,
        statusParams
      ),
      pool.query<{ label: string; count: string }>(
        `
        SELECT
          COALESCE(transaction_type, 'Unknown') AS label,
          COUNT(*)::text AS count
        FROM migration.core_transactions
        ${scopedIds ? 'WHERE id = ANY($1::int[])' : ''}
        GROUP BY COALESCE(transaction_type, 'Unknown')
        ORDER BY COUNT(*) DESC
        `,
        typeParams
      ),
      pool.query<{
        market_center: string;
        total_transactions: string;
        total_sales_value: string;
        total_net_commission: string;
        total_gci: string;
      }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        base AS (
          SELECT
            tac.transaction_id,
            COALESCE(NULLIF(TRIM(ct.market_center_name), ''), NULLIF(TRIM(mc_tx_primary.name), ''), NULLIF(TRIM(mc_tx.name), ''), NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), ''), 'Unassigned / Unknown') AS tx_mc_name,
            COALESCE(NULLIF(TRIM(ct.source_market_center_id), ''), NULLIF(TRIM(mc_tx_primary.source_market_center_id), ''), NULLIF(TRIM(mc_tx.source_market_center_id), ''), NULLIF(TRIM(mc_office.source_market_center_id), ''), '') AS tx_mc_source_id,
            COALESCE(NULLIF(TRIM(mc_office.name), ''), NULLIF(TRIM(tac.office_name), '')) AS office_mc_name,
            COALESCE(NULLIF(TRIM(mc_office.source_market_center_id), ''), '') AS office_mc_source_id,
            COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0) AS transaction_gci_before_fees,
            COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(tac.transaction_side), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Unspecified') AS transaction_side,
            COALESCE(ct.sales_price, 0) AS sales_price
          FROM tac_dedup tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.transaction_agents ta ON ta.id = tac.transaction_agent_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
          LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
          LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true OR LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered')
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $1::date
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) < $2::date
            AND ca.id IS NOT NULL
            AND ${summaryCategoryFilterSql}
            AND ${summarySaleTypeFilterSql}
            ${scopedIds ? 'AND tac.transaction_id = ANY($4::int[])' : ''}
        ),
        normalized AS (
          SELECT
            transaction_id,
            tx_mc_name,
            tx_mc_source_id,
            CASE
              WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_name
              ELSE office_mc_name
            END AS office_mc_name,
            CASE
              WHEN tx_mc_name = 'KW Clockwork Benoni' AND office_mc_name = 'KW Pivot' THEN tx_mc_source_id
              ELSE office_mc_source_id
            END AS office_mc_source_id,
            transaction_gci_before_fees,
            transaction_side,
            sales_price
          FROM base
        ),
        mc_cardinality AS (
          SELECT
            transaction_id,
            COUNT(DISTINCT office_mc_name) FILTER (WHERE office_mc_name IS NOT NULL AND office_mc_name <> '') AS office_mc_count,
            MAX(tx_mc_name) AS tx_mc_name,
            MAX(tx_mc_source_id) AS tx_mc_source_id,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%both%') AS has_both,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%buyer%') AS has_buyer,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%seller%') AS has_seller,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%other%') AS has_other,
            BOOL_OR(LOWER(TRIM(transaction_side)) LIKE '%referral%') AS has_referral
          FROM normalized
          GROUP BY transaction_id
        ),
        resolved AS (
          SELECT
            n.transaction_id,
            CASE
              WHEN c.office_mc_count > 1
               AND NOT (
                 c.office_mc_count = 2
                 AND c.has_seller = true
                 AND c.has_other = true
                 AND c.has_buyer = false
                 AND c.has_referral = false
                 AND c.has_both = false
               )
              THEN COALESCE(n.office_mc_name, c.tx_mc_name, 'Unassigned / Unknown')
              ELSE COALESCE(c.tx_mc_name, n.office_mc_name, 'Unassigned / Unknown')
            END AS market_center,
            CASE
              WHEN c.office_mc_count > 1
               AND NOT (
                 c.office_mc_count = 2
                 AND c.has_seller = true
                 AND c.has_other = true
                 AND c.has_buyer = false
                 AND c.has_referral = false
                 AND c.has_both = false
               )
              THEN COALESCE(n.office_mc_source_id, c.tx_mc_source_id, '')
              ELSE COALESCE(c.tx_mc_source_id, n.office_mc_source_id, '')
            END AS mc_source_id,
            n.transaction_gci_before_fees,
            n.transaction_side,
            n.sales_price
          FROM normalized n
          JOIN mc_cardinality c ON c.transaction_id = n.transaction_id
        ),
        tx_flags AS (
          SELECT
            transaction_id,
            BOOL_OR(
              LOWER(TRIM(transaction_side)) LIKE '%both%'
              OR LOWER(TRIM(transaction_side)) LIKE '%buyer%'
              OR LOWER(TRIM(transaction_side)) LIKE '%seller%'
            ) AS tx_has_core
          FROM resolved
          GROUP BY transaction_id
        ),
        per_transaction AS (
          SELECT
            market_center,
            mc_source_id,
            r.transaction_id,
            MAX(sales_price) AS sales_price,
            COALESCE(SUM(transaction_gci_before_fees), 0) AS total_gci
          FROM resolved r
          JOIN tx_flags f ON f.transaction_id = r.transaction_id
          GROUP BY market_center, mc_source_id, r.transaction_id
        ),
        grouped AS (
          SELECT
            market_center,
            COUNT(*)::text AS total_transactions,
            COALESCE(SUM(total_gci), 0)::text AS total_gci,
            COALESCE(SUM(total_gci), 0)::text AS total_net_commission,
            COALESCE(SUM(sales_price), 0)::text AS total_sales_value
          FROM per_transaction
          GROUP BY market_center
        )
        SELECT
          grouped.market_center,
          grouped.total_transactions,
          grouped.total_sales_value,
          grouped.total_net_commission,
          grouped.total_gci
        FROM grouped
        ORDER BY grouped.total_gci::numeric DESC, grouped.total_transactions::int DESC
        LIMIT 10
        `,
        marketParams
      ),
      pool.query<{ associate_name: string; team_name: string; market_center: string; total_transactions: string; total_sales_value: string; total_gci: string }>(
        `
        WITH ${transactionAgentCalculationDedupCte},
        mtd AS (
          SELECT
            COALESCE(NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS associate_id,
            COALESCE(NULLIF(TRIM(tac.agent_name), ''), NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(ca.source_associate_id), ''), ca.id::text) AS associate_name,
            COALESCE(
              NULLIF(TRIM(t.name), ''),
              NULLIF(TRIM(t_source.name), ''),
              NULLIF(TRIM(t_source.source_team_id), ''),
              NULLIF(TRIM(ca.source_team_id), ''),
              'No Team'
            ) AS team_name,
            COALESCE(
              NULLIF(TRIM(mc_tx_primary.name), ''),
              NULLIF(TRIM(mc_tx.name), ''),
              NULLIF(TRIM(mc_office.name), ''),
              NULLIF(TRIM(mc.name), ''),
              NULLIF(TRIM(tac.office_name), ''),
              'Unassigned / Unknown'
            ) AS market_center,
            tac.transaction_id,
            COALESCE(tac.transaction_gci_before_fees, tac.gci_after_fees_excl_vat, 0) AS total_gci,
            ct.sales_price
          FROM tac_dedup tac
          LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
          LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
          LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
          LEFT JOIN migration.core_teams t ON t.id = ca.team_id
          LEFT JOIN LATERAL (
            SELECT t_src.name, t_src.source_team_id
            FROM migration.core_teams t_src
            WHERE NULLIF(TRIM(COALESCE(t_src.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(ca.source_team_id, '')), '')
            ORDER BY t_src.id DESC
            LIMIT 1
          ) t_source ON true
          LEFT JOIN migration.core_market_centers mc_office ON LOWER(TRIM(COALESCE(mc_office.name, ''))) = LOWER(TRIM(COALESCE(tac.office_name, '')))
          LEFT JOIN migration.core_market_centers mc_tx ON mc_tx.id = ct.market_center_id
          LEFT JOIN migration.core_market_centers mc_tx_primary ON mc_tx_primary.id = ct.primary_market_center_id
          WHERE ($3::text = 'allStatuses' OR tac.is_registered = true)
            AND tac.is_outside_agent = false
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) >= $1::date
            AND COALESCE(ct.status_change_date::date, tac.effective_reporting_date::date) < $2::date
            AND ca.id IS NOT NULL
            AND ${summaryCategoryFilterSql}
            AND ${summarySaleTypeFilterSql}
            ${scopedIds ? 'AND tac.transaction_id = ANY($4::int[])' : ''}
        ),
        per_transaction AS (
          SELECT
            associate_id,
            associate_name,
            team_name,
            market_center,
            transaction_id,
            MAX(sales_price) AS sales_price,
            COALESCE(SUM(total_gci), 0) AS total_gci
          FROM mtd
          GROUP BY associate_id, associate_name, team_name, market_center, transaction_id
        ),
        per_associate_tx AS (
          SELECT
            associate_id,
            MAX(associate_name) AS associate_name,
            transaction_id,
            MAX(sales_price) AS sales_price,
            COALESCE(SUM(total_gci), 0) AS total_gci
          FROM per_transaction
          GROUP BY associate_id, transaction_id
        ),
        associate_totals AS (
          SELECT
            associate_id,
            MAX(associate_name) AS associate_name,
            COUNT(*)::int AS total_transactions,
            COALESCE(SUM(sales_price), 0) AS total_sales_value,
            COALESCE(SUM(total_gci), 0) AS total_gci
          FROM per_associate_tx
          GROUP BY associate_id
        ),
        team_ranked AS (
          SELECT
            associate_id,
            team_name,
            ROW_NUMBER() OVER (
              PARTITION BY associate_id
              ORDER BY COALESCE(SUM(total_gci), 0) DESC, team_name ASC
            ) AS rn
          FROM per_transaction
          GROUP BY associate_id, team_name
        ),
        market_ranked AS (
          SELECT
            associate_id,
            market_center,
            ROW_NUMBER() OVER (
              PARTITION BY associate_id
              ORDER BY COALESCE(SUM(total_gci), 0) DESC, market_center ASC
            ) AS rn
          FROM per_transaction
          GROUP BY associate_id, market_center
        )
        SELECT
          at.associate_name,
          COALESCE(tr.team_name, 'No Team') AS team_name,
          COALESCE(mr.market_center, 'Unassigned / Unknown') AS market_center,
          at.total_transactions::text AS total_transactions,
          at.total_sales_value::text AS total_sales_value,
          at.total_gci::text AS total_gci
        FROM associate_totals at
        LEFT JOIN team_ranked tr ON tr.associate_id = at.associate_id AND tr.rn = 1
        LEFT JOIN market_ranked mr ON mr.associate_id = at.associate_id AND mr.rn = 1
        ORDER BY at.total_gci DESC, at.total_transactions DESC
        LIMIT 10
        `,
        associateParams
      ),
      pool.query<{ bucket: string; count: string; total_gci: string }>(
        `
        WITH windowed AS (
          SELECT
            CASE
              WHEN expected_date >= NOW() AND expected_date < (NOW() + INTERVAL '30 days') THEN 'Days 1-30'
              WHEN expected_date >= (NOW() + INTERVAL '30 days') AND expected_date < (NOW() + INTERVAL '60 days') THEN 'Days 31-60'
              WHEN expected_date >= (NOW() + INTERVAL '60 days') AND expected_date < (NOW() + INTERVAL '90 days') THEN 'Days 61-90'
              WHEN expected_date >= (NOW() + INTERVAL '90 days') AND expected_date < (NOW() + INTERVAL '120 days') THEN 'Days 91-120'
              ELSE NULL
            END AS bucket,
            total_gci
          FROM migration.core_transactions
          WHERE expected_date IS NOT NULL
            AND expected_date >= NOW()
            AND expected_date < (NOW() + INTERVAL '120 days')
            ${scopedIds ? 'AND id = ANY($1::int[])' : ''}
        )
        SELECT
          bucket,
          COUNT(*)::text AS count,
          COALESCE(SUM(total_gci), 0)::text AS total_gci
        FROM windowed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
        ORDER BY CASE bucket
          WHEN 'Days 1-30' THEN 1
          WHEN 'Days 31-60' THEN 2
          WHEN 'Days 61-90' THEN 3
          WHEN 'Days 91-120' THEN 4
          ELSE 5
        END
        `,
        closingsParams
      ),
    ]);

    const totals = totalsResult.rows[0] ?? {
      total_transactions: '0',
      total_sales_value: '0',
      total_net_commission: '0',
      average_split_percentage: '0',
    };

    const mtdTotals = mtdResult.rows[0] ?? {
      total_transactions: '0',
      total_sales_value: '0',
      total_net_commission: '0',
      average_split_percentage: '0',
    };

    return res.json({
      totals: {
        total_transactions: Number(totals.total_transactions ?? '0'),
        total_sales_value: Number(totals.total_sales_value ?? '0'),
        total_net_commission: Number(totals.total_net_commission ?? '0'),
        average_split_percentage: Number(totals.average_split_percentage ?? '0'),
      },
      mtd_registered_active: {
        total_transactions: Number(mtdTotals.total_transactions ?? '0'),
        total_sales_value: Number(mtdTotals.total_sales_value ?? '0'),
        total_net_commission: Number(mtdTotals.total_net_commission ?? '0'),
        average_split_percentage: Number(mtdTotals.average_split_percentage ?? '0'),
      },
      by_status: statusResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
      by_type: typeResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
      market_center_performance: marketCenterResult.rows.map((row) => ({
        market_center: row.market_center,
        total_transactions: Number(row.total_transactions),
        total_sales_value: Number(row.total_sales_value),
        total_net_commission: Number(row.total_net_commission),
        total_gci: Number(row.total_gci),
      })),
      associate_performance: associateResult.rows.map((row) => ({
        associate_name: row.associate_name,
        team_name: row.team_name,
        market_center: row.market_center,
        total_transactions: Number(row.total_transactions),
        total_sales_value: Number(row.total_sales_value),
        total_gci: Number(row.total_gci),
      })),
      expected_closings_90_days: closingsResult.rows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.count),
        total_gci: Number(row.total_gci),
      })),
      reporting_window: {
        start_date: reportingWindow.start_date,
        end_date: reportingWindow.end_date,
        basis: summaryBasis,
      },
      performance_basis: summaryBasis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const limitInput = Number(req.query.limit ?? 25);
  const offsetInput = Number(req.query.offset ?? 0);
  const searchInput = String(req.query.search ?? '').trim();
  const statusFilter = String(req.query.status ?? '').trim();
  const typeFilter = String(req.query.type ?? '').trim();
  const dateFilterInput = String(req.query.date_filter ?? '').trim().toLowerCase();
  const dateFromInput = String(req.query.date_from ?? '').trim();
  const dateToInput = String(req.query.date_to ?? '').trim();
  const categoryFilter = String(req.query.category ?? '').trim().toLowerCase();

  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 200) : 25;
  const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;

  try {
    await ensureTransactionAuxTables(pool);

    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_transactions') AS exists`
    );
    if (!exists.rows[0]?.exists) {
      return res.json({ total: 0, limit, offset, items: [] });
    }

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (searchInput.length > 0) {
      const tokens = searchInput
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean);

      for (const token of tokens) {
        params.push(`%${token}%`);
        const p = `$${params.length}`;
        whereClauses.push(
          `(
            ct.transaction_number ILIKE ${p}
            OR ct.source_transaction_id ILIKE ${p}
            OR ct.address ILIKE ${p}
            OR ct.suburb ILIKE ${p}
            OR ct.city ILIKE ${p}
            OR ct.transaction_type ILIKE ${p}
            OR ct.transaction_status ILIKE ${p}
            OR ct.listing_number ILIKE ${p}
            OR ct.source_listing_id ILIKE ${p}
            OR ca.full_name ILIKE ${p}
            OR ca.source_associate_id ILIKE ${p}
            OR mc.name ILIKE ${p}
            OR mc.source_market_center_id ILIKE ${p}
            OR tac.agent_name ILIKE ${p}
            OR tac.office_name ILIKE ${p}
            OR tac.transaction_side ILIKE ${p}
          )`
        );
      }
    }
    if (statusFilter.length > 0) {
      params.push(statusFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (typeFilter.length > 0) {
      params.push(typeFilter);
      whereClauses.push(`LOWER(TRIM(COALESCE(ct.transaction_type, ''))) = LOWER(TRIM($${params.length}))`);
    }

    const hasDateFilter = dateFilterInput === 'transaction_date' || dateFilterInput === 'status_change_date';
    if (hasDateFilter) {
      const dateColumn = dateFilterInput === 'transaction_date'
        ? 'ct.transaction_date'
        : 'ct.status_change_date';

      if (dateFromInput.length > 0) {
        params.push(dateFromInput);
        whereClauses.push(`${dateColumn}::date >= $${params.length}::date`);
      }

      if (dateToInput.length > 0) {
        params.push(dateToInput);
        whereClauses.push(`${dateColumn}::date <= $${params.length}::date`);
      }
    }

    if (categoryFilter === 'rentals') {
      whereClauses.push(`(
        LOWER(TRIM(COALESCE(ct.transaction_category, ''))) = 'rentals'
        OR LOWER(TRIM(COALESCE(ct.source_type, ''))) = 'rental_payment'
        OR ct.source_rental_id IS NOT NULL
        OR ct.source_rental_payment_schedule_id IS NOT NULL
        OR ct.transaction_number ~ '^RNTX[0-9]+$'
      )`);
    } else if (categoryFilter === 'sales') {
      whereClauses.push(`(
        LOWER(TRIM(COALESCE(ct.transaction_category, 'sales'))) <> 'rentals'
        AND LOWER(TRIM(COALESCE(ct.source_type, 'sales'))) <> 'rental_payment'
        AND ct.source_rental_id IS NULL
        AND ct.source_rental_payment_schedule_id IS NULL
        AND ct.transaction_number !~ '^RNTX[0-9]+$'
      )`);
    }

    const perms = req.permissions!;
    const activeContextId = String(req.headers['x-active-context'] ?? '');
    const teamSourceId = perms.scope === 'OWN'
      ? await resolveTeamContextSourceId(pool, activeContextId, perms.associateDbId)
      : null;
    if (perms.scope === 'OWN') {
      if (teamSourceId) {
        params.push(teamSourceId);
        whereClauses.push(`EXISTS (
          SELECT 1 FROM migration.transaction_agents pta
          INNER JOIN migration.core_associates pca ON pca.id = pta.associate_id
          WHERE pta.transaction_id = ct.id
            AND pca.source_team_id = $${params.length}
        )`);
      } else if (!perms.associateDbId) {
        whereClauses.push('1 = 0');
      } else {
        params.push(perms.associateDbId);
        whereClauses.push(`EXISTS (
          SELECT 1 FROM migration.transaction_agents pta
          WHERE pta.transaction_id = ct.id
            AND pta.associate_id = $${params.length}
        )`);
      }
    } else if (perms.scope === 'MARKET_CENTRE') {
      const mcSourceId = resolveEffectiveScopeMarketCenterId(perms);
      let mcDbId: number | null = null;
      if (mcSourceId) {
        const mcLookup = await pool.query<{ id: string }>(
          `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [mcSourceId]
        );
        mcDbId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
      }

      params.push(mcSourceId);
      const mcSourceParam = `$${params.length}`;
      if (mcDbId !== null) {
        params.push(mcDbId);
        const mcDbParam = `$${params.length}`;
        whereClauses.push(`(
          EXISTS (
            SELECT 1
              FROM migration.core_market_centers pmc
             WHERE pmc.id = ct.primary_market_center_id
               AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(pmc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
          )
          OR ct.primary_market_center_id = ${mcDbParam}
          OR EXISTS (
            SELECT 1
              FROM migration.transaction_agents pta
              LEFT JOIN migration.core_associates pca ON pca.id = pta.associate_id
             WHERE pta.transaction_id = ct.id
               AND (
                 REGEXP_REPLACE(LOWER(TRIM(COALESCE(pca.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
                 OR pca.market_center_id = ${mcDbParam}
               )
          )
        )`);
      } else {
        whereClauses.push(`(
          EXISTS (
            SELECT 1
              FROM migration.core_market_centers pmc
             WHERE pmc.id = ct.primary_market_center_id
               AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(pmc.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
          )
          OR EXISTS (
            SELECT 1
              FROM migration.transaction_agents pta
              LEFT JOIN migration.core_associates pca ON pca.id = pta.associate_id
             WHERE pta.transaction_id = ct.id
               AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(pca.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
          )
        )`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countParams = [...params];
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const [totalResult, dataResult] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT ct.id)::text AS total
         FROM migration.core_transactions ct
         LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
         LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
         LEFT JOIN LATERAL (
           SELECT tac1.*
           FROM migration.transaction_agent_calculations tac1
           WHERE tac1.transaction_agent_id = ta.id
           ORDER BY tac1.updated_at DESC NULLS LAST, tac1.id DESC
           LIMIT 1
         ) tac ON true
         ${whereSql}`,
        countParams
      ),
      pool.query(
        `WITH filtered AS (
           SELECT DISTINCT ct.id
           FROM migration.core_transactions ct
           LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
           LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
           LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
           LEFT JOIN LATERAL (
             SELECT tac1.*
             FROM migration.transaction_agent_calculations tac1
             WHERE tac1.transaction_agent_id = ta.id
             ORDER BY tac1.updated_at DESC NULLS LAST, tac1.id DESC
             LIMIT 1
           ) tac ON true
           ${whereSql}
         ),
         page_tx AS (
           SELECT ct.*
           FROM migration.core_transactions ct
           JOIN filtered f ON f.id = ct.id
           ORDER BY ${reportingDateSql('ct')} DESC NULLS LAST, ct.id DESC
           LIMIT ${limitParam} OFFSET ${offsetParam}
         )
         SELECT
           t.id, t.source_transaction_id, t.transaction_number,
           t.source_market_center_id AS tx_source_market_center_id,
           t.market_center_name AS tx_market_center_name,
           t.source_team_id, t.team_name,
           t.current_source_market_center_id, t.current_market_center_name,
           t.current_source_team_id, t.current_team_name,
           t.listing_office_name,
           t.transaction_status, t.transaction_type,
           t.transaction_category, t.source_type,
           t.source_rental_id, t.source_rental_payment_schedule_id,
           COALESCE(t.counts_toward_cap, false) AS counts_toward_cap,
           t.listing_number, t.source_listing_id,
           t.address, t.suburb, t.city,
           t.variance_per, t.contract_gci_excl_vat, t.avg_comms_per, t.transaction_gci_excl_vat,
           t.sales_price, t.list_price, t.gci_excl_vat,
           t.net_comm, t.total_gci,
           t.growth_share, t.production_royalties, t.cap_remaining,
           t.associate_dollar, t.mc_dollar, t.company_dollar, t.team_dollar,
           t.sale_type, t.buyer, t.seller,
           t.transfer_attorney, t.ta_mobile_phone, t.ta_email,
           t.bond_attorney_contact_id, t.bond_attorney, t.ba_mobile_phone, t.ba_email,
           t.bond_originator, t.bond_due_date::text, t.bond_amount,
           t.transaction_financial_institution_id, t.transaction_financial_institution,
           t.financial_institution_other, t.transaction_financing_type_id, t.transaction_financing_type,
           t.all_parties_invoiced,
           t.party_contact_details,
           t.list_date::text, t.transaction_date::text,
           t.status_change_date::text, t.expected_date::text,
           t.created_at::text AS created_at,
           COALESCE(NULLIF(TRIM(t.market_center_name), ''), mc_primary.name, mc.name) AS market_center_name,
           COALESCE(NULLIF(TRIM(t.source_market_center_id), ''), mc_primary.source_market_center_id, mc.source_market_center_id) AS source_market_center_id,
           ta.id AS agent_id,
           ta.associate_id,
           COALESCE(
             NULLIF(TRIM(ca.full_name), ''),
             CASE
               WHEN COALESCE(tac.is_outside_agent, ta.outside_agency, false)
                 THEN NULLIF(TRIM(CONCAT_WS(' ', oa.first_name, oa.last_name)), '')
             END,
             CASE
               WHEN TRIM(COALESCE(tac.agent_name, '')) !~* '^CONTACT:'
                 THEN NULLIF(TRIM(tac.agent_name), '')
             END,
             CASE
               WHEN TRIM(COALESCE(ta.agent_name, '')) !~* '^CONTACT:'
                 THEN NULLIF(TRIM(ta.agent_name), '')
             END,
             NULLIF(TRIM(CONCAT_WS(' ', oa.first_name, oa.last_name)), ''),
             CASE
               WHEN TRIM(COALESCE(ta.source_associate_id, '')) !~* '^CONTACT:'
                 THEN NULLIF(TRIM(ta.source_associate_id), '')
             END
           ) AS associate_name,
           ca.image_url AS associate_image_url,
           ta.source_associate_id,
           COALESCE(ta.agent_role, tac.transaction_side, t.transaction_type) AS agent_role,
           ta.split_percentage,
           ta.sort_order,
           tac.office_name,
           tac.transaction_side,
           tac.split_percentage::text AS calculated_split_percentage,
           tac.variance_sale_list_pct::text,
           tac.transaction_gci_before_fees::text,
           tac.average_commission_pct::text,
           tac.production_royalties::text,
           tac.growth_share::text,
           tac.total_pr_and_gs::text,
           tac.gci_after_fees_excl_vat::text,
           tac.associate_dollar::text,
           tac.cap_amount::text,
           tac.cap_remaining::text,
           tac.team_dollar::text,
           tac.market_center_dollar::text,
           tac.is_outside_agent,
           oa.first_name AS outside_first_name,
           oa.last_name AS outside_last_name,
           oa.email AS outside_email,
           oa.phone AS outside_phone,
           COALESCE(oa.agency_name, poa.outside_agency_name) AS outside_agency_name,
           t.updated_at::text
         FROM page_tx t
         LEFT JOIN migration.core_market_centers mc_primary ON mc_primary.id = t.primary_market_center_id
         LEFT JOIN migration.transaction_agents ta ON ta.transaction_id = t.id
         LEFT JOIN LATERAL (
           SELECT oa1.first_name, oa1.last_name, oa1.email, oa1.phone, oa1.agency_name
           FROM migration.outside_agency_contacts oa1
           WHERE oa1.transaction_agent_id = ta.id
           ORDER BY oa1.id DESC
           LIMIT 1
         ) oa ON true
         LEFT JOIN LATERAL (
           SELECT NULLIF(TRIM(pa."outsideAgency"), '') AS outside_agency_name
           FROM public.transactions pt
           JOIN public.transaction_associates pa ON pa."transactionId" = pt.id
           WHERE pt."transactionNumber"::text = t.transaction_number::text
             AND NULLIF(TRIM(pa."outsideAgency"), '') IS NOT NULL
           ORDER BY pa."updatedAt" DESC NULLS LAST, pa.id DESC
           LIMIT 1
         ) poa ON true
         LEFT JOIN LATERAL (
           SELECT tac1.*
           FROM migration.transaction_agent_calculations tac1
           WHERE tac1.transaction_agent_id = ta.id
           ORDER BY tac1.updated_at DESC NULLS LAST, tac1.id DESC
           LIMIT 1
         ) tac ON true
         LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
         LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = ca.source_market_center_id
         ORDER BY ${reportingDateSql('t')} DESC NULLS LAST, t.id DESC, ta.sort_order ASC`,
        params
      ),
    ]);

    // Group agents by transaction
    const txMap = new Map<string, any>();
    for (const row of dataResult.rows) {
      if (!txMap.has(row.id)) {
        txMap.set(row.id, {
          id: row.id,
          source_transaction_id: row.source_transaction_id,
          transaction_number: row.transaction_number,
          source_market_center_id: row.tx_source_market_center_id ?? row.source_market_center_id,
          market_center_name: row.tx_market_center_name ?? row.market_center_name,
          source_team_id: row.source_team_id,
          team_name: row.team_name,
          current_source_market_center_id: row.current_source_market_center_id,
          current_market_center_name: row.current_market_center_name,
          current_source_team_id: row.current_source_team_id,
          current_team_name: row.current_team_name,
          listing_office_name: row.listing_office_name,
          transaction_status: row.transaction_status,
          transaction_type: row.transaction_type,
          transaction_category: row.transaction_category,
          source_type: row.source_type,
          source_rental_id: row.source_rental_id,
          source_rental_payment_schedule_id: row.source_rental_payment_schedule_id,
          counts_toward_cap: row.counts_toward_cap,
          listing_number: row.listing_number,
          source_listing_id: row.source_listing_id,
          address: row.address,
          suburb: row.suburb,
          city: row.city,
          variance_per: row.variance_per,
          contract_gci_excl_vat: row.contract_gci_excl_vat,
          avg_comms_per: row.avg_comms_per,
          transaction_gci_excl_vat: row.transaction_gci_excl_vat,
          sales_price: row.sales_price,
          list_price: row.list_price,
          gci_excl_vat: row.gci_excl_vat,
          net_comm: row.net_comm,
          total_gci: row.total_gci,
          growth_share: row.growth_share,
          production_royalties: row.production_royalties,
          cap_remaining: row.cap_remaining,
          associate_dollar: row.associate_dollar,
          mc_dollar: row.mc_dollar,
          company_dollar: row.company_dollar,
          team_dollar: row.team_dollar,
          sale_type: row.sale_type,
          buyer: row.buyer,
          seller: row.seller,
          transfer_attorney: row.transfer_attorney,
          ta_mobile_phone: row.ta_mobile_phone,
          ta_email: row.ta_email,
          bond_attorney_contact_id: row.bond_attorney_contact_id,
          bond_attorney: row.bond_attorney,
          ba_mobile_phone: row.ba_mobile_phone,
          ba_email: row.ba_email,
          bond_originator: row.bond_originator,
          bond_due_date: row.bond_due_date,
          bond_amount: row.bond_amount,
          transaction_financial_institution_id: row.transaction_financial_institution_id,
          transaction_financial_institution: row.transaction_financial_institution,
          financial_institution_other: row.financial_institution_other,
          transaction_financing_type_id: row.transaction_financing_type_id,
          transaction_financing_type: row.transaction_financing_type,
          all_parties_invoiced: row.all_parties_invoiced,
          party_contact_details: row.party_contact_details,
          list_date: row.list_date,
          transaction_date: row.transaction_date,
          status_change_date: row.status_change_date,
          can_edit: true,
          updated_at: row.updated_at,
          agents: [],
        });
      }

      if (row.agent_id) {
        txMap.get(row.id)!.agents.push({
          associate_id: row.associate_id,
          associate_name: row.associate_name,
          image_url: row.associate_image_url,
          source_associate_id: row.source_associate_id,
          agent_role: row.agent_role,
          split_percentage: row.split_percentage,
          outside_agency: {
            first_name: row.outside_first_name ?? '',
            last_name: row.outside_last_name ?? '',
            email: row.outside_email ?? '',
            phone: row.outside_phone ?? '',
            agency_name: row.outside_agency_name ?? '',
          },
          summary: {
            office_name: row.office_name,
            transaction_type: row.transaction_side,
            split_percentage: row.calculated_split_percentage,
            variance_sale_list_pct: row.variance_sale_list_pct,
            transaction_gci_before_fees: row.transaction_gci_before_fees,
            average_commission_pct: row.average_commission_pct,
            production_royalties: row.production_royalties,
            growth_share: row.growth_share,
            total_pr_and_gs: row.total_pr_and_gs,
            gci_after_fees_excl_vat: row.gci_after_fees_excl_vat,
            associate_dollar: row.associate_dollar,
            cap_amount: row.cap_amount,
            cap_remaining: row.cap_remaining,
            team_dollar: row.team_dollar,
            market_center_dollar: row.market_center_dollar,
            is_outside_agent: row.is_outside_agent,
          },
        });
      }
    }

    return res.json({
      total: parseInt(totalResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
      items: Array.from(txMap.values()),
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

  const sourceTransactionId = toText(req.body?.source_transaction_id) ?? buildManualTransactionId();
  const transactionNumber = await getNextTransactionNumber(pool);
  const transactionStatus = toText(req.body?.transaction_status);
  const transactionType = toText(req.body?.transaction_type);
  const sourceMarketCenterId = toText(req.body?.source_market_center_id);
  const marketCenterName = toText(req.body?.market_center_name);
  const sourceTeamId = toText(req.body?.source_team_id);
  const teamName = toText(req.body?.team_name);
  const currentSourceMarketCenterId = toText(req.body?.current_source_market_center_id);
  const currentMarketCenterName = toText(req.body?.current_market_center_name);
  const currentSourceTeamId = toText(req.body?.current_source_team_id);
  const currentTeamName = toText(req.body?.current_team_name);
  const listingOfficeName = toText(req.body?.listing_office_name);
  const sourceListingId = toText(req.body?.source_listing_id);
  const listingNumber = toText(req.body?.listing_number);
  const pocketListingNumber = normalizePocketListingToken(listingNumber, sourceListingId);
  const effectiveSourceListingId = pocketListingNumber ?? sourceListingId;
  const effectiveListingNumber = pocketListingNumber ?? listingNumber;
  const address = toText(req.body?.address);
  const suburb = toText(req.body?.suburb);
  const city = toText(req.body?.city);
  const variancePer = toNumber(req.body?.variance_per);
  const contractGciExclVat = toNumber(req.body?.contract_gci_excl_vat);
  const avgCommsPer = toNumber(req.body?.avg_comms_per);
  const transactionGciExclVat = toNumber(req.body?.transaction_gci_excl_vat ?? req.body?.transaction_cgi_excl_vat);
  const salesPrice = toNumber(req.body?.sales_price);
  const listPrice = toNumber(req.body?.list_price);
  const gci = toNumber(req.body?.gci_excl_vat);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci) ?? netComm ?? gci;
  const growthShare = toNumber(req.body?.growth_share);
  const productionRoyalties = toNumber(req.body?.production_royalties);
  const capRemaining = toNumber(req.body?.cap_remaining);
  const associateDollar = toNumber(req.body?.associate_dollar);
  const mcDollar = toNumber(req.body?.mc_dollar);
  const companyDollar = toNumber(req.body?.company_dollar);
  const teamDollar = toNumber(req.body?.team_dollar);
  const saleType = toText(req.body?.sale_type);
  const buyerRaw = toText(req.body?.buyer);
  const sellerRaw = toText(req.body?.seller);
  const buyerNameParts = splitFullName(buyerRaw);
  const sellerNameParts = splitFullName(sellerRaw);
  const buyerFirstName = toText(req.body?.buyer_first_name);
  const buyerLastName = toText(req.body?.buyer_last_name);
  const buyerContactNumber = toText(req.body?.buyer_contact_number);
  const buyerEmailAddress = toText(req.body?.buyer_email_address);
  const sellerFirstName = toText(req.body?.seller_first_name);
  const sellerLastName = toText(req.body?.seller_last_name);
  const sellerContactNumber = toText(req.body?.seller_contact_number);
  const sellerEmailAddress = toText(req.body?.seller_email_address);
  const transferAttorneyFirstName = toText(req.body?.transfer_attorney_first_name);
  const transferAttorneyLastName = toText(req.body?.transfer_attorney_last_name);
  const transferAttorneyContactNumber = toText(req.body?.transfer_attorney_contact_number);
  const transferAttorneyEmailAddress = toText(req.body?.transfer_attorney_email_address);
  const transferAttorneyCompanyName = toText(req.body?.transfer_attorney_company_name);
  const buyerContactsInput = normalizePartyContactListInput(req.body?.buyer_contacts);
  const sellerContactsInput = normalizePartyContactListInput(req.body?.seller_contacts);
  const buyerFallbackContact: PartyContactPayload = {
    first_name: buyerFirstName ?? buyerNameParts.first_name,
    last_name: buyerLastName ?? buyerNameParts.last_name,
    contact_number: buyerContactNumber,
    email_address: buyerEmailAddress,
    company_name: null,
  };
  const sellerFallbackContact: PartyContactPayload = {
    first_name: sellerFirstName ?? sellerNameParts.first_name,
    last_name: sellerLastName ?? sellerNameParts.last_name,
    contact_number: sellerContactNumber,
    email_address: sellerEmailAddress,
    company_name: null,
  };
  const buyerContacts = buyerContactsInput.length > 0 ? buyerContactsInput : [buyerFallbackContact];
  const sellerContacts = sellerContactsInput.length > 0 ? sellerContactsInput : [sellerFallbackContact];
  const buyerPrimaryContact = buyerContacts[0];
  const sellerPrimaryContact = sellerContacts[0];
  const buyer = buyerRaw ?? composeDisplayName(buyerPrimaryContact.first_name, buyerPrimaryContact.last_name);
  const seller = sellerRaw ?? composeDisplayName(sellerPrimaryContact.first_name, sellerPrimaryContact.last_name);
  const transferAttorney = toText(req.body?.transfer_attorney) ?? composeDisplayName(transferAttorneyFirstName, transferAttorneyLastName) ?? transferAttorneyCompanyName;
  const taMobilePhone = toText(req.body?.ta_mobile_phone) ?? transferAttorneyContactNumber;
  const taEmail = toText(req.body?.ta_email) ?? transferAttorneyEmailAddress;
  const bondAttorneyContactId = toText(req.body?.bond_attorney_contact_id);
  const bondAttorneyFirstName = toText(req.body?.bond_attorney_first_name);
  const bondAttorneyLastName = toText(req.body?.bond_attorney_last_name);
  const bondAttorneyContactNumber = toText(req.body?.bond_attorney_contact_number);
  const bondAttorneyEmailAddress = toText(req.body?.bond_attorney_email_address);
  const bondAttorneyCompanyName = toText(req.body?.bond_attorney_company_name);
  const bondAttorney = toText(req.body?.bond_attorney) ?? composeDisplayName(bondAttorneyFirstName, bondAttorneyLastName) ?? bondAttorneyCompanyName;
  const baMobilePhone = toText(req.body?.ba_mobile_phone) ?? bondAttorneyContactNumber;
  const baEmail = toText(req.body?.ba_email) ?? bondAttorneyEmailAddress;
  const bondOriginatorFirstName = toText(req.body?.bond_originator_first_name);
  const bondOriginatorLastName = toText(req.body?.bond_originator_last_name);
  const bondOriginatorContactNumber = toText(req.body?.bond_originator_contact_number);
  const bondOriginatorEmailAddress = toText(req.body?.bond_originator_email_address);
  const bondOriginatorCompanyName = toText(req.body?.bond_originator_company_name);
  const bondOriginator = toText(req.body?.bond_originator) ?? composeDisplayName(bondOriginatorFirstName, bondOriginatorLastName) ?? bondOriginatorCompanyName;
  const bondDueDate = toDateValue(req.body?.bond_due_date);
  const bondAmount = toNumber(req.body?.bond_amount);
  const transactionFinancialInstitutionId = toText(req.body?.transaction_financial_institution_id);
  const transactionFinancialInstitution = toText(req.body?.transaction_financial_institution);
  const financialInstitutionOther = toText(req.body?.financial_institution_other);
  const transactionFinancingTypeId = toText(req.body?.transaction_financing_type_id);
  const transactionFinancingType = toText(req.body?.transaction_financing_type);
  const allPartiesInvoiced = toText(req.body?.all_parties_invoiced);
  const partyContactDetails = {
    buyer: {
      first_name: buyerPrimaryContact.first_name,
      last_name: buyerPrimaryContact.last_name,
      contact_number: buyerPrimaryContact.contact_number,
      email_address: buyerPrimaryContact.email_address,
    },
    seller: {
      first_name: sellerPrimaryContact.first_name,
      last_name: sellerPrimaryContact.last_name,
      contact_number: sellerPrimaryContact.contact_number,
      email_address: sellerPrimaryContact.email_address,
    },
    buyer_contacts: buyerContacts,
    seller_contacts: sellerContacts,
    transfer_attorney: {
      first_name: transferAttorneyFirstName,
      last_name: transferAttorneyLastName,
      contact_number: transferAttorneyContactNumber,
      email_address: transferAttorneyEmailAddress,
      company_name: transferAttorneyCompanyName,
    },
    bond_attorney: {
      first_name: bondAttorneyFirstName,
      last_name: bondAttorneyLastName,
      contact_number: bondAttorneyContactNumber,
      email_address: bondAttorneyEmailAddress,
      company_name: bondAttorneyCompanyName,
    },
    bond_originator: {
      first_name: bondOriginatorFirstName,
      last_name: bondOriginatorLastName,
      contact_number: bondOriginatorContactNumber,
      email_address: bondOriginatorEmailAddress,
      company_name: bondOriginatorCompanyName,
    },
  };
  const listDate = toDateValue(req.body?.list_date);
  const txDate = new Date().toISOString();
  const statusChangeDateInput = toDateValue(req.body?.status_change_date);
  const expectedDate = toDateValue(req.body?.expected_date);
  const agents = Array.isArray(req.body?.agents) ? req.body.agents : [];
  const effectiveTransactionType = normalizeTransactionType(transactionType ?? inferTransactionTypeFromAgents(agents));
  const effectiveSaleType = deriveSaleType(effectiveTransactionType, saleType);
  const changedByName = toText(req.user?.name);
  const changedByUserId = req.user?.userId ? String(req.user.userId) : null;
  const changedByEmail = toText(req.user?.email);

  const splitError = validateAgentSplits(agents);
  if (splitError) {
    return res.status(400).json({ error: splitError });
  }

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    await ensureTransactionAuxTables(pool);

    if (pocketListingNumber) {
      const existsElsewhere = await pocketListingExistsElsewhere(pool, pocketListingNumber);
      if (existsElsewhere) {
        return res.status(409).json({
          error: `Pocket listing number ${pocketListingNumber} already exists. Generate a new number and try again.`,
        });
      }
    }

    const perms = req.permissions!;
    const statusChangeDate = perms.isRegionalAdmin
      ? (statusChangeDateInput ?? txDate)
      : txDate;

    const sourceAssociateIds = Array.from(
      new Set(
        agents
          .map((a: Record<string, unknown>) => toText(a?.source_associate_id))
          .filter((v: string | null): v is string => !!v)
      )
    );

    const assocRows = sourceAssociateIds.length > 0
      ? await pool.query<{ id: string; source_associate_id: string; source_market_center_id: string | null }>(
          `SELECT id::text, source_associate_id, source_market_center_id
             FROM migration.core_associates
            WHERE source_associate_id = ANY($1::text[])`,
          [sourceAssociateIds]
        )
      : { rows: [] as Array<{ id: string; source_associate_id: string; source_market_center_id: string | null }> };

    if (perms.scope === 'OWN') {
      const isOwn = assocRows.rows.some((row) => row.id === perms.associateDbId);
      if (!isOwn) {
        return res.status(403).json({ error: 'Permission denied: agent transactions must include your own associate profile' });
      }
    } else if (perms.scope === 'MARKET_CENTRE') {
      const allowedMc = normalizeKey(resolveEffectiveScopeMarketCenterId(perms));
      const hasInScopeAgent = assocRows.rows.some((row) => normalizeKey(row.source_market_center_id) === allowedMc);
      if (!hasInScopeAgent) {
        return res.status(403).json({ error: 'Permission denied: transaction must include an agent from your market centre' });
      }
    }

    // Get primary market center ID from first agent (if available)
    let marketCenterId: number | null = null;
    if (agents.length > 0 && agents[0].source_associate_id) {
      const assocLookup = await pool.query<{ source_market_center_id: string | null }>(
        `SELECT source_market_center_id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
        [agents[0].source_associate_id]
      );
      if (assocLookup.rows[0]?.source_market_center_id) {
        const mcLookup = await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [assocLookup.rows[0].source_market_center_id]
        );
        marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;
      }
    }

    const insert = await pool.query<{ id: string }>(
      `
      INSERT INTO migration.core_transactions (
        source_transaction_id,
        primary_market_center_id,
        transaction_number,
        source_market_center_id,
        market_center_name,
        source_team_id,
        team_name,
        current_source_market_center_id,
        current_market_center_name,
        current_source_team_id,
        current_team_name,
        listing_office_name,
        transaction_status,
        transaction_type,
        source_listing_id,
        listing_number,
        address,
        suburb,
        city,
        variance_per,
        contract_gci_excl_vat,
        avg_comms_per,
        transaction_gci_excl_vat,
        sales_price,
        list_price,
        gci_excl_vat,
        net_comm,
        total_gci,
        growth_share,
        production_royalties,
        cap_remaining,
        associate_dollar,
        mc_dollar,
        company_dollar,
        team_dollar,
        sale_type,
        buyer,
        seller,
        transfer_attorney,
        ta_mobile_phone,
        ta_email,
        bond_attorney_contact_id,
        bond_attorney,
        ba_mobile_phone,
        ba_email,
        bond_originator,
        bond_due_date,
        bond_amount,
        transaction_financial_institution_id,
        transaction_financial_institution,
        financial_institution_other,
        transaction_financing_type_id,
        transaction_financing_type,
        all_parties_invoiced,
        party_contact_details,
        list_date,
        transaction_date,
        status_change_date,
        expected_date,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44,$45,$46,$47::timestamptz,$48,$49,$50,
        $51,$52,$53,$54,$55::jsonb,
        $56::timestamptz,$57::timestamptz,$58::timestamptz,$59::timestamptz,
        NOW()
      )
      RETURNING id::text
      `,
      [
        sourceTransactionId,
        marketCenterId,
        transactionNumber,
        sourceMarketCenterId,
        marketCenterName,
        sourceTeamId,
        teamName,
        currentSourceMarketCenterId,
        currentMarketCenterName,
        currentSourceTeamId,
        currentTeamName,
        listingOfficeName,
        transactionStatus,
        effectiveTransactionType,
        effectiveSourceListingId,
        effectiveListingNumber,
        address,
        suburb,
        city,
        variancePer,
        contractGciExclVat,
        avgCommsPer,
        transactionGciExclVat,
        salesPrice,
        listPrice,
        gci,
        netComm,
        totalGci,
        growthShare,
        productionRoyalties,
        capRemaining,
        associateDollar,
        mcDollar,
        companyDollar,
        teamDollar,
        effectiveSaleType,
        buyer,
        seller,
        transferAttorney,
        taMobilePhone,
        taEmail,
        bondAttorneyContactId,
        bondAttorney,
        baMobilePhone,
        baEmail,
        bondOriginator,
        bondDueDate,
        bondAmount,
        transactionFinancialInstitutionId,
        transactionFinancialInstitution,
        financialInstitutionOther,
        transactionFinancingTypeId,
        transactionFinancingType,
        allPartiesInvoiced,
        JSON.stringify(partyContactDetails),
        listDate,
        txDate,
        statusChangeDate,
        expectedDate,
      ]
    );

    const transactionId = Number(insert.rows[0].id);

    // Insert agents if provided
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const sourceAssociateId = toText(agent?.source_associate_id);
      const associateName = toText(agent?.associate_name);
      const agentRole = toText(agent?.agent_role);
      const splitPct = toNumber(agent?.split_percentage) ?? (agents.length === 1 ? 100 : null);
      const outsideAgency = agent?.outside_agency as {
        first_name?: unknown;
        last_name?: unknown;
        email?: unknown;
        phone?: unknown;
        agency_name?: unknown;
      } | null;
      const normalizedAgentRole = (agentRole ?? '').trim().toLowerCase();
      const isOutsideReferral = normalizedAgentRole === 'outside agency referral' || normalizedAgentRole === 'outside agent';
      const sourceAssociateKey = sourceAssociateId ?? (isOutsideReferral ? associateName : null);

      if (!sourceAssociateKey && !agentRole) {
        continue;
      }

      let associateId: number | null = null;
      if (sourceAssociateId) {
        const assocLookup = await pool.query<{ id: string }>(
          `SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
          [sourceAssociateId]
        );
        associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;
      }

      const agentInsert = await pool.query<{ id: string }>(
        `INSERT INTO migration.transaction_agents (transaction_id, associate_id, source_associate_id, agent_role, split_percentage, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id::text`,
        [transactionId, associateId, sourceAssociateKey, agentRole, splitPct, i]
      );

      if (isOutsideReferral) {
        let firstName = toText(outsideAgency?.first_name);
        let lastName = toText(outsideAgency?.last_name);
        const fullName = associateName ?? null;
        if ((!firstName || !firstName.trim()) && fullName) {
          const parts = fullName.trim().split(/\s+/);
          firstName = parts[0] ?? null;
          if (!lastName || !lastName.trim()) {
            lastName = parts.slice(1).join(' ') || null;
          }
        }

        await pool.query(
          `INSERT INTO migration.outside_agency_contacts (transaction_agent_id, transaction_id, first_name, last_name, email, phone, agency_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            Number(agentInsert.rows[0].id),
            transactionId,
            firstName,
            lastName,
            toText(outsideAgency?.email),
            toText(outsideAgency?.phone),
            toText(outsideAgency?.agency_name),
          ]
        );
      }
    }

    await pool.query(
      `INSERT INTO migration.transaction_status_history (
         transaction_id,
         previous_status,
         new_status,
         changed_at,
         changed_by,
         changed_by_user_id,
         changed_by_email
       )
       VALUES ($1, NULL, $2, NOW(), $3, $4, $5)`,
      [transactionId, transactionStatus, changedByName, changedByUserId, changedByEmail]
    );

    const recomputeWarning = scheduleTransactionAgentRecompute('transactions-create');

    return res.status(201).json({
      id: insert.rows[0].id,
      source_transaction_id: sourceTransactionId,
      warning: recomputeWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.put('/:id', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  const transactionNumber = toText(req.body?.transaction_number);
  const transactionStatus = toText(req.body?.transaction_status);
  const transactionType = toText(req.body?.transaction_type);
  const sourceMarketCenterId = toText(req.body?.source_market_center_id);
  const marketCenterName = toText(req.body?.market_center_name);
  const sourceTeamId = toText(req.body?.source_team_id);
  const teamName = toText(req.body?.team_name);
  const currentSourceMarketCenterId = toText(req.body?.current_source_market_center_id);
  const currentMarketCenterName = toText(req.body?.current_market_center_name);
  const currentSourceTeamId = toText(req.body?.current_source_team_id);
  const currentTeamName = toText(req.body?.current_team_name);
  const listingOfficeName = toText(req.body?.listing_office_name);
  const sourceListingId = toText(req.body?.source_listing_id);
  const listingNumber = toText(req.body?.listing_number);
  const pocketListingNumber = normalizePocketListingToken(listingNumber, sourceListingId);
  const effectiveSourceListingId = pocketListingNumber ?? sourceListingId;
  const effectiveListingNumber = pocketListingNumber ?? listingNumber;
  const address = toText(req.body?.address);
  const suburb = toText(req.body?.suburb);
  const city = toText(req.body?.city);
  const variancePer = toNumber(req.body?.variance_per);
  const contractGciExclVat = toNumber(req.body?.contract_gci_excl_vat);
  const avgCommsPer = toNumber(req.body?.avg_comms_per);
  const transactionGciExclVat = toNumber(req.body?.transaction_gci_excl_vat ?? req.body?.transaction_cgi_excl_vat);
  const salesPrice = toNumber(req.body?.sales_price);
  const listPrice = toNumber(req.body?.list_price);
  const gci = toNumber(req.body?.gci_excl_vat);
  const netComm = toNumber(req.body?.net_comm);
  const totalGci = toNumber(req.body?.total_gci) ?? netComm ?? gci;
  const growthShare = toNumber(req.body?.growth_share);
  const productionRoyalties = toNumber(req.body?.production_royalties);
  const capRemaining = toNumber(req.body?.cap_remaining);
  const associateDollar = toNumber(req.body?.associate_dollar);
  const mcDollar = toNumber(req.body?.mc_dollar);
  const companyDollar = toNumber(req.body?.company_dollar);
  const teamDollar = toNumber(req.body?.team_dollar);
  const saleType = toText(req.body?.sale_type);
  const buyerRaw = toText(req.body?.buyer);
  const sellerRaw = toText(req.body?.seller);
  const buyerNameParts = splitFullName(buyerRaw);
  const sellerNameParts = splitFullName(sellerRaw);
  const buyerFirstName = toText(req.body?.buyer_first_name);
  const buyerLastName = toText(req.body?.buyer_last_name);
  const buyerContactNumber = toText(req.body?.buyer_contact_number);
  const buyerEmailAddress = toText(req.body?.buyer_email_address);
  const sellerFirstName = toText(req.body?.seller_first_name);
  const sellerLastName = toText(req.body?.seller_last_name);
  const sellerContactNumber = toText(req.body?.seller_contact_number);
  const sellerEmailAddress = toText(req.body?.seller_email_address);
  const transferAttorneyFirstName = toText(req.body?.transfer_attorney_first_name);
  const transferAttorneyLastName = toText(req.body?.transfer_attorney_last_name);
  const transferAttorneyContactNumber = toText(req.body?.transfer_attorney_contact_number);
  const transferAttorneyEmailAddress = toText(req.body?.transfer_attorney_email_address);
  const transferAttorneyCompanyName = toText(req.body?.transfer_attorney_company_name);
  const buyerContactsInput = normalizePartyContactListInput(req.body?.buyer_contacts);
  const sellerContactsInput = normalizePartyContactListInput(req.body?.seller_contacts);
  const buyerFallbackContact: PartyContactPayload = {
    first_name: buyerFirstName ?? buyerNameParts.first_name,
    last_name: buyerLastName ?? buyerNameParts.last_name,
    contact_number: buyerContactNumber,
    email_address: buyerEmailAddress,
    company_name: null,
  };
  const sellerFallbackContact: PartyContactPayload = {
    first_name: sellerFirstName ?? sellerNameParts.first_name,
    last_name: sellerLastName ?? sellerNameParts.last_name,
    contact_number: sellerContactNumber,
    email_address: sellerEmailAddress,
    company_name: null,
  };
  const buyerContacts = buyerContactsInput.length > 0 ? buyerContactsInput : [buyerFallbackContact];
  const sellerContacts = sellerContactsInput.length > 0 ? sellerContactsInput : [sellerFallbackContact];
  const buyerPrimaryContact = buyerContacts[0];
  const sellerPrimaryContact = sellerContacts[0];
  const buyer = buyerRaw ?? composeDisplayName(buyerPrimaryContact.first_name, buyerPrimaryContact.last_name);
  const seller = sellerRaw ?? composeDisplayName(sellerPrimaryContact.first_name, sellerPrimaryContact.last_name);
  const transferAttorney = toText(req.body?.transfer_attorney) ?? composeDisplayName(transferAttorneyFirstName, transferAttorneyLastName) ?? transferAttorneyCompanyName;
  const taMobilePhone = toText(req.body?.ta_mobile_phone) ?? transferAttorneyContactNumber;
  const taEmail = toText(req.body?.ta_email) ?? transferAttorneyEmailAddress;
  const bondAttorneyContactId = toText(req.body?.bond_attorney_contact_id);
  const bondAttorneyFirstName = toText(req.body?.bond_attorney_first_name);
  const bondAttorneyLastName = toText(req.body?.bond_attorney_last_name);
  const bondAttorneyContactNumber = toText(req.body?.bond_attorney_contact_number);
  const bondAttorneyEmailAddress = toText(req.body?.bond_attorney_email_address);
  const bondAttorneyCompanyName = toText(req.body?.bond_attorney_company_name);
  const bondAttorney = toText(req.body?.bond_attorney) ?? composeDisplayName(bondAttorneyFirstName, bondAttorneyLastName) ?? bondAttorneyCompanyName;
  const baMobilePhone = toText(req.body?.ba_mobile_phone) ?? bondAttorneyContactNumber;
  const baEmail = toText(req.body?.ba_email) ?? bondAttorneyEmailAddress;
  const bondOriginatorFirstName = toText(req.body?.bond_originator_first_name);
  const bondOriginatorLastName = toText(req.body?.bond_originator_last_name);
  const bondOriginatorContactNumber = toText(req.body?.bond_originator_contact_number);
  const bondOriginatorEmailAddress = toText(req.body?.bond_originator_email_address);
  const bondOriginatorCompanyName = toText(req.body?.bond_originator_company_name);
  const bondOriginator = toText(req.body?.bond_originator) ?? composeDisplayName(bondOriginatorFirstName, bondOriginatorLastName) ?? bondOriginatorCompanyName;
  const bondDueDate = toDateValue(req.body?.bond_due_date);
  const bondAmount = toNumber(req.body?.bond_amount);
  const transactionFinancialInstitutionId = toText(req.body?.transaction_financial_institution_id);
  const transactionFinancialInstitution = toText(req.body?.transaction_financial_institution);
  const financialInstitutionOther = toText(req.body?.financial_institution_other);
  const transactionFinancingTypeId = toText(req.body?.transaction_financing_type_id);
  const transactionFinancingType = toText(req.body?.transaction_financing_type);
  const allPartiesInvoiced = toText(req.body?.all_parties_invoiced);
  const statusChangeDateInput = toDateValue(req.body?.status_change_date);
  const partyContactDetails = {
    buyer: {
      first_name: buyerPrimaryContact.first_name,
      last_name: buyerPrimaryContact.last_name,
      contact_number: buyerPrimaryContact.contact_number,
      email_address: buyerPrimaryContact.email_address,
    },
    seller: {
      first_name: sellerPrimaryContact.first_name,
      last_name: sellerPrimaryContact.last_name,
      contact_number: sellerPrimaryContact.contact_number,
      email_address: sellerPrimaryContact.email_address,
    },
    buyer_contacts: buyerContacts,
    seller_contacts: sellerContacts,
    transfer_attorney: {
      first_name: transferAttorneyFirstName,
      last_name: transferAttorneyLastName,
      contact_number: transferAttorneyContactNumber,
      email_address: transferAttorneyEmailAddress,
      company_name: transferAttorneyCompanyName,
    },
    bond_attorney: {
      first_name: bondAttorneyFirstName,
      last_name: bondAttorneyLastName,
      contact_number: bondAttorneyContactNumber,
      email_address: bondAttorneyEmailAddress,
      company_name: bondAttorneyCompanyName,
    },
    bond_originator: {
      first_name: bondOriginatorFirstName,
      last_name: bondOriginatorLastName,
      contact_number: bondOriginatorContactNumber,
      email_address: bondOriginatorEmailAddress,
      company_name: bondOriginatorCompanyName,
    },
  };
  const listDate = toDateValue(req.body?.list_date);
  const expectedDate = toDateValue(req.body?.expected_date);
  const agents = Array.isArray(req.body?.agents) ? req.body.agents : [];
  const changedByName = toText(req.user?.name);
  const changedByUserId = req.user?.userId ? String(req.user.userId) : null;
  const changedByEmail = toText(req.user?.email);

  const splitError = validateAgentSplits(agents);
  if (splitError) {
    return res.status(400).json({ error: splitError });
  }

  if (!transactionStatus || !ALLOWED_STATUSES.includes(transactionStatus as (typeof ALLOWED_STATUSES)[number])) {
    return res.status(400).json({ error: `transaction_status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    await ensureTransactionAuxTables(pool);

    if (pocketListingNumber) {
      const existsElsewhere = await pocketListingExistsElsewhere(pool, pocketListingNumber, id);
      if (existsElsewhere) {
        return res.status(409).json({
          error: `Pocket listing number ${pocketListingNumber} already exists. Generate a new number and try again.`,
        });
      }
    }

    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot edit this transaction' });
    }

    const sourceAssociateIds = Array.from(
      new Set(
        agents
          .map((a: Record<string, unknown>) => toText(a?.source_associate_id))
          .filter((v: string | null): v is string => !!v)
      )
    );

    const assocRows = sourceAssociateIds.length > 0
      ? await pool.query<{ id: string; source_associate_id: string; source_market_center_id: string | null }>(
          `SELECT id::text, source_associate_id, source_market_center_id
             FROM migration.core_associates
            WHERE source_associate_id = ANY($1::text[])`,
          [sourceAssociateIds]
        )
      : { rows: [] as Array<{ id: string; source_associate_id: string; source_market_center_id: string | null }> };

    if (perms.scope === 'OWN') {
      const isOwn = assocRows.rows.some((row) => row.id === perms.associateDbId);
      if (!isOwn) {
        return res.status(403).json({ error: 'Permission denied: agent transactions must include your own associate profile' });
      }
    } else if (perms.scope === 'MARKET_CENTRE') {
      const allowedMc = normalizeKey(resolveEffectiveScopeMarketCenterId(perms));
      const hasInScopeAgent = assocRows.rows.some((row) => normalizeKey(row.source_market_center_id) === allowedMc);
      if (!hasInScopeAgent) {
        return res.status(403).json({ error: 'Permission denied: transaction must include an agent from your market centre' });
      }
    }

    // First, update the transaction itself (without agent fields)
    const existing = await pool.query<{
      transaction_status: string | null;
      transaction_type: string | null;
      sale_type: string | null;
      listing_number: string | null;
      source_listing_id: string | null;
    }>(
      `SELECT transaction_status, transaction_type, sale_type, listing_number, source_listing_id
       FROM migration.core_transactions
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    const existingPocketListingNumber = normalizePocketListingToken(
      existing.rows[0]?.listing_number ?? null,
      existing.rows[0]?.source_listing_id ?? null,
    );

    if (existingPocketListingNumber && pocketListingNumber !== existingPocketListingNumber) {
      return res.status(409).json({
        error: `Pocket listing number ${existingPocketListingNumber} is locked and cannot be changed.`,
      });
    }

    const previousStatus = existing.rows[0]?.transaction_status ?? null;
    const existingTransactionType = existing.rows[0]?.transaction_type ?? null;
    const existingSaleType = existing.rows[0]?.sale_type ?? null;
    const effectiveTransactionType = normalizeTransactionType(
      transactionType ?? inferTransactionTypeFromAgents(agents) ?? existingTransactionType
    );
    const effectiveSaleType = deriveSaleType(effectiveTransactionType, saleType ?? existingSaleType);
    const statusChanged = (previousStatus ?? '').trim().toLowerCase() !== (transactionStatus ?? '').trim().toLowerCase();
    const { statusChangeDateValue, statusChangeUpdateSql } = buildStatusChangeDateUpdateClause({
      isRegionalAdmin: perms.isRegionalAdmin,
      statusChangeDateInput,
      transactionStatus,
    });

    const update = await pool.query<{ id: string }>(
      `
      UPDATE migration.core_transactions
      SET
        transaction_number = $1,
        transaction_status = $2,
        transaction_type = $3,
        source_market_center_id = $4,
        market_center_name = $5,
        source_team_id = $6,
        team_name = $7,
        current_source_market_center_id = $8,
        current_market_center_name = $9,
        current_source_team_id = $10,
        current_team_name = $11,
        listing_office_name = $12,
        source_listing_id = $13,
        listing_number = $14,
        address = $15,
        suburb = $16,
        city = $17,
        variance_per = $18,
        contract_gci_excl_vat = $19,
        avg_comms_per = $20,
        transaction_gci_excl_vat = $21,
        sales_price = $22,
        list_price = $23,
        gci_excl_vat = $24,
        net_comm = $25,
        total_gci = $26,
        growth_share = $27,
        production_royalties = $28,
        cap_remaining = $29,
        associate_dollar = $30,
        mc_dollar = $31,
        company_dollar = $32,
        team_dollar = $33,
        sale_type = $34,
        buyer = $35,
        seller = $36,
        transfer_attorney = $37,
        ta_mobile_phone = $38,
        ta_email = $39,
        bond_attorney_contact_id = $40,
        bond_attorney = $41,
        ba_mobile_phone = $42,
        ba_email = $43,
        bond_originator = $44,
        bond_due_date = $45::timestamptz,
        bond_amount = $46,
        transaction_financial_institution_id = $47,
        transaction_financial_institution = $48,
        financial_institution_other = $49,
        transaction_financing_type_id = $50,
        transaction_financing_type = $51,
        all_parties_invoiced = $52,
        party_contact_details = $53::jsonb,
        list_date = $54::timestamptz,
        status_change_date = ${statusChangeUpdateSql},
        expected_date = $56::timestamptz,
        updated_at = NOW()
      WHERE id = $57
      RETURNING id::text
      `,
      [
        transactionNumber,
        transactionStatus,
        effectiveTransactionType,
        sourceMarketCenterId,
        marketCenterName,
        sourceTeamId,
        teamName,
        currentSourceMarketCenterId,
        currentMarketCenterName,
        currentSourceTeamId,
        currentTeamName,
        listingOfficeName,
        effectiveSourceListingId,
        effectiveListingNumber,
        address,
        suburb,
        city,
        variancePer,
        contractGciExclVat,
        avgCommsPer,
        transactionGciExclVat,
        salesPrice,
        listPrice,
        gci,
        netComm,
        totalGci,
        growthShare,
        productionRoyalties,
        capRemaining,
        associateDollar,
        mcDollar,
        companyDollar,
        teamDollar,
        effectiveSaleType,
        buyer,
        seller,
        transferAttorney,
        taMobilePhone,
        taEmail,
        bondAttorneyContactId,
        bondAttorney,
        baMobilePhone,
        baEmail,
        bondOriginator,
        bondDueDate,
        bondAmount,
        transactionFinancialInstitutionId,
        transactionFinancialInstitution,
        financialInstitutionOther,
        transactionFinancingTypeId,
        transactionFinancingType,
        allPartiesInvoiced,
        JSON.stringify(partyContactDetails),
        listDate,
        statusChangeDateValue,
        expectedDate,
        id,
      ]
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    // Delete existing agents and insert new ones
    if (agents.length >= 0) {
      await pool.query(`DELETE FROM migration.transaction_agents WHERE transaction_id = $1`, [id]);

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const sourceAssociateId = toText(agent?.source_associate_id);
        const associateName = toText(agent?.associate_name);
        const agentRole = toText(agent?.agent_role);
        const splitPct = toNumber(agent?.split_percentage) ?? (agents.length === 1 ? 100 : null);
        const outsideAgency = agent?.outside_agency as {
          first_name?: unknown;
          last_name?: unknown;
          email?: unknown;
          phone?: unknown;
          agency_name?: unknown;
        } | null;
        const normalizedAgentRole = (agentRole ?? '').trim().toLowerCase();
        const isOutsideReferral = normalizedAgentRole === 'outside agency referral' || normalizedAgentRole === 'outside agent';
        const sourceAssociateKey = sourceAssociateId ?? (isOutsideReferral ? associateName : null);

        if (!sourceAssociateKey && !agentRole) {
          continue;
        }

        let associateId: number | null = null;
        if (sourceAssociateId) {
          const assocLookup = await pool.query<{ id: string }>(
            `SELECT id::text AS id FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`,
            [sourceAssociateId]
          );
          associateId = assocLookup.rows[0]?.id ? Number(assocLookup.rows[0].id) : null;
        }

        const agentInsert = await pool.query<{ id: string }>(
          `INSERT INTO migration.transaction_agents (transaction_id, associate_id, source_associate_id, agent_role, split_percentage, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id::text`,
          [id, associateId, sourceAssociateKey, agentRole, splitPct, i]
        );

        if (isOutsideReferral) {
          let firstName = toText(outsideAgency?.first_name);
          let lastName = toText(outsideAgency?.last_name);
          const fullName = associateName ?? null;
          if ((!firstName || !firstName.trim()) && fullName) {
            const parts = fullName.trim().split(/\s+/);
            firstName = parts[0] ?? null;
            if (!lastName || !lastName.trim()) {
              lastName = parts.slice(1).join(' ') || null;
            }
          }

          await pool.query(
            `INSERT INTO migration.outside_agency_contacts (transaction_agent_id, transaction_id, first_name, last_name, email, phone, agency_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              Number(agentInsert.rows[0].id),
              id,
              firstName,
              lastName,
              toText(outsideAgency?.email),
              toText(outsideAgency?.phone),
              toText(outsideAgency?.agency_name),
            ]
          );
        }
      }
    }

    if (statusChanged) {
      await pool.query(
        `INSERT INTO migration.transaction_status_history (
           transaction_id,
           previous_status,
           new_status,
           changed_at,
           changed_by,
           changed_by_user_id,
           changed_by_email
         )
         VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
        [id, previousStatus, transactionStatus, changedByName, changedByUserId, changedByEmail]
      );
    }

    const recomputeWarning = scheduleTransactionAgentRecompute('transactions-update');

    // Force next MC Dashboard request to recompute today's snapshot after transaction edits.
    const snapshotExists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.mc_dashboard_daily_snapshots') AS exists`
    );
    if (snapshotExists.rows[0]?.exists) {
      await pool.query(
        `DELETE FROM migration.mc_dashboard_daily_snapshots WHERE snapshot_date = $1::date`,
        [getTodayInAppTimeZone()]
      );
    }

    return res.json({ id: update.rows[0].id, warning: recomputeWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// GET single transaction with all expanded fields
router.get('/:id', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const activeContextId = String(req.headers['x-active-context'] ?? '');
    const teamSourceId = perms.scope === 'OWN'
      ? await resolveTeamContextSourceId(pool, activeContextId, perms.associateDbId)
      : null;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms, teamSourceId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot view this transaction' });
    }

    const result = await pool.query(
      `SELECT
         t.id, t.source_transaction_id, t.transaction_number,
        t.transaction_category,
        t.source_rental_id, t.source_rental_payment_schedule_id,
        t.counts_toward_cap,
         t.source_market_center_id,
         t.market_center_name,
         t.source_team_id, t.team_name,
         t.listing_office_name,
         t.transaction_status, t.transaction_type,
         t.listing_number, t.source_listing_id,
         t.address, t.suburb, t.city,
         COALESCE(t.variance_per, tac_rollup.variance_sale_list_pct) AS variance_per,
         COALESCE(t.contract_gci_excl_vat, tac_rollup.transaction_gci_before_fees) AS contract_gci_excl_vat,
         COALESCE(t.avg_comms_per, tac_rollup.average_commission_pct) AS avg_comms_per,
         COALESCE(t.transaction_gci_excl_vat, tac_rollup.gci_after_fees_excl_vat) AS transaction_gci_excl_vat,
         t.sales_price, t.list_price,
         COALESCE(t.gci_excl_vat, tac_rollup.transaction_gci_before_fees, tac_rollup.gci_after_fees_excl_vat) AS gci_excl_vat,
         COALESCE(t.net_comm, tac_rollup.gci_after_fees_excl_vat) AS net_comm,
         COALESCE(t.total_gci, tac_rollup.transaction_gci_before_fees, tac_rollup.gci_after_fees_excl_vat) AS total_gci,
         COALESCE(t.growth_share, tac_rollup.growth_share) AS growth_share,
         COALESCE(t.production_royalties, tac_rollup.production_royalties) AS production_royalties,
         COALESCE(t.cap_remaining, tac_rollup.cap_remaining) AS cap_remaining,
         COALESCE(t.associate_dollar, tac_rollup.associate_dollar) AS associate_dollar,
         COALESCE(t.mc_dollar, tac_rollup.market_center_dollar) AS mc_dollar,
         COALESCE(t.company_dollar, tac_rollup.market_center_dollar) AS company_dollar,
         COALESCE(t.team_dollar, tac_rollup.team_dollar) AS team_dollar,
         t.sale_type, t.buyer, t.seller,
         t.transfer_attorney, t.ta_mobile_phone, t.ta_email,
         t.bond_attorney, t.ba_mobile_phone, t.ba_email,
         t.bond_originator, t.bond_due_date::text, t.bond_amount,
         t.transaction_financial_institution, t.transaction_financing_type,
         t.financial_institution_other,
           t.all_parties_invoiced,
           t.party_contact_details,
         t.list_date::text, t.transaction_date::text,
         t.status_change_date::text, t.expected_date::text,
         (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'agent_name', NULLIF(TRIM(CONCAT_WS(' ', oa.first_name, oa.last_name)), ''),
                 'agency_name', oa.agency_name,
                 'phone', oa.phone,
                 'email', oa.email
               )
               ORDER BY ta.sort_order ASC, oa.id ASC
             ),
             '[]'::jsonb
           )
           FROM migration.transaction_agents ta
           JOIN migration.outside_agency_contacts oa
             ON oa.transaction_agent_id = ta.id
           WHERE ta.transaction_id = t.id
         ) AS outside_agency_contacts,
         (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'agent_name', COALESCE(
                   NULLIF(TRIM(ca.full_name), ''),
                   CASE
                     WHEN COALESCE(ta.outside_agency, false)
                       THEN NULLIF(TRIM(CONCAT_WS(' ', oa.first_name, oa.last_name)), '')
                   END,
                   CASE
                     WHEN TRIM(COALESCE(ta.agent_name, '')) !~* '^CONTACT:'
                       THEN NULLIF(TRIM(ta.agent_name), '')
                   END,
                   NULLIF(TRIM(CONCAT_WS(' ', oa.first_name, oa.last_name)), ''),
                   CASE
                     WHEN TRIM(COALESCE(ta.source_associate_id, '')) !~* '^CONTACT:'
                       THEN NULLIF(TRIM(ta.source_associate_id), '')
                   END,
                   'Unknown Agent'
                 ),
                 'agent_role', COALESCE(NULLIF(TRIM(ta.agent_role), ''), 'Unknown Side'),
                 'split_percentage', ta.split_percentage::text,
                 'is_outside_agent', COALESCE(ta.outside_agency, false)
               )
               ORDER BY ta.sort_order ASC, ta.id ASC
             ),
             '[]'::jsonb
           )
           FROM migration.transaction_agents ta
           LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
           LEFT JOIN LATERAL (
             SELECT oa1.first_name, oa1.last_name
             FROM migration.outside_agency_contacts oa1
             WHERE oa1.transaction_agent_id = ta.id
             ORDER BY oa1.id DESC
             LIMIT 1
           ) oa ON true
           WHERE ta.transaction_id = t.id
         ) AS agent_breakdown,
         t.created_at::text,
         t.updated_at::text
       FROM migration.core_transactions t
       LEFT JOIN LATERAL (
         WITH tac_latest AS (
           SELECT DISTINCT ON (tac1.transaction_agent_id)
             tac1.transaction_agent_id,
             tac1.transaction_gci_before_fees,
             tac1.average_commission_pct,
             tac1.variance_sale_list_pct,
             tac1.gci_after_fees_excl_vat,
             tac1.growth_share,
             tac1.production_royalties,
             tac1.cap_remaining,
             tac1.associate_dollar,
             tac1.team_dollar,
             tac1.market_center_dollar
           FROM migration.transaction_agents ta
           JOIN migration.transaction_agent_calculations tac1 ON tac1.transaction_agent_id = ta.id
           WHERE ta.transaction_id = t.id
           ORDER BY tac1.transaction_agent_id, tac1.updated_at DESC NULLS LAST, tac1.id DESC
         )
         SELECT
           ROUND(COALESCE(SUM(transaction_gci_before_fees), 0)::numeric, 2) AS transaction_gci_before_fees,
           MAX(average_commission_pct) AS average_commission_pct,
           MAX(variance_sale_list_pct) AS variance_sale_list_pct,
           ROUND(COALESCE(SUM(gci_after_fees_excl_vat), 0)::numeric, 2) AS gci_after_fees_excl_vat,
           ROUND(COALESCE(SUM(growth_share), 0)::numeric, 2) AS growth_share,
           ROUND(COALESCE(SUM(production_royalties), 0)::numeric, 2) AS production_royalties,
           MAX(cap_remaining) AS cap_remaining,
           ROUND(COALESCE(SUM(associate_dollar), 0)::numeric, 2) AS associate_dollar,
           ROUND(COALESCE(SUM(team_dollar), 0)::numeric, 2) AS team_dollar,
           ROUND(COALESCE(SUM(market_center_dollar), 0)::numeric, 2) AS market_center_dollar
         FROM tac_latest
       ) tac_rollup ON true
       WHERE t.id = $1
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/:id/status-history', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot view this transaction history' });
    }

    const result = await pool.query(
      `SELECT 
         id::text, transaction_id::text, previous_status, new_status, 
         changed_at::text, changed_by, changed_by_user_id, changed_by_email, notes
       FROM migration.transaction_status_history
       WHERE transaction_id = $1
       ORDER BY changed_at DESC, id DESC`,
      [id]
    );

    return res.json({ items: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/:id/documents', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot view transaction documents' });
    }

    const result = await pool.query(
      `SELECT
         id::text,
         transaction_id::text,
         source_document_id,
         source_transaction_document_type_id,
         transaction_document_type,
         file_name,
         document_url,
         preview_url,
         created_at::text,
         updated_at::text
       FROM migration.transaction_documents
       WHERE transaction_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [id]
    );

    const sourceTxIdResult = await pool.query<{ source_transaction_id: string | null; transaction_number: string | null }>(
      `SELECT source_transaction_id::text, transaction_number::text FROM migration.core_transactions WHERE id = $1 LIMIT 1`,
      [id]
    );

    const sourceTransactionId = sourceTxIdResult.rows[0]?.source_transaction_id ?? null;
    const txNumber = sourceTxIdResult.rows[0]?.transaction_number ?? null;
    const stagedExistsResult = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('staging.transaction_documents_raw') AS exists`
    );

    let stagedRows: Array<Record<string, string | null>> = [];
    if (sourceTransactionId && stagedExistsResult.rows[0]?.exists) {
      const stagedResult = await pool.query<{
        source_document_id: string | null;
        source_transaction_document_type_id: string | null;
        transaction_document_type: string | null;
        file_name: string | null;
        document_url: string | null;
        preview_url: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>(
        `SELECT
           source_document_id,
           source_transaction_document_type_id,
           transaction_document_type,
           file_name,
           document_url,
           preview_url,
           created_at::text,
           updated_at::text
         FROM staging.transaction_documents_raw
         WHERE source_transaction_id::text = $1::text
           AND COALESCE(soft_delete, false) = false
         ORDER BY created_at DESC NULLS LAST, id DESC
         LIMIT 100`,
        [sourceTransactionId]
      );

      stagedRows = stagedResult.rows.map((row) => ({
        id: `staging:${row.source_document_id ?? row.document_url ?? row.file_name ?? Math.random().toString(36).slice(2)}`,
        transaction_id: String(id),
        source_document_id: row.source_document_id,
        source_transaction_document_type_id: row.source_transaction_document_type_id,
        transaction_document_type: row.transaction_document_type,
        file_name: row.file_name ?? 'Document',
        document_url: row.document_url,
        preview_url: row.preview_url,
        created_at: row.created_at,
        updated_at: row.updated_at ?? row.created_at,
      }));
    }

    const publicDocTablesResult = await pool.query<{
      transaction_documents_exists: string | null;
      documents_exists: string | null;
      transactions_exists: string | null;
    }>(
      `SELECT
         to_regclass('public.transaction_documents') AS transaction_documents_exists,
         to_regclass('public.documents') AS documents_exists,
         to_regclass('public.transactions') AS transactions_exists`
    );

    const publicDocsAvailable = Boolean(
      publicDocTablesResult.rows[0]?.transaction_documents_exists
      && publicDocTablesResult.rows[0]?.documents_exists
      && publicDocTablesResult.rows[0]?.transactions_exists
    );

    let publicRows: Array<Record<string, string | null>> = [];
    if (txNumber && publicDocsAvailable) {
      const publicResult = await pool.query<{
        tx_document_id: string | null;
        source_document_id: string | null;
        source_transaction_document_type_id: string | null;
        transaction_document_type: string | null;
        file_name: string | null;
        document_url: string | null;
        preview_url: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>(
        `SELECT
           td."id"::text AS tx_document_id,
           td."documentId"::text AS source_document_id,
           NULL::text AS source_transaction_document_type_id,
           'Legacy Document'::text AS transaction_document_type,
           NULLIF(SPLIT_PART(d."url", '/', array_length(string_to_array(d."url", '/'), 1)), '') AS file_name,
           d."url" AS document_url,
           NULL::text AS preview_url,
           d."createdAt"::text AS created_at,
           d."createdAt"::text AS updated_at
         FROM public.transactions t
         JOIN public.transaction_documents td ON td."transactionId" = t.id
         LEFT JOIN public.documents d ON d.id = td."documentId"
         WHERE t."transactionNumber"::text = $1::text
         ORDER BY d."createdAt" DESC NULLS LAST, td."id" DESC
         LIMIT 100`,
        [txNumber]
      );

      publicRows = publicResult.rows.map((row) => ({
        id: `public:${row.tx_document_id ?? row.source_document_id ?? row.document_url ?? row.file_name ?? Math.random().toString(36).slice(2)}`,
        transaction_id: String(id),
        source_document_id: row.source_document_id,
        source_transaction_document_type_id: row.source_transaction_document_type_id,
        transaction_document_type: row.transaction_document_type,
        file_name: row.file_name ?? 'Document',
        document_url: row.document_url,
        preview_url: row.preview_url,
        created_at: row.created_at,
        updated_at: row.updated_at ?? row.created_at,
      }));
    }

    const deduped = new Map<string, Record<string, string | null>>();
    for (const row of [...result.rows, ...stagedRows, ...publicRows]) {
      const dedupeKey = `${row.source_document_id ?? ''}::${row.document_url ?? ''}::${row.file_name ?? ''}`;
      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, row as Record<string, string | null>);
      }
    }

    return res.json({ items: Array.from(deduped.values()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/documents/upload', resolvePermissions, async (req, res, next) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  try {
    await runUploadMiddleware(req, res, uploadTransactionDocument.single('document'));
  } catch (error) {
    return next(error);
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No document file provided.' });
  }

  const sourceDocumentId = toText(req.body?.source_document_id);
  const sourceDocumentTypeId = toText(req.body?.source_transaction_document_type_id);
  const documentType = toText(req.body?.transaction_document_type) ?? 'OTHER';
  let localUploadPath: string | null = null;

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot add transaction documents' });
    }

    const originalName = sanitizeFileName(req.file.originalname || `transaction-document-${Date.now()}`);
    const ext = path.extname(originalName) || '.bin';
    const base = path.basename(originalName, ext) || 'transaction-document';
    const uniqueName = `${base}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;

    let documentUrl: string;
    let previewUrl: string | null = null;

    if (storageConfig.localUploadsEnabled) {
      await mkdir(transactionDocumentsDir, { recursive: true });
      const absolutePath = path.join(transactionDocumentsDir, uniqueName);
      await writeFile(absolutePath, req.file.buffer);
      localUploadPath = absolutePath;
      documentUrl = `/uploads/documents/${uniqueName}`;
      previewUrl = documentUrl;
    } else {
      const { publicUrl } = await uploadToGcs(req.file.buffer, uniqueName, 'documents', req.file.mimetype);
      documentUrl = publicUrl;
      previewUrl = publicUrl;
    }

    const insert = await pool.query<{ id: string }>(
      `INSERT INTO migration.transaction_documents (
         transaction_id,
         source_document_id,
         source_transaction_document_type_id,
         transaction_document_type,
         file_name,
         document_url,
         preview_url,
         created_at,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       RETURNING id::text`,
      [id, sourceDocumentId, sourceDocumentTypeId, documentType, originalName, documentUrl, previewUrl]
    );

    return res.status(201).json({ id: insert.rows[0].id, file_name: originalName, document_url: documentUrl, preview_url: previewUrl });
  } catch (error) {
    if (localUploadPath) {
      await unlink(localUploadPath).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/documents', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  const fileName = toText(req.body?.file_name);
  const documentUrl = toText(req.body?.document_url);
  const previewUrl = toText(req.body?.preview_url);
  const sourceDocumentId = toText(req.body?.source_document_id);
  const sourceDocumentTypeId = toText(req.body?.source_transaction_document_type_id);
  const documentType = toText(req.body?.transaction_document_type);

  if (!documentUrl) {
    return res.status(400).json({ error: 'document_url is required.' });
  }

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot add transaction documents' });
    }

    const insert = await pool.query<{ id: string }>(
      `INSERT INTO migration.transaction_documents (
         transaction_id,
         source_document_id,
         source_transaction_document_type_id,
         transaction_document_type,
         file_name,
         document_url,
         preview_url,
         created_at,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       RETURNING id::text`,
      [id, sourceDocumentId, sourceDocumentTypeId, documentType, fileName, documentUrl, previewUrl]
    );

    return res.status(201).json({ id: insert.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.delete('/:id/documents/:documentId', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  const documentId = Number(req.params.documentId);
  if (!Number.isFinite(id) || !Number.isFinite(documentId)) {
    return res.status(400).json({ error: 'Invalid id.' });
  }

  try {
    await ensureTransactionAuxTables(pool);
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot delete transaction documents' });
    }

    const result = await pool.query(
      `UPDATE migration.transaction_documents
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND transaction_id = $2 AND deleted_at IS NULL`,
      [documentId, id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

type QuickSummaryCapLookupRow = {
  transaction_agent_id: string | null;
  associate_id: string | null;
  associate_team_id: string | null;
  associate_source_team_id: string | null;
  transaction_source_team_id: string | null;
  transaction_current_source_team_id: string | null;
  cap_remaining: string | null;
};

type TeamCapLookup = {
  cap_amount: number;
  cap_remaining: number;
  commission_split_to_team: number;
};

type AssociateCapLookup = {
  cap_amount: number;
  cap_remaining: number;
};

async function fetchAssociateCurrentCapRemainingByIds(db: Pool, associateIds: number[]): Promise<Map<number, AssociateCapLookup>> {
  if (associateIds.length === 0) return new Map<number, AssociateCapLookup>();

  const result = await db.query<{
    entity_id: string;
    cap_amount: string;
    commission_split_to_team: string;
    cap_remaining: string;
  }>(`
    WITH cap_base AS (
      SELECT
        ca.id AS associate_id,
        ca.cap_date,
        COALESCE(ca.manual_cap, false) AS manual_cap,
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
      WHERE ca.id = ANY($1::bigint[])
        AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND COALESCE(ca.team_id, 0) = 0
    ),
    cycle_windows AS (
      SELECT
        cb.associate_id,
        cb.cap_date,
        cb.manual_cap,
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
      WHERE tac.associate_id = ANY($1::bigint[])
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
      WHERE tac.associate_id = ANY($1::bigint[])
        AND tac.is_registered = true
        AND cw.next_cap_date IS NOT NULL
        AND tac.effective_reporting_date::date >= (cw.next_cap_date - INTERVAL '1 year')::date
        AND tac.effective_reporting_date::date < cw.next_cap_date
    ),
    associate_base AS (
      SELECT
        ca.id AS associate_id,
        GREATEST(COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
        GREATEST(
          COALESCE(
            lrc.cap_remaining,
            COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)
          ),
          0
        )::numeric(18,2) AS cap_remaining
      FROM migration.core_associates ca
      LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
      LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
      LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
      WHERE ca.id = ANY($1::bigint[])
        AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND COALESCE(ca.team_id, 0) = 0
    )
    SELECT associate_id::text AS entity_id, cap_amount::text, cap_remaining::text
    FROM associate_base
  `, [associateIds]);

  const lookup = new Map<number, AssociateCapLookup>();
  for (const row of result.rows) {
    const entityId = Number(row.entity_id);
    const capAmount = Number(row.cap_amount);
    const capRemaining = Number(row.cap_remaining);
    if (Number.isFinite(entityId) && Number.isFinite(capAmount) && Number.isFinite(capRemaining)) {
      lookup.set(entityId, {
        cap_amount: capAmount,
        cap_remaining: capRemaining,
      });
    }
  }
  return lookup;
}

async function fetchTeamCurrentCapRemainingByIds(db: Pool, teamIds: number[]): Promise<Map<number, TeamCapLookup>> {
  if (teamIds.length === 0) return new Map<number, TeamCapLookup>();

  const result = await db.query<{
    entity_id: string;
    cap_amount: string;
    commission_split_to_team: string;
    cap_remaining: string;
  }>(`
    WITH cap_base AS (
      SELECT
        ca.id AS associate_id,
        ca.cap_date,
        COALESCE(ca.manual_cap, false) AS manual_cap,
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
      WHERE ca.team_id = ANY($1::bigint[])
        AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ),
    cycle_windows AS (
      SELECT
        cb.associate_id,
        cb.cap_date,
        cb.manual_cap,
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
        t.id AS team_id,
        COALESCE(cw.next_cap_date, ca.cap_date, lc.cap_cycle_end_date) AS cap_date,
        GREATEST(COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0), 0)::numeric(18,2) AS cap_amount,
        GREATEST(
          COALESCE(
            lrc.cap_remaining,
            COALESCE(lrc.cap_amount, lc.cap_amount, cw.associate_cap_amount, 0)
          ),
          0
        )::numeric(18,2) AS cap_remaining,
        cw.manual_cap AS manual_cap
      FROM migration.core_associates ca
      LEFT JOIN migration.core_teams t ON t.id = ca.team_id
      LEFT JOIN cycle_windows cw ON cw.associate_id = ca.id
      LEFT JOIN latest_caps lc ON lc.associate_id = ca.id AND lc.rn = 1
      LEFT JOIN latest_cycle_registered_caps lrc ON lrc.associate_id = ca.id AND lrc.rn = 1
      WHERE ca.team_id = ANY($1::bigint[])
        AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
    ),
    latest_team_caps AS (
      SELECT
        tc.team_id,
        COALESCE(tc.team_cap_amount, 0)::numeric(18,2) AS team_cap_amount,
        GREATEST(COALESCE(tc.commission_split_to_team, 0), 0)::numeric(10,4) AS commission_split_to_team,
        ROW_NUMBER() OVER (
          PARTITION BY tc.team_id
          ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
        ) AS rn
      FROM migration.team_caps tc
      WHERE tc.team_id = ANY($1::bigint[])
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
        tmc.cap_date,
        GREATEST(COALESCE(ltc.team_cap_amount, 0), 0)::numeric(18,2) AS cap_amount
      FROM migration.core_teams t
      INNER JOIN team_member_counts tmc ON tmc.team_id = t.id
      LEFT JOIN latest_team_caps ltc ON ltc.team_id = t.id AND ltc.rn = 1
      WHERE t.id = ANY($1::bigint[])
        AND LOWER(TRIM(COALESCE(t.status_name, ''))) IN ('active', '1')
      GROUP BY t.id, tmc.cap_date, ltc.team_cap_amount
    ),
    team_achieved AS (
      SELECT
        tb.team_id,
        ROUND(COALESCE(SUM(tac.market_center_dollar), 0)::numeric, 2) AS cap_achieved
      FROM team_base tb
      INNER JOIN migration.core_associates ca ON ca.team_id = tb.team_id
      INNER JOIN migration.transaction_agent_calculations tac ON tac.associate_id = ca.id
      WHERE tac.is_registered = true
        AND LOWER(TRIM(COALESCE(ca.status_name, ''))) IN ('active', '1')
        AND tac.is_registered = true
        AND (
          tb.cap_date IS NULL OR (
            tac.effective_reporting_date::date >= (tb.cap_date - INTERVAL '1 year')::date
            AND tac.effective_reporting_date::date < tb.cap_date
          )
        )
      GROUP BY tb.team_id
    )
    SELECT
      tb.team_id::text AS entity_id,
      COALESCE(tb.cap_amount, 0)::numeric(18,2) AS cap_amount,
      COALESCE(ltc.commission_split_to_team, 0)::numeric(10,4) AS commission_split_to_team,
      GREATEST(
        COALESCE(tb.cap_amount, 0) - LEAST(COALESCE(tb.cap_amount, 0), COALESCE(ta.cap_achieved, 0)),
        0
      )::numeric(18,2) AS cap_remaining
    FROM team_base tb
    LEFT JOIN team_achieved ta ON ta.team_id = tb.team_id
    LEFT JOIN latest_team_caps ltc ON ltc.team_id = tb.team_id AND ltc.rn = 1
  `, [teamIds]);

  const lookup = new Map<number, TeamCapLookup>();
  for (const row of result.rows) {
    const entityId = Number(row.entity_id);
    const capAmount = Number(row.cap_amount);
    const commissionSplitToTeam = Number(row.commission_split_to_team);
    const capRemaining = Number(row.cap_remaining);
    if (Number.isFinite(entityId) && Number.isFinite(capAmount) && Number.isFinite(capRemaining)) {
      lookup.set(entityId, {
        cap_amount: capAmount,
        cap_remaining: capRemaining,
        commission_split_to_team: Number.isFinite(commissionSplitToTeam) ? commissionSplitToTeam : 0,
      });
    }
  }
  return lookup;
}

async function resolveTeamIdsBySourceTeamIds(db: Pool, sourceTeamIds: string[]): Promise<Map<string, number>> {
  if (sourceTeamIds.length === 0) return new Map<string, number>();

  const normalizedTokens = Array.from(new Set(sourceTeamIds.map((value) => normalizeKey(value)).filter(Boolean)));
  if (normalizedTokens.length === 0) return new Map<string, number>();

  const result = await db.query<{ team_id: string; source_team_id: string | null; team_name: string | null }>(
    `
    SELECT
      t.id::text AS team_id,
      t.source_team_id,
      t.name AS team_name
    FROM migration.core_teams t
    WHERE LOWER(TRIM(COALESCE(t.status_name, ''))) IN ('active', '1')
    `
  );

  const lookup = new Map<string, number>();
  for (const row of result.rows) {
    const teamId = Number(row.team_id);
    if (!Number.isFinite(teamId) || teamId <= 0) continue;

    const candidateTokens = [
      normalizeKey(row.source_team_id),
      normalizeKey(row.team_id),
      normalizeKey(row.team_name),
    ].filter((value): value is string => value.length > 0);

    for (const token of candidateTokens) {
      if (!normalizedTokens.includes(token)) continue;
      if (!lookup.has(token)) lookup.set(token, teamId);
    }
  }

  return lookup;
}

async function buildQuickSummaryDisplayCapRemainingLookup(db: Pool, rows: QuickSummaryCapLookupRow[]): Promise<Map<number, number>> {
  const sourceTeamIds = Array.from(new Set(
    rows
      .flatMap((row) => [
        row.transaction_current_source_team_id,
        row.transaction_source_team_id,
        row.associate_source_team_id,
      ])
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0)
  ));

  const sourceTeamLookup = await resolveTeamIdsBySourceTeamIds(db, sourceTeamIds);

  const associateIds = Array.from(new Set(
    rows
      .map((row) => Number(row.associate_id))
      .filter((value) => Number.isFinite(value) && value > 0)
  ));
  const teamIds = Array.from(new Set(
    rows.flatMap((row) => {
      const explicitTeamId = Number(row.associate_team_id);
      const resolvedByCurrentSource = sourceTeamLookup.get(normalizeKey(row.transaction_current_source_team_id));
      const resolvedByTransactionSource = sourceTeamLookup.get(normalizeKey(row.transaction_source_team_id));
      const resolvedByAssociateSource = sourceTeamLookup.get(normalizeKey(row.associate_source_team_id));
      return [explicitTeamId, resolvedByCurrentSource, resolvedByTransactionSource, resolvedByAssociateSource]
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    })
  ));

  const [associateLookup, teamLookup] = await Promise.all([
    fetchAssociateCurrentCapRemainingByIds(db, associateIds),
    fetchTeamCurrentCapRemainingByIds(db, teamIds),
  ]);

  const displayLookup = new Map<number, number>();
  for (const row of rows) {
    const transactionAgentId = Number(row.transaction_agent_id);
    if (!Number.isFinite(transactionAgentId)) continue;

    const explicitTeamId = Number(row.associate_team_id);
    const resolvedTeamId = Number.isFinite(explicitTeamId) && explicitTeamId > 0
      ? explicitTeamId
      : sourceTeamLookup.get(normalizeKey(row.transaction_current_source_team_id))
        ?? sourceTeamLookup.get(normalizeKey(row.transaction_source_team_id))
        ?? sourceTeamLookup.get(normalizeKey(row.associate_source_team_id))
        ?? null;
    const associateId = Number(row.associate_id);
    const teamCap = resolvedTeamId != null ? teamLookup.get(resolvedTeamId) ?? null : null;
    const hasApplicableTeamCap = teamCap != null && teamCap.cap_amount > 0;
    const associateCapRemaining = Number.isFinite(associateId) && associateId > 0
      ? associateLookup.get(associateId)?.cap_remaining ?? null
      : null;
    const fallbackCapRemaining = toNumber(row.cap_remaining) ?? 0;
    displayLookup.set(
      transactionAgentId,
      hasApplicableTeamCap
        ? teamCap.cap_remaining
        : (associateCapRemaining ?? fallbackCapRemaining)
    );
  }

  return displayLookup;
}

router.post('/preview-cap-remaining', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const associateIdsInput = Array.isArray(req.body?.associate_ids)
    ? req.body.associate_ids
    : [];
  const associateIds = Array.from(new Set(
    associateIdsInput
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value) && value > 0)
  ));

  if (associateIds.length === 0) {
    return res.json({ items: [] });
  }

  try {
    const associatesResult = await pool.query<{
      id: string;
      source_associate_id: string;
      team_id: string | null;
      associate_split_pct: string | null;
    }>(
      `
      SELECT
        ca.id::text AS id,
        ca.source_associate_id,
        COALESCE(ca.team_id, resolved_team.team_id)::text AS team_id,
        ca.agent_split::text AS associate_split_pct
      FROM migration.core_associates ca
      LEFT JOIN LATERAL (
        SELECT t.id AS team_id
        FROM migration.core_teams t
        WHERE NULLIF(TRIM(COALESCE(t.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(ca.source_team_id, '')), '')
           OR t.id = ca.team_id
        LIMIT 1
      ) resolved_team ON true
      WHERE ca.id = ANY($1::bigint[])
      `,
      [associateIds]
    );

    const associateLookup = new Map<number, { source_associate_id: string; team_id: number | null; associate_split_pct: number }>();
    for (const row of associatesResult.rows) {
      const associateId = Number(row.id);
      const teamId = Number(row.team_id);
      const associateSplitPct = toNumber(row.associate_split_pct);
      if (!Number.isFinite(associateId)) continue;
      associateLookup.set(associateId, {
        source_associate_id: row.source_associate_id,
        team_id: Number.isFinite(teamId) && teamId > 0 ? teamId : null,
        associate_split_pct: associateSplitPct ?? 0,
      });
    }

    const validAssociateIds = Array.from(associateLookup.keys());
    const teamIds = Array.from(new Set(
      validAssociateIds
        .map((associateId) => associateLookup.get(associateId)?.team_id ?? null)
        .filter((teamId): teamId is number => teamId != null && Number.isFinite(teamId) && teamId > 0)
    ));

    const [associateCapRemainingLookup, teamCapRemainingLookup] = await Promise.all([
      fetchAssociateCurrentCapRemainingByIds(pool, validAssociateIds),
      fetchTeamCurrentCapRemainingByIds(pool, teamIds),
    ]);

    const items = validAssociateIds.map((associateId) => {
      const associate = associateLookup.get(associateId)!;
      const teamCap = associate.team_id ? teamCapRemainingLookup.get(associate.team_id) ?? null : null;
      const hasApplicableTeamCap = teamCap != null && teamCap.cap_amount > 0;
      const associateCap = associateCapRemainingLookup.get(associateId) ?? { cap_amount: 0, cap_remaining: 0 };
      const capAmount = hasApplicableTeamCap ? teamCap.cap_amount : associateCap.cap_amount;
      const capRemaining = hasApplicableTeamCap ? teamCap.cap_remaining : associateCap.cap_remaining;

      return {
        associate_id: String(associateId),
        source_associate_id: associate.source_associate_id,
        team_id: associate.team_id != null ? String(associate.team_id) : null,
        associate_split_pct: associate.associate_split_pct.toFixed(4),
        team_commission_split_to_team: teamCap ? teamCap.commission_split_to_team.toFixed(4) : null,
        cap_amount: capAmount.toFixed(2),
        cap_remaining: capRemaining.toFixed(2),
      };
    });

    return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/:id/calculated-summary', resolvePermissions, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot view this transaction summary' });
    }

    const result = await pool.query(
      `
      SELECT
        tac.id::text,
        tac.transaction_id::text,
        tac.transaction_agent_id::text,
        tac.associate_id::text,
        COALESCE(ca.team_id, resolved_team.team_id)::text AS associate_team_id,
        ca.source_team_id AS associate_source_team_id,
        ct.source_team_id AS transaction_source_team_id,
        ct.current_source_team_id AS transaction_current_source_team_id,
        tac.source_associate_id,
        tac.is_outside_agent,
        tac.agent_name,
        tac.office_name,
        tac.transaction_side,
        tac.split_percentage::text,
        tac.variance_sale_list_pct::text,
        COALESCE(ct.sales_price, 0)::text AS sales_value_component,
        tac.transaction_gci_before_fees::text,
        tac.average_commission_pct::text,
        tac.production_royalties::text,
        tac.growth_share::text,
        tac.total_pr_and_gs::text,
        tac.gci_after_fees_excl_vat::text,
        tac.associate_split_pct::text,
        tac.market_center_split_pct::text,
        tac.associate_dollar::text,
        COALESCE(team_cap.team_cap_amount, tac.cap_amount)::text AS cap_amount,
        tac.cap_contribution::text,
        COALESCE(team_cap.team_cap_remaining, tac.cap_remaining)::text AS cap_remaining,
        tac.team_dollar::text,
        tac.market_center_dollar::text,
        tac.cap_cycle_start_date::text,
        tac.cap_cycle_end_date::text,
        tac.effective_reporting_date::text,
        tac.is_registered
      FROM migration.transaction_agent_calculations tac
      LEFT JOIN migration.core_transactions ct ON ct.id = tac.transaction_id
      LEFT JOIN migration.core_associates ca ON ca.id = tac.associate_id
      LEFT JOIN LATERAL (
        SELECT t.id AS team_id
        FROM migration.core_teams t
        WHERE NULLIF(TRIM(COALESCE(t.source_team_id, '')), '') = NULLIF(TRIM(COALESCE(ct.current_source_team_id, ct.source_team_id, ca.source_team_id, '')), '')
           OR t.id = ca.team_id
        LIMIT 1
      ) resolved_team ON true
      LEFT JOIN LATERAL (
        WITH team_scope AS (
          SELECT
            COALESCE(ca.team_id, resolved_team.team_id) AS team_id
        ),
        team_anchor AS (
          SELECT
            ts.team_id,
            (
              SELECT MIN(ca2.cap_date)::date
              FROM migration.core_associates ca2
              WHERE ca2.team_id = ts.team_id
                AND LOWER(TRIM(COALESCE(ca2.status_name, ''))) IN ('active', '1')
            ) AS cap_date
          FROM team_scope ts
        ),
        team_cycle AS (
          SELECT
            ta.team_id,
            CASE
              WHEN ta.cap_date IS NULL THEN NULL::date
              ELSE make_date(
                EXTRACT(YEAR FROM CURRENT_DATE)::int,
                EXTRACT(MONTH FROM ta.cap_date)::int,
                EXTRACT(DAY FROM ta.cap_date)::int
              )
            END AS anniversary_this_year
          FROM team_anchor ta
        ),
        team_cycle_window AS (
          SELECT
            tc.team_id,
            CASE
              WHEN tc.anniversary_this_year IS NULL THEN NULL::date
              WHEN tc.anniversary_this_year >= CURRENT_DATE THEN tc.anniversary_this_year
              ELSE (tc.anniversary_this_year + INTERVAL '1 year')::date
            END AS next_cap_date
          FROM team_cycle tc
        ),
        latest_team_cap AS (
          SELECT
            GREATEST(COALESCE(tc.team_cap_amount, 0), 0)::numeric(18,2) AS team_cap_amount
          FROM migration.team_caps tc
          INNER JOIN team_cycle_window tw ON tw.team_id = tc.team_id
          ORDER BY tc.cap_year DESC NULLS LAST, tc.id DESC
          LIMIT 1
        ),
        team_achieved AS (
          SELECT
            ROUND(COALESCE(SUM(tac2.market_center_dollar), 0)::numeric, 2) AS cap_achieved
          FROM migration.core_associates ca3
          INNER JOIN migration.transaction_agent_calculations tac2 ON tac2.associate_id = ca3.id
          INNER JOIN team_cycle_window tw ON tw.team_id = ca3.team_id
          WHERE tac2.is_registered = true
            AND (
              tw.next_cap_date IS NULL
              OR (
                tac2.effective_reporting_date::date >= (tw.next_cap_date - INTERVAL '1 year')::date
                AND tac2.effective_reporting_date::date < tw.next_cap_date
              )
            )
            AND (
              tac2.effective_reporting_date::date < tac.effective_reporting_date::date
              OR (
                tac2.effective_reporting_date::date = tac.effective_reporting_date::date
                AND tac2.transaction_id <= tac.transaction_id
              )
            )
        )
        SELECT
          ltc.team_cap_amount,
          GREATEST(
            ltc.team_cap_amount - LEAST(ltc.team_cap_amount, COALESCE(ta.cap_achieved, 0)),
            0
          )::numeric(18,2) AS team_cap_remaining
        FROM team_cycle_window tw
        LEFT JOIN latest_team_cap ltc ON true
        LEFT JOIN team_achieved ta ON true
        WHERE tw.team_id IS NOT NULL
      ) team_cap ON true
      WHERE tac.transaction_id = $1
      ORDER BY tac.id ASC
      `,
      [id]
    );

    if (result.rows.length === 0) {
      const fallbackSource = await pool.query<{
        transaction_id: string;
        transaction_number: string | null;
        transaction_status: string | null;
        transaction_type: string | null;
        market_center_name: string | null;
        sales_price: string | null;
        list_price: string | null;
        total_gci: string | null;
        transaction_agent_id: string;
        associate_id: string | null;
        source_associate_id: string | null;
        agent_name: string | null;
        agent_role: string | null;
        split_percentage: string | null;
        associate_split_pct: string | null;
        associate_team_id: string | null;
      }>(
        `
        SELECT
          ct.id::text AS transaction_id,
          ct.transaction_number,
          ct.transaction_status,
          ct.transaction_type,
          COALESCE(NULLIF(TRIM(ct.market_center_name), ''), mc.name) AS market_center_name,
          ct.sales_price::text AS sales_price,
          ct.list_price::text AS list_price,
          ct.total_gci::text AS total_gci,
          ta.id::text AS transaction_agent_id,
          ta.associate_id::text AS associate_id,
          ta.source_associate_id,
          COALESCE(NULLIF(TRIM(ca.full_name), ''), NULLIF(TRIM(ta.agent_name), ''), ta.source_associate_id) AS agent_name,
          COALESCE(NULLIF(TRIM(ta.agent_role), ''), NULLIF(TRIM(ct.transaction_type), ''), 'Other') AS agent_role,
          ta.split_percentage::text AS split_percentage,
          ca.agent_split::text AS associate_split_pct,
          COALESCE(ca.team_id, 0)::text AS associate_team_id
        FROM migration.core_transactions ct
        LEFT JOIN migration.core_market_centers mc ON mc.id = ct.primary_market_center_id
        INNER JOIN migration.transaction_agents ta ON ta.transaction_id = ct.id
        LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
        WHERE ct.id = $1
        ORDER BY ta.sort_order ASC NULLS LAST, ta.id ASC
        `,
        [id]
      );

      if (fallbackSource.rows.length > 0) {
        const totalGci = Math.max(toNumber(fallbackSource.rows[0].total_gci) ?? 0, 0);
        const salesPrice = Math.max(toNumber(fallbackSource.rows[0].sales_price) ?? 0, 0);
        const listPrice = Math.max(toNumber(fallbackSource.rows[0].list_price) ?? 0, 0);
        const variancePct = listPrice > 0 ? ((salesPrice - listPrice) / listPrice) * 100 : 0;

        const splitSum = fallbackSource.rows.reduce((sum, row) => sum + Math.max(toNumber(row.split_percentage) ?? 0, 0), 0);

        const associateIds = Array.from(new Set(
          fallbackSource.rows
            .map((row) => Number(row.associate_id))
            .filter((value) => Number.isFinite(value) && value > 0)
        ));

        const teamIds = Array.from(new Set(
          fallbackSource.rows
            .map((row) => Number(row.associate_team_id))
            .filter((value) => Number.isFinite(value) && value > 0)
        ));

        const [associateCapLookup, teamCapLookup] = await Promise.all([
          fetchAssociateCurrentCapRemainingByIds(pool, associateIds),
          fetchTeamCurrentCapRemainingByIds(pool, teamIds),
        ]);

        const fallbackItems = fallbackSource.rows.map((row, index) => {
          const baseSplit = Math.max(toNumber(row.split_percentage) ?? 0, 0);
          const splitPercentage = normalizeAgentSplitPct(baseSplit, splitSum, fallbackSource.rows.length);
          const splitRatio = splitPercentage / 100;
          const transactionGciBeforeFees = roundMoney(totalGci * splitRatio);
          const productionRoyalties = roundMoney(transactionGciBeforeFees * 0.06);
          const growthShare = roundMoney(transactionGciBeforeFees * 0.02);
          const totalPrAndGs = roundMoney(productionRoyalties + growthShare);
          const gciAfterFeesExclVat = roundMoney(transactionGciBeforeFees * 0.92);

          const roleNormalized = (row.agent_role ?? '').trim().toLowerCase();
          const isOutsideAgent = roleNormalized.includes('outside');
          const associateId = Number(row.associate_id);
          const teamId = Number(row.associate_team_id);
          const isTeamTransaction = Number.isFinite(teamId) && teamId > 0;

          const associateCap = Number.isFinite(associateId) && associateId > 0
            ? associateCapLookup.get(associateId) ?? { cap_amount: 0, cap_remaining: 0 }
            : { cap_amount: 0, cap_remaining: 0 };
          const teamCap = isTeamTransaction ? teamCapLookup.get(teamId) ?? null : null;

          const configuredTeamSplitPct = normalizeTeamSplitPct(teamCap?.commission_split_to_team ?? 0);
          const associateSplitPct = isOutsideAgent
            ? 100
            : (isTeamTransaction && configuredTeamSplitPct > 0)
              ? configuredTeamSplitPct
              : normalizeAssociateSplitPct(toNumber(row.associate_split_pct) ?? 0);
          const marketCenterSplitPct = Math.max(100 - associateSplitPct, 0);

          const associateDollarPreCap = roundMoney(gciAfterFeesExclVat * (associateSplitPct / 100));
          const marketCenterDollarPreCap = roundMoney(gciAfterFeesExclVat * (marketCenterSplitPct / 100));

          const capAmount = teamCap != null && teamCap.cap_amount > 0 ? teamCap.cap_amount : associateCap.cap_amount;
          const capRemaining = teamCap != null && teamCap.cap_amount > 0 ? teamCap.cap_remaining : associateCap.cap_remaining;

          let adjustedAssociateDollar = isTeamTransaction ? 0 : associateDollarPreCap;
          let adjustedTeamDollar = isTeamTransaction ? associateDollarPreCap : 0;
          let adjustedMarketCenterDollar = isOutsideAgent ? 0 : marketCenterDollarPreCap;
          let adjustedCapContribution = 0;

          if (!isOutsideAgent && adjustedMarketCenterDollar > 0) {
            if (capRemaining <= 0) {
              const overflow = adjustedMarketCenterDollar;
              adjustedMarketCenterDollar = 0;
              if (isTeamTransaction) {
                adjustedTeamDollar = roundMoney(adjustedTeamDollar + overflow);
              } else {
                adjustedAssociateDollar = roundMoney(adjustedAssociateDollar + overflow);
              }
            } else if (adjustedMarketCenterDollar > capRemaining) {
              const overflow = roundMoney(adjustedMarketCenterDollar - capRemaining);
              adjustedMarketCenterDollar = roundMoney(capRemaining);
              adjustedCapContribution = adjustedMarketCenterDollar;
              if (isTeamTransaction) {
                adjustedTeamDollar = roundMoney(adjustedTeamDollar + overflow);
              } else {
                adjustedAssociateDollar = roundMoney(adjustedAssociateDollar + overflow);
              }
            } else {
              adjustedCapContribution = adjustedMarketCenterDollar;
            }
          }

          const toMoneyText = (value: number): string => value.toFixed(2);
          const salesComponent = roundMoney(salesPrice * splitRatio);
          const avgCommPct = salesComponent > 0 ? roundMoney((transactionGciBeforeFees / salesComponent) * 100) : 0;

          return {
            id: `fallback-${row.transaction_agent_id}`,
            transaction_id: row.transaction_id,
            transaction_agent_id: row.transaction_agent_id,
            associate_id: row.associate_id,
            source_associate_id: row.source_associate_id,
            is_outside_agent: isOutsideAgent,
            agent_name: row.agent_name,
            office_name: row.market_center_name,
            transaction_side: row.agent_role ?? row.transaction_type,
            split_percentage: toMoneyText(splitPercentage),
            variance_sale_list_pct: toMoneyText(variancePct),
            transaction_gci_before_fees: toMoneyText(transactionGciBeforeFees),
            average_commission_pct: toMoneyText(avgCommPct),
            production_royalties: toMoneyText(productionRoyalties),
            growth_share: toMoneyText(growthShare),
            total_pr_and_gs: toMoneyText(totalPrAndGs),
            gci_after_fees_excl_vat: toMoneyText(gciAfterFeesExclVat),
            associate_split_pct: toMoneyText(associateSplitPct),
            market_center_split_pct: toMoneyText(marketCenterSplitPct),
            associate_dollar: toMoneyText(adjustedAssociateDollar),
            cap_amount: toMoneyText(Math.max(capAmount, 0)),
            cap_contribution: toMoneyText(Math.max(adjustedCapContribution, 0)),
            cap_remaining: toMoneyText(Math.max(capRemaining, 0)),
            current_cap_remaining: toMoneyText(Math.max(capRemaining, 0)),
            display_cap_remaining: toMoneyText(Math.max(capRemaining, 0)),
            team_dollar: toMoneyText(adjustedTeamDollar),
            market_center_dollar: toMoneyText(adjustedMarketCenterDollar),
            cap_cycle_start_date: null,
            cap_cycle_end_date: null,
            effective_reporting_date: null,
            is_registered: false,
            sort_index: index,
          };
        });

        return res.json({ items: fallbackItems });
      }
    }

      const toMoneyText = (value: number): string => value.toFixed(2);

      const displayCapRemainingLookup = await buildQuickSummaryDisplayCapRemainingLookup(
        pool,
        result.rows as QuickSummaryCapLookupRow[]
      );

      const items = result.rows.map((row) => {
        const transactionAgentId = Number(row.transaction_agent_id);
        const transactionCapRemaining = row.cap_remaining;
        const displayCapRemainingValue = Number.isFinite(transactionAgentId)
          ? displayCapRemainingLookup.get(transactionAgentId)
          : null;
        const displayCapRemaining = displayCapRemainingValue == null
          ? transactionCapRemaining
          : displayCapRemainingValue.toFixed(2);

        const baseAssociateDollar = toNumber(row.associate_dollar) ?? 0;
        const baseTeamDollar = toNumber(row.team_dollar) ?? 0;
        const baseMarketCenterDollar = toNumber(row.market_center_dollar) ?? 0;
        const isTeamTransaction = [
          row.associate_team_id,
          row.associate_source_team_id,
          row.transaction_source_team_id,
          row.transaction_current_source_team_id,
        ].some((value) => toText(value) != null);
        const applicableCapRemaining = displayCapRemainingValue ?? (toNumber(transactionCapRemaining) ?? 0);

        let adjustedAssociateDollar = baseAssociateDollar;
        let adjustedTeamDollar = baseTeamDollar;
        let adjustedMarketCenterDollar = baseMarketCenterDollar;
        let adjustedCapContribution = toNumber(row.cap_contribution) ?? 0;

        if (applicableCapRemaining != null && baseMarketCenterDollar > 0) {
          if (applicableCapRemaining <= 0) {
            const overflow = baseMarketCenterDollar;
            adjustedMarketCenterDollar = 0;
            adjustedCapContribution = 0;
            if (isTeamTransaction) {
              adjustedTeamDollar += overflow;
            } else {
              adjustedAssociateDollar += overflow;
            }
          } else if (baseMarketCenterDollar > applicableCapRemaining) {
            const overflow = baseMarketCenterDollar - applicableCapRemaining;
            adjustedMarketCenterDollar = applicableCapRemaining;
            adjustedCapContribution = Math.min(adjustedCapContribution, applicableCapRemaining);
            if (isTeamTransaction) {
              adjustedTeamDollar += overflow;
            } else {
              adjustedAssociateDollar += overflow;
            }
          }
        }

        return {
          ...row,
          associate_dollar: toMoneyText(adjustedAssociateDollar),
          cap_contribution: toMoneyText(adjustedCapContribution),
          team_dollar: toMoneyText(adjustedTeamDollar),
          market_center_dollar: toMoneyText(adjustedMarketCenterDollar),
          transaction_cap_remaining: transactionCapRemaining,
          current_cap_remaining: displayCapRemaining,
          display_cap_remaining: displayCapRemaining,
        };
      });

      return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/cap-refresh/dry-run', resolvePermissions, async (req, res) => {
  if (!env.capRefresh.enabled) {
    return res.status(503).json(capRefreshDisabledResponse());
  }

  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  try {
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot refresh this transaction summary' });
    }

    const roleNames = await loadCapRefreshRoleNames(pool, perms.associateDbId);
    const actor = buildCapRefreshActor(req, perms, roleNames);
    const result = await dryRunCapRefresh(pool, id);
    return res.json({ ...result, actor: { associateDbId: actor.associateDbId, roleNames: actor.roleNames } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/cap-refresh/apply', resolvePermissions, async (req, res) => {
  if (!env.capRefresh.enabled) {
    return res.status(503).json(capRefreshDisabledResponse());
  }

  if (!pool) {
    return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid transaction id.' });
  }

  const client = await pool.connect();
  try {
    const perms = req.permissions!;
    const hasAccess = await canAccessTransactionByScope(pool, id, perms);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you cannot refresh this transaction summary' });
    }

    const roleNames = await loadCapRefreshRoleNames(pool, perms.associateDbId);
    if (!canApplyCapRefresh(perms, roleNames)) {
      return res.status(403).json({ error: 'Permission denied: elevated cap refresh role required.' });
    }

    const actor = buildCapRefreshActor(req, perms, roleNames);
    await client.query('BEGIN');
    const result = await applyCapRefresh(client, actor, id);
    await client.query('COMMIT');
    return res.json(result);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

router.use((err: unknown, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, next: (error?: unknown) => void) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large. Maximum document size is 20MB.' });
      return;
    }
    res.status(400).json({ error: err.message || 'Invalid upload payload.' });
    return;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message || 'Upload failed.' });
    return;
  }

  next(err);
});

export default router;
