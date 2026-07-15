/**
 * Agent Transfer Routes
 *
 * Regional Admin workflow to transfer an associate from one market centre to another,
 * including their primary listings and portal detail refresh.
 *
 * Existing transactions are intentionally not updated.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getRequiredPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { env } from '../config/env.js';

const router = Router();

type PortalSyncResult = {
  portal: string;
  publishOk: boolean | null;
  publishError: string | null;
};

type ListingSyncResult = {
  listingId: string;
  listingNumber: string | null;
  address: string | null;
  portals: PortalSyncResult[];
  error: string | null;
};

type AgentTransferJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  associateId: string;
  associateName: string;
  fromMarketCenterSourceId: string;
  fromMarketCenterName: string | null;
  toMarketCenterSourceId: string;
  toMarketCenterName: string | null;
  totalListings: number;
  completedListings: number;
  listingsUpdated: number;
  results: ListingSyncResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  requestedBy: string;
};

const jobs = new Map<string, AgentTransferJob>();

function selfBaseUrl(): string {
  return `http://127.0.0.1:${env.port ?? 3000}`;
}

function isAllMarketCenterScope(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '__all__' || normalized === 'all';
}

async function callListingApi(
  path: string,
  token: string,
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
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });
    let responseBody: unknown = null;
    try { responseBody = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : String(err) } };
  }
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

async function ensureAuditTable(): Promise<void> {
  try {
    const pool = getRequiredPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.agent_market_center_transfer_log (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL,
        associate_id BIGINT NOT NULL,
        associate_name TEXT,
        from_source_market_center_id TEXT,
        from_market_center_name TEXT,
        to_source_market_center_id TEXT,
        to_market_center_name TEXT,
        listings_updated INTEGER NOT NULL DEFAULT 0,
        listing_ids_json JSONB,
        requested_by TEXT,
        transfer_error TEXT,
        transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch {
    // Non-fatal: history UI will return empty data until table can be created.
  }
}

ensureAuditTable().catch(() => undefined);

router.get('/mc-agents/:mcSourceId', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied: Agent Transfer is available to Regional Admin only.' });
  }

  const mcSourceId = req.params.mcSourceId;
  const allMarketCenters = isAllMarketCenterScope(mcSourceId);
  const searchText = String(req.query.q ?? '').trim();
  const searchPattern = searchText ? `%${searchText}%` : null;

  try {
    const result = await pool.query<{
      associate_id: string;
      full_name: string | null;
      email: string | null;
      mobile_number: string | null;
      image_url: string | null;
      market_center_name: string | null;
      source_market_center_id: string | null;
      active_listing_count: string;
    }>(
      `SELECT
         a.id::text AS associate_id,
         a.full_name,
         COALESCE(a.kwsa_email, a.private_email, a.email) AS email,
         a.mobile_number,
         a.image_url,
         COALESCE(NULLIF(TRIM(mc.name), ''), a.source_market_center_id) AS market_center_name,
         a.source_market_center_id,
         COUNT(DISTINCT la.listing_id)::text AS active_listing_count
       FROM migration.core_associates a
       LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
       LEFT JOIN migration.listing_agents la ON la.associate_id = a.id
         AND la.is_primary = true
         AND EXISTS (
           SELECT 1 FROM migration.core_listings cl
           WHERE cl.id = la.listing_id
             AND LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'
         )
       WHERE (
         $1::boolean = true
         OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($2::text)), '[^a-z0-9]+', '', 'g')
       )
         AND LOWER(TRIM(COALESCE(a.status_name, ''))) = 'active'
         AND (
           $3::text IS NULL
           OR COALESCE(a.full_name, '') ILIKE $3
           OR COALESCE(a.kwsa_email, a.private_email, a.email, '') ILIKE $3
           OR COALESCE(a.mobile_number, '') ILIKE $3
           OR COALESCE(mc.name, '') ILIKE $3
           OR COALESCE(a.source_associate_id, a.id::text) ILIKE $3
         )
       GROUP BY a.id, a.full_name, a.kwsa_email, a.private_email, a.email, a.mobile_number, a.image_url, mc.name, a.source_market_center_id
       ORDER BY a.full_name`,
      [allMarketCenters, mcSourceId, searchPattern]
    );

    return res.json({ agents: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

router.post('/jobs', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied: Agent Transfer is available to Regional Admin only.' });
  }

  const body = req.body as Record<string, unknown>;
  const associateId = Number(body.associateId);
  const toMarketCenterSourceId = String(body.toMarketCenterSourceId ?? '').trim();
  const activeContext = typeof body.activeContext === 'string' ? body.activeContext : null;

  if (!Number.isFinite(associateId) || associateId <= 0) {
    return res.status(400).json({ error: 'associateId is required.' });
  }
  if (!toMarketCenterSourceId) {
    return res.status(400).json({ error: 'toMarketCenterSourceId is required.' });
  }

  try {
    const assocRes = await pool.query<{
      id: string;
      full_name: string | null;
      source_market_center_id: string | null;
      market_center_name: string | null;
    }>(
      `SELECT
         a.id::text,
         a.full_name,
         a.source_market_center_id,
         COALESCE(NULLIF(TRIM(mc.name), ''), a.source_market_center_id) AS market_center_name
       FROM migration.core_associates a
       LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
       WHERE a.id = $1
       LIMIT 1`,
      [associateId]
    );

    const associate = assocRes.rows[0];
    if (!associate) {
      return res.status(404).json({ error: 'Associate not found.' });
    }

    const fromMarketCenterSourceId = String(associate.source_market_center_id ?? '').trim();
    if (!fromMarketCenterSourceId) {
      return res.status(400).json({ error: 'Associate has no source market centre to transfer from.' });
    }

    if (
      fromMarketCenterSourceId.toLowerCase().replace(/[^a-z0-9]+/g, '')
      === toMarketCenterSourceId.toLowerCase().replace(/[^a-z0-9]+/g, '')
    ) {
      return res.status(400).json({ error: 'Source and target market centres must be different.' });
    }

    const targetMcRes = await pool.query<{ id: string; source_market_center_id: string; name: string | null }>(
      `SELECT id::text, source_market_center_id, name
       FROM migration.core_market_centers
       WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
             = REGEXP_REPLACE(LOWER(TRIM($1)), '[^a-z0-9]+', '', 'g')
       LIMIT 1`,
      [toMarketCenterSourceId]
    );

    if (!targetMcRes.rows[0]) {
      return res.status(404).json({ error: 'Target market centre not found.' });
    }

    const authHeader = req.headers['authorization'] ?? '';
    const token = String(authHeader).replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ error: 'Missing auth token.' });
    }

    const jobId = randomUUID();
    const job: AgentTransferJob = {
      id: jobId,
      status: 'pending',
      associateId: String(associateId),
      associateName: associate.full_name ?? `Associate #${associateId}`,
      fromMarketCenterSourceId,
      fromMarketCenterName: associate.market_center_name,
      toMarketCenterSourceId: targetMcRes.rows[0].source_market_center_id,
      toMarketCenterName: targetMcRes.rows[0].name,
      totalListings: 0,
      completedListings: 0,
      listingsUpdated: 0,
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      requestedBy: req.user?.email ?? 'unknown',
    };

    jobs.set(jobId, job);

    runAgentTransferJob(job, token, activeContext).catch((err) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
    });

    return res.status(202).json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

router.get('/jobs/:jobId', resolvePermissions, (req, res) => {
  const perms = req.permissions!;
  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json(job);
});

router.get('/history', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const associateId = Number(req.query.associateId);
  const hasAssociateId = Number.isFinite(associateId) && associateId > 0;

  try {
    const result = await pool.query(
      `SELECT
         id::text,
         job_id,
         associate_id::text,
         associate_name,
         from_source_market_center_id,
         from_market_center_name,
         to_source_market_center_id,
         to_market_center_name,
         listings_updated,
         listing_ids_json,
         requested_by,
         transfer_error,
         transferred_at::text
       FROM migration.agent_market_center_transfer_log
       WHERE ($1::boolean = false OR associate_id = $2)
       ORDER BY transferred_at DESC
       LIMIT 500`,
      [hasAssociateId, hasAssociateId ? associateId : null]
    );

    return res.json({ log: result.rows });
  } catch {
    return res.json({ log: [] });
  }
});

async function runAgentTransferJob(
  job: AgentTransferJob,
  token: string,
  activeContext: string | null,
): Promise<void> {
  const pool = getRequiredPgPool();
  job.status = 'running';

  const targetMcRes = await pool.query<{ id: string; source_market_center_id: string; name: string | null }>(
    `SELECT id::text, source_market_center_id, name
     FROM migration.core_market_centers
     WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
           = REGEXP_REPLACE(LOWER(TRIM($1)), '[^a-z0-9]+', '', 'g')
     LIMIT 1`,
    [job.toMarketCenterSourceId]
  );

  if (!targetMcRes.rows[0]) {
    throw new Error('Target market centre not found while running transfer job.');
  }

  const toMarketCenterDbId = Number(targetMcRes.rows[0].id);

  const allPrimaryListingsRes = await pool.query<{ listing_id: string }>(
    `SELECT DISTINCT la.listing_id::text AS listing_id
     FROM migration.listing_agents la
     WHERE la.associate_id = $1
       AND la.is_primary = true`,
    [Number(job.associateId)]
  );

  const primaryListingIds = allPrimaryListingsRes.rows
    .map((row) => Number(row.listing_id))
    .filter((value) => Number.isFinite(value) && value > 0);

  job.listingsUpdated = primaryListingIds.length;

  const activeListingsRes = await pool.query<{
    id: string;
    listing_number: string | null;
    address_line: string | null;
    street_number: string | null;
    street_name: string | null;
    suburb: string | null;
    feed_to_property24: boolean | null;
    property24_ref1: string | null;
    property24_ref2: string | null;
    feed_to_private_property: boolean | null;
    private_property_ref1: string | null;
    private_property_ref2: string | null;
    feed_to_kww: boolean | null;
    kww_property_reference: string | null;
    kww_ref1: string | null;
    feed_to_entegral: boolean | null;
    listing_payload: Record<string, unknown> | null;
  }>(
    `SELECT
       cl.id::text,
       cl.listing_number,
       cl.address_line,
       cl.street_number,
       cl.street_name,
       cl.suburb,
       cl.feed_to_property24,
       cl.property24_ref1,
       cl.property24_ref2,
       cl.feed_to_private_property,
       cl.private_property_ref1,
       cl.private_property_ref2,
       cl.feed_to_kww,
       cl.kww_property_reference,
       cl.kww_ref1,
       cl.feed_to_entegral,
       cl.listing_payload
     FROM migration.core_listings cl
     JOIN migration.listing_agents la
       ON la.listing_id = cl.id
      AND la.associate_id = $1
      AND la.is_primary = true
     WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) = 'active'
     ORDER BY cl.listing_number`,
    [Number(job.associateId)]
  );

  job.totalListings = activeListingsRes.rows.length;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE migration.core_associates
       SET source_market_center_id = $1,
           market_center_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [job.toMarketCenterSourceId, toMarketCenterDbId, Number(job.associateId)]
    );

    // Force fresh portal identity resolution after MC move:
    // - P24 agent ID is agency-scoped, so clear it to trigger auto-registration
    //   in the new target agency during publish.
    // - PP status is marked pending so operators can see it was remapped.
    await client.query(
      `UPDATE migration.core_associates
       SET agent_property24_id = NULL,
           property24_status = CASE
             WHEN COALESCE(property24_opt_in, false) = true THEN 'Pending registration (MC transfer)'
             ELSE property24_status
           END,
           private_property_status = CASE
             WHEN COALESCE(private_property_opt_in, false) = true THEN 'Pending branch relink (MC transfer)'
             ELSE private_property_status
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [Number(job.associateId)]
    );

    await client.query(
      `UPDATE migration.listing_agents
       SET market_center_id = $1
       WHERE associate_id = $2`,
      [toMarketCenterDbId, Number(job.associateId)]
    );

    if (primaryListingIds.length > 0) {
      await client.query(
        `UPDATE migration.core_listings
         SET source_market_center_id = $1,
             market_center_id = $2,
             property24_ref1 = NULL,
             property24_ref2 = NULL,
             property24_sync_status = NULL,
             private_property_ref1 = NULL,
             private_property_ref2 = NULL,
             private_property_sync_status = NULL,
             updated_at = NOW()
         WHERE id = ANY($3::bigint[])`,
        [job.toMarketCenterSourceId, toMarketCenterDbId, primaryListingIds]
      );
    }

    await client.query(
      `INSERT INTO migration.agent_market_center_transfer_log
        (job_id, associate_id, associate_name,
         from_source_market_center_id, from_market_center_name,
         to_source_market_center_id, to_market_center_name,
         listings_updated, listing_ids_json, requested_by, transfer_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        job.id,
        Number(job.associateId),
        job.associateName,
        job.fromMarketCenterSourceId,
        job.fromMarketCenterName,
        job.toMarketCenterSourceId,
        job.toMarketCenterName,
        job.listingsUpdated,
        JSON.stringify(primaryListingIds),
        job.requestedBy,
        null,
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');

    const message = err instanceof Error ? err.message : String(err);
    try {
      await pool.query(
        `INSERT INTO migration.agent_market_center_transfer_log
          (job_id, associate_id, associate_name,
           from_source_market_center_id, from_market_center_name,
           to_source_market_center_id, to_market_center_name,
           listings_updated, listing_ids_json, requested_by, transfer_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
        [
          job.id,
          Number(job.associateId),
          job.associateName,
          job.fromMarketCenterSourceId,
          job.fromMarketCenterName,
          job.toMarketCenterSourceId,
          job.toMarketCenterName,
          0,
          JSON.stringify([]),
          job.requestedBy,
          message,
        ]
      );
    } catch {
      // Ignore secondary audit insert failure.
    }

    throw err;
  } finally {
    client.release();
  }

  for (const listing of activeListingsRes.rows) {
    const result: ListingSyncResult = {
      listingId: listing.id,
      listingNumber: listing.listing_number,
      address: listing.address_line ?? ([listing.street_number, listing.street_name, listing.suburb].filter(Boolean).join(' ') || null),
      portals: [],
      error: null,
    };

    try {
      const hasP24Ref = Boolean((listing.property24_ref1 ?? '').trim() || (listing.property24_ref2 ?? '').trim());
      const hasPpRef = Boolean((listing.private_property_ref1 ?? '').trim() || (listing.private_property_ref2 ?? '').trim());
      const hasKwwRef = Boolean((listing.kww_property_reference ?? '').trim() || (listing.kww_ref1 ?? '').trim());
      const hasEntegralRef = Boolean(
        (listing.listing_payload as Record<string, unknown> | null)?.['EntegralId']
        || (listing.listing_payload as Record<string, unknown> | null)?.['entegral_id']
      );

      const portalDefs: Array<{ portal: string; path: string; enabled: boolean }> = [
        { portal: 'Property24', path: `/listings/${listing.id}/publish-to-property24`, enabled: hasP24Ref || Boolean(listing.feed_to_property24) },
        { portal: 'Private Property', path: `/listings/${listing.id}/publish-to-private-property`, enabled: hasPpRef || Boolean(listing.feed_to_private_property) },
        { portal: 'KWW', path: `/listings/${listing.id}/publish-to-kww`, enabled: hasKwwRef || Boolean(listing.feed_to_kww) },
        { portal: 'Entegral', path: `/listings/${listing.id}/publish-to-entegral`, enabled: hasEntegralRef || Boolean(listing.feed_to_entegral) },
      ];

      for (const def of portalDefs) {
        if (!def.enabled) continue;
        const syncResult: PortalSyncResult = {
          portal: def.portal,
          publishOk: null,
          publishError: null,
        };
        const response = await callListingApi(def.path, token, activeContext);
        syncResult.publishOk = response.ok;
        if (!response.ok) syncResult.publishError = extractApiError(response.body);
        result.portals.push(syncResult);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    job.results.push(result);
    job.completedListings += 1;
  }

  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}

export default router;
