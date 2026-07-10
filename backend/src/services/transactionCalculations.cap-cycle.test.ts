import { describe, expect, it } from 'vitest';

import { buildCapCycleForTesting } from './transactionCalculations.js';

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

describe('transactionCalculations cap cycle boundary', () => {
  it('starts a new cycle on the exact anniversary date', () => {
    const cycle = buildCapCycleForTesting(new Date('2026-07-01T00:00:00.000Z'), '2025-07-01');

    expect(toIsoDate(cycle.start)).toBe('2026-07-01');
    expect(toIsoDate(cycle.end)).toBe('2027-06-30');
  });

  it('keeps prior cycle before the anniversary date', () => {
    const cycle = buildCapCycleForTesting(new Date('2026-06-30T23:59:59.000Z'), '2025-07-01');

    expect(toIsoDate(cycle.start)).toBe('2025-07-01');
    expect(toIsoDate(cycle.end)).toBe('2026-06-30');
  });
});
