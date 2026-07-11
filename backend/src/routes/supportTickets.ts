import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { resolvePermissions } from '../middleware/permissions.js';
import { storageConfig, resolveLocalUploadDir, ensureLocalUploadDirs } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';

const router = Router();

const SUPPORT_MAILBOX = 'support@kwsa.co.za';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const LINK_TYPES = ['listing', 'transaction', 'associate', 'agent', 'market_centre'] as const;

type LinkType = (typeof LINK_TYPES)[number];

const listSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  sourceMarketCenterId: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const dashboardSchema = z.object({
  sourceMarketCenterId: z.string().trim().min(1).max(64).optional(),
});

const createSchema = z.object({
  sourceMarketCenterId: z.string().trim().min(1).max(64).optional(),
  sourceMarketCenterName: z.string().trim().min(1).max(120).optional(),
  section: z.string().trim().min(2).max(100),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(8000),
  priority: z.enum(TICKET_PRIORITIES).default('MEDIUM'),
  linkedEntityType: z.enum(LINK_TYPES).optional(),
  linkedEntityId: z.string().trim().min(1).max(120).optional(),
});

const statusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(4000).optional(),
});

const assignmentSchema = z.object({
  allocatedToEmail: z.string().trim().email().max(320).optional().nullable(),
});

const commentSchema = z.object({
  message: z.string().trim().min(1).max(8000),
});

const linkedSearchSchema = z.object({
  type: z.enum(LINK_TYPES),
  q: z.string().trim().min(2).max(120),
  sourceMarketCenterId: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

const attachmentSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

const normalizedSql = (valueSql: string): string =>
  `REGEXP_REPLACE(LOWER(TRIM(COALESCE(${valueSql}, ''))), '[^a-z0-9]+', '', 'g')`;

function canUseSupportTickets(perms: NonNullable<Express.Request['permissions']>): boolean {
  return perms.isOfficeAdmin || perms.isRegionalAdmin;
}

function canUpdateStatus(perms: NonNullable<Express.Request['permissions']>): boolean {
  return perms.isRegionalAdmin;
}

function canCreateTicket(perms: NonNullable<Express.Request['permissions']>): boolean {
  return perms.isOfficeAdmin;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveFirstName(nameOrEmail: string | null | undefined): string {
  const raw = String(nameOrEmail ?? '').trim();
  if (!raw) return 'there';
  if (raw.includes('@')) {
    const local = raw.split('@')[0] ?? '';
    const cleaned = local.replace(/[._-]+/g, ' ').trim();
    const first = cleaned.split(/\s+/)[0] ?? '';
    if (!first) return 'there';
    return first.charAt(0).toUpperCase() + first.slice(1);
  }
  const first = raw.split(/\s+/)[0] ?? '';
  return first || 'there';
}

function resolveDisplayName(nameOrEmail: string | null | undefined, emailFallback: string | null | undefined): string {
  const raw = String(nameOrEmail ?? '').trim();
  if (raw && !raw.includes('@')) return raw;

  const source = raw || String(emailFallback ?? '').trim();
  if (!source) return 'Unknown User';

  const localPart = source.includes('@') ? (source.split('@')[0] ?? source) : source;
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
  const titleCased = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  return titleCased || source;
}

function appBaseUrl(): string {
  const origin = env.corsOrigins[0]?.trim();
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  return 'http://localhost:5174';
}

function entityPath(type: LinkType, id: string): string {
  const encoded = encodeURIComponent(id);
  if (type === 'listing') return `/listings?review=${encoded}`;
  if (type === 'transaction') return `/transactions?edit=${encoded}`;
  if (type === 'associate' || type === 'agent') return `/agents?edit=${encoded}`;
  return `/market-centers?search=${encoded}`;
}

async function resolveMarketCentreName(sourceMarketCentreId: string): Promise<string> {
  const pool = getRequiredPgPool();
  const result = await pool.query<{ name: string | null }>(
    `SELECT COALESCE(NULLIF(TRIM(mc.name), ''), mc.source_market_center_id) AS name
       FROM migration.core_market_centers mc
      WHERE mc.source_market_center_id = $1 OR mc.id::text = $1
      ORDER BY CASE WHEN mc.source_market_center_id = $1 THEN 0 ELSE 1 END,
               mc.name ASC NULLS LAST
      LIMIT 1`,
    [sourceMarketCentreId],
  );
  return result.rows[0]?.name?.trim() || sourceMarketCentreId;
}

function normalizeLinkedPathForEdit(linkedPath: string | null): string | null {
  if (!linkedPath) return null;
  try {
    const url = new URL(linkedPath, 'http://local.invalid');
    const pathname = url.pathname;
    const search = url.searchParams;

    if (pathname === '/listings' && search.get('search') && !search.get('review')) {
      search.set('review', search.get('search') ?? '');
      search.delete('search');
      const query = search.toString();
      return `${pathname}${query ? `?${query}` : ''}`;
    }

    if (pathname === '/transactions' && search.get('search') && !search.get('edit')) {
      search.set('edit', search.get('search') ?? '');
      search.delete('search');
      const query = search.toString();
      return `${pathname}${query ? `?${query}` : ''}`;
    }

    if (pathname === '/associates' && search.get('search')) {
      const query = `edit=${encodeURIComponent(search.get('search') ?? '')}`;
      return `/agents?${query}`;
    }

    return linkedPath;
  } catch {
    return linkedPath;
  }
}

function requiredLinkedTypeForSection(section: string): LinkType | null {
  const normalized = String(section).trim().toLowerCase();
  if (normalized === 'listings') return 'listing';
  if (normalized === 'transactions') return 'transaction';
  if (normalized === 'associates') return 'associate';
  return null;
}

function supportEmailBranding(): {
  logoHtml: string;
  attachments?: Array<{
    filename: string;
    path: string;
    cid: string;
    contentType?: string;
    contentDisposition?: 'inline';
  }>;
} {
  if (env.support.logoPath && fs.existsSync(env.support.logoPath)) {
    const cid = 'kwsa-support-logo';
    return {
      logoHtml: `<img src="cid:${cid}" alt="KW South Africa" style="display:block; max-width:220px; max-height:62px; width:auto; height:auto; margin-left:auto; object-fit:contain;" />`,
      attachments: [
        {
          filename: path.basename(env.support.logoPath),
          path: env.support.logoPath,
          cid,
          contentType: 'image/png',
          contentDisposition: 'inline',
        },
      ],
    };
  }

  if (env.support.logoUrl) {
    return {
      logoHtml: `<img src="${escapeHtml(env.support.logoUrl)}" alt="KW South Africa" style="display:block; max-width:220px; max-height:62px; width:auto; height:auto; margin-left:auto; object-fit:contain;" />`,
    };
  }

  return {
    logoHtml: `
      <div style="display:inline-flex; align-items:center; justify-content:center; width:120px; height:62px; border:1px solid rgba(255,255,255,0.35); border-radius:10px; color:#ffffff; font-size:34px; font-weight:800; letter-spacing:0.02em; margin-left:auto;">
        KW
      </div>
      <div style="margin-top:6px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff; opacity:0.9; text-align:right;">KW South Africa</div>
    `,
  };
}

function emailStatusLabel(status: string): string {
  if (status === 'OPEN') return 'Open';
  if (status === 'IN_PROGRESS' || status === 'WAITING_CUSTOMER') return 'Pending';
  if (status === 'RESOLVED' || status === 'CLOSED') return 'Closed';
  return status.replace(/_/g, ' ');
}

function buildSupportEmailShell(input: {
  headline: string;
  bodyHtml: string;
  logoHtml: string;
}): string {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background:#f3f6fa; padding:24px; color:#0f172a;">
      <table role="presentation" style="width:100%; max-width:860px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; border-collapse:collapse;">
        <tr>
          <td style="background:#0b1837; padding:16px 20px; color:#ffffff;">
            <table role="presentation" style="width:100%; border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:12px; letter-spacing:0.08em; text-transform:uppercase; opacity:0.9;">MAPP Support</div>
                  <div style="margin-top:6px; font-size:32px; font-weight:700; line-height:1.2;">${escapeHtml(input.headline)}</div>
                </td>
                <td style="width:240px; text-align:right; vertical-align:middle;">
                  ${input.logoHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 22px 20px 22px; vertical-align:top;">
            ${input.bodyHtml}
            <div style="margin-top:24px; border-top:1px solid #e2e8f0; padding-top:14px; font-size:12px; color:#64748b; line-height:1.5;">
              Regards,<br />
              The MAPP Support Team
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function resolveSourceMarketCenterId(
  perms: NonNullable<Express.Request['permissions']>,
  requestedSourceMc: string | undefined,
): string | null {
  const requested = String(requestedSourceMc ?? '').trim();
  if (perms.isOfficeAdmin) {
    const scoped = perms.marketCenterId ?? perms.homeMcId;
    if (scoped) return scoped;
    return requested || null;
  }
  if (requested) return requested;
  return perms.marketCenterId ?? perms.homeMcId;
}

function applyScopeFilter(
  perms: NonNullable<Express.Request['permissions']>,
  sourceMcSql: string,
  whereClauses: string[],
  params: unknown[],
  requestedMc?: string,
): void {
  if (perms.isRegionalAdmin) {
    const requested = String(requestedMc ?? '').trim();
    if (requested) {
      params.push(requested);
      whereClauses.push(`${normalizedSql(sourceMcSql)} = ${normalizedSql(`$${params.length}`)}`);
    }
    return;
  }

  const allowedMc = perms.marketCenterId ?? perms.homeMcId;
  if (!allowedMc) {
    whereClauses.push('1 = 0');
    return;
  }

  params.push(allowedMc);
  whereClauses.push(`${normalizedSql(sourceMcSql)} = ${normalizedSql(`$${params.length}`)}`);
}

async function ensureTables(): Promise<void> {
  const pool = getRequiredPgPool();
  await pool.query('CREATE SCHEMA IF NOT EXISTS app');
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS app.support_ticket_number_seq START 1 INCREMENT 1
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.support_tickets (
      id BIGSERIAL PRIMARY KEY,
      ticket_number TEXT NOT NULL UNIQUE,
      source_market_center_id TEXT NOT NULL,
      section TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      created_by_email TEXT NOT NULL,
      created_by_name TEXT,
      linked_entity_type TEXT,
      linked_entity_id TEXT,
      linked_entity_label TEXT,
      linked_entity_path TEXT,
      allocated_to_email TEXT,
      allocated_to_name TEXT,
      resolved_by_email TEXT,
      resolved_by_name TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS source_market_center_id TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS section TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS status TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS priority TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS created_by_email TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS linked_entity_type TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS linked_entity_id TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS linked_entity_label TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS linked_entity_path TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS allocated_to_email TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS allocated_to_name TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS resolved_by_email TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS resolved_by_name TEXT`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE app.support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await pool.query(`UPDATE app.support_tickets SET status = 'OPEN' WHERE status IS NULL OR BTRIM(status) = ''`);
  await pool.query(`UPDATE app.support_tickets SET priority = 'MEDIUM' WHERE priority IS NULL OR BTRIM(priority) = ''`);
  await pool.query(`UPDATE app.support_tickets SET created_at = NOW() WHERE created_at IS NULL`);
  await pool.query(`UPDATE app.support_tickets SET updated_at = NOW() WHERE updated_at IS NULL`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN source_market_center_id SET DEFAULT ''`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN section SET DEFAULT 'Other'`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN title SET DEFAULT 'Untitled ticket'`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN description SET DEFAULT ''`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN status SET DEFAULT 'OPEN'`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN priority SET DEFAULT 'MEDIUM'`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN created_by_email SET DEFAULT 'unknown@kwsa.co.za'`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN created_at SET DEFAULT NOW()`);
  await pool.query(`ALTER TABLE app.support_tickets ALTER COLUMN updated_at SET DEFAULT NOW()`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_tickets_mc_idx
      ON app.support_tickets (source_market_center_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_tickets_status_idx
      ON app.support_tickets (status, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.support_ticket_activity (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES app.support_tickets(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      body TEXT,
      status_from TEXT,
      status_to TEXT,
      actor_email TEXT,
      actor_name TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS ticket_id BIGINT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS activity_type TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS body TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS status_from TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS status_to TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS actor_email TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS actor_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS created_by_email TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS metadata_json JSONB`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
  await pool.query(`UPDATE app.support_ticket_activity SET created_by_email = COALESCE(created_by_email, actor_email, 'unknown@kwsa.co.za') WHERE created_by_email IS NULL`);
  await pool.query(`UPDATE app.support_ticket_activity SET created_by_name = COALESCE(created_by_name, actor_name) WHERE created_by_name IS NULL`);
  await pool.query(`UPDATE app.support_ticket_activity SET created_at = NOW() WHERE created_at IS NULL`);
  await pool.query(`ALTER TABLE app.support_ticket_activity ALTER COLUMN created_at SET DEFAULT NOW()`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_ticket_activity_ticket_idx
      ON app.support_ticket_activity (ticket_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.support_ticket_attachments (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES app.support_tickets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      file_size BIGINT,
      file_url TEXT NOT NULL,
      gcs_object_name TEXT,
      local_file_path TEXT,
      note TEXT,
      uploaded_by_email TEXT,
      uploaded_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS ticket_id BIGINT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS file_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS mime_type TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS file_size BIGINT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS file_url TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS gcs_object_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS local_file_path TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS note TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS uploaded_by_email TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS uploaded_by_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS created_by_email TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS created_by_name TEXT`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
  await pool.query(`UPDATE app.support_ticket_attachments SET created_by_email = COALESCE(created_by_email, uploaded_by_email, 'unknown@kwsa.co.za') WHERE created_by_email IS NULL`);
  await pool.query(`UPDATE app.support_ticket_attachments SET created_by_name = COALESCE(created_by_name, uploaded_by_name) WHERE created_by_name IS NULL`);
  await pool.query(`UPDATE app.support_ticket_attachments SET created_at = NOW() WHERE created_at IS NULL`);
  await pool.query(`ALTER TABLE app.support_ticket_attachments ALTER COLUMN created_at SET DEFAULT NOW()`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_ticket_attachments_ticket_idx
      ON app.support_ticket_attachments (ticket_id, created_at DESC)
  `);
}

await ensureTables().catch(() => undefined);

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getMailer(): ReturnType<typeof nodemailer.createTransport> {
  if (smtpTransport) return smtpTransport;
  if (!env.support.smtpUser || !env.support.smtpPass) {
    throw new Error('Support SMTP credentials are not configured.');
  }
  smtpTransport = nodemailer.createTransport({
    host: env.support.smtpHost,
    port: env.support.smtpPort,
    secure: env.support.smtpSecure,
    auth: {
      user: env.support.smtpUser,
      pass: env.support.smtpPass,
    },
  });
  return smtpTransport;
}

async function sendSupportTicketCreatedEmail(input: {
  ticketNumber: string;
  section: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  sourceMarketCenterId: string;
  sourceMarketCenterName: string;
  linkedLabel: string | null;
  linkedPath: string | null;
  createdByEmail: string;
  createdByName: string | null;
}): Promise<{ sent: boolean; error?: string; messageId?: string }> {
  if (!env.support.enabled) return { sent: false, error: 'Support email notifications are disabled.' };
  if (!env.support.fromEmail) return { sent: false, error: 'Support sender email is not configured.' };

  try {
    const subject = `${input.ticketNumber} - ${input.title}`;
    const ticketUrl = `${appBaseUrl()}/mc-admin-tools?tab=support-tickets`;
    const normalizedLinkedPath = normalizeLinkedPathForEdit(input.linkedPath);
    const linkedUrl = normalizedLinkedPath ? `${appBaseUrl()}${normalizedLinkedPath}` : null;
    const branding = supportEmailBranding();

    const html = buildSupportEmailShell({
      headline: 'New Support Ticket',
      logoHtml: branding.logoHtml,
      bodyHtml: `
        <div style="font-size:16px; font-weight:700; color:#111827;">${escapeHtml(input.ticketNumber)} - ${escapeHtml(input.title)}</div>
        <table role="presentation" style="margin-top:14px; width:100%; border-collapse:separate; border-spacing:0 8px;">
          <tr>
            <td style="width:180px; padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Ticket Number</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.ticketNumber)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Status</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(emailStatusLabel(input.status))}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Section</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.section)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Priority</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.priority)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Market Centre</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.sourceMarketCenterName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Submitted By</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.createdByName ?? input.createdByEmail)} (${escapeHtml(input.createdByEmail)})</td>
          </tr>
        </table>
        <div style="margin-top:14px; padding:14px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
          <div style="font-size:12px; text-transform:uppercase; color:#64748b; margin-bottom:6px; font-weight:700; letter-spacing:0.04em;">Issue Description</div>
          <div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(input.description)}</div>
        </div>
        ${input.linkedLabel ? `<div style="margin-top:14px;"><strong>Linked Record:</strong> ${escapeHtml(input.linkedLabel)}${linkedUrl ? ` - <a href="${escapeHtml(linkedUrl)}">Open record</a>` : ''}</div>` : ''}
        <div style="margin-top:20px;"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block; background:#dc2626; color:#ffffff; text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600;">Open Support Queue</a></div>
      `,
    });

    const mailer = getMailer();
    const sendResult = await mailer.sendMail({
      from: `"${env.support.fromName}" <${env.support.fromEmail}>`,
      to: SUPPORT_MAILBOX,
      replyTo: env.support.replyTo ?? env.support.fromEmail,
      subject,
      html,
      attachments: branding.attachments,
    });

    return { sent: true, messageId: sendResult.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, error: message };
  }
}

async function sendStatusUpdateToSubmitter(input: {
  submitterEmail: string;
  submitterName: string | null;
  ticketNumber: string;
  title: string;
  previousStatus: string;
  nextStatus: string;
  note: string | null;
  changedByName: string | null;
  changedByEmail: string;
  linkedLabel: string | null;
  linkedPath: string | null;
}): Promise<{ sent: boolean; error?: string; messageId?: string }> {
  if (!env.support.enabled) return { sent: false, error: 'Support email notifications are disabled.' };
  if (!env.support.fromEmail) return { sent: false, error: 'Support sender email is not configured.' };

  try {
    const firstName = resolveFirstName(input.submitterName ?? input.submitterEmail);
    const changedByDisplayName = resolveDisplayName(input.changedByName, input.changedByEmail);
    const queueUrl = `${appBaseUrl()}/mc-admin-tools?tab=support-tickets`;
    const normalizedLinkedPath = normalizeLinkedPathForEdit(input.linkedPath);
    const linkedUrl = normalizedLinkedPath ? `${appBaseUrl()}${normalizedLinkedPath}` : null;
    const subject = `${input.ticketNumber} status update: ${emailStatusLabel(input.nextStatus)}`;
    const branding = supportEmailBranding();

    const html = buildSupportEmailShell({
      headline: 'Ticket Status Updated',
      logoHtml: branding.logoHtml,
      bodyHtml: `
        <div style="margin-bottom:10px; font-size:14px; color:#334155;">Hi ${escapeHtml(firstName)},</div>
        <div style="margin-bottom:14px; font-size:14px; color:#334155;">Your support ticket has been updated by our support team.</div>
        <div style="font-size:16px; font-weight:700; color:#111827;">${escapeHtml(input.ticketNumber)} - ${escapeHtml(input.title)}</div>
        <table role="presentation" style="margin-top:14px; width:100%; border-collapse:separate; border-spacing:0 8px;">
          <tr>
            <td style="width:180px; padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Ticket Number</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.ticketNumber)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Previous Status</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(emailStatusLabel(input.previousStatus))}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">New Status</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(emailStatusLabel(input.nextStatus))}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Updated By</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(changedByDisplayName)}</td>
          </tr>
        </table>
        ${input.note ? `<div style="margin-top:14px; padding:14px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;"><div style="font-size:12px; text-transform:uppercase; color:#64748b; margin-bottom:6px; font-weight:700; letter-spacing:0.04em;">Feedback</div><div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(input.note)}</div></div>` : ''}
        ${input.linkedLabel ? `<div style="margin-top:14px;"><strong>Linked Record:</strong> ${escapeHtml(input.linkedLabel)}${linkedUrl ? ` - <a href="${escapeHtml(linkedUrl)}">Open record</a>` : ''}</div>` : ''}
        <div style="margin-top:14px; font-size:13px; color:#475569;">We are actively looking into this and will work to resolve it as quickly as possible.</div>
        <div style="margin-top:20px;"><a href="${escapeHtml(queueUrl)}" style="display:inline-block; background:#dc2626; color:#ffffff; text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600;">Open Support Tickets</a></div>
      `,
    });

    const mailer = getMailer();
    const sendResult = await mailer.sendMail({
      from: `"${env.support.fromName}" <${env.support.fromEmail}>`,
      to: input.submitterEmail,
      replyTo: env.support.replyTo ?? env.support.fromEmail,
      subject,
      html,
      attachments: branding.attachments,
    });
    return { sent: true, messageId: sendResult.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, error: message };
  }
}

async function sendSubmitterTicketReceivedEmail(input: {
  submitterEmail: string;
  submitterName: string | null;
  ticketNumber: string;
  status: string;
  section: string;
  title: string;
  description: string;
  priority: string;
  sourceMarketCenterName: string;
  linkedLabel: string | null;
  linkedPath: string | null;
}): Promise<{ sent: boolean; error?: string; messageId?: string }> {
  if (!env.support.enabled) return { sent: false, error: 'Support email notifications are disabled.' };
  if (!env.support.fromEmail) return { sent: false, error: 'Support sender email is not configured.' };

  try {
    const firstName = resolveFirstName(input.submitterName ?? input.submitterEmail);
    const queueUrl = `${appBaseUrl()}/mc-admin-tools?tab=support-tickets`;
    const normalizedLinkedPath = normalizeLinkedPathForEdit(input.linkedPath);
    const linkedUrl = normalizedLinkedPath ? `${appBaseUrl()}${normalizedLinkedPath}` : null;
    const subject = `${input.ticketNumber} received by MAPP Support`;
    const branding = supportEmailBranding();

    const html = buildSupportEmailShell({
      headline: 'Ticket Received',
      logoHtml: branding.logoHtml,
      bodyHtml: `
        <div style="margin-bottom:10px; font-size:14px; color:#334155;">Hi ${escapeHtml(firstName)},</div>
        <div style="margin-bottom:14px; font-size:14px; color:#334155;">Thank you for submitting your support ticket. Our team has received it and will keep you updated.</div>
        <div style="font-size:16px; font-weight:700; color:#111827;">${escapeHtml(input.ticketNumber)} - ${escapeHtml(input.title)}</div>
        <table role="presentation" style="margin-top:14px; width:100%; border-collapse:separate; border-spacing:0 8px;">
          <tr>
            <td style="width:180px; padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Ticket Number</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.ticketNumber)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Status</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(emailStatusLabel(input.status))}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Section</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.section)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Priority</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.priority)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-right:none; border-radius:10px 0 0 10px;">Market Centre</td>
            <td style="padding:10px 12px; border:1px solid #e2e8f0; border-radius:0 10px 10px 0;">${escapeHtml(input.sourceMarketCenterName)}</td>
          </tr>
        </table>
        <div style="margin-top:14px; padding:14px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
          <div style="font-size:12px; text-transform:uppercase; color:#64748b; margin-bottom:6px; font-weight:700; letter-spacing:0.04em;">Issue Description</div>
          <div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(input.description)}</div>
        </div>
        ${input.linkedLabel ? `<div style="margin-top:14px;"><strong>Linked Record:</strong> ${escapeHtml(input.linkedLabel)}${linkedUrl ? ` - <a href="${escapeHtml(linkedUrl)}">Open record</a>` : ''}</div>` : ''}
        <div style="margin-top:20px;"><a href="${escapeHtml(queueUrl)}" style="display:inline-block; background:#dc2626; color:#ffffff; text-decoration:none; padding:10px 16px; border-radius:8px; font-weight:600;">Open Support Tickets</a></div>
      `,
    });

    const mailer = getMailer();
    const sendResult = await mailer.sendMail({
      from: `"${env.support.fromName}" <${env.support.fromEmail}>`,
      to: input.submitterEmail,
      replyTo: env.support.replyTo ?? env.support.fromEmail,
      subject,
      html,
      attachments: branding.attachments,
    });

    return { sent: true, messageId: sendResult.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, error: message };
  }
}

async function nextTicketNumber(): Promise<string> {
  const pool = getRequiredPgPool();
  const seqResult = await pool.query<{ seq: string }>(`SELECT nextval('app.support_ticket_number_seq')::text AS seq`);
  const seq = Number(seqResult.rows[0]?.seq ?? '0');
  return `MAPP-${String(Number.isFinite(seq) ? seq : 0).padStart(6, '0')}`;
}

async function readTicketWithAccess(
  ticketId: string,
  perms: NonNullable<Express.Request['permissions']>,
): Promise<null | {
  id: string;
  ticket_number: string;
  source_market_center_id: string;
  title: string;
  status: string;
  linked_entity_label: string | null;
  linked_entity_path: string | null;
  created_by_email: string;
  created_by_name: string | null;
}> {
  const pool = getRequiredPgPool();
  const params: unknown[] = [ticketId];
  const where: string[] = ['t.id::text = $1'];
  applyScopeFilter(perms, 't.source_market_center_id', where, params);

  const result = await pool.query<{
    id: string;
    ticket_number: string;
    source_market_center_id: string;
    title: string;
    status: string;
    linked_entity_label: string | null;
    linked_entity_path: string | null;
    created_by_email: string;
        created_by_name: string | null;
  }>(
    `SELECT t.id::text, t.ticket_number, t.source_market_center_id, t.title, t.status,
          t.linked_entity_label, t.linked_entity_path, t.created_by_email, t.created_by_name
       FROM app.support_tickets t
      WHERE ${where.join(' AND ')}
      LIMIT 1`,
    params,
  );

  return result.rows[0] ?? null;
}

async function resolveLinkedEntity(
  type: LinkType,
  id: string,
): Promise<{ label: string; sourceMarketCenterId: string | null }> {
  const pool = getRequiredPgPool();

  if (type === 'listing') {
    const result = await pool.query<{
      id: string;
      listing_number: string | null;
      address_line: string | null;
      suburb: string | null;
      city: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT id::text, listing_number, address_line, suburb, city, source_market_center_id
         FROM migration.core_listings
        WHERE id::text = $1 OR source_listing_id = $1 OR listing_number = $1
        ORDER BY id DESC
        LIMIT 1`,
      [id],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Linked listing not found.');
    const labelBits = [row.listing_number, row.address_line, row.suburb, row.city].filter(Boolean);
    return {
      label: `Listing: ${labelBits.join(' - ') || row.id}`,
      sourceMarketCenterId: row.source_market_center_id,
    };
  }

  if (type === 'transaction') {
    const result = await pool.query<{
      id: string;
      source_transaction_id: string | null;
      transaction_number: string | null;
      address: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT id::text, source_transaction_id, transaction_number, address, source_market_center_id
         FROM migration.core_transactions
        WHERE id::text = $1 OR source_transaction_id = $1 OR transaction_number = $1
        ORDER BY id DESC
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Linked transaction not found.');
    const txNumber = row.transaction_number ?? row.source_transaction_id ?? row.id;
    return {
      label: `Transaction: ${txNumber}${row.address ? ` - ${row.address}` : ''}`,
      sourceMarketCenterId: row.source_market_center_id,
    };
  }

  if (type === 'associate' || type === 'agent') {
    const result = await pool.query<{
      id: string;
      source_associate_id: string | null;
      full_name: string | null;
      email: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT id::text, source_associate_id, full_name, email, source_market_center_id
         FROM migration.core_associates
        WHERE id::text = $1 OR source_associate_id = $1 OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM($1))
        ORDER BY id DESC
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Linked ${type} not found.`);
    return {
      label: `${type === 'agent' ? 'Agent' : 'Associate'}: ${row.full_name ?? row.email ?? row.id}`,
      sourceMarketCenterId: row.source_market_center_id,
    };
  }

  const result = await pool.query<{
    source_market_center_id: string;
    name: string | null;
  }>(
    `SELECT source_market_center_id, name
       FROM migration.core_market_centers
      WHERE source_market_center_id = $1 OR id::text = $1
      LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Linked market centre not found.');
  return {
    label: `Market Centre: ${row.name ?? row.source_market_center_id}`,
    sourceMarketCenterId: row.source_market_center_id,
  };
}

const attachmentsDir = resolveLocalUploadDir('support-tickets');
await ensureLocalUploadDirs('support-tickets').catch(() => undefined);

const attachmentStorage = storageConfig.localUploadsEnabled
  ? multer.diskStorage({
      destination: attachmentsDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        cb(null, `ticket-${suffix}${ext}`);
      },
    })
  : multer.memoryStorage();

const uploadAttachment = multer({
  storage: attachmentStorage,
});

async function runUpload(req: unknown, res: unknown, middleware: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (middleware as (req: unknown, res: unknown, next: (err?: unknown) => void) => void)(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

router.use(resolvePermissions);

router.get('/dashboard', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const parsed = dashboardSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query.' });
  }

  const { sourceMarketCenterId } = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];
  applyScopeFilter(perms, 't.source_market_center_id', where, params, sourceMarketCenterId);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const pool = getRequiredPgPool();
  const result = await pool.query<{
    open_count: string;
    pending_count: string;
    resolved_count: string;
    open_yesterday: string;
    pending_yesterday: string;
    resolved_yesterday_total: string;
    avg_response_today_mins: string | null;
    avg_response_yesterday_mins: string | null;
  }>(
    `WITH scoped AS (
       SELECT t.*
       FROM app.support_tickets t
       ${whereSql}
     ),
     first_response AS (
       SELECT
         t.id,
         EXTRACT(EPOCH FROM (MIN(a.created_at) - t.created_at)) / 60.0 AS minutes_to_first_response,
         t.created_at::date AS created_date
       FROM scoped t
       LEFT JOIN app.support_ticket_activity a
         ON a.ticket_id = t.id
        AND a.activity_type IN ('COMMENT', 'STATUS_CHANGE')
       GROUP BY t.id, t.created_at
     )
     SELECT
       COUNT(*) FILTER (WHERE t.status NOT IN ('RESOLVED', 'CLOSED'))::text AS open_count,
       COUNT(*) FILTER (WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'))::text AS pending_count,
       COUNT(*) FILTER (WHERE t.status IN ('RESOLVED', 'CLOSED'))::text AS resolved_count,
       COUNT(*) FILTER (WHERE t.status NOT IN ('RESOLVED', 'CLOSED') AND t.updated_at::date <= CURRENT_DATE - INTERVAL '1 day')::text AS open_yesterday,
       COUNT(*) FILTER (WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER') AND t.updated_at::date <= CURRENT_DATE - INTERVAL '1 day')::text AS pending_yesterday,
       COUNT(*) FILTER (WHERE t.status IN ('RESOLVED', 'CLOSED') AND t.updated_at::date <= CURRENT_DATE - INTERVAL '1 day')::text AS resolved_yesterday_total,
       ROUND((SELECT AVG(fr.minutes_to_first_response) FROM first_response fr WHERE fr.created_date = CURRENT_DATE)::numeric, 1)::text AS avg_response_today_mins,
       ROUND((SELECT AVG(fr.minutes_to_first_response) FROM first_response fr WHERE fr.created_date = CURRENT_DATE - INTERVAL '1 day')::numeric, 1)::text AS avg_response_yesterday_mins
     FROM scoped t`,
    params,
  );

  const row = result.rows[0];
  const open = Number(row?.open_count ?? '0');
  const pending = Number(row?.pending_count ?? '0');
  const resolvedCount = Number(row?.resolved_count ?? '0');
  const openYesterday = Number(row?.open_yesterday ?? '0');
  const pendingYesterday = Number(row?.pending_yesterday ?? '0');
  const resolvedYesterdayTotal = Number(row?.resolved_yesterday_total ?? '0');
  const avgResponseMins = Number(row?.avg_response_today_mins ?? '0') || 0;
  const avgResponseYesterdayMins = Number(row?.avg_response_yesterday_mins ?? '0') || 0;

  return res.json({
    openTickets: { value: open, delta: open - openYesterday },
    pendingTickets: { value: pending, delta: pending - pendingYesterday },
    resolvedTickets: { value: resolvedCount, delta: resolvedCount - resolvedYesterdayTotal },
    resolvedToday: { value: resolvedCount, delta: resolvedCount - resolvedYesterdayTotal },
    averageResponseMinutes: { value: avgResponseMins, delta: avgResponseMins - avgResponseYesterdayMins },
  });
});

router.get('/regional-assignees', async (req, res) => {
  const perms = req.permissions!;
  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Only Regional Admin can view assignees.' });
  }

  const pool = getRequiredPgPool();
  const result = await pool.query<{
    email: string;
    name: string | null;
  }>(
    `SELECT DISTINCT
        LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, ''))) AS email,
        NULLIF(TRIM(COALESCE(a.full_name, CONCAT_WS(' ', a.first_name, a.last_name), a.email, '')), '') AS name
       FROM migration.associate_roles ar
       JOIN migration.core_associates a ON a.id = ar.associate_id
      WHERE UPPER(REPLACE(ar.role_name, ' ', '_')) = 'REGIONAL_ADMIN'
        AND LOWER(TRIM(COALESCE(a.status_name, ''))) LIKE 'active%'
        AND NULLIF(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, '')), '') IS NOT NULL
      ORDER BY name ASC NULLS LAST, email ASC`,
  );

  return res.json({
    items: result.rows.map((row) => ({
      email: row.email,
      name: row.name ?? row.email,
    })),
  });
});

router.get('/linked-records/search', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const parsed = linkedSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query.' });
  }

  const { type, q, sourceMarketCenterId, limit } = parsed.data;
  const pool = getRequiredPgPool();
  const params: unknown[] = [];
  const where: string[] = [];

  if (type === 'listing') {
    params.push(`%${q}%`);
    where.push(`(
      COALESCE(cl.listing_number, '') ILIKE $${params.length}
      OR COALESCE(cl.address_line, '') ILIKE $${params.length}
      OR COALESCE(cl.suburb, '') ILIKE $${params.length}
      OR COALESCE(cl.city, '') ILIKE $${params.length}
      OR cl.id::text ILIKE $${params.length}
      OR COALESCE(cl.source_listing_id, '') ILIKE $${params.length}
    )`);
    applyScopeFilter(perms, 'cl.source_market_center_id', where, params, sourceMarketCenterId);
    params.push(limit);

    const result = await pool.query<{
      id: string;
      source_id: string | null;
      listing_number: string | null;
      address_line: string | null;
      suburb: string | null;
      city: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT cl.id::text AS id,
              cl.source_listing_id AS source_id,
              cl.listing_number,
              cl.address_line,
              cl.suburb,
              cl.city,
              cl.source_market_center_id
         FROM migration.core_listings cl
        WHERE ${where.join(' AND ')}
        ORDER BY cl.updated_at DESC NULLS LAST, cl.id DESC
        LIMIT $${params.length}`,
      params,
    );

    return res.json({
      items: result.rows.map((row) => {
        const identifier = row.listing_number ?? row.source_id ?? row.id;
        const label = [identifier, row.address_line, row.suburb, row.city].filter(Boolean).join(' - ');
        return {
          type,
          id: row.id,
          label,
          sourceMarketCenterId: row.source_market_center_id,
          path: entityPath('listing', row.id),
        };
      }),
    });
  }

  if (type === 'transaction') {
    params.push(`%${q}%`);
    where.push(`(
      COALESCE(ct.transaction_number, '') ILIKE $${params.length}
      OR COALESCE(ct.source_transaction_id, '') ILIKE $${params.length}
      OR COALESCE(ct.address, '') ILIKE $${params.length}
      OR ct.id::text ILIKE $${params.length}
    )`);
    applyScopeFilter(perms, 'ct.source_market_center_id', where, params, sourceMarketCenterId);
    params.push(limit);

    const result = await pool.query<{
      id: string;
      source_transaction_id: string | null;
      transaction_number: string | null;
      address: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT ct.id::text,
              ct.source_transaction_id,
              ct.transaction_number,
              ct.address,
              ct.source_market_center_id
         FROM migration.core_transactions ct
        WHERE ${where.join(' AND ')}
        ORDER BY ct.updated_at DESC NULLS LAST, ct.id DESC
        LIMIT $${params.length}`,
      params,
    );

    return res.json({
      items: result.rows.map((row) => ({
        type,
        id: row.id,
        label: [row.transaction_number ?? row.source_transaction_id ?? row.id, row.address].filter(Boolean).join(' - '),
        sourceMarketCenterId: row.source_market_center_id,
        path: entityPath('transaction', row.id),
      })),
    });
  }

  if (type === 'associate' || type === 'agent') {
    params.push(`%${q}%`);
    where.push(`(
      COALESCE(ca.full_name, '') ILIKE $${params.length}
      OR COALESCE(ca.email, '') ILIKE $${params.length}
      OR COALESCE(ca.source_associate_id, '') ILIKE $${params.length}
      OR ca.id::text ILIKE $${params.length}
    )`);
    applyScopeFilter(perms, 'ca.source_market_center_id', where, params, sourceMarketCenterId);
    params.push(limit);

    const result = await pool.query<{
      id: string;
      source_associate_id: string | null;
      full_name: string | null;
      email: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT ca.id::text,
              ca.source_associate_id,
              ca.full_name,
              ca.email,
              ca.source_market_center_id
         FROM migration.core_associates ca
        WHERE ${where.join(' AND ')}
        ORDER BY ca.full_name ASC NULLS LAST, ca.id DESC
        LIMIT $${params.length}`,
      params,
    );

    return res.json({
      items: result.rows.map((row) => ({
        type,
        id: row.id,
        label: [row.full_name ?? row.email ?? row.id, row.email].filter(Boolean).join(' - '),
        sourceMarketCenterId: row.source_market_center_id,
        path: entityPath(type, row.id),
      })),
    });
  }

  params.push(`%${q}%`);
  where.push(`(
    COALESCE(mc.name, '') ILIKE $${params.length}
    OR COALESCE(mc.source_market_center_id, '') ILIKE $${params.length}
    OR mc.id::text ILIKE $${params.length}
  )`);

  if (perms.isOfficeAdmin) {
    const allowedMc = perms.marketCenterId ?? perms.homeMcId;
    if (!allowedMc) {
      return res.json({ items: [] });
    }
    params.push(allowedMc);
    where.push(`${normalizedSql('mc.source_market_center_id')} = ${normalizedSql(`$${params.length}`)}`);
  } else if (sourceMarketCenterId) {
    params.push(sourceMarketCenterId);
    where.push(`${normalizedSql('mc.source_market_center_id')} = ${normalizedSql(`$${params.length}`)}`);
  }

  params.push(limit);
  const result = await pool.query<{
    id: string;
    source_market_center_id: string;
    name: string | null;
  }>(
    `SELECT mc.id::text, mc.source_market_center_id, mc.name
       FROM migration.core_market_centers mc
      WHERE ${where.join(' AND ')}
      ORDER BY mc.name ASC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );

  return res.json({
    items: result.rows.map((row) => ({
      type,
      id: row.source_market_center_id,
      label: `${row.name ?? 'Market Centre'} - ${row.source_market_center_id}`,
      sourceMarketCenterId: row.source_market_center_id,
      path: entityPath('market_centre', row.source_market_center_id),
    })),
  });
});

router.get('/', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query.' });
  }

  const { status, priority, sourceMarketCenterId, q, limit, offset } = parsed.data;

  const where: string[] = [];
  const params: unknown[] = [];
  applyScopeFilter(perms, 't.source_market_center_id', where, params, sourceMarketCenterId);

  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    where.push(`t.priority = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      t.ticket_number ILIKE $${params.length}
      OR t.title ILIKE $${params.length}
      OR t.description ILIKE $${params.length}
      OR COALESCE(t.linked_entity_label, '') ILIKE $${params.length}
    )`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countParams = [...params];

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const pool = getRequiredPgPool();
  const [countResult, dataResult] = await Promise.all([
    pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM app.support_tickets t ${whereSql}`, countParams),
    pool.query(
      `SELECT t.id::text,
              t.ticket_number,
              t.source_market_center_id,
              (
                SELECT COALESCE(NULLIF(TRIM(mc.name), ''), t.source_market_center_id)
                  FROM migration.core_market_centers mc
                 WHERE mc.source_market_center_id = t.source_market_center_id OR mc.id::text = t.source_market_center_id
                 ORDER BY CASE WHEN mc.source_market_center_id = t.source_market_center_id THEN 0 ELSE 1 END,
                          mc.name ASC NULLS LAST
                 LIMIT 1
              ) AS source_market_center_name,
              t.section,
              t.title,
              t.description,
              t.status,
              t.priority,
              t.created_by_email,
              t.created_by_name,
              t.allocated_to_email,
              t.allocated_to_name,
              t.resolved_by_email,
              t.resolved_by_name,
              t.resolved_at::text,
              t.linked_entity_type,
              t.linked_entity_id,
              t.linked_entity_label,
              t.linked_entity_path,
              t.created_at::text,
              t.updated_at::text
         FROM app.support_tickets t
         ${whereSql}
        ORDER BY t.updated_at DESC, t.id DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    ),
  ]);

  return res.json({
    total: Number(countResult.rows[0]?.total ?? '0'),
    items: dataResult.rows,
  });
});

router.post('/', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }
  if (!canCreateTicket(perms)) {
    return res.status(403).json({ error: 'Only Office Admin can create support tickets.' });
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });
  }

  const body = parsed.data;

  const requiredLinkedType = requiredLinkedTypeForSection(body.section);
  if (requiredLinkedType && !body.linkedEntityType) {
    return res.status(400).json({ error: `A linked ${requiredLinkedType} is required for ${body.section} tickets.` });
  }

  if (requiredLinkedType && body.linkedEntityType !== requiredLinkedType) {
    return res.status(400).json({ error: `${body.section} tickets must be linked to a ${requiredLinkedType}.` });
  }

  if (requiredLinkedType && !body.linkedEntityId) {
    return res.status(400).json({ error: `A linked ${requiredLinkedType} record id is required for ${body.section} tickets.` });
  }

  if ((body.linkedEntityType && !body.linkedEntityId) || (!body.linkedEntityType && body.linkedEntityId)) {
    return res.status(400).json({ error: 'linkedEntityType and linkedEntityId must be provided together.' });
  }

  const sourceMarketCenterId = resolveSourceMarketCenterId(perms, body.sourceMarketCenterId);
  if (!sourceMarketCenterId) {
    return res.status(400).json({ error: 'Source market centre is required for ticket creation.' });
  }

  let linkedLabel: string | null = null;
  let linkedPath: string | null = null;

  if (body.linkedEntityType && body.linkedEntityId) {
    try {
      const linked = await resolveLinkedEntity(body.linkedEntityType, body.linkedEntityId);
      linkedLabel = linked.label;
      linkedPath = entityPath(body.linkedEntityType, body.linkedEntityId);
      if (linked.sourceMarketCenterId && normalizedSql(`'${linked.sourceMarketCenterId}'`) !== normalizedSql(`'${sourceMarketCenterId}'`)) {
        // no-op marker to keep SQL helper usage centralized; concrete check below
      }
      const normalizedLinked = String(linked.sourceMarketCenterId ?? '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
      const normalizedSource = String(sourceMarketCenterId).replace(/[^a-z0-9]+/gi, '').toLowerCase();
      if (linked.sourceMarketCenterId && normalizedLinked !== normalizedSource) {
        return res.status(400).json({ error: 'Linked record does not belong to the selected market centre.' });
      }
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid linked record.' });
    }
  }

  const ticketNumber = await nextTicketNumber();
  const pool = getRequiredPgPool();

  const insert = await pool.query<{
    id: string;
    ticket_number: string;
    source_market_center_id: string;
    section: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    created_by_email: string;
    created_by_name: string | null;
    linked_entity_type: string | null;
    linked_entity_id: string | null;
    linked_entity_label: string | null;
    linked_entity_path: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO app.support_tickets (
       ticket_number,
       source_market_center_id,
       section,
       title,
       description,
       status,
       priority,
       created_by_email,
       created_by_name,
       linked_entity_type,
       linked_entity_id,
       linked_entity_label,
       linked_entity_path
     )
     VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,$8,$9,$10,$11,$12)
     RETURNING id::text, ticket_number, source_market_center_id, section, title, description,
               status, priority, created_by_email, created_by_name,
               linked_entity_type, linked_entity_id, linked_entity_label, linked_entity_path,
               created_at::text, updated_at::text`,
    [
      ticketNumber,
      sourceMarketCenterId,
      body.section,
      body.title,
      body.description,
      body.priority,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      body.linkedEntityType ?? null,
      body.linkedEntityId ?? null,
      linkedLabel,
      linkedPath,
    ],
  );

  const ticket = insert.rows[0];

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'CREATED',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      ticket.id,
      body.description,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({
        section: body.section,
        priority: body.priority,
      }),
    ],
  );

  const notification = await sendSupportTicketCreatedEmail({
    ticketNumber: ticket.ticket_number,
    section: ticket.section,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    sourceMarketCenterId: ticket.source_market_center_id,
    sourceMarketCenterName: await resolveMarketCentreName(ticket.source_market_center_id),
    linkedLabel: ticket.linked_entity_label,
    linkedPath: ticket.linked_entity_path,
    createdByEmail: ticket.created_by_email,
    createdByName: ticket.created_by_name,
  });

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'NOTIFICATION',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      ticket.id,
      notification.sent ? 'Support mailbox notification sent.' : (notification.error ?? 'Support mailbox notification failed.'),
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({
        recipient: SUPPORT_MAILBOX,
        sent: notification.sent,
        error: notification.error ?? null,
        messageId: notification.messageId ?? null,
      }),
    ],
  );

  const submitterNotification = await sendSubmitterTicketReceivedEmail({
    submitterEmail: ticket.created_by_email,
    submitterName: ticket.created_by_name,
    ticketNumber: ticket.ticket_number,
    status: ticket.status,
    section: ticket.section,
    title: ticket.title,
    description: ticket.description,
    priority: ticket.priority,
    sourceMarketCenterName: await resolveMarketCentreName(ticket.source_market_center_id),
    linkedLabel: ticket.linked_entity_label,
    linkedPath: ticket.linked_entity_path,
  });

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'NOTIFICATION',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      ticket.id,
      submitterNotification.sent
        ? `Submitter confirmation email sent to ${ticket.created_by_email}.`
        : (submitterNotification.error ?? 'Submitter confirmation email failed.'),
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({
        recipient: ticket.created_by_email,
        sent: submitterNotification.sent,
        error: submitterNotification.error ?? null,
        messageId: submitterNotification.messageId ?? null,
      }),
    ],
  );

  return res.status(201).json({
    ticket,
    notification,
    submitterNotification,
  });
});

router.patch('/:id/assignment', async (req, res) => {
  const perms = req.permissions!;
  if (!perms.isRegionalAdmin) {
    return res.status(403).json({ error: 'Only Regional Admin can assign tickets.' });
  }

  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });
  }

  const ticket = await readTicketWithAccess(req.params.id, perms);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  const allocatedEmail = parsed.data.allocatedToEmail?.trim().toLowerCase() || null;
  const pool = getRequiredPgPool();

  let allocatedName: string | null = null;
  if (allocatedEmail) {
    const assignee = await pool.query<{ email: string; name: string | null }>(
      `SELECT LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, ''))) AS email,
              NULLIF(TRIM(COALESCE(a.full_name, CONCAT_WS(' ', a.first_name, a.last_name), a.email, '')), '') AS name
         FROM migration.associate_roles ar
         JOIN migration.core_associates a ON a.id = ar.associate_id
        WHERE UPPER(REPLACE(ar.role_name, ' ', '_')) = 'REGIONAL_ADMIN'
          AND LOWER(TRIM(COALESCE(a.status_name, ''))) LIKE 'active%'
          AND LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, ''))) = $1
        LIMIT 1`,
      [allocatedEmail],
    );
    const row = assignee.rows[0];
    if (!row?.email) {
      return res.status(400).json({ error: 'Allocated user must be a Regional Admin.' });
    }
    allocatedName = row.name ?? row.email;
  }

  const updated = await pool.query(
    `UPDATE app.support_tickets
        SET allocated_to_email = $2,
            allocated_to_name = $3,
            updated_at = NOW()
      WHERE id::text = $1
      RETURNING id::text, ticket_number, source_market_center_id, section, title, description,
                status, priority, created_by_email, created_by_name,
                allocated_to_email, allocated_to_name, resolved_by_email, resolved_by_name, resolved_at::text,
                linked_entity_type, linked_entity_id, linked_entity_label, linked_entity_path,
                created_at::text, updated_at::text`,
    [req.params.id, allocatedEmail, allocatedName],
  );

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'ASSIGNMENT',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      req.params.id,
      allocatedEmail ? `Ticket allocated to ${allocatedName ?? allocatedEmail}.` : 'Ticket allocation cleared.',
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({ allocatedToEmail: allocatedEmail, allocatedToName: allocatedName }),
    ],
  );

  return res.json({ ticket: updated.rows[0] });
});

router.get('/:id', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const ticket = await readTicketWithAccess(req.params.id, perms);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  const pool = getRequiredPgPool();
  const [ticketResult, activityResult, attachmentsResult] = await Promise.all([
    pool.query(
      `SELECT t.id::text,
              t.ticket_number,
              t.source_market_center_id,
              (
                SELECT COALESCE(NULLIF(TRIM(mc.name), ''), t.source_market_center_id)
                  FROM migration.core_market_centers mc
                 WHERE mc.source_market_center_id = t.source_market_center_id OR mc.id::text = t.source_market_center_id
                 ORDER BY CASE WHEN mc.source_market_center_id = t.source_market_center_id THEN 0 ELSE 1 END,
                          mc.name ASC NULLS LAST
                 LIMIT 1
              ) AS source_market_center_name,
              t.section,
              t.title,
              t.description,
              t.status,
              t.priority,
              t.created_by_email,
              t.created_by_name,
              t.allocated_to_email,
              t.allocated_to_name,
              t.resolved_by_email,
              t.resolved_by_name,
              t.resolved_at::text,
              t.linked_entity_type,
              t.linked_entity_id,
              t.linked_entity_label,
              t.linked_entity_path,
              t.created_at::text,
              t.updated_at::text
         FROM app.support_tickets t
        WHERE t.id::text = $1
        LIMIT 1`,
      [req.params.id],
    ),
    pool.query(
      `SELECT a.id::text,
              a.activity_type,
              a.body,
              a.status_from,
              a.status_to,
              a.actor_email,
              a.actor_name,
              a.metadata_json,
              a.created_at::text
         FROM app.support_ticket_activity a
        WHERE a.ticket_id::text = $1
        ORDER BY a.created_at DESC, a.id DESC`,
      [req.params.id],
    ),
    pool.query(
      `SELECT at.id::text,
              at.file_name,
              at.mime_type,
              at.file_size::text,
              at.file_url,
              at.note,
              at.uploaded_by_email,
              at.uploaded_by_name,
              at.created_at::text
         FROM app.support_ticket_attachments at
        WHERE at.ticket_id::text = $1
        ORDER BY at.created_at DESC, at.id DESC`,
      [req.params.id],
    ),
  ]);

  return res.json({
    ticket: ticketResult.rows[0],
    activity: activityResult.rows,
    attachments: attachmentsResult.rows,
  });
});

router.patch('/:id/status', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }
  if (!canUpdateStatus(perms)) {
    return res.status(403).json({ error: 'Only Regional Admin can change ticket status.' });
  }

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });
  }

  const ticket = await readTicketWithAccess(req.params.id, perms);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  const nextStatus = parsed.data.status;
  const note = parsed.data.note?.trim() || null;
  const previousStatus = ticket.status;

  if (previousStatus === nextStatus && !note) {
    return res.json({ ok: true, ticket, notification: { sent: false, error: 'Status unchanged.' } });
  }

  const pool = getRequiredPgPool();
  const isResolvedState = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED';
  const updated = await pool.query(
    `UPDATE app.support_tickets
        SET status = $2,
            resolved_by_email = CASE WHEN $3 THEN $4 ELSE NULL END,
            resolved_by_name = CASE WHEN $3 THEN $5 ELSE NULL END,
            resolved_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id::text = $1
      RETURNING id::text, ticket_number, source_market_center_id, section, title, description,
                status, priority, created_by_email, created_by_name,
                allocated_to_email, allocated_to_name, resolved_by_email, resolved_by_name, resolved_at::text,
                linked_entity_type, linked_entity_id, linked_entity_label, linked_entity_path,
                created_at::text, updated_at::text`,
    [req.params.id, nextStatus, isResolvedState, req.user?.email ?? 'unknown@kwsa.co.za', req.user?.name ?? null],
  );

  const updatedTicket = updated.rows[0];

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       status_from,
       status_to,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'STATUS_CHANGE',$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      req.params.id,
      note,
      previousStatus,
      nextStatus,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({ noteProvided: Boolean(note) }),
    ],
  );

  const notification = await sendStatusUpdateToSubmitter({
    submitterEmail: ticket.created_by_email,
    submitterName: ticket.created_by_name,
    ticketNumber: ticket.ticket_number,
    title: ticket.title,
    previousStatus,
    nextStatus,
    note,
    changedByName: req.user?.name ?? null,
    changedByEmail: req.user?.email ?? 'unknown@kwsa.co.za',
    linkedLabel: ticket.linked_entity_label,
    linkedPath: ticket.linked_entity_path,
  });

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'NOTIFICATION',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      req.params.id,
      notification.sent ? `Status update email sent to ${ticket.created_by_email}.` : (notification.error ?? 'Status update email failed.'),
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({
        recipient: ticket.created_by_email,
        sent: notification.sent,
        error: notification.error ?? null,
        messageId: notification.messageId ?? null,
      }),
    ],
  );

  return res.json({ ticket: updatedTicket, notification });
});

router.post('/:id/comments', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });
  }

  const ticket = await readTicketWithAccess(req.params.id, perms);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  const pool = getRequiredPgPool();
  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name
     ) VALUES ($1,'COMMENT',$2,$3,$4,$5,$6)`,
    [
      req.params.id,
      parsed.data.message,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
    ],
  );

  return res.status(201).json({ ok: true });
});

router.post('/:id/attachments', async (req, res) => {
  const perms = req.permissions!;
  if (!canUseSupportTickets(perms)) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const ticket = await readTicketWithAccess(req.params.id, perms);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  try {
    await runUpload(req, res, uploadAttachment.single('file'));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Upload failed.' });
  }

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    return res.status(400).json({ error: 'Attachment file is required.' });
  }

  const noteParsed = attachmentSchema.safeParse((req as unknown as { body?: unknown }).body ?? {});
  if (!noteParsed.success) {
    return res.status(400).json({ error: noteParsed.error.issues[0]?.message ?? 'Invalid attachment metadata.' });
  }

  let fileUrl = '';
  let gcsObjectName: string | null = null;
  let localFilePath: string | null = null;

  if (storageConfig.localUploadsEnabled) {
    const filename = path.basename(file.path);
    fileUrl = `/uploads/support-tickets/${encodeURIComponent(filename)}`;
    localFilePath = file.path;
  } else {
    const uploadResult = await uploadToGcs(
      file.buffer,
      file.originalname || 'attachment.bin',
      'support-ticket',
      file.mimetype || 'application/octet-stream',
    );
    fileUrl = uploadResult.publicUrl;
    gcsObjectName = uploadResult.objectName;
  }

  const pool = getRequiredPgPool();
  const insert = await pool.query(
    `INSERT INTO app.support_ticket_attachments (
       ticket_id,
       file_name,
       mime_type,
       file_size,
       file_url,
       gcs_object_name,
       local_file_path,
       note,
       created_by_email,
       created_by_name,
       uploaded_by_email,
       uploaded_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id::text, file_name, mime_type, file_size::text, file_url, note,
               uploaded_by_email, uploaded_by_name, created_at::text`,
    [
      req.params.id,
      file.originalname,
      file.mimetype,
      String(file.size),
      fileUrl,
      gcsObjectName,
      localFilePath,
      noteParsed.data.note ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
    ],
  );

  await pool.query(
    `INSERT INTO app.support_ticket_activity (
       ticket_id,
       activity_type,
       body,
       created_by_email,
       created_by_name,
       actor_email,
       actor_name,
       metadata_json
     ) VALUES ($1,'ATTACHMENT_ADDED',$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      req.params.id,
      `Attachment added: ${file.originalname}`,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      req.user?.email ?? 'unknown@kwsa.co.za',
      req.user?.name ?? null,
      JSON.stringify({ fileUrl }),
    ],
  );

  return res.status(201).json({ attachment: insert.rows[0] });
});

export default router;
