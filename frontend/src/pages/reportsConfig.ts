export type ReportConfig = {
  id: string;
  title: string;
  type: 'native' | 'powerbi';
  url?: string;
  embedUrl?: string;
};

export const REPORTS: ReportConfig[] = [
  {
    id: 'month-end-report',
    title: 'Month End Report',
    type: 'native',
  },
  {
    id: 'top-down-performance',
    title: 'Top Down Performance',
    type: 'native',
  },
  {
    id: 'associate-report',
    title: 'Associate Report',
    type: 'native',
  },
  {
    id: 'cappers-report',
    title: 'Cappers Report',
    type: 'native',
  },
  {
    id: 'listings-location-report',
    title: 'Listings Location Report',
    type: 'native',
  },
];

export function findReportById(reportId: string | undefined): ReportConfig {
  if (reportId === 'top-down-agent' || reportId === 'top-down-team' || reportId === 'top-down-agent-native') {
    return REPORTS.find((report) => report.id === 'top-down-performance') ?? REPORTS[0];
  }
  return REPORTS.find((report) => report.id === reportId) ?? REPORTS[0];
}
