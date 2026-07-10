import { Router } from 'express';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { resolvePermissions } from '../middleware/permissions.js';

const router = Router();

const LOGIN_ACTIVITY_TABLE = 'app.login_activity';

async function ensureLoginActivityTable(): Promise<void> {
  const pool = getRequiredPgPool();
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS app;

    CREATE TABLE IF NOT EXISTS ${LOGIN_ACTIVITY_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      app_user_id INTEGER REFERENCES public.app_users(id) ON DELETE SET NULL,
      associate_id BIGINT REFERENCES migration.core_associates(id) ON DELETE SET NULL,
      login_email TEXT NOT NULL,
      login_method TEXT NOT NULL,
      logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS login_activity_logged_in_at_idx
      ON ${LOGIN_ACTIVITY_TABLE} (logged_in_at DESC);

    CREATE INDEX IF NOT EXISTS login_activity_associate_id_idx
      ON ${LOGIN_ACTIVITY_TABLE} (associate_id);
  `);
}

// Best effort so first query does not need to create schema/table.
ensureLoginActivityTable().catch(() => undefined);

router.get('/', resolvePermissions, async (req, res) => {
  const perms = req.permissions;
  if (!perms || !perms.isRegionalAdmin || perms.scope !== 'GLOBAL') {
    return res.status(403).json({
      error: 'Only Regional Admin users in Regional Admin context can view login activity.',
    });
  }

  const dateInput = String(req.query.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return res.status(400).json({ error: 'Query parameter date (YYYY-MM-DD) is required.' });
  }

  try {
    await ensureLoginActivityTable();

    const pool = getRequiredPgPool();
    const result = await pool.query<{
      id: string;
      associate_name: string | null;
      market_center_name: string | null;
      associate_phone: string | null;
      associate_email: string;
      logged_in_at: string;
      login_method: string;
    }>(
      `
      WITH explicit_activity AS (
        SELECT
          la.id::text AS id,
          la.app_user_id,
          COALESCE(a.full_name, NULLIF(TRIM(au.name), ''), la.login_email) AS associate_name,
          mc.name AS market_center_name,
          COALESCE(NULLIF(TRIM(a.mobile_number), ''), NULLIF(TRIM(a.office_number), '')) AS associate_phone,
          COALESCE(
            NULLIF(TRIM(a.kwsa_email), ''),
            NULLIF(TRIM(a.private_email), ''),
            NULLIF(TRIM(a.email), ''),
            la.login_email
          ) AS associate_email,
          la.logged_in_at,
          la.login_method
        FROM ${LOGIN_ACTIVITY_TABLE} la
        LEFT JOIN migration.core_associates a ON a.id = la.associate_id
        LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = a.source_market_center_id
        LEFT JOIN public.app_users au ON au.id = la.app_user_id
        WHERE (la.logged_in_at AT TIME ZONE $1)::date = $2::date
      ),
      inferred_activity AS (
        SELECT
          CONCAT('u-', au.id::text) AS id,
          au.id AS app_user_id,
          COALESCE(a.full_name, NULLIF(TRIM(au.name), ''), au.email) AS associate_name,
          mc.name AS market_center_name,
          COALESCE(NULLIF(TRIM(a.mobile_number), ''), NULLIF(TRIM(a.office_number), '')) AS associate_phone,
          COALESCE(
            NULLIF(TRIM(a.kwsa_email), ''),
            NULLIF(TRIM(a.private_email), ''),
            NULLIF(TRIM(a.email), ''),
            au.email
          ) AS associate_email,
          au.updated_at AS logged_in_at,
          'legacy-inferred'::text AS login_method
        FROM public.app_users au
        LEFT JOIN migration.core_associates a
          ON LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, ''))) = LOWER(TRIM(au.email))
        LEFT JOIN migration.core_market_centers mc ON mc.source_market_center_id = a.source_market_center_id
        WHERE (au.updated_at AT TIME ZONE $1)::date = $2::date
          AND NOT EXISTS (
            SELECT 1
            FROM explicit_activity ea
            WHERE ea.app_user_id = au.id
          )
      )
      SELECT
        combined.id,
        combined.associate_name,
        combined.market_center_name,
        combined.associate_phone,
        combined.associate_email,
        combined.logged_in_at::text,
        combined.login_method
      FROM (
        SELECT * FROM explicit_activity
        UNION ALL
        SELECT * FROM inferred_activity
      ) AS combined
      ORDER BY combined.logged_in_at DESC
      LIMIT 5000
      `,
      [env.appTimeZone, dateInput]
    );

    return res.json({
      date: dateInput,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
