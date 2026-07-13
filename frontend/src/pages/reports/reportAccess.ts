import type { UserContext } from '../../contexts/AuthContext';

export type ReportId =
  | 'month-end-report'
  | 'top-down-performance'
  | 'associate-report'
  | 'cappers-report'
  | 'listings-location-report';

export interface FrontendReportingScope {
  reportingScope: 'GLOBAL' | 'MARKET_CENTRE' | 'OWN';
  authorisedMarketCentreIds: string[];
  marketCentreSelectorVisible: boolean;
  marketCentreSelectorEditable: boolean;
  defaultMarketCentreId: string | null;
}

export function canAccessOperationalReport(input: {
  isRegionalAdmin: boolean;
  isOfficeAdmin: boolean;
  isAgent: boolean;
  reportId: ReportId;
}): boolean {
  void input.reportId;
  return input.isRegionalAdmin || input.isOfficeAdmin || input.isAgent;
}

export function deriveFrontendReportingScope(input: {
  activeContext: UserContext | null;
  isRegionalAdmin: boolean;
  isOfficeAdmin: boolean;
  isAgent: boolean;
}): FrontendReportingScope {
  if (input.isRegionalAdmin) {
    return {
      reportingScope: 'GLOBAL',
      authorisedMarketCentreIds: [],
      marketCentreSelectorVisible: true,
      marketCentreSelectorEditable: true,
      defaultMarketCentreId: null,
    };
  }

  if (input.isOfficeAdmin) {
    const scopedMcId = input.activeContext?.marketCenterId ?? null;
    return {
      reportingScope: 'MARKET_CENTRE',
      authorisedMarketCentreIds: scopedMcId ? [scopedMcId] : [],
      marketCentreSelectorVisible: false,
      marketCentreSelectorEditable: false,
      defaultMarketCentreId: scopedMcId,
    };
  }

  if (input.isAgent) {
    return {
      reportingScope: 'OWN',
      authorisedMarketCentreIds: [],
      marketCentreSelectorVisible: false,
      marketCentreSelectorEditable: false,
      defaultMarketCentreId: null,
    };
  }

  return {
    reportingScope: 'OWN',
    authorisedMarketCentreIds: [],
    marketCentreSelectorVisible: false,
    marketCentreSelectorEditable: false,
    defaultMarketCentreId: null,
  };
}
