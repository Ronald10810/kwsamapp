import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type HomeSummary = {
  generated_at: string;
  email: string;
  cap_type: 'individual' | 'team';
  team_name: string | null;
  associate: {
    id: string;
    source_associate_id: string;
    kwuid: string | null;
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

type DocHubDoc = {
  id: string;
  title: string;
  description: string | null;
  file_url: string;
  original_file_name: string;
  mime_type: string;
  file_size: string | null;
  created_at: string;
};

async function fetchHomeSummary(activeContextId: string): Promise<HomeSummary> {
  const response = await fetch('/api/agents/me/home', {
    headers: { 'X-Active-Context': activeContextId },
  });
  if (!response.ok) {
    throw new Error('Unable to load Home data');
  }
  return response.json() as Promise<HomeSummary>;
}

async function fetchMCDocs(): Promise<DocHubDoc[]> {
  const res = await fetch('/api/mc-document-hub/agent');
  if (!res.ok) return [];
  const data = await res.json() as { documents?: DocHubDoc[] };
  return data.documents ?? [];
}

function formatDocBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function capStatusLabel(progressPct: number): string {
  if (progressPct >= 100) return 'Capped';
  if (progressPct >= 85) return 'Close to cap';
  return 'Not capped yet';
}

const publicKwHomesBaseUrl = ((import.meta.env.VITE_PUBLIC_KWHOMES_BASE_URL as string | undefined) ?? 'https://kwhomes.co.za').replace(/\/$/, '');

function buildPublicLandingUrl(kwuid: string, listingNumber: string): string {
  return `${publicKwHomesBaseUrl}/${encodeURIComponent(kwuid)}/listing/${encodeURIComponent(listingNumber)}`;
}

function listingBadgeClass(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes('active') || normalized.includes('registered')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized.includes('pending') || normalized.includes('submitted') || normalized.includes('approval')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (normalized.includes('draft') || normalized.includes('start') || normalized.includes('working')) {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function HomeStatIcon({ kind }: { kind: 'listings' | 'attention' | 'transactions' | 'gci' | 'cap' | 'pipeline' }) {
  const base = 'h-4 w-4';
  switch (kind) {
    case 'listings':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 21v-5h5V21" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'attention':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M12 4.5 21 20H3l9-15.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M12 9v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="16.7" r="0.8" fill="currentColor" />
        </svg>
      );
    case 'transactions':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'gci':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.7" />
          <path d="M4 8.5h14a2 2 0 0 1 0 4H14a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'cap':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M5 18h14M7.5 18V10M12 18V6M16.5 18v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'pipeline':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <circle cx="6" cy="12" r="2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="18" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="18" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 12h6m0 0V9m0 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

function TransactionStatusIcon({ status }: { status: string }) {
  const normalized = status.toLowerCase();

  if (normalized === 'registered') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8.5 12.3 2.3 2.3 4.7-4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (normalized === 'pending' || normalized === 'submitted') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 8.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
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

function MCDocumentPanel({ onClose }: { onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['mc-doc-hub-agent'],
    queryFn: fetchMCDocs,
    staleTime: 1000 * 60 * 5,
  });

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
        <div>
          <p className="text-sm font-semibold text-slate-800">MC Document Hub</p>
          <p className="text-xs text-slate-500">Documents shared by your market centre admin.</p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
          Loading documents…
        </div>
      )}

      {isError && (
        <p className="px-5 py-4 text-sm text-red-600">Failed to load documents.</p>
      )}

      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="px-5 py-6 text-sm text-slate-500 text-center">No documents have been uploaded for your market centre yet.</p>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="divide-y divide-slate-200">
          {data.map((doc) => {
            const isPdf = doc.mime_type === 'application/pdf';
            const sizeBytes = doc.file_size ? Number(doc.file_size) : null;
            const uploadDate = new Date(doc.created_at).toLocaleDateString('en-ZA', {
              day: '2-digit', month: 'short', year: 'numeric',
            });
            return (
              <div key={doc.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${isPdf ? 'bg-red-100' : 'bg-blue-100'}`}>
                  {isPdf ? (
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-red-600"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-blue-600"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M3 9l5 5 4-4 9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{doc.title}</p>
                  {doc.description && <p className="text-xs text-slate-500 truncate">{doc.description}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {isPdf ? 'PDF' : doc.mime_type.split('/')[1].toUpperCase()}
                    {sizeBytes !== null && <> · {formatDocBytes(sizeBytes)}</>}
                    {' '}· {uploadDate}
                  </p>
                </div>
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Open
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const { user, activeContext } = useAuth();
  const [showDocs, setShowDocs] = useState(false);
  const [copiedLandingListingId, setCopiedLandingListingId] = useState<string | null>(null);
  const activeContextId = activeContext?.id ?? '';
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['home-summary', user?.email, activeContextId],
    queryFn: () => fetchHomeSummary(activeContextId),
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
  const displayName = data?.associate?.full_name ?? user?.name ?? 'there';
  const contextLabel = activeContext
    ? `${activeContext.role}${activeContext.marketCenter ? ` - ${activeContext.marketCenter}` : ''}`
    : null;
  const transactionsThisMonth = statusCards.reduce((sum, item) => sum + item.total_transactions, 0);
  const registeredStatus = statusCards.find((item) => item.status === 'Registered');
  const pendingApprovalCount = data
    ? data.active_listings.items.filter((item) => {
        const source = `${item.listing_status_tag ?? ''} ${item.status_name ?? ''}`.toLowerCase();
        return source.includes('pending') || source.includes('approval') || source.includes('submitted');
      }).length
    : 0;
  const draftCount = data
    ? data.active_listings.items.filter((item) => {
        const source = `${item.listing_status_tag ?? ''} ${item.status_name ?? ''}`.toLowerCase();
        return source.includes('draft') || source.includes('start') || source.includes('working');
      }).length
    : 0;
  const missingPriceCount = data ? data.active_listings.items.filter((item) => !Number(item.price ?? 0)).length : 0;
  const missingAddressCount = data ? data.active_listings.items.filter((item) => !(item.address_line ?? '').trim()).length : 0;
  const listingsNeedingAttention = pendingApprovalCount + draftCount + missingPriceCount + missingAddressCount;
  const capStatus = data ? capStatusLabel(data.cap.progress_pct) : 'Not capped yet';
  const shareKwuid = (data?.associate?.kwuid ?? '').trim();
  const capStatusClass =
    capStatus === 'Capped'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : capStatus === 'Close to cap'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  const kpiCards = [
    {
      title: 'Active Listings',
      value: data ? data.active_listings.total.toLocaleString() : '0',
      note: 'Current active portfolio',
      icon: 'listings' as const,
      tone: 'border-red-200 bg-red-50 text-red-700',
    },
    {
      title: 'Listings Needing Attention',
      value: listingsNeedingAttention.toLocaleString(),
      note: 'Pending, draft, or incomplete',
      icon: 'attention' as const,
      tone: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    {
      title: 'Transactions This Month',
      value: transactionsThisMonth.toLocaleString(),
      note: 'Across all pipeline statuses',
      icon: 'transactions' as const,
      tone: 'border-sky-200 bg-sky-50 text-sky-700',
    },
    {
      title: 'Registered GCI MTD',
      value: toMoney(registeredStatus?.total_gci ?? 0),
      note: 'Registered status only',
      icon: 'gci' as const,
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    {
      title: 'Cap Progress',
      value: data ? `${Math.max(0, Math.min(data.cap.progress_pct, 100)).toFixed(1)}%` : '0%',
      note: capStatus,
      icon: 'cap' as const,
      tone: 'border-slate-200 bg-slate-100 text-slate-700',
    },
  ];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="muted-text mt-2 text-sm">
            {data?.cap_type === 'team'
              ? `Team cap, listings, and transaction pipeline snapshot.`
              : 'Agent-level cap, listings, and transaction pipeline snapshot.'}
          </p>
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
          <section className="surface-card p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back, {displayName}</h2>
                <p className="mt-1 text-sm muted-text">Here is your personal business snapshot for today.</p>
              </div>
              {contextLabel && (
                <span className="status-chip info">{contextLabel}</span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {kpiCards.map((card) => (
                <article key={card.title} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.title}</p>
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${card.tone}`}>
                      <HomeStatIcon kind={card.icon} />
                    </span>
                  </div>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{card.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{card.note}</p>
                </article>
              ))}
            </div>
          </section>

          {/* Tools & Resources */}
          <section className="surface-card p-6">
            <h2 className="text-xl font-semibold text-slate-900">Tools &amp; Resources</h2>
            <p className="mt-1 text-sm muted-text">Access your frequently used tools, platforms and market centre documents.</p>
            <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {([
                {
                  label: 'KW Command',
                  href: 'https://console.command.kw.com/login',
                  favicon: 'https://www.google.com/s2/favicons?domain=command.kw.com&sz=64',
                  accent: 'bg-red-50 border-red-200 hover:bg-red-100',
                  textColor: 'text-red-800',
                },
                {
                  label: 'LOOM',
                  href: 'https://portal.loom.co.za/',
                  favicon: 'https://www.google.com/s2/favicons?domain=loom.com&sz=64',
                  accent: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
                  textColor: 'text-purple-800',
                },
                {
                  label: 'Google Drive',
                  href: 'https://drive.google.com',
                  favicon: 'https://www.google.com/s2/favicons?domain=drive.google.com&sz=64',
                  accent: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
                  textColor: 'text-blue-800',
                },
                {
                  label: 'Canva',
                  href: 'https://canva.kw.com',
                  favicon: 'https://www.google.com/s2/favicons?domain=canva.com&sz=64',
                  accent: 'bg-teal-50 border-teal-200 hover:bg-teal-100',
                  textColor: 'text-teal-800',
                },
                {
                  label: 'KWSA Email',
                  href: 'https://mail.google.com',
                  favicon: 'https://www.google.com/s2/favicons?domain=mail.google.com&sz=64',
                  accent: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
                  textColor: 'text-orange-800',
                },
              ] as const).map(({ label, href, favicon, accent, textColor }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={`group flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow ${accent}`}
                >
                  <img src={favicon} alt={label} className="h-7 w-7 rounded-md object-contain" />
                  <span className={`text-xs font-semibold ${textColor}`}>{label}</span>
                </a>
              ))}
              {/* MC Document Hub button */}
              <button
                type="button"
                onClick={() => setShowDocs((v) => !v)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-200">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-slate-600">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <span className="text-xs font-semibold text-slate-700">MC Document Hub</span>
              </button>
            </div>

            {/* Inline document panel */}
            {showDocs && (
              <MCDocumentPanel onClose={() => setShowDocs(false)} />
            )}
          </section>

          <section
            className="grid items-stretch gap-5 w-full"
            style={{ gridTemplateColumns: '490px minmax(0, 1fr)' }}
          >
            <div className="surface-card flex h-full flex-col p-5" style={{ minHeight: 340 }}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {data.cap_type === 'team' ? 'Team Cap Progress' : 'Cap Progress'}
                  </h2>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${capStatusClass}`}>
                    {capStatus}
                  </span>
                </div>
                <p className="mt-1 text-xs muted-text">
                  {data.cap_type === 'team'
                    ? `Team cap achieved${data.team_name ? ` — ${data.team_name}` : ''}.`
                    : 'Cap achieved for the selected cycle.'}
                </p>
                <CapDial achieved={data.cap.cap_achieved} total={data.cap.total_cap_amount} />
            </div>

            <div className="surface-card flex h-full flex-col p-5" style={{ minHeight: 340 }}>
                <h2 className="text-xl font-semibold text-slate-900">
                  {data.cap_type === 'team' ? 'Team Cap Cycle' : 'Cap Cycle'}
                </h2>
                <p className="mt-1 text-sm muted-text">
                  {data.cap_type === 'team'
                    ? 'Current cap year for the team.'
                    : 'Current or most recent cycle based on transaction calculations.'}
                </p>

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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Transaction Status (Your GCI)</h2>
                <p className="mt-1 text-sm muted-text">Statuses from DB: Start, Working, Submitted, Pending, Registered.</p>
              </div>
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                View Transactions
                <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M7 4.5 12.5 10 7 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-5">
              {statusCards.map((item) => (
                <article key={item.status} className="kpi-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{item.status}</p>
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                      <TransactionStatusIcon status={item.status} />
                    </span>
                  </div>
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

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Active</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{data.active_listings.total.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Pending approval</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{pendingApprovalCount.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Draft</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{draftCount.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Expiring soon</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">N/A</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Missing price</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{missingPriceCount.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                <p className="uppercase tracking-wide text-slate-500">Missing address</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{missingAddressCount.toLocaleString()}</p>
              </div>
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
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">View</th>
                      <th className="px-3 py-2 text-right">Share Landing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.active_listings.items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/70">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          <Link to={`/listings?review=${encodeURIComponent(item.id)}`} className="inline-flex items-center gap-1 text-red-700 hover:text-red-800 hover:underline">
                            {item.listing_number ?? item.source_listing_id ?? '-'}
                            <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                              <path d="M7 4.5 12.5 10 7 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{item.address_line ?? '-'}</td>
                        <td className="px-3 py-2 text-slate-700">{[item.suburb, item.city].filter(Boolean).join(' / ') || '-'}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <div className="flex flex-wrap gap-1.5">
                            {(item.listing_status_tag ? [item.listing_status_tag] : []).map((tag) => (
                              <span key={tag} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${listingBadgeClass(tag)}`}>
                                {tag}
                              </span>
                            ))}
                            {(item.status_name ? [item.status_name] : []).map((status) => (
                              <span key={status} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${listingBadgeClass(status)}`}>
                                {status}
                              </span>
                            ))}
                            {!item.listing_status_tag && !item.status_name && <span>-</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{toMoney(Number(item.price ?? 0))}</td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/listings?review=${encodeURIComponent(item.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
                            View
                            <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                              <path d="M7 4.5 12.5 10 7 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {shareKwuid && item.listing_number ? (
                            <div className="inline-flex items-center gap-2">
                              <a
                                href={buildPublicLandingUrl(shareKwuid, item.listing_number)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-800"
                              >
                                Open
                              </a>
                              <button
                                type="button"
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(buildPublicLandingUrl(shareKwuid, item.listing_number ?? ''));
                                    setCopiedLandingListingId(item.id);
                                    window.setTimeout(() => setCopiedLandingListingId((current) => (current === item.id ? null : current)), 1800);
                                  } catch {
                                    setCopiedLandingListingId(null);
                                  }
                                }}
                              >
                                {copiedLandingListingId === item.id ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Unavailable</span>
                          )}
                        </td>
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
