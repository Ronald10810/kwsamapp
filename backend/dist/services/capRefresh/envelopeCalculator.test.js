import { describe, expect, it } from 'vitest';
import { buildActualEnvelopeEntries, buildProjectedEnvelopeEntries, determinePreviewMode, } from './envelopeCalculator.js';
function makeEntry(input) {
    return {
        cap_progress_key: input.teamTransaction ? 'team-200' : '101',
        row: {
            transaction_agent_id: input.transactionAgentId,
            transaction_id: input.transactionId,
            transaction_number: `TH${input.transactionId}`,
            transaction_status: input.status,
            associate_id: 101,
            source_associate_id: 'SRC101',
            is_outside_agent: false,
            agent_name: 'Test Agent',
            office_name: 'Test Office',
            transaction_side: 'Seller',
            split_percentage: 100,
            variance_sale_list_pct: 0,
            sales_value_component: 100000,
            transaction_gci_before_fees: 100000,
            average_commission_pct: 0,
            production_royalties: 6000,
            growth_share: 2000,
            total_pr_and_gs: 8000,
            gci_after_fees_excl_vat: 92000,
            associate_split_pct: 70,
            market_center_split_pct: 30,
            associate_dollar: input.associate ?? 70000,
            cap_amount: input.capAmount ?? 0,
            cap_contribution: 0,
            cap_remaining: 0,
            team_dollar: input.team ?? 0,
            market_center_dollar: input.company,
            cap_cycle_start_date: '2026-01-01',
            cap_cycle_end_date: '2026-12-31',
            effective_reporting_date: input.effectiveDate ?? '2026-03-01',
            is_registered: input.status.toLowerCase() === 'registered',
            has_authoritative_payment_details: false,
            requires_cap_progression: false,
            is_rental_transaction: false,
            is_team_transaction: input.teamTransaction ?? false,
            counts_toward_cap: true,
        },
    };
}
describe('cap refresh envelope calculator', () => {
    it('Registered rows consume cap', () => {
        const actual = buildActualEnvelopeEntries([
            makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Registered', company: 30000, associate: 70000, capAmount: 25000 }),
        ]);
        expect(actual[0].row.market_center_dollar).toBe(25000);
        expect(actual[0].row.associate_dollar).toBe(75000);
        expect(actual[0].row.cap_contribution).toBe(25000);
        expect(actual[0].row.cap_remaining).toBe(0);
    });
    it('Working rows do not consume cap in actual mode but can project consumption', () => {
        const entries = [
            makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Working', company: 20000, associate: 80000, capAmount: 30000, effectiveDate: '2026-03-01' }),
            makeEntry({ transactionAgentId: 2, transactionId: 1002, status: 'Registered', company: 20000, associate: 80000, capAmount: 30000, effectiveDate: '2026-03-02' }),
        ];
        const actual = buildActualEnvelopeEntries(entries);
        const projected = buildProjectedEnvelopeEntries(entries, [1]);
        expect(actual[0].row.cap_contribution).toBe(0);
        expect(actual[1].row.market_center_dollar).toBe(20000);
        expect(actual[1].row.cap_remaining).toBe(10000);
        expect(projected[0].row.market_center_dollar).toBe(20000);
        expect(projected[0].row.cap_remaining).toBe(10000);
        expect(projected[1].row.market_center_dollar).toBe(10000);
        expect(projected[1].row.associate_dollar).toBe(90000);
        expect(projected[1].row.cap_remaining).toBe(0);
    });
    it('team already capped sends overflow to Team dollar', () => {
        const actual = buildActualEnvelopeEntries([
            makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Registered', company: 15000, team: 35000, capAmount: 5000, teamTransaction: true }),
        ]);
        expect(actual[0].row.market_center_dollar).toBe(5000);
        expect(actual[0].row.team_dollar).toBe(45000);
    });
    it('preview mode is projected for non-registered projected statuses only', () => {
        expect(determinePreviewMode([makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Working', company: 1000 })])).toBe('projected');
        expect(determinePreviewMode([makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Registered', company: 1000 })])).toBe('actual');
        expect(determinePreviewMode([makeEntry({ transactionAgentId: 1, transactionId: 1001, status: 'Withdrawn', company: 1000 })])).toBe('actual');
    });
    it('Start/Working/Submitted/Pending/Accepted all show projected mode', () => {
        for (const status of ['Start', 'Working', 'Submitted', 'Pending', 'Accepted']) {
            expect(determinePreviewMode([makeEntry({ transactionAgentId: 1, transactionId: 1001, status, company: 1000 })])).toBe('projected');
        }
    });
    it('Rejected and Withdrawn have no actual cap consumption', () => {
        for (const status of ['Rejected', 'Withdrawn']) {
            const actual = buildActualEnvelopeEntries([
                makeEntry({ transactionAgentId: 1, transactionId: 1001, status, company: 12000, associate: 28000, capAmount: 10000 }),
            ]);
            expect(actual[0].row.cap_contribution).toBe(0);
            expect(actual[0].row.market_center_dollar).toBe(12000);
            expect(actual[0].row.associate_dollar).toBe(28000);
            expect(actual[0].row.cap_remaining).toBe(10000);
        }
    });
    it('envelope ordering uses effective date, then transaction id, then transaction agent id', () => {
        const actual = buildActualEnvelopeEntries([
            makeEntry({ transactionAgentId: 30, transactionId: 3000, status: 'Registered', company: 5000, associate: 15000, capAmount: 10000, effectiveDate: '2026-03-03' }),
            makeEntry({ transactionAgentId: 20, transactionId: 2000, status: 'Registered', company: 5000, associate: 15000, capAmount: 10000, effectiveDate: '2026-03-02' }),
            makeEntry({ transactionAgentId: 10, transactionId: 2000, status: 'Registered', company: 5000, associate: 15000, capAmount: 10000, effectiveDate: '2026-03-02' }),
        ]);
        expect(actual.map((entry) => entry.row.transaction_agent_id)).toEqual([10, 20, 30]);
        expect(actual[0].row.cap_remaining).toBe(5000);
        expect(actual[1].row.cap_remaining).toBe(0);
        expect(actual[2].row.market_center_dollar).toBe(0);
        expect(actual[2].row.associate_dollar).toBe(20000);
    });
});
//# sourceMappingURL=envelopeCalculator.test.js.map