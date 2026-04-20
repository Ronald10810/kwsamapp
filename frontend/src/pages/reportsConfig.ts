export type ReportConfig = {
  id: string;
  title: string;
  url: string;
  embedUrl: string;
};

function toEmbedUrl(url: string): string {
  const match = url.match(/\/groups\/([^/]+)\/reports\/([^/?]+)/i);
  if (!match) {
    return url;
  }

  const groupId = match[1];
  const reportId = match[2];
  return `https://app.powerbi.com/reportEmbed?groupId=${groupId}&reportId=${reportId}&autoAuth=true&filterPaneEnabled=false&navContentPaneEnabled=false`;
}

export const REPORTS: ReportConfig[] = [
  {
    id: 'month-end-report',
    title: 'Month End Report',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/d28654a9-5a1b-4856-acb6-a86620b13cc2?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/d28654a9-5a1b-4856-acb6-a86620b13cc2?experience=power-bi'),
  },
  {
    id: 'top-down-agent',
    title: 'Top Down Agent',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/4b0ffc50-130b-4954-93c3-dde133d90588?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/4b0ffc50-130b-4954-93c3-dde133d90588?experience=power-bi'),
  },
  {
    id: 'top-down-team',
    title: 'Top Down Team',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/bb7de522-3d3b-448c-98c1-03c23d9711f9?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/bb7de522-3d3b-448c-98c1-03c23d9711f9?experience=power-bi'),
  },
  {
    id: 'associate-report',
    title: 'Associate Report',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/952dafe1-83ae-4079-9892-f6edc9543023?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/952dafe1-83ae-4079-9892-f6edc9543023?experience=power-bi'),
  },
  {
    id: 'cappers-report',
    title: 'Cappers Report',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/05a0fb70-60ad-42d1-b67b-ffa41469c53d?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/05a0fb70-60ad-42d1-b67b-ffa41469c53d?experience=power-bi'),
  },
  {
    id: 'listings-location-report',
    title: 'Listings Location Report',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/98f5bd23-1379-430c-b47d-630ad14850da?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/98f5bd23-1379-430c-b47d-630ad14850da?experience=power-bi'),
  },
  {
    id: 'trend-report',
    title: 'Trend Report',
    url: 'https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/ab0bab62-24db-49ae-991b-651da20a4b59?experience=power-bi',
    embedUrl: toEmbedUrl('https://app.powerbi.com/groups/3c83a25b-cb0a-4ec6-bda2-d697e878c99e/reports/ab0bab62-24db-49ae-991b-651da20a4b59?experience=power-bi'),
  },
];

export function findReportById(reportId: string | undefined): ReportConfig {
  return REPORTS.find((report) => report.id === reportId) ?? REPORTS[0];
}
