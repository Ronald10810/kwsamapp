import { describe, expect, it } from 'vitest';

import { buildStatusChangeDateUpdateClause } from './transactions.js';

describe('transactions status_change_date SQL regression guard', () => {
  it('uses explicit $55::timestamptz when regional admin provides status_change_date', () => {
    const result = buildStatusChangeDateUpdateClause({
      isRegionalAdmin: true,
      statusChangeDateInput: '2026-06-03T00:00:00.000Z',
      transactionStatus: 'Start',
    });

    expect(result.statusChangeDateValue).toBe('2026-06-03T00:00:00.000Z');
    expect(result.statusChangeUpdateSql).toBe('$55::timestamptz');
  });

  it('keeps $55 typed via COALESCE path for non-admin status updates', () => {
    const result = buildStatusChangeDateUpdateClause({
      isRegionalAdmin: false,
      statusChangeDateInput: '2026-06-03T00:00:00.000Z',
      transactionStatus: 'Working',
    });

    expect(result.statusChangeDateValue).toBeNull();
    expect(result.statusChangeUpdateSql).toContain('CASE WHEN transaction_status IS DISTINCT FROM $2 THEN NOW()');
    expect(result.statusChangeUpdateSql).toContain('COALESCE($55::timestamptz, status_change_date)');
  });

  it('still references typed $55 when transaction_status is omitted', () => {
    const result = buildStatusChangeDateUpdateClause({
      isRegionalAdmin: false,
      statusChangeDateInput: null,
      transactionStatus: null,
    });

    expect(result.statusChangeDateValue).toBeNull();
    expect(result.statusChangeUpdateSql).toBe('COALESCE($55::timestamptz, status_change_date)');
  });
});
