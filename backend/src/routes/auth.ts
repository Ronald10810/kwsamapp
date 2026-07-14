import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { getRequiredPgPool, withPgPoolRetry } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { requireAuthNoAssociate, type AuthPayload } from '../middleware/requireAuth.js';
import { getAssociateAccessState, normalizeAuthEmail, resolveAssociateIdForAuth } from '../utils/associateAuth.js';

const router = Router();

const USERS_TABLE = 'public.app_users';
const LOGIN_ACTIVITY_TABLE = 'app.login_activity';
const LOCAL_ASSOCIATE_SUSPENSION_ENABLED = String(process.env.LOCAL_ASSOCIATE_SUSPENSION_ENABLED ?? 'false').trim().toLowerCase() === 'true';

const ENSURE_USERS_TABLE = `
  CREATE SCHEMA IF NOT EXISTS app;

  CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
    id          SERIAL PRIMARY KEY,
    google_id   TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    picture     TEXT,
    role        TEXT NOT NULL DEFAULT 'viewer',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

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
`;

let tableReady = false;

async function ensureTable(pool?: Pool): Promise<void> {
  if (tableReady) return;
  const targetPool = pool ?? getRequiredPgPool();
  await targetPool.query(ENSURE_USERS_TABLE);
  tableReady = true;
}

function issueJwt(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '7d' });
}

async function recordLoginActivity(input: {
  appUserId: number;
  loginEmail: string;
  displayName: string | null;
  loginMethod: 'google' | 'dev-login';
}): Promise<void> {
  try {
    const pool = getRequiredPgPool();
    const associateId = await resolveAssociateIdForAuth(pool, input.loginEmail, input.displayName ?? '');

    await pool.query(
      `INSERT INTO ${LOGIN_ACTIVITY_TABLE} (app_user_id, associate_id, login_email, login_method)
       VALUES ($1, $2, $3, $4)`,
      [input.appUserId, associateId, input.loginEmail, input.loginMethod]
    );
  } catch (error) {
    logger.warn(
      { err: error, email: input.loginEmail, method: input.loginMethod },
      'Unable to record login activity'
    );
  }
}

function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout exceeded when trying to connect')
    || message.includes('connect econnrefused')
    || message.includes('econnreset')
    || message.includes('connection terminated unexpectedly')
    || message.includes('client has encountered a connection error')
  );
}

/**
 * POST /api/auth/google
 * Body: { credential: string }  – the Google Identity Services ID token
 */
router.post('/google', async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  if (!env.googleClientId) {
    res.status(500).json({ error: 'Google OAuth is not configured on this server' });
    return;
  }

  // Verify the Google ID token
  const client = new OAuth2Client(env.googleClientId);
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        googleClientIdConfigured: Boolean(env.googleClientId),
      },
      'Google ID token verification failed'
    );
    res.status(401).json({ error: 'Invalid Google credential' });
    return;
  }

  const googlePayload = ticket.getPayload();
  if (!googlePayload?.sub || !googlePayload.email) {
    res.status(401).json({ error: 'Incomplete Google profile' });
    return;
  }


  const loginEmail = normalizeAuthEmail(googlePayload.email);

  // Debug log every login attempt
  logger.info({ email: loginEmail }, 'Google login attempt');

  try {
    const loginResult = await withPgPoolRetry(async (pool) => {
      const accessState = await getAssociateAccessState(pool, loginEmail, googlePayload.name ?? null);
      if (!accessState.isRegistered) {
        return { status: 'not-registered' as const };
      }

      await ensureTable(pool);

      // Reconcile existing app users by either Google subject or email.
      const upsertResult = await pool.query<{
        id: number;
        email: string;
        name: string;
        picture: string | null;
        role: string;
        is_active: boolean;
      }>(
        `WITH existing AS (
           SELECT id
             FROM ${USERS_TABLE}
            WHERE google_id = $1 OR email = $2
            ORDER BY CASE WHEN google_id = $1 THEN 0 ELSE 1 END, id DESC
            LIMIT 1
         ),
         updated AS (
           UPDATE ${USERS_TABLE}
              SET google_id = $1,
                  email = $2,
                  name = $3,
                  picture = $4,
                  updated_at = NOW()
            WHERE id IN (SELECT id FROM existing)
            RETURNING id, email, name, picture, role, is_active
         ),
         inserted AS (
           INSERT INTO ${USERS_TABLE} (google_id, email, name, picture)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (SELECT 1 FROM updated)
           RETURNING id, email, name, picture, role, is_active
         )
         SELECT * FROM updated
         UNION ALL
         SELECT * FROM inserted
         LIMIT 1`,
        [googlePayload.sub, loginEmail, googlePayload.name ?? loginEmail, googlePayload.picture ?? null]
      );

      const user = upsertResult.rows[0] ?? null;
      if (!user) {
        return { status: 'not-registered' as const };
      }

      return {
        status: 'allowed' as const,
        user,
      };
    });

    if (loginResult.status === 'not-registered') {
      logger.warn({ email: loginEmail }, 'Blocked Google login for non-associate account');
      res.status(403).json({ error: 'Only registered associates can sign in.' });
      return;
    }

    const user = loginResult.user;

    if (!user.is_active) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    const authPayload: AuthPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
    };

    await recordLoginActivity({
      appUserId: user.id,
      loginEmail: user.email,
      displayName: user.name,
      loginMethod: 'google',
    });

    res.json({ token: issueJwt(authPayload), user: authPayload });
  } catch (error) {
    logger.error({ err: error, email: loginEmail }, 'Google login failed after verification');
    if (env.allowDevLogin && isDatabaseUnavailableError(error)) {
      const authPayload: AuthPayload = {
        userId: Math.max(1, Math.floor(Date.now() / 1000)),
        email: loginEmail,
        name: (googlePayload.name ?? loginEmail).trim() || loginEmail,
        picture: googlePayload.picture ?? null,
        role: 'admin',
      };

      res.json({
        token: issueJwt(authPayload),
        user: authPayload,
        warning: 'Google sign-in is running in offline mode because the database is currently unreachable.',
      });
      return;
    }

    res.status(500).json({ error: 'Failed to complete Google login' });
  }
});

/**
 * POST /api/auth/dev-login
 * Dev-only fallback login for local environments where Google OAuth is not configured.
 */
router.post('/dev-login', async (req, res) => {
  if (!env.allowDevLogin) {
    res.status(403).json({ error: 'Dev login is disabled' });
    return;
  }

  const body = (req.body ?? {}) as {
    email?: string;
    name?: string;
    role?: string;
    googleId?: string;
  };

  let email = (body.email ?? 'local.dev@kwsa.local').trim().toLowerCase();
  let name = (body.name ?? 'Local Dev User').trim();
  const role = (body.role ?? 'admin').trim() || 'admin';

  try {
    await ensureTable();
    const pool = getRequiredPgPool();

    // Dev login should resolve to a real associate email when DB is available,
    // because authenticated routes enforce registered-associate access.
    if (!email || email === 'local.dev@kwsa.local') {
      const associateResult = await pool.query<{
        email: string | null;
        name: string | null;
      }>(
        `SELECT
           LOWER(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, ''))) AS email,
           NULLIF(TRIM(COALESCE(a.full_name, CONCAT_WS(' ', a.first_name, a.last_name), a.email, 'Local Dev User')), '') AS name
         FROM migration.core_associates a
         WHERE NULLIF(TRIM(COALESCE(a.kwsa_email, a.private_email, a.email, '')), '') IS NOT NULL
         ORDER BY a.id
         LIMIT 1`
      );

      const fallbackAssociate = associateResult.rows[0];
      if (!fallbackAssociate?.email) {
        res.status(500).json({ error: 'No associate email is available for dev login' });
        return;
      }

      email = fallbackAssociate.email;
      if (!body.name?.trim() && fallbackAssociate.name) {
        name = fallbackAssociate.name;
      }
    }

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    const accessState = await getAssociateAccessState(pool, email, name);
    if (!accessState.isRegistered) {
      res.status(403).json({ error: 'Only registered associates can sign in.' });
      return;
    }

    const googleId = (body.googleId ?? `dev-${email}`).trim();

    const upsertResult = await pool.query<{
      id: number;
      email: string;
      name: string;
      picture: string | null;
      role: string;
      is_active: boolean;
    }>(
      `INSERT INTO ${USERS_TABLE} (google_id, email, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role,
             updated_at = NOW()
       RETURNING id, email, name, picture, role, is_active`,
      [googleId, email, name, role]
    );

    const user = upsertResult.rows[0];
    if (!user.is_active) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    const authPayload: AuthPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
    };

    await recordLoginActivity({
      appUserId: user.id,
      loginEmail: user.email,
      displayName: user.name,
      loginMethod: 'dev-login',
    });

    res.json({ token: issueJwt(authPayload), user: authPayload });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Dev login fallback mode activated');

    const fallbackEmail = email && email !== 'local.dev@kwsa.local' ? email : 'local.dev@kwsa.local';
    const authPayload: AuthPayload = {
      userId: Math.max(1, Math.floor(Date.now() / 1000)),
      email: fallbackEmail,
      name,
      picture: null,
      role,
    };

    res.json({
      token: issueJwt(authPayload),
      user: authPayload,
      warning: 'Dev login is running in offline mode because the database is currently unreachable.',
    });
  }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user from the JWT.
 */
router.get('/me', requireAuthNoAssociate, async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  try {
    const pool = getRequiredPgPool();
    const accessState = await getAssociateAccessState(pool, req.user.email, req.user.name ?? null);

    res.json({
      user: req.user,
      access_control: {
        feature_enabled: LOCAL_ASSOCIATE_SUSPENSION_ENABLED,
        is_temporarily_suspended: accessState.isSuspended,
        suspended_reason: accessState.suspendedReason,
        suspended_by_email: null,
        suspended_at: null,
        updated_at: null,
      },
    });
  } catch {
    res.json({
      user: req.user,
      access_control: {
        feature_enabled: LOCAL_ASSOCIATE_SUSPENSION_ENABLED,
        is_temporarily_suspended: false,
        suspended_reason: null,
        suspended_by_email: null,
        suspended_at: null,
        updated_at: null,
      },
    });
  }
});

/**
 * GET /api/auth/contexts
 * Returns all role contexts available to the authenticated user.
 * Used by the frontend Navbar to build the role switcher.
 */
router.get('/contexts', requireAuthNoAssociate, async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  const pool = getRequiredPgPool();
  const email = req.user.email.trim().toLowerCase();
  const displayName = req.user.name?.trim() ?? '';

  try {
    const assocId = await resolveAssociateIdForAuth(pool, email, displayName);
    const assocResult = assocId ? await pool.query<{
      id: string;
      source_associate_id: string | null;
      source_market_center_id: string | null;
      market_center_id: string | null;
      market_center_name: string | null;
      source_team_id: string | null;
      team_id: string | null;
      team_name: string | null;
    }>(
      `SELECT
         a.id::text,
         a.source_associate_id,
         a.source_market_center_id,
         mc.id::text AS market_center_id,
         mc.name AS market_center_name,
         a.source_team_id,
         ct.id::text AS team_id,
         ct.name AS team_name
       FROM migration.core_associates a
       LEFT JOIN migration.core_market_centers mc
         ON mc.source_market_center_id = a.source_market_center_id
         AND LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
       LEFT JOIN migration.core_teams ct
         ON ct.source_team_id = a.source_team_id
       WHERE a.id = $1
       LIMIT 1`,
      [assocId]
    ) : { rows: [] };

    const assoc = assocResult.rows[0];

    // Fetch roles, admin MCs, job titles, and admin teams
    const [rolesResult, adminMcsResult, jobTitlesResult, adminTeamsResult] = assoc
      ? await Promise.all([
          pool.query<{ role_name: string }>(
            `SELECT role_name FROM migration.associate_roles WHERE associate_id = $1`,
            [assoc.id]
          ),
          pool.query<{ source_market_center_id: string; market_center_id: string | null; market_center_name: string | null }>(
            `SELECT
               COALESCE(resolved.source_market_center_id, amc.source_market_center_id) AS source_market_center_id,
               resolved.id::text AS market_center_id,
               resolved.name AS market_center_name
             FROM migration.associate_admin_market_centers amc
             LEFT JOIN LATERAL (
               SELECT mc.id, mc.source_market_center_id, mc.name
               FROM migration.core_market_centers mc
               WHERE LOWER(TRIM(COALESCE(mc.status_name, ''))) IN ('active', '1')
                 AND (
                   LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, '')))
                   OR LOWER(TRIM(COALESCE(mc.name, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, '')))
                 )
               ORDER BY CASE
                 WHEN LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM(COALESCE(amc.source_market_center_id, ''))) THEN 0
                 ELSE 1
               END, mc.id ASC
               LIMIT 1
             ) resolved ON TRUE
              WHERE amc.associate_id = $1`,
            [assoc.id]
          ),
          pool.query<{ job_title: string }>(
            `SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1`,
            [assoc.id]
          ),
          pool.query<{ source_team_id: string; team_id: string | null; team_name: string | null }>(
            `SELECT
               at.source_team_id,
               ct.id::text AS team_id,
               ct.name AS team_name
             FROM migration.associate_admin_teams at
             LEFT JOIN migration.core_teams ct
               ON ct.source_team_id = at.source_team_id
             WHERE at.associate_id = $1
             ORDER BY at.source_team_id ASC`,
            [assoc.id]
          ),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

    const roles = (rolesResult.rows as { role_name: string }[]).map((r) =>
      r.role_name.trim().toUpperCase().replace(/\s+/g, '_')
    );
    const adminMcs = adminMcsResult.rows as { source_market_center_id: string; market_center_id: string | null; market_center_name: string | null }[];
    const jobTitles = (jobTitlesResult.rows as { job_title: string }[]).map((r) => r.job_title.trim());
    const adminTeams = adminTeamsResult.rows as Array<{ source_team_id: string; team_id: string | null; team_name: string | null }>;

    const isRegionalAdmin = roles.includes('REGIONAL_ADMIN');
    const isOfficeAdmin = roles.includes('OFFICE_ADMIN');

    type ContextEntry = {
      id: string;
      label: string;
      role: string;
      marketCenter: string | null;
      marketCenterId: string | null;
      associateId: string | null;
    };

    const contexts: ContextEntry[] = [];
    const seenContextIds = new Set<string>();
    const pushContext = (context: ContextEntry) => {
      if (seenContextIds.has(context.id)) return;
      seenContextIds.add(context.id);
      contexts.push(context);
    };

    // 1. Regional Admin context
    if (isRegionalAdmin) {
      pushContext({
        id: 'regional_admin',
        label: 'Regional Admin',
        role: 'Regional Admin',
        marketCenter: null,
        marketCenterId: null,
        associateId: assoc?.id ?? null,
      });
    }

    // 2. Office Admin (home MC)
    if (isOfficeAdmin && assoc?.source_market_center_id) {
      pushContext({
        id: `office_admin_${assoc.source_market_center_id}`,
        label: `Office Admin${assoc.market_center_name ? ` — ${assoc.market_center_name}` : ''}`,
        role: 'Office Admin',
        marketCenter: assoc.market_center_name ?? null,
        marketCenterId: assoc.source_market_center_id,
        associateId: assoc.id,
      });
    }

    // 3. Admin MC contexts (additional MCs granted via admin_market_centers)
    for (const mc of adminMcs) {
      const mcId = String(mc.source_market_center_id ?? '').trim();
      if (!mcId) continue;
      // Skip if already covered by the home office_admin context above
      if (isOfficeAdmin && assoc?.source_market_center_id === mcId) continue;
      pushContext({
        id: `admin_${mcId}`,
        label: `Office Admin${mc.market_center_name ? ` — ${mc.market_center_name}` : ` — ${mcId}`}`,
        role: 'Office Admin',
        marketCenter: mc.market_center_name ?? null,
        marketCenterId: mcId,
        associateId: assoc?.id ?? null,
      });
    }

    // 4. Team role context (Lead Agent / Team Admin / Team Agent) — if applicable
    const TEAM_ROLE_TITLES = ['Lead Agent', 'Team Admin', 'Team Agent'] as const;
    type TeamRoleTitle = typeof TEAM_ROLE_TITLES[number];
    const teamRoleTitle = jobTitles.find((t): t is TeamRoleTitle =>
      (TEAM_ROLE_TITLES as readonly string[]).includes(t)
    );
    const fallbackAdminTeam = adminTeams[0] ?? null;
    const teamContextDbId = assoc?.team_id ?? fallbackAdminTeam?.team_id ?? null;
    const teamContextSourceId = assoc?.source_team_id ?? fallbackAdminTeam?.source_team_id ?? null;
    const teamContextName = assoc?.team_name ?? fallbackAdminTeam?.team_name ?? teamContextSourceId;
    if (assoc && teamRoleTitle && (teamContextDbId || teamContextSourceId)) {
      const roleKey = teamRoleTitle.toLowerCase().replace(/ /g, '_');
      const teamContextId = teamContextDbId ?? teamContextSourceId;
      pushContext({
        id: `${roleKey}_${teamContextId}`,
        label: `${teamRoleTitle}${teamContextName ? ` — ${teamContextName}` : ''}`,
        role: teamRoleTitle,
        marketCenter: assoc.market_center_name ?? null,
        marketCenterId: assoc.source_market_center_id ?? null,
        associateId: assoc.id,
      });
    }

    // 5. Agent context — always add if there is an associate record
    if (assoc) {
      pushContext({
        id: 'agent',
        label: `Agent${assoc.market_center_name ? ` — ${assoc.market_center_name}` : ''}`,
        role: 'Agent',
        marketCenter: assoc.market_center_name ?? null,
        marketCenterId: assoc.source_market_center_id ?? null,
        associateId: assoc.id,
      });
    }

    // If nothing resolved (no associate record, no roles) return a viewer context
    if (contexts.length === 0) {
      pushContext({
        id: 'viewer',
        label: 'Viewer',
        role: 'Viewer',
        marketCenter: null,
        marketCenterId: null,
        associateId: null,
      });
    }

    res.json({ contexts });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/auth/contexts failed');

    // Keep the session alive during transient DB outages by returning a safe fallback context.
    const fallbackRoleRaw = req.user?.role?.trim() || 'Agent';
    const fallbackRoleNormalized = fallbackRoleRaw.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    const fallbackRole = fallbackRoleNormalized === 'regional admin'
      ? 'Regional Admin'
      : fallbackRoleNormalized === 'office admin' || fallbackRoleNormalized === 'admin'
        ? 'Office Admin'
        : fallbackRoleNormalized === 'viewer'
          ? 'Viewer'
          : 'Agent';
    const fallbackContextId = fallbackRole === 'Regional Admin' ? 'regional_admin' : 'offline_fallback';
    res.json({
      contexts: [
        {
          id: fallbackContextId,
          label: `Offline ${fallbackRole}`,
          role: fallbackRole,
          marketCenter: null,
          marketCenterId: null,
          associateId: null,
        },
      ],
      warning: 'Contexts are running in offline mode because the database is currently unreachable.',
    });
  }
});

/**
 * POST /api/auth/logout
 * Stateless JWT – just tells the client to discard its token.
 */
router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

export default router;
