/**
 * Listing Transfer Routes
 *
 * Provides a bulk-transfer workflow for Office Admins and Regional Admins:
 *   1. GET  /mc-agents/:mcSourceId          – active agents in a market centre + their primary-listing count
 *   2. GET  /agent-listings/:associateId    – active listings where the given agent is the PRIMARY agent
 *   3. POST /jobs                           – start an async transfer job
 *   4. GET  /jobs/:jobId                    – poll job progress
 *   5. GET  /history                        – completed transfer audit log
 *
 * Transfer flow per listing
 * ─────────────────────────
 *   a) Read original listing state (portal flags, refs)
 *   b) Set original listing status_name = 'Withdrawn' in DB
 *   c) Withdraw original from every live portal that has a stored reference ID
 *   d) Mark original listing permanently Inactive/Withdrawn (is_published = false)
 *   e) Generate a new listing number (KWL...)
 *   f) Duplicate the listing row as a NEW listing (blank portal refs, Active, is_published=true)
 *   g) Copy all sub-tables (property areas, features, images, contacts, etc.) to new listing
 *   h) Add to-agent as primary on the new listing
 *   i) Publish new listing to all portals that were enabled on the original
 *   j) Write one audit-log row
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getRequiredPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { env } from '../config/env.js';
import { normalizeMarketingUrlRecord } from '../utils/marketingUrls.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// In-memory job store  (jobs live only as long as the server process)
// ─────────────────────────────────────────────────────────────────────────────

type PortalResult = {
  portal: string;
  withdrawOk: boolean | null;   // null = not applicable (no ref / not enabled)
  withdrawError: string | null;
  publishOk: boolean | null;
  publishError: string | null;
};

type ListingTransferResult = {
  listingId: string;
  listingNumber: string | null;
  newListingId: string | null;
  newListingNumber: string | null;
  address: string | null;
  portals: PortalResult[];
  agentSwapped: boolean;
  error: string | null;
};

type TransferJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  listingIds: string[];
  total: number;
  completed: number;
  results: ListingTransferResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /** requestor info for audit */
  requestedBy: string;
};

const jobs = new Map<string, TransferJob>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function selfBaseUrl(): string {
  return `http://127.0.0.1:${env.port ?? 3000}`;
}

function officeAdminAllowedMcId(perms: { marketCenterId: string | null; homeMcId: string | null }): string | null {
  return perms.marketCenterId ?? perms.homeMcId ?? null;
}

async function callListingApi(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  token: string,
  body?: unknown,
  activeContext?: string | null,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${selfBaseUrl()}/api${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  if (activeContext) headers['x-active-context'] = activeContext;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    let responseBody: unknown = null;
    try { responseBody = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure audit table exists (CREATE TABLE IF NOT EXISTS — safe to call every boot)
// ─────────────────────────────────────────────────────────────────────────────

async function ensureAuditTable(): Promise<void> {
  try {
    const pool = getRequiredPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.listing_transfer_log (
        id            BIGSERIAL PRIMARY KEY,
        job_id        TEXT        NOT NULL,
        listing_id    BIGINT      NOT NULL,
        listing_number TEXT,
        from_agent_id BIGINT,
        from_agent_name TEXT,
        to_agent_id   BIGINT,
        to_agent_name TEXT,
        portals_json  JSONB,
        agent_swapped BOOLEAN     NOT NULL DEFAULT false,
        transfer_error TEXT,
        requested_by  TEXT,
        transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch {
    // Non-fatal: audit log missing means history tab will be empty
  }
}

// Fire-and-forget on module load
ensureAuditTable().catch(() => undefined);

// ─────────────────────────────────────────────────────────────────────────────
// GET /mc-agents/:mcSourceId
// Returns active agents in the market centre with their primary-listing counts.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/mc-agents/:mcSourceId', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  // Only Office Admins and Regional Admins may use this tool
  if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied: MC Admin Tools requires Office Admin or Regional Admin access.' });
  }

  const mcSourceId = req.params.mcSourceId;
  let effectiveMcSourceId = mcSourceId;

  // Regional Admins may query any MC; Office Admins must query their own MC
  if (perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    const allowedMcId = officeAdminAllowedMcId(perms);
    if (!allowedMcId) {
      return res.status(403).json({ error: 'Permission denied: no active office admin market centre context.' });
    }
    effectiveMcSourceId = allowedMcId;
  }

  try {
    const result = await pool.query<{
      associate_id: string;
      full_name: string | null;
      email: string | null;
      mobile_number: string | null;
      image_url: string | null;
      active_listing_count: string;
    }>(
      `SELECT
         a.id::text AS associate_id,
         a.full_name,
         COALESCE(a.kwsa_email, a.private_email, a.email) AS email,
         a.mobile_number,
         a.image_url,
         COUNT(DISTINCT la.listing_id)::text AS active_listing_count
       FROM migration.core_associates a
       LEFT JOIN migration.listing_agents la ON la.associate_id = a.id
         AND la.is_primary = true
         AND EXISTS (
           SELECT 1 FROM migration.core_listings cl
           WHERE cl.id = la.listing_id
             AND LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'
         )
       WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
               = REGEXP_REPLACE(LOWER(TRIM($1)), '[^a-z0-9]+', '', 'g')
         AND LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
       GROUP BY a.id, a.full_name, a.kwsa_email, a.private_email, a.email, a.mobile_number, a.image_url
       ORDER BY a.full_name`,
      [effectiveMcSourceId]
    );
    return res.json({ agents: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent-listings/:associateId
// Returns all ACTIVE listings where this associate is the PRIMARY agent.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/agent-listings/:associateId', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const associateId = Number(req.params.associateId);
  if (!Number.isFinite(associateId)) {
    return res.status(400).json({ error: 'Invalid associate ID.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         cl.id::text,
         cl.listing_number,
         cl.status_name,
         cl.listing_status_tag,
         cl.sale_or_rent,
         COALESCE(cl.address_line, TRIM(CONCAT_WS(' ', cl.street_number, cl.street_name))) AS address,
         cl.suburb,
         cl.city,
         cl.price::text,
         cl.property_type,
         cl.property_sub_type,
         cl.is_published,
         cl.feed_to_property24,
         COALESCE(NULLIF(TRIM(cl.property24_ref1), ''), NULLIF(TRIM(cl.property24_ref2), '')) AS property24_ref,
         cl.feed_to_private_property,
         COALESCE(NULLIF(TRIM(cl.private_property_ref1), ''), NULLIF(TRIM(cl.private_property_ref2), '')) AS private_property_ref,
         cl.feed_to_kww,
         COALESCE(NULLIF(TRIM(cl.kww_property_reference), ''), NULLIF(TRIM(cl.kww_ref1), '')) AS kww_ref,
         cl.feed_to_entegral,
         COALESCE(NULLIF(TRIM(cl.listing_payload->>'EntegralId'), ''), NULLIF(TRIM(cl.listing_payload->>'entegral_id'), '')) AS entegral_ref,
         CASE WHEN cl.listing_images_json IS NOT NULL AND cl.listing_images_json::text NOT IN ('[]', 'null', '') THEN
           (SELECT file_url FROM jsonb_array_elements_text(cl.listing_images_json::jsonb) AS file_url LIMIT 1)
         ELSE NULL END AS thumbnail_url
       FROM migration.core_listings cl
       JOIN migration.listing_agents la ON la.listing_id = cl.id
         AND la.associate_id = $1
         AND la.is_primary = true
       WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'
       ORDER BY cl.listing_number`,
      [associateId]
    );
    return res.json({ listings: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /jobs
// Start a transfer job.  Runs async; returns jobId immediately.
// Body: { fromAgentId, toAgentId, listingIds: string[], activeContext? }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/jobs', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const b = req.body as Record<string, unknown>;
  const fromAgentId = Number(b.fromAgentId);
  const toAgentId = Number(b.toAgentId);
  const listingIds = Array.isArray(b.listingIds)
    ? (b.listingIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const activeContext = typeof b.activeContext === 'string' ? b.activeContext : null;

  if (!Number.isFinite(fromAgentId) || fromAgentId <= 0) {
    return res.status(400).json({ error: 'fromAgentId is required.' });
  }
  if (!Number.isFinite(toAgentId) || toAgentId <= 0) {
    return res.status(400).json({ error: 'toAgentId is required.' });
  }
  if (fromAgentId === toAgentId) {
    return res.status(400).json({ error: 'Source and target agents must be different.' });
  }
  if (listingIds.length === 0) {
    return res.status(400).json({ error: 'At least one listing must be selected.' });
  }

  // Resolve agent names
  const agentsRes = await pool.query<{ id: string; full_name: string | null }>(
    `SELECT id::text, full_name FROM migration.core_associates WHERE id = ANY($1::bigint[])`,
    [[fromAgentId, toAgentId]]
  );
  const agentMap = new Map(agentsRes.rows.map((r) => [Number(r.id), r.full_name ?? `Agent #${r.id}`]));

  if (!agentMap.has(fromAgentId) || !agentMap.has(toAgentId)) {
    return res.status(400).json({ error: 'One or both agents could not be found.' });
  }

  // Capture the auth token from this request so the background job can call portal endpoints
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token.' });
  }

  const jobId = randomUUID();
  const job: TransferJob = {
    id: jobId,
    status: 'pending',
    fromAgentId: String(fromAgentId),
    fromAgentName: agentMap.get(fromAgentId) ?? '',
    toAgentId: String(toAgentId),
    toAgentName: agentMap.get(toAgentId) ?? '',
    listingIds: listingIds.map(String),
    total: listingIds.length,
    completed: 0,
    results: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    requestedBy: req.user?.email ?? 'unknown',
  };
  jobs.set(jobId, job);

  // Start the background processor (do not await)
  runTransferJob(job, token, activeContext).catch((err) => {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
  });

  return res.status(202).json({ jobId });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /jobs/:jobId  — poll progress
// ─────────────────────────────────────────────────────────────────────────────

router.get('/jobs/:jobId', resolvePermissions, (req, res) => {
  const perms = req.permissions!;
  if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json(job);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /history  — completed transfer audit log
// ─────────────────────────────────────────────────────────────────────────────

router.get('/history', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         id::text, job_id, listing_id::text, listing_number,
         from_agent_id::text, from_agent_name,
         to_agent_id::text, to_agent_name,
         portals_json, agent_swapped, transfer_error, requested_by,
         transferred_at::text
       FROM migration.listing_transfer_log
       ORDER BY transferred_at DESC
       LIMIT 500`
    );
    return res.json({ log: result.rows });
  } catch (err) {
    // Table may not exist on first boot
    return res.json({ log: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Background job processor
// ─────────────────────────────────────────────────────────────────────────────

async function generateTransferListingNumber(pool: ReturnType<typeof getRequiredPgPool>): Promise<string> {
  const result = await pool.query<{ max_num: string | null }>(
    `SELECT MAX(CAST(SUBSTRING(listing_number FROM 4) AS INTEGER))::text AS max_num
     FROM migration.core_listings
     WHERE listing_number ~ '^KWL[0-9]+$'`
  );
  const current = Number(result.rows[0]?.max_num ?? 0);
  const next = Math.max(current + 1, 9000);
  return `KWL${next}`;
}

async function runTransferJob(
  job: TransferJob,
  token: string,
  activeContext: string | null,
): Promise<void> {
  const pool = getRequiredPgPool();
  job.status = 'running';

  for (const listingIdStr of job.listingIds) {
    const listingId = Number(listingIdStr);
    const result: ListingTransferResult = {
      listingId: listingIdStr,
      listingNumber: null,
      newListingId: null,
      newListingNumber: null,
      address: null,
      portals: [],
      agentSwapped: false,
      error: null,
    };

    try {
      // ── 1. Read current listing state ──────────────────────────────────────
      const listingRes = await pool.query<{
        id: string;
        listing_number: string | null;
        address_line: string | null;
        street_number: string | null;
        street_name: string | null;
        suburb: string | null;
        status_name: string | null;
        listing_status_tag: string | null;
        feed_to_property24: boolean | null;
        property24_ref1: string | null;
        property24_ref2: string | null;
        feed_to_private_property: boolean | null;
        private_property_ref1: string | null;
        feed_to_kww: boolean | null;
        kww_property_reference: string | null;
        kww_ref1: string | null;
        feed_to_entegral: boolean | null;
        listing_payload: Record<string, unknown> | null;
      }>(
        `SELECT id::text, listing_number,
           address_line, street_number, street_name, suburb,
           status_name, listing_status_tag,
           feed_to_property24, property24_ref1, property24_ref2,
           feed_to_private_property, private_property_ref1,
           feed_to_kww, kww_property_reference, kww_ref1,
           feed_to_entegral, listing_payload
         FROM migration.core_listings WHERE id = $1 LIMIT 1`,
        [listingId]
      );

      if (!listingRes.rows[0]) {
        result.error = `Listing #${listingId} not found.`;
        job.results.push(result);
        job.completed += 1;
        continue;
      }

      const listing = listingRes.rows[0];
      result.listingNumber = listing.listing_number;
      result.address = listing.address_line ?? ([listing.street_number, listing.street_name, listing.suburb].filter(Boolean).join(' ') || null);

      const hasP24Ref = !!(listing.property24_ref1?.trim() || listing.property24_ref2?.trim());
      const hasPpRef = !!(listing.private_property_ref1?.trim());
      const hasKwwRef = !!(listing.kww_property_reference?.trim() || listing.kww_ref1?.trim());
      const hasEntegralRef = !!(
        (listing.listing_payload as Record<string, unknown> | null)?.['EntegralId'] ||
        (listing.listing_payload as Record<string, unknown> | null)?.['entegral_id']
      );

      // ── 2. Set original listing to Withdrawn in DB (portals read status from DB) ──
      await pool.query(
        `UPDATE migration.core_listings SET status_name = 'Withdrawn', updated_at = NOW() WHERE id = $1`,
        [listingId]
      );

      // ── 3. Withdraw original listing from portals ──────────────────────────
      // Use ref presence as the signal — feed_to_* may be false even if the listing
      // is live on the portal (e.g. manually published without toggling the flag).
      if (hasP24Ref) {
        const pr: PortalResult = { portal: 'Property24', withdrawOk: null, withdrawError: null, publishOk: null, publishError: null };
        const r = await callListingApi(`/listings/${listingId}/publish-to-property24`, 'POST', token, {}, activeContext);
        pr.withdrawOk = r.ok;
        if (!r.ok) pr.withdrawError = extractApiError(r.body);
        result.portals.push(pr);
      }

      if (hasPpRef) {
        const pr: PortalResult = { portal: 'Private Property', withdrawOk: null, withdrawError: null, publishOk: null, publishError: null };
        const r = await callListingApi(`/listings/${listingId}/publish-to-private-property`, 'POST', token, {}, activeContext);
        pr.withdrawOk = r.ok;
        if (!r.ok) pr.withdrawError = extractApiError(r.body);
        result.portals.push(pr);
      }

      if (hasKwwRef) {
        const pr: PortalResult = { portal: 'KWW', withdrawOk: null, withdrawError: null, publishOk: null, publishError: null };
        const r = await callListingApi(`/listings/${listingId}/publish-to-kww`, 'POST', token, {}, activeContext);
        pr.withdrawOk = r.ok;
        if (!r.ok) pr.withdrawError = extractApiError(r.body);
        result.portals.push(pr);
      }

      if (hasEntegralRef) {
        const pr: PortalResult = { portal: 'Entegral', withdrawOk: null, withdrawError: null, publishOk: null, publishError: null };
        const r = await callListingApi(`/listings/${listingId}/publish-to-entegral`, 'POST', token, {}, activeContext);
        pr.withdrawOk = r.ok;
        if (!r.ok) pr.withdrawError = extractApiError(r.body);
        result.portals.push(pr);
      }

      // ── 4. Mark original listing permanently Inactive ─────────────────────
      await pool.query(
        `UPDATE migration.core_listings
           SET status_name = 'Inactive', listing_status_tag = 'Withdrawn',
               is_published = false, is_draft = false, updated_at = NOW()
         WHERE id = $1`,
        [listingId]
      );

      // ── 5. Generate a new listing number ──────────────────────────────────
      const newListingNumber = await generateTransferListingNumber(pool);

      // ── 6. Duplicate listing as a new row (blank portal refs, new agent) ───
      const cleanPayload = listing.listing_payload
        ? { ...(listing.listing_payload as Record<string, unknown>) }
        : {};
      delete cleanPayload['EntegralId'];
      delete cleanPayload['entegral_id'];
      delete cleanPayload['EntegralReference'];

      const dupRes = await pool.query<{ id: string; listing_number: string }>(
        `INSERT INTO migration.core_listings (
           source_listing_id, source_market_center_id, market_center_id, listing_number,
           status_name, listing_status_tag, ownership_type,
           sale_or_rent, price, expiry_date, reduced_date, agent_property_valuation,
           no_transfer_duty, property_auction, poa,
           property_title, short_title, property_description, short_description,
           property_type, property_sub_type, descriptive_feature, retirement_living,
           address_line, suburb, city, province, country,
           erf_number, unit_number, door_number, estate_name, street_number, street_name,
           postal_code, longitude, latitude,
           override_display_location, override_display_longitude, override_display_latitude,
           loom_validation_status, loom_property_id, loom_address,
           display_address_on_website, viewing_instructions, viewing_directions,
           feed_to_private_property, feed_to_kww, feed_to_entegral, feed_to_property24,
           property24_ref1, property24_ref2, property24_sync_status,
           private_property_ref1, private_property_ref2, private_property_sync_status,
           kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
           entegral_sync_status,
           signed_date, on_market_since_date, rates_and_taxes, monthly_levy, occupation_date, mandate_type,
           erf_size, floor_area, construction_date, height_restriction, out_building_size, zoning_type,
           is_furnished, pet_friendly, has_standalone_building, has_flatlet,
           has_backup_water, wheelchair_accessible, has_generator,
           has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
           has_solar_geyser, has_water_tank,
           adsl, fibre, isdn, dialup, fixed_wimax, satellite,
           nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
           is_draft, is_published, listing_images_json, listing_payload
         )
         SELECT
           gen_random_uuid()::text, source_market_center_id, market_center_id, $2,
           'Active', 'For Sale', ownership_type,
           sale_or_rent, price, expiry_date, reduced_date, agent_property_valuation,
           no_transfer_duty, property_auction, poa,
           property_title, short_title, property_description, short_description,
           property_type, property_sub_type, descriptive_feature, retirement_living,
           address_line, suburb, city, province, country,
           erf_number, unit_number, door_number, estate_name, street_number, street_name,
           postal_code, longitude, latitude,
           override_display_location, override_display_longitude, override_display_latitude,
           loom_validation_status, loom_property_id, loom_address,
           display_address_on_website, viewing_instructions, viewing_directions,
           feed_to_private_property, feed_to_kww, feed_to_entegral, feed_to_property24,
           NULL, NULL, NULL,
           NULL, NULL, NULL,
           NULL, NULL, NULL, NULL,
           NULL,
           signed_date, on_market_since_date, rates_and_taxes, monthly_levy, occupation_date, mandate_type,
           erf_size, floor_area, construction_date, height_restriction, out_building_size, zoning_type,
           is_furnished, pet_friendly, has_standalone_building, has_flatlet,
           has_backup_water, wheelchair_accessible, has_generator,
           has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
           has_solar_geyser, has_water_tank,
           adsl, fibre, isdn, dialup, fixed_wimax, satellite,
           nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
           false, true, listing_images_json, $3::jsonb
         FROM migration.core_listings WHERE id = $1
         RETURNING id::text, listing_number`,
        [listingId, newListingNumber, JSON.stringify(cleanPayload)]
      );

      const newListingId = Number(dupRes.rows[0].id);
      result.newListingId = dupRes.rows[0].id;
      result.newListingNumber = dupRes.rows[0].listing_number;

      // ── 7. Copy sub-tables to new listing ─────────────────────────────────
      await pool.query(
        `INSERT INTO migration.listing_property_areas (listing_id, area_type, count, size, description, sub_features, sort_order)
         SELECT $2, area_type, count, size, description, sub_features, sort_order
         FROM migration.listing_property_areas WHERE listing_id = $1`,
        [listingId, newListingId]
      );
      await pool.query(
        `INSERT INTO migration.listing_features (listing_id, feature_category, feature_value, sort_order)
         SELECT $2, feature_category, feature_value, sort_order
         FROM migration.listing_features WHERE listing_id = $1`,
        [listingId, newListingId]
      );
      await pool.query(
        `INSERT INTO migration.listing_contacts (listing_id, full_name, phone_number, email_address, sort_order)
         SELECT $2, full_name, phone_number, email_address, sort_order
         FROM migration.listing_contacts WHERE listing_id = $1`,
        [listingId, newListingId]
      );
      await pool.query(
        `INSERT INTO migration.listing_images (listing_id, file_name, file_url, media_type, sort_order, uploaded_by)
         SELECT $2, file_name, file_url, media_type, sort_order, uploaded_by
         FROM migration.listing_images WHERE listing_id = $1`,
        [listingId, newListingId]
      );
      const marketingUrlResult = await pool.query(
        `SELECT id::text, url, url_type, display_name, sort_order
         FROM migration.listing_marketing_urls WHERE listing_id = $1 ORDER BY sort_order, id`,
        [listingId]
      );
      for (const row of marketingUrlResult.rows) {
        const normalized = normalizeMarketingUrlRecord(row as Record<string, unknown>);
        await pool.query(
          `INSERT INTO migration.listing_marketing_urls (listing_id, url, url_type, display_name, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [newListingId, normalized.url, normalized.url_type, normalized.display_name ?? null, normalized.sort_order ?? 0]
        );
      }
      await pool.query(
        `INSERT INTO migration.listing_show_times (listing_id, from_date, from_time, to_date, to_time, catch_phrase, sort_order)
         SELECT $2, from_date, from_time, to_date, to_time, catch_phrase, sort_order
         FROM migration.listing_show_times WHERE listing_id = $1`,
        [listingId, newListingId]
      );
      await pool.query(
        `INSERT INTO migration.listing_open_house (listing_id, open_house_date, from_time, to_time, average_price, comments, sort_order)
         SELECT $2, open_house_date, from_time, to_time, average_price, comments, sort_order
         FROM migration.listing_open_house WHERE listing_id = $1`,
        [listingId, newListingId]
      );

      // ── 8. Add to-agent as primary on the new listing ─────────────────────
      await pool.query(
        `INSERT INTO migration.listing_agents (listing_id, associate_id, agent_name, agent_role, is_primary, sort_order)
         SELECT $2, id, full_name, 'Primary', true, 0
         FROM migration.core_associates WHERE id = $1`,
        [job.toAgentId, newListingId]
      );
      result.agentSwapped = true;

      // ── 9. Publish new listing to portals ────────────────────────────────
      // Determine which portals to publish to based on original listing refs
      // OR original feed flags (whichever indicates the listing was live there).
      // Also ensure feed_to_* = true on the new listing for each portal we publish to.
      const portalPublishDefs: Array<{ portal: string; path: string; enabled: boolean; feedCol: string }> = [
        { portal: 'Property24',       path: `/listings/${newListingId}/publish-to-property24`,       enabled: hasP24Ref      || !!listing.feed_to_property24,      feedCol: 'feed_to_property24' },
        { portal: 'Private Property', path: `/listings/${newListingId}/publish-to-private-property`, enabled: hasPpRef       || !!listing.feed_to_private_property,  feedCol: 'feed_to_private_property' },
        { portal: 'KWW',              path: `/listings/${newListingId}/publish-to-kww`,              enabled: hasKwwRef      || !!listing.feed_to_kww,              feedCol: 'feed_to_kww' },
        { portal: 'Entegral',         path: `/listings/${newListingId}/publish-to-entegral`,         enabled: hasEntegralRef || !!listing.feed_to_entegral,         feedCol: 'feed_to_entegral' },
      ];
      // Set feed_to_* = true on new listing for every portal we are about to publish to
      const feedColsToEnable = portalPublishDefs.filter(d => d.enabled).map(d => d.feedCol);
      if (feedColsToEnable.length > 0) {
        await pool.query(
          `UPDATE migration.core_listings SET ${feedColsToEnable.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
          [newListingId, ...feedColsToEnable.map(() => true)]
        );
      }
      for (const def of portalPublishDefs) {
        if (!def.enabled) continue;
        let pr = result.portals.find(p => p.portal === def.portal);
        if (!pr) {
          pr = { portal: def.portal, withdrawOk: null, withdrawError: null, publishOk: null, publishError: null };
          result.portals.push(pr);
        }
        const r = await callListingApi(def.path, 'POST', token, {}, activeContext);
        pr.publishOk = r.ok;
        if (!r.ok) pr.publishError = extractApiError(r.body);
      }

    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    // ── 10. Write audit log row ────────────────────────────────────────────
    try {
      await pool.query(
        `INSERT INTO migration.listing_transfer_log
           (job_id, listing_id, listing_number, from_agent_id, from_agent_name, to_agent_id, to_agent_name,
            portals_json, agent_swapped, transfer_error, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [
          job.id, listingId, result.listingNumber,
          job.fromAgentId, job.fromAgentName, job.toAgentId, job.toAgentName,
          JSON.stringify(result.portals), result.agentSwapped, result.error ?? null, job.requestedBy,
        ]
      );
    } catch {
      // Audit log failure is non-fatal
    }

    job.results.push(result);
    job.completed += 1;
  }

  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}

function extractApiError(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as Record<string, unknown>)['error']);
  }
  if (body && typeof body === 'object' && 'message' in body) {
    return String((body as Record<string, unknown>)['message']);
  }
  return 'Unknown error';
}

export default router;
