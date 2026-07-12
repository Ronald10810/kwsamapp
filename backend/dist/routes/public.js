import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { getPublicReadOnlyPgPool } from '../config/publicDb.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { normalizeMarketingUrlRecord } from '../utils/marketingUrls.js';
const router = Router();
const pool = getPublicReadOnlyPgPool();
const badListingTagFragments = [
    'draft',
    'deleted',
    'archived',
    'pending',
    'approval',
    'unpublished',
    'expired',
    'private',
    'internal',
    'incomplete',
];
const inactiveAssociateFragments = ['inactive', 'deregistered', 'archived', 'deleted', 'terminated', 'suspended'];
const allowedSortValues = ['newest', 'price_asc', 'price_desc'];
const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(24),
    q: z.string().trim().max(120).optional(),
    suburb: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    area: z.string().trim().max(120).optional(),
    saleOrRent: z.string().trim().max(40).optional(),
    priceMin: z.coerce.number().min(0).max(1000000000).optional(),
    priceMax: z.coerce.number().min(0).max(1000000000).optional(),
    propertyType: z.string().trim().max(80).optional(),
    bedrooms: z.coerce.number().int().min(0).max(50).optional(),
    bathrooms: z.coerce.number().int().min(0).max(50).optional(),
    garages: z.coerce.number().int().min(0).max(50).optional(),
    sortBy: z.enum(allowedSortValues).default('newest'),
    kwuid: z.string().trim().max(30).optional(),
});
const kwuidSchema = z.object({
    kwuid: z.string().trim().regex(/^\d{3,12}$/),
});
const listingParamSchema = z.object({
    listingId: z.coerce.number().int().positive(),
});
const landingParamSchema = z.object({
    kwuid: z.string().trim().regex(/^\d{3,12}$/),
    listingNumber: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,80}$/),
});
const leadFormSchema = z.object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(240),
    phone: z.string().trim().min(5).max(40).optional().default(''),
    message: z.string().trim().min(1).max(4000),
    website: z.string().trim().max(240).optional().default(''),
});
const rateBuckets = new Map();
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60000;
const LISTINGS_CACHE_TTL_MS = 45000;
const listingsResponseCache = new Map();
let leadMailer = null;
router.use((req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const current = rateBuckets.get(key);
    if (!current || now - current.windowStarted > RATE_WINDOW_MS) {
        rateBuckets.set(key, { count: 1, windowStarted: now });
        return next();
    }
    if (current.count >= RATE_LIMIT) {
        return res.status(429).json({
            error: 'Too many requests',
            retryAfterSeconds: Math.ceil((RATE_WINDOW_MS - (now - current.windowStarted)) / 1000),
        });
    }
    current.count += 1;
    return next();
});
function normalizePhone(value) {
    if (!value)
        return null;
    const cleaned = value.replace(/\s+/g, '').trim();
    return cleaned.length > 0 ? cleaned : null;
}
function parseImageUrls(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => entry.length > 0))];
}
async function fetchListingMarketingUrls(pg, listingId) {
    const result = await pg.query(`SELECT url, url_type, display_name, sort_order
     FROM migration.listing_marketing_urls
     WHERE listing_id = $1
     ORDER BY sort_order ASC NULLS LAST, id ASC`, [listingId]);
    return result.rows
        .map((row) => normalizeMarketingUrlRecord(row))
        .map((row) => ({
        url: typeof row.url === 'string' ? row.url.trim() : '',
        url_type: typeof row.url_type === 'string' ? row.url_type.trim() : '',
        display_name: typeof row.display_name === 'string' ? row.display_name : null,
        sort_order: typeof row.sort_order === 'number' ? row.sort_order : null,
    }))
        .filter((row) => row.url.length > 0);
}
function extractYouTubeVideoId(value) {
    const raw = (value ?? '').trim();
    if (!raw)
        return null;
    const normalized = raw.replace(/^\/+/, '');
    const patterns = [
        /(?:^|[?&])v=([A-Za-z0-9_-]{4,})/i,
        /(?:^|\/)shorts\/([A-Za-z0-9_-]{4,})/i,
        /(?:^|\/)embed\/([A-Za-z0-9_-]{4,})/i,
        /(?:^|\/)live\/([A-Za-z0-9_-]{4,})/i,
        /youtu\.be\/([A-Za-z0-9_-]{4,})/i,
    ];
    for (const pattern of patterns) {
        const match = normalized.match(pattern) ?? raw.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }
    const firstSegment = normalized.split(/[?&#/]/)[0];
    if (/^[A-Za-z0-9_-]{4,}$/.test(firstSegment)) {
        return firstSegment;
    }
    return null;
}
function pickPrimaryYouTubeUrl(marketingUrls) {
    const youtube = marketingUrls.find((row) => {
        const type = row.url_type.trim().toLowerCase();
        return type === 'youtube' || type === '1';
    });
    if (youtube?.url) {
        return youtube.url;
    }
    const fallback = marketingUrls.find((row) => /youtube|youtu\.be/i.test(row.url));
    return fallback?.url ?? null;
}
function toYouTubeEmbedUrl(value) {
    const videoId = extractYouTubeVideoId(value);
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}
function parsePublicDbTarget(raw) {
    const text = (raw ?? '').trim();
    if (!text) {
        return {
            configured: false,
            host: null,
            port: null,
            database: null,
            sslmode: null,
        };
    }
    try {
        const url = new URL(text);
        return {
            configured: true,
            host: url.hostname || null,
            port: url.port || '5432',
            database: url.pathname.replace(/^\//, '') || null,
            sslmode: url.searchParams.get('sslmode'),
        };
    }
    catch {
        return {
            configured: true,
            host: null,
            port: null,
            database: null,
            sslmode: null,
        };
    }
}
function getPublicKwHomesBaseUrl() {
    const configured = process.env.KWHOMES_BASE_URL
        ?? process.env.PUBLIC_KWHOMES_BASE_URL
        ?? process.env.KW_HOMES_BASE_URL
        ?? 'https://kwhomes.co.za';
    return configured.replace(/\/$/, '');
}
function normalizeListingUrl(baseUrl, kwuid, listingNumber) {
    if (kwuid) {
        return `${baseUrl}/${encodeURIComponent(kwuid)}/${encodeURIComponent(listingNumber)}`;
    }
    return `${baseUrl}/${encodeURIComponent(listingNumber)}`;
}
function normalizeWhatsAppMsisdn(value) {
    const digits = (value ?? '').replace(/\D/g, '');
    if (!digits)
        return null;
    if (digits.startsWith('00') && digits.length > 2) {
        return digits.slice(2);
    }
    if (digits.startsWith('0') && digits.length === 10) {
        return `27${digits.slice(1)}`;
    }
    if (digits.length < 10) {
        return null;
    }
    return digits;
}
function buildWhatsAppHref(phone, message) {
    const msisdn = normalizeWhatsAppMsisdn(phone);
    if (!msisdn)
        return null;
    return `https://wa.me/${msisdn}?text=${encodeURIComponent(message)}`;
}
function buildLandingShareUrl(kwuid, listingNumber) {
    const baseUrl = getPublicKwHomesBaseUrl();
    return `${baseUrl}/share/${encodeURIComponent(kwuid)}/${encodeURIComponent(listingNumber)}`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function isTransientDbError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('connection timeout')
        || message.includes('econnreset')
        || message.includes('etimedout')
        || message.includes('terminating connection')
        || message.includes('connection terminated');
}
async function withRetry(operation, retries = 1) {
    let attempts = 0;
    while (true) {
        try {
            return await operation();
        }
        catch (error) {
            if (attempts >= retries || !isTransientDbError(error)) {
                throw error;
            }
            attempts += 1;
            logger.warn({ err: error, attempts }, 'retrying transient public listings database error');
        }
    }
}
function parseTruthyEnv(value, fallback) {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!normalized)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}
function normalizeLeadInput(value) {
    if (!value || typeof value !== 'object') {
        return {
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            message: '',
            website: '',
        };
    }
    const record = value;
    const firstName = typeof record.firstName === 'string' ? record.firstName : record.first_name;
    const lastName = typeof record.lastName === 'string' ? record.lastName : record.last_name;
    const email = typeof record.email === 'string' ? record.email : record.email_address;
    const phone = typeof record.phone === 'string' ? record.phone : record.phone_number;
    const message = typeof record.message === 'string' ? record.message : record.notes;
    const website = typeof record.website === 'string' ? record.website : '';
    return {
        firstName: typeof firstName === 'string' ? firstName : '',
        lastName: typeof lastName === 'string' ? lastName : '',
        email: typeof email === 'string' ? email : '',
        phone: typeof phone === 'string' ? phone : '',
        message: typeof message === 'string' ? message : '',
        website: typeof website === 'string' ? website : '',
    };
}
function getLeadMailer() {
    if (leadMailer) {
        return leadMailer;
    }
    const smtpHost = process.env.PUBLIC_LEAD_SMTP_HOST?.trim() || 'smtp.gmail.com';
    const smtpPort = Number.parseInt(process.env.PUBLIC_LEAD_SMTP_PORT ?? '465', 10) || 465;
    const smtpSecure = parseTruthyEnv(process.env.PUBLIC_LEAD_SMTP_SECURE, smtpPort === 465);
    const smtpUser = process.env.PUBLIC_LEAD_SMTP_USER?.trim() || '';
    const smtpPass = process.env.PUBLIC_LEAD_SMTP_PASS?.trim() || '';
    if (!smtpUser || !smtpPass) {
        throw new Error('Public lead SMTP credentials are not configured.');
    }
    leadMailer = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
    return leadMailer;
}
function buildPublicWhereClauses(parsed) {
    const params = [];
    const whereClauses = [];
    whereClauses.push(`LOWER(COALESCE(cl.status_name, '')) = 'active'`);
    whereClauses.push(`COALESCE(cl.is_published, false) = true`);
    whereClauses.push(`COALESCE(cl.is_draft, false) = false`);
    for (const fragment of badListingTagFragments) {
        params.push(`%${fragment}%`);
        whereClauses.push(`LOWER(COALESCE(cl.listing_status_tag, '')) NOT LIKE $${params.length}`);
    }
    if (parsed.q) {
        params.push(`%${parsed.q}%`);
        const p = `$${params.length}`;
        whereClauses.push(`(
      cl.property_title ILIKE ${p}
      OR cl.short_title ILIKE ${p}
      OR cl.property_description ILIKE ${p}
      OR cl.address_line ILIKE ${p}
      OR cl.suburb ILIKE ${p}
      OR cl.city ILIKE ${p}
      OR cl.province ILIKE ${p}
      OR cl.property_type ILIKE ${p}
      OR cl.property_sub_type ILIKE ${p}
      OR cl.listing_number ILIKE ${p}
    )`);
    }
    if (parsed.suburb) {
        params.push(`%${parsed.suburb}%`);
        whereClauses.push(`cl.suburb ILIKE $${params.length}`);
    }
    if (parsed.city) {
        params.push(`%${parsed.city}%`);
        whereClauses.push(`cl.city ILIKE $${params.length}`);
    }
    if (parsed.area) {
        params.push(`%${parsed.area}%`);
        const p = `$${params.length}`;
        whereClauses.push(`(cl.suburb ILIKE ${p} OR cl.city ILIKE ${p} OR cl.province ILIKE ${p})`);
    }
    if (parsed.saleOrRent) {
        params.push(parsed.saleOrRent);
        whereClauses.push(`LOWER(COALESCE(cl.sale_or_rent, '')) = LOWER($${params.length})`);
    }
    if (typeof parsed.priceMin === 'number') {
        params.push(parsed.priceMin);
        whereClauses.push(`COALESCE(cl.price, 0) >= $${params.length}`);
    }
    if (typeof parsed.priceMax === 'number') {
        params.push(parsed.priceMax);
        whereClauses.push(`COALESCE(cl.price, 0) <= $${params.length}`);
    }
    if (parsed.propertyType) {
        params.push(`%${parsed.propertyType}%`);
        whereClauses.push(`(cl.property_type ILIKE $${params.length} OR cl.property_sub_type ILIKE $${params.length})`);
    }
    if (typeof parsed.bedrooms === 'number' && parsed.bedrooms > 0) {
        params.push(parsed.bedrooms);
        whereClauses.push(`COALESCE(NULLIF(cl.bedrooms, 0), NULLIF(area_counts.bedroom_count, 0), 0) >= $${params.length}`);
    }
    if (typeof parsed.bathrooms === 'number' && parsed.bathrooms > 0) {
        params.push(parsed.bathrooms);
        whereClauses.push(`COALESCE(NULLIF(cl.bathrooms, 0), NULLIF(area_counts.bathroom_count, 0), 0) >= $${params.length}`);
    }
    if (typeof parsed.garages === 'number' && parsed.garages > 0) {
        params.push(parsed.garages);
        whereClauses.push(`COALESCE(NULLIF(cl.garages, 0), NULLIF(area_counts.garage_count, 0), 0) >= $${params.length}`);
    }
    return {
        whereSql: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
        params,
    };
}
function buildSort(sortBy, prioritizeFeatured) {
    const featuredPrefix = prioritizeFeatured
        ? 'CASE WHEN afl.id IS NULL THEN 1 ELSE 0 END, afl.id ASC, '
        : '';
    if (sortBy === 'price_asc') {
        return `ORDER BY ${featuredPrefix}cl.price ASC NULLS LAST, cl.updated_at DESC, cl.id DESC`;
    }
    if (sortBy === 'price_desc') {
        return `ORDER BY ${featuredPrefix}cl.price DESC NULLS LAST, cl.updated_at DESC, cl.id DESC`;
    }
    return `ORDER BY ${featuredPrefix}cl.updated_at DESC, cl.id DESC`;
}
async function resolveSiteOwner(pg, kwuid) {
    const result = await pg.query(`SELECT
      ca.id,
      ca.kwuid,
      ca.first_name,
      ca.last_name,
      ca.full_name,
      ca.email,
      ca.kwsa_email,
      ca.mobile_number,
      ca.office_number,
      ca.image_url,
      ca.status_name,
      mc.name AS market_center_name,
      mc.contact_number AS market_center_contact_number,
      mc.contact_email AS market_center_contact_email,
      mc.logo_image_url AS market_center_logo_url,
      (
        SELECT ar.role_name
        FROM migration.associate_roles ar
        WHERE ar.associate_id = ca.id
        ORDER BY ar.id ASC
        LIMIT 1
      ) AS primary_role,
      (
        SELECT ajt.job_title
        FROM migration.associate_job_titles ajt
        WHERE ajt.associate_id = ca.id
        ORDER BY ajt.id ASC
        LIMIT 1
      ) AS primary_job_title
    FROM migration.core_associates ca
    LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
    WHERE ca.kwuid = $1
    LIMIT 1`, [kwuid]);
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    const statusNormalized = (row.status_name ?? '').trim().toLowerCase();
    const isBlocked = statusNormalized.length === 0
        || statusNormalized !== 'active'
        || inactiveAssociateFragments.some((fragment) => statusNormalized.includes(fragment));
    if (isBlocked) {
        return null;
    }
    const bestPhone = normalizePhone(row.mobile_number) ?? normalizePhone(row.office_number) ?? normalizePhone(row.market_center_contact_number);
    const bestEmail = row.kwsa_email ?? row.email ?? row.market_center_contact_email;
    return {
        associateId: row.id,
        kwuid: row.kwuid,
        firstName: row.first_name,
        lastName: row.last_name,
        fullName: row.full_name,
        phone: bestPhone,
        whatsappPhone: bestPhone,
        email: bestEmail,
        imageUrl: row.image_url,
        role: row.primary_role,
        jobTitle: row.primary_job_title,
        marketCenterName: row.market_center_name,
        marketCenterLogoUrl: row.market_center_logo_url,
    };
}
router.get('/health', (_req, res) => {
    const readOnlyConfigured = Boolean(pool);
    return res.json({
        service: 'kw-homes-public-api',
        readOnlyConfigured,
    });
});
router.get('/site/:kwuid', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const parsedParam = kwuidSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid KWUID' });
    }
    const owner = await resolveSiteOwner(pool, parsedParam.data.kwuid);
    if (!owner) {
        return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
    return res.json({
        unavailable: false,
        siteOwner: owner,
    });
});
router.post('/site/:kwuid/lead', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const leadEnabled = parseTruthyEnv(process.env.PUBLIC_LEAD_EMAIL_ENABLED, true);
    if (!leadEnabled) {
        return res.status(503).json({ error: 'Lead email is currently disabled.' });
    }
    const parsedParam = kwuidSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid KWUID' });
    }
    const parsedLead = leadFormSchema.safeParse(normalizeLeadInput(req.body));
    if (!parsedLead.success) {
        return res.status(400).json({ error: 'Invalid lead payload', issues: parsedLead.error.flatten() });
    }
    const lead = parsedLead.data;
    if (lead.website.trim().length > 0) {
        return res.json({ ok: true });
    }
    const siteOwner = await withRetry(() => resolveSiteOwner(pool, parsedParam.data.kwuid));
    if (!siteOwner) {
        return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
    const recipientEmail = siteOwner.email?.trim();
    if (!recipientEmail) {
        logger.warn({
            kwuid: parsedParam.data.kwuid,
            siteOwnerId: siteOwner.associateId,
        }, 'public site lead submission skipped: owner email is missing');
        return res.status(409).json({ error: 'Agent email is not configured for this profile.' });
    }
    const leadName = `${lead.firstName} ${lead.lastName}`.trim();
    const profileUrl = `${getPublicKwHomesBaseUrl()}/${encodeURIComponent(parsedParam.data.kwuid)}`;
    const replySubject = `Re: KW Homes Website Enquiry - ${siteOwner.fullName ?? 'Agent Profile'}`;
    const replyHref = `mailto:${lead.email}?subject=${encodeURIComponent(replySubject)}`;
    const leadWhatsAppMessage = [
        `Hi ${lead.firstName},`,
        'Thanks for reaching out through my KW Homes profile.',
        'Please let me know how I can assist you further.',
        '',
        (siteOwner.fullName ?? `${siteOwner.firstName ?? ''} ${siteOwner.lastName ?? ''}`.trim()) || 'KW Homes',
        siteOwner.marketCenterName ?? 'KW South Africa',
    ].join('\n');
    const leadWhatsAppHref = buildWhatsAppHref(lead.phone, leadWhatsAppMessage);
    const fromEmail = process.env.PUBLIC_LEAD_FROM_EMAIL?.trim() || 'info@kwsa.co.za';
    const fromName = `Website Enquiry for ${parsedParam.data.kwuid}`;
    const textBody = [
        'New KW Homes website enquiry received',
        '',
        `Lead name: ${leadName}`,
        `Lead email: ${lead.email}`,
        `Lead phone: ${lead.phone || 'Not provided'}`,
        '',
        `Website agent: ${siteOwner.fullName ?? 'Not provided'}`,
        `Market centre: ${siteOwner.marketCenterName ?? 'Not provided'}`,
        `Profile URL: ${profileUrl}`,
        '',
        'Lead message:',
        lead.message,
    ].join('\n');
    const htmlBody = `
    <div style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,sans-serif;line-height:1.45;color:#111827;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#c30000;padding:18px 24px;color:#ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr>
                <td style="font-size:20px;font-weight:700;letter-spacing:0.4px;">KW</td>
                <td style="text-align:right;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Website Enquiry</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 12px;color:#6b7280;">Hi ${escapeHtml(siteOwner.fullName || 'Agent')},</p>
            <p style="margin:0 0 18px;">You have received a new enquiry from your <strong>KW Homes</strong> website profile.</p>

            <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#b91c1c;">Lead details</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;width:34%;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(leadName)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Email</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;"><a href="mailto:${escapeHtml(lead.email)}" style="color:#b91c1c;text-decoration:none;">${escapeHtml(lead.email)}</a></td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Phone</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(lead.phone || 'Not provided')}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;vertical-align:top;">Message</td>
                <td style="padding:10px 12px;white-space:pre-wrap;">${escapeHtml(lead.message)}</td>
              </tr>
            </table>

            <p style="margin:18px 0 8px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#6b7280;">Website agent details</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;width:34%;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(siteOwner.fullName ?? 'Not provided')}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Market Centre</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(siteOwner.marketCenterName ?? 'Not provided')}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;">Profile URL</td>
                <td style="padding:10px 12px;"><a href="${escapeHtml(profileUrl)}" style="color:#b91c1c;text-decoration:none;">${escapeHtml(profileUrl)}</a></td>
              </tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
              <tr>
                <td style="padding-right:10px;padding-bottom:8px;">
                  <a href="${escapeHtml(replyHref)}" style="display:inline-block;background:#c30000;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px;">Email ${escapeHtml(lead.firstName)}</a>
                </td>
                ${leadWhatsAppHref ? `<td style="padding-bottom:8px;"><a href="${escapeHtml(leadWhatsAppHref)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px;">WhatsApp ${escapeHtml(lead.firstName)}</a></td>` : ''}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#1f2a44;color:#cbd5e1;font-size:12px;text-align:center;padding:14px 16px;">Please follow up as soon as possible - KW Homes South Africa</td>
        </tr>
      </table>
    </div>
  `;
    try {
        const mailer = getLeadMailer();
        await mailer.sendMail({
            to: recipientEmail,
            from: {
                name: fromName,
                address: fromEmail,
            },
            replyTo: `${lead.firstName} ${lead.lastName} <${lead.email}>`,
            subject: `New Website Enquiry - ${siteOwner.fullName ?? parsedParam.data.kwuid}`,
            text: textBody,
            html: htmlBody,
        });
        return res.json({ ok: true });
    }
    catch (error) {
        logger.error({
            err: error,
            kwuid: parsedParam.data.kwuid,
            recipientEmail,
        }, 'failed to send public site lead email');
        return res.status(502).json({ error: 'Failed to send lead email.' });
    }
});
router.get('/listings', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid filters', details: parsed.error.flatten() });
    }
    const { page, pageSize, sortBy } = parsed.data;
    let siteOwner = null;
    if (parsed.data.kwuid) {
        siteOwner = await resolveSiteOwner(pool, parsed.data.kwuid);
        if (!siteOwner) {
            return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
        }
    }
    const cacheKey = JSON.stringify(parsed.data);
    const cachedEntry = listingsResponseCache.get(cacheKey);
    try {
        const { whereSql, params: listParams } = buildPublicWhereClauses(parsed.data);
        const offset = (page - 1) * pageSize;
        let featuredJoinSql = '';
        if (siteOwner?.associateId) {
            listParams.push(siteOwner.associateId);
            featuredJoinSql = `
      LEFT JOIN migration.associate_featured_listings afl
        ON afl.listing_id = cl.id
       AND afl.associate_id = $${listParams.length}`;
        }
        const fromClause = `FROM migration.core_listings cl
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            SUM(COALESCE(NULLIF(lpa.count, 0), 1)) FILTER (WHERE LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom')::int,
            0
          ) AS bedroom_count,
          COALESCE(
            SUM(COALESCE(NULLIF(lpa.count, 0), 1)) FILTER (WHERE LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom')::int,
            0
          ) AS bathroom_count,
          COALESCE(
            SUM(COALESCE(NULLIF(lpa.count, 0), 1)) FILTER (WHERE LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage')::int,
            0
          ) AS garage_count,
          COALESCE(
            SUM(COALESCE(NULLIF(lpa.count, 0), 1)) FILTER (WHERE LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'parking')::int,
            0
          ) AS parking_count
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
      ) area_counts ON true
      LEFT JOIN LATERAL (
        SELECT
          ca.id,
          ca.kwuid,
          ca.first_name,
          ca.last_name,
          ca.full_name,
          ca.email,
          ca.kwsa_email,
          ca.mobile_number,
          ca.office_number,
          ca.image_url,
          mc.name AS market_center_name,
          mc.logo_image_url AS market_center_logo_url
        FROM migration.listing_agents la
        INNER JOIN migration.core_associates ca ON ca.id = la.associate_id
        LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
        WHERE la.listing_id = cl.id
        ORDER BY COALESCE(la.is_primary, false) DESC, COALESCE(la.sort_order, 9999) ASC, la.id ASC
        LIMIT 1
      ) agent ON true
      ${featuredJoinSql}
      ${whereSql}`;
        const totalResult = await withRetry(() => pool.query(`SELECT COUNT(*)::text AS total ${fromClause}`, listParams));
        const total = Number.parseInt(totalResult.rows[0]?.total ?? '0', 10);
        const sortSql = buildSort(sortBy, Boolean(siteOwner?.associateId));
        const listResult = await withRetry(() => pool.query(`SELECT
        cl.id,
        cl.listing_number,
        cl.listing_status_tag,
        cl.sale_or_rent,
        cl.price::text,
        cl.suburb,
        cl.city,
        cl.province,
        cl.property_type,
        cl.property_sub_type,
        COALESCE(NULLIF(cl.bedrooms, 0), NULLIF(area_counts.bedroom_count, 0)) AS bedroom_count,
        COALESCE(NULLIF(cl.bathrooms, 0), NULLIF(area_counts.bathroom_count, 0)) AS bathroom_count,
        COALESCE(NULLIF(cl.garages, 0), NULLIF(area_counts.garage_count, 0)) AS garage_count,
        cl.floor_area::text,
        cl.erf_size::text,
        cl.property_title,
        cl.short_title,
        cl.short_description,
        cl.address_line,
        cl.updated_at::text,
        agent.id AS agent_id,
        agent.kwuid AS agent_kwuid,
        agent.first_name AS agent_first_name,
        agent.last_name AS agent_last_name,
        agent.full_name AS agent_full_name,
        agent.email AS agent_email,
        agent.kwsa_email AS agent_kwsa_email,
        agent.mobile_number AS agent_mobile_number,
        agent.office_number AS agent_office_number,
        agent.image_url AS agent_image_url,
        agent.market_center_name AS agent_market_center_name,
        agent.market_center_logo_url AS agent_market_center_logo_url,
        (
          SELECT li.file_url
          FROM migration.listing_images li
          WHERE li.listing_id = cl.id
          ORDER BY li.sort_order ASC, li.id ASC
          LIMIT 1
        ) AS image_url
      ${fromClause}
      ${sortSql}
      LIMIT $${listParams.length + 1}
      OFFSET $${listParams.length + 2}`, [...listParams, pageSize, offset]));
        const payload = {
            unavailable: false,
            siteOwner,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items: listResult.rows.map((row) => ({
                id: row.id,
                listingNumber: row.listing_number,
                statusTag: row.listing_status_tag,
                saleOrRent: row.sale_or_rent,
                price: row.price ? Number(row.price) : null,
                suburb: row.suburb,
                city: row.city,
                province: row.province,
                propertyType: row.property_type,
                propertySubType: row.property_sub_type,
                bedrooms: row.bedroom_count,
                bathrooms: row.bathroom_count,
                garages: row.garage_count,
                floorSize: row.floor_area ? Number(row.floor_area) : null,
                erfSize: row.erf_size ? Number(row.erf_size) : null,
                title: row.property_title ?? row.short_title,
                shortDescription: row.short_description,
                addressLine: row.address_line,
                mainImageUrl: row.image_url,
                updatedAt: row.updated_at,
                listingAgent: row.agent_id ? {
                    associateId: row.agent_id,
                    kwuid: row.agent_kwuid,
                    firstName: row.agent_first_name,
                    lastName: row.agent_last_name,
                    fullName: row.agent_full_name,
                    phone: normalizePhone(row.agent_mobile_number) ?? normalizePhone(row.agent_office_number),
                    whatsappPhone: normalizePhone(row.agent_mobile_number) ?? normalizePhone(row.agent_office_number),
                    email: row.agent_email ?? row.agent_kwsa_email,
                    imageUrl: row.agent_image_url,
                    marketCenterName: row.agent_market_center_name,
                    marketCenterLogoUrl: row.agent_market_center_logo_url,
                } : null,
            })),
        };
        listingsResponseCache.set(cacheKey, { expiresAt: Date.now() + LISTINGS_CACHE_TTL_MS, payload });
        return res.json(payload);
    }
    catch (error) {
        if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
            res.setHeader('X-KW-Homes-Data-Source', 'stale-cache');
            logger.warn({ err: error }, 'serving cached public listings response after transient database failure');
            return res.json(cachedEntry.payload);
        }
        throw error;
    }
});
router.get('/listings/:listingId', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const parsedParam = listingParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid listing id' });
    }
    const parsedKwuid = req.query.kwuid ? kwuidSchema.safeParse({ kwuid: req.query.kwuid }) : null;
    if (parsedKwuid && !parsedKwuid.success) {
        return res.status(400).json({ error: 'Invalid KWUID' });
    }
    const siteOwner = parsedKwuid?.success ? await resolveSiteOwner(pool, parsedKwuid.data.kwuid) : null;
    if (req.query.kwuid && !siteOwner) {
        return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
    const rowResult = await pool.query(`SELECT
      cl.id,
      cl.listing_number,
      cl.listing_status_tag,
      cl.sale_or_rent,
      cl.status_name,
      cl.is_draft,
      cl.is_published,
      cl.price::text,
      cl.suburb,
      cl.city,
      cl.province,
      cl.property_type,
      cl.property_sub_type,
      cl.floor_area::text,
      cl.erf_size::text,
      cl.property_title,
      cl.short_title,
      cl.short_description,
      cl.property_description,
      cl.address_line,
      cl.updated_at::text,
      agent.id AS agent_id,
      agent.kwuid AS agent_kwuid,
      agent.first_name AS agent_first_name,
      agent.last_name AS agent_last_name,
      agent.full_name AS agent_full_name,
      agent.email AS agent_email,
      agent.kwsa_email AS agent_kwsa_email,
      agent.mobile_number AS agent_mobile_number,
      agent.office_number AS agent_office_number,
      agent.image_url AS agent_image_url,
      agent.market_center_name AS agent_market_center_name,
      agent.market_center_logo_url AS agent_market_center_logo_url
    FROM migration.core_listings cl
    LEFT JOIN LATERAL (
      SELECT
        ca.id,
        ca.kwuid,
        ca.first_name,
        ca.last_name,
        ca.full_name,
        ca.email,
        ca.kwsa_email,
        ca.mobile_number,
        ca.office_number,
        ca.image_url,
        mc.name AS market_center_name,
        mc.logo_image_url AS market_center_logo_url
      FROM migration.listing_agents la
      INNER JOIN migration.core_associates ca ON ca.id = la.associate_id
      LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
      WHERE la.listing_id = cl.id
      ORDER BY COALESCE(la.is_primary, false) DESC, COALESCE(la.sort_order, 9999) ASC, la.id ASC
      LIMIT 1
    ) agent ON true
    WHERE cl.id = $1
    LIMIT 1`, [parsedParam.data.listingId]);
    const row = rowResult.rows[0];
    if (!row) {
        return res.status(404).json({ error: 'Listing not found' });
    }
    const listingStatus = (row.status_name ?? '').toLowerCase();
    const statusTag = (row.listing_status_tag ?? '').toLowerCase();
    const blockedByTag = badListingTagFragments.some((fragment) => statusTag.includes(fragment));
    if (listingStatus !== 'active' || row.is_draft || !row.is_published || blockedByTag) {
        return res.status(404).json({ error: 'Listing not found' });
    }
    const imagesResult = await pool.query(`SELECT file_url
     FROM migration.listing_images
     WHERE listing_id = $1
     ORDER BY sort_order ASC, id ASC`, [row.id]);
    const images = imagesResult.rows
        .map((image) => image.file_url)
        .filter((value) => Boolean(value));
    const marketingUrls = await withRetry(() => fetchListingMarketingUrls(pool, row.id));
    const youtubeUrl = pickPrimaryYouTubeUrl(marketingUrls);
    const youtubeEmbedUrl = toYouTubeEmbedUrl(youtubeUrl);
    const baseUrl = getPublicKwHomesBaseUrl();
    const ownerKwuid = siteOwner?.kwuid ?? null;
    const listingUrl = normalizeListingUrl(baseUrl, ownerKwuid, row.listing_number ?? `${row.id}`);
    const shareUrl = ownerKwuid
        ? buildLandingShareUrl(ownerKwuid, row.listing_number ?? `${row.id}`)
        : listingUrl;
    const listingAgent = row.agent_id ? {
        associateId: row.agent_id,
        kwuid: row.agent_kwuid,
        firstName: row.agent_first_name,
        lastName: row.agent_last_name,
        fullName: row.agent_full_name,
        phone: normalizePhone(row.agent_mobile_number) ?? normalizePhone(row.agent_office_number),
        whatsappPhone: normalizePhone(row.agent_mobile_number) ?? normalizePhone(row.agent_office_number),
        email: row.agent_email ?? row.agent_kwsa_email,
        imageUrl: row.agent_image_url,
        marketCenterName: row.agent_market_center_name,
        marketCenterLogoUrl: row.agent_market_center_logo_url,
    } : null;
    const agentContact = siteOwner ?? listingAgent ?? {
        associateId: null,
        kwuid: null,
        firstName: 'KW',
        lastName: 'Homes',
        fullName: 'KW Homes',
        phone: null,
        whatsappPhone: null,
        email: null,
        imageUrl: null,
        marketCenterName: null,
        marketCenterLogoUrl: null,
    };
    const whatsappText = `Hi ${agentContact.firstName ?? 'there'}, I am interested in this property:\n${shareUrl}\nPlease share more details and viewing availability. Thank you.`;
    const whatsappHref = buildWhatsAppHref(agentContact.whatsappPhone, whatsappText);
    const emailSubject = `Property enquiry - ${row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`}`;
    const emailBody = `Hi ${agentContact.firstName ?? 'there'},\n\nI am interested in this property:\n${listingUrl}\n\nPlease share more details and viewing availability.\n\nThank you.`;
    const emailHref = agentContact.email
        ? `mailto:${agentContact.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
        : null;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    return res.json({
        unavailable: false,
        siteOwner,
        listing: {
            id: row.id,
            listingNumber: row.listing_number,
            statusTag: row.listing_status_tag,
            saleOrRent: row.sale_or_rent,
            price: row.price ? Number(row.price) : null,
            suburb: row.suburb,
            city: row.city,
            province: row.province,
            propertyType: row.property_type,
            propertySubType: row.property_sub_type,
            bedrooms: null,
            bathrooms: null,
            garages: null,
            floorSize: row.floor_area ? Number(row.floor_area) : null,
            erfSize: row.erf_size ? Number(row.erf_size) : null,
            title: row.property_title ?? row.short_title,
            shortDescription: row.short_description,
            description: row.property_description,
            addressLine: row.address_line,
            images,
            marketingUrls,
            marketing_urls: marketingUrls,
            videoUrl: youtubeUrl,
            youtubeUrl,
            youtubeEmbedUrl,
            updatedAt: row.updated_at,
        },
        contact: {
            owner: agentContact,
            telHref: agentContact.phone ? `tel:${agentContact.phone}` : null,
            emailHref,
            whatsappHref,
            listingUrl,
            shareUrl,
        },
    });
});
router.get(['/landing/:kwuid/:listingNumber', '/landing/:kwuid/listing/:listingNumber'], async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const parsedParam = landingParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid landing URL parameters' });
    }
    const siteOwner = await withRetry(() => resolveSiteOwner(pool, parsedParam.data.kwuid));
    if (!siteOwner) {
        return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
    const whereClauses = [
        `LOWER(COALESCE(cl.status_name, '')) = 'active'`,
        `COALESCE(cl.is_published, false) = true`,
        `COALESCE(cl.is_draft, false) = false`,
        `LOWER(COALESCE(cl.listing_number, '')) = LOWER($1)`,
    ];
    const params = [parsedParam.data.listingNumber];
    for (const fragment of badListingTagFragments) {
        params.push(`%${fragment}%`);
        whereClauses.push(`LOWER(COALESCE(cl.listing_status_tag, '')) NOT LIKE $${params.length}`);
    }
    const rowResult = await withRetry(() => pool.query(`SELECT
      cl.id,
      cl.listing_number,
      cl.listing_status_tag,
      cl.sale_or_rent,
      cl.price::text,
      cl.suburb,
      cl.city,
      cl.province,
      cl.property_type,
      cl.property_sub_type,
      (
        SELECT COALESCE(
          SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
          0
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
      ) AS bedroom_count,
      (
        SELECT COALESCE(
          SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
          0
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
      ) AS bathroom_count,
      (
        SELECT COALESCE(
          SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
          0
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage'
      ) AS garage_count,
      (
        SELECT COALESCE(
          SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
          0
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'parking'
      ) AS parking_count,
      cl.floor_area::text,
      cl.erf_size::text,
      CASE
        WHEN cl.listing_images_json IS NOT NULL
          AND cl.listing_images_json::text NOT IN ('[]', 'null', '')
        THEN cl.listing_images_json
        ELSE COALESCE(
          (
            SELECT json_agg(li.file_url ORDER BY li.sort_order ASC, li.id ASC)
            FROM migration.listing_images li
            WHERE li.listing_id = cl.id
              AND li.file_url IS NOT NULL
              AND TRIM(li.file_url) <> ''
          ),
          '[]'::json
        )::jsonb
      END AS listing_images_json,
      cl.property_title,
      cl.short_title,
      cl.short_description,
      cl.property_description,
      cl.address_line,
      cl.updated_at::text
    FROM migration.core_listings cl
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY cl.updated_at DESC, cl.id DESC
    LIMIT 1`, params));
    const row = rowResult.rows[0];
    if (!row) {
        return res.status(404).json({ unavailable: true, message: 'This listing is not available for public viewing.' });
    }
    const images = parseImageUrls(row.listing_images_json);
    const marketingUrls = await withRetry(() => fetchListingMarketingUrls(pool, row.id));
    const youtubeUrl = pickPrimaryYouTubeUrl(marketingUrls);
    const youtubeEmbedUrl = toYouTubeEmbedUrl(youtubeUrl);
    const baseUrl = getPublicKwHomesBaseUrl();
    const listingUrl = normalizeListingUrl(baseUrl, parsedParam.data.kwuid, row.listing_number ?? `${row.id}`);
    const shareUrl = buildLandingShareUrl(parsedParam.data.kwuid, row.listing_number ?? `${row.id}`);
    const whatsappText = `Hi ${siteOwner.firstName ?? 'there'}, I am interested in this property:\n${shareUrl}\nPlease share more details and viewing availability. Thank you.`;
    const whatsappHref = buildWhatsAppHref(siteOwner.whatsappPhone, whatsappText);
    const emailSubject = `Property enquiry - ${row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`}`;
    const emailBody = `Hi ${siteOwner.firstName ?? 'there'},\n\nI am interested in this property:\n${listingUrl}\n\nPlease share more details and viewing availability.\n\nThank you.`;
    const emailHref = siteOwner.email
        ? `mailto:${siteOwner.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
        : null;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
    return res.json({
        unavailable: false,
        siteOwner,
        listing: {
            id: row.id,
            listingNumber: row.listing_number,
            statusTag: row.listing_status_tag,
            saleOrRent: row.sale_or_rent,
            price: row.price ? Number(row.price) : null,
            suburb: row.suburb,
            city: row.city,
            province: row.province,
            propertyType: row.property_type,
            propertySubType: row.property_sub_type,
            bedrooms: row.bedroom_count,
            bathrooms: row.bathroom_count,
            garages: row.garage_count,
            parking: row.parking_count,
            floorSize: row.floor_area ? Number(row.floor_area) : null,
            erfSize: row.erf_size ? Number(row.erf_size) : null,
            title: row.property_title ?? row.short_title,
            shortDescription: row.short_description,
            description: row.property_description,
            addressLine: row.address_line,
            images,
            marketingUrls,
            marketing_urls: marketingUrls,
            videoUrl: youtubeUrl,
            youtubeUrl,
            youtubeEmbedUrl,
            updatedAt: row.updated_at,
        },
        contact: {
            owner: siteOwner,
            telHref: siteOwner.phone ? `tel:${siteOwner.phone}` : null,
            emailHref,
            whatsappHref,
            listingUrl,
            shareUrl,
        },
        og: {
            title: row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`,
            description: row.short_description ?? row.property_description ?? 'KW Homes listing',
            imageUrl: images[0] ?? null,
            url: shareUrl,
        },
    });
});
router.post(['/landing/:kwuid/:listingNumber/lead', '/landing/:kwuid/listing/:listingNumber/lead'], async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const leadEnabled = parseTruthyEnv(process.env.PUBLIC_LEAD_EMAIL_ENABLED, true);
    if (!leadEnabled) {
        return res.status(503).json({ error: 'Lead email is currently disabled.' });
    }
    const parsedParam = landingParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid landing URL parameters' });
    }
    const parsedLead = leadFormSchema.safeParse(normalizeLeadInput(req.body));
    if (!parsedLead.success) {
        return res.status(400).json({ error: 'Invalid lead payload', issues: parsedLead.error.flatten() });
    }
    const lead = parsedLead.data;
    // Honeypot field for bot submissions: treat as accepted and return success silently.
    if (lead.website.trim().length > 0) {
        return res.json({ ok: true });
    }
    const siteOwner = await withRetry(() => resolveSiteOwner(pool, parsedParam.data.kwuid));
    if (!siteOwner) {
        return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
    const whereClauses = [
        `LOWER(COALESCE(cl.status_name, '')) = 'active'`,
        `COALESCE(cl.is_published, false) = true`,
        `COALESCE(cl.is_draft, false) = false`,
        `LOWER(COALESCE(cl.listing_number, '')) = LOWER($1)`,
    ];
    const params = [parsedParam.data.listingNumber];
    for (const fragment of badListingTagFragments) {
        params.push(`%${fragment}%`);
        whereClauses.push(`LOWER(COALESCE(cl.listing_status_tag, '')) NOT LIKE $${params.length}`);
    }
    const listingResult = await withRetry(() => pool.query(`SELECT
      cl.id,
      cl.listing_number,
      cl.property_title,
      cl.short_title,
      cl.suburb,
      cl.city,
      cl.province,
      cl.sale_or_rent,
      cl.price::text,
      agent.full_name AS agent_full_name,
      agent.mobile_number AS agent_mobile_number,
      agent.office_number AS agent_office_number,
      agent.email AS agent_email,
      agent.kwsa_email AS agent_kwsa_email,
      agent.market_center_name AS agent_market_center_name
    FROM migration.core_listings cl
    LEFT JOIN LATERAL (
      SELECT
        ca.full_name,
        ca.mobile_number,
        ca.office_number,
        ca.email,
        ca.kwsa_email,
        mc.name AS market_center_name
      FROM migration.listing_agents la
      INNER JOIN migration.core_associates ca ON ca.id = la.associate_id
      LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
      WHERE la.listing_id = cl.id
      ORDER BY COALESCE(la.is_primary, false) DESC, COALESCE(la.sort_order, 9999) ASC, la.id ASC
      LIMIT 1
    ) agent ON true
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY cl.updated_at DESC, cl.id DESC
    LIMIT 1`, params));
    const listing = listingResult.rows[0];
    if (!listing) {
        return res.status(404).json({ unavailable: true, message: 'This listing is not available for public viewing.' });
    }
    const recipientEmail = siteOwner.email?.trim();
    if (!recipientEmail) {
        logger.warn({
            kwuid: parsedParam.data.kwuid,
            listingNumber: parsedParam.data.listingNumber,
            siteOwnerId: siteOwner.associateId,
        }, 'public lead submission skipped: owner email is missing');
        return res.status(409).json({ error: 'Agent email is not configured for this listing.' });
    }
    const baseUrl = getPublicKwHomesBaseUrl();
    const listingNumber = listing.listing_number ?? parsedParam.data.listingNumber;
    const listingUrl = normalizeListingUrl(baseUrl, parsedParam.data.kwuid, listingNumber);
    const listingTitle = listing.property_title ?? listing.short_title ?? `Listing ${listingNumber}`;
    const leadName = `${lead.firstName} ${lead.lastName}`.trim();
    const areaLabel = [listing.suburb, listing.city, listing.province].filter(Boolean).join(', ') || 'Unknown';
    const replySubject = `Re: New Buyer Lead - ${listingNumber}`;
    const replyHref = `mailto:${lead.email}?subject=${encodeURIComponent(replySubject)}`;
    const listingAgent = {
        fullName: listing.agent_full_name ?? siteOwner.fullName ?? 'Not provided',
        phone: normalizePhone(listing.agent_mobile_number) ?? normalizePhone(listing.agent_office_number) ?? siteOwner.phone ?? 'Not provided',
        email: (listing.agent_email ?? listing.agent_kwsa_email ?? siteOwner.email ?? '').trim() || 'Not provided',
        marketCenterName: listing.agent_market_center_name ?? siteOwner.marketCenterName ?? 'KW South Africa',
    };
    const siteOwnerSignatureName = (siteOwner.fullName ?? `${siteOwner.firstName ?? ''} ${siteOwner.lastName ?? ''}`.trim()) || listingAgent.fullName;
    const siteOwnerSignatureMarketCenter = siteOwner.marketCenterName ?? listingAgent.marketCenterName;
    const leadWhatsAppMessage = [
        `Hi ${lead.firstName},`,
        `Thanks for reaching out about ${listingTitle} (${listingNumber}).`,
        'Please let me know how I can assist you.',
        '',
        siteOwnerSignatureName,
        siteOwnerSignatureMarketCenter,
    ].join('\n');
    const leadWhatsAppHref = buildWhatsAppHref(lead.phone, leadWhatsAppMessage);
    const fromEmail = process.env.PUBLIC_LEAD_FROM_EMAIL?.trim() || 'info@kwsa.co.za';
    const fromNamePrefix = process.env.PUBLIC_LEAD_FROM_NAME_PREFIX?.trim() || 'Buyer Lead for';
    const fromName = `${fromNamePrefix} ${listingNumber}`.trim();
    const textBody = [
        'New KW Homes lead received',
        '',
        `Lead name: ${leadName}`,
        `Lead email: ${lead.email}`,
        `Lead phone: ${lead.phone || 'Not provided'}`,
        '',
        `Listing no: ${listingNumber}`,
        `Listing: ${listingTitle}`,
        `Listing URL: ${listingUrl}`,
        `Area: ${areaLabel}`,
        `Sale / Rent: ${listing.sale_or_rent || 'Unknown'}`,
        `Price: ${listing.price || 'Unknown'}`,
        '',
        'Listing Agent Details:',
        `Name: ${listingAgent.fullName}`,
        `Phone: ${listingAgent.phone}`,
        `Email: ${listingAgent.email}`,
        `Market Centre: ${listingAgent.marketCenterName}`,
        '',
        'Lead message:',
        lead.message,
    ].join('\n');
    const htmlBody = `
    <div style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,sans-serif;line-height:1.45;color:#111827;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#c30000;padding:18px 24px;color:#ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr>
                <td style="font-size:20px;font-weight:700;letter-spacing:0.4px;">KW</td>
                <td style="text-align:right;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">New Buyer Lead</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 12px;color:#6b7280;">Hi ${escapeHtml(siteOwner.fullName || 'Agent')},</p>
            <p style="margin:0 0 18px;">You have received a new buyer lead from <strong>KW Listings</strong>.</p>

            <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#b91c1c;">Lead details</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;width:34%;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(leadName)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Email</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;"><a href="mailto:${escapeHtml(lead.email)}" style="color:#b91c1c;text-decoration:none;">${escapeHtml(lead.email)}</a></td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Phone</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(lead.phone || 'Not provided')}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;vertical-align:top;">Message</td>
                <td style="padding:10px 12px;white-space:pre-wrap;">${escapeHtml(lead.message)}</td>
              </tr>
            </table>

            <p style="margin:18px 0 8px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#6b7280;">Listing details</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;width:34%;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Listing no</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listingNumber)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Property</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listingTitle)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Listing URL</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;"><a href="${escapeHtml(listingUrl)}" style="color:#b91c1c;text-decoration:none;">${escapeHtml(listingUrl)}</a></td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Area</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(areaLabel)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Sale / Rent</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listing.sale_or_rent || 'Unknown')}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;">Price</td>
                <td style="padding:10px 12px;">${escapeHtml(listing.price || 'Unknown')}</td>
              </tr>
            </table>

            <p style="margin:18px 0 8px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#6b7280;">Listing Agent Details</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;width:34%;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listingAgent.fullName)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Phone</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listingAgent.phone)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;">Email</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(listingAgent.email)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;">Market Centre</td>
                <td style="padding:10px 12px;">${escapeHtml(listingAgent.marketCenterName)}</td>
              </tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
              <tr>
                <td style="padding-right:10px;padding-bottom:8px;">
                  <a href="${escapeHtml(replyHref)}" style="display:inline-block;background:#c30000;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px;">Email ${escapeHtml(lead.firstName)}</a>
                </td>
                ${leadWhatsAppHref ? `<td style="padding-bottom:8px;"><a href="${escapeHtml(leadWhatsAppHref)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px;">WhatsApp ${escapeHtml(lead.firstName)}</a></td>` : ''}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#1f2a44;color:#cbd5e1;font-size:12px;text-align:center;padding:14px 16px;">Please follow up as soon as possible - KW Listings South Africa</td>
        </tr>
      </table>
    </div>
  `;
    try {
        const mailer = getLeadMailer();
        await mailer.sendMail({
            to: recipientEmail,
            from: {
                name: fromName,
                address: fromEmail,
            },
            replyTo: `${lead.firstName} ${lead.lastName} <${lead.email}>`,
            subject: `New Buyer Lead - ${listingNumber} - ${listingTitle}`,
            text: textBody,
            html: htmlBody,
        });
        return res.json({ ok: true });
    }
    catch (error) {
        logger.error({
            err: error,
            kwuid: parsedParam.data.kwuid,
            listingNumber: parsedParam.data.listingNumber,
            recipientEmail,
        }, 'failed to send public listing lead email');
        return res.status(502).json({ error: 'Failed to send lead email.' });
    }
});
router.get('/share/:kwuid/:listingNumber', async (req, res) => {
    if (!pool) {
        return res.status(503).send('Public read-only database is not configured.');
    }
    const parsedParam = landingParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).send('Invalid share URL parameters.');
    }
    const siteOwner = await withRetry(() => resolveSiteOwner(pool, parsedParam.data.kwuid));
    if (!siteOwner) {
        return res.status(404).send('This agent website is currently unavailable.');
    }
    const whereClauses = [
        `LOWER(COALESCE(cl.status_name, '')) = 'active'`,
        `COALESCE(cl.is_published, false) = true`,
        `COALESCE(cl.is_draft, false) = false`,
        `LOWER(COALESCE(cl.listing_number, '')) = LOWER($1)`,
    ];
    const params = [parsedParam.data.listingNumber];
    for (const fragment of badListingTagFragments) {
        params.push(`%${fragment}%`);
        whereClauses.push(`LOWER(COALESCE(cl.listing_status_tag, '')) NOT LIKE $${params.length}`);
    }
    const rowResult = await withRetry(() => pool.query(`SELECT
      cl.id,
      cl.listing_number,
      cl.property_title,
      cl.short_title,
      cl.short_description,
      cl.property_description,
      CASE
        WHEN cl.listing_images_json IS NOT NULL
          AND cl.listing_images_json::text NOT IN ('[]', 'null', '')
        THEN cl.listing_images_json
        ELSE COALESCE(
          (
            SELECT json_agg(li.file_url ORDER BY li.sort_order ASC, li.id ASC)
            FROM migration.listing_images li
            WHERE li.listing_id = cl.id
              AND li.file_url IS NOT NULL
              AND TRIM(li.file_url) <> ''
          ),
          '[]'::json
        )::jsonb
      END AS listing_images_json
    FROM migration.core_listings cl
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY cl.updated_at DESC, cl.id DESC
    LIMIT 1`, params));
    const row = rowResult.rows[0];
    if (!row) {
        return res.status(404).send('This listing is not available for public viewing.');
    }
    const baseUrl = getPublicKwHomesBaseUrl();
    const listingNumber = row.listing_number ?? `${row.id}`;
    const listingUrl = normalizeListingUrl(baseUrl, parsedParam.data.kwuid, listingNumber);
    const shareUrl = buildLandingShareUrl(parsedParam.data.kwuid, listingNumber);
    const images = parseImageUrls(row.listing_images_json);
    const title = row.property_title ?? row.short_title ?? `Listing ${listingNumber}`;
    const description = row.short_description ?? row.property_description ?? 'KW Homes listing';
    const ogImage = images[0] ?? `${baseUrl}/kwsa-wordmark.svg`;
    const escapedTitle = escapeHtml(title);
    const escapedDescription = escapeHtml(description);
    const escapedImage = escapeHtml(ogImage);
    const escapedShareUrl = escapeHtml(shareUrl);
    const escapedListingUrl = escapeHtml(listingUrl);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:image" content="${escapedImage}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedImage}" />
    <meta http-equiv="refresh" content="0; url=${escapedListingUrl}" />
  </head>
  <body>
    <p>Redirecting to listing...</p>
    <script>window.location.replace(${JSON.stringify(listingUrl)});</script>
  </body>
</html>`);
});
router.get('/debug/landing/:kwuid/listing/:listingNumber', async (req, res) => {
    if (!env.isDevelopment) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!pool) {
        return res.status(503).json({ error: 'Public read-only database is not configured.' });
    }
    const parsedParam = landingParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
        return res.status(400).json({ error: 'Invalid landing URL parameters' });
    }
    const startedAt = Date.now();
    const diagnostics = [];
    const pushError = (step, error) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        diagnostics.push({
            step,
            ok: false,
            message,
            transient: isTransientDbError(error),
        });
    };
    try {
        const ownerStarted = Date.now();
        try {
            const owner = await resolveSiteOwner(pool, parsedParam.data.kwuid);
            diagnostics.push({
                step: 'resolveSiteOwner',
                ok: true,
                durationMs: Date.now() - ownerStarted,
                found: Boolean(owner),
                ownerKwuid: owner?.kwuid ?? null,
                ownerName: owner?.fullName ?? null,
            });
        }
        catch (error) {
            pushError('resolveSiteOwner', error);
        }
        const listingStarted = Date.now();
        try {
            const listingResult = await pool.query(`SELECT
          cl.id,
          cl.listing_number,
          cl.status_name,
          cl.listing_status_tag,
          cl.is_draft,
          cl.is_published,
          (
            SELECT COALESCE(
              SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
              0
            )
            FROM migration.listing_property_areas lpa
            WHERE lpa.listing_id = cl.id
              AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
          ) AS bedroom_count,
          (
            SELECT COALESCE(
              SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
              0
            )
            FROM migration.listing_property_areas lpa
            WHERE lpa.listing_id = cl.id
              AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
          ) AS bathroom_count,
          (
            SELECT COALESCE(
              SUM(COALESCE(NULLIF(lpa.count, 0), 1))::int,
              0
            )
            FROM migration.listing_property_areas lpa
            WHERE lpa.listing_id = cl.id
              AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage'
          ) AS garage_count,
          (
            SELECT COUNT(*)::int
            FROM migration.listing_images li
            WHERE li.listing_id = cl.id
              AND li.file_url IS NOT NULL
              AND TRIM(li.file_url) <> ''
          ) AS image_count
        FROM migration.core_listings cl
        WHERE cl.listing_number = $1
        ORDER BY cl.updated_at DESC, cl.id DESC
        LIMIT 1`, [parsedParam.data.listingNumber]);
            const listing = listingResult.rows[0] ?? null;
            diagnostics.push({
                step: 'loadListingByNumber',
                ok: true,
                durationMs: Date.now() - listingStarted,
                found: Boolean(listing),
                listing,
            });
        }
        catch (error) {
            pushError('loadListingByNumber', error);
        }
        return res.json({
            ok: diagnostics.every((entry) => entry.ok !== false),
            environment: env.nodeEnv,
            readOnlyConfigured: true,
            elapsedMs: Date.now() - startedAt,
            input: parsedParam.data,
            diagnostics,
            notes: [
                'This endpoint is development-only and runs read-only SELECT diagnostics.',
                'No INSERT, UPDATE, DELETE, or DDL statements are executed.',
            ],
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({
            ok: false,
            error: message,
            diagnostics,
        });
    }
});
router.get('/debug/public-db-target', (_req, res) => {
    if (!env.isDevelopment) {
        return res.status(404).json({ error: 'Not found' });
    }
    const effectiveUrl = process.env.PUBLIC_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
    const parsed = parsePublicDbTarget(effectiveUrl);
    return res.json({
        environment: env.nodeEnv,
        publicDatabaseConfigured: parsed.configured,
        target: parsed,
        poolSettings: {
            publicDbConnectionTimeoutMs: Number.parseInt(process.env.PUBLIC_DB_CONNECTION_TIMEOUT_MS ?? '15000', 10) || 15000,
            publicDbMaxConnections: Number.parseInt(process.env.PUBLIC_DB_MAX_CONNECTIONS ?? '10', 10) || 10,
            publicDbSslRejectUnauthorized: process.env.PUBLIC_DB_SSL_REJECT_UNAUTHORIZED ?? '(default)',
        },
        notes: [
            'Sanitized debug output only. Credentials are never returned.',
            'Public routes use read-only sessions (default_transaction_read_only = on).',
        ],
    });
});
export default router;
//# sourceMappingURL=public.js.map