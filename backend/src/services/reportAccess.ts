import type { Request, Response, NextFunction } from 'express';
import type { PermissionScope, UserPermissions } from '../middleware/permissions.js';

export const REPORT_KEYS = {
  MONTH_END: 'month_end',
  TOP_DOWN_PERFORMANCE: 'top_down_performance',
  ASSOCIATE_REPORT: 'associate_report',
  CAPPERS_REPORT: 'cappers_report',
  LISTINGS_LOCATION_REPORT: 'listings_location_report',
} as const;

export type ReportKey = (typeof REPORT_KEYS)[keyof typeof REPORT_KEYS];

export interface ReportingAccess {
  reportKey: ReportKey;
  canAccessReport: boolean;
  reportingScope: PermissionScope;
  authorisedRegionIds: string[];
  authorisedMarketCentreIds: string[];
  marketCentreSelectorVisible: boolean;
  marketCentreSelectorEditable: boolean;
  defaultMarketCentreId: string | null;
  teamFilterAvailable: boolean;
  associateFilterAvailable: boolean;
}

const REPORT_LABELS: Record<ReportKey, string> = {
  [REPORT_KEYS.MONTH_END]: 'Month End Report',
  [REPORT_KEYS.TOP_DOWN_PERFORMANCE]: 'Top Down Performance',
  [REPORT_KEYS.ASSOCIATE_REPORT]: 'Associate Report',
  [REPORT_KEYS.CAPPERS_REPORT]: 'Cappers Report',
  [REPORT_KEYS.LISTINGS_LOCATION_REPORT]: 'Listings Location Report',
};

function getScopeMarketCenterId(perms: UserPermissions): string | null {
  if (perms.scope !== 'MARKET_CENTRE') {
    return null;
  }
  return perms.marketCenterId ?? perms.homeMcId ?? null;
}

export function getReportAccess(perms: UserPermissions, reportKey: ReportKey): ReportingAccess {
  const scopeMcId = getScopeMarketCenterId(perms);
  const canAccess = perms.isRegionalAdmin || perms.isOfficeAdmin || perms.scope === 'OWN';

  return {
    reportKey,
    canAccessReport: canAccess,
    reportingScope: perms.scope,
    authorisedRegionIds: [],
    authorisedMarketCentreIds: scopeMcId ? [scopeMcId] : [],
    marketCentreSelectorVisible: perms.scope === 'GLOBAL',
    marketCentreSelectorEditable: perms.scope === 'GLOBAL',
    defaultMarketCentreId: scopeMcId,
    teamFilterAvailable: canAccess,
    associateFilterAvailable: canAccess,
  };
}

export function getReportAccessSnapshot(perms: UserPermissions): Record<ReportKey, ReportingAccess> {
  return {
    [REPORT_KEYS.MONTH_END]: getReportAccess(perms, REPORT_KEYS.MONTH_END),
    [REPORT_KEYS.TOP_DOWN_PERFORMANCE]: getReportAccess(perms, REPORT_KEYS.TOP_DOWN_PERFORMANCE),
    [REPORT_KEYS.ASSOCIATE_REPORT]: getReportAccess(perms, REPORT_KEYS.ASSOCIATE_REPORT),
    [REPORT_KEYS.CAPPERS_REPORT]: getReportAccess(perms, REPORT_KEYS.CAPPERS_REPORT),
    [REPORT_KEYS.LISTINGS_LOCATION_REPORT]: getReportAccess(perms, REPORT_KEYS.LISTINGS_LOCATION_REPORT),
  };
}

export function requireReportAccess(reportKey: ReportKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const perms = req.permissions;
    if (!perms) {
      res.status(401).json({ error: 'Unauthorised' });
      return;
    }

    const access = getReportAccess(perms, reportKey);
    if (!access.canAccessReport) {
      const reportLabel = REPORT_LABELS[reportKey] ?? 'this report';
      res.status(403).json({
        error: `You do not have permission to access ${reportLabel}.`,
        report_key: reportKey,
      });
      return;
    }

    next();
  };
}
