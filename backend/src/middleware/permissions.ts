/**
 * Permission middleware for the KWSA Cloud Console.
 *
 * Resolves the user's active working scope from:
 *  1. The JWT user (email) attached by requireAuth
 *  2. The X-Active-Context request header (context ID from /api/auth/contexts)
 *
 * The claimed context is validated against the DB to prevent privilege escalation.
 *
 * Scopes:
 *  - GLOBAL       — Regional Admin: may read/write everything
 *  - MARKET_CENTRE — Office Admin: may read all, write only within their assigned MC
 *  - OWN          — Agent: may read all, write only their own records
 */

import type { Request, Response, NextFunction } from 'express';
import { getRequiredPgPool } from '../config/db.js';
import { logger } from '../config/logger.js';

export type PermissionScope = 'GLOBAL' | 'MARKET_CENTRE' | 'OWN';

export interface UserPermissions {
  /** Editing scope derived from the active context. */
  scope: PermissionScope;
  /** The associate's numeric DB id (core_associates.id) as a string. Null if not found. */
  associateDbId: string | null;
  /** The source_market_center_id that defines the editing boundary for MARKET_CENTRE scope. */
  marketCenterId: string | null;
  /** The user's home source_market_center_id regardless of active scope. */
  homeMcId: string | null;
  isRegionalAdmin: boolean;
  isOfficeAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      permissions?: UserPermissions;
    }
  }
}

/**
 * Express middleware — resolves permissions from DB and attaches to req.permissions.
 * Must be used AFTER requireAuth so req.user is populated.
 */
export async function resolvePermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  try {
    const pool = getRequiredPgPool();
    const email = req.user.email;
    const activeContextId = String(req.headers['x-active-context'] ?? '').trim();

    // Fetch the associate record
    const assocResult = await pool.query<{
      id: string;
      source_market_center_id: string | null;
    }>(
      `SELECT id::text, source_market_center_id
         FROM migration.core_associates
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );

    if (!assocResult.rows[0]) {
      // No associate record — deny writes entirely
      res.status(403).json({ error: 'Permission denied: your account has no associate record' });
      return;
    }

    const assoc = assocResult.rows[0];

    // Fetch roles and admin MCs in parallel
    const [rolesResult, adminMcsResult] = await Promise.all([
      pool.query<{ role_name: string }>(
        `SELECT role_name FROM migration.associate_roles WHERE associate_id = $1`,
        [assoc.id]
      ),
      pool.query<{ source_market_center_id: string }>(
        `SELECT source_market_center_id
           FROM migration.associate_admin_market_centers
          WHERE associate_id = $1`,
        [assoc.id]
      ),
    ]);

    const roles = rolesResult.rows.map((r) =>
      r.role_name.trim().toUpperCase().replace(/\s+/g, '_')
    );
    const adminMcIds = adminMcsResult.rows.map((r) => r.source_market_center_id);

    const isRegionalAdmin = roles.includes('REGIONAL_ADMIN');
    const isOfficeAdmin = roles.includes('OFFICE_ADMIN') || adminMcIds.length > 0;

    let scope: PermissionScope;
    let marketCenterId: string | null = null;

    if (isRegionalAdmin && (activeContextId === 'regional_admin' || !activeContextId)) {
      // Highest privilege — global edit access
      scope = 'GLOBAL';
    } else if (activeContextId.startsWith('admin_')) {
      // Context for an explicit admin market centre
      const claimedMcId = activeContextId.slice('admin_'.length);
      if (!adminMcIds.includes(claimedMcId)) {
        logger.warn({ email, claimedMcId }, 'Permission denied: user not admin for claimed MC');
        res.status(403).json({ error: 'Permission denied: you are not an admin for this market centre' });
        return;
      }
      scope = 'MARKET_CENTRE';
      marketCenterId = claimedMcId;
    } else if (activeContextId.startsWith('office_admin_')) {
      // Context for the user's home MC with Office Admin role
      const claimedMcId = activeContextId.slice('office_admin_'.length);
      const validOfficeAdmin =
        roles.includes('OFFICE_ADMIN') && claimedMcId === assoc.source_market_center_id;
      if (!validOfficeAdmin) {
        logger.warn({ email, claimedMcId }, 'Permission denied: not office admin for claimed MC');
        res.status(403).json({ error: 'Permission denied: not an office admin for this market centre' });
        return;
      }
      scope = 'MARKET_CENTRE';
      marketCenterId = claimedMcId;
    } else {
      // Agent context or no context — restrict to own records
      scope = 'OWN';
    }

    req.permissions = {
      scope,
      associateDbId: assoc.id,
      marketCenterId,
      homeMcId: assoc.source_market_center_id,
      isRegionalAdmin,
      isOfficeAdmin,
    };

    next();
  } catch (error) {
    logger.error({ err: error }, 'resolvePermissions: failed to resolve user permissions');
    res.status(500).json({ error: 'Failed to resolve permissions' });
  }
}
