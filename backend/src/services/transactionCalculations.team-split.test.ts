import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSplitPctsForTesting } from './transactionCalculations.js';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('CAP004 team split precedence', () => {
  it('CAP004-T001: team-member rows use team split over associate split in non-authoritative path', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: true,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 70,
      associateSplitPct: 50,
      gciAfterFees: 263120,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    expect(resolved.associateSplitPct).toBe(70);
    expect(resolved.marketCenterSplitPct).toBe(30);
  });

  it('CAP004-T002: manual-override style non-authoritative team path still honors team split', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: true,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 80,
      associateSplitPct: 65,
      gciAfterFees: 40000,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    expect(resolved.associateSplitPct).toBe(80);
    expect(resolved.marketCenterSplitPct).toBe(20);
  });

  it('CAP004-T003: non-team rows preserve associate split behavior', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: false,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 0,
      associateSplitPct: 50,
      gciAfterFees: 263120,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    expect(resolved.associateSplitPct).toBe(50);
    expect(resolved.marketCenterSplitPct).toBe(50);
  });

  it('CAP004-T004: outside-agent behavior remains 100/0', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: true,
      teamTransaction: true,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 70,
      associateSplitPct: 50,
      gciAfterFees: 263120,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    expect(resolved.associateSplitPct).toBe(100);
    expect(resolved.marketCenterSplitPct).toBe(0);
  });

  it('CAP004-T005: cap limiter remains contribution=min(company, capLeft)', () => {
    const calculationsSource = readWorkspaceFile('src/services/transactionCalculations.ts');

    expect(calculationsSource).toContain('const contribution = roundMoney(Math.min(row.market_center_dollar, capLeft));');
  });

  it('CAP004-T006: TH44357 expected split math is 70/30 and company=78,936 on 263,120', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: true,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 70,
      associateSplitPct: 50,
      gciAfterFees: 263120,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    const company = Math.round(263120 * (resolved.marketCenterSplitPct / 100) * 100) / 100;
    const team = Math.round(263120 * (resolved.associateSplitPct / 100) * 100) / 100;

    expect(company).toBe(78936);
    expect(team).toBe(184184);
  });

  it('CAP004-T007: strict mismatch examples resolve to configured team split percentages', () => {
    const samples = [
      { teamSplit: 70, associateSplit: 50, expectedCompanySplit: 30 },
      { teamSplit: 100, associateSplit: 70, expectedCompanySplit: 0 },
      { teamSplit: 80, associateSplit: 70, expectedCompanySplit: 20 },
    ];

    for (const sample of samples) {
      const resolved = resolveSplitPctsForTesting({
        outside: false,
        teamTransaction: true,
        authoritativePaymentDetails: false,
        configuredTeamSplitPct: sample.teamSplit,
        associateSplitPct: sample.associateSplit,
        gciAfterFees: 100000,
        paymentAssociateDollar: 0,
        paymentMarketCenterDollar: 0,
      });

      expect(resolved.associateSplitPct).toBe(sample.teamSplit);
      expect(resolved.marketCenterSplitPct).toBe(sample.expectedCompanySplit);
    }
  });

  it('CAP004-T008: quick summary continues to source company/team dollars from TAC rows', () => {
    const transactionsSource = readWorkspaceFile('src/routes/transactions.ts');

    expect(transactionsSource).toContain('tac.team_dollar::text');
    expect(transactionsSource).toContain('tac.market_center_dollar::text');
  });

  it('CAP004-T009: manual-override style team-member path still keeps team split precedence', () => {
    const resolved = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: true,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 70,
      associateSplitPct: 50,
      gciAfterFees: 100000,
      paymentAssociateDollar: 75000,
      paymentMarketCenterDollar: 25000,
    });

    expect(resolved.associateSplitPct).toBe(70);
    expect(resolved.marketCenterSplitPct).toBe(30);
  });

  it('CAP004-T010: individual capping transition keeps cap as limiter and routes overflow to associate payout', () => {
    const gciAfterFees = 100000;
    const split = resolveSplitPctsForTesting({
      outside: false,
      teamTransaction: false,
      authoritativePaymentDetails: false,
      configuredTeamSplitPct: 0,
      associateSplitPct: 70,
      gciAfterFees,
      paymentAssociateDollar: 0,
      paymentMarketCenterDollar: 0,
    });

    const associatePreCap = Math.round(gciAfterFees * (split.associateSplitPct / 100) * 100) / 100;
    const companyPreCap = Math.round(gciAfterFees * (split.marketCenterSplitPct / 100) * 100) / 100;
    const capLeft = 25000;

    const contribution = Math.min(companyPreCap, capLeft);
    const overflow = Math.round((companyPreCap - contribution) * 100) / 100;
    const associatePostCap = Math.round((associatePreCap + overflow) * 100) / 100;

    expect(companyPreCap).toBe(30000);
    expect(contribution).toBe(25000);
    expect(overflow).toBe(5000);
    expect(associatePostCap).toBe(75000);

    const calculationsSource = readWorkspaceFile('src/services/transactionCalculations.ts');
    expect(calculationsSource).toContain('const contribution = roundMoney(Math.min(row.market_center_dollar, capLeft));');
    expect(calculationsSource).toContain('const overflow = roundMoney(row.market_center_dollar - contribution);');
    expect(calculationsSource).toContain('row.associate_dollar = roundMoney(row.associate_dollar + overflow);');
  });
});
