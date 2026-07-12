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
export declare function resolvePermissions(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=permissions.d.ts.map