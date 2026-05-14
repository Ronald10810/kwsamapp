import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { getPublicReadOnlyPgPool } from '../config/publicDb.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

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

const allowedSortValues = ['newest', 'price_asc', 'price_desc'] as const;

type SortValue = (typeof allowedSortValues)[number];

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  q: z.string().trim().max(120).optional(),
  suburb: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  area: z.string().trim().max(120).optional(),
  saleOrRent: z.string().trim().max(40).optional(),
  priceMin: z.coerce.number().min(0).max(1_000_000_000).optional(),
  priceMax: z.coerce.number().min(0).max(1_000_000_000).optional(),
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

const rateBuckets = new Map<string, { count: number; windowStarted: number }>();
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const LISTINGS_CACHE_TTL_MS = 45_000;
const listingsResponseCache = new Map<string, { expiresAt: number; payload: unknown }>();

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

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0))];
}

function parsePublicDbTarget(raw: string | null | undefined): {
  configured: boolean;
  host: string | null;
  port: string | null;
  database: string | null;
  sslmode: string | null;
} {
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
  } catch {
    return {
      configured: true,
      host: null,
      port: null,
      database: null,
      sslmode: null,
    };
  }
}

function getPublicKwHomesBaseUrl(): string {
  const configured = process.env.KWHOMES_BASE_URL
    ?? process.env.PUBLIC_KWHOMES_BASE_URL
    ?? process.env.KW_HOMES_BASE_URL
    ?? 'https://kwhomes.co.za';

  return configured.replace(/\/$/, '');
}

function normalizeListingUrl(baseUrl: string, kwuid: string | null, listingNumber: string): string {
  if (kwuid) {
    return `${baseUrl}/${kwuid}/listing/${encodeURIComponent(listingNumber)}`;
  }
  return `${baseUrl}/listing/${encodeURIComponent(listingNumber)}`;
}

function isTransientDbError(error: unknown): boolean {
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

async function withRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let attempts = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempts >= retries || !isTransientDbError(error)) {
        throw error;
      }
      attempts += 1;
      logger.warn({ err: error, attempts }, 'retrying transient public listings database error');
    }
  }
}

function buildPublicWhereClauses(parsed: z.infer<typeof listQuerySchema>): { whereSql: string; params: unknown[] } {
  const params: unknown[] = [];
  const whereClauses: string[] = [];

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

  return {
    whereSql: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
    params,
  };
}

function buildSort(sortBy: SortValue): string {
  if (sortBy === 'price_asc') {
    return 'ORDER BY cl.price ASC NULLS LAST, cl.updated_at DESC';
  }
  if (sortBy === 'price_desc') {
    return 'ORDER BY cl.price DESC NULLS LAST, cl.updated_at DESC';
  }
  return 'ORDER BY cl.updated_at DESC, cl.id DESC';
}

async function resolveSiteOwner(pg: Pool, kwuid: string) {
  const result = await pg.query<{
    id: number;
    kwuid: string | null;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    email: string | null;
    kwsa_email: string | null;
    mobile_number: string | null;
    office_number: string | null;
    image_url: string | null;
    status_name: string | null;
    market_center_name: string | null;
    market_center_contact_number: string | null;
    market_center_contact_email: string | null;
    market_center_logo_url: string | null;
  }>(
    `SELECT
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
      mc.logo_image_url AS market_center_logo_url
    FROM migration.core_associates ca
    LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
    WHERE ca.kwuid = $1
    LIMIT 1`,
    [kwuid]
  );

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
  const bestEmail = row.email ?? row.kwsa_email ?? row.market_center_contact_email;

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

router.get('/listings', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'Public read-only database is not configured.' });
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid filters', details: parsed.error.flatten() });
  }

  const { page, pageSize, sortBy } = parsed.data;

  let siteOwner: Awaited<ReturnType<typeof resolveSiteOwner>> = null;
  if (parsed.data.kwuid) {
    siteOwner = await resolveSiteOwner(pool, parsed.data.kwuid);
    if (!siteOwner) {
      return res.status(404).json({ unavailable: true, message: 'This agent website is currently unavailable.' });
    }
  }

  const cacheKey = JSON.stringify(parsed.data);
  const cachedEntry = listingsResponseCache.get(cacheKey);

  try {
    const { whereSql, params } = buildPublicWhereClauses(parsed.data);
    const offset = (page - 1) * pageSize;

    const fromClause = `FROM migration.core_listings cl
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
      ${whereSql}`;

    const listParams = params;

    const totalResult = await withRetry(() => pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total ${fromClause}`,
      listParams
    ));

    const total = Number.parseInt(totalResult.rows[0]?.total ?? '0', 10);
    const sortSql = buildSort(sortBy);

    const listResult = await withRetry(() => pool.query<{
      id: number;
      listing_number: string | null;
      listing_status_tag: string | null;
      sale_or_rent: string | null;
      price: string | null;
      suburb: string | null;
      city: string | null;
      province: string | null;
      property_type: string | null;
      property_sub_type: string | null;
      floor_area: string | null;
      erf_size: string | null;
      property_title: string | null;
      short_title: string | null;
      short_description: string | null;
      address_line: string | null;
      updated_at: string;
      image_url: string | null;
      agent_id: number | null;
      agent_kwuid: string | null;
      agent_first_name: string | null;
      agent_last_name: string | null;
      agent_full_name: string | null;
      agent_email: string | null;
      agent_kwsa_email: string | null;
      agent_mobile_number: string | null;
      agent_office_number: string | null;
      agent_image_url: string | null;
      agent_market_center_name: string | null;
      agent_market_center_logo_url: string | null;
    }>(
      `SELECT
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
      OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset]
    ));

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
        bedrooms: null,
        bathrooms: null,
        garages: null,
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
  } catch (error) {
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

  const rowResult = await pool.query<{
    id: number;
    listing_number: string | null;
    listing_status_tag: string | null;
    sale_or_rent: string | null;
    status_name: string | null;
    is_draft: boolean | null;
    is_published: boolean | null;
    price: string | null;
    suburb: string | null;
    city: string | null;
    province: string | null;
    property_type: string | null;
    property_sub_type: string | null;
    floor_area: string | null;
    erf_size: string | null;
    property_title: string | null;
    short_title: string | null;
    short_description: string | null;
    property_description: string | null;
    address_line: string | null;
    updated_at: string;
    agent_id: number | null;
    agent_kwuid: string | null;
    agent_first_name: string | null;
    agent_last_name: string | null;
    agent_full_name: string | null;
    agent_email: string | null;
    agent_kwsa_email: string | null;
    agent_mobile_number: string | null;
    agent_office_number: string | null;
    agent_image_url: string | null;
    agent_market_center_name: string | null;
    agent_market_center_logo_url: string | null;
  }>(
    `SELECT
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
    LIMIT 1`,
    [parsedParam.data.listingId]
  );

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

  const imagesResult = await pool.query<{ file_url: string | null }>(
    `SELECT file_url
     FROM migration.listing_images
     WHERE listing_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [row.id]
  );

  const images = imagesResult.rows
    .map((image) => image.file_url)
    .filter((value): value is string => Boolean(value));

  const baseUrl = getPublicKwHomesBaseUrl();
  const ownerKwuid = siteOwner?.kwuid ?? null;
  const listingUrl = normalizeListingUrl(baseUrl, ownerKwuid, row.listing_number ?? `${row.id}`);

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

  const whatsappText = `Hi ${agentContact.firstName ?? 'there'}, I am interested in this listing: ${listingUrl}. Please contact me.`;
  const whatsappHref = agentContact.whatsappPhone
    ? `https://wa.me/${agentContact.whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(whatsappText)}`
    : null;

  const emailSubject = `Property enquiry - ${row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`}`;
  const emailBody = `Hi ${agentContact.firstName ?? 'there'},\n\nI am interested in this listing:\n${listingUrl}\n\nPlease contact me.`;
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
      updatedAt: row.updated_at,
    },
    contact: {
      owner: agentContact,
      telHref: agentContact.phone ? `tel:${agentContact.phone}` : null,
      emailHref,
      whatsappHref,
      listingUrl,
    },
  });
});

router.get('/landing/:kwuid/listing/:listingNumber', async (req, res) => {
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

  const whereClauses: string[] = [
    `LOWER(COALESCE(cl.status_name, '')) = 'active'`,
    `COALESCE(cl.is_published, false) = true`,
    `COALESCE(cl.is_draft, false) = false`,
    `cl.listing_number = $1`,
  ];
  const params: unknown[] = [parsedParam.data.listingNumber];

  for (const fragment of badListingTagFragments) {
    params.push(`%${fragment}%`);
    whereClauses.push(`LOWER(COALESCE(cl.listing_status_tag, '')) NOT LIKE $${params.length}`);
  }

  const rowResult = await withRetry(() => pool.query<{
    id: number;
    listing_number: string | null;
    listing_status_tag: string | null;
    sale_or_rent: string | null;
    price: string | null;
    suburb: string | null;
    city: string | null;
    province: string | null;
    property_type: string | null;
    property_sub_type: string | null;
    bedroom_count: number | null;
    bathroom_count: number | null;
    garage_count: number | null;
    parking_count: number | null;
    floor_area: string | null;
    erf_size: string | null;
    listing_images_json: unknown;
    property_title: string | null;
    short_title: string | null;
    short_description: string | null;
    property_description: string | null;
    address_line: string | null;
    updated_at: string;
  }>(
    `SELECT
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
          MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
          COUNT(*)::int
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
      ) AS bedroom_count,
      (
        SELECT COALESCE(
          MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
          COUNT(*)::int
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
      ) AS bathroom_count,
      (
        SELECT COALESCE(
          MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
          COUNT(*)::int
        )
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage'
      ) AS garage_count,
      (
        SELECT COALESCE(
          MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
          COUNT(*)::int
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
    LIMIT 1`,
    params
  ));

  const row = rowResult.rows[0];
  if (!row) {
    return res.status(404).json({ unavailable: true, message: 'This listing is not available for public viewing.' });
  }

  const images = parseImageUrls(row.listing_images_json);

  const baseUrl = getPublicKwHomesBaseUrl();
  const listingUrl = normalizeListingUrl(baseUrl, parsedParam.data.kwuid, row.listing_number ?? `${row.id}`);

  const whatsappText = `Hi ${siteOwner.firstName ?? 'there'}, I am interested in this listing: ${listingUrl}. Please contact me.`;
  const whatsappHref = siteOwner.whatsappPhone
    ? `https://wa.me/${siteOwner.whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(whatsappText)}`
    : null;

  const emailSubject = `Property enquiry - ${row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`}`;
  const emailBody = `Hi ${siteOwner.firstName ?? 'there'},\n\nI am interested in this listing:\n${listingUrl}\n\nPlease contact me.`;
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
      updatedAt: row.updated_at,
    },
    contact: {
      owner: siteOwner,
      telHref: siteOwner.phone ? `tel:${siteOwner.phone}` : null,
      emailHref,
      whatsappHref,
      listingUrl,
    },
    og: {
      title: row.property_title ?? row.short_title ?? `Listing ${row.listing_number ?? row.id}`,
      description: row.short_description ?? row.property_description ?? 'KW Homes listing',
      imageUrl: images[0] ?? null,
      url: listingUrl,
    },
  });
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
  const diagnostics: Array<Record<string, unknown>> = [];

  const pushError = (step: string, error: unknown) => {
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
    } catch (error) {
      pushError('resolveSiteOwner', error);
    }

    const listingStarted = Date.now();
    try {
      const listingResult = await pool.query<{
        id: number;
        listing_number: string | null;
        status_name: string | null;
        listing_status_tag: string | null;
        is_draft: boolean | null;
        is_published: boolean | null;
        bedroom_count: number | null;
        bathroom_count: number | null;
        garage_count: number | null;
        image_count: number;
      }>(
        `SELECT
          cl.id,
          cl.listing_number,
          cl.status_name,
          cl.listing_status_tag,
          cl.is_draft,
          cl.is_published,
          (
            SELECT COALESCE(
              MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
              COUNT(*)::int
            )
            FROM migration.listing_property_areas lpa
            WHERE lpa.listing_id = cl.id
              AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
          ) AS bedroom_count,
          (
            SELECT COALESCE(
              MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
              COUNT(*)::int
            )
            FROM migration.listing_property_areas lpa
            WHERE lpa.listing_id = cl.id
              AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
          ) AS bathroom_count,
          (
            SELECT COALESCE(
              MAX(CASE WHEN COALESCE(lpa.count, 0) > 0 THEN lpa.count::int END),
              COUNT(*)::int
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
        LIMIT 1`,
        [parsedParam.data.listingNumber]
      );

      const listing = listingResult.rows[0] ?? null;
      diagnostics.push({
        step: 'loadListingByNumber',
        ok: true,
        durationMs: Date.now() - listingStarted,
        found: Boolean(listing),
        listing,
      });
    } catch (error) {
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
  } catch (error) {
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
