import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

type HomeSummary = {
  generated_at: string;
  email: string;
  associate: {
    id: string;
    source_associate_id: string;
    full_name: string | null;
    status_name: string | null;
    kwsa_email: string | null;
    private_email: string | null;
    email: string | null;
    source_market_center_id: string | null;
    source_team_id: string | null;
  } | null;
  cap: {
    period_start_date: string | null;
    period_end_date: string | null;
    total_cap_amount: number;
    cap_achieved: number;
    cap_remaining: number;
    progress_pct: number;
  };
  active_listings: {
    total: number;
    items: Array<{
      id: string;
      source_listing_id: string | null;
      listing_number: string | null;
      status_name: string | null;
      listing_status_tag: string | null;
      address_line: string | null;
      suburb: string | null;
      city: string | null;
      price: string | null;
    }>;
  };
  transactions_by_status: Array<{
    status: 'Start' | 'Working' | 'Submitted' | 'Pending' | 'Registered';
    total_transactions: number;
    total_gci: number;
  }>;
};

async function fetchHomeSummary(): Promise<HomeSummary> {
  const response = await fetch('/api/agents/me/home');
  if (!response.ok) {
    throw new Error('Unable to load Home data');
  }
  return response.json() as Promise<HomeSummary>;
}

function toMoney(value: number): string {
  if (!Number.isFinite(value)) return 'R0.00';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toDateLabel(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function CapDial({ achieved, total }: { achieved: number; total: number }) {
  const safeTotal = Math.max(total, 0);
  const safeAchieved = Math.max(achieved, 0);
  const progress = safeTotal > 0 ? Math.min(safeAchieved / safeTotal, 1) : 0;

  const cx = 192;
  const cy = 164;
  const radius = 116;
  const trackStartX = cx - radius;
  const trackEndX = cx + radius;
  const needleAngle = Math.PI * (1 - progress);
  const needleX = cx + Math.cos(needleAngle) * (radius - 8);
  const needleY = cy - Math.sin(needleAngle) * (radius - 8);
  const compactTotalLabel = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safeTotal);

  return (
    <div className="mt-3 flex h-[338px] w-[430px] items-center justify-center overflow-hidden">
      <svg width="430" height="338" viewBox="0 0 430 338" role="img" aria-label="Cap progress dial">
          <defs>
            <linearGradient id="capTrack" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fee2e2" />
              <stop offset="100%" stopColor="#fecaca" />
            </linearGradient>
            <linearGradient id="capFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="100%" stopColor="#7f1d1d" />
            </linearGradient>
          </defs>

          <path
            d={`M ${trackStartX} ${cy} A ${radius} ${radius} 0 0 1 ${trackEndX} ${cy}`}
            stroke="url(#capTrack)"
            strokeWidth="20"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M ${trackStartX} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius * Math.cos(Math.PI * (1 - progress))} ${cy - radius * Math.sin(Math.PI * (1 - progress))}`}
            stroke="url(#capFill)"
            strokeWidth="20"
            fill="none"
            strokeLinecap="round"
          />

          <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="#111827" strokeWidth="4.2" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="7.2" fill="#111827" />

          <text x={trackStartX - 10} y={cy + 42} textAnchor="start" fontSize="14" fill="#475569">
            {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(0)}
          </text>
          <text x={trackEndX + 10} y={cy + 42} textAnchor="end" fontSize="14" fill="#475569">
            {compactTotalLabel}
          </text>

          <text x={cx} y={cy + 70} textAnchor="middle" fontSize="14" fill="#334155">
            Achieved
          </text>
          <text x={cx} y={cy + 104} textAnchor="middle" fontSize="24" fontWeight="700" fill="#0f172a">
            {toMoney(safeAchieved)}
          </text>
      </svg>
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['home-summary', user?.email],
    queryFn: fetchHomeSummary,
    enabled: Boolean(user?.email),
    refetchInterval: 30000,
  });

  const statusCards = data?.transactions_by_status ?? [
    { status: 'Start', total_transactions: 0, total_gci: 0 },
    { status: 'Working', total_transactions: 0, total_gci: 0 },
    { status: 'Submitted', total_transactions: 0, total_gci: 0 },
    { status: 'Pending', total_transactions: 0, total_gci: 0 },
    { status: 'Registered', total_transactions: 0, total_gci: 0 },
  ];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="muted-text mt-2 text-sm">Agent-level cap, listings, and transaction pipeline snapshot.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-chip info">{data?.associate ? data.associate.full_name ?? user?.name : user?.email}</span>
          <button onClick={() => refetch()} className="primary-btn" type="button">
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {isLoading && (
        <section className="surface-card p-6 text-sm text-slate-600">
          Loading Home data...
        </section>
      )}

      {isError && (
        <section className="surface-card p-6 text-sm text-red-700">
          Could not load Home data. Please refresh.
        </section>
      )}

      {!isLoading && !isError && data && !data.associate && (
        <section className="surface-card p-6 text-sm text-amber-800">
          Your Google email is authenticated, but it is not linked to an associate profile yet.
        </section>
      )}

      {!isLoading && !isError && data && data.associate && (
        <>
          <section
            className="grid items-stretch gap-5 w-full"
            style={{ gridTemplateColumns: '490px minmax(0, 1fr)' }}
          >
            <div className="surface-card flex h-full flex-col p-5" style={{ minHeight: 340 }}>
                <h2 className="text-lg font-semibold text-slate-900">Cap Progress</h2>
                <p className="mt-1 text-xs muted-text">Cap achieved for the selected cycle.</p>
                <CapDial achieved={data.cap.cap_achieved} total={data.cap.total_cap_amount} />
            </div>

            <div className="surface-card flex h-full flex-col p-5" style={{ minHeight: 340 }}>
                <h2 className="text-xl font-semibold text-slate-900">Cap Cycle</h2>
                <p className="mt-1 text-sm muted-text">Current or most recent cycle based on transaction calculations.</p>

                <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Period Start</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{toDateLabel(data.cap.period_start_date)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Period End</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{toDateLabel(data.cap.period_end_date)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Total Cap</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{toMoney(data.cap.total_cap_amount)}</dd>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                    <dt className="text-xs text-slate-500">Cap Remaining</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{toMoney(data.cap.cap_remaining)}</dd>
                  </div>
                </dl>

                <div className="mt-8 pt-2">
                  <div className="h-3 rounded-full bg-red-100">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-red-600 to-red-800"
                      style={{ width: `${Math.max(0, Math.min(data.cap.progress_pct, 100))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{data.cap.progress_pct.toFixed(2)}% achieved</p>
                </div>
            </div>
          </section>

          <section className="surface-card p-6">
            <h2 className="text-xl font-semibold text-slate-900">Transaction Status (Your GCI)</h2>
            <p className="mt-1 text-sm muted-text">Statuses from DB: Start, Working, Submitted, Pending, Registered.</p>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-5">
              {statusCards.map((item) => (
                <article key={item.status} className="kpi-card">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{item.status}</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-900">{item.total_transactions.toLocaleString()}</p>
                  <p className="mt-3 text-sm font-medium text-slate-700">{toMoney(item.total_gci)}</p>
                  <p className="mt-1 text-xs text-slate-500">Total GCI</p>
                </article>
              ))}
            </div>
          </section>

          <section className="surface-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-slate-900">Active Listings</h2>
              <span className="status-chip good">{data.active_listings.total.toLocaleString()} active</span>
            </div>

            {data.active_listings.items.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
                No active listings linked to your profile.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Listing #</th>
                      <th className="px-3 py-2">Address</th>
                      <th className="px-3 py-2">Suburb / City</th>
                      <th className="px-3 py-2">Tag</th>
                      <th className="px-3 py-2 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.active_listings.items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{item.listing_number ?? item.source_listing_id ?? '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{item.address_line ?? '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{[item.suburb, item.city].filter(Boolean).join(' / ') || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{item.listing_status_tag ?? '-'}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{toMoney(Number(item.price ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
