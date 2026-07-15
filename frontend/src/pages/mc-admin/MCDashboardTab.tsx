import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';

const HOUR_MS = 60 * 60 * 1000;

function msUntilNextHourWindow(): number {
  const now = Date.now();
  const remainder = now % HOUR_MS;
  return remainder === 0 ? HOUR_MS : HOUR_MS - remainder;
}

type MCAdminSubTab = 'rentals' | 'listing-transfer' | 'agent-deregistration' | 'agent-reactivation' | 'mc-document-hub';

type MCDashboardData = {
  market_center: {
    source_market_center_id: string;
    name: string;
    logo_image_url?: string | null;
    white_logo_image_url?: string | null;
  };
  period: {
    date_from: string;
    date_to: string;
    description: string;
  };
  metrics: {
    birthdays_today: number;
    anniversaries_this_month: number;
    new_agents_this_month: number;
    active_agents: number;
    active_listings: number;
    registered_gci: number;
    registered_co_dollars: number;
    registered_units: number;
    registered_contracts: number;
    avg_gci_per_unit: number;
  };
  top_performers: {
    agents: Array<{
      associate_id: string;
      associate_name: string;
      team_name: string;
      registered_gci: number;
      units: number;
    }>;
    teams: Array<{
      team_id: string;
      team_name: string;
      registered_gci: number;
      units: number;
      active_agents: number;
    }>;
  };
  people: {
    birthdays_today: Array<{
      associate_id: string;
      associate_name: string;
      team_name: string;
      mobile_number: string | null;
      date: string;
    }>;
    anniversaries_this_month: Array<{
      associate_id: string;
      associate_name: string;
      team_name: string;
      mobile_number: string | null;
      date: string;
      years?: number;
    }>;
  };
  snapshot_date: string;
  refreshed_at: string;
  cache_state: 'fresh' | 'refreshed' | 'stale-before-03h00';
};

type FilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  selected_market_center_id: string | null;
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-ZA') : '0';
}

function formatDate(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateDayMonth(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  const day = parts[2];
  const month = Number(parts[1]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return `${day}/${parts[1]}`;
  const monthName = new Date(Date.UTC(2024, month - 1, 1)).toLocaleString('en-ZA', { month: 'short' });
  return `${day} ${monthName}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getMcInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function UiIcon({ kind }: { kind: 'birthday' | 'anniversary' | 'new-agent' | 'active-agent' | 'listing' | 'currency' | 'units' | 'contracts' | 'avg' }) {
  if (kind === 'birthday') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M6 11h12v9H6v-9Zm6-4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2Z" stroke="currentColor" strokeWidth="1.7" /><path d="M12 7v4M6 14h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (kind === 'anniversary') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (kind === 'new-agent' || kind === 'active-agent') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (kind === 'listing') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" /></svg>;
  }
  if (kind === 'units') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="m12 4 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === 'contracts') {
    return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M14 3v5h5m-10 6h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" stroke="currentColor" strokeWidth="1.7" /><path d="M21 10h-6a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  valueClassName,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon?: JSX.Element;
  valueClassName?: string;
}) {
  const isCurrencyValue = /^R\s/.test(value);
  const compactValueClass =
    value.length >= 16
      ? (isCurrencyValue ? 'text-[18px]' : 'text-[20px]')
      : value.length >= 13
        ? 'text-[22px]'
        : 'text-[26px]';

  return (
    <div
      className="rounded-xl border bg-white shadow-sm"
      style={{
        borderColor: 'var(--border-soft)',
        borderLeft: '2px solid #e5e7eb',
      }}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] leading-tight" style={{ color: 'var(--text-muted)' }}>{title}</p>
        {icon && (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            {icon}
          </span>
        )}
      </div>
      <div className="px-4 pb-2.5 pt-1">
        <div className={`${compactValueClass} font-extrabold leading-tight tabular-nums text-slate-800 ${isCurrencyValue ? 'whitespace-nowrap tracking-[-0.02em]' : ''} ${valueClassName ?? ''}`}>
          {value}
        </div>
        {subtitle && (
          <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}

const PEOPLE_PREVIEW = 5;

function PeopleListCard({
  title,
  emptyText,
  rows,
  showDate,
  showAnniversaryYears,
}: {
  title: string;
  emptyText: string;
  rows: Array<{
    associate_id: string;
    associate_name: string;
    team_name: string;
    mobile_number: string | null;
    date: string;
    years?: number;
  }>;
  showDate: boolean;
  showAnniversaryYears?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, PEOPLE_PREVIEW);
  const hasMore = rows.length > PEOPLE_PREVIEW;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        {rows.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{rows.length}</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {emptyText}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b bg-slate-50 text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Associate</th>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Team</th>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Mobile</th>
                  {showAnniversaryYears && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Anniversary</th>}
                  {showDate && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Date</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((person, rowIndex) => (
                  <tr
                    key={person.associate_id}
                    className={`border-b transition-colors hover:bg-slate-100/70 ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/35'}`}
                    style={{ borderColor: 'var(--border-soft)' }}
                  >
                    <td className="px-3 py-2 font-medium text-slate-800">{person.associate_name}</td>
                    <td className="px-3 py-2">{person.team_name}</td>
                    <td className="px-3 py-2">{person.mobile_number ? <a href={`tel:${person.mobile_number}`} className="text-red-700 hover:underline">{person.mobile_number}</a> : '—'}</td>
                    {showAnniversaryYears && (
                      <td className="px-3 py-2 tabular-nums">
                        {Number.isFinite(person.years)
                          ? `${person.years} ${person.years === 1 ? 'year' : 'years'}`
                          : '—'}
                      </td>
                    )}
                    {showDate && <td className="px-3 py-2 tabular-nums">{formatDateDayMonth(person.date)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex w-full items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--brand)' }}
            >
              {expanded ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
                  Show less
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  Show {rows.length - PEOPLE_PREVIEW} more
                </>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function MCDashboardTab({
  onQuickAction,
  userName,
}: {
  onQuickAction?: (tab: MCAdminSubTab) => void;
  userName?: string;
}) {
  const { token, isRegionalAdmin, isOfficeAdmin } = useAuth();

  const [selectedMarketCenterId, setSelectedMarketCenterId] = useState('');
  const {
    data: options,
    isLoading: isLoadingOptions,
    error: optionsError,
  } = useQuery({
    queryKey: ['mc-dashboard-filter-options', token ?? 'no-token'],
    enabled: Boolean(token),
    queryFn: async () => {
      const response = await fetch('/api/reports/mc-dashboard/filter-options');
      if (!response.ok) {
        throw new Error(`Failed to load dashboard options (${response.status})`);
      }
      return (await response.json()) as FilterOptions;
    },
    refetchInterval: () => msUntilNextHourWindow(),
    refetchOnWindowFocus: false,
    staleTime: HOUR_MS,
    gcTime: HOUR_MS,
  });

  useEffect(() => {
    if (!options) return;
    const validSelection = options.market_centers.some((mc) => mc.id === selectedMarketCenterId);
    if (selectedMarketCenterId && validSelection) return;
    const defaultId = options.selected_market_center_id ?? options.market_centers[0]?.id ?? '';
    setSelectedMarketCenterId(defaultId);
  }, [options, selectedMarketCenterId]);

  const {
    data,
    isLoading: isLoadingDashboard,
    error: dashboardError,
  } = useQuery({
    queryKey: ['mc-dashboard', selectedMarketCenterId || 'none'],
    enabled: Boolean(token) && (!isRegionalAdmin || Boolean(selectedMarketCenterId)),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketCenterId) {
        params.set('market_center_id', selectedMarketCenterId);
      }

      const response = await fetch(`/api/reports/mc-dashboard?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to load MC Dashboard (${response.status})`);
      }

      return (await response.json()) as MCDashboardData;
    },
    refetchInterval: () => msUntilNextHourWindow(),
    refetchOnWindowFocus: false,
    staleTime: HOUR_MS,
    gcTime: HOUR_MS,
  });

  const isLoading = isLoadingOptions || isLoadingDashboard;
  const error = optionsError ?? dashboardError;
  const errorMessage = error instanceof Error ? error.message : null;

  const marketCenterLabel = useMemo(() => {
    const fromData = data?.market_center?.name?.trim();
    if (fromData) return fromData;

    const fromSelection = options?.market_centers.find((mc) => mc.id === selectedMarketCenterId)?.name?.trim();
    return fromSelection || 'Market Centre';
  }, [data, options?.market_centers, selectedMarketCenterId]);

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        MC Dashboard is only available to Office Admins and Regional Admins.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Hero Card ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border shadow-md" style={{ borderColor: 'var(--border-soft)' }}>
        {/* Gradient header */}
        <div
          className="px-5 py-6"
          style={{ background: 'linear-gradient(135deg, #5a1216 0%, #7b1a1f 45%, #9b252b 100%)' }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[22px] font-bold leading-snug tracking-tight text-white">
                Welcome back, {userName?.trim() ? userName.split(' ')[0] : 'Admin'}
              </h2>
              <p className="mt-0.5 text-[13px] font-medium text-white/90">
                Here is your {marketCenterLabel} admin snapshot for today.
              </p>
              <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-white/60">
                Monitor operations, manage admin tasks, and track key daily outcomes in one place.
              </p>
            </div>
            <div className="shrink-0 self-end sm:self-center">
              {data?.market_center.white_logo_image_url || data?.market_center.logo_image_url ? (
                <img
                  src={data?.market_center.white_logo_image_url ?? data?.market_center.logo_image_url ?? undefined}
                  alt={`${data?.market_center.name ?? 'Market Centre'} logo`}
                  className="h-[64px] w-[300px] object-contain"
                />
              ) : (
                <span className="text-sm font-black text-white/80">
                  {data ? getMcInitials(data.market_center.name) : 'MC'}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Meta strip — bottom of hero */}
        {data && (
          <div className="grid grid-cols-1 divide-y divide-slate-200 border-t border-slate-200 bg-slate-50/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Period</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">
                {formatDate(data.period.date_from)} – {formatDate(data.period.date_to)}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Last Refreshed</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatTimestamp(data.refreshed_at)}</p>
            </div>
            <div className="px-4 py-3">
              {isRegionalAdmin ? (
                <>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Market Centre</label>
                  <select
                    value={selectedMarketCenterId}
                    onChange={(event) => setSelectedMarketCenterId(event.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 focus:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-100"
                  >
                    {(options?.market_centers ?? []).map((mc) => (
                      <option key={mc.id} value={mc.id}>{mc.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Market Centre</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-800">{data.market_center.name}</p>
                </>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Snapshot Date</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatDate(data.snapshot_date)}</p>
            </div>
          </div>
        )}
      </section>

      {errorMessage && (
        <section className="surface-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </section>
      )}

      {isLoading ? (
        <section className="surface-card px-4 py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading MC Dashboard snapshot...
        </section>
      ) : !data ? (
        <section className="surface-card px-4 py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Select a market centre to load dashboard metrics.
        </section>
      ) : (
        <>
          {/* ── Today's Focus strip ──────────────────────────────── */}
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/>
                <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <h3 className="text-sm font-semibold text-slate-800">Today's Focus</h3>
              <span className="ml-auto text-[11px] text-slate-400">{formatDate(data.snapshot_date)}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
              {(
                [
                  { label: "Today's Birthdays", value: formatNumber(data.metrics.birthdays_today), kind: 'birthday' as const, accent: data.metrics.birthdays_today > 0 },
                  { label: 'Anniversaries (MTD)', value: formatNumber(data.metrics.anniversaries_this_month), kind: 'anniversary' as const, accent: false },
                  { label: 'Active Agents', value: formatNumber(data.metrics.active_agents), kind: 'active-agent' as const, accent: false },
                  { label: 'Contracts (MTD)', value: formatNumber(data.metrics.registered_contracts), kind: 'contracts' as const, accent: false },
                  { label: 'GCI (MTD)', value: formatMoney(data.metrics.registered_gci), kind: 'currency' as const, accent: false },
                ]
              ).map((item) => (
                <div
                  key={item.label}
                  className="flex min-w-[120px] flex-col px-4 py-3"
                >
                  <div className="flex items-center gap-1">
                    <span className={item.accent ? 'text-red-600' : 'text-slate-400'}>
                      <UiIcon kind={item.kind} />
                    </span>
                    <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-slate-400">{item.label}</p>
                  </div>
                  <p className={`mt-1 text-xl font-extrabold leading-none tabular-nums${item.accent ? ' text-red-700' : ' text-slate-800'}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Quick Actions ─────────────────────────────────────── */}
          <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3 className="text-sm font-semibold text-slate-800">Quick Actions</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:flex sm:flex-wrap">
              {(
                [
                  {
                    label: 'Rentals',
                    tab: 'rentals' as const,
                    icon: <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7"/></svg>,
                  },
                  {
                    label: 'Listing Transfer',
                    tab: 'listing-transfer' as const,
                    icon: <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M7 16V4m0 0L4 7m3-3 3 3M17 8v12m0 0 3-3m-3 3-3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                  },
                  {
                    label: 'Agent Deregistration',
                    tab: 'agent-deregistration' as const,
                    icon: <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M17 5l2 2m0 0 2 2m-2-2-2 2m2-2-2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
                  },
                  {
                    label: 'Agent Reactivation',
                    tab: 'agent-reactivation' as const,
                    icon: <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M4 12a8 8 0 0 1 15.3-3M20 4v5h-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/></svg>,
                  },
                  {
                    label: 'MC Document Hub',
                    tab: 'mc-document-hub' as const,
                    icon: <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
                  },
                ]
              ).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => onQuickAction?.(action.tab)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 sm:w-auto sm:justify-start sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            <div className="surface-card p-3 xl:col-span-4">
              <div className="mb-3 border-b border-slate-100 pb-2">
                <h4 className="text-sm font-semibold text-slate-800">People Snapshot</h4>
                <p className="mt-0.5 text-xs text-slate-500">Agent population and key lifecycle metrics.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <KpiCard title="Today's Birthdays" value={formatNumber(data.metrics.birthdays_today)} icon={<UiIcon kind="birthday" />} />
                <KpiCard title="This Month Anniversaries" value={formatNumber(data.metrics.anniversaries_this_month)} icon={<UiIcon kind="anniversary" />} />
                <KpiCard title="New Agents (MTD)" value={formatNumber(data.metrics.new_agents_this_month)} icon={<UiIcon kind="new-agent" />} />
                <KpiCard title="Active Agents" value={formatNumber(data.metrics.active_agents)} icon={<UiIcon kind="active-agent" />} />
              </div>
            </div>

            <div className="surface-card p-3 xl:col-span-4">
              <div className="mb-3 border-b border-slate-100 pb-2">
                <h4 className="text-sm font-semibold text-slate-800">Pipeline Snapshot</h4>
                <p className="mt-0.5 text-xs text-slate-500">Listing and contract throughput across the current period.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <KpiCard title="Active Listings" value={formatNumber(data.metrics.active_listings)} icon={<UiIcon kind="listing" />} />
                <KpiCard title="Registered Contracts" value={formatNumber(data.metrics.registered_contracts)} icon={<UiIcon kind="contracts" />} />
                <KpiCard title="Registered Units (MTD)" value={formatNumber(data.metrics.registered_units)} icon={<UiIcon kind="units" />} />
              </div>
            </div>

            <div className="surface-card p-3 xl:col-span-4">
              <div className="mb-3 border-b border-slate-100 pb-2">
                <h4 className="text-sm font-semibold text-slate-800">Revenue Snapshot</h4>
                <p className="mt-0.5 text-xs text-slate-500">Core financial output for the current month-to-date period.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <KpiCard
                  title="Registered GCI (MTD)"
                  value={formatMoney(data.metrics.registered_gci)}
                  icon={<UiIcon kind="currency" />}
                  valueClassName="text-[22px] sm:text-[24px] whitespace-nowrap tracking-[-0.02em]"
                />
                <KpiCard
                  title="Registered CO$ (MTD)"
                  value={formatMoney(data.metrics.registered_co_dollars)}
                  icon={<UiIcon kind="currency" />}
                  valueClassName="text-[22px] sm:text-[24px] whitespace-nowrap tracking-[-0.02em]"
                />
                <KpiCard
                  title="Avg GCI Per Unit"
                  value={formatMoney(data.metrics.avg_gci_per_unit)}
                  icon={<UiIcon kind="avg" />}
                  valueClassName="text-[22px] sm:text-[24px] whitespace-nowrap tracking-[-0.02em]"
                />
              </div>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-800">Tools & Resources</h3>
              <p className="text-xs text-slate-500 mt-0.5">Quick links for everyday Market Centre admin operations.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <a href="https://agent.kw.com" target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-rose-100 hover:shadow">
                {/* KW Command — command/terminal icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-rose-600" aria-hidden="true"><rect x="2" y="3" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M7 8l3 3-3 3M11 14h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-xs font-semibold text-rose-800">KW Command</span>
              </a>
              <a href="https://portal.loom.co.za/" target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-100 hover:shadow">
                {/* LOOM — search/intelligence icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-red-600" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7"/><path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M11 8v3h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-xs font-semibold text-red-800">LOOM</span>
              </a>
              <a href="https://drive.google.com/drive/u/0/folders/0B9C-kz9m3NxYdEgyQ2gxSjZXRzg?resourcekey=0-OBzDvl1lm8aPsNOFafz5QQ" target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-100 hover:shadow">
                {/* Google Drive — folder/cloud icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-blue-600" aria-hidden="true"><path d="M3 17l3.5-7 3.5 7H3ZM10.5 17L14 10l3.5 7H10.5ZM8.25 13.5h7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 10 10.5 4 7 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-xs font-semibold text-blue-800">Google Drive</span>
              </a>
              <a href="https://canva.kw.com" target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-teal-100 hover:shadow">
                {/* Canva — design/layers icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-teal-600" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                <span className="text-xs font-semibold text-teal-800">Canva</span>
              </a>
              <a href="https://mail.google.com" target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-orange-100 hover:shadow">
                {/* KWSA Email — envelope icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-orange-600" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="m2 7 10 7 10-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-xs font-semibold text-orange-800">KWSA Email</span>
              </a>
              <button type="button" onClick={() => onQuickAction?.('mc-document-hub')} className="group flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow">
                {/* MC Document Hub — document stack icon */}
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-slate-600" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                <span className="text-xs font-semibold text-slate-800">MC Document Hub</span>
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <PeopleListCard
              title="Today's Birthdays"
              emptyText="No birthdays in this market centre today."
              rows={data.people?.birthdays_today ?? []}
              showDate={false}
            />
            <PeopleListCard
              title="This Month Anniversaries"
              emptyText="No anniversaries found for this month."
              rows={data.people?.anniversaries_this_month ?? []}
              showAnniversaryYears
              showDate
            />
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="surface-card overflow-hidden">
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
                <h4 className="text-sm font-semibold text-slate-800">Top Performing Agents (MTD)</h4>
                <p className="mt-0.5 text-xs text-slate-500">Ranked by registered GCI, with units as a tie-breaker.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b bg-slate-50 text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Rank</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Agent</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Team</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em]">Units</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em]">Registered GCI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_performers.agents.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                          No registered transactions for this period.
                        </td>
                      </tr>
                    ) : data.top_performers.agents.map((agent, index) => (
                      <tr
                        key={agent.associate_id}
                        className={`border-b transition-colors hover:bg-slate-100/70 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/35'}`}
                        style={{ borderColor: 'var(--border-soft)' }}
                      >
                        <td className="px-3 py-2 font-semibold text-slate-700">#{index + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{agent.associate_name}</td>
                        <td className="px-3 py-2">{agent.team_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(agent.units)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatMoney(agent.registered_gci)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
                <h4 className="text-sm font-semibold text-slate-800">Top Performing Teams (MTD)</h4>
                <p className="mt-0.5 text-xs text-slate-500">Team-level performance for active agents, units and GCI.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b bg-slate-50 text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Rank</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Team</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em]">Active Agents</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em]">Units</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em]">Registered GCI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_performers.teams.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                          No team performance records for this period.
                        </td>
                      </tr>
                    ) : data.top_performers.teams.map((team, index) => (
                      <tr
                        key={team.team_id}
                        className={`border-b transition-colors hover:bg-slate-100/70 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/35'}`}
                        style={{ borderColor: 'var(--border-soft)' }}
                      >
                        <td className="px-3 py-2 font-semibold text-slate-700">#{index + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{team.team_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(team.active_agents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(team.units)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatMoney(team.registered_gci)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
