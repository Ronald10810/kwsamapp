import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { getRequiredPgPool } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { requireAuth, type AuthPayload } from '../middleware/requireAuth.js';

const router = Router();

const USERS_TABLE = 'public.app_users';

const ENSURE_USERS_TABLE = `
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
`;

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = getRequiredPgPool();
  await pool.query(ENSURE_USERS_TABLE);
  tableReady = true;
}

function issueJwt(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '7d' });
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

  await ensureTable();

    const pool = getRequiredPgPool();

  // Upsert user — update name/picture on each login so they stay fresh
  const upsertResult = await pool.query<{
    id: number;
    email: string;
    name: string;
    picture: string | null;
    role: string;
    is_active: boolean;
  }>(
    `INSERT INTO ${USERS_TABLE} (google_id, email, name, picture)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE
       SET email      = EXCLUDED.email,
           name       = EXCLUDED.name,
           picture    = EXCLUDED.picture,
           updated_at = NOW()
     RETURNING id, email, name, picture, role, is_active`,
    [googlePayload.sub, googlePayload.email, googlePayload.name ?? googlePayload.email, googlePayload.picture ?? null]
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

  res.json({ token: issueJwt(authPayload), user: authPayload });
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

  const email = (body.email ?? 'local.dev@kwsa.local').trim().toLowerCase();
  const name = (body.name ?? 'Local Dev User').trim();
  const role = (body.role ?? 'admin').trim() || 'admin';
  const googleId = (body.googleId ?? `dev-${email}`).trim();

  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  await ensureTable();
  const pool = getRequiredPgPool();

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

  res.json({ token: issueJwt(authPayload), user: authPayload });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user from the JWT.
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/logout
 * Stateless JWT – just tells the client to discard its token.
 */
router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

export default router;
