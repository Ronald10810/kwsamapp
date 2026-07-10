import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getRequiredPgPool } from '../config/db.js';
import { getAssociateAccessState } from '../utils/associateAuth.js';

const ASSOCIATE_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

type AssociateAccessCacheEntry = {
  allowed: boolean;
  suspended: boolean;
  suspendedReason: string | null;
  expiresAt: number;
};

const associateAccessCache = new Map<string, AssociateAccessCacheEntry>();
export function clearAssociateAccessCache(): void {
  associateAccessCache.clear();
}

function associateCacheKey(payload: AuthPayload): string {
  return `${payload.userId}:${payload.email.toLowerCase()}`;
}

export interface AuthPayload {
  userId: number;
  email: string;
  name: string;
  picture: string | null;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  const token = authHeader.slice(7);

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  try {
    const email = payload.email;
    const displayName = payload.name;
    const cacheKey = associateCacheKey(payload);
    const cached = associateAccessCache.get(cacheKey);
    const now = Date.now();

    let hasAssociateAccess: boolean;
    let isSuspended: boolean;
    let suspendedReason: string | null;
    if (cached && cached.expiresAt > now) {
      hasAssociateAccess = cached.allowed;
      isSuspended = cached.suspended;
      suspendedReason = cached.suspendedReason;
    } else {
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
  } catch {
    res.status(503).json({ error: 'Authentication service temporarily unavailable' });
  }
}

/**
 * Middleware for authenticated routes that don't require associate status
 * (e.g., LOOM, public APIs). Just validates JWT.
 */
export async function requireAuthNoAssociate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorised' });
  }
}
