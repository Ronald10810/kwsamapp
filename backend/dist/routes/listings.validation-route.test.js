import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/db.js', () => ({
    getOptionalPgPool: () => null,
}));
vi.mock('../middleware/permissions.js', () => ({
    resolvePermissions: (_req, _res, next) => {
        next();
    },
}));
import router from './listings.js';
function createFakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}
describe('listings validation route regression guard', () => {
    it('keeps POST /validate-new-listing mounted and returns 503 when DB is unavailable', async () => {
        const layer = router.stack.find((entry) => entry.route?.path === '/validate-new-listing' && entry.route?.methods?.post);
        expect(layer).toBeTruthy();
        const routeStack = layer.route.stack;
        const handler = routeStack[routeStack.length - 1].handle;
        const req = { body: {} };
        const res = createFakeRes();
        await handler(req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ error: 'DATABASE_URL is not configured.' });
    });
});
//# sourceMappingURL=listings.validation-route.test.js.map