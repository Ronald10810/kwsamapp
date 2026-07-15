import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getTodayInAppTimeZone } from '../utils/timeZone.js';

type ExpiryCandidateRow = {
  id: string;
  listing_number: string | null;
  expiry_date: string | null;
  status_name: string | null;
  listing_status_tag: string | null;
  feed_to_property24: boolean | null;
  property24_ref1: string | null;
  property24_ref2: string | null;
  feed_to_private_property: boolean | null;
  private_property_ref1: string | null;
  private_property_ref2: string | null;
  feed_to_kww: boolean | null;
  kww_property_reference: string | null;
  kww_ref1: string | null;
  kww_ref2: string | null;
  feed_to_entegral: boolean | null;
  is_draft: boolean | null;
};

type PortalSyncName = 'property24' | 'private_property' | 'kww' | 'entegral';

type PortalSyncResult = {
  portal: PortalSyncName;
  success: boolean;
  httpStatus?: number;
  message: string;
};

type ListingExpiryResult = {
  listingId: number;
  listingNumber: string | null;
  expiryDate: string | null;
  statusUpdated: boolean;
  skippedReason?: string;
  portalResults: PortalSyncResult[];
};

export type ListingExpiryJobSummary = {
  asOfDate: string;
  candidates: number;
  expiredUpdated: number;
  skipped: number;
  portalCalls: number;
  portalFailures: number;
  results: ListingExpiryResult[];
};

type RunListingExpiryJobOptions = {
  asOfDate?: string;
  authHeader?: string;
  activeContextId?: string;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toBool(value: boolean | null | undefined): boolean {
  return value === true;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function shouldSkipExpiry(row: ExpiryCandidateRow): string | null {
  const statusName = normalizeText(row.status_name);
  const statusTag = normalizeText(row.listing_status_tag);

  if (toBool(row.is_draft)) return 'draft listing';
  if (statusTag === 'expired' && statusName === 'inactive') return 'already expired';
  if (statusTag === 'sold' || statusName === 'sold') return 'already sold';
  if (statusTag === 'rented' || statusName === 'rented') return 'already rented';
  if (statusTag === 'withdrawn' || statusTag === 'withdraw' || statusName === 'withdrawn') return 'already withdrawn';
  return null;
}

function buildInternalHeaders(options: RunListingExpiryJobOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (env.automation.jobToken) {
    headers['x-internal-job-token'] = env.automation.jobToken;
    return headers;
  }

  if (options.authHeader?.trim()) {
    headers.Authorization = options.authHeader.trim();
    if (options.activeContextId?.trim()) {
      headers['x-active-context'] = options.activeContextId.trim();
    }
    return headers;
  }

  throw new Error('Automation job token or authenticated caller context is required for portal sync.');
}

function getInternalBaseUrl(): string {
  return `http://127.0.0.1:${env.port}`;
}

async function callPortalSync(
  portal: PortalSyncName,
  path: string,
  headers: Record<string, string>,
): Promise<PortalSyncResult> {
  try {
    const response = await fetch(`${getInternalBaseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(120000),
    });

    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    const message = body.message ?? body.error ?? (response.ok ? 'OK' : `HTTP ${response.status}`);
    return {
      portal,
      success: response.ok,
      httpStatus: response.status,
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      portal,
      success: false,
      message,
    };
  }
}

export async function runListingExpiryJob(options: RunListingExpiryJobOptions = {}): Promise<ListingExpiryJobSummary> {
  const pool = getRequiredPgPool();
  const asOfDate = options.asOfDate?.trim() || getTodayInAppTimeZone();

  const candidatesResult = await pool.query<ExpiryCandidateRow>(
    `SELECT
       cl.id::text,
       cl.listing_number,
       cl.expiry_date::text,
       cl.status_name,
       cl.listing_status_tag,
       cl.feed_to_property24,
       cl.property24_ref1,
       cl.property24_ref2,
       cl.feed_to_private_property,
       cl.private_property_ref1,
       cl.private_property_ref2,
       cl.feed_to_kww,
       cl.kww_property_reference,
       cl.kww_ref1,
       cl.kww_ref2,
       cl.feed_to_entegral,
       cl.is_draft
     FROM migration.core_listings cl
     WHERE cl.expiry_date IS NOT NULL
       AND cl.expiry_date <= $1::date
     ORDER BY cl.expiry_date ASC, cl.id ASC`,
    [asOfDate],
  );

  const headers = buildInternalHeaders(options);
  const results: ListingExpiryResult[] = [];
  let expiredUpdated = 0;
  let skipped = 0;
  let portalCalls = 0;
  let portalFailures = 0;

  for (const row of candidatesResult.rows) {
    const listingId = Number(row.id);
    const skipReason = shouldSkipExpiry(row);
    if (!Number.isFinite(listingId)) {
      skipped += 1;
      results.push({
        listingId: -1,
        listingNumber: row.listing_number,
        expiryDate: row.expiry_date,
        statusUpdated: false,
        skippedReason: 'invalid listing id',
        portalResults: [],
      });
      continue;
    }

    if (skipReason) {
      skipped += 1;
      results.push({
        listingId,
        listingNumber: row.listing_number,
        expiryDate: row.expiry_date,
        statusUpdated: false,
        skippedReason: skipReason,
        portalResults: [],
      });
      continue;
    }

    await pool.query(
      `UPDATE migration.core_listings
          SET status_name = 'Inactive',
              listing_status_tag = 'Expired',
              updated_at = NOW()
        WHERE id = $1`,
      [listingId],
    );
    expiredUpdated += 1;

    const portalResults: PortalSyncResult[] = [];
    const portalTargets: Array<{ portal: PortalSyncName; path: string; enabled: boolean }> = [
      {
        portal: 'property24',
        path: `/api/listings/${listingId}/publish-to-property24`,
        enabled: toBool(row.feed_to_property24) || hasValue(row.property24_ref1) || hasValue(row.property24_ref2),
      },
      {
        portal: 'private_property',
        path: `/api/listings/${listingId}/publish-to-private-property`,
        enabled: toBool(row.feed_to_private_property) || hasValue(row.private_property_ref1) || hasValue(row.private_property_ref2),
      },
      {
        portal: 'kww',
        path: `/api/listings/${listingId}/publish-to-kww`,
        enabled: toBool(row.feed_to_kww) || hasValue(row.kww_property_reference) || hasValue(row.kww_ref1) || hasValue(row.kww_ref2),
      },
      {
        portal: 'entegral',
        path: `/api/listings/${listingId}/publish-to-entegral`,
        enabled: toBool(row.feed_to_entegral),
      },
    ];

    for (const target of portalTargets) {
      if (!target.enabled) continue;
      portalCalls += 1;
      const portalResult = await callPortalSync(target.portal, target.path, headers);
      if (!portalResult.success) {
        portalFailures += 1;
      }
      portalResults.push(portalResult);
    }

    await pool.query(
      `UPDATE migration.core_listings
          SET is_published = false,
              updated_at = NOW()
        WHERE id = $1`,
      [listingId],
    );

    results.push({
      listingId,
      listingNumber: row.listing_number,
      expiryDate: row.expiry_date,
      statusUpdated: true,
      portalResults,
    });
  }

  logger.info(
    {
      asOfDate,
      candidates: candidatesResult.rowCount ?? 0,
      expiredUpdated,
      skipped,
      portalCalls,
      portalFailures,
    },
    'listing expiry job completed',
  );

  return {
    asOfDate,
    candidates: candidatesResult.rowCount ?? 0,
    expiredUpdated,
    skipped,
    portalCalls,
    portalFailures,
    results,
  };
}