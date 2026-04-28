import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function requireAuth(req, res, next) {
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