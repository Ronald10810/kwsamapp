import type { Request, Response, NextFunction } from 'express';
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
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=requireAuth.d.ts.map