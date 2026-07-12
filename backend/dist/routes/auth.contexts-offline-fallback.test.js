import { describe, expect, it, vi } from 'vitest';
const { resolveAssociateIdForAuthMock } = vi.hoisted(() => ({
    resolveAssociateIdForAuthMock: vi.fn(),
}));
vi.mock('../config/db.js', () => ({
    getRequiredPgPool: () => ({ query: vi.fn() }),
    withPgPoolRetry: async (work) => work({ query: vi.fn() }),
}));
vi.mock('../utils/associateAuth.js', () => ({
    isRegisteredAssociateEmail: vi.fn().mockResolvedValue(true),
    normalizeAuthEmail: (value) => value,
    resolveAssociateIdForAuth: resolveAssociateIdForAuthMock,
}));
import router from './auth.js';
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
function getAuthContextsHandler() {
    const layer = router.stack.find((entry) => entry.route?.path === '/contexts' && entry.route?.methods?.get);
    if (!layer) {
        throw new Error('GET /contexts route not found');
    }
    const routeStack = layer.route.stack;
    return routeStack[routeStack.length - 1].handle;
}
describe('auth contexts offline fallback regression guard', () => {
    it('maps regional_admin JWT role to Regional Admin with regional_admin context id', async () => {
        resolveAssociateIdForAuthMock.mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'));
        const req = {
            user: {
                email: 'user@example.com',
                name: 'Test User',
                role: 'regional_admin',
            },
        };
        const res = createFakeRes();
        await getAuthContextsHandler()(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            contexts: [
                {
                    id: 'regional_admin',
                    label: 'Offline Regional Admin',
                    role: 'Regional Admin',
                    marketCenter: null,
                    marketCenterId: null,
                    associateId: null,
                },
            ],
            warning: 'Contexts are running in offline mode because the database is currently unreachable.',
        });
    });
    it('maps office_admin JWT role to Office Admin fallback context', async () => {
        resolveAssociateIdForAuthMock.mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'));
        const req = {
            user: {
                email: 'user@example.com',
                name: 'Test User',
                role: 'office_admin',
            },
        };
        const res = createFakeRes();
        await getAuthContextsHandler()(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            contexts: [
                {
                    id: 'offline_fallback',
                    label: 'Offline Office Admin',
                    role: 'Office Admin',
                    marketCenter: null,
                    marketCenterId: null,
                    associateId: null,
                },
            ],
            warning: 'Contexts are running in offline mode because the database is currently unreachable.',
        });
    });
});
//# sourceMappingURL=auth.contexts-offline-fallback.test.js.map