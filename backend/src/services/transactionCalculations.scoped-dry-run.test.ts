import { describe, expect, it } from 'vitest';

import { normalizeTransactionAgentIdForTesting, selectScopedEnvelopeForTesting } from './transactionCalculations.js';

describe('transactionCalculations scoped dry-run envelope', () => {
  it('includes expanded cap progression envelope rows sharing cap key and cycle', () => {
    const rows = [
      {
        transaction_number: 'TH44357',
        cap_progress_key: 'team-123',
        cap_cycle_start_date: '2026-07-01',
      },
      {
        transaction_number: 'TH11111',
        cap_progress_key: 'team-123',
        cap_cycle_start_date: '2026-07-01',
      },
      {
        transaction_number: 'TH22222',
        cap_progress_key: 'team-123',
        cap_cycle_start_date: '2025-07-01',
      },
      {
        transaction_number: 'TH33333',
        cap_progress_key: 'team-999',
        cap_cycle_start_date: '2026-07-01',
      },
    ];

    const envelope = selectScopedEnvelopeForTesting(rows, ['TH44357']);

    expect(envelope).toHaveLength(2);
    expect(envelope.map((row) => row.transaction_number)).toEqual(['TH44357', 'TH11111']);
  });

  it('normalizes transaction agent ids from text and number values', () => {
    expect(normalizeTransactionAgentIdForTesting('2098946')).toBe(2098946);
    expect(normalizeTransactionAgentIdForTesting(2098946)).toBe(2098946);
  });
});
