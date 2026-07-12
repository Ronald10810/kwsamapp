/**
 * Rentals API Routes
 * Handles the full Rentals module: register, participants, payment schedule, documents, audit log.
 * All routes require authentication via requireAuth (applied in index.ts).
 * Write operations require GLOBAL or MARKET_CENTRE scope.
 */
import { Router } from 'express';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { getOptionalPgPool } from '../config/db.js';
import { assertLocalUploadStorageEnabled, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { scheduleTransactionAgentRecompute } from '../services/transactionRecomputeQueue.js';
const router = Router();
const pool = getOptionalPgPool();
let rentalAddressSchemaEnsured = null;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toText(value) {
    if (typeof value !== 'string')
        return null;
    const t = value.trim();
    return t.length > 0 ? t : null;
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const t = value.trim();
        if (t === '')
            return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function toDateText(value) {
    const t = toText(value);
    if (!t)
        return null;
    const d = new Date(t);
    if (Number.isNaN(d.getTime()))
        return null;
    // Return as ISO date string (date only)
    return d.toISOString().slice(0, 10);
}
function toBoolean(value) {
    if (typeof value === 'boolean')
        return value;
    if (value === 1 || value === '1' || value === 'true')
        return true;
    return false;
}
function computeParticipantAllocations(participants, grossCommission, royalty, growthShare) {
    const computed = participants.map((p) => {
        const dealSplit = Math.max(0, toNumber(p.agent_deal_split) ?? 0);
        const mcSplit = Math.max(0, toNumber(p.market_center_split) ?? 0);
        const agentSplit = Math.max(0, toNumber(p.agent_split) ?? 0);
        const splitRatio = dealSplit / 100;
        const grossPerAgent = grossCommission * splitRatio;
        const coDollarPerAgent = grossPerAgent * (mcSplit / 100);
        const agentNetPerAgent = grossPerAgent * (agentSplit / 100);
        return {
            associate_id: toText(p.associate_id),
            associate_name: toText(p.associate_name),
            participant_role: toText(p.participant_role) ?? 'RENTAL_AGENT',
            agent_deal_split: dealSplit,
            market_center_split: mcSplit,
            agent_split: agentSplit,
            gross_commission_amount: grossPerAgent,
            company_dollar_amount: coDollarPerAgent,
            royalty_amount: royalty * splitRatio,
            growth_share_amount: growthShare * splitRatio,
            agent_net_amount: agentNetPerAgent,
            counts_toward_cap: toBoolean(p.counts_toward_cap),
        };
    });
    const totalCompanyDollar = computed.reduce((sum, item) => sum + item.company_dollar_amount, 0);
    const totalAgentNetAmount = computed.reduce((sum, item) => sum + item.agent_net_amount, 0);
    const rentalCountsTowardCap = computed.some((item) => item.counts_toward_cap);
    return { computed, totalCompanyDollar, totalAgentNetAmount, rentalCountsTowardCap };
}
function toDocumentType(value) {
    const allowed = new Set([
        'LEASE_AGREEMENT',
        'SIGNED_MANDATE',
        'PROOF_OF_PAYMENT',
        'LANDLORD_FICA',
        'TENANT_FICA',
        'INSPECTION_DOCUMENT',
        'DEPOSIT_PROOF',
        'OTHER',
    ]);
    const upper = (toText(value) ?? 'OTHER').toUpperCase();
    return allowed.has(upper) ? upper : 'OTHER';
}
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function extensionFromMimeType(mimeType) {
    const n = (mimeType ?? '').toLowerCase();
    if (n.includes('pdf'))
        return '.pdf';
    if (n.includes('msword'))
        return '.doc';
    if (n.includes('officedocument.wordprocessingml.document'))
        return '.docx';
    if (n.includes('png'))
        return '.png';
    if (n.includes('jpeg') || n.includes('jpg'))
        return '.jpg';
    return '.bin';
}
function decodeBase64File(input) {
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
async function storeRentalDocumentFile(file) {
    const content = decodeBase64File(file.content_base64);
    if (!content) {
        throw new Error('Invalid file payload. content_base64 is required.');
    }
    const originalName = sanitizeFileName(toText(file.file_name) ?? 'rental-document');
    const ext = path.extname(originalName) || extensionFromMimeType(file.mime_type);
    const base = path.basename(originalName, path.extname(originalName)) || 'rental-document';
    const normalizedFileName = `${base}${ext}`;
    if (storageConfig.backend === 'gcs') {
        const { publicUrl, objectName } = await uploadToGcs(content, normalizedFileName, 'rental-document', file.mime_type ?? 'application/octet-stream');
        return {
            fileUrl: publicUrl,
            storagePath: objectName,
            fileName: normalizedFileName,
        };
    }
    assertLocalUploadStorageEnabled();
    const subdir = 'rentals';
    const uploadDir = resolveLocalUploadDir(subdir);
    await mkdir(uploadDir, { recursive: true });
    const uniqueName = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const absolutePath = path.join(uploadDir, uniqueName);
    await writeFile(absolutePath, content);
    return {
        fileUrl: `/uploads/${subdir}/${uniqueName}`,
        storagePath: absolutePath,
        fileName: normalizedFileName,
    };
}
async function getNextRentalNumber(db) {
    // Self-heal environments where rentals table migration ran before sequence creation.
    await db.query(`CREATE SCHEMA IF NOT EXISTS app`);
    await db.query(`CREATE SEQUENCE IF NOT EXISTS app.rental_number_seq START 1 INCREMENT 1`);
    const result = await db.query(`SELECT nextval('app.rental_number_seq')::text AS nextval`);
    const seq = parseInt(result.rows[0]?.nextval ?? '1', 10);
    return `RNT${String(seq).padStart(5, '0')}`;
}
async function ensureRentalAddressColumns(db) {
    if (!rentalAddressSchemaEnsured) {
        rentalAddressSchemaEnsured = (async () => {
            await db.query(`
        ALTER TABLE IF EXISTS app.rentals
          ADD COLUMN IF NOT EXISTS landlord_country TEXT,
          ADD COLUMN IF NOT EXISTS landlord_province TEXT,
          ADD COLUMN IF NOT EXISTS landlord_city TEXT,
          ADD COLUMN IF NOT EXISTS landlord_suburb TEXT,
          ADD COLUMN IF NOT EXISTS landlord_street_number TEXT,
          ADD COLUMN IF NOT EXISTS landlord_street_name TEXT,
          ADD COLUMN IF NOT EXISTS tenant_country TEXT,
          ADD COLUMN IF NOT EXISTS tenant_province TEXT,
          ADD COLUMN IF NOT EXISTS tenant_city TEXT,
          ADD COLUMN IF NOT EXISTS tenant_suburb TEXT,
          ADD COLUMN IF NOT EXISTS tenant_street_number TEXT,
          ADD COLUMN IF NOT EXISTS tenant_street_name TEXT
      `);
            await db.query(`
        ALTER TABLE IF EXISTS app.rental_participants
          ADD COLUMN IF NOT EXISTS market_center_split NUMERIC(8,4) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS agent_split NUMERIC(8,4) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS agent_deal_split NUMERIC(8,4) DEFAULT 0
      `);
        })().catch((error) => {
            rentalAddressSchemaEnsured = null;
            throw error;
        });
    }
    await rentalAddressSchemaEnsured;
}
/** Generate payment schedule rows in memory based on rental settings */
function generatePaymentSchedule(rentalId, rentalType, frequency, startDate, endDate, paymentDueDay, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId) {
    const rows = [];
    if (rentalType === 'PROCUREMENT') {
        // Single once-off payment
        const dueDate = startDate ?? new Date().toISOString().slice(0, 10);
        rows.push({
            rental_id: rentalId,
            payment_sequence_number: 1,
            due_date: dueDate,
            period_start_date: dueDate,
            period_end_date: dueDate,
            expected_rental_amount: rentalAmount,
            expected_commission_amount: commissionAmount,
            gross_commission: grossCommission,
            company_dollar: companyDollar,
            royalty,
            growth_share: growthShare,
            agent_net_amount: agentNetAmount,
            payment_status: 'UPCOMING',
            created_by_user_id: createdByUserId,
        });
        return rows;
    }
    // MANAGEMENT — recurring schedule
    if (!startDate || !endDate)
        return rows;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        return rows;
    if (frequency === 'ONCE_OFF') {
        const dueDate = buildDueDate(start, paymentDueDay);
        rows.push(buildScheduleRow(rentalId, 1, dueDate, start, end, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId));
        return rows;
    }
    if (frequency === 'MONTHLY') {
        let seq = 1;
        let current = new Date(start.getFullYear(), start.getMonth(), 1);
        while (current.getTime() <= end.getTime()) {
            const periodStart = new Date(current);
            const periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0); // last day of month
            const dueDate = buildDueDate(current, paymentDueDay);
            if (new Date(dueDate).getTime() <= end.getTime()) {
                rows.push(buildScheduleRow(rentalId, seq, dueDate, periodStart, periodEnd, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId));
                seq++;
            }
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        }
        return rows;
    }
    if (frequency === 'WEEKLY') {
        let seq = 1;
        let current = new Date(start);
        while (current.getTime() <= end.getTime()) {
            const periodStart = new Date(current);
            const periodEnd = new Date(current);
            periodEnd.setDate(periodEnd.getDate() + 6);
            rows.push(buildScheduleRow(rentalId, seq, formatDate(current), periodStart, periodEnd, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId));
            current.setDate(current.getDate() + 7);
            seq++;
        }
        return rows;
    }
    if (frequency === 'DAILY') {
        let seq = 1;
        let current = new Date(start);
        while (current.getTime() <= end.getTime()) {
            rows.push(buildScheduleRow(rentalId, seq, formatDate(current), current, current, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId));
            current.setDate(current.getDate() + 1);
            seq++;
        }
        return rows;
    }
    if (frequency === 'YEARLY') {
        let seq = 1;
        let current = new Date(start);
        while (current.getTime() <= end.getTime()) {
            const periodStart = new Date(current);
            const periodEnd = new Date(current.getFullYear() + 1, current.getMonth(), current.getDate() - 1);
            const dueDate = buildDueDate(current, paymentDueDay);
            rows.push(buildScheduleRow(rentalId, seq, dueDate, periodStart, periodEnd, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId));
            current = new Date(current.getFullYear() + 1, current.getMonth(), current.getDate());
            seq++;
        }
        return rows;
    }
    return rows;
}
function buildDueDate(monthDate, dueDay) {
    if (!dueDay)
        return formatDate(monthDate);
    // Clamp to last day of month if dueDay exceeds month length
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const clamped = Math.min(dueDay, lastDay);
    return formatDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), clamped));
}
function formatDate(d) {
    return d.toISOString().slice(0, 10);
}
function buildScheduleRow(rentalId, seq, dueDate, periodStart, periodEnd, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, createdByUserId) {
    return {
        rental_id: rentalId,
        payment_sequence_number: seq,
        due_date: dueDate,
        period_start_date: formatDate(periodStart),
        period_end_date: formatDate(periodEnd),
        expected_rental_amount: rentalAmount,
        expected_commission_amount: commissionAmount,
        gross_commission: grossCommission,
        company_dollar: companyDollar,
        royalty,
        growth_share: growthShare,
        agent_net_amount: agentNetAmount,
        payment_status: 'UPCOMING',
        created_by_user_id: createdByUserId,
    };
}
/** Check if the current user has write access to a rental (by market centre) */
async function canWriteRental(db, rentalId, perms) {
    if (perms.scope === 'GLOBAL')
        return true;
    if (perms.scope === 'OWN')
        return false;
    const result = await db.query(`SELECT EXISTS (
       SELECT 1
         FROM app.rentals r
        WHERE r.id = $1
          AND (
            r.market_centre_id = $2
            OR EXISTS (
              SELECT 1
                FROM app.rental_participants rp
                JOIN migration.core_associates ca
                  ON ca.source_associate_id = rp.associate_id
               WHERE rp.rental_id = r.id
                 AND ca.source_market_center_id = $2
            )
          )
     ) AS has_access`, [rentalId, perms.marketCenterId]);
    return Boolean(result.rows[0]?.has_access);
}
function hasRentalAdminAccess(perms) {
    return perms.scope === 'GLOBAL' || perms.scope === 'MARKET_CENTRE';
}
function addMarketCentreRentalAccessFilter(whereClauses, params, marketCenterId, rentalAlias = 'r') {
    params.push(marketCenterId);
    const mcParam = `$${params.length}`;
    whereClauses.push(`(
    ${rentalAlias}.market_centre_id = ${mcParam}
    OR EXISTS (
      SELECT 1
      FROM app.rental_participants rp_mc
      JOIN migration.core_associates ca_mc
        ON ca_mc.source_associate_id = rp_mc.associate_id
      WHERE rp_mc.rental_id = ${rentalAlias}.id
        AND ca_mc.source_market_center_id = ${mcParam}
    )
  )`);
}
// ---------------------------------------------------------------------------
// Ensure payment statuses are up-to-date (DUE/OVERDUE) on read
// ---------------------------------------------------------------------------
async function refreshPaymentStatuses(db) {
    await db.query(`
    UPDATE app.rental_payment_schedule
    SET payment_status = CASE
          WHEN due_date = CURRENT_DATE THEN 'DUE'
          WHEN due_date < CURRENT_DATE THEN 'OVERDUE'
          ELSE 'UPCOMING'
        END,
        updated_at = NOW()
    WHERE payment_status NOT IN ('PAID', 'CANCELLED')
  `);
}
// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------
// GET /api/rentals — list rentals (paginated)
router.get('/', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const limit = Math.min(Math.max(Number(req.query.limit ?? 25), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const search = toText(req.query.search) ?? '';
    const statusFilter = toText(req.query.status) ?? '';
    const typeFilter = toText(req.query.type) ?? '';
    try {
        const perms = req.permissions;
        if (!hasRentalAdminAccess(perms)) {
            return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
        }
        const whereClauses = [];
        const params = [];
        // Scope filter
        if (perms.scope === 'MARKET_CENTRE') {
            addMarketCentreRentalAccessFilter(whereClauses, params, perms.marketCenterId, 'r');
        }
        if (search) {
            params.push(`%${search}%`);
            const p = `$${params.length}`;
            whereClauses.push(`(
        r.rental_number ILIKE ${p}
        OR r.listing_number ILIKE ${p}
        OR r.source_listing_id ILIKE ${p}
        OR r.property_address ILIKE ${p}
        OR r.suburb ILIKE ${p}
        OR r.city ILIKE ${p}
        OR r.landlord_name ILIKE ${p}
        OR r.landlord_surname_or_company ILIKE ${p}
        OR r.tenant_name ILIKE ${p}
        OR r.tenant_surname_or_company ILIKE ${p}
        OR r.market_centre_name ILIKE ${p}
      )`);
        }
        if (statusFilter) {
            params.push(statusFilter.toUpperCase());
            whereClauses.push(`r.rental_status = $${params.length}`);
        }
        if (typeFilter) {
            params.push(typeFilter.toUpperCase());
            whereClauses.push(`r.rental_type = $${params.length}`);
        }
        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const countParams = [...params];
        params.push(limit, offset);
        const [totalResult, dataResult] = await Promise.all([
            pool.query(`SELECT COUNT(*)::text AS total FROM app.rentals r ${where}`, countParams),
            pool.query(`SELECT r.*,
                COALESCE(json_agg(rp ORDER BY rp.id) FILTER (WHERE rp.id IS NOT NULL), '[]') AS participants
           FROM app.rentals r
           LEFT JOIN app.rental_participants rp ON rp.rental_id = r.id
           ${where}
           GROUP BY r.id
           ORDER BY r.created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
        ]);
        return res.json({
            total: parseInt(totalResult.rows[0]?.total ?? '0', 10),
            limit,
            offset,
            items: dataResult.rows,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/rentals/payment-schedule — all payment schedule items (paginated, with status refresh)
router.get('/payment-schedule', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const statusFilter = toText(req.query.status) ?? '';
    const search = toText(req.query.search) ?? '';
    try {
        const perms = req.permissions;
        if (!hasRentalAdminAccess(perms)) {
            return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
        }
        // Refresh statuses first
        await refreshPaymentStatuses(pool);
        const whereClauses = [];
        const params = [];
        if (perms.scope === 'MARKET_CENTRE') {
            addMarketCentreRentalAccessFilter(whereClauses, params, perms.marketCenterId, 'r');
        }
        if (statusFilter) {
            const normalizedStatusFilter = statusFilter.toUpperCase();
            if (normalizedStatusFilter === 'DUE_30') {
                whereClauses.push(`ps.payment_status IN ('DUE', 'UPCOMING')`);
                whereClauses.push(`ps.due_date >= CURRENT_DATE`);
                whereClauses.push(`ps.due_date <= (CURRENT_DATE + INTERVAL '30 days')`);
            }
            else {
                params.push(normalizedStatusFilter);
                whereClauses.push(`ps.payment_status = $${params.length}`);
            }
        }
        if (search) {
            params.push(`%${search}%`);
            const p = `$${params.length}`;
            whereClauses.push(`(
        r.rental_number ILIKE ${p}
        OR r.property_address ILIKE ${p}
        OR r.market_centre_name ILIKE ${p}
        OR r.landlord_name ILIKE ${p}
        OR r.tenant_name ILIKE ${p}
      )`);
        }
        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const countParams = [...params];
        params.push(limit, offset);
        const [totalResult, dataResult] = await Promise.all([
            pool.query(`SELECT COUNT(ps.id)::text AS total
           FROM app.rental_payment_schedule ps
           JOIN app.rentals r ON r.id = ps.rental_id
           ${where}`, countParams),
            pool.query(`SELECT
           ps.*,
           r.rental_number,
           r.rental_type,
           r.property_address,
           r.suburb,
           r.city,
           r.market_centre_id,
           r.market_centre_name,
           r.landlord_name,
           r.landlord_surname_or_company,
           r.tenant_name,
           r.tenant_surname_or_company,
           r.counts_toward_cap,
           COALESCE(json_agg(rp ORDER BY rp.id) FILTER (WHERE rp.id IS NOT NULL), '[]') AS participants
         FROM app.rental_payment_schedule ps
         JOIN app.rentals r ON r.id = ps.rental_id
         LEFT JOIN app.rental_participants rp ON rp.rental_id = r.id
         ${where}
         GROUP BY ps.id, r.id
         ORDER BY
           CASE ps.payment_status
             WHEN 'OVERDUE' THEN 1
             WHEN 'DUE'     THEN 2
             WHEN 'UPCOMING' THEN 3
             WHEN 'PAID'    THEN 4
             WHEN 'CANCELLED' THEN 5
             ELSE 6
           END,
           ps.due_date ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
        ]);
        return res.json({
            total: parseInt(totalResult.rows[0]?.total ?? '0', 10),
            limit,
            offset,
            items: dataResult.rows,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/rentals/:id — single rental with all related data
router.get('/:id', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    try {
        const perms = req.permissions;
        if (!hasRentalAdminAccess(perms)) {
            return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
        }
        // Scope check
        if (perms.scope === 'MARKET_CENTRE') {
            const accessible = await canWriteRental(pool, rentalId, perms);
            if (!accessible) {
                return res.status(403).json({ error: 'Access denied.' });
            }
        }
        const [rentalResult, participantsResult, scheduleResult, documentsResult] = await Promise.all([
            pool.query(`SELECT * FROM app.rentals WHERE id = $1 LIMIT 1`, [rentalId]),
            pool.query(`SELECT * FROM app.rental_participants WHERE rental_id = $1 ORDER BY id`, [rentalId]),
            pool.query(`SELECT * FROM app.rental_payment_schedule WHERE rental_id = $1 ORDER BY payment_sequence_number`, [rentalId]),
            pool.query(`SELECT * FROM app.rental_documents WHERE rental_id = $1 ORDER BY uploaded_at DESC`, [rentalId]),
        ]);
        if (!rentalResult.rows[0]) {
            return res.status(404).json({ error: 'Rental not found.' });
        }
        return res.json({
            ...rentalResult.rows[0],
            participants: participantsResult.rows,
            payment_schedule: scheduleResult.rows,
            documents: documentsResult.rows,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals — create new rental
router.post('/', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const body = req.body;
    // Required field validation
    const propertyAddress = toText(body.property_address);
    if (!propertyAddress)
        return res.status(400).json({ error: 'property_address is required.' });
    const rentalType = toText(body.rental_type);
    if (!rentalType || !['PROCUREMENT', 'MANAGEMENT'].includes(rentalType)) {
        return res.status(400).json({ error: 'rental_type must be PROCUREMENT or MANAGEMENT.' });
    }
    const frequency = toText(body.frequency) ?? 'MONTHLY';
    if (!['ONCE_OFF', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) {
        return res.status(400).json({ error: 'Invalid frequency.' });
    }
    const leaseStartDate = toDateText(body.lease_start_date);
    const leaseEndDate = toDateText(body.lease_end_date);
    if (rentalType === 'MANAGEMENT' && (!leaseStartDate || !leaseEndDate)) {
        return res.status(400).json({ error: 'lease_start_date and lease_end_date are required for MANAGEMENT rentals.' });
    }
    // Participant validation
    const participants = Array.isArray(body.participants) ? body.participants : [];
    if (participants.length > 0) {
        let totalDealSplit = 0;
        for (const p of participants) {
            const dealSplit = toNumber(p.agent_deal_split) ?? 0;
            const mcSplit = toNumber(p.market_center_split) ?? 0;
            const agentSplit = toNumber(p.agent_split) ?? 0;
            // Validate that MC Split + Agent Split = 100%
            if (Math.abs(mcSplit + agentSplit - 100) > 0.01) {
                return res.status(400).json({ error: `For each agent, Market Centre Split + Agent Split must total 100%. Agent: ${toText(p.associate_name)}, current total: ${(mcSplit + agentSplit).toFixed(2)}%.` });
            }
            totalDealSplit += dealSplit;
        }
        if (Math.abs(totalDealSplit - 100) > 0.01) {
            return res.status(400).json({ error: `Agent deal split percentages must total 100%. Current total: ${totalDealSplit.toFixed(2)}%.` });
        }
    }
    try {
        await ensureRentalAddressColumns(pool);
        const rentalNumber = await getNextRentalNumber(pool);
        const userEmail = req.user?.email ?? null;
        const rentalAmount = toNumber(body.rental_amount) ?? 0;
        const commissionAmount = toNumber(body.management_fee_amount) ?? toNumber(body.procurement_fee_amount) ?? 0;
        const grossCommission = toNumber(body.gross_commission) ?? 0;
        const royalty = toNumber(body.royalty) ?? 0;
        const growthShare = toNumber(body.growth_share) ?? 0;
        const participantAllocations = computeParticipantAllocations(participants, grossCommission, royalty, growthShare);
        const companyDollar = participantAllocations.totalCompanyDollar;
        const agentNetAmount = participantAllocations.totalAgentNetAmount;
        const rentalCountsTowardCap = participants.length > 0
            ? participantAllocations.rentalCountsTowardCap
            : toBoolean(body.counts_toward_cap);
        const paymentDueDay = toNumber(body.payment_due_day);
        // Insert rental
        const rentalResult = await pool.query(`INSERT INTO app.rentals (
        rental_number, market_centre_id, market_centre_name,
        source_listing_id, listing_number,
        property_address, suburb, city, province, property_reference, property_notes,
        landlord_name, landlord_surname_or_company, landlord_id_or_reg_number,
        landlord_email, landlord_phone, landlord_alternative_phone,
        landlord_country, landlord_province, landlord_city, landlord_suburb,
        landlord_street_number, landlord_street_name, landlord_postal_address, landlord_notes,
        tenant_name, tenant_surname_or_company, tenant_id_or_reg_number,
        tenant_email, tenant_phone, tenant_alternative_phone,
        tenant_country, tenant_province, tenant_city, tenant_suburb,
        tenant_street_number, tenant_street_name, tenant_notes,
        rental_type, rental_status, frequency,
        lease_start_date, lease_end_date, lease_signed_date, occupation_date,
        payment_due_day, payment_due_rule,
        rental_amount, deposit_amount, procurement_fee_amount,
        management_fee_percentage, management_fee_amount,
        gross_commission, company_dollar, royalty, growth_share, agent_net_amount,
        counts_toward_cap, notes,
        created_by_user_id, updated_by_user_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
        $35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,
        $52,$53,$54,$55,$56,$57,$58,$59,$60,$61
      ) RETURNING id`, [
            rentalNumber,
            toText(body.market_centre_id) ?? perms.marketCenterId,
            toText(body.market_centre_name),
            toText(body.source_listing_id),
            toText(body.listing_number),
            propertyAddress,
            toText(body.suburb),
            toText(body.city),
            toText(body.province),
            toText(body.property_reference),
            toText(body.property_notes),
            toText(body.landlord_name),
            toText(body.landlord_surname_or_company),
            toText(body.landlord_id_or_reg_number),
            toText(body.landlord_email),
            toText(body.landlord_phone),
            toText(body.landlord_alternative_phone),
            toText(body.landlord_country),
            toText(body.landlord_province),
            toText(body.landlord_city),
            toText(body.landlord_suburb),
            toText(body.landlord_street_number),
            toText(body.landlord_street_name),
            toText(body.landlord_postal_address),
            toText(body.landlord_notes),
            toText(body.tenant_name),
            toText(body.tenant_surname_or_company),
            toText(body.tenant_id_or_reg_number),
            toText(body.tenant_email),
            toText(body.tenant_phone),
            toText(body.tenant_alternative_phone),
            toText(body.tenant_country),
            toText(body.tenant_province),
            toText(body.tenant_city),
            toText(body.tenant_suburb),
            toText(body.tenant_street_number),
            toText(body.tenant_street_name),
            toText(body.tenant_notes),
            rentalType,
            toText(body.rental_status) ?? 'DRAFT',
            frequency,
            leaseStartDate,
            leaseEndDate,
            toDateText(body.lease_signed_date),
            toDateText(body.occupation_date),
            paymentDueDay,
            toText(body.payment_due_rule),
            rentalAmount,
            toNumber(body.deposit_amount) ?? 0,
            toNumber(body.procurement_fee_amount) ?? 0,
            toNumber(body.management_fee_percentage) ?? 0,
            toNumber(body.management_fee_amount) ?? 0,
            grossCommission,
            companyDollar,
            royalty,
            growthShare,
            agentNetAmount,
            rentalCountsTowardCap,
            toText(body.notes),
            userEmail,
            userEmail,
        ]);
        const newRentalId = rentalResult.rows[0].id;
        // Insert participants with new split fields
        if (participants.length > 0) {
            for (const p of participantAllocations.computed) {
                await pool.query(`INSERT INTO app.rental_participants (
            rental_id, associate_id, associate_name, participant_role,
            agent_deal_split, market_center_split, agent_split,
            gross_commission_amount, company_dollar_amount,
            royalty_amount, growth_share_amount, agent_net_amount, counts_toward_cap
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
                    newRentalId,
                    p.associate_id,
                    p.associate_name,
                    p.participant_role,
                    p.agent_deal_split,
                    p.market_center_split,
                    p.agent_split,
                    p.gross_commission_amount,
                    p.company_dollar_amount,
                    p.royalty_amount,
                    p.growth_share_amount,
                    p.agent_net_amount,
                    p.counts_toward_cap,
                ]);
            }
        }
        // Generate payment schedule
        const scheduleRows = generatePaymentSchedule(newRentalId, rentalType, frequency, leaseStartDate, leaseEndDate, paymentDueDay, rentalAmount, commissionAmount, grossCommission, companyDollar, royalty, growthShare, agentNetAmount, userEmail);
        for (const row of scheduleRows) {
            await pool.query(`INSERT INTO app.rental_payment_schedule (
          rental_id, payment_sequence_number, due_date, period_start_date, period_end_date,
          expected_rental_amount, expected_commission_amount, gross_commission,
          company_dollar, royalty, growth_share, agent_net_amount, payment_status, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
                row.rental_id, row.payment_sequence_number, row.due_date,
                row.period_start_date, row.period_end_date,
                row.expected_rental_amount, row.expected_commission_amount,
                row.gross_commission, row.company_dollar, row.royalty, row.growth_share,
                row.agent_net_amount, row.payment_status, row.created_by_user_id,
            ]);
        }
        // Audit log
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, new_value, changed_by_user_id)
       VALUES ($1, 'RENTAL_CREATED', $2::jsonb, $3)`, [newRentalId, JSON.stringify({ rental_number: rentalNumber, rental_type: rentalType }), userEmail]);
        return res.status(201).json({
            id: newRentalId,
            rental_number: rentalNumber,
            schedule_rows_created: scheduleRows.length,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// PUT /api/rentals/:id — update rental
router.put('/:id', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    const body = req.body;
    const userEmail = req.user?.email ?? null;
    const participants = Array.isArray(body.participants) ? body.participants : [];
    if (participants.length > 0) {
        let totalDealSplit = 0;
        for (const p of participants) {
            const dealSplit = toNumber(p.agent_deal_split) ?? 0;
            const mcSplit = toNumber(p.market_center_split) ?? 0;
            const agentSplit = toNumber(p.agent_split) ?? 0;
            if (Math.abs(mcSplit + agentSplit - 100) > 0.01) {
                return res.status(400).json({ error: `For each agent, Market Centre Split + Agent Split must total 100%. Agent: ${toText(p.associate_name)}, current total: ${(mcSplit + agentSplit).toFixed(2)}%.` });
            }
            totalDealSplit += dealSplit;
        }
        if (Math.abs(totalDealSplit - 100) > 0.01) {
            return res.status(400).json({ error: `Agent deal split percentages must total 100%. Current total: ${totalDealSplit.toFixed(2)}%.` });
        }
    }
    try {
        await ensureRentalAddressColumns(pool);
        const rentalAmount = toNumber(body.rental_amount) ?? 0;
        const commissionAmount = toNumber(body.management_fee_amount) ?? toNumber(body.procurement_fee_amount) ?? 0;
        const grossCommission = toNumber(body.gross_commission) ?? 0;
        const royalty = toNumber(body.royalty) ?? 0;
        const growthShare = toNumber(body.growth_share) ?? 0;
        const participantAllocations = computeParticipantAllocations(participants, grossCommission, royalty, growthShare);
        const companyDollar = participants.length > 0
            ? participantAllocations.totalCompanyDollar
            : (toNumber(body.company_dollar) ?? 0);
        const agentNetAmount = participants.length > 0
            ? participantAllocations.totalAgentNetAmount
            : (toNumber(body.agent_net_amount) ?? 0);
        const rentalCountsTowardCap = participants.length > 0
            ? participantAllocations.rentalCountsTowardCap
            : (body.counts_toward_cap !== undefined ? toBoolean(body.counts_toward_cap) : false);
        await pool.query(`UPDATE app.rentals SET
        market_centre_id = COALESCE($1, market_centre_id),
        market_centre_name = COALESCE($2, market_centre_name),
        source_listing_id = COALESCE($3, source_listing_id),
        listing_number = COALESCE($4, listing_number),
        property_address = COALESCE($5, property_address),
        suburb = COALESCE($6, suburb),
        city = COALESCE($7, city),
        province = COALESCE($8, province),
        property_reference = COALESCE($9, property_reference),
        property_notes = COALESCE($10, property_notes),
        landlord_name = COALESCE($11, landlord_name),
        landlord_surname_or_company = COALESCE($12, landlord_surname_or_company),
        landlord_id_or_reg_number = COALESCE($13, landlord_id_or_reg_number),
        landlord_email = COALESCE($14, landlord_email),
        landlord_phone = COALESCE($15, landlord_phone),
        landlord_alternative_phone = COALESCE($16, landlord_alternative_phone),
        landlord_country = COALESCE($17, landlord_country),
        landlord_province = COALESCE($18, landlord_province),
        landlord_city = COALESCE($19, landlord_city),
        landlord_suburb = COALESCE($20, landlord_suburb),
        landlord_street_number = COALESCE($21, landlord_street_number),
        landlord_street_name = COALESCE($22, landlord_street_name),
        landlord_postal_address = COALESCE($23, landlord_postal_address),
        landlord_notes = COALESCE($24, landlord_notes),
        tenant_name = COALESCE($25, tenant_name),
        tenant_surname_or_company = COALESCE($26, tenant_surname_or_company),
        tenant_id_or_reg_number = COALESCE($27, tenant_id_or_reg_number),
        tenant_email = COALESCE($28, tenant_email),
        tenant_phone = COALESCE($29, tenant_phone),
        tenant_alternative_phone = COALESCE($30, tenant_alternative_phone),
        tenant_country = COALESCE($31, tenant_country),
        tenant_province = COALESCE($32, tenant_province),
        tenant_city = COALESCE($33, tenant_city),
        tenant_suburb = COALESCE($34, tenant_suburb),
        tenant_street_number = COALESCE($35, tenant_street_number),
        tenant_street_name = COALESCE($36, tenant_street_name),
        tenant_notes = COALESCE($37, tenant_notes),
        rental_type = COALESCE($38, rental_type),
        rental_status = COALESCE($39, rental_status),
        frequency = COALESCE($40, frequency),
        lease_start_date = COALESCE($41, lease_start_date),
        lease_end_date = COALESCE($42, lease_end_date),
        lease_signed_date = COALESCE($43, lease_signed_date),
        occupation_date = COALESCE($44, occupation_date),
        payment_due_day = COALESCE($45, payment_due_day),
        payment_due_rule = COALESCE($46, payment_due_rule),
        rental_amount = COALESCE($47, rental_amount),
        deposit_amount = COALESCE($48, deposit_amount),
        procurement_fee_amount = COALESCE($49, procurement_fee_amount),
        management_fee_percentage = COALESCE($50, management_fee_percentage),
        management_fee_amount = COALESCE($51, management_fee_amount),
        gross_commission = COALESCE($52, gross_commission),
        company_dollar = COALESCE($53, company_dollar),
        royalty = COALESCE($54, royalty),
        growth_share = COALESCE($55, growth_share),
        agent_net_amount = COALESCE($56, agent_net_amount),
        counts_toward_cap = COALESCE($57, counts_toward_cap),
        notes = COALESCE($58, notes),
        updated_by_user_id = $59,
        updated_at = NOW()
      WHERE id = $60`, [
            toText(body.market_centre_id),
            toText(body.market_centre_name),
            toText(body.source_listing_id),
            toText(body.listing_number),
            toText(body.property_address),
            toText(body.suburb),
            toText(body.city),
            toText(body.province),
            toText(body.property_reference),
            toText(body.property_notes),
            toText(body.landlord_name),
            toText(body.landlord_surname_or_company),
            toText(body.landlord_id_or_reg_number),
            toText(body.landlord_email),
            toText(body.landlord_phone),
            toText(body.landlord_alternative_phone),
            toText(body.landlord_country),
            toText(body.landlord_province),
            toText(body.landlord_city),
            toText(body.landlord_suburb),
            toText(body.landlord_street_number),
            toText(body.landlord_street_name),
            toText(body.landlord_postal_address),
            toText(body.landlord_notes),
            toText(body.tenant_name),
            toText(body.tenant_surname_or_company),
            toText(body.tenant_id_or_reg_number),
            toText(body.tenant_email),
            toText(body.tenant_phone),
            toText(body.tenant_alternative_phone),
            toText(body.tenant_country),
            toText(body.tenant_province),
            toText(body.tenant_city),
            toText(body.tenant_suburb),
            toText(body.tenant_street_number),
            toText(body.tenant_street_name),
            toText(body.tenant_notes),
            toText(body.rental_type),
            toText(body.rental_status),
            toText(body.frequency),
            toDateText(body.lease_start_date),
            toDateText(body.lease_end_date),
            toDateText(body.lease_signed_date),
            toDateText(body.occupation_date),
            toNumber(body.payment_due_day),
            toText(body.payment_due_rule),
            rentalAmount,
            toNumber(body.deposit_amount),
            toNumber(body.procurement_fee_amount),
            toNumber(body.management_fee_percentage),
            toNumber(body.management_fee_amount),
            grossCommission,
            companyDollar,
            royalty,
            growthShare,
            agentNetAmount,
            rentalCountsTowardCap,
            toText(body.notes),
            userEmail,
            rentalId,
        ]);
        if (Array.isArray(body.participants)) {
            await pool.query(`DELETE FROM app.rental_participants WHERE rental_id = $1`, [rentalId]);
            for (const p of participantAllocations.computed) {
                await pool.query(`INSERT INTO app.rental_participants (
            rental_id, associate_id, associate_name, participant_role,
            agent_deal_split, market_center_split, agent_split,
            gross_commission_amount, company_dollar_amount,
            royalty_amount, growth_share_amount, agent_net_amount, counts_toward_cap
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
                    rentalId,
                    p.associate_id,
                    p.associate_name,
                    p.participant_role,
                    p.agent_deal_split,
                    p.market_center_split,
                    p.agent_split,
                    p.gross_commission_amount,
                    p.company_dollar_amount,
                    p.royalty_amount,
                    p.growth_share_amount,
                    p.agent_net_amount,
                    p.counts_toward_cap,
                ]);
            }
        }
        await pool.query(`UPDATE app.rental_payment_schedule
          SET expected_rental_amount = $1,
              expected_commission_amount = $2,
              gross_commission = $3,
              company_dollar = $4,
              royalty = $5,
              growth_share = $6,
              agent_net_amount = $7,
              updated_at = NOW()
        WHERE rental_id = $8
          AND payment_status NOT IN ('PAID', 'CANCELLED')`, [
            rentalAmount,
            commissionAmount,
            grossCommission,
            companyDollar,
            royalty,
            growthShare,
            agentNetAmount,
            rentalId,
        ]);
        // Audit
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, new_value, changed_by_user_id)
       VALUES ($1, 'RENTAL_EDITED', $2::jsonb, $3)`, [rentalId, JSON.stringify(body), userEmail]);
        return res.json({ id: rentalId, updated: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals/:id/cancel — cancel a rental
router.post('/:id/cancel', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    const cancelledReason = toText(req.body?.cancelled_reason);
    if (!cancelledReason)
        return res.status(400).json({ error: 'cancelled_reason is required.' });
    const userEmail = req.user?.email ?? null;
    try {
        await pool.query(`UPDATE app.rentals SET rental_status = 'CANCELLED', cancelled_at = NOW(), cancelled_reason = $1, updated_by_user_id = $2, updated_at = NOW() WHERE id = $3`, [cancelledReason, userEmail, rentalId]);
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, new_value, changed_by_user_id)
       VALUES ($1, 'RENTAL_CANCELLED', $2::jsonb, $3)`, [rentalId, JSON.stringify({ cancelled_reason: cancelledReason }), userEmail]);
        return res.json({ id: rentalId, cancelled: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals/payment-schedule/:scheduleId/mark-paid — mark a payment as PAID and create transaction
router.post('/payment-schedule/:scheduleId/mark-paid', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const scheduleId = parseInt(req.params.scheduleId, 10);
    if (!Number.isFinite(scheduleId))
        return res.status(400).json({ error: 'Invalid schedule ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const userEmail = req.user?.email ?? null;
    const paidDate = toDateText(req.body?.paid_date) ?? new Date().toISOString().slice(0, 10);
    try {
        // Fetch the schedule item
        const scheduleResult = await pool.query(`SELECT ps.*, r.rental_number, r.rental_type, r.market_centre_id, r.market_centre_name,
              r.property_address, r.suburb, r.city, r.counts_toward_cap,
              r.rental_status
         FROM app.rental_payment_schedule ps
         JOIN app.rentals r ON r.id = ps.rental_id
        WHERE ps.id = $1 LIMIT 1`, [scheduleId]);
        if (!scheduleResult.rows[0]) {
            return res.status(404).json({ error: 'Payment schedule item not found.' });
        }
        const schedule = scheduleResult.rows[0];
        // Prevent duplicate transaction
        if (schedule.transaction_created) {
            return res.status(409).json({ error: 'A transaction has already been created for this payment.' });
        }
        if (schedule.payment_status === 'PAID') {
            return res.status(409).json({ error: 'Payment is already marked as PAID.' });
        }
        if (schedule.payment_status === 'CANCELLED') {
            return res.status(400).json({ error: 'Cannot mark a cancelled payment as PAID.' });
        }
        // Scope check
        if (perms.scope === 'MARKET_CENTRE') {
            const canWrite = await canWriteRental(pool, Number(schedule.rental_id), perms);
            if (!canWrite) {
                return res.status(403).json({ error: 'Access denied.' });
            }
        }
        // Check if migration.core_transactions exists and create rental transaction
        let transactionId = null;
        let transactionNumber = null;
        const txTableExists = await pool.query(`SELECT to_regclass('migration.core_transactions') AS exists`);
        if (txTableExists.rows[0]?.exists) {
            // Keep rental transaction numbers monotonic and unique even when legacy RNT numbers exist.
            await pool.query(`CREATE SEQUENCE IF NOT EXISTS migration.rental_transaction_number_seq
           START WITH 1 INCREMENT BY 1 MINVALUE 1`);
            await pool.query(`SELECT setval(
            'migration.rental_transaction_number_seq',
            GREATEST(
              (SELECT last_value::bigint FROM migration.rental_transaction_number_seq),
              (
                SELECT COALESCE(
                  MAX(
                    CASE
                      WHEN transaction_number ~ '^RNTX[0-9]+$' THEN CAST(SUBSTRING(transaction_number FROM 5) AS bigint)
                      WHEN transaction_number ~ '^RNT[0-9]+$' THEN CAST(SUBSTRING(transaction_number FROM 4) AS bigint)
                      ELSE NULL
                    END
                  ),
                  0
                )
                FROM migration.core_transactions
              )
            ),
            true
          )`);
            const txNumResult = await pool.query(`SELECT nextval('migration.rental_transaction_number_seq')::text AS next_number`);
            const nextNum = Number(txNumResult.rows[0]?.next_number ?? 1);
            transactionNumber = `RNTX${String(nextNum).padStart(5, '0')}`;
            const rentalType = schedule.rental_type === 'PROCUREMENT' ? 'Procurement Rental' : 'Management Rental';
            const txResult = await pool.query(`INSERT INTO migration.core_transactions (
          source_transaction_id, transaction_number, transaction_status, transaction_type, sale_type,
          source_market_center_id, market_center_name,
          address, suburb, city,
          total_gci, net_comm, gci_excl_vat,
          company_dollar, growth_share, production_royalties,
          transaction_category, source_type,
          source_rental_id, source_rental_payment_schedule_id,
          counts_toward_cap,
          transaction_date, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW()
        ) RETURNING id::text`, [
                `RENTAL-PAY-${scheduleId}`,
                transactionNumber,
                'Registered',
                rentalType,
                rentalType,
                schedule.market_centre_id,
                schedule.market_centre_name,
                schedule.property_address,
                schedule.suburb,
                schedule.city,
                schedule.gross_commission,
                schedule.agent_net_amount,
                schedule.gross_commission,
                schedule.company_dollar,
                schedule.growth_share,
                schedule.royalty,
                'RENTALS',
                'RENTAL_PAYMENT',
                schedule.rental_id,
                scheduleId,
                schedule.counts_toward_cap,
                paidDate,
            ]);
            transactionId = txResult.rows[0]?.id ?? null;
            // Insert transaction agents for each participant
            const participantsResult = await pool.query(`SELECT * FROM app.rental_participants WHERE rental_id = $1 ORDER BY id`, [schedule.rental_id]);
            for (const p of participantsResult.rows) {
                if (!p.associate_id)
                    continue;
                // Look up associate DB id
                const assocResult = await pool.query(`SELECT id::text FROM migration.core_associates WHERE source_associate_id = $1 LIMIT 1`, [p.associate_id]);
                const assocDbId = assocResult.rows[0]?.id ? parseInt(assocResult.rows[0].id, 10) : null;
                if (transactionId && assocDbId) {
                    await pool.query(`INSERT INTO migration.transaction_agents (
              transaction_id, associate_id, source_associate_id, agent_role, split_percentage, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT DO NOTHING`, [
                        parseInt(transactionId, 10),
                        assocDbId,
                        p.associate_id,
                        p.participant_role,
                        p.agent_deal_split ?? p.split_percentage ?? 0,
                        1,
                    ]);
                }
            }
        }
        // Mark schedule item as PAID
        await pool.query(`UPDATE app.rental_payment_schedule
          SET payment_status = 'PAID',
              paid_date = $1,
              paid_by_user_id = $2,
              transaction_created = $3,
              transaction_id = $4,
              updated_at = NOW()
        WHERE id = $5`, [paidDate, userEmail, transactionId !== null, transactionId, scheduleId]);
        // Update rental status to ACTIVE if it was DRAFT
        await pool.query(`UPDATE app.rentals SET rental_status = 'ACTIVE', updated_at = NOW()
        WHERE id = $1 AND rental_status = 'DRAFT'`, [schedule.rental_id]);
        // Audit log
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, payment_schedule_id, transaction_id, action, new_value, changed_by_user_id)
       VALUES ($1,$2,$3,'PAYMENT_MARKED_PAID',$4::jsonb,$5)`, [schedule.rental_id, scheduleId, transactionId, JSON.stringify({ paid_date: paidDate, transaction_id: transactionId }), userEmail]);
        res.json({
            schedule_id: scheduleId,
            paid: true,
            transaction_id: transactionId,
            transaction_number: transactionNumber,
        });
        if (txTableExists.rows[0]?.exists) {
            scheduleTransactionAgentRecompute('rentals-mark-paid');
        }
        return;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals/payment-schedule/:scheduleId/cancel — cancel a payment schedule item
router.post('/payment-schedule/:scheduleId/cancel', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const scheduleId = parseInt(req.params.scheduleId, 10);
    if (!Number.isFinite(scheduleId))
        return res.status(400).json({ error: 'Invalid schedule ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const cancelledReason = toText(req.body?.cancelled_reason);
    if (!cancelledReason)
        return res.status(400).json({ error: 'cancelled_reason is required.' });
    const userEmail = req.user?.email ?? null;
    try {
        const scheduleResult = await pool.query(`SELECT ps.*, r.market_centre_id FROM app.rental_payment_schedule ps
       JOIN app.rentals r ON r.id = ps.rental_id WHERE ps.id = $1 LIMIT 1`, [scheduleId]);
        if (!scheduleResult.rows[0]) {
            return res.status(404).json({ error: 'Payment schedule item not found.' });
        }
        const schedule = scheduleResult.rows[0];
        if (schedule.payment_status === 'PAID') {
            return res.status(400).json({ error: 'Cannot cancel a PAID payment. Use the reversal process.' });
        }
        if (perms.scope === 'MARKET_CENTRE') {
            const canWrite = await canWriteRental(pool, Number(schedule.rental_id), perms);
            if (!canWrite) {
                return res.status(403).json({ error: 'Access denied.' });
            }
        }
        await pool.query(`UPDATE app.rental_payment_schedule
          SET payment_status = 'CANCELLED',
              cancelled_date = NOW(),
              cancelled_reason = $1,
              cancelled_by_user_id = $2,
              updated_at = NOW()
        WHERE id = $3`, [cancelledReason, userEmail, scheduleId]);
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, payment_schedule_id, action, new_value, changed_by_user_id)
       VALUES ($1,$2,'PAYMENT_CANCELLED',$3::jsonb,$4)`, [schedule.rental_id, scheduleId, JSON.stringify({ cancelled_reason: cancelledReason }), userEmail]);
        return res.json({ schedule_id: scheduleId, cancelled: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/rentals/:id/documents — list document metadata for a rental
router.get('/:id/documents', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    try {
        const result = await pool.query(`SELECT * FROM app.rental_documents WHERE rental_id = $1 ORDER BY uploaded_at DESC, id DESC`, [rentalId]);
        return res.json({ items: result.rows });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals/:id/documents — create rental document metadata entry
router.post('/:id/documents', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    const documentName = toText(req.body?.document_name);
    if (!documentName)
        return res.status(400).json({ error: 'document_name is required.' });
    const userEmail = req.user?.email ?? null;
    const documentType = toDocumentType(req.body?.document_type);
    const fileName = toText(req.body?.file_name);
    const fileUrl = toText(req.body?.file_url);
    const storagePath = toText(req.body?.storage_path);
    try {
        const insertResult = await pool.query(`INSERT INTO app.rental_documents (
        rental_id, document_name, document_type, file_name, file_url, storage_path, uploaded_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`, [rentalId, documentName, documentType, fileName, fileUrl, storagePath, userEmail]);
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, new_value, changed_by_user_id)
       VALUES ($1, 'DOCUMENT_ADDED', $2::jsonb, $3)`, [
            rentalId,
            JSON.stringify({
                document_name: documentName,
                document_type: documentType,
                file_name: fileName,
                file_url: fileUrl,
            }),
            userEmail,
        ]);
        return res.status(201).json(insertResult.rows[0]);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// POST /api/rentals/:id/documents/upload — upload document file and create metadata entry
router.post('/:id/documents/upload', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    const documentName = toText(req.body?.document_name);
    if (!documentName)
        return res.status(400).json({ error: 'document_name is required.' });
    const documentType = toDocumentType(req.body?.document_type);
    const uploadFile = {
        file_name: toText(req.body?.file_name) ?? undefined,
        mime_type: toText(req.body?.mime_type) ?? undefined,
        content_base64: toText(req.body?.content_base64) ?? undefined,
    };
    if (!uploadFile.content_base64) {
        return res.status(400).json({ error: 'content_base64 is required.' });
    }
    const userEmail = req.user?.email ?? null;
    try {
        const uploaded = await storeRentalDocumentFile(uploadFile);
        const insertResult = await pool.query(`INSERT INTO app.rental_documents (
        rental_id, document_name, document_type, file_name, file_url, storage_path, uploaded_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`, [rentalId, documentName, documentType, uploaded.fileName, uploaded.fileUrl, uploaded.storagePath, userEmail]);
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, new_value, changed_by_user_id)
       VALUES ($1, 'DOCUMENT_ADDED', $2::jsonb, $3)`, [
            rentalId,
            JSON.stringify({
                document_name: documentName,
                document_type: documentType,
                file_name: uploaded.fileName,
                file_url: uploaded.fileUrl,
            }),
            userEmail,
        ]);
        return res.status(201).json(insertResult.rows[0]);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// DELETE /api/rentals/documents/:documentId — delete rental document metadata entry
router.delete('/documents/:documentId', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const documentId = parseInt(req.params.documentId, 10);
    if (!Number.isFinite(documentId))
        return res.status(400).json({ error: 'Invalid document ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    try {
        const existing = await pool.query(`SELECT id, rental_id, document_name, document_type, file_name, file_url
       FROM app.rental_documents
       WHERE id = $1
       LIMIT 1`, [documentId]);
        const row = existing.rows[0];
        if (!row)
            return res.status(404).json({ error: 'Document not found.' });
        const canWrite = await canWriteRental(pool, row.rental_id, perms);
        if (!canWrite)
            return res.status(403).json({ error: 'Access denied.' });
        await pool.query(`DELETE FROM app.rental_documents WHERE id = $1`, [documentId]);
        const userEmail = req.user?.email ?? null;
        await pool.query(`INSERT INTO app.rental_audit_log (rental_id, action, old_value, changed_by_user_id)
       VALUES ($1, 'DOCUMENT_DELETED', $2::jsonb, $3)`, [
            row.rental_id,
            JSON.stringify({
                document_id: row.id,
                document_name: row.document_name,
                document_type: row.document_type,
                file_name: row.file_name,
                file_url: row.file_url,
            }),
            userEmail,
        ]);
        return res.json({ deleted: true, id: documentId });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/rentals/:id/audit-log — get audit log for a rental
router.get('/:id/audit-log', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    const rentalId = parseInt(req.params.id, 10);
    if (!Number.isFinite(rentalId))
        return res.status(400).json({ error: 'Invalid rental ID.' });
    const perms = req.permissions;
    if (!hasRentalAdminAccess(perms)) {
        return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
    }
    const canWrite = await canWriteRental(pool, rentalId, perms);
    if (!canWrite)
        return res.status(403).json({ error: 'Access denied.' });
    try {
        const result = await pool.query(`SELECT * FROM app.rental_audit_log WHERE rental_id = $1 ORDER BY changed_at DESC LIMIT 100`, [rentalId]);
        return res.json({ items: result.rows });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
// GET /api/rentals/dashboard/summary — rental dashboard metrics
router.get('/dashboard/summary', resolvePermissions, async (req, res) => {
    if (!pool)
        return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
    try {
        await refreshPaymentStatuses(pool);
        const perms = req.permissions;
        if (!hasRentalAdminAccess(perms)) {
            return res.status(403).json({ error: 'Permission denied: Rentals requires Office Admin or Regional Admin access.' });
        }
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
        const mcId = perms.scope === 'MARKET_CENTRE' ? perms.marketCenterId : null;
        const result = await pool.query(`WITH scoped_rentals AS (
         SELECT r.id, r.rental_status
         FROM app.rentals r
         WHERE (
           $1::text IS NULL
           OR r.market_centre_id = $1
           OR EXISTS (
             SELECT 1
             FROM app.rental_participants rp
             JOIN migration.core_associates ca
               ON ca.source_associate_id = rp.associate_id
             WHERE rp.rental_id = r.id
               AND ca.source_market_center_id = $1
           )
         )
       ),
       scoped_schedule AS (
         SELECT ps.*
         FROM app.rental_payment_schedule ps
         JOIN scoped_rentals sr ON sr.id = ps.rental_id
       )
       SELECT
         (SELECT COUNT(*) FROM scoped_rentals WHERE rental_status = 'ACTIVE') AS active_rentals,
         (SELECT COUNT(*) FROM scoped_rentals WHERE rental_status = 'CANCELLED') AS cancelled_rentals,
         (SELECT COUNT(*) FROM scoped_schedule WHERE payment_status = 'DUE') AS due_today,
         (SELECT COUNT(*) FROM scoped_schedule WHERE payment_status = 'OVERDUE') AS overdue_payments,
         (SELECT COUNT(*) FROM scoped_schedule WHERE payment_status = 'PAID' AND paid_date >= $2::date) AS paid_this_month,
         (SELECT COALESCE(SUM(gross_commission), 0) FROM scoped_schedule WHERE payment_status = 'PAID' AND paid_date >= $2::date) AS rental_gci_this_month,
         (SELECT COALESCE(SUM(company_dollar), 0) FROM scoped_schedule WHERE payment_status = 'PAID' AND paid_date >= $2::date) AS rental_co_dollar_this_month`, [mcId, monthStart]);
        const row = result.rows[0] ?? {};
        return res.json({
            active_rentals: parseInt(row.active_rentals ?? '0', 10),
            cancelled_rentals: parseInt(row.cancelled_rentals ?? '0', 10),
            due_today: parseInt(row.due_today ?? '0', 10),
            overdue_payments: parseInt(row.overdue_payments ?? '0', 10),
            paid_this_month: parseInt(row.paid_this_month ?? '0', 10),
            rental_gci_this_month: parseFloat(row.rental_gci_this_month ?? '0'),
            rental_co_dollar_this_month: parseFloat(row.rental_co_dollar_this_month ?? '0'),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
    }
});
export default router;
//# sourceMappingURL=rentals.js.map