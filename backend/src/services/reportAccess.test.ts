import { describe, expect, it } from 'vitest';

import { getReportAccess, getReportAccessSnapshot, REPORT_KEYS } from './reportAccess.js';
import type { UserPermissions } from '../middleware/permissions.js';

function buildPerms(overrides: Partial<UserPermissions>): UserPermissions {
  return {
    scope: 'OWN',
    associateDbId: '123',
    marketCenterId: null,
    homeMcId: null,
    isRegionalAdmin: false,
    isOfficeAdmin: false,
    ...overrides,
  };
}

describe('reportAccess', () => {
  it('grants all report keys to Regional Admin and keeps GLOBAL selector editable', () => {
    const perms = buildPerms({
      scope: 'GLOBAL',
      isRegionalAdmin: true,
      isOfficeAdmin: false,
    });

    const access = getReportAccess(perms, REPORT_KEYS.TOP_DOWN_PERFORMANCE);
    expect(access.canAccessReport).toBe(true);
    expect(access.reportingScope).toBe('GLOBAL');
    expect(access.marketCentreSelectorVisible).toBe(true);
    expect(access.marketCentreSelectorEditable).toBe(true);
    expect(access.defaultMarketCentreId).toBeNull();
  });

  it('grants Office Admin and locks scope to assigned market centre', () => {
    const perms = buildPerms({
      scope: 'MARKET_CENTRE',
      marketCenterId: 'KWJAC',
      homeMcId: 'KWJAC',
      isOfficeAdmin: true,
    });

    const access = getReportAccess(perms, REPORT_KEYS.LISTINGS_LOCATION_REPORT);
    expect(access.canAccessReport).toBe(true);
    expect(access.reportingScope).toBe('MARKET_CENTRE');
    expect(access.authorisedMarketCentreIds).toEqual(['KWJAC']);
    expect(access.marketCentreSelectorVisible).toBe(false);
    expect(access.marketCentreSelectorEditable).toBe(false);
    expect(access.defaultMarketCentreId).toBe('KWJAC');
  });

  it('denies unauthorised roles', () => {
    const perms = buildPerms({
      scope: 'GLOBAL',
      isRegionalAdmin: false,
      isOfficeAdmin: false,
    });

    const access = getReportAccess(perms, REPORT_KEYS.MONTH_END);
    expect(access.canAccessReport).toBe(false);
  });

  it('allows OWN-scoped users and keeps selector hidden', () => {
    const perms = buildPerms({
      scope: 'OWN',
      isRegionalAdmin: false,
      isOfficeAdmin: false,
    });

    const access = getReportAccess(perms, REPORT_KEYS.ASSOCIATE_REPORT);
    expect(access.canAccessReport).toBe(true);
    expect(access.marketCentreSelectorVisible).toBe(false);
    expect(access.marketCentreSelectorEditable).toBe(false);
  });

  it('builds a complete snapshot for all operational reports', () => {
    const perms = buildPerms({
      scope: 'GLOBAL',
      isRegionalAdmin: true,
    });

    const snapshot = getReportAccessSnapshot(perms);
    expect(Object.keys(snapshot).sort()).toEqual([
      REPORT_KEYS.ASSOCIATE_REPORT,
      REPORT_KEYS.CAPPERS_REPORT,
      REPORT_KEYS.LISTINGS_LOCATION_REPORT,
      REPORT_KEYS.MONTH_END,
      REPORT_KEYS.TOP_DOWN_PERFORMANCE,
    ].sort());
  });
});
