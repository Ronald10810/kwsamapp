import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { getTodayInAppTimeZone } from '../utils/timeZone.js';
const router = Router();
const pool = getOptionalPgPool();
let cachedAuthToken = null;
function normalizeText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeNumber(value) {
    if (typeof value !== 'string')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeDateOnly(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString().slice(0, 10);
}
function requireRegionalAdmin(req, res) {
    const perms = req.permissions;
    if (!perms || !perms.isRegionalAdmin || perms.scope !== 'GLOBAL') {
        res.status(403).json({
            error: 'Only Regional Admin users in Regional Admin context can submit to Frontdoor',
        });
        return false;
    }
    return true;
}
function ensureConfigured(res) {
    if (!env.frontdoor.enabled) {
        res.status(503).json({ error: 'Frontdoor submissions are disabled in this environment' });
        return false;
    }
    if (!env.frontdoor.baseUrl || !env.frontdoor.email || !env.frontdoor.password) {
        res.status(503).json({
            error: 'Frontdoor configuration is incomplete. Set FRONTDOOR_BASE_URL, FRONTDOOR_EMAIL and FRONTDOOR_PASSWORD.',
        });
        return false;
    }
    return true;
}
async function ensureFrontdoorTables(db) {
    await db.query(`
    CREATE TABLE IF NOT EXISTS migration.frontdoor_submission_runs (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      triggered_by_email TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      date_from DATE,
      date_to DATE,
      total_candidates INT NOT NULL DEFAULT 0,
      submitted_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      error_message TEXT
    )
  `);
    await db.query(`
    CREATE TABLE IF NOT EXISTS migration.frontdoor_transaction_agent_sync (
      id BIGSERIAL PRIMARY KEY,
      transaction_agent_id BIGINT NOT NULL UNIQUE REFERENCES migration.transaction_agents(id) ON DELETE CASCADE,
      transaction_id BIGINT NOT NULL REFERENCES migration.core_transactions(id) ON DELETE CASCADE,
      region_transaction_id TEXT NOT NULL UNIQUE,
      frontdoor_transaction_id TEXT,
      last_submission_run_id BIGINT REFERENCES migration.frontdoor_submission_runs(id) ON DELETE SET NULL,
      last_status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      last_payload_json JSONB,
      last_response_json JSONB,
      submitted_count INT NOT NULL DEFAULT 0,
      last_submitted_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await db.query(`
    CREATE TABLE IF NOT EXISTS migration.frontdoor_submission_run_items (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES migration.frontdoor_submission_runs(id) ON DELETE CASCADE,
      transaction_agent_id BIGINT REFERENCES migration.transaction_agents(id) ON DELETE SET NULL,
      transaction_id BIGINT REFERENCES migration.core_transactions(id) ON DELETE SET NULL,
      region_transaction_id TEXT,
      frontdoor_transaction_id TEXT,
      status TEXT NOT NULL,
      message TEXT,
      request_payload JSONB,
      response_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_frontdoor_submission_runs_started
      ON migration.frontdoor_submission_runs(started_at DESC)
  `);
    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_frontdoor_sync_transaction
      ON migration.frontdoor_transaction_agent_sync(transaction_id)
  `);
    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_frontdoor_run_items_run
      ON migration.frontdoor_submission_run_items(run_id)
  `);
}
function mapTransactionType(row) {
    const raw = `${row.transaction_type ?? ''} ${row.sale_type ?? ''}`.toLowerCase();
    if (raw.includes('commercial'))
        return 'Commercial';
    if (raw.includes('lease') || raw.includes('rent'))
        return 'Lease';
    if (raw.includes('referral') || (row.agent_role ?? '').toLowerCase().includes('outside'))
        return 'Referral';
    return 'Residential';
}
function mapTransactionSide(row) {
    const role = (row.agent_role ?? row.transaction_type ?? '').toLowerCase();
    if (role.includes('buyer') && role.includes('seller'))
        return 'Both';
    if (role.includes('buyer'))
        return 'Buyer';
    if (role.includes('seller'))
        return 'Seller';
    if (role.includes('both'))
        return 'Both';
    return 'Both';
}
function mapContractType(_row) {
    return 'Open';
}
function mapCountryCode(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!normalized)
        return 'ZA';
    if (normalized === 'za' || normalized === 'zaf' || normalized.includes('south africa'))
        return 'ZA';
    return normalized.slice(0, 2).toUpperCase() || 'ZA';
}
function pickSalesDate(row) {
    return (normalizeDateOnly(row.effective_reporting_date)
        ?? normalizeDateOnly(row.status_change_date)
        ?? normalizeDateOnly(row.transaction_date)
        ?? getTodayInAppTimeZone());
}
function buildRegionTransactionId(transactionAgentId) {
    return `KWSA-TA-${transactionAgentId}`;
}
function buildFrontdoorPayload(row) {
    const kwId = Number.parseInt(String(row.kwuid ?? ''), 10);
    if (!Number.isFinite(kwId) || kwId <= 0) {
        return { payload: null, error: 'Missing or invalid KWUID on associate' };
    }
    const orgId = Number.parseInt(String(row.frontdoor_org_id ?? ''), 10);
    if (!Number.isFinite(orgId) || orgId <= 0) {
        return { payload: null, error: 'Missing or invalid Frontdoor ID for market centre' };
    }
    const salesPrice = normalizeNumber(row.sales_price) ?? 0;
    if (salesPrice <= 0) {
        return { payload: null, error: 'Missing or invalid sales price' };
    }
    const splitPercentage = normalizeNumber(row.split_percentage);
    const commissionAmount = normalizeNumber(row.gci_after_fees_excl_vat)
        ?? (normalizeNumber(row.net_comm) !== null && splitPercentage !== null
            ? normalizeNumber(row.net_comm) * (splitPercentage / 100)
            : null);
    if (commissionAmount === null || commissionAmount < 0) {
        return { payload: null, error: 'Unable to derive agent commission amount' };
    }
    const agentCommission = splitPercentage ?? 100;
    const salesDate = pickSalesDate(row);
    const side = mapTransactionSide(row);
    const regionTransactionId = buildRegionTransactionId(row.transaction_agent_id);
    const safeAddress = normalizeText(row.address) ?? 'Address unavailable';
    const safeCity = normalizeText(row.city) ?? normalizeText(row.suburb) ?? 'Unknown';
    const safeState = normalizeText(row.province) ?? safeCity;
    const expectedPayment = {
        region_payment_id: `${regionTransactionId}-EXP-1`,
        amount: Number(commissionAmount.toFixed(2)),
        date: salesDate,
        agent_kw_id: kwId,
    };
    const actualPayment = {
        region_payment_id: `${regionTransactionId}-ACT-1`,
        amount: Number(commissionAmount.toFixed(2)),
        date: salesDate,
        agent_kw_id: kwId,
    };
    const payload = {
        region_transaction_id: regionTransactionId,
        org_id: orgId,
        transaction_type: mapTransactionType(row),
        sales_price: Number(salesPrice.toFixed(2)),
        sales_date: salesDate,
        transaction_side: side,
        contract_type: mapContractType(row),
        agent_commission: Number(agentCommission.toFixed(4)),
        agent_commission_type: 'Percentage',
        currency_code: 'ZAR',
        primary_agent_kw_id: kwId,
        agents: [{ kw_id: kwId, role: side }],
        listing: {
            listing_number: normalizeText(row.listing_number),
            address: safeAddress,
            city: safeCity,
            state: safeState,
            country_code: mapCountryCode(row.country),
        },
        expected_payments: [expectedPayment],
        actual_payments: [actualPayment],
    };
    return { payload, error: null };
}
async function getFrontdoorToken() {
    if (cachedAuthToken && cachedAuthToken.expiresAtMs > Date.now() + 60000) {
        return cachedAuthToken.token;
    }
    const authResponse = await fetch(`${env.frontdoor.baseUrl}/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: env.frontdoor.email,
            password: env.frontdoor.password,
        }),
    });
    const authBody = (await authResponse.json().catch(() => ({})));
    const token = normalizeText(authBody.token) ?? normalizeText(authBody.access_token);
    if (!authResponse.ok || !token) {
        const detail = normalizeText(authBody.error) ?? normalizeText(authBody.message) ?? `HTTP ${authResponse.status}`;
        throw new Error(`Frontdoor authentication failed: ${detail}`);
    }
    const expiresInSec = authBody.expires_in ?? authBody.expiresIn ?? 3600;
    cachedAuthToken = {
        token,
        expiresAtMs: Date.now() + Math.max(120, expiresInSec) * 1000,
    };
    return token;
}
async function submitTransactionToFrontdoor(payload, frontdoorTransactionId) {
    const token = await getFrontdoorToken();
    const endpoint = frontdoorTransactionId
        ? `${env.frontdoor.baseUrl}/api/v2/transaction/${encodeURIComponent(frontdoorTransactionId)}/update`
        : `${env.frontdoor.baseUrl}/api/v2/transaction/create`;
    const method = frontdoorTransactionId ? 'update' : 'create';
    const submissionResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });
    const responseBody = (await submissionResponse.json().catch(() => ({})));
    if (!submissionResponse.ok) {
        const message = normalizeText(String(responseBody.message ?? responseBody.error ?? '')) ?? `HTTP ${submissionResponse.status}`;
        throw new Error(`Frontdoor ${method} failed: ${message}`);
    }
    const receivedId = normalizeText(String(responseBody.id ?? responseBody.transaction_id ?? responseBody.region_transaction_id ?? ''));
    return {
        frontdoorTransactionId: receivedId ?? frontdoorTransactionId,
        response: responseBody,
        method,
    };
}
async function fetchCandidates(db, options) {
    const whereParts = [
        `LOWER(TRIM(COALESCE(ct.transaction_status, ''))) = 'registered'`,
    ];
    const params = [];
    if (typeof options.transactionId === 'number') {
        params.push(options.transactionId);
        whereParts.push(`ct.id = $${params.length}`);
    }
    if (options.dateFrom) {
        params.push(options.dateFrom);
        whereParts.push(`COALESCE(tac.effective_reporting_date, ct.status_change_date::date, ct.transaction_date::date) >= $${params.length}::date`);
    }
    if (options.dateTo) {
        params.push(options.dateTo);
        whereParts.push(`COALESCE(tac.effective_reporting_date, ct.status_change_date::date, ct.transaction_date::date) <= $${params.length}::date`);
    }
    let limitSql = '';
    if (typeof options.limit === 'number' && options.limit > 0) {
        params.push(options.limit);
        limitSql = `LIMIT $${params.length}`;
    }
    const result = await db.query(`
    SELECT
      ta.id::text AS transaction_agent_id,
      ct.id::text AS transaction_id,
      ca.full_name AS associate_name,
      COALESCE(mc_assoc.name, mc_tx.name) AS market_center_name,
      ct.source_transaction_id,
      ct.transaction_number,
      ct.transaction_status,
      ct.transaction_type,
      ct.sale_type,
      ta.agent_role,
      ta.split_percentage::text,
      ct.sales_price::text,
      ct.net_comm::text,
      ct.source_listing_id,
      ct.listing_number,
      ct.address,
      ct.suburb,
      ct.city,
      cl.province,
      cl.country,
      ct.status_change_date::text,
      ct.transaction_date::text,
      tac.effective_reporting_date::text,
      tac.gci_after_fees_excl_vat::text,
      ca.kwuid,
      COALESCE(mc_assoc.frontdoor_id, mc_tx.frontdoor_id) AS frontdoor_org_id
    FROM migration.transaction_agents ta
    JOIN migration.core_transactions ct
      ON ct.id = ta.transaction_id
    LEFT JOIN migration.transaction_agent_calculations tac
      ON tac.transaction_agent_id = ta.id
    LEFT JOIN migration.core_associates ca
      ON ca.id = ta.associate_id
    LEFT JOIN migration.core_market_centers mc_assoc
      ON mc_assoc.source_market_center_id = ca.source_market_center_id
    LEFT JOIN migration.core_market_centers mc_tx
      ON mc_tx.id = ct.primary_market_center_id
    LEFT JOIN migration.core_listings cl
      ON cl.source_listing_id = ct.source_listing_id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY COALESCE(tac.effective_reporting_date, ct.status_change_date::date, ct.transaction_date::date) ASC, ta.id ASC
    ${limitSql}
    `, params);
    return result.rows;
}
async function createRun(db, mode, triggeredByEmail, dateFrom, dateTo) {
    const result = await db.query(`
    INSERT INTO migration.frontdoor_submission_runs (mode, triggered_by_email, date_from, date_to)
    VALUES ($1, $2, $3, $4)
    RETURNING id::text
    `, [mode, triggeredByEmail, dateFrom, dateTo]);
    return result.rows[0]?.id ?? '';
}
async function completeRun(db, runId, counters, status, errorMessage) {
    await db.query(`
    UPDATE migration.frontdoor_submission_runs
       SET completed_at = NOW(),
           status = $2,
           total_candidates = $3,
           submitted_count = $4,
           failed_count = $5,
           skipped_count = $6,
           error_message = $7
     WHERE id = $1
    `, [runId, status, counters.total, counters.submitted, counters.failed, counters.skipped, errorMessage]);
}
async function writeRunItem(db, input) {
    await db.query(`
    INSERT INTO migration.frontdoor_submission_run_items (
      run_id,
      transaction_agent_id,
      transaction_id,
      region_transaction_id,
      frontdoor_transaction_id,
      status,
      message,
      request_payload,
      response_payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
    `, [
        input.runId,
        input.transactionAgentId,
        input.transactionId,
        input.regionTransactionId,
        input.frontdoorTransactionId,
        input.status,
        input.message,
        JSON.stringify(input.requestPayload ?? null),
        JSON.stringify(input.responsePayload ?? null),
    ]);
}
async function loadSyncState(db, transactionAgentId) {
    const result = await db.query(`
    SELECT id::text, frontdoor_transaction_id
      FROM migration.frontdoor_transaction_agent_sync
     WHERE transaction_agent_id = $1
     LIMIT 1
    `, [transactionAgentId]);
    return result.rows[0] ?? null;
}
async function upsertSyncState(db, input) {
    await db.query(`
    INSERT INTO migration.frontdoor_transaction_agent_sync (
      transaction_agent_id,
      transaction_id,
      region_transaction_id,
      frontdoor_transaction_id,
      last_submission_run_id,
      last_status,
      last_error,
      last_payload_json,
      last_response_json,
      submitted_count,
      last_submitted_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8::jsonb,
      $9::jsonb,
      CASE WHEN $6 = 'submitted' THEN 1 ELSE 0 END,
      CASE WHEN $6 = 'submitted' THEN NOW() ELSE NULL END,
      NOW()
    )
    ON CONFLICT (transaction_agent_id)
    DO UPDATE SET
      transaction_id = EXCLUDED.transaction_id,
      region_transaction_id = EXCLUDED.region_transaction_id,
      frontdoor_transaction_id = COALESCE(EXCLUDED.frontdoor_transaction_id, migration.frontdoor_transaction_agent_sync.frontdoor_transaction_id),
      last_submission_run_id = EXCLUDED.last_submission_run_id,
      last_status = EXCLUDED.last_status,
      last_error = EXCLUDED.last_error,
      last_payload_json = EXCLUDED.last_payload_json,
      last_response_json = EXCLUDED.last_response_json,
      submitted_count = migration.frontdoor_transaction_agent_sync.submitted_count
        + CASE WHEN EXCLUDED.last_status = 'submitted' THEN 1 ELSE 0 END,
      last_submitted_at = CASE
        WHEN EXCLUDED.last_status = 'submitted' THEN NOW()
        ELSE migration.frontdoor_transaction_agent_sync.last_submitted_at
      END,
      updated_at = NOW()
    `, [
        input.transactionAgentId,
        input.transactionId,
        input.regionTransactionId,
        input.frontdoorTransactionId,
        input.runId,
        input.status,
        input.errorMessage,
        JSON.stringify(input.payload ?? null),
        JSON.stringify(input.response ?? null),
    ]);
}
async function processCandidates(db, runId, candidates) {
    const counters = {
        total: candidates.length,
        submitted: 0,
        failed: 0,
        skipped: 0,
    };
    for (const candidate of candidates) {
        const regionTransactionId = buildRegionTransactionId(candidate.transaction_agent_id);
        const build = buildFrontdoorPayload(candidate);
        if (!build.payload) {
            const message = build.error ?? 'Payload mapping failed';
            counters.skipped += 1;
            await writeRunItem(db, {
                runId,
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                regionTransactionId,
                frontdoorTransactionId: null,
                status: 'skipped',
                message,
                requestPayload: null,
                responsePayload: null,
            });
            await upsertSyncState(db, {
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                runId,
                regionTransactionId,
                frontdoorTransactionId: null,
                status: 'skipped',
                errorMessage: message,
                payload: null,
                response: { reason: message },
            });
            continue;
        }
        try {
            const existingSync = await loadSyncState(db, candidate.transaction_agent_id);
            const submitted = await submitTransactionToFrontdoor(build.payload, existingSync?.frontdoor_transaction_id ?? null);
            counters.submitted += 1;
            await writeRunItem(db, {
                runId,
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                regionTransactionId,
                frontdoorTransactionId: submitted.frontdoorTransactionId,
                status: 'submitted',
                message: `Frontdoor ${submitted.method} succeeded`,
                requestPayload: build.payload,
                responsePayload: submitted.response,
            });
            await upsertSyncState(db, {
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                runId,
                regionTransactionId,
                frontdoorTransactionId: submitted.frontdoorTransactionId,
                status: 'submitted',
                errorMessage: null,
                payload: build.payload,
                response: submitted.response,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Frontdoor submission failed';
            counters.failed += 1;
            await writeRunItem(db, {
                runId,
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                regionTransactionId,
                frontdoorTransactionId: null,
                status: 'failed',
                message,
                requestPayload: build.payload,
                responsePayload: { error: message },
            });
            await upsertSyncState(db, {
                transactionAgentId: candidate.transaction_agent_id,
                transactionId: candidate.transaction_id,
                runId,
                regionTransactionId,
                frontdoorTransactionId: null,
                status: 'failed',
                errorMessage: message,
                payload: build.payload,
                response: { error: message },
            });
        }
    }
    return counters;
}
router.use(resolvePermissions);
/**
 * GET /api/frontdoor-submissions/monthly/preview
 * Returns a dry-run count of registered agent-transactions that fall within
 * the requested date range. No submissions are made.
 */
router.get('/monthly/preview', async (req, res) => {
    if (!pool) {
        res.status(500).json({ error: 'Database not configured' });
        return;
    }
    if (!requireRegionalAdmin(req, res)) {
        return;
    }
    const today = getTodayInAppTimeZone();
    const defaultDateFrom = `${today.slice(0, 8)}01`;
    const rawFrom = String(req.query.date_from ?? '').trim() || defaultDateFrom;
    const rawTo = String(req.query.date_to ?? '').trim() || today;
    const includeDetails = String(req.query.include_details ?? '').trim() === '1';
    const detailLimitInput = Number.parseInt(String(req.query.limit ?? ''), 10);
    const detailLimit = Number.isFinite(detailLimitInput) && detailLimitInput > 0
        ? Math.min(detailLimitInput, 1000)
        : 250;
    const dateFrom = normalizeDateOnly(rawFrom);
    const dateTo = normalizeDateOnly(rawTo);
    if (!dateFrom || !dateTo) {
        res.status(400).json({ error: 'date_from and date_to must be valid dates (YYYY-MM-DD)' });
        return;
    }
    if (dateFrom > dateTo) {
        res.status(400).json({ error: 'date_from must be before or equal to date_to' });
        return;
    }
    const fetchLimit = includeDetails ? detailLimit : 5000;
    const candidates = await fetchCandidates(pool, { dateFrom, dateTo, limit: fetchLimit });
    // Break down mappable vs skippable so the user understands what will succeed.
    let mappable = 0;
    let unmappable = 0;
    const items = [];
    for (const c of candidates) {
        const { payload, error } = buildFrontdoorPayload(c);
        if (payload) {
            mappable += 1;
        }
        else {
            unmappable += 1;
        }
        if (includeDetails) {
            items.push({
                transaction_agent_id: c.transaction_agent_id,
                transaction_id: c.transaction_id,
                transaction_number: c.transaction_number,
                associate_name: c.associate_name,
                market_center_name: c.market_center_name,
                listing_number: c.listing_number,
                sales_price: normalizeNumber(c.sales_price) ?? 0,
                effective_reporting_date: pickSalesDate(c),
                transaction_type: c.transaction_type,
                agent_role: c.agent_role,
                frontdoor_org_id: c.frontdoor_org_id,
                kwuid: c.kwuid,
                region_transaction_id: buildRegionTransactionId(c.transaction_agent_id),
                status: payload ? 'ready' : 'error',
                error,
                payload_preview: payload,
            });
        }
    }
    res.json({
        date_from: dateFrom,
        date_to: dateTo,
        total_candidates: candidates.length,
        ready_to_submit: mappable,
        will_be_skipped: unmappable,
        limit_applied: fetchLimit,
        details_included: includeDetails,
        items,
    });
});
router.post('/transaction/:transactionId', async (req, res) => {
    if (!pool) {
        res.status(500).json({ error: 'Database not configured' });
        return;
    }
    if (!requireRegionalAdmin(req, res)) {
        return;
    }
    if (!ensureConfigured(res)) {
        return;
    }
    const transactionId = Number.parseInt(String(req.params.transactionId ?? ''), 10);
    if (!Number.isFinite(transactionId) || transactionId <= 0) {
        res.status(400).json({ error: 'transactionId must be a valid numeric ID' });
        return;
    }
    await ensureFrontdoorTables(pool);
    const runId = await createRun(pool, 'single', req.user?.email ?? null, null, null);
    try {
        const candidates = await fetchCandidates(pool, { transactionId });
        if (candidates.length === 0) {
            const emptyCounters = { total: 0, submitted: 0, failed: 0, skipped: 0 };
            await completeRun(pool, runId, emptyCounters, 'completed', null);
            res.status(404).json({
                error: 'No registered agent transactions found for this transaction',
                run_id: runId,
            });
            return;
        }
        const counters = await processCandidates(pool, runId, candidates);
        await completeRun(pool, runId, counters, 'completed', null);
        res.json({
            run_id: runId,
            mode: 'single',
            transaction_id: transactionId,
            ...counters,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Frontdoor submission failed';
        const failedCounters = { total: 0, submitted: 0, failed: 0, skipped: 0 };
        await completeRun(pool, runId, failedCounters, 'failed', message);
        res.status(500).json({ error: message, run_id: runId });
    }
});
router.post('/monthly', async (req, res) => {
    if (!pool) {
        res.status(500).json({ error: 'Database not configured' });
        return;
    }
    if (!requireRegionalAdmin(req, res)) {
        return;
    }
    if (!ensureConfigured(res)) {
        return;
    }
    const body = (req.body ?? {});
    const today = getTodayInAppTimeZone();
    const defaultDateFrom = `${today.slice(0, 8)}01`;
    const dateFrom = normalizeDateOnly(body.date_from ?? defaultDateFrom);
    const dateTo = normalizeDateOnly(body.date_to ?? today);
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : 500;
    if (!dateFrom || !dateTo) {
        res.status(400).json({ error: 'date_from and date_to must be valid dates (YYYY-MM-DD)' });
        return;
    }
    if (dateFrom > dateTo) {
        res.status(400).json({ error: 'date_from must be before or equal to date_to' });
        return;
    }
    await ensureFrontdoorTables(pool);
    const runId = await createRun(pool, 'monthly', req.user?.email ?? null, dateFrom, dateTo);
    try {
        const candidates = await fetchCandidates(pool, {
            dateFrom,
            dateTo,
            limit,
        });
        const counters = await processCandidates(pool, runId, candidates);
        await completeRun(pool, runId, counters, 'completed', null);
        res.json({
            run_id: runId,
            mode: 'monthly',
            date_from: dateFrom,
            date_to: dateTo,
            limit,
            ...counters,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Frontdoor monthly submission failed';
        const failedCounters = { total: 0, submitted: 0, failed: 0, skipped: 0 };
        await completeRun(pool, runId, failedCounters, 'failed', message);
        res.status(500).json({ error: message, run_id: runId });
    }
});
export default router;
//# sourceMappingURL=frontdoorSubmissions.js.map