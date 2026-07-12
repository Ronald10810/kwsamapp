import type { Request, Response, NextFunction } from 'express';
export declare function clearAssociateAccessCache(): void;
export interface AuthPayload {
    userId: number;
    email: string;
    name: string;
    picture: string | null;
    role: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Middleware for authenticated routes that don't require associate status
 * (e.g., LOOM, public APIs). Just validates JWT.
 */
export declare function requireAuthNoAssociate(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=requireAuth.d.ts.map