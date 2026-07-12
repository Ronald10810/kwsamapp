import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getRequiredPgPool } from '../config/db.js';
import { getAssociateAccessState } from '../utils/associateAuth.js';
const ASSOCIATE_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const associateAccessCache = new Map();
export function clearAssociateAccessCache() {
    associateAccessCache.clear();
}
function associateCacheKey(payload) {
    return `${payload.userId}:${payload.email.toLowerCase()}`;
}
export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorised' });
        return;
    }
    const token = authHeader.slice(7);
    let payload;
    try {
        payload = jwt.verify(token, env.jwtSecret);
    }
    catch {
        res.status(401).json({ error: 'Unauthorised' });
        return;
    }
    try {
        const email = payload.email;
        const displayName = payload.name;
        const cacheKey = associateCacheKey(payload);
        const cached = associateAccessCache.get(cacheKey);
        const now = Date.now();
        let hasAssociateAccess;
        let isSuspended;
        let suspendedReason;
        if (cached && cached.expiresAt > now) {
            hasAssociateAccess = cached.allowed;
            isSuspended = cached.suspended;
            suspendedReason = cached.suspendedReason;
        }
        else {
            const pool = getRequiredPgPool();
            const accessState = await getAssociateAccessState(pool, email, displayName);
            hasAssociateAccess = accessState.isRegistered;
            isSuspended = accessState.isSuspended;
            suspendedReason = accessState.suspendedReason;
            associateAccessCache.set(cacheKey, {
                allowed: hasAssociateAccess,
                suspended: isSuspended,
                suspendedReason,
                expiresAt: now + ASSOCIATE_ACCESS_CACHE_TTL_MS,
            });
        }
        if (!hasAssociateAccess) {
            res.status(403).json({ error: 'Registered associate account required' });
            return;
        }
        if (isSuspended) {
            const reasonSuffix = suspendedReason ? ` Reason: ${suspendedReason}` : '';
            res.status(403).json({ error: `MAPP access is temporarily suspended.${reasonSuffix}` });
            return;
        }
        req.user = payload;
        next();
    }
    catch {
        res.status(503).json({ error: 'Authentication service temporarily unavailable' });
    }
}
/**
 * Middleware for authenticated routes that don't require associate status
 * (e.g., LOOM, public APIs). Just validates JWT.
 */
export async function requireAuthNoAssociate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorised' });
        return;
    }
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, env.jwtSecret);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ error: 'Unauthorised' });
    }
}
//# sourceMappingURL=requireAuth.js.map