import { Router } from 'express';
import { getOptionalPgPool } from '../config/db.js';
import { resolvePermissions } from '../middleware/permissions.js';

const router = Router();
const pool = getOptionalPgPool();

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getCurrentAssociateId(email: string): Promise<string | null> {
  if (!pool) return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const result = await pool.query<{ id: string }>(
    `SELECT id::text
       FROM migration.core_associates
      WHERE LOWER(TRIM(COALESCE(kwsa_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(private_email, ''))) = $1
         OR LOWER(TRIM(COALESCE(email, ''))) = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [normalizedEmail],
  );

  return result.rows[0]?.id ?? null;
}

async function enqueueListingExpiryRemindersForAssociate(associateId: string): Promise<void> {
  if (!pool) return;

  await pool.query(
    `WITH reminder_days AS (
       SELECT 30::int AS days
       UNION ALL
       SELECT 7::int AS days
     ),
     candidate_listings AS (
       SELECT DISTINCT
         cl.id AS listing_id,
         COALESCE(NULLIF(TRIM(cl.listing_number), ''), cl.source_listing_id, cl.id::text) AS listing_label,
         cl.expiry_date,
         rd.days
       FROM migration.listing_agents la
       JOIN migration.core_listings cl ON cl.id = la.listing_id
       CROSS JOIN reminder_days rd
       WHERE la.associate_id = $1::bigint
         AND cl.expiry_date IS NOT NULL
         AND cl.expiry_date >= CURRENT_DATE
           AND (
             (rd.days = 30 AND cl.expiry_date BETWEEN (CURRENT_DATE + 8) AND (CURRENT_DATE + 30))
             OR (rd.days = 7 AND cl.expiry_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + 7))
           )
           AND (
             LOWER(TRIM(COALESCE(cl.status_name, ''))) IN ('active', '1')
             OR COALESCE(cl.is_published, false) = true
           )
         AND LOWER(TRIM(COALESCE(cl.status_name, ''))) NOT IN ('withdrawn', 'inactive', 'expired', 'sold', '3', '11', '14')
         AND LOWER(TRIM(COALESCE(cl.listing_status_tag, ''))) NOT IN ('withdrawn', 'inactive', 'expired', 'sold')
     )
     INSERT INTO migration.in_app_notifications
       (associate_id, notification_type, category, title, message, entity_type, entity_id, metadata)
     SELECT
       $1::bigint,
       'LISTING_EXPIRY_REMINDER',
       'INFO',
       CASE
         WHEN c.days = 30 THEN 'Listing expires in 30 days'
         ELSE 'Listing expires in 7 days'
       END,
       FORMAT('Your listing %s expires on %s.', c.listing_label, c.expiry_date::text),
       'listing',
       c.listing_id,
       jsonb_build_object(
         'listing_id', c.listing_id,
         'listing_number', c.listing_label,
         'expiry_date', c.expiry_date::text,
         'reminder_days', c.days,
         'reminder_type', 'EXPIRY'
       )
     FROM candidate_listings c
     WHERE NOT EXISTS (
       SELECT 1
       FROM migration.in_app_notifications n
       WHERE n.associate_id = $1::bigint
         AND n.notification_type = 'LISTING_EXPIRY_REMINDER'
         AND n.entity_type = 'listing'
         AND n.entity_id = c.listing_id
         AND COALESCE(n.metadata->>'reminder_days', '') = c.days::text
     )`,
    [associateId]
  );
}

router.get('/', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  // Notifications are context-bound operational workflow items.
  // Regional (GLOBAL) context should not surface MC-scoped queues.
  if (req.permissions?.scope === 'GLOBAL') {
    return res.json({ items: [], counts: { unread: 0, pending: 0, approved: 0, rejected: 0 } });
  }

  const associateId = req.permissions?.associateDbId;
  if (!associateId) {
    return res.json({ items: [], counts: { unread: 0, pending: 0, approved: 0, rejected: 0 } });
  }

  try {
    await enqueueListingExpiryRemindersForAssociate(associateId);
  } catch {
    // Keep notifications endpoint non-blocking if reminder generation fails.
  }

  const filter = toText(req.query.filter)?.toLowerCase() ?? 'all';
  const allowedFilters = new Set(['all', 'pending', 'approved', 'rejected']);
  const safeFilter = allowedFilters.has(filter) ? filter : 'all';
  const limitInput = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 20;

  const params: Array<string | number> = [associateId];
  const whereClauses = ['associate_id = $1'];

  if (req.permissions?.scope === 'MARKET_CENTRE' && req.permissions.marketCenterId) {
    params.push(req.permissions.marketCenterId);
    whereClauses.push(
      `(entity_type <> 'listing' OR EXISTS (
         SELECT 1
           FROM migration.core_listings cl
          WHERE cl.id = entity_id
            AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($${params.length})), '[^a-z0-9]+', '', 'g')
       ))`
    );
  }

  if (safeFilter !== 'all') {
    params.push(safeFilter.toUpperCase());
    whereClauses.push(`UPPER(category) = $${params.length}`);
  }

  params.push(limit);
  const itemsResult = await pool.query(
    `SELECT
       id::text,
       notification_type,
       category,
       title,
       message,
       entity_type,
       entity_id::text,
       metadata,
       is_read,
       read_at::text,
       created_at::text,
       updated_at::text
     FROM migration.in_app_notifications
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );

  const countParams: Array<string | number> = [associateId];
  const countWhereClauses = ['associate_id = $1'];

  if (req.permissions?.scope === 'MARKET_CENTRE' && req.permissions.marketCenterId) {
    countParams.push(req.permissions.marketCenterId);
    countWhereClauses.push(
      `(entity_type <> 'listing' OR EXISTS (
         SELECT 1
           FROM migration.core_listings cl
          WHERE cl.id = entity_id
            AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g')
              = REGEXP_REPLACE(LOWER(TRIM($${countParams.length})), '[^a-z0-9]+', '', 'g')
       ))`
    );
  }

  const countsResult = await pool.query<{
    unread: string;
    pending: string;
    approved: string;
    rejected: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE NOT is_read)::text AS unread,
       COUNT(*) FILTER (WHERE UPPER(category) = 'PENDING')::text AS pending,
       COUNT(*) FILTER (WHERE UPPER(category) = 'APPROVED')::text AS approved,
       COUNT(*) FILTER (WHERE UPPER(category) = 'REJECTED')::text AS rejected
     FROM migration.in_app_notifications
     WHERE ${countWhereClauses.join(' AND ')}`,
    countParams,
  );

  return res.json({
    items: itemsResult.rows,
    counts: {
      unread: Number(countsResult.rows[0]?.unread ?? 0),
      pending: Number(countsResult.rows[0]?.pending ?? 0),
      approved: Number(countsResult.rows[0]?.approved ?? 0),
      rejected: Number(countsResult.rows[0]?.rejected ?? 0),
    },
  });
});

router.post('/:id/read', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
  if (!userEmail) return res.status(401).json({ error: 'Unauthorised' });

  const associateId = await getCurrentAssociateId(userEmail);
  if (!associateId) return res.status(404).json({ error: 'Associate not found.' });

  const notificationId = Number(req.params.id);
  if (!Number.isFinite(notificationId)) return res.status(400).json({ error: 'Invalid notification id.' });

  const result = await pool.query<{ id: string }>(
    `UPDATE migration.in_app_notifications
        SET is_read = true,
            read_at = COALESCE(read_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND associate_id = $2
      RETURNING id::text`,
    [notificationId, associateId],
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: 'Notification not found.' });
  }

  return res.json({ success: true, id: result.rows[0].id });
});

router.post('/read-all', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const userEmail = req.user?.email?.trim().toLowerCase() ?? '';
  if (!userEmail) return res.status(401).json({ error: 'Unauthorised' });

  const associateId = await getCurrentAssociateId(userEmail);
  if (!associateId) return res.status(404).json({ error: 'Associate not found.' });

  const result = await pool.query(
    `UPDATE migration.in_app_notifications
        SET is_read = true,
            read_at = COALESCE(read_at, NOW()),
            updated_at = NOW()
      WHERE associate_id = $1
        AND is_read = false`,
    [associateId],
  );

  return res.json({ success: true, updated: result.rowCount ?? 0 });
});

export default router;
