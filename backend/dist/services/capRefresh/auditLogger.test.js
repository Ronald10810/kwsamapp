import { describe, expect, it, vi } from 'vitest';
import { completeCapRefreshAudit, failCapRefreshAudit, startCapRefreshAudit } from './auditLogger.js';
describe('cap refresh audit logger', () => {
    it('writes the expected audit payload shape on start', async () => {
        const db = {
            query: vi.fn().mockResolvedValue({ rows: [{ id: '77' }] }),
        };
        const auditId = await startCapRefreshAudit(db, {
            actor: {
                associateDbId: '123',
                email: 'user@example.com',
                roleNames: ['REGIONAL_ADMIN'],
                isRegionalAdmin: true,
                isOfficeAdmin: false,
            },
            transactionId: 1001,
            transactionNumber: 'TH1001',
            envelope: {
                envelopeKey: 'team-926|2025-12-01',
                capProgressKey: 'team-926',
                envelopeType: 'team',
                entityId: '926',
                cycleStartDate: '2025-12-01',
                cycleEndDate: '2026-12-01',
                transactionAgentIds: [1, 2],
                transactionIds: [1001, 1002],
            },
            rowsScanned: 8,
            rowsAffected: 3,
            beforeSnapshot: [{ a: 1 }],
            afterSnapshot: [{ b: 2 }],
            protectedFieldCheck: {
                ok: true,
                violations: [],
                protectedNonTacWritesBlocked: true,
            },
            startedAt: new Date('2026-07-08T10:00:00.000Z'),
        });
        expect(auditId).toBe('77');
        expect(db.query).toHaveBeenCalledTimes(1);
        const call = vi.mocked(db.query).mock.calls[0];
        expect(String(call[0])).toContain('INSERT INTO migration.cap_refresh_audit');
        expect(call[1][2]).toBe('manual_apply');
        expect(call[1][5]).toBe('team-926|2025-12-01');
        expect(JSON.parse(call[1][11])).toEqual([{ a: 1 }]);
        expect(JSON.parse(call[1][12])).toEqual([{ b: 2 }]);
    });
    it('marks success on complete', async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        await completeCapRefreshAudit(db, '77', new Date('2026-07-08T10:00:10.000Z'), 10000);
        const call = vi.mocked(db.query).mock.calls[0];
        expect(String(call[0])).toContain('SET success = true');
        expect(call[1][0]).toBe('77');
    });
    it('marks failure on fail path', async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        await failCapRefreshAudit(db, '77', new Date('2026-07-08T10:00:10.000Z'), 10000, 'boom');
        const call = vi.mocked(db.query).mock.calls[0];
        expect(String(call[0])).toContain('error_message = $4');
        expect(call[1][3]).toBe('boom');
    });
});
//# sourceMappingURL=auditLogger.test.js.map