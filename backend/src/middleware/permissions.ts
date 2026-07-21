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
 *  - OWN          — Agent/Team roles: may read all, write only their own records
 */

import type { Request, Response, NextFunction } from 'express';
import { withPgPoolRetry } from '../config/db.js';
import { logger } from '../config/logger.js';
import { resolveAssociateIdForAuth } from '../utils/associateAuth.js';

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
    await withPgPoolRetry(async (pool) => {
      const email = req.user!.email;
      const displayName = String(req.user!.name ?? '').trim();
      const activeContextId = String(req.headers['x-active-context'] ?? '').trim();

      const assocId = await resolveAssociateIdForAuth(pool, email, displayName);
      const assocResult = assocId ? await pool.query<{
        id: string;
        source_market_center_id: string | null;
      }>(
        `SELECT id::text, source_market_center_id
           FROM migration.core_associates
          WHERE id = $1
          LIMIT 1`,
        [assocId]
      ) : { rows: [] };

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
          `SELECT DISTINCT COALESCE(resolved.source_market_center_id, amc.source_market_center_id) AS source_market_center_id
             FROM migration.associate_admin_market_centers amc
             LEFT JOIN LATERAL (
               SELECT mc.source_market_center_id
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
      ]);

      const roles = rolesResult.rows.map((r) =>
        r.role_name.trim().toUpperCase().replace(/\s+/g, '_')
      );
      const adminMcIds = adminMcsResult.rows
        .map((r) => String(r.source_market_center_id ?? '').trim())
        .filter((value) => value.length > 0);

      const isRegionalAdmin = roles.includes('REGIONAL_ADMIN');
      const isOfficeAdmin = roles.includes('OFFICE_ADMIN') || adminMcIds.length > 0;

      let scope: PermissionScope;
      let marketCenterId: string | null = null;

      if (isRegionalAdmin) {
        scope = 'GLOBAL';
      } else if (activeContextId.startsWith('regional_admin')) {
        // Only true regional admins may claim GLOBAL scope.
        logger.warn({ email, activeContextId }, 'Permission denied: non-regional user attempted GLOBAL context');
        res.status(403).json({ error: 'Permission denied: not a regional admin' });
        return;
      } else if (activeContextId.startsWith('admin_')) {
        // Admin MC context (additional MCs beyond home MC)
        const claimedMcIdRaw = activeContextId.slice('admin_'.length);
        // Validate claimed MC against the admin MC grants, resolving through the DB if needed.
        const resolvedClaimedMc = await pool.query<{ source_market_center_id: string | null }>(
          `SELECT COALESCE(resolved.source_market_center_id, mc.source_market_center_id) AS source_market_center_id
             FROM migration.core_market_centers mc
             LEFT JOIN LATERAL (
               SELECT mc2.source_market_center_id
                 FROM migration.core_market_centers mc2
                WHERE LOWER(TRIM(COALESCE(mc2.status_name, ''))) IN ('active', '1')
                  AND (
                    LOWER(TRIM(COALESCE(mc2.source_market_center_id, ''))) = LOWER(TRIM($1))
                    OR LOWER(TRIM(COALESCE(mc2.name, ''))) = LOWER(TRIM($1))
                  )
                ORDER BY CASE
                  WHEN LOWER(TRIM(COALESCE(mc2.source_market_center_id, ''))) = LOWER(TRIM($1)) THEN 0
                  ELSE 1
                END, mc2.id ASC
                LIMIT 1
             ) resolved ON TRUE
            WHERE LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM($1))
               OR LOWER(TRIM(COALESCE(mc.name, ''))) = LOWER(TRIM($1))
            ORDER BY CASE
              WHEN LOWER(TRIM(COALESCE(mc.source_market_center_id, ''))) = LOWER(TRIM($1)) THEN 0
              ELSE 1
            END, mc.id ASC
            LIMIT 1`,
          [claimedMcIdRaw]
        );
        const claimedMcId = String(resolvedClaimedMc.rows[0]?.source_market_center_id ?? claimedMcIdRaw).trim();
        if (!adminMcIds.includes(claimedMcId)) {
          logger.warn({ email, claimedMcId: claimedMcIdRaw, resolvedClaimedMcId: claimedMcId }, 'Permission denied: user not admin for claimed MC');
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
      } else if ((activeContextId === 'offline_fallback' || !activeContextId) && isOfficeAdmin) {
        // Keep Office Admin users inside their market-centre boundary even when
        // a context header is absent (for example after storage loss or fallback).
        scope = 'MARKET_CENTRE';
        marketCenterId = assoc.source_market_center_id ?? adminMcIds[0] ?? null;
      } else if (activeContextId === 'agent' || activeContextId === 'lead_agent' || activeContextId === 'team_admin' || activeContextId === 'team_agent' || !activeContextId) {
        // Agent/team contexts or no context — restrict to own records
        scope = 'OWN';
      } else {
        // Unknown context IDs are treated as OWN; callers still cannot escalate privileges.
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

      if (req.path.includes('/api/ai-tools')) {
        logger.info(
          {
            email,
            activeContextId,
            roles,
            isRegionalAdmin,
            isOfficeAdmin,
            scope,
            path: req.path,
          },
          'resolvePermissions ai-tools context'
        );
      }

      next();
    });
  } catch (error) {
    logger.error({ err: error }, 'resolvePermissions: failed to resolve user permissions');
    res.status(500).json({ error: 'Failed to resolve permissions' });
  }
}
