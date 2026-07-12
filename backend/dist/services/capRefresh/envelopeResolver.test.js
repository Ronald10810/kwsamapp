import { describe, expect, it, vi } from 'vitest';
const { fetchRawRowsMock, groupByTransactionMock, buildPreCapCalculatedRowsWithMetaMock, } = vi.hoisted(() => ({
    fetchRawRowsMock: vi.fn(),
    groupByTransactionMock: vi.fn(),
    buildPreCapCalculatedRowsWithMetaMock: vi.fn(),
}));
vi.mock('../transactionCalculations.js', () => ({
    fetchRawRows: fetchRawRowsMock,
    groupByTransaction: groupByTransactionMock,
    buildPreCapCalculatedRowsWithMeta: buildPreCapCalculatedRowsWithMetaMock,
}));
import { resolveCapRefreshContext } from './envelopeResolver.js';
function makeEntry(capProgressKey, cycleStartDate, values) {
    return {
        cap_progress_key: capProgressKey,
        row: {
            transaction_agent_id: values.transactionAgentId,
            transaction_id: values.transactionId,
            transaction_number: values.transactionNumber ?? `TH${values.transactionId}`,
            transaction_status: 'Working',
            associate_id: values.associateId ?? 101,
            source_associate_id: values.sourceAssociateId ?? 'SRC101',
            is_outside_agent: values.isOutsideAgent ?? false,
            agent_name: 'Agent',
            office_name: 'Office',
            transaction_side: 'Seller',
            split_percentage: 100,
            variance_sale_list_pct: 0,
            sales_value_component: 0,
            transaction_gci_before_fees: 0,
            average_commission_pct: 0,
            production_royalties: 0,
            growth_share: 0,
            total_pr_and_gs: 0,
            gci_after_fees_excl_vat: 0,
            associate_split_pct: 70,
            market_center_split_pct: 30,
            associate_dollar: 0,
            cap_amount: 10000,
            cap_contribution: 0,
            cap_remaining: 10000,
            team_dollar: 0,
            market_center_dollar: 0,
            cap_cycle_start_date: cycleStartDate,
            cap_cycle_end_date: values.cycleEndDate ?? '2026-12-31',
            effective_reporting_date: '2026-03-01',
            is_registered: false,
            has_authoritative_payment_details: false,
            requires_cap_progression: false,
            is_rental_transaction: false,
            is_team_transaction: capProgressKey.startsWith('team-'),
            counts_toward_cap: true,
        },
    };
}
describe('cap refresh envelope resolver', () => {
    it('resolves associate envelope from target transaction rows', async () => {
        fetchRawRowsMock.mockResolvedValue([]);
        groupByTransactionMock.mockReturnValue([]);
        buildPreCapCalculatedRowsWithMetaMock.mockReturnValue([
            makeEntry('101', '2026-01-01', { transactionAgentId: 1, transactionId: 1001 }),
            makeEntry('101', '2026-01-01', { transactionAgentId: 2, transactionId: 1002 }),
            makeEntry('202', '2026-01-01', { transactionAgentId: 3, transactionId: 1003, associateId: 202, sourceAssociateId: 'SRC202' }),
        ]);
        const result = await resolveCapRefreshContext({ query: vi.fn() }, 1001);
        expect(result.transactionId).toBe(1001);
        expect(result.impactedEnvelopes).toHaveLength(1);
        expect(result.impactedEnvelopes[0].envelopeType).toBe('associate');
        expect(result.impactedEnvelopes[0].envelopeKey).toBe('101|2026-01-01');
        expect(result.impactedEnvelopes[0].transactionAgentIds).toEqual([1, 2]);
    });
    it('resolves team envelope from target transaction rows', async () => {
        fetchRawRowsMock.mockResolvedValue([]);
        groupByTransactionMock.mockReturnValue([]);
        buildPreCapCalculatedRowsWithMetaMock.mockReturnValue([
            makeEntry('team-926', '2025-12-01', { transactionAgentId: 11, transactionId: 2001 }),
            makeEntry('team-926', '2025-12-01', { transactionAgentId: 12, transactionId: 2002 }),
            makeEntry('team-777', '2025-12-01', { transactionAgentId: 13, transactionId: 2003 }),
        ]);
        const result = await resolveCapRefreshContext({ query: vi.fn() }, 2001);
        expect(result.impactedEnvelopes).toHaveLength(1);
        expect(result.impactedEnvelopes[0].envelopeType).toBe('team');
        expect(result.impactedEnvelopes[0].entityId).toBe('926');
        expect(result.impactedEnvelopes[0].transactionAgentIds).toEqual([11, 12]);
    });
});
//# sourceMappingURL=envelopeResolver.test.js.map