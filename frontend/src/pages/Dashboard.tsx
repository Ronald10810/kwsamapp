import { useQuery } from '@tanstack/react-query';

const HOUR_MS = 60 * 60 * 1000;

function msUntilNextHour(): number {
  const now = Date.now();
  const remainder = now % HOUR_MS;
  return remainder === 0 ? HOUR_MS : HOUR_MS - remainder;
}

type OpsSummary = {
  generatedAt: string;
  staging: {
    marketCenters: number;
    teams: number;
    associates: number;
    listings: number;
  };
  prepared: {
    marketCenters: number;
    teams: number;
    associates: number;
    listings: number;
  };
  core: {
    marketCenters: number;
    teams: number;
    associates: number;
    listings: number;
  };
  active: {
    associates: number;
    forSaleListings: number;
    rentalListings: number;
  };
  legacy: {
    marketCenters: number;
    associates: number;
    listings: number;
  };
  rentals: {
    active: number;
    cancelled: number;
    dueToday: number;
    overdue: number;
    paidThisMonth: number;
    gciThisMonth: number;
    coDollarThisMonth: number;
  };
  rejections: number;
  reportingWindow?: {
    start_date: string;
    end_date: string;
    basis: 'registered' | 'allStatuses';
  };
  performanceBasis?: 'registered' | 'allStatuses';
  marketCenterPerformance: Array<{
    marketCenter: string;
    totalTransactions: number;
    totalGci: number;
    totalSalesPrice: number;
  }>;
  associatePerformance: Array<{
    associateName: string;
    marketCenter: string;
    totalTransactions: number;
    totalGci: number;
  }>;
  teamPerformance: Array<{
    teamName: string;
    marketCenter: string;
    totalTransactions: number;
    totalGci: number;
  }>;
};

async function fetchOpsSummary(): Promise<OpsSummary> {
  const response = await fetch('/api/ops/summary');

  if (!response.ok) {
    throw new Error('Unable to load operations summary');
  }

  return response.json() as Promise<OpsSummary>;
}

type ListingTotalsResponse = {
  total?: number;
};

async function fetchListingTotal(params: Record<string, string>): Promise<number> {
  const query = new URLSearchParams({ limit: '1', offset: '0', ...params });
  const response = await fetch(`/api/listings?${query.toString()}`);

  if (!response.ok) {
    return 0;
  }

  const body = (await response.json()) as ListingTotalsResponse;
  return Number(body.total ?? 0);
}

async function fetchDashboardListingKpis(): Promise<{ forSale: number; toLet: number }> {
  const [
    forSaleByStatus,
    activeForSale,
    toRentByStatus,
    forRentByStatus,
    activeProcurement,
    activeManagement,
  ] = await Promise.all([
    fetchListingTotal({ status: 'For Sale' }),
    fetchListingTotal({ status: 'Active', saleOrRent: 'For Sale' }),
    fetchListingTotal({ status: 'To Rent' }),
    fetchListingTotal({ status: 'For Rent' }),
    fetchListingTotal({ status: 'Active', saleOrRent: 'Procurement Rental' }),
    fetchListingTotal({ status: 'Active', saleOrRent: 'Management Rental' }),
  ]);

  const forSale = Math.max(forSaleByStatus, activeForSale);
  const toLet = Math.max(toRentByStatus, forRentByStatus, activeProcurement + activeManagement);

  return { forSale, toLet };
}

function toMoney(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value);
}

type KpiIconName = 'home' | 'users' | 'archive' | 'alertTriangle' | 'building' | 'calendarClock' | 'alertCircle' | 'wallet' | 'trendingUp';
type KpiStatusTone = 'neutral' | 'good' | 'warn';

function KpiIcon({ name }: { name: KpiIconName }) {
  const base = 'h-4 w-4';

  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 21v-5h5V21" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'users':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M16.5 20a4.5 4.5 0 0 0-9 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M21 20a3.5 3.5 0 0 0-3-3.46" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M18 4.5a2.5 2.5 0 1 1 0 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'archive':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <rect x="3" y="4" width="18" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M5 8.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'alertTriangle':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M12 4.5 21 20H3l9-15.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M12 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="16.7" r="0.8" fill="currentColor" />
        </svg>
      );
    case 'building':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M11 21v-3h2v3" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'calendarClock':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 3.5v4M16 3.5v4M3.5 9.5h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="14.5" r="2.8" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 13v1.8l1.1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'alertCircle':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 8.5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="16.8" r="0.8" fill="currentColor" />
        </svg>
      );
    case 'wallet':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.7" />
          <path d="M4 8.5h14a2 2 0 0 1 0 4H14a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="16.8" cy="10.5" r="0.8" fill="currentColor" />
        </svg>
      );
    case 'trendingUp':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="17 6 23 6 23 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : rank === 2
      ? 'border-slate-300 bg-slate-100 text-slate-700'
      : 'border-red-200 bg-red-50 text-red-700';
  const iconPath = rank === 1
    ? 'M12 4.5l2.3 4.5 5 .7-3.6 3.5.9 4.9L12 16l-4.6 2.1.9-4.9L4.7 9.7l5-.7L12 4.5Z'
    : rank === 2
    ? 'M12 5.2A5.8 5.8 0 1 0 12 16.8 5.8 5.8 0 0 0 12 5.2ZM9.2 17.4l-1.7 3.4L12 19l4.5 1.8-1.7-3.4'
    : 'M12 5.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm-2.8 12.1L7.6 21 12 19.4 16.4 21l-1.6-3.4';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${tone}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
        <path d={iconPath} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      #{rank}
    </span>
  );
}

export default function Dashboard() {
  const { data } = useQuery({
    queryKey: ['ops-summary'],
    queryFn: fetchOpsSummary,
    refetchInterval: () => msUntilNextHour(),
    refetchOnWindowFocus: false,
  });

  const { data: listingKpis } = useQuery({
    queryKey: ['dashboard-listing-kpis'],
    queryFn: fetchDashboardListingKpis,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
  });

  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';

  const periodLabel = data?.reportingWindow
    ? `${new Date(data.reportingWindow.start_date).toLocaleDateString()} - ${new Date(data.reportingWindow.end_date).toLocaleDateString()}`
    : (() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return `${monthStart.toLocaleDateString()} - ${now.toLocaleDateString()}`;
      })();
  
  const monthYearLabel = data?.reportingWindow
    ? new Date(data.reportingWindow.start_date).toLocaleString(undefined, { month: 'long', year: 'numeric' })
    : (() => {
        const now = new Date();
        return now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
      })();
  
  const performanceBasis = data?.performanceBasis ?? data?.reportingWindow?.basis ?? 'registered';
  const performanceLabel =
    performanceBasis === 'allStatuses'
      ? 'All Statuses This Month by Total GCI'
      : 'Registered MTD by Total GCI';

  // Guard against malformed/null payload fields so Dashboard never hard-crashes.
  const safeActive = data?.active ?? { associates: 0, forSaleListings: 0, rentalListings: 0 };
  const effectiveForSaleListings = listingKpis?.forSale ?? safeActive.forSaleListings ?? 0;
  const effectiveRentalListings = listingKpis?.toLet ?? safeActive.rentalListings ?? 0;
  const marketCenterPerformance = Array.isArray(data?.marketCenterPerformance) ? data.marketCenterPerformance : [];
  const associatePerformance = Array.isArray(data?.associatePerformance) ? data.associatePerformance : [];
  const teamPerformance = Array.isArray(data?.teamPerformance) ? data.teamPerformance : [];

  const registeredTransactions = marketCenterPerformance.reduce((sum, row) => sum + row.totalTransactions, 0);

  const metrics = [
    {
      title: 'Active Associates',
      value: (safeActive.associates ?? 0).toLocaleString(),
      note: 'Associates currently marked Active',
      status: 'Live data',
      icon: 'users' as KpiIconName,
      tone: 'good' as KpiStatusTone,
    },
    {
      title: 'Active For Sale Listings',
      value: effectiveForSaleListings.toLocaleString(),
      note: 'For sale listings currently marked Active',
      status: 'Live data',
      icon: 'home' as KpiIconName,
      tone: 'good' as KpiStatusTone,
    },
    {
      title: 'Active To Let Listings',
      value: effectiveRentalListings.toLocaleString(),
      note: 'Rental listings currently marked Active',
      status: 'Live data',
      icon: 'building' as KpiIconName,
      tone: 'good' as KpiStatusTone,
    },
    {
      title: 'Registered Transactions',
      value: (registeredTransactions ?? 0).toLocaleString(),
      note: 'Transactions registered this period',
      status: 'Registered',
      icon: 'trendingUp' as KpiIconName,
      tone: 'good' as KpiStatusTone,
    },
  ];

  const marketCentreTopThree = marketCenterPerformance.slice(0, 3);
  const associateTopThree = associatePerformance.slice(0, 3);
  const teamTopThree = teamPerformance.slice(0, 3);
  const rankCardClasses = [
    'rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5',
    'rounded-xl border border-slate-300 bg-gradient-to-br from-slate-100 to-white p-4',
    'rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-white p-4',
  ];
  const rankLabelClasses = [
    'text-xs uppercase tracking-wide text-amber-700',
    'text-xs uppercase tracking-wide text-slate-600',
    'text-xs uppercase tracking-wide text-red-700',
  ];
  const rankAmountClasses = [
    'mt-3 text-xl font-semibold text-amber-700',
    'mt-3 text-xl font-semibold text-slate-900',
    'mt-3 text-xl font-semibold text-red-700',
  ];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted-text mt-2 text-sm">Live operational view of listings, associates, rentals, transactions and data pipeline health.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-chip good">Updated {generatedAt}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((metric) => (
          <article key={metric.title} className="kpi-card group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md !p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-slate-600 text-sm font-medium leading-snug">{metric.title}</h3>
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                  metric.tone === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : metric.tone === 'good'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <KpiIcon name={metric.icon} />
              </span>
            </div>
            <p className="mt-2 text-3xl leading-none font-semibold tracking-tight text-slate-900">{metric.value}</p>
            <p className="mt-1.5 text-xs muted-text">{metric.note}</p>
            <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{metric.status}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Registered GCI Rankings {monthYearLabel}</h2>
          <span className="status-chip info">{performanceLabel}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{periodLabel}</p>

        {data && (marketCenterPerformance.length > 0 || associatePerformance.length > 0 || teamPerformance.length > 0) ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {/* Market Centres Column */}
            <div className="flex flex-col space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex-shrink-0">Market Centre Performance</h3>
              {marketCentreTopThree.length > 0 ? (
                marketCentreTopThree.map((row, index) => (
                  <article
                    key={row.marketCenter}
                    className={`${rankCardClasses[index] ?? 'rounded-xl border border-slate-200 bg-white p-4'} transition-all duration-200 hover:shadow-md min-h-[140px] flex flex-col justify-between`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={rankLabelClasses[index] ?? 'text-xs uppercase tracking-wide text-slate-500'}>
                          #{index + 1} Market Centre
                        </p>
                        <RankBadge rank={index + 1} />
                      </div>
                      <p className="mt-2 text-lg font-bold text-slate-900">{row.marketCenter}</p>
                      <p className="mt-2 text-sm text-slate-600 h-5" />
                      <p className="mt-1 text-sm text-slate-600">{(row.totalTransactions ?? 0).toLocaleString()} tx</p>
                    </div>
                    <p className={rankAmountClasses[index] ?? 'mt-3 text-lg font-semibold text-slate-900'}>{toMoney(row.totalGci)}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-slate-100 px-3 py-4 text-sm text-slate-500">
                  No market centre data available
                </div>
              )}
            </div>

            {/* Associates Column */}
            <div className="flex flex-col space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex-shrink-0">Top Associates</h3>
              {associateTopThree.length > 0 ? (
                associateTopThree.map((row, index) => (
                  <article
                    key={`${row.associateName}-${index}`}
                    className={`${rankCardClasses[index] ?? 'rounded-xl border border-slate-200 bg-white p-4'} transition-all duration-200 hover:shadow-md min-h-[140px] flex flex-col justify-between`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={rankLabelClasses[index] ?? 'text-xs uppercase tracking-wide text-slate-500'}>
                          #{index + 1} Associate
                        </p>
                        <RankBadge rank={index + 1} />
                      </div>
                      <p className="mt-2 truncate text-lg font-bold text-slate-900">{row.associateName}</p>
                      <p className="mt-2 text-sm text-slate-600">{row.marketCenter}</p>
                      <p className="mt-1 text-sm text-slate-600">{(row.totalTransactions ?? 0).toLocaleString()} tx</p>
                    </div>
                    <p className={rankAmountClasses[index] ?? 'mt-3 text-lg font-semibold text-slate-900'}>{toMoney(row.totalGci)}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-slate-100 px-3 py-4 text-sm text-slate-500">
                  No associate data available
                </div>
              )}
            </div>

            {/* Teams Column */}
            <div className="flex flex-col space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex-shrink-0">Top Teams</h3>
              {teamTopThree.length > 0 ? (
                teamTopThree.map((row, index) => (
                  <article
                    key={`${row.teamName}-${index}`}
                    className={`${rankCardClasses[index] ?? 'rounded-xl border border-slate-200 bg-white p-4'} transition-all duration-200 hover:shadow-md min-h-[140px] flex flex-col justify-between`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={rankLabelClasses[index] ?? 'text-xs uppercase tracking-wide text-slate-500'}>
                          #{index + 1} Team
                        </p>
                        <RankBadge rank={index + 1} />
                      </div>
                      <p className="mt-2 truncate text-lg font-bold text-slate-900">{row.teamName}</p>
                      <p className="mt-2 text-sm text-slate-600">{row.marketCenter}</p>
                      <p className="mt-1 text-sm text-slate-600">{(row.totalTransactions ?? 0).toLocaleString()} tx</p>
                    </div>
                    <p className={rankAmountClasses[index] ?? 'mt-3 text-lg font-semibold text-slate-900'}>{toMoney(row.totalGci)}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-slate-100 px-3 py-4 text-sm text-slate-500">
                  No team data available
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No performance data available for the current period.
          </div>
        )}
      </section>

    </div>
  );
}
