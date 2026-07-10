import { describe, expect, it } from 'vitest';

import { parseScopedDryRunArgsForTesting } from './recalculateTransactionAgentCalculationsScopedDryRun.js';

describe('scoped TAC dry-run args', () => {
  it('defaults to CAP004 strict transaction list', () => {
    const args = parseScopedDryRunArgsForTesting([]);

    expect(args.transactionNumbers).toEqual([
      'TH44357',
      'TH44427',
      'TH44650',
      'TH45218',
      'TH45483',
      'TH45519',
    ]);
  });

  it('parses --transactions CSV values', () => {
    const args = parseScopedDryRunArgsForTesting(['--transactions', 'th44357, TH44427']);

    expect(args.transactionNumbers).toEqual(['TH44357', 'TH44427']);
  });

  it('blocks write mode flags', () => {
    expect(() => parseScopedDryRunArgsForTesting(['--write'])).toThrow(
      'Write mode is blocked. Scoped recalculation currently supports dry-run only.'
    );
  });
});
