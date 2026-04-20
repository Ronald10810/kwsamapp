import { useQuery } from '@tanstack/react-query';

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
    listings: number;
  };
  legacy: {
    marketCenters: number;
    associates: number;
    listings: number;
  };
  rejections: number;
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
};

async function fetchOpsSummary(): Promise<OpsSummary> {
  const response = await fetch('/api/ops/summary');

  if (!response.ok) {
    throw new Error('Unable to load operations summary');
  }

  return response.json() as Promise<OpsSummary>;
}

function stageTotal(stage: OpsSummary['staging'] | OpsSummary['prepared'] | OpsSummary['core']): number {
  return stage.marketCenters + stage.teams + stage.associates + stage.listings;
}

function toMoney(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Dashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['ops-summary'],
    queryFn: fetchOpsSummary,
    refetchInterval: 30000,
  });

  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodLabel = `${monthStart.toLocaleDateString()} - ${now.toLocaleDateString()}`;

  const metrics = [
    {
      title: 'Active Listings',
      value: data ? data.active.listings.toLocaleString() : '--',
      note: 'Listings currently marked Active'
    },
    {
      title: 'Active Associates',
      value: data ? data.active.associates.toLocaleString() : '--',
      note: 'Associates currently marked Active'
    },
    {
      title: 'Legacy Listings',
      value: data ? data.legacy.listings.toLocaleString() : '--',
      note: 'Published legacy records'
    },
    {
      title: 'Load Rejections',
      value: data ? data.rejections.toLocaleString() : '--',
      note: 'Rows blocked by validation rules'
    },
  ];

  const marketCentreTopThree = data?.marketCenterPerformance.slice(0, 3) ?? [];
  const marketCentrePositionsFourToThirteen = data?.marketCenterPerformance.slice(3, 13) ?? [];
  const associateTopThree = data?.associatePerformance.slice(0, 3) ?? [];
  const associatePositionsFourToFifteen = data?.associatePerformance.slice(3, 15) ?? [];
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
          <p className="muted-text mt-2 text-sm">Live migration visibility across staging, prepared, curated, and legacy tables.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-chip good">Updated {generatedAt}</span>
          <button onClick={() => refetch()} className="primary-btn" type="button">
            {isFetching ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {metrics.map((metric) => (
          <article key={metric.title} className="kpi-card">
            <h3 className="text-slate-600 text-sm font-medium">{metric.title}</h3>
            <p className="text-4xl leading-none font-semibold mt-3 tracking-tight">{metric.value}</p>
            <p className="mt-4 text-xs muted-text">{metric.note}</p>
          </article>
        ))}
      </section>

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Market Centre Performance Pulse</h2>
          <span className="status-chip info">Registered MTD by Total GCI</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Window: {periodLabel}</p>

        {data && data.marketCenterPerformance.length > 0 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-1">
              {marketCentreTopThree.map((row, index) => (
                <article
                  key={row.marketCenter}
                  className={rankCardClasses[index] ?? 'rounded-xl border border-slate-200 bg-white p-4'}
                >
                  <p className={rankLabelClasses[index] ?? 'text-xs uppercase tracking-wide text-slate-500'}>
                    #{index + 1} Market Centre
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{row.marketCenter}</p>
                  <p className="mt-2 text-sm text-slate-600">{row.totalTransactions.toLocaleString()} transactions</p>
                  <p className={rankAmountClasses[index] ?? 'mt-3 text-xl font-semibold text-slate-900'}>{toMoney(row.totalGci)}</p>
                  <p className="mt-1 text-xs text-slate-500">Sales Price: {toMoney(row.totalSalesPrice)}</p>
                </article>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <div className="space-y-3">
                {marketCentrePositionsFourToThirteen.map((row, index) => (
                  <div key={row.marketCenter} className="grid grid-cols-12 items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                    <p className="col-span-5 truncate text-sm font-medium text-slate-800">
                      <span className="mr-2 text-slate-400">#{index + 4}</span>
                      {row.marketCenter}
                    </p>
                    <p className="col-span-2 text-sm text-slate-600">{row.totalTransactions.toLocaleString()} tx</p>
                    <p className="col-span-3 text-sm font-semibold text-slate-900">{toMoney(row.totalGci)}</p>
                    <p className="col-span-2 text-xs text-slate-500">Sales: {toMoney(row.totalSalesPrice)}</p>
                  </div>
                ))}
                {marketCentrePositionsFourToThirteen.length === 0 && (
                  <div className="rounded-lg border border-slate-100 px-3 py-6 text-sm text-slate-500">
                    No positions 4-13 available in this period yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No market centre transaction performance data available yet.
          </div>
        )}
      </section>

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Top 15 Associates This Month</h2>
          <span className="status-chip info">Registered MTD by Total GCI</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Window: {periodLabel}</p>

        {data && data.associatePerformance.length > 0 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3 lg:items-stretch">
            <div className="space-y-3 lg:col-span-1 lg:flex lg:flex-col">
              {associateTopThree.map((row, index) => (
                <article
                  key={`${row.associateName}-${index}`}
                  className={`${rankCardClasses[index] ?? 'rounded-xl border border-slate-200 bg-white p-4'} lg:flex-1`}
                >
                  <p className={rankLabelClasses[index] ?? 'text-xs uppercase tracking-wide text-slate-500'}>
                    #{index + 1} Associate
                  </p>
                  <p className="mt-2 truncate text-2xl font-bold text-slate-900">{row.associateName}</p>
                  <p className="mt-2 text-sm text-slate-600">{row.marketCenter}</p>
                  <p className="mt-2 text-sm text-slate-600">{row.totalTransactions.toLocaleString()} tx</p>
                  <p className={rankAmountClasses[index] ?? 'mt-3 text-xl font-semibold text-slate-900'}>{toMoney(row.totalGci)}</p>
                </article>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <div className="space-y-3">
                {associatePositionsFourToFifteen.map((row, index) => (
                  <div key={`${row.associateName}-${index + 4}`} className="grid grid-cols-12 items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                    <p className="col-span-4 truncate text-sm font-medium text-slate-800">
                      <span className="mr-2 text-slate-400">#{index + 4}</span>
                      {row.associateName}
                    </p>
                    <p className="col-span-3 truncate text-sm text-slate-600">{row.marketCenter}</p>
                    <p className="col-span-2 text-sm text-slate-600">{row.totalTransactions.toLocaleString()} tx</p>
                    <p className="col-span-3 text-sm font-semibold text-slate-900">{toMoney(row.totalGci)}</p>
                  </div>
                ))}
                {associatePositionsFourToFifteen.length === 0 && (
                  <div className="rounded-lg border border-slate-100 px-3 py-6 text-sm text-slate-500">
                    No positions 4-15 available in this period yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No associate performance data available for the current month.
          </div>
        )}
      </section>

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-800">Data Pipeline Status</h2>
          <div className="flex items-center gap-2">
            <span className="status-chip info">Auto refresh: 30s</span>
            {isLoading && <span className="status-chip info">Loading</span>}
            {isError && <span className="status-chip warn">Backend unavailable</span>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Staging</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{data ? stageTotal(data.staging).toLocaleString() : '--'}</p>
            <p className="mt-2 text-xs text-slate-600">Raw CSV rows loaded</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Prepared</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{data ? stageTotal(data.prepared).toLocaleString() : '--'}</p>
            <p className="mt-2 text-xs text-slate-600">Deduped and normalized</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Core</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{data ? stageTotal(data.core).toLocaleString() : '--'}</p>
            <p className="mt-2 text-xs text-slate-600">Curated console entities</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Legacy Published</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{data ? (data.legacy.marketCenters + data.legacy.associates + data.legacy.listings).toLocaleString() : '--'}</p>
            <p className="mt-2 text-xs text-slate-600">Records pushed to legacy tables</p>
          </article>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Import: CSV files loaded into staging schema</div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">Transform: prepared + core materialization complete</div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Quality Gate: rejected row count tracked continuously</div>
        </div>
      </section>
    </div>
  );
}
