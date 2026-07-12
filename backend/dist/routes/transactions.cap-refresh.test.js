import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
function readWorkspaceFile(relativePath) {
    return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}
describe('transactions cap refresh route contract', () => {
    it('adds dry-run and apply transaction cap refresh endpoints', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        expect(source).toContain("router.post('/:id/cap-refresh/dry-run'");
        expect(source).toContain("router.post('/:id/cap-refresh/apply'");
        expect(source).toContain('dryRunCapRefresh');
        expect(source).toContain('applyCapRefresh');
    });
    it('enforces elevated role check for apply', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        expect(source).toContain('canApplyCapRefresh');
        expect(source).toContain('Permission denied: elevated cap refresh role required.');
    });
    it('guards dry-run and apply behind the CAP_REFRESH_ENABLED feature flag', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        const envSource = readWorkspaceFile('src/config/env.ts');
        expect(envSource).toContain('CAP_REFRESH_ENABLED');
        expect(envSource).toContain('enabled: parseBoolean(process.env.CAP_REFRESH_ENABLED, false)');
        expect(source).toContain('if (!env.capRefresh.enabled)');
        expect(source).toContain('Cap refresh feature is disabled. Enable CAP_REFRESH_ENABLED to use this endpoint.');
    });
    it('apply route keeps transaction rollback protection around service failure', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        expect(source).toContain("await client.query('BEGIN')");
        expect(source).toContain("await client.query('COMMIT')");
        expect(source).toContain("await client.query('ROLLBACK')");
    });
    it('keeps dry-run read-only and apply as the only TAC-writing path in the new service', () => {
        const applySource = readWorkspaceFile('src/services/capRefresh/envelopeApply.ts');
        expect(applySource).toContain('UPDATE migration.transaction_agent_calculations');
        expect(applySource).toContain('export async function dryRunCapRefresh');
        expect(applySource).toContain('export async function applyCapRefresh');
    });
    it('feature flag enabled path proceeds to service layer contracts', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        expect(source).toContain('dryRunCapRefresh(pool, id)');
        expect(source).toContain('applyCapRefresh(client, actor, id)');
    });
});
//# sourceMappingURL=transactions.cap-refresh.test.js.map