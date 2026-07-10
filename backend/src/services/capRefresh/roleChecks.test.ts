import { describe, expect, it } from 'vitest';

import { canApplyCapRefresh } from './roleChecks.js';

describe('cap refresh apply role checks', () => {
  it('allows regional admins', () => {
    expect(canApplyCapRefresh({
      scope: 'GLOBAL',
      associateDbId: '1',
      marketCenterId: null,
      homeMcId: null,
      isRegionalAdmin: true,
      isOfficeAdmin: false,
    }, [])).toBe(true);
  });

  it('denies non-elevated users', () => {
    expect(canApplyCapRefresh({
      scope: 'OWN',
      associateDbId: '1',
      marketCenterId: null,
      homeMcId: null,
      isRegionalAdmin: false,
      isOfficeAdmin: false,
    }, ['TEAM_AGENT'])).toBe(false);
  });

  it('allows approved finance/admin roles', () => {
    expect(canApplyCapRefresh({
      scope: 'OWN',
      associateDbId: '1',
      marketCenterId: null,
      homeMcId: null,
      isRegionalAdmin: false,
      isOfficeAdmin: false,
    }, ['APPROVED_FINANCE'])).toBe(true);
    expect(canApplyCapRefresh({
      scope: 'OWN',
      associateDbId: '1',
      marketCenterId: null,
      homeMcId: null,
      isRegionalAdmin: false,
      isOfficeAdmin: false,
    }, ['ADMIN'])).toBe(true);
  });
});
