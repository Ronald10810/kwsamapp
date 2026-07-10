import crypto from 'node:crypto';
import { google } from 'googleapis';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';

const TOKEN_TABLE = 'app.gmail_user_tokens';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
  'profile',
] as const;

const ENSURE_TABLE_SQL = `
  CREATE SCHEMA IF NOT EXISTS app;

  CREATE TABLE IF NOT EXISTS ${TOKEN_TABLE} (
    id BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL UNIQUE,
    google_subject TEXT,
    connected_email TEXT,
    access_enc TEXT,
    refresh_enc TEXT,
    expires_at TIMESTAMPTZ,
    scope_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS gmail_user_tokens_email_idx
    ON ${TOKEN_TABLE}(user_email);
`;

let tableReady = false;

function getOAuthClient() {
  if (!env.communications.googleClientId || !env.communications.googleClientSecret || !env.communications.googleRedirectUri) {
    throw new Error('Communications Gmail OAuth is not fully configured.');
  }

  return new google.auth.OAuth2(
    env.communications.googleClientId,
    env.communications.googleClientSecret,
    env.communications.googleRedirectUri,
  );
}

function encryptionKey(): Buffer {
  const raw = env.communications.tokenEncryptionKey;
  if (raw.length >= 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw.slice(0, 64), 'hex');
  }
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}

function encryptValue(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decryptValue(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getRequiredPgPool().query(ENSURE_TABLE_SQL);
  tableReady = true;
}

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    env.communications.googleClientId
    && env.communications.googleClientSecret
    && env.communications.googleRedirectUri
  );
}

export function buildGmailAuthUrl(state: string): string {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [...GMAIL_SCOPES],
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
}> {
  const { tokens } = await getOAuthClient().getToken(code);
  if (!tokens.access_token) {
    throw new Error('Google token exchange did not return an access token.');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  sub: string;
  email: string;
}> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google user profile (${response.status}).`);
  }

  const body = await response.json() as { sub?: string; email?: string };
  if (!body.sub || !body.email) {
    throw new Error('Google user profile was missing email identity.');
  }

  return { sub: body.sub, email: body.email };
}

export async function saveGmailToken(input: {
  userEmail: string;
  googleSubject: string;
  connectedEmail: string;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
}): Promise<void> {
  await ensureTable();

  const existing = await loadGmailToken(input.userEmail);
  const refreshToken = input.refreshToken ?? existing?.refreshToken ?? null;

  await getRequiredPgPool().query(
    `INSERT INTO ${TOKEN_TABLE}
       (user_email, google_subject, connected_email, access_enc, refresh_enc, expires_at, scope_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_email) DO UPDATE SET
       google_subject = EXCLUDED.google_subject,
       connected_email = EXCLUDED.connected_email,
       access_enc = EXCLUDED.access_enc,
       refresh_enc = EXCLUDED.refresh_enc,
       expires_at = EXCLUDED.expires_at,
       scope_text = EXCLUDED.scope_text,
       updated_at = NOW()`,
    [
      input.userEmail,
      input.googleSubject,
      input.connectedEmail,
      encryptValue(input.accessToken),
      refreshToken ? encryptValue(refreshToken) : null,
      input.expiryDate ? new Date(input.expiryDate) : null,
      input.scope,
    ],
  );
}

export async function loadGmailToken(userEmail: string): Promise<null | {
  connectedEmail: string | null;
  googleSubject: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  updatedAt: string;
}> {
  await ensureTable();
  const result = await getRequiredPgPool().query<{
    google_subject: string | null;
    connected_email: string | null;
    access_enc: string | null;
    refresh_enc: string | null;
    expires_at: string | null;
    scope_text: string | null;
    updated_at: string;
  }>(
    `SELECT google_subject, connected_email, access_enc, refresh_enc, expires_at, scope_text, updated_at
       FROM ${TOKEN_TABLE}
      WHERE user_email = $1`,
    [userEmail.toLowerCase()],
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    connectedEmail: row.connected_email,
    googleSubject: row.google_subject,
    accessToken: row.access_enc ? decryptValue(row.access_enc) : null,
    refreshToken: row.refresh_enc ? decryptValue(row.refresh_enc) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scope: row.scope_text,
    updatedAt: row.updated_at,
  };
}

export async function removeGmailToken(userEmail: string): Promise<void> {
  await ensureTable();
  await getRequiredPgPool().query(`DELETE FROM ${TOKEN_TABLE} WHERE user_email = $1`, [userEmail.toLowerCase()]);
}

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function sendGmailHtmlEmail(input: {
  userEmail: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ connectedEmail: string | null }> {
  const existing = await loadGmailToken(input.userEmail);
  if (!existing) {
    throw new Error('Connect Gmail before sending email.');
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({
    access_token: existing.accessToken ?? undefined,
    refresh_token: existing.refreshToken ?? undefined,
    expiry_date: existing.expiresAt?.getTime(),
  });

  const refreshed = await oauthClient.getAccessToken();
  const accessToken = refreshed.token ?? existing.accessToken;
  if (!accessToken) {
    throw new Error('Unable to refresh Gmail access token. Reconnect Gmail and try again.');
  }

  await saveGmailToken({
    userEmail: input.userEmail,
    googleSubject: existing.googleSubject ?? '',
    connectedEmail: existing.connectedEmail ?? input.userEmail,
    accessToken,
    refreshToken: existing.refreshToken,
    expiryDate: oauthClient.credentials.expiry_date ?? existing.expiresAt?.getTime() ?? null,
    scope: existing.scope,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  const fromAddress = existing.connectedEmail ?? input.userEmail;
  const mime = [
    `To: ${input.to}`,
    `From: ${fromAddress}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    input.html,
  ].join('\r\n');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: toBase64Url(mime),
    },
  });

  return { connectedEmail: existing.connectedEmail };
}