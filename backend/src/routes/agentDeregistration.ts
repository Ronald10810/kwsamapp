/**
 * Agent Deregistration Routes
 *
 * Provides the agent deregistration workflow for Office Admins and Regional Admins:
 *   1. GET  /mc-agents/:mcSourceId              – active agents with total listing counts (all roles)
 *   2. GET  /agent-all-listings/:associateId    – all active listings for an agent (any role)
 *   3. POST /withdraw-jobs                      – start async withdrawal of all agent listings
 *   4. GET  /withdraw-jobs/:jobId               – poll withdrawal job progress
 *   5. POST /deactivate                         – deactivate the agent (set status_name = 'Inactive')
 *
 * Withdrawal logic per listing:
 * ─────────────────────────────
 *   Primary agent role:
 *     a) Mark listing Withdrawn in DB (so portal endpoints see correct status)
 *     b) Withdraw from every portal that has a stored reference ID
 *     c) Mark listing permanently Inactive/Withdrawn (is_published = false)
 *
 *   Secondary / other agent role:
 *     a) DELETE the agent row from listing_agents only
 *     b) Listing itself remains active and unaffected
 *
 * Deactivation:
 *   - Sets status_name = 'Inactive' on core_associates
 *   - Removes agent from any remaining secondary listing_agents rows (safety cleanup)
 *   - Writes an audit log row to migration.agent_deregistration_log
 */

import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { getRequiredPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { env } from '../config/env.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PortalWithdrawalResult = {
  portal: string;
  withdrawOk: boolean | null;
  withdrawError: string | null;
};

type ListingWithdrawalResult = {
  listingId: string;
  listingNumber: string | null;
  address: string | null;
  wasPrimary: boolean;
  portals: PortalWithdrawalResult[];
  error: string | null;
};

type WithdrawalJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  agentId: string;
  agentName: string;
  total: number;
  completed: number;
  results: ListingWithdrawalResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  requestedBy: string;
};

type AgentPortalRemovalResult = {
  portal: 'Property24' | 'Private Property';
  attempted: boolean;
  removed: boolean;
  message: string;
  details: string | null;
};

type AgentPortalRemovalSummary = {
  property24: AgentPortalRemovalResult;
  privateProperty: AgentPortalRemovalResult;
  allSucceeded: boolean;
};

type AgentPortalProfile = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  source_associate_id: string | null;
  source_market_center_id: string | null;
  kwsa_email: string | null;
  private_email: string | null;
  email: string | null;
  mobile_number: string | null;
  agent_property24_id: string | null;
  property24_opt_in: boolean | null;
  private_property_opt_in: boolean | null;
};

const withdrawalJobs = new Map<string, WithdrawalJob>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function selfBaseUrl(): string {
  return `http://127.0.0.1:${env.port ?? 3000}`;
}

async function callListingApi(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  token: string,
  body?: unknown,
  activeContext?: string | null,
  timeoutMs = 60_000,
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    let responseBody: unknown = null;
    try { responseBody = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

async function syncListingToActivePortals(
  pool: ReturnType<typeof getRequiredPgPool>,
  listingId: number,
  token: string,
  activeContext: string | null,
): Promise<PortalWithdrawalResult[]> {
  const result: PortalWithdrawalResult[] = [];

  const listingRes = await pool.query<{
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
    `SELECT feed_to_property24, property24_ref1, property24_ref2,
            feed_to_private_property, private_property_ref1,
            feed_to_kww, kww_property_reference, kww_ref1,
            feed_to_entegral, listing_payload
       FROM migration.core_listings
      WHERE id = $1
      LIMIT 1`,
    [listingId],
  );

  const listing = listingRes.rows[0];
  if (!listing) return result;

  const hasP24Ref = !!(listing.property24_ref1?.trim() || listing.property24_ref2?.trim());
  const hasPpRef = !!(listing.private_property_ref1?.trim());
  const hasKwwRef = !!(listing.kww_property_reference?.trim() || listing.kww_ref1?.trim());
  const hasEntegralRef = !!(
    (listing.listing_payload as Record<string, unknown> | null)?.['EntegralId'] ||
    (listing.listing_payload as Record<string, unknown> | null)?.['entegral_id']
  );

  if (hasP24Ref || listing.feed_to_property24) {
    const pr: PortalWithdrawalResult = { portal: 'Property24', withdrawOk: null, withdrawError: null };
    const r = await callListingApi(`/listings/${listingId}/publish-to-property24`, 'POST', token, {}, activeContext);
    pr.withdrawOk = r.ok;
    if (!r.ok) pr.withdrawError = extractApiError(r.body);
    result.push(pr);
  }

  if (hasPpRef || listing.feed_to_private_property) {
    const pr: PortalWithdrawalResult = { portal: 'Private Property', withdrawOk: null, withdrawError: null };
    const r = await callListingApi(`/listings/${listingId}/publish-to-private-property`, 'POST', token, {}, activeContext);
    pr.withdrawOk = r.ok;
    if (!r.ok) pr.withdrawError = extractApiError(r.body);
    result.push(pr);
  }

  if (hasKwwRef || listing.feed_to_kww) {
    const pr: PortalWithdrawalResult = { portal: 'KWW', withdrawOk: null, withdrawError: null };
    const r = await callListingApi(`/listings/${listingId}/publish-to-kww`, 'POST', token, {}, activeContext);
    pr.withdrawOk = r.ok;
    if (!r.ok) pr.withdrawError = extractApiError(r.body);
    result.push(pr);
  }

  if (hasEntegralRef || listing.feed_to_entegral) {
    const pr: PortalWithdrawalResult = { portal: 'Entegral', withdrawOk: null, withdrawError: null };
    const r = await callListingApi(`/listings/${listingId}/publish-to-entegral`, 'POST', token, {}, activeContext);
    pr.withdrawOk = r.ok;
    if (!r.ok) pr.withdrawError = extractApiError(r.body);
    result.push(pr);
  }

  return result;
}

async function syncListingToProperty24Only(
  pool: ReturnType<typeof getRequiredPgPool>,
  listingId: number,
  token: string,
  activeContext: string | null,
): Promise<void> {
  const listingRes = await pool.query<{
    feed_to_property24: boolean | null;
    property24_ref1: string | null;
    property24_ref2: string | null;
  }>(
    `SELECT feed_to_property24, property24_ref1, property24_ref2
       FROM migration.core_listings
      WHERE id = $1
      LIMIT 1`,
    [listingId],
  );

  const listing = listingRes.rows[0];
  if (!listing) return;

  const hasP24Ref = !!(listing.property24_ref1?.trim() || listing.property24_ref2?.trim());
  if (!hasP24Ref && !listing.feed_to_property24) return;

  await callListingApi(`/listings/${listingId}/publish-to-property24`, 'POST', token, {}, activeContext, 15_000);
}

function buildProperty24ListingsBaseUrl(): string | null {
  const p24BaseUrl = env.property24.baseUrl;
  const p24Endpoint = (env.property24.listingsEndpoint ?? 'listings').replace(/^\/+|\/+$/g, '');
  if (!p24BaseUrl) return null;

  const trimmedBase = p24BaseUrl.replace(/\/+$/g, '');
  if (!p24Endpoint) return trimmedBase;
  if (trimmedBase.toLowerCase().endsWith(`/${p24Endpoint.toLowerCase()}`)) {
    return trimmedBase;
  }
  return `${trimmedBase}/${p24Endpoint}`;
}

async function forceRetireProperty24Refs(refs: string[]): Promise<{ attempted: number; succeeded: number; details: string[] }> {
  const p24ApiKey = env.property24.apiKey;
  const p24UserGroupId = env.property24.userGroupId;
  const listingsBase = buildProperty24ListingsBaseUrl();

  if (!p24ApiKey || !listingsBase) {
    return {
      attempted: 0,
      succeeded: 0,
      details: ['Property24 ref-retirement skipped: missing Property24 API configuration.'],
    };
  }

  const headers: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
    'Content-Type': 'application/json',
  };
  if (p24UserGroupId) headers['P24-UserGroupId'] = p24UserGroupId;

  const RETIRE_DEADLINE_MS = 180_000;
  const retireDeadline = Date.now() + RETIRE_DEADLINE_MS;
  const uniqueRefs = Array.from(new Set(refs.map((ref) => ref.trim()).filter((ref) => ref.length > 0)));
  const details: string[] = [];
  let attempted = 0;
  let succeeded = 0;

  const isSuccess = (status: number): boolean => status >= 200 && status < 300;
  const tryOne = async (ref: string): Promise<boolean> => {
    const numericRef = Number(ref);
    const commonPayload: Record<string, unknown> = {
      listingNumber: Number.isFinite(numericRef) && numericRef > 0 ? numericRef : ref,
      status: 'Withdrawn',
      published: false,
      listingVisibility: 'private',
    };

    const attempts: Array<{ method: 'PATCH' | 'PUT'; url: string; payload: Record<string, unknown> }> = [
      { method: 'PATCH', url: `${listingsBase}/${encodeURIComponent(ref)}`, payload: commonPayload },
      { method: 'PUT', url: `${listingsBase}/${encodeURIComponent(ref)}`, payload: commonPayload },
    ];

    for (const attempt of attempts) {
      if (Date.now() >= retireDeadline) {
        details.push(`retire deadline reached before ${attempt.method} ${ref}`);
        return false;
      }
      attempted += 1;
      try {
        const response = await fetchWithTimeout(attempt.url, {
          method: attempt.method,
          headers,
          body: JSON.stringify(attempt.payload),
        }, 8_000);

        const raw = await response.text().catch(() => '');
        const parsed = parseJsonSafe(raw);
        const message = extractP24Message(parsed) ?? (raw ? parseBodySnippet(raw) : `HTTP ${response.status}`);

        if (isSuccess(response.status)) {
          succeeded += 1;
          details.push(`${attempt.method} ${ref}: success`);
          return true;
        }

        if (response.status === 404 || isP24InvalidEntityId(message)) {
          succeeded += 1;
          details.push(`${attempt.method} ${ref}: not found/invalid -> treated retired`);
          return true;
        }

        if (isP24AlreadyInactiveMessage(message) || String(message ?? '').toLowerCase().includes('withdraw')) {
          succeeded += 1;
          details.push(`${attempt.method} ${ref}: already inactive/withdrawn`);
          return true;
        }

        details.push(`${attempt.method} ${ref}: HTTP ${response.status}${message ? ` (${message})` : ''}`);
      } catch (err) {
        details.push(`${attempt.method} ${ref}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return false;
  };

  for (const ref of uniqueRefs) {
    if (Date.now() >= retireDeadline) {
      details.push('retire deadline reached; skipped remaining refs');
      break;
    }
    await tryOne(ref);
  }

  return { attempted, succeeded, details: details.slice(0, 40) };
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

function checkAdminPermission(perms: { isOfficeAdmin: boolean; isRegionalAdmin: boolean }): boolean {
  return perms.isOfficeAdmin || perms.isRegionalAdmin;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeId(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isAllMarketCenterScope(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '__all__' || normalized === 'all';
}

async function resolveMarketCenterSourceId(rawId: string | null | undefined): Promise<string | null> {
  const trimmed = String(rawId ?? '').trim();
  if (!trimmed) return null;

  try {
    const pool = getRequiredPgPool();
    const result = await pool.query<{ source_market_center_id: string | null }>(
      `SELECT source_market_center_id
         FROM migration.core_market_centers
        WHERE id::text = $1 OR source_market_center_id = $1
        LIMIT 1`,
      [trimmed]
    );
    const sourceId = result.rows[0]?.source_market_center_id?.trim();
    return sourceId || trimmed;
  } catch {
    return trimmed;
  }
}

async function marketCenterIdsMatch(left: string | null | undefined, right: string | null | undefined): Promise<boolean> {
  const leftNorm = normalizeId(left ?? null);
  const rightNorm = normalizeId(right ?? null);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;

  const [leftSource, rightSource] = await Promise.all([
    resolveMarketCenterSourceId(left),
    resolveMarketCenterSourceId(right),
  ]);

  return normalizeId(leftSource) === normalizeId(rightSource);
}

function officeAdminAllowedMcId(perms: { marketCenterId: string | null; homeMcId: string | null }): string | null {
  return perms.marketCenterId ?? perms.homeMcId ?? null;
}

async function resolveAssociateId(rawId: unknown): Promise<number | null> {
  const rawText = typeof rawId === 'string'
    ? rawId.trim()
    : typeof rawId === 'number'
      ? String(rawId)
      : '';
  if (!rawText) return null;

  const parsed = Number(rawText);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }

  try {
    const pool = getRequiredPgPool();
    const result = await pool.query<{ id: string }>(
      `SELECT id::text
         FROM migration.core_associates
        WHERE id::text = $1 OR source_associate_id = $1
        LIMIT 1`,
      [rawText],
    );
    const resolved = Number(result.rows[0]?.id ?? NaN);
    return Number.isFinite(resolved) && resolved > 0 ? Math.trunc(resolved) : null;
  } catch {
    return null;
  }
}

function xmlEscape(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseBodySnippet(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function parseJsonSafe(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toText(record[key]);
    if (value) return value;
  }
  return null;
}

function pickNumberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractP24Message(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractP24Message(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(' | ') : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const directKeys = ['errorMessage', 'message', 'Message', 'error', 'detail', 'title'];
    const nestedKeys = ['errors', 'Errors', 'modelState', 'ModelState'];
    const parts: string[] = [];

    for (const key of directKeys) {
      const msg = extractP24Message(record[key]);
      if (msg) parts.push(msg);
    }

    for (const key of nestedKeys) {
      const msg = extractP24Message(record[key]);
      if (msg) parts.push(msg);
    }

    if (parts.length > 0) {
      const merged = parts
        .map((part) => part.trim())
        .filter((part, index, arr) => part.length > 0 && arr.indexOf(part) === index)
        .join(' | ');
      return merged.length > 0 ? merged : null;
    }
  }
  return null;
}

function isP24AlreadyInactiveMessage(message: string | null | undefined): boolean {
  const lower = String(message ?? '').toLowerCase();
  return lower.includes('already inactive') || lower.includes('already deactivat');
}

function isP24ActiveListingBlock(message: string | null | undefined): boolean {
  const lower = String(message ?? '').toLowerCase();
  return lower.includes('active listing');
}

function isP24InvalidEntityId(message: string | null | undefined): boolean {
  const lower = String(message ?? '').toLowerCase();
  return (
    lower.includes('specified entity id is invalid') ||
    (lower.includes('invalid') && lower.includes('entity') && lower.includes('id'))
  );
}

function isP24ActiveListingBlocked(summary: AgentPortalRemovalSummary): boolean {
  const message = `${summary.property24.message} ${summary.property24.details ?? ''}`.toLowerCase();
  return message.includes('active listing');
}

function parsePpFault(text: string): string | null {
  const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim();
  return fault ? parseBodySnippet(fault) : null;
}

function extractListingNumbersFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const regex = /\bKWL\d{3,}\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    seen.add(match[0].toUpperCase());
  }
  return Array.from(seen);
}

function buildPpToken(username: string, password: string): { Digest: string; UserName: string; StampTime: string; Expires: string; UID: string } {
  const toPpDateTime = (value: Date): string => {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    const hh = String(value.getHours()).padStart(2, '0');
    const mi = String(value.getMinutes()).padStart(2, '0');
    const ss = String(value.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  };
  const uid = Math.floor(Math.random() * 9000000 + 1000000).toString();
  const tokenTime = new Date(Date.now() - 5 * 60 * 1000);
  const stampTime = toPpDateTime(tokenTime);
  const expires = toPpDateTime(new Date(tokenTime.getTime() + 24 * 60 * 60 * 1000));
  const digestString = `${uid}${stampTime}${password}${expires}`;
  const digest = createHash('sha1').update(Buffer.from(digestString, 'ascii')).digest('base64');
  return { Digest: digest, UserName: username, StampTime: stampTime, Expires: expires, UID: uid };
}

function buildPpTokenXml(t: { Digest: string; UserName: string; StampTime: string; Expires: string; UID: string }): string {
  return `<Token><Digest>${t.Digest}</Digest><UserName>${t.UserName}</UserName><StampTime>${t.StampTime}</StampTime><Expires>${t.Expires}</Expires><UID>${t.UID}</UID></Token>`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(handle);
  }
}

async function removeAgentFromProperty24(
  pool: ReturnType<typeof getRequiredPgPool>,
  agent: AgentPortalProfile,
): Promise<AgentPortalRemovalResult> {
  const p24Id = toText(agent.agent_property24_id);
  const p24ApiKey = env.property24.apiKey;
  const p24BaseUrl = env.property24.baseUrl;
  const p24UserGroupId = env.property24.userGroupId;
  const p24DefaultAgencyId = env.property24.defaultAgencyId;
  const p24Endpoint = (env.property24.listingsEndpoint ?? 'listings').replace(/^\/+|\/+$/g, '');

  if (!p24Id) {
    return {
      portal: 'Property24',
      attempted: false,
      removed: true,
      message: 'No Property24 agent ID linked; nothing to remove.',
      details: null,
    };
  }

  if (!p24ApiKey || !p24BaseUrl) {
    return {
      portal: 'Property24',
      attempted: true,
      removed: false,
      message: 'Property24 API is not configured.',
      details: 'Missing PROPERTY24_BASE_URL or PROPERTY24_API_KEY.',
    };
  }

  const trimmedBase = p24BaseUrl.replace(/\/+$/g, '');
  const apiBase = p24Endpoint && trimmedBase.toLowerCase().endsWith(`/${p24Endpoint.toLowerCase()}`)
    ? trimmedBase.slice(0, -(p24Endpoint.length + 1))
    : trimmedBase;

  const byIdUrl = `${apiBase}/agents/${encodeURIComponent(p24Id)}`;
  const agentsUrl = `${apiBase}/agents`;
  const headers: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
    'Content-Type': 'application/json',
  };
  if (p24UserGroupId) headers['P24-UserGroupId'] = p24UserGroupId;

  let existingPayload: Record<string, unknown> | null = null;
  let getFailureDetail: string | null = null;
  try {
    const getRes = await fetchWithTimeout(byIdUrl, {
      method: 'GET',
      headers,
    }, 25_000);
    const getText = await getRes.text().catch(() => '');
    const getJson = parseJsonSafe(getText);

    if (getRes.status === 404) {
      return {
        portal: 'Property24',
        attempted: true,
        removed: true,
        message: 'Property24 agent record was not found; treated as already removed.',
        details: null,
      };
    }

    if (!getRes.ok) {
      const getMsg = extractP24Message(getJson) ?? (getText ? parseBodySnippet(getText) : `HTTP ${getRes.status}`);
      if (isP24InvalidEntityId(getMsg)) {
        return {
          portal: 'Property24',
          attempted: true,
          removed: true,
          message: 'Property24 agent ID is invalid/not found; treated as already removed.',
          details: `GET /agents/{id} -> HTTP ${getRes.status} (${getMsg})`,
        };
      }
      getFailureDetail = `GET /agents/{id} -> HTTP ${getRes.status} (${getMsg})`;
      existingPayload = null;
    } else {
      const root = getRecord(getJson);
      existingPayload = getRecord(root?.data) ?? root;
    }
  } catch (err) {
    getFailureDetail = `GET /agents/{id} -> ${err instanceof Error ? err.message : String(err)}`;
    existingPayload = null;
  }

  const firstName = pickStringField(existingPayload ?? {}, ['firstname', 'firstName', 'FirstName'])
    ?? toText(agent.first_name)
    ?? toText(agent.full_name)?.split(' ')[0]
    ?? 'Agent';
  const lastName = pickStringField(existingPayload ?? {}, ['lastname', 'lastName', 'LastName'])
    ?? toText(agent.last_name)
    ?? (toText(agent.full_name)?.split(' ').slice(1).join(' ') || 'Inactive');
  const emailAddress = pickStringField(existingPayload ?? {}, ['emailAddress', 'EmailAddress'])
    ?? toText(agent.kwsa_email)
    ?? toText(agent.email)
    ?? toText(agent.private_email)
    ?? '';
  const mobileNumber = (pickStringField(existingPayload ?? {}, ['mobileNumber', 'MobileNumber'])
    ?? toText(agent.mobile_number)
    ?? '').replace(/[()\s-]+/g, '');
  const workNumber = (pickStringField(existingPayload ?? {}, ['workNumber', 'WorkNumber'])
    ?? mobileNumber).replace(/[()\s-]+/g, '');
  const sourceReference = pickStringField(existingPayload ?? {}, ['sourceReference', 'SourceReference'])
    ?? `KW_${toText(agent.source_market_center_id) ?? ''}_${toText(agent.source_associate_id) ?? agent.id}`.replace(/_+$/g, '');
  let agencyId = pickNumberField(existingPayload ?? {}, ['agencyId', 'AgencyId']);
  if (agencyId === null) {
    const sourceMcId = toText(agent.source_market_center_id);
    if (sourceMcId) {
      try {
        const mcRes = await pool.query<{ market_center_property24_id: string | null }>(
          `SELECT market_center_property24_id::text
             FROM migration.core_market_centers
            WHERE source_market_center_id = $1
            LIMIT 1`,
          [sourceMcId],
        );
        const mcAgency = Number(toText(mcRes.rows[0]?.market_center_property24_id ?? null) ?? NaN);
        if (Number.isFinite(mcAgency) && mcAgency > 0) {
          agencyId = mcAgency;
        }
      } catch {
        // Best-effort fallback; continue to default agencyId below.
      }
    }
  }
  if (agencyId === null) {
    const defaultAgency = Number(toText(p24DefaultAgencyId) ?? NaN);
    if (Number.isFinite(defaultAgency) && defaultAgency > 0) {
      agencyId = defaultAgency;
    }
  }
  const countryId = pickNumberField(existingPayload ?? {}, ['countryId', 'CountryId']) ?? 1;
  const cityId = pickNumberField(existingPayload ?? {}, ['cityId', 'CityId']);
  const idNumber = pickStringField(existingPayload ?? {}, ['idNumber', 'IdNumber']);
  const fidelityFundCertificationNumber = pickStringField(existingPayload ?? {}, ['fidelityFundCertificationNumber', 'FidelityFundCertificationNumber']);
  const jobTitle = pickStringField(existingPayload ?? {}, ['jobTitle', 'JobTitle']);

  const numericId = Number(p24Id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return {
      portal: 'Property24',
      attempted: true,
      removed: false,
      message: 'Property24 deactivation failed: invalid Property24 agent ID.',
      details: `agent_property24_id="${p24Id}" is not numeric`,
    };
  }

  if (!emailAddress) {
    return {
      portal: 'Property24',
      attempted: true,
      removed: false,
      message: 'Property24 deactivation failed: missing agent email.',
      details: 'emailAddress is required by Property24 PUT /agents.',
    };
  }

  const deactivatePayload: Record<string, unknown> = {
    id: numericId,
    Id: numericId,
    agentId: numericId,
    firstname: firstName,
    lastname: lastName,
    emailAddress,
    mobileNumber,
    workNumber,
    sourceReference,
    published: false,
    receiveStatsMail: false,
    status: 'Inactive',
    active: false,
    countryId,
  };
  if (agencyId !== null) {
    deactivatePayload.agencyId = agencyId;
    deactivatePayload.AgencyId = agencyId;
  }
  if (cityId !== null) deactivatePayload.cityId = cityId;
  if (idNumber) deactivatePayload.idNumber = idNumber;
  if (fidelityFundCertificationNumber) deactivatePayload.fidelityFundCertificationNumber = fidelityFundCertificationNumber;
  if (jobTitle) deactivatePayload.jobTitle = jobTitle;

  const failures: string[] = [];
  if (getFailureDetail) failures.push(getFailureDetail);

  const tryResult = (op: string, status: number, msg: string | null): AgentPortalRemovalResult | null => {
    if (status >= 200 && status < 300) {
      return {
        portal: 'Property24',
        attempted: true,
        removed: true,
        message: 'Removed from Property24 (agent set to inactive).',
        details: `${op}${msg ? ` (${msg})` : ''}`,
      };
    }
    if (status === 404 || isP24InvalidEntityId(msg)) {
      return {
        portal: 'Property24',
        attempted: true,
        removed: true,
        message: 'Property24 agent record was not found; treated as already removed.',
        details: `${op} -> HTTP ${status}${msg ? ` (${msg})` : ''}`,
      };
    }
    if (isP24AlreadyInactiveMessage(msg)) {
      return {
        portal: 'Property24',
        attempted: true,
        removed: true,
        message: 'Property24 reports the agent is already inactive.',
        details: `${op}${msg ? ` (${msg})` : ''}`,
      };
    }
    if (isP24ActiveListingBlock(msg)) {
      return {
        portal: 'Property24',
        attempted: true,
        removed: false,
        message: 'Property24 blocks deactivation while active listings are still linked to this agent.',
        details: msg ?? `${op} -> HTTP ${status}`,
      };
    }
    return null;
  };

  const pushFailure = (detail: string) => {
    failures.push(detail);
  };

  try {
    const putRes = await fetchWithTimeout(agentsUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(deactivatePayload),
    }, 25_000);
    const putText = await putRes.text().catch(() => '');
    const putJson = parseJsonSafe(putText);
    const putMsg = extractP24Message(putJson) ?? (putText ? parseBodySnippet(putText) : null);
    const putOutcome = tryResult('PUT /agents', putRes.status, putMsg);
    if (putOutcome) return putOutcome;
    pushFailure(`PUT /agents -> HTTP ${putRes.status}${putMsg ? ` (${putMsg})` : ''}`);
  } catch (err) {
    pushFailure(`PUT /agents -> ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const patchRes = await fetchWithTimeout(byIdUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        id: numericId,
        published: false,
        receiveStatsMail: false,
        status: 'Inactive',
        active: false,
      }),
    }, 25_000);
    const patchText = await patchRes.text().catch(() => '');
    const patchJson = parseJsonSafe(patchText);
    const patchMsg = extractP24Message(patchJson) ?? (patchText ? parseBodySnippet(patchText) : null);
    const patchOutcome = tryResult('PATCH /agents/{id}', patchRes.status, patchMsg);
    if (patchOutcome) return patchOutcome;
    pushFailure(`PATCH /agents/{id} -> HTTP ${patchRes.status}${patchMsg ? ` (${patchMsg})` : ''}`);
  } catch (err) {
    pushFailure(`PATCH /agents/{id} -> ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const deleteRes = await fetchWithTimeout(byIdUrl, {
      method: 'DELETE',
      headers,
    }, 25_000);
    const deleteText = await deleteRes.text().catch(() => '');
    const deleteJson = parseJsonSafe(deleteText);
    const deleteMsg = extractP24Message(deleteJson) ?? (deleteText ? parseBodySnippet(deleteText) : null);
    const deleteOutcome = tryResult('DELETE /agents/{id}', deleteRes.status, deleteMsg);
    if (deleteOutcome) return deleteOutcome;
    pushFailure(`DELETE /agents/{id} -> HTTP ${deleteRes.status}${deleteMsg ? ` (${deleteMsg})` : ''}`);
  } catch (err) {
    pushFailure(`DELETE /agents/{id} -> ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    portal: 'Property24',
    attempted: true,
    removed: false,
    message: 'Property24 removal failed.',
    details: failures.slice(0, 8).join(' | '),
  };
}

async function removeAgentFromPrivateProperty(
  pool: ReturnType<typeof getRequiredPgPool>,
  agent: AgentPortalProfile,
): Promise<AgentPortalRemovalResult> {
  const ppBaseUrl = env.privateProperty.baseUrl;
  const ppUsername = env.privateProperty.username;
  const ppPassword = env.privateProperty.password;
  const ppPasswordAlt = env.privateProperty.passwordAlt;
  const ppDefaultBranchGuid = env.privateProperty.branchGuid;

  if (!agent.private_property_opt_in) {
    return {
      portal: 'Private Property',
      attempted: false,
      removed: true,
      message: 'Agent is not opted in to Private Property; nothing to remove.',
      details: null,
    };
  }

  if (!ppBaseUrl || !ppUsername || !ppPassword) {
    return {
      portal: 'Private Property',
      attempted: true,
      removed: false,
      message: 'Private Property API is not configured.',
      details: 'Missing PRIVATE_PROPERTY_BASE_URL, PRIVATE_PROPERTY_USERNAME, or PRIVATE_PROPERTY_PASSWORD.',
    };
  }

  const branchGuids = new Set<string>();
  const envBranchGuid = toText(ppDefaultBranchGuid);
  if (envBranchGuid) branchGuids.add(envBranchGuid);

  let branchGuid = envBranchGuid ?? '';
  if (agent.source_market_center_id) {
    try {
      const mc = await pool.query<{ pp_id: string | null }>(
        `SELECT private_property_id::text AS pp_id
         FROM migration.core_market_centers
         WHERE source_market_center_id = $1
         LIMIT 1`,
        [agent.source_market_center_id]
      );
      const mcGuid = toText(mc.rows[0]?.pp_id ?? null);
      if (mcGuid) {
        branchGuid = mcGuid;
        branchGuids.add(mcGuid);
      }
    } catch {
      // Fall back to env default branch GUID.
    }
  }

  if (!branchGuid) {
    return {
      portal: 'Private Property',
      attempted: true,
      removed: false,
      message: 'Private Property branch GUID is missing.',
      details: 'No market-center private_property_id and no PRIVATE_PROPERTY_BRANCH_GUID fallback.',
    };
  }

  const agentId = toText(agent.source_associate_id) ?? toText(agent.id) ?? '';
  if (!agentId) {
    return {
      portal: 'Private Property',
      attempted: true,
      removed: false,
      message: 'Cannot remove agent from Private Property: missing agent identifier.',
      details: null,
    };
  }

  const fullName = toText(agent.full_name);
  const firstName = toText(agent.first_name) ?? fullName?.split(' ')[0] ?? '';
  const lastName = toText(agent.last_name) ?? (fullName?.split(' ').slice(1).join(' ') ?? '');
  const email = toText(agent.kwsa_email) ?? toText(agent.email) ?? toText(agent.private_email) ?? '';
  const phone = toText(agent.mobile_number) ?? '';

  const candidateUrls = [
    ppBaseUrl,
    'https://services.privateproperty.co.za/AgentImport/AgentImport.asmx',
    'https://services.privateproperty.co.za/pplsystems/agentimport/agentimport.asmx',
    'https://services.sandbox.pp.co.za/AgentImport/AgentImport.asmx',
    'https://services.sandbox.pp.co.za/pplsystems/agentimport/agentimport.asmx',
    ppBaseUrl.includes('services.sandbox.pp.co.za')
      ? ppBaseUrl.replace('services.sandbox.pp.co.za', 'services.privateproperty.co.za')
      : null,
    ppBaseUrl.includes('services.privateproperty.co.za')
      ? ppBaseUrl.replace('services.privateproperty.co.za', 'services.sandbox.pp.co.za')
      : null,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  const candidatePasswords = [ppPassword, ppPasswordAlt]
    .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  const failures: string[] = [];
  const pp100Failures: string[] = [];

  for (const password of candidatePasswords) {
    for (const branchId of branchGuids) {
      const token = buildPpToken(ppUsername, password);
      const soapBody = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><UpdateAgent xmlns="http://tempuri.org/"><Agent><Email>${xmlEscape(email)}</Email><FirstName>${xmlEscape(firstName)}</FirstName><LastName>${xmlEscape(lastName)}</LastName><AgentId>${xmlEscape(agentId)}</AgentId><PrivysealAlias></PrivysealAlias><Active>false</Active><TelCell>${xmlEscape(phone)}</TelCell><TelHome></TelHome><TelWork>${xmlEscape(phone)}</TelWork><BranchId>${branchId}</BranchId></Agent>${buildPpTokenXml(token)}</UpdateAgent></soap:Body></soap:Envelope>`;

      for (const endpoint of candidateUrls) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'http://tempuri.org/UpdateAgent',
          },
          body: soapBody,
        }, 30_000);

        const text = await response.text().catch(() => '');
        const hasFault = /<faultstring>|<faultcode>/i.test(text);
        const faultText = parsePpFault(text);
        const resultMatch = text.match(/<UpdateAgentResult[^>]*>([^<]*)<\/UpdateAgentResult>/i);
        const resultText = resultMatch?.[1]?.trim().toLowerCase() ?? '';
        const resultLooksGood =
          !resultMatch ||
          resultText === 'true' ||
          resultText === '1' ||
          resultText === 'success' ||
          resultText === 'successful' ||
          resultText === 'succeeded';
        const bodyLower = text.toLowerCase();
        const ppCode = text.match(/\b(PP\d{2,4})\b/i)?.[1]?.toUpperCase() ?? null;
        const inlinePpMessage = text.match(/(PP\d{2,4}\s*[:\-][^<]{3,220})/i)?.[1]?.trim() ?? null;

        if (response.ok && !hasFault && resultLooksGood) {
          return {
            portal: 'Private Property',
            attempted: true,
            removed: true,
            message: 'Removed from Private Property (agent set to inactive).',
            details: text ? parseBodySnippet(text) : null,
          };
        }

        // PP sometimes returns HTTP 200 with UpdateAgentResult=false and embeds the
        // real PP error code/message in the SOAP body instead of a fault block.
        if ((ppCode === 'PP121') || bodyLower.includes('active listings')) {
          return {
            portal: 'Private Property',
            attempted: true,
            removed: false,
            message: 'Private Property blocks deactivation while active listings are still linked to this agent.',
            details: inlinePpMessage ?? faultText ?? parseBodySnippet(text),
          };
        }

        if ((ppCode === 'PP100') || bodyLower.includes('security token did not authenticate')) {
          // Credentials or token mismatch for this endpoint/password combination.
          pp100Failures.push(`UpdateAgent ${endpoint} [branch=${branchId}] -> authentication failed (${inlinePpMessage ?? ppCode ?? 'PP100'})`);
          continue;
        }

        const lowerFault = (faultText ?? '').toLowerCase();
        if (lowerFault.includes('already') && lowerFault.includes('inactive')) {
          return {
            portal: 'Private Property',
            attempted: true,
            removed: true,
            message: 'Private Property reports the agent is already inactive.',
            details: faultText,
          };
        }

        if (lowerFault.includes('pp121') || lowerFault.includes('active listing')) {
          return {
            portal: 'Private Property',
            attempted: true,
            removed: false,
            message: 'Private Property blocks deactivation while active listings are still linked to this agent.',
            details: faultText,
          };
        }

        failures.push(`UpdateAgent ${endpoint} [branch=${branchId}] -> HTTP ${response.status}${faultText ? ` (${faultText})` : (text ? ` (${parseBodySnippet(text)})` : '')}`);
      } catch (err) {
        failures.push(`UpdateAgent ${endpoint} [branch=${branchId}] -> ${err instanceof Error ? err.message : String(err)}`);
      }
      }
    }
  }

  if (pp100Failures.length > 0 && failures.length === 0) {
    return {
      portal: 'Private Property',
      attempted: true,
      removed: false,
      message: 'Private Property authentication failed (PP100). Check PRIVATE_PROPERTY credentials/endpoint/branch configuration.',
      details: pp100Failures.slice(0, 4).join(' | '),
    };
  }

  return {
    portal: 'Private Property',
    attempted: true,
    removed: false,
    message: 'Private Property removal failed.',
    details: [...failures, ...pp100Failures].slice(0, 8).join(' | '),
  };
}

async function removeAgentFromPortals(
  pool: ReturnType<typeof getRequiredPgPool>,
  agent: AgentPortalProfile,
): Promise<AgentPortalRemovalSummary> {
  const [property24, privateProperty] = await Promise.all([
    removeAgentFromProperty24(pool, agent),
    removeAgentFromPrivateProperty(pool, agent),
  ]);

  return {
    property24,
    privateProperty,
    allSucceeded: property24.removed && privateProperty.removed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure audit table exists
// ─────────────────────────────────────────────────────────────────────────────

async function ensureDeregAuditTable(): Promise<void> {
  try {
    const pool = getRequiredPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.agent_deregistration_log (
        id              BIGSERIAL    PRIMARY KEY,
        job_id          TEXT,
        associate_id    BIGINT       NOT NULL,
        associate_name  TEXT,
        reason          TEXT,
        requested_by    TEXT,
        deregistered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  } catch {
    // Non-fatal
  }
}

ensureDeregAuditTable().catch(() => undefined);
ensureDeregAuditTable().catch(() => undefined);

async function ensureReactivationAuditTable(): Promise<void> {
  try {
    const pool = getRequiredPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration.agent_reactivation_log (
        id              BIGSERIAL    PRIMARY KEY,
        associate_id    BIGINT       NOT NULL,
        associate_name  TEXT,
        old_market_center_id TEXT,
        new_market_center_id TEXT,
        requested_by    TEXT,
        reactivated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  } catch {
    // Non-fatal
  }
}

ensureReactivationAuditTable().catch(() => undefined);

// ─────────────────────────────────────────────────────────────────────────────
// GET /mc-agents/:mcSourceId
// Active agents in the market centre with ALL-listing counts (any agent role).
// ─────────────────────────────────────────────────────────────────────────────

router.get('/mc-agents/:mcSourceId', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied: MC Admin Tools requires Office Admin or Regional Admin access.' });
  }

  const mcSourceId = req.params.mcSourceId;
  let effectiveMcSourceId = mcSourceId;
  const allMarketCenters = perms.isRegionalAdmin && isAllMarketCenterScope(mcSourceId);

  // Office Admins can only manage their own MC
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
      total_listing_count: string;
      primary_listing_count: string;
    }>(
      `SELECT
         a.id::text AS associate_id,
         a.full_name,
         COALESCE(a.kwsa_email, a.private_email, a.email) AS email,
         a.mobile_number,
         a.image_url,
         COUNT(DISTINCT la.listing_id)::text AS total_listing_count,
         COUNT(DISTINCT CASE WHEN la.is_primary = true THEN la.listing_id END)::text AS primary_listing_count
       FROM migration.core_associates a
       LEFT JOIN migration.listing_agents la ON la.associate_id = a.id
         AND EXISTS (
           SELECT 1 FROM migration.core_listings cl
           WHERE cl.id = la.listing_id
             AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
         )
       WHERE (
         $1::boolean = true
         OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')
       )
         AND LOWER(TRIM(COALESCE(a.status_name, ''))) IN ('active', '1')
       GROUP BY a.id, a.full_name, a.kwsa_email, a.private_email, a.email, a.mobile_number, a.image_url
       ORDER BY a.full_name`,
      [allMarketCenters, effectiveMcSourceId]
    );
    return res.json({ agents: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent-all-listings/:associateId
// All ACTIVE listings where this associate has any role (primary or secondary).
// ─────────────────────────────────────────────────────────────────────────────

router.get('/agent-all-listings/:associateId', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const associateId = await resolveAssociateId(req.params.associateId);
  if (!associateId) {
    return res.status(400).json({ error: 'Invalid associate ID.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         cl.id::text,
         cl.listing_number,
         cl.status_name,
         COALESCE(cl.address_line, TRIM(CONCAT_WS(' ', cl.street_number, cl.street_name))) AS address,
         cl.suburb,
         cl.price::text,
         cl.property_type,
         cl.is_published,
         la.is_primary,
         la.agent_role,
         cl.feed_to_property24,
         COALESCE(NULLIF(TRIM(cl.property24_ref1), ''), NULLIF(TRIM(cl.property24_ref2), '')) AS property24_ref,
         cl.feed_to_private_property,
         COALESCE(NULLIF(TRIM(cl.private_property_ref1), ''), NULLIF(TRIM(cl.private_property_ref2), '')) AS private_property_ref,
         cl.feed_to_kww,
         COALESCE(NULLIF(TRIM(cl.kww_property_reference), ''), NULLIF(TRIM(cl.kww_ref1), '')) AS kww_ref,
         cl.feed_to_entegral,
         COALESCE(NULLIF(TRIM(cl.listing_payload->>'EntegralId'), ''), NULLIF(TRIM(cl.listing_payload->>'entegral_id'), '')) AS entegral_ref
       FROM migration.core_listings cl
       JOIN migration.listing_agents la ON la.listing_id = cl.id AND la.associate_id = $1
      WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
       ORDER BY la.is_primary DESC, cl.listing_number`,
      [associateId]
    );
    return res.json({ listings: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /withdraw-jobs
// Start async withdrawal of all of the agent's active listings.
// Primary listings: fully withdrawn from all portals and marked Inactive/Withdrawn.
// Secondary listings: agent is removed from the listing only (listing stays active).
// Body: { agentId: number, activeContext?: string }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/withdraw-jobs', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const b = req.body as Record<string, unknown>;
  const agentId = await resolveAssociateId(b.agentId ?? b.associateId);
  const activeContext = typeof b.activeContext === 'string' ? b.activeContext : null;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required.' });
  }

  const agentRes = await pool.query<{ id: string; full_name: string | null }>(
    `SELECT id::text, full_name FROM migration.core_associates WHERE id = $1`,
    [agentId]
  );
  if (!agentRes.rows[0]) {
    return res.status(400).json({ error: 'Agent not found.' });
  }

  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token.' });
  }

  // Fetch all active listings for this agent (any role)
  const listingsRes = await pool.query<{ id: string; is_primary: boolean }>(
    `SELECT cl.id::text, la.is_primary
     FROM migration.core_listings cl
     JOIN migration.listing_agents la ON la.listing_id = cl.id AND la.associate_id = $1
     WHERE LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')`,
    [agentId]
  );

  const jobId = randomUUID();
  const job: WithdrawalJob = {
    id: jobId,
    status: 'pending',
    agentId: String(agentId),
    agentName: agentRes.rows[0].full_name ?? `Agent #${agentId}`,
    total: listingsRes.rows.length,
    completed: 0,
    results: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    requestedBy: req.user?.email ?? 'unknown',
  };
  withdrawalJobs.set(jobId, job);

  runWithdrawalJob(job, listingsRes.rows, agentId, token, activeContext).catch((err) => {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
  });

  return res.status(202).json({ jobId });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /withdraw-jobs/:jobId  — poll withdrawal progress
// ─────────────────────────────────────────────────────────────────────────────

router.get('/withdraw-jobs/:jobId', resolvePermissions, (req, res) => {
  const perms = req.permissions!;
  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }
  const job = withdrawalJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json(job);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /deactivate
// Deactivate (deregister) an agent.
// Also cleans up any remaining secondary listing_agents rows for safety.
// Body: { agentId: number, reason: string, withdrawJobId?: string }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/deactivate', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const b = req.body as Record<string, unknown>;
  const agentId = await resolveAssociateId(b.agentId ?? b.associateId);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  const withdrawJobId = typeof b.withdrawJobId === 'string' ? b.withdrawJobId : null;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required.' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'Deregistration reason is required.' });
  }

  try {
    const authHeader = req.headers['authorization'] ?? '';
    const token = String(authHeader).replace(/^Bearer\s+/i, '');
    const activeContext = typeof req.headers['x-active-context'] === 'string'
      ? req.headers['x-active-context']
      : null;

    const agentRes = await pool.query<AgentPortalProfile>(
      `SELECT
         id::text,
         full_name,
         first_name,
         last_name,
         source_associate_id,
         source_market_center_id,
         kwsa_email,
         private_email,
         email,
         mobile_number,
         agent_property24_id,
         property24_opt_in,
         private_property_opt_in
       FROM migration.core_associates
       WHERE id = $1
       LIMIT 1`,
      [agentId]
    );

    const agentProfile = agentRes.rows[0];
    if (!agentProfile) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    const p24CandidateListingRes = await pool.query<{ listing_id: string }>(
      `SELECT DISTINCT cl.id::text AS listing_id
         FROM migration.core_listings cl
         JOIN migration.listing_agents la ON la.listing_id = cl.id
        WHERE la.associate_id = $1
          AND (
            COALESCE(cl.feed_to_property24, false) = true
            OR NULLIF(TRIM(cl.property24_ref1), '') IS NOT NULL
            OR NULLIF(TRIM(cl.property24_ref2), '') IS NOT NULL
          )
        ORDER BY listing_id DESC
        LIMIT 400`,
      [agentId],
    );

    const p24CandidateListingIds = p24CandidateListingRes.rows
      .map((row) => Number(row.listing_id))
      .filter((id) => Number.isFinite(id) && id > 0);

    const p24ReferenceRows = await pool.query<{ ref: string }>(
      `SELECT DISTINCT ref
         FROM (
           SELECT NULLIF(TRIM(cl.property24_ref1), '') AS ref
             FROM migration.core_listings cl
             JOIN migration.listing_agents la ON la.listing_id = cl.id
            WHERE la.associate_id = $1
           UNION ALL
           SELECT NULLIF(TRIM(cl.property24_ref2), '') AS ref
             FROM migration.core_listings cl
             JOIN migration.listing_agents la ON la.listing_id = cl.id
            WHERE la.associate_id = $1
         ) refs
        WHERE ref IS NOT NULL
        LIMIT 300`,
      [agentId],
    );

    const knownP24Refs = p24ReferenceRows.rows
      .map((row) => row.ref)
      .filter((value): value is string => Boolean(value && value.trim().length > 0));

    // Office Admins can only deregister agents in their own market centre.
    if (perms.isOfficeAdmin && !perms.isRegionalAdmin) {
      const hasAccess = await marketCenterIdsMatch(officeAdminAllowedMcId(perms), agentProfile.source_market_center_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Permission denied: you may only deregister agents in your own market centre.' });
      }
    }

    // Ensure active listing relationships are handled before portal-level
    // agent deactivation. Secondary relationships must be removed and synced
    // to portals first so PP/P24 do not still see active links.
    const activeAssocRes = await pool.query<{
      listing_id: string;
      listing_number: string | null;
      is_primary: boolean;
    }>(
      `SELECT cl.id::text AS listing_id,
              cl.listing_number,
              la.is_primary
         FROM migration.core_listings cl
         JOIN migration.listing_agents la ON la.listing_id = cl.id
        WHERE la.associate_id = $1
          AND LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')`,
      [agentId],
    );

    const activePrimary = activeAssocRes.rows.filter((row) => row.is_primary);
    if (activePrimary.length > 0) {
      return res.status(400).json({
        error: 'Agent is still primary on active listings. Transfer or withdraw those listings first before deregistration.',
        activePrimaryListings: activePrimary.map((row) => row.listing_number ?? row.listing_id),
      });
    }

    const activeSecondary = activeAssocRes.rows.filter((row) => !row.is_primary);
    if (activeSecondary.length > 0) {
      const secondaryListingIds = activeSecondary
        .map((row) => Number(row.listing_id))
        .filter((id) => Number.isFinite(id) && id > 0);

      if (secondaryListingIds.length > 0) {
        await pool.query(
          `DELETE FROM migration.listing_agents
            WHERE associate_id = $1
              AND is_primary = false
              AND listing_id = ANY($2::bigint[])`,
          [agentId, secondaryListingIds],
        );

        if (!token) {
          return res.status(401).json({
            error: 'Missing auth token for portal sync while removing secondary listing associations.',
          });
        }

        const syncFailures: string[] = [];
        for (const listingId of secondaryListingIds) {
          const portalResults = await syncListingToActivePortals(pool, listingId, token, activeContext);
          for (const portalResult of portalResults) {
            if (portalResult.withdrawOk === false) {
              syncFailures.push(
                `${portalResult.portal} listing ${listingId}: ${portalResult.withdrawError ?? 'sync failed'}`,
              );
            }
          }
        }

        if (syncFailures.length > 0) {
          return res.status(502).json({
            error: 'Secondary agent links were removed locally, but one or more portal listing re-sync operations failed. Retry deregistration to complete portal cleanup.',
            details: syncFailures.slice(0, 20),
          });
        }
      }
    }

    let portalSync = await removeAgentFromPortals(pool, agentProfile);
    if (!portalSync.allSucceeded && token) {
      // Self-heal once: if portal errors reference concrete listing numbers,
      // force a listing re-sync, then retry portal deactivation.
      const listingNumbers = Array.from(new Set([
        ...extractListingNumbersFromText(portalSync.property24.details),
        ...extractListingNumbersFromText(portalSync.privateProperty.details),
      ]));

      const listingIdsToResync = new Set<number>(p24CandidateListingIds);

      if (listingNumbers.length > 0) {
        const listingsRes = await pool.query<{ id: string }>(
          `SELECT id::text AS id
             FROM migration.core_listings
            WHERE listing_number = ANY($1::text[])`,
          [listingNumbers],
        );

        for (const row of listingsRes.rows) {
          const listingId = Number(row.id);
          if (!Number.isFinite(listingId) || listingId <= 0) continue;
          listingIdsToResync.add(listingId);
        }
      }

      // If Property24 still reports active linked listings, do a broader
      // resync across all known P24-linked listings for this agent and retry.
      if (isP24ActiveListingBlocked(portalSync) || listingIdsToResync.size > 0) {
        const P24_RESYNC_MAX_LISTINGS = 400;
        const P24_RESYNC_DEADLINE_MS = 75_000;
        const resyncDeadline = Date.now() + P24_RESYNC_DEADLINE_MS;
        const resyncQueue = Array.from(listingIdsToResync).slice(0, P24_RESYNC_MAX_LISTINGS);

        for (const listingId of resyncQueue) {
          if (Date.now() >= resyncDeadline) break;
          await syncListingToProperty24Only(pool, listingId, token, activeContext).catch(() => undefined);
        }

        portalSync = await removeAgentFromPortals(pool, agentProfile);

        if (!portalSync.allSucceeded && isP24ActiveListingBlocked(portalSync)) {
          const forcedRetire = await forceRetireProperty24Refs(knownP24Refs);
          portalSync = await removeAgentFromPortals(pool, agentProfile);
          if (!portalSync.allSucceeded && forcedRetire.attempted > 0) {
            const priorDetails = portalSync.property24.details ? `${portalSync.property24.details} | ` : '';
            portalSync.property24.details = `${priorDetails}Forced ref retirement: ${forcedRetire.succeeded}/${forcedRetire.attempted} calls succeeded. ${forcedRetire.details.slice(0, 8).join(' | ')}`;
          }
        }
      }
    }

    if (!portalSync.allSucceeded) {
      return res.status(502).json({
        error: 'Agent was not deregistered because portal removal failed. Please retry and confirm Property24 and Private Property removal succeeds first.',
        portalSync,
      });
    }

    const property24Status = portalSync.property24.message.slice(0, 490);
    const privatePropertyStatus = portalSync.privateProperty.message.slice(0, 490);

    // Mark agent as Inactive
    const updateRes = await pool.query<{ id: string; full_name: string | null }>(
      `UPDATE migration.core_associates
         SET status_name = 'Inactive',
             property24_opt_in = false,
             private_property_opt_in = false,
             property24_status = $2,
             private_property_status = $3,
             updated_at = NOW()
       WHERE id = $1
         AND LOWER(TRIM(COALESCE(status_name, ''))) IN ('active', '1')
       RETURNING id::text, full_name`,
      [agentId, property24Status, privatePropertyStatus]
    );

    if (updateRes.rows.length === 0) {
      return res.status(400).json({ error: 'Agent not found or is already inactive.' });
    }

    const agentName = updateRes.rows[0].full_name ?? `Agent #${agentId}`;

    // Safety cleanup: remove agent from any remaining secondary listing_agents rows
    // (covers listings that may have been missed or added since the withdrawal job ran)
    await pool.query(
      `DELETE FROM migration.listing_agents
       WHERE associate_id = $1
         AND is_primary = false`,
      [agentId]
    );

    // Write deregistration audit log
    await pool.query(
      `INSERT INTO migration.agent_deregistration_log
         (job_id, associate_id, associate_name, reason, requested_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [withdrawJobId, agentId, agentName, reason, req.user?.email ?? 'unknown']
    ).catch(() => undefined); // Non-fatal

    return res.json({ success: true, agentName, portalSync });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /reactivate
// Lightweight agent reactivation update used by MC Admin Tools.
// Body: {
//   agentId, first_name, last_name, full_name?, national_id?, kwuid?, ffc_number?,
//   kwsa_email?, private_email?, mobile_number?, office_number?,
//   source_market_center_id, cap?, agent_split?, start_date?
// }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/reactivate', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const b = req.body as Record<string, unknown>;
  const agentId = Number(b.agentId);
  const toText = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  };
  const toNumber = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toBool = (v: unknown): boolean => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      return t === 'true' || t === '1' || t === 'yes' || t === 'on';
    }
    return false;
  };

  if (!Number.isFinite(agentId) || agentId <= 0) {
    return res.status(400).json({ error: 'agentId is required.' });
  }

  const firstName = toText(b.first_name);
  const lastName = toText(b.last_name);
  const sourceMarketCenterId = toText(b.source_market_center_id);
  const property24OptIn = toBool(b.property24_opt_in);
  const privatePropertyOptIn = toBool(b.private_property_opt_in);
  const entegralOptIn = toBool(b.entegral_opt_in);
  const property24Status = property24OptIn ? 'Pending registration' : 'Not opted in';
  const privatePropertyStatus = privatePropertyOptIn ? 'Pending activation' : 'Not opted in';
  const entegralStatus = entegralOptIn ? 'Pending registration' : 'Not opted in';
  const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fullName = toText(b.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null);

  if (!fullName) {
    return res.status(400).json({ error: 'first_name and last_name (or full_name) are required.' });
  }
  if (!sourceMarketCenterId) {
    return res.status(400).json({ error: 'source_market_center_id is required.' });
  }

  // Office Admins can only reactivate into their own market centre.
  if (perms.isOfficeAdmin && !perms.isRegionalAdmin) {
    const hasAccess = await marketCenterIdsMatch(sourceMarketCenterId, officeAdminAllowedMcId(perms));
    if (!hasAccess) {
      return res.status(403).json({ error: 'Permission denied: you may only reactivate agents into your own market centre.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ source_market_center_id: string | null }>(
      `SELECT source_market_center_id
       FROM migration.core_associates
       WHERE id = $1
       LIMIT 1`,
      [agentId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Agent not found.' });
    }

    const mcLookup = await client.query<{ id: string }>(
      `SELECT id::text AS id
       FROM migration.core_market_centers
       WHERE source_market_center_id = $1
       LIMIT 1`,
      [sourceMarketCenterId]
    );
    const marketCenterId = mcLookup.rows[0]?.id ? Number(mcLookup.rows[0].id) : null;

    const result = await client.query<{ id: string; full_name: string | null }>(
      `UPDATE migration.core_associates
       SET
         source_market_center_id = $1,
         market_center_id = $2,
         first_name = $3,
         last_name = $4,
         full_name = $5,
         national_id = $6,
         kwuid = $7,
         ffc_number = $8,
         kwsa_email = $9,
         email = COALESCE($9, email),
         private_email = $10,
         mobile_number = $11,
         office_number = $12,
         cap = $13,
         agent_split = $14,
         start_date = $15::date,
         property24_opt_in = $16,
         agent_property24_id = NULL,
         property24_status = $17,
         private_property_opt_in = $18,
         private_property_status = $19,
         entegral_opt_in = $20,
         agent_entegral_id = NULL,
         entegral_status = $21,
         status_name = 'Active',
         updated_at = NOW()
       WHERE id = $22
       RETURNING id::text, full_name`,
      [
        sourceMarketCenterId,
        marketCenterId,
        firstName,
        lastName,
        fullName,
        toText(b.national_id),
        toText(b.kwuid),
        toText(b.ffc_number),
        toText(b.kwsa_email),
        toText(b.private_email),
        toText(b.mobile_number),
        toText(b.office_number),
        toNumber(b.cap),
        toNumber(b.agent_split),
        toText(b.start_date),
        property24OptIn,
        property24Status,
        privatePropertyOptIn,
        privatePropertyStatus,
        entegralOptIn,
        entegralStatus,
        agentId,
      ]
    );

    await client.query(
      `INSERT INTO migration.agent_reactivation_log
         (associate_id, associate_name, old_market_center_id, new_market_center_id, requested_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        agentId,
        result.rows[0]?.full_name ?? fullName,
        existing.rows[0].source_market_center_id,
        sourceMarketCenterId,
        req.user?.email ?? 'unknown',
      ]
    ).catch(() => undefined); // Non-fatal

    await client.query('COMMIT');
    return res.json({ success: true, id: result.rows[0]?.id ?? String(agentId) });
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Background withdrawal job processor
// ─────────────────────────────────────────────────────────────────────────────

async function runWithdrawalJob(
  job: WithdrawalJob,
  listingRows: Array<{ id: string; is_primary: boolean }>,
  agentId: number,
  token: string,
  activeContext: string | null,
): Promise<void> {
  const pool = getRequiredPgPool();
  job.status = 'running';

  for (const row of listingRows) {
    const listingId = Number(row.id);
    const result: ListingWithdrawalResult = {
      listingId: row.id,
      listingNumber: null,
      address: null,
      wasPrimary: row.is_primary,
      portals: [],
      error: null,
    };

    try {
      if (row.is_primary) {
        // ── Primary agent: full portal withdrawal ──────────────────────────
        const listingRes = await pool.query<{
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
          feed_to_kww: boolean | null;
          kww_property_reference: string | null;
          kww_ref1: string | null;
          feed_to_entegral: boolean | null;
          listing_payload: Record<string, unknown> | null;
        }>(
          `SELECT id::text, listing_number,
             address_line, street_number, street_name, suburb,
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
        result.address = listing.address_line ??
          ([listing.street_number, listing.street_name, listing.suburb].filter(Boolean).join(' ') || null);

        const hasP24Ref = !!(listing.property24_ref1?.trim() || listing.property24_ref2?.trim());
        const hasPpRef = !!(listing.private_property_ref1?.trim());
        const hasKwwRef = !!(listing.kww_property_reference?.trim() || listing.kww_ref1?.trim());
        const hasEntegralRef = !!(
          (listing.listing_payload as Record<string, unknown> | null)?.['EntegralId'] ||
          (listing.listing_payload as Record<string, unknown> | null)?.['entegral_id']
        );

        // Mark Withdrawn so portal endpoints see correct status
        await pool.query(
          `UPDATE migration.core_listings SET status_name = 'Withdrawn', updated_at = NOW() WHERE id = $1`,
          [listingId]
        );

        // Withdraw from each active portal
        if (hasP24Ref || listing.feed_to_property24) {
          const pr: PortalWithdrawalResult = { portal: 'Property24', withdrawOk: null, withdrawError: null };
          const r = await callListingApi(`/listings/${listingId}/publish-to-property24`, 'POST', token, {}, activeContext);
          pr.withdrawOk = r.ok;
          if (!r.ok) pr.withdrawError = extractApiError(r.body);
          result.portals.push(pr);
        }

        if (hasPpRef || listing.feed_to_private_property) {
          const pr: PortalWithdrawalResult = { portal: 'Private Property', withdrawOk: null, withdrawError: null };
          const r = await callListingApi(`/listings/${listingId}/publish-to-private-property`, 'POST', token, {}, activeContext);
          pr.withdrawOk = r.ok;
          if (!r.ok) pr.withdrawError = extractApiError(r.body);
          result.portals.push(pr);
        }

        if (hasKwwRef || listing.feed_to_kww) {
          const pr: PortalWithdrawalResult = { portal: 'KWW', withdrawOk: null, withdrawError: null };
          const r = await callListingApi(`/listings/${listingId}/publish-to-kww`, 'POST', token, {}, activeContext);
          pr.withdrawOk = r.ok;
          if (!r.ok) pr.withdrawError = extractApiError(r.body);
          result.portals.push(pr);
        }

        if (hasEntegralRef || listing.feed_to_entegral) {
          const pr: PortalWithdrawalResult = { portal: 'Entegral', withdrawOk: null, withdrawError: null };
          const r = await callListingApi(`/listings/${listingId}/publish-to-entegral`, 'POST', token, {}, activeContext);
          pr.withdrawOk = r.ok;
          if (!r.ok) pr.withdrawError = extractApiError(r.body);
          result.portals.push(pr);
        }

        // Mark permanently Inactive/Withdrawn
        await pool.query(
          `UPDATE migration.core_listings
             SET status_name = 'Inactive', listing_status_tag = 'Withdrawn',
                 is_published = false, is_draft = false, updated_at = NOW()
           WHERE id = $1`,
          [listingId]
        );

      } else {
        // ── Secondary/other agent: remove from listing_agents only ─────────
        const infoRes = await pool.query<{
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
          feed_to_kww: boolean | null;
          kww_property_reference: string | null;
          kww_ref1: string | null;
          feed_to_entegral: boolean | null;
          listing_payload: Record<string, unknown> | null;
        }>(
          `SELECT listing_number, address_line, street_number, street_name, suburb,
                  feed_to_property24, property24_ref1, property24_ref2,
                  feed_to_private_property, private_property_ref1,
                  feed_to_kww, kww_property_reference, kww_ref1,
                  feed_to_entegral, listing_payload
           FROM migration.core_listings WHERE id = $1 LIMIT 1`,
          [listingId]
        );

        if (infoRes.rows[0]) {
          result.listingNumber = infoRes.rows[0].listing_number;
          result.address = infoRes.rows[0].address_line ??
            ([infoRes.rows[0].street_number, infoRes.rows[0].street_name, infoRes.rows[0].suburb].filter(Boolean).join(' ') || null);
        }

        await pool.query(
          `DELETE FROM migration.listing_agents WHERE listing_id = $1 AND associate_id = $2`,
          [listingId, agentId]
        );

        // After removing a supporting agent locally, re-sync active portals so
        // the external listing agent roster no longer includes that agent.
        if (infoRes.rows[0]) {
          const portalResults = await syncListingToActivePortals(pool, listingId, token, activeContext);
          result.portals.push(...portalResults);
        }
      }

    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    job.results.push(result);
    job.completed += 1;
  }

  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /reactivation-log
// Writes an audit record after an agent is reactivated.
// Body: { agentId, agentName, oldMarketCenterId, newMarketCenterId }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/reactivation-log', resolvePermissions, async (req, res) => {
  const pool = getRequiredPgPool();
  const perms = req.permissions!;

  if (!checkAdminPermission(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const b = req.body as Record<string, unknown>;
  const agentId = Number(b.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return res.status(400).json({ error: 'agentId is required.' });
  }

  try {
    await pool.query(
      `INSERT INTO migration.agent_reactivation_log
         (associate_id, associate_name, old_market_center_id, new_market_center_id, requested_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        agentId,
        typeof b.agentName === 'string' ? b.agentName : null,
        typeof b.oldMarketCenterId === 'string' ? b.oldMarketCenterId : null,
        typeof b.newMarketCenterId === 'string' ? b.newMarketCenterId : null,
        req.user?.email ?? 'unknown',
      ]
    ).catch(() => undefined); // Non-fatal

    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
});

export default router;
