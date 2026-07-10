import { describe, expect, it, vi } from 'vitest';

const {
  resolveCapRefreshContextMock,
  fetchCurrentEnvelopeTacRowsMock,
} = vi.hoisted(() => ({
  resolveCapRefreshContextMock: vi.fn(),
  fetchCurrentEnvelopeTacRowsMock: vi.fn(),
}));

vi.mock('./envelopeResolver.js', async () => {
  const actual = await vi.importActual<typeof import('./envelopeResolver.js')>('./envelopeResolver.js');
  return {
    ...actual,
    resolveCapRefreshContext: resolveCapRefreshContextMock,
  };
});

vi.mock('./envelopeDiff.js', async () => {
  const actual = await vi.importActual<typeof import('./envelopeDiff.js')>('./envelopeDiff.js');
  return {
    ...actual,
    fetchCurrentEnvelopeTacRows: fetchCurrentEnvelopeTacRowsMock,
  };
});

import { dryRunCapRefresh } from './envelopeApply.js';
import { applyCapRefresh } from './envelopeApply.js';

function makeEntry(status: string) {
  return {
    cap_progress_key: '101',
    row: {
      transaction_agent_id: 1,
      transaction_id: 1001,
      transaction_number: 'TH1001',
      transaction_status: status,
      associate_id: 101,
      source_associate_id: 'SRC101',
      is_outside_agent: false,
      agent_name: 'Agent',
      office_name: 'Office',
      transaction_side: 'Seller',
      split_percentage: 100,
      variance_sale_list_pct: 0,
      sales_value_component: 1000,
      transaction_gci_before_fees: 1000,
      average_commission_pct: 0,
      production_royalties: 60,
      growth_share: 20,
      total_pr_and_gs: 80,
      gci_after_fees_excl_vat: 920,
      associate_split_pct: 70,
      market_center_split_pct: 30,
      associate_dollar: 900,
      cap_amount: 100,
      cap_contribution: 0,
      cap_remaining: 100,
      team_dollar: 0,
      market_center_dollar: 100,
      cap_cycle_start_date: '2026-01-01',
      cap_cycle_end_date: '2026-12-31',
      effective_reporting_date: '2026-03-01',
      is_registered: false,
      has_authoritative_payment_details: false,
      requires_cap_progression: false,
      is_rental_transaction: false,
      is_team_transaction: false,
      counts_toward_cap: true,
    },
  };
}

describe('cap refresh dry-run safety', () => {
  it('dry-run does not write TAC', async () => {
    const db = { query: vi.fn() };
    const entry = makeEntry('Working');
    resolveCapRefreshContextMock.mockResolvedValue({
      transactionId: 1001,
      transactionNumber: 'TH1001',
      baseEntries: [entry],
      targetEntries: [entry],
      envelopeEntries: [entry],
      impactedEnvelopes: [{
        envelopeKey: '101|2026-01-01',
        capProgressKey: '101',
        envelopeType: 'associate',
        entityId: '101',
        cycleStartDate: '2026-01-01',
        cycleEndDate: '2026-12-31',
        transactionAgentIds: [1],
        transactionIds: [1001],
      }],
    });
    fetchCurrentEnvelopeTacRowsMock.mockResolvedValue(new Map());

    const result = await dryRunCapRefresh(db as never, 1001);

    expect(result.previewMode).toBe('projected');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('apply throws on protected field assertion failure before TAC persistence', async () => {
    const db = { query: vi.fn() };
    const entry = makeEntry('Registered');
    resolveCapRefreshContextMock.mockResolvedValue({
      transactionId: 1001,
      transactionNumber: 'TH1001',
      baseEntries: [entry],
      targetEntries: [entry],
      envelopeEntries: [entry],
      impactedEnvelopes: [{
        envelopeKey: '101|2026-01-01',
        capProgressKey: '101',
        envelopeType: 'associate',
        entityId: '101',
        cycleStartDate: '2026-01-01',
        cycleEndDate: '2026-12-31',
        transactionAgentIds: [1],
        transactionIds: [1001],
      }],
    });
    fetchCurrentEnvelopeTacRowsMock.mockResolvedValue(new Map([[1, {
      transaction_agent_id: 1,
      market_center_dollar: '100.00',
      team_dollar: '0.00',
      associate_dollar: '900.00',
      cap_contribution: '0.00',
      cap_remaining: '100.00',
      transaction_gci_before_fees: '999.00',
      gci_after_fees_excl_vat: '920.00',
      production_royalties: '60.00',
      growth_share: '20.00',
      total_pr_and_gs: '80.00',
    }]]));

    await expect(applyCapRefresh(db as never, {
      associateDbId: '1',
      email: 'user@example.com',
      roleNames: ['REGIONAL_ADMIN'],
      isRegionalAdmin: true,
      isOfficeAdmin: false,
    }, 1001)).rejects.toThrow('Cap refresh protected-field assertion failed.');
  });
});