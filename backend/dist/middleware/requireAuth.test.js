import { beforeEach, describe, expect, it, vi } from 'vitest';
const { jwtVerifyMock, getRequiredPgPoolMock, getAssociateAccessStateMock } = vi.hoisted(() => ({
    jwtVerifyMock: vi.fn(),
    getRequiredPgPoolMock: vi.fn(),
    getAssociateAccessStateMock: vi.fn(),
}));
vi.mock('jsonwebtoken', () => ({
    default: {
        verify: jwtVerifyMock,
    },
}));
vi.mock('../config/db.js', () => ({
    getRequiredPgPool: getRequiredPgPoolMock,
}));
vi.mock('../utils/associateAuth.js', () => ({
    getAssociateAccessState: getAssociateAccessStateMock,
}));
import { clearAssociateAccessCache, requireAuth } from './requireAuth.js';
describe('requireAuth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAssociateAccessCache();
        jwtVerifyMock.mockReturnValue({
            userId: 123,
            email: 'natasha.delarey@kwsa.co.za',
            name: 'Natasha de la Rey',
            picture: null,
            role: 'MC_ADMIN',
        });
        getRequiredPgPoolMock.mockReturnValue({});
    });
    it('refreshes access after the suspension cache is cleared', async () => {
        getAssociateAccessStateMock.mockResolvedValueOnce({
            isRegistered: true,
            associateId: '123',
            isSuspended: true,
            suspendedReason: 'Outstanding BOC\'s - May and June - R 2 700.00',
        });
        const firstReq = { headers: { authorization: 'Bearer token' } };
        const firstRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const firstNext = vi.fn();
        await requireAuth(firstReq, firstRes, firstNext);
        expect(firstRes.status).toHaveBeenCalledWith(403);
        expect(firstNext).not.toHaveBeenCalled();
        getAssociateAccessStateMock.mockResolvedValueOnce({
            isRegistered: true,
            associateId: '123',
            isSuspended: false,
            suspendedReason: null,
        });
        const cachedReq = { headers: { authorization: 'Bearer token' } };
        const cachedRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const cachedNext = vi.fn();
        await requireAuth(cachedReq, cachedRes, cachedNext);
        expect(cachedRes.status).toHaveBeenCalledWith(403);
        expect(cachedNext).not.toHaveBeenCalled();
        expect(getAssociateAccessStateMock).toHaveBeenCalledTimes(1);
        clearAssociateAccessCache();
        const refreshedReq = { headers: { authorization: 'Bearer token' } };
        const refreshedRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        const refreshedNext = vi.fn();
        await requireAuth(refreshedReq, refreshedRes, refreshedNext);
        expect(refreshedRes.status).not.toHaveBeenCalled();
        expect(refreshedNext).toHaveBeenCalledTimes(1);
        expect(getAssociateAccessStateMock).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=requireAuth.test.js.map