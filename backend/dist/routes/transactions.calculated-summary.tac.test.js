import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
function readWorkspaceFile(relativePath) {
    return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}
describe('transactions calculated summary TAC integration contract', () => {
    it('CAP004-T011: calculated-summary route sources team/company dollars directly from TAC rows and exposes display cap remaining', () => {
        const source = readWorkspaceFile('src/routes/transactions.ts');
        expect(source).toContain("router.get('/:id/calculated-summary'");
        expect(source).toContain('FROM migration.transaction_agent_calculations tac');
        expect(source).toContain('tac.team_dollar::text');
        expect(source).toContain('tac.market_center_dollar::text');
        expect(source).toContain('WHERE tac.transaction_id = $1');
        expect(source).toContain('current_cap_remaining');
        expect(source).toContain('display_cap_remaining');
        expect(source).toContain('transaction_cap_remaining');
    });
    const runIfDb = process.env.DATABASE_URL ? it : it.skip;
    runIfDb('CAP004-T012: TAC has both team-member and non-team rows that feed calculated-summary values', async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const teamSample = await client.query(`
        SELECT tac.transaction_id::text AS transaction_id
        FROM migration.transaction_agent_calculations tac
        JOIN migration.core_associates ca ON ca.id = tac.associate_id
        WHERE tac.is_outside_agent = false
          AND ca.team_id IS NOT NULL
        ORDER BY tac.updated_at DESC NULLS LAST, tac.id DESC
        LIMIT 1
      `);
            const nonTeamSample = await client.query(`
        SELECT tac.transaction_id::text AS transaction_id
        FROM migration.transaction_agent_calculations tac
        JOIN migration.core_associates ca ON ca.id = tac.associate_id
        WHERE tac.is_outside_agent = false
          AND ca.team_id IS NULL
        ORDER BY tac.updated_at DESC NULLS LAST, tac.id DESC
        LIMIT 1
      `);
            expect(teamSample.rows[0]?.transaction_id).toBeTruthy();
            expect(nonTeamSample.rows[0]?.transaction_id).toBeTruthy();
            const details = await client.query(`
        SELECT
          tac.transaction_id::text AS transaction_id,
          tac.team_dollar::text AS team_dollar,
          tac.market_center_dollar::text AS market_center_dollar
        FROM migration.transaction_agent_calculations tac
        WHERE tac.transaction_id = ANY($1::int[])
        ORDER BY tac.id ASC
      `, [[Number(teamSample.rows[0].transaction_id), Number(nonTeamSample.rows[0].transaction_id)]]);
            expect(details.rowCount).toBeGreaterThan(0);
            for (const row of details.rows) {
                expect(Number.isFinite(Number(row.team_dollar))).toBe(true);
                expect(Number.isFinite(Number(row.market_center_dollar))).toBe(true);
            }
        }
        finally {
            await client.end();
        }
    });
});
//# sourceMappingURL=transactions.calculated-summary.tac.test.js.map