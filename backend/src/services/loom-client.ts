import crypto from 'node:crypto';
import axios from 'axios';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOOM_IDP_URL = env.loom.idpUrl;
const LOOM_API_BASE = env.loom.apiBaseUrl;

// ---------------------------------------------------------------------------
// DB — self-creating token table
// ---------------------------------------------------------------------------

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.loom_user_tokens (
    id                SERIAL PRIMARY KEY,
    user_email        TEXT NOT NULL UNIQUE,
    access_enc        TEXT NOT NULL,
    refresh_enc       TEXT,
    expires_at        TIMESTAMPTZ,
    loom_email        TEXT,
    consent_accepted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS loom_user_tokens_email_idx
    ON public.loom_user_tokens (user_email);
  -- Migrate existing tables that lack consent_accepted
  ALTER TABLE public.loom_user_tokens ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN NOT NULL DEFAULT FALSE;
`;

let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await getRequiredPgPool().query(ENSURE_TABLE_SQL);
  _tableReady = true;
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for tokens at rest
// ---------------------------------------------------------------------------

function encKey(): Buffer {
  const raw = env.loom.tokenEncryptionKey;
  // Accept 64-char hex (= 32 bytes) or fall back to UTF-8 padded to 32 bytes
  if (raw.length >= 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw.slice(0, 64), 'hex');
  }
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decryptToken(data: string): string {
  const parts = data.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return (
    decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') +
    decipher.final('utf8')
  );
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

export interface LoomToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  loomEmail: string | null;
  consentAccepted?: boolean;
}

export async function saveToken(userEmail: string, t: LoomToken): Promise<void> {
  await ensureTable();
  await getRequiredPgPool().query(
    `INSERT INTO public.loom_user_tokens
       (user_email, access_enc, refresh_enc, expires_at, loom_email, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_email) DO UPDATE SET
       access_enc  = EXCLUDED.access_enc,
       refresh_enc = EXCLUDED.refresh_enc,
       expires_at  = EXCLUDED.expires_at,
       loom_email  = EXCLUDED.loom_email,
       updated_at  = NOW()`,
    [
      userEmail,
      encryptToken(t.accessToken),
      t.refreshToken ? encryptToken(t.refreshToken) : null,
      t.expiresAt,
      t.loomEmail,
    ],
  );
}

export async function loadToken(userEmail: string): Promise<LoomToken | null> {
  await ensureTable();
  const { rows } = await getRequiredPgPool().query(
    `SELECT access_enc, refresh_enc, expires_at, loom_email, consent_accepted
     FROM public.loom_user_tokens WHERE user_email = $1`,
    [userEmail],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    accessToken: decryptToken(r.access_enc as string),
    refreshToken: r.refresh_enc ? decryptToken(r.refresh_enc as string) : null,
    expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
    loomEmail: r.loom_email as string | null,
    consentAccepted: (r.consent_accepted as boolean) ?? false,
  };
}

export async function setConsentAccepted(userEmail: string): Promise<void> {
  await ensureTable();
  await getRequiredPgPool().query(
    `UPDATE public.loom_user_tokens SET consent_accepted = TRUE, updated_at = NOW()
     WHERE user_email = $1`,
    [userEmail],
  );
}

export async function removeToken(userEmail: string): Promise<void> {
  await ensureTable();
  await getRequiredPgPool().query(
    `DELETE FROM public.loom_user_tokens WHERE user_email = $1`,
    [userEmail],
  );
}

// ---------------------------------------------------------------------------
// OAuth — authorization code flow
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function decodeJwtIssuer(token: string): string | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { iss?: string };
    return parsed.iss ?? null;
  } catch {
    return null;
  }
}

function sameIssuerHost(lhs: string, rhs: string): boolean {
  try {
    return new URL(lhs).host.toLowerCase() === new URL(rhs).host.toLowerCase();
  } catch {
    return false;
  }
}

async function reacquireAndSaveClientCredentialsToken(
  userEmail: string,
  loomEmail: string | null,
): Promise<string> {
  const fresh = await acquireTokenRopc();
  const newExpiry = fresh.expires_in
    ? new Date(Date.now() + fresh.expires_in * 1000)
    : null;
  await saveToken(userEmail, {
    accessToken: fresh.access_token,
    refreshToken: null,
    expiresAt: newExpiry,
    loomEmail,
  });
  return fresh.access_token;
}

async function requestToken(body: URLSearchParams, context: string): Promise<TokenResponse> {
  try {
    const res = await axios.post<TokenResponse>(
      `${LOOM_IDP_URL}/connect/token`,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        validateStatus: () => true,
      },
    );
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 504) {
        throw new Error('LOOM identity service timed out (504). Please try again in a few minutes.');
      }
      throw new Error(`${context} failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('LOOM identity service timed out. Please try again in a few minutes.');
      }
      const detail = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? error.message);
      throw new Error(`${context} failed: ${error.response?.status ?? 'timeout'} ${detail}`);
    }
    throw error;
  }
}

export function buildLoomAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.loom.clientId,
    response_type: 'code',
    scope: 'openid profile email ibilling-api offline_access',
    redirect_uri: env.loom.callbackUrl,
    state,
  });
  return `${LOOM_IDP_URL}/connect/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.loom.callbackUrl,
    client_id: env.loom.clientId,
    client_secret: env.loom.clientSecret,
  });
  return requestToken(body, 'LOOM token exchange');
}

/**
 * Acquire a token using Resource Owner Password Credentials (ROPC) grant.
 * Used for service accounts where no browser redirect is needed.
 */
export async function acquireTokenRopc(): Promise<TokenResponse> {
  // Try client_credentials first (service account — no user interaction)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.loom.clientId,
    client_secret: env.loom.clientSecret,
    scope: 'ibilling-api',
  });
  return requestToken(body, 'LOOM ROPC token');
}

async function doRefreshToken(rt: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: env.loom.clientId,
    client_secret: env.loom.clientSecret,
  });
  return requestToken(body, 'LOOM token refresh');
}

// ---------------------------------------------------------------------------
// Access token resolver (auto-refresh)
// ---------------------------------------------------------------------------

async function resolveAccessToken(userEmail: string): Promise<string> {
  const stored = await loadToken(userEmail);
  // If user has no token (e.g., new user), try to use service account token
  if (!stored) {
    // Try to load service account token
    const serviceAcctEmail = '_service_account_';
    const serviceStored = await loadToken(serviceAcctEmail);
    if (!serviceStored) {
      // No service account token either — acquire one and cache it
      const fresh = await acquireTokenRopc();
      const newExpiry = fresh.expires_in
        ? new Date(Date.now() + fresh.expires_in * 1000)
        : null;
      await saveToken(serviceAcctEmail, {
        accessToken: fresh.access_token,
        refreshToken: null,
        expiresAt: newExpiry,
        loomEmail: null,
      });
      return fresh.access_token;
    }
    // Check if service account token is still valid
    const issuer = decodeJwtIssuer(serviceStored.accessToken);
    if (issuer && !sameIssuerHost(issuer, LOOM_IDP_URL)) {
      console.warn('[LOOM] Service account token issuer mismatch. Reacquiring...');
      return reacquireAndSaveClientCredentialsToken(serviceAcctEmail, null);
    }
    if (serviceStored.expiresAt && Date.now() > serviceStored.expiresAt.getTime() - 60_000) {
      const fresh = await acquireTokenRopc();
      const newExpiry = fresh.expires_in
        ? new Date(Date.now() + fresh.expires_in * 1000)
        : null;
      await saveToken(serviceAcctEmail, {
        accessToken: fresh.access_token,
        refreshToken: null,
        expiresAt: newExpiry,
        loomEmail: null,
      });
      return fresh.access_token;
    }
    return serviceStored.accessToken;
  }

  // If a token from a different LOOM environment is cached (e.g. prod token while now on QA),
  // reacquire immediately so calls don't fail with 401.
  const issuer = decodeJwtIssuer(stored.accessToken);
  if (issuer && !sameIssuerHost(issuer, LOOM_IDP_URL)) {
    console.warn('[LOOM] Cached token issuer mismatch. Reacquiring token for:', LOOM_IDP_URL);
    return reacquireAndSaveClientCredentialsToken(userEmail, stored.loomEmail);
  }

  // Refresh if token expires within the next 60 seconds
  if (stored.refreshToken && stored.expiresAt) {
    if (Date.now() > stored.expiresAt.getTime() - 60_000) {
      const fresh = await doRefreshToken(stored.refreshToken);
      const newExpiry = fresh.expires_in
        ? new Date(Date.now() + fresh.expires_in * 1000)
        : null;
      await saveToken(userEmail, {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token ?? stored.refreshToken,
        expiresAt: newExpiry,
        loomEmail: stored.loomEmail,
      });
      return fresh.access_token;
    }
  }
  // No refresh token (client_credentials flow) — re-acquire if expired or expiring soon
  if (!stored.refreshToken && stored.expiresAt) {
    if (Date.now() > stored.expiresAt.getTime() - 60_000) {
      const fresh = await acquireTokenRopc();
      const newExpiry = fresh.expires_in
        ? new Date(Date.now() + fresh.expires_in * 1000)
        : null;
      await saveToken(userEmail, {
        accessToken: fresh.access_token,
        refreshToken: null,
        expiresAt: newExpiry,
        loomEmail: stored.loomEmail,
      });
      return fresh.access_token;
    }
  }
  return stored.accessToken;
}

// ---------------------------------------------------------------------------
// Per-request headers for LOOM API
// ---------------------------------------------------------------------------

function loomHeaders(accessToken: string, headerEmail = env.loom.integrationEmail): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    userEmail: headerEmail,
    // Some LOOM environments/documentation refer to "Username".
    // We send both for compatibility across QA/prod gateways.
    Username: headerEmail,
    Accept: 'application/json',
  };
  if (env.loom.clientIdentifier) {
    headers.clientIdentifier = env.loom.clientIdentifier;
  }
  return headers;
}

function readAbpErrorMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const err = parsed.error as Record<string, unknown> | undefined;
    const message = typeof err?.message === 'string' ? err.message : null;
    const details = typeof err?.details === 'string' ? err.details : null;
    return message ?? details;
  } catch {
    return null;
  }
}

function isNoMatchingUserMessage(msg: string | null): boolean {
  return typeof msg === 'string' && /no\s+matching\s+user\s+found/i.test(msg);
}

// ---------------------------------------------------------------------------
// API call wrappers
// ---------------------------------------------------------------------------

export async function loomGet(
  userEmail: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<unknown> {
  let token = await resolveAccessToken(userEmail);
  let headerEmail = env.loom.integrationEmail;
  const url = new URL(`${LOOM_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  let res = await fetch(url.toString(), { headers: loomHeaders(token, headerEmail) });
  if (res.status === 401) {
    // One retry with a fresh token handles revoked/stale tokens without requiring manual reconnect.
    token = await reacquireAndSaveClientCredentialsToken(userEmail, env.loom.integrationEmail);
    res = await fetch(url.toString(), { headers: loomHeaders(token, headerEmail) });
  }
  let text = await res.text();
  if (!res.ok && userEmail && userEmail !== headerEmail) {
    const errMsg = readAbpErrorMessage(text);
    if (isNoMatchingUserMessage(errMsg)) {
      headerEmail = userEmail;
      res = await fetch(url.toString(), { headers: loomHeaders(token, headerEmail) });
      text = await res.text();
    }
  }
  if (!res.ok) {
    // Try to parse as JSON — LOOM ABP always returns JSON even for errors
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const abp = parsed as Record<string, unknown> | null;
    const errMsg = (abp?.error as Record<string, unknown> | undefined)?.message as string | undefined;
    const errDetail = (abp?.error as Record<string, unknown> | undefined)?.details as string | undefined;
    const msg = errMsg ?? errDetail ?? `LOOM GET ${path}: ${res.status} ${text.slice(0, 200)}`;
    console.error(`[LOOM] GET ${path} → ${res.status}:`, msg);
    const err = new Error(msg) as Error & { loomStatus: number; loomPayload: unknown };
    err.loomStatus = res.status;
    err.loomPayload = parsed;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LOOM GET ${path}: invalid JSON response`);
  }
}

export async function loomPost(
  userEmail: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let token = await resolveAccessToken(userEmail);
  let headerEmail = env.loom.integrationEmail;
  let res = await fetch(`${LOOM_API_BASE}${path}`, {
    method: 'POST',
    headers: { ...loomHeaders(token, headerEmail), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    token = await reacquireAndSaveClientCredentialsToken(userEmail, env.loom.integrationEmail);
    res = await fetch(`${LOOM_API_BASE}${path}`, {
      method: 'POST',
      headers: { ...loomHeaders(token, headerEmail), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  let text = await res.text();
  if (!res.ok && userEmail && userEmail !== headerEmail) {
    const errMsg = readAbpErrorMessage(text);
    if (isNoMatchingUserMessage(errMsg)) {
      headerEmail = userEmail;
      res = await fetch(`${LOOM_API_BASE}${path}`, {
        method: 'POST',
        headers: { ...loomHeaders(token, headerEmail), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      text = await res.text();
    }
  }
  if (!res.ok) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const abp = parsed as Record<string, unknown> | null;
    const errMsg = (abp?.error as Record<string, unknown> | undefined)?.message as string | undefined;
    const errDetail = (abp?.error as Record<string, unknown> | undefined)?.details as string | undefined;
    const msg = errMsg ?? errDetail ?? `LOOM POST ${path}: ${res.status} ${text.slice(0, 200)}`;
    console.error(`[LOOM] POST ${path} → ${res.status}:`, msg);
    const err = new Error(msg) as Error & { loomStatus: number; loomPayload: unknown };
    err.loomStatus = res.status;
    err.loomPayload = parsed;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LOOM POST ${path}: invalid JSON response`);
  }
}

export async function loomDelete(
  userEmail: string,
  path: string,
): Promise<unknown> {
  const token = await resolveAccessToken(userEmail);
  const res = await fetch(`${LOOM_API_BASE}${path}`, {
    method: 'DELETE',
    headers: loomHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`LOOM DELETE ${path}: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : { ok: true };
}

export async function loomGetBinary(
  userEmail: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  let token = await resolveAccessToken(userEmail);
  let headerEmail = env.loom.integrationEmail;
  const url = new URL(`${LOOM_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  let res = await fetch(url.toString(), {
    headers: {
      ...loomHeaders(token, headerEmail),
      Accept: 'application/octet-stream, application/pdf, */*',
    },
  });
  if (res.status === 401) {
    token = await reacquireAndSaveClientCredentialsToken(userEmail, env.loom.integrationEmail);
    res = await fetch(url.toString(), {
      headers: {
        ...loomHeaders(token, headerEmail),
        Accept: 'application/octet-stream, application/pdf, */*',
      },
    });
  }
  if (!res.ok && userEmail && userEmail !== headerEmail) {
    const errText = await res.text();
    const errMsg = readAbpErrorMessage(errText) ?? errText;
    if (isNoMatchingUserMessage(errMsg)) {
      headerEmail = userEmail;
      res = await fetch(url.toString(), {
        headers: {
          ...loomHeaders(token, headerEmail),
          Accept: 'application/octet-stream, application/pdf, */*',
        },
      });
    } else {
      throw new Error(`LOOM binary ${path}: ${res.status} ${errText}`);
    }
  }
  if (!res.ok) {
    throw new Error(`LOOM binary ${path}: ${res.status} ${await res.text()}`);
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const disposition = res.headers.get('content-disposition') ?? '';
  const nameMatch = /filename="?([^";\n]+)"?/i.exec(disposition);
  const fileName = nameMatch?.[1] ?? 'loom-report.pdf';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, fileName };
}
