import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FilterPanel, MultiSelectFilter, ReportHeader, ReportIcon, ReportKpiCard, StatusChip } from './ReportUi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListingRow = {
  listing_number: string;
  list_date: string;
  days_on_market: number;
  primary_agent: string;
  agent_names: string;
  market_center_name: string;
  city: string;
  suburb: string;
  province: string;
  full_address: string;
  price: number;
  mandate_type: string;
  listing_type: string;
  listing_status_tag: string;
  status_name: string;
  sale_or_rent: string;
  bedrooms: number;
  bathrooms: number;
  garages: number;
  lounges: number;
  dining_rooms: number;
  pools: number;
  reduced_date: string | null;
  p24_ref: string | null;
  private_property_ref: string | null;
};

type ListingsData = {
  rows: ListingRow[];
  totals: { total: number; active: number; avg_price: number };
};

type FilterOptions = {
  provinces: string[];
  suburbs: string[];
  listing_statuses: string[];
  property_types: string[];
  sale_or_rent_options: string[];
  mandate_types: string[];
  agents: string[];
  market_centers: Array<{ id: string; name: string }>;
};

type Filters = {
  list_date_from: string;
  list_date_to: string;
  listing_status: string[];
  province: string[];
  suburb: string;
  market_center_ids: string[];
  agent_query: string;
  property_type: string[];
  sale_or_rent: string[];
  mandate_type: string[];
};

type SortKey = keyof Pick<
  ListingRow,
  | 'listing_number'
  | 'list_date'
  | 'days_on_market'
  | 'primary_agent'
  | 'market_center_name'
  | 'city'
  | 'suburb'
  | 'province'
  | 'full_address'
  | 'price'
  | 'mandate_type'
  | 'listing_type'
  | 'listing_status_tag'
  | 'sale_or_rent'
  | 'bedrooms'
  | 'bathrooms'
  | 'garages'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFirstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('T')[0].split('-');
  return `${parseInt(month)}/${parseInt(day)}/${year}`;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(value);
}

function formatMoneyKpi(value: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(value ?? 0);
}

function exportCsv(rows: ListingRow[], dateFrom: string, dateTo: string): void {
  const headers = [
    'KWL Number', 'List Date', 'Days On Market', 'Primary Agent', 'All Agents',
    'Market Centre', 'City', 'Suburb', 'Province', 'Full Address',
    'List Price', 'Mandate Type', 'Listing Type', 'Listing Status', 'Sale/Rent',
    'Bed', 'Bath', 'Garage', 'Lounge', 'Dining Room', 'Pool',
    'Reduced Date', 'P24 Ref', 'Private Property Ref',
  ];
  const csvRows = rows.map((r) =>
    [
      r.listing_number, r.list_date, r.days_on_market,
      `"${r.primary_agent.replace(/"/g, '""')}"`,
      `"${r.agent_names.replace(/"/g, '""')}"`,
      r.market_center_name, r.city, r.suburb, r.province,
      `"${r.full_address.replace(/"/g, '""')}"`,
      r.price, r.mandate_type, r.listing_type, r.listing_status_tag, r.sale_or_rent,
      r.bedrooms, r.bathrooms, r.garages, r.lounges, r.dining_rooms, r.pools,
      r.reduced_date ?? '', r.p24_ref ?? '', r.private_property_ref ?? '',
    ].join(',')
  );
  const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `listings-location-${dateFrom}-to-${dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Dash() {
  return <span style={{ color: 'var(--text-muted)' }}>—</span>;
}

function Num({ v }: { v: number }) {
  return (
    <td className="px-3 py-2 text-right text-xs tabular-nums"
      style={{ color: v > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
      {v}
    </td>
  );
}

function getDisplayAgent(row: ListingRow): string {
  const primary = (row.primary_agent || '').trim();
  if (primary) return primary;

  const firstFromList = (row.agent_names || '')
    .split(',')
    .map((name) => name.trim())
    .find(Boolean);

  return firstFromList || '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingsLocationReport() {
  const { token, activeContext, isRegionalAdmin } = useAuth();

  // Debug logging for Office Admin unmount issue
  useEffect(() => {
    console.log('[ListingsLocationReport] Mounted/rendered', {
      contextId: activeContext?.id,
      token: token ? 'present' : 'missing',
      isRegionalAdmin,
    });
    return () => console.log('[ListingsLocationReport] Unmounting', { contextId: activeContext?.id });
  }, [activeContext?.id, token, isRegionalAdmin]);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  }), [token, activeContext?.id]);

  // Derive stable context flags to prevent unnecessary effect re-runs
  const isRegionalContext = useMemo(() => !activeContext || activeContext.id === '' || activeContext.id === 'regional_admin', [activeContext?.id]);
  const scopedMarketCenterId = useMemo(() => activeContext?.marketCenterId ?? null, [activeContext?.marketCenterId]);

  const [filters, setFilters] = useState<Filters>({
    list_date_from: getFirstOfMonth(),
    list_date_to: getToday(),
    listing_status: [],
    province: [],
    suburb: '',
    market_center_ids: [],
    agent_query: '',
    property_type: [],
    sale_or_rent: [],
    mandate_type: [],
  });

  const [options, setOptions] = useState<FilterOptions>({
    provinces: [], suburbs: [], listing_statuses: [], property_types: [],
    sale_or_rent_options: [], mandate_types: [], agents: [], market_centers: [],
  });

  const [data, setData] = useState<ListingsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('list_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Track if we've already auto-scoped market centre to prevent repeated updates
  const hasAutoScopedRef = useRef(false);
  // Track if we've completed initial setup (scoping done)
  const [hasInitialized, setHasInitialized] = useState(false);

  const suburbSuggestions = useMemo(() => {
    const q = filters.suburb.trim().toLowerCase();
    if (!q) return options.suburbs.slice(0, 300);
    return options.suburbs.filter((s) => s.toLowerCase().includes(q)).slice(0, 300);
  }, [options.suburbs, filters.suburb]);

  const agentSuggestions = useMemo(() => {
    const q = filters.agent_query.trim().toLowerCase();
    if (!q) return options.agents.slice(0, 300);
    return options.agents.filter((a) => a.toLowerCase().includes(q)).slice(0, 300);
  }, [options.agents, filters.agent_query]);

  // Load filter options
  useEffect(() => {
    if (!token) return;
    console.log('[Filter Effect] Starting load', { contextId: activeContext?.id, isRegionalContext });
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const resp = await fetch('/api/reports/listings-location/filter-options', {
          headers: authHeaders,
        });
        if (!resp.ok) throw new Error(`Filter options failed (${resp.status})`);
        const opts = (await resp.json()) as FilterOptions;
        if (cancelled) return;
        const normalizeValues = (values: string[]) => {
          const cleaned = values.map((v) => v.trim()).filter(Boolean);
          return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        };

        console.log('[Filter Effect] Loaded options, setting state');
        setOptions({
          ...opts,
          provinces: normalizeValues(opts.provinces),
          suburbs: normalizeValues(opts.suburbs),
          listing_statuses: normalizeValues(opts.listing_statuses),
          property_types: normalizeValues(opts.property_types),
          sale_or_rent_options: normalizeValues(opts.sale_or_rent_options),
          mandate_types: normalizeValues(opts.mandate_types),
          agents: normalizeValues(opts.agents),
        });
        // Only auto-scope market centre once on first load
        if (!hasAutoScopedRef.current && !isRegionalContext && scopedMarketCenterId) {
          console.log('[Filter Effect] Auto-scoping market centre', { scopedMarketCenterId });
          hasAutoScopedRef.current = true;
          setFilters((f) => {
            console.log('[Filter Effect] Setting filters with market centre', { mcId: scopedMarketCenterId });
            return ({ ...f, market_center_ids: [scopedMarketCenterId] });
          });
        }
        // Mark initialization complete after filters are set
        setHasInitialized(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load filters');
        setHasInitialized(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token, authHeaders, isRegionalContext, scopedMarketCenterId]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!token) return;
    console.log('[Fetch Report] Starting', { contextId: activeContext?.id, marketCenterIds: filters.market_center_ids });
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        list_date_from: filters.list_date_from,
        list_date_to: filters.list_date_to,
        listing_status: filters.listing_status.join(','),
        province: filters.province.join(','),
        suburb: filters.suburb,
        agent_query: filters.agent_query,
        property_type: filters.property_type.join(','),
        sale_or_rent: filters.sale_or_rent.join(','),
        mandate_type: filters.mandate_type.join(','),
      });
      if (filters.market_center_ids.length > 0) params.set('market_center_ids', filters.market_center_ids.join(','));
      const resp = await fetch(`/api/reports/listings-location?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!resp.ok) throw new Error(`Report failed (${resp.status})`);
      console.log('[Fetch Report] Got data', { status: resp.status });
      setData((await resp.json()) as ListingsData);
    } catch (err) {
      console.error('[Fetch Report] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, authHeaders]);

  useEffect(() => { 
    if (!hasInitialized) {
      console.log('[Fetch Effect] Skipping fetch - not initialized yet');
      return;
    }
    console.log('[Fetch Effect] Running fetchReport');
    void fetchReport(); 
  }, [fetchReport, hasInitialized]);

  // Sorting
  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const l = a[sortKey] ?? '', r = b[sortKey] ?? '';
      const cmp = typeof l === 'string' ? l.localeCompare(String(r)) : Number(l) - Number(r);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function onSort(key: SortKey): void {
    if (key === sortKey) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (k !== sortKey) return <span className="ml-0.5 opacity-30">↕</span>;
    return <span className="ml-0.5" style={{ color: 'var(--brand)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function Th({ label, k, right }: { label: string; k: SortKey; right?: boolean }) {
    return (
      <th
        className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${right ? 'text-right' : 'text-left'}`}
        style={{ color: 'var(--text-muted)' }}
        onClick={() => onSort(k)}
      >
        {label}<SortIcon k={k} />
      </th>
    );
  }

  function PlainTh({ label, right }: { label: string; right?: boolean }) {
    return (
      <th
        className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${right ? 'text-right' : 'text-left'}`}
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </th>
    );
  }

  const emptyStateHint = useMemo(() => {
    const hints: string[] = [];

    if (filters.market_center_ids.length > 0) {
      hints.push('A market centre filter is active.');
    }
    if (filters.listing_status.length > 0) {
      hints.push(`Status is filtered to ${filters.listing_status.join(', ')}.`);
    }
    if (filters.sale_or_rent.length > 0) {
      hints.push(`Sale type is filtered to ${filters.sale_or_rent.join(', ')}.`);
    }
    if (filters.agent_query.trim()) {
      hints.push('An agent search filter is active.');
    }
    if (filters.suburb.trim()) {
      hints.push('A suburb filter is active.');
    }

    return hints.join(' ');
  }, [
    filters.market_center_ids,
    filters.listing_status,
    filters.sale_or_rent,
    filters.agent_query,
    filters.suburb,
  ]);

  const scopedMarketCenterLabel = useMemo(() => {
    const selectedName = options.market_centers.find((mc) => mc.id === filters.market_center_ids[0])?.name;
    if (selectedName) return selectedName;
    const contextName = String(activeContext?.marketCenter ?? '').trim();
    if (contextName) return contextName;
    return 'Scoped by your role';
  }, [options.market_centers, filters.market_center_ids, activeContext?.marketCenter]);

  return (
    <div className="space-y-4">
      {/* ── Header + KPI cards ── */}
      <ReportHeader
        title="Listings Location Report"
        subtitle="Location and listing quality view with pricing and status context."
        actions={
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <ReportKpiCard label="Total Listings" icon={<ReportIcon kind="home" className="h-3.5 w-3.5" />} value={data?.totals.total ?? 0} />
            <ReportKpiCard label="Active Listings" icon={<ReportIcon kind="check-circle" className="h-3.5 w-3.5" />} value={data?.totals.active ?? 0} />
            <ReportKpiCard label="Avg Price" icon={<ReportIcon kind="chart" className="h-3.5 w-3.5" />} value={formatMoneyKpi(data?.totals.avg_price ?? 0)} />
          </div>
        }
      />

      {/* ── Filter bar ── */}
      <FilterPanel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>List Date From</label>
            <input type="date" value={filters.list_date_from}
              onChange={(e) => setFilters((f) => ({ ...f, list_date_from: e.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }} />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>List Date To</label>
            <input type="date" value={filters.list_date_to}
              onChange={(e) => setFilters((f) => ({ ...f, list_date_to: e.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }} />
          </div>

          <div>
            <MultiSelectFilter
              label="Status"
              selected={filters.listing_status}
              onChange={(next) => setFilters((f) => ({ ...f, listing_status: next }))}
              options={options.listing_statuses.map((s) => ({ value: s, label: s }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Sale Type"
              selected={filters.sale_or_rent}
              onChange={(next) => setFilters((f) => ({ ...f, sale_or_rent: next }))}
              options={options.sale_or_rent_options.map((s) => ({ value: s, label: s }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Listing Type"
              selected={filters.property_type}
              onChange={(next) => setFilters((f) => ({ ...f, property_type: next }))}
              options={options.property_types.map((t) => ({ value: t, label: t }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Mandate Type"
              selected={filters.mandate_type}
              onChange={(next) => setFilters((f) => ({ ...f, mandate_type: next }))}
              options={options.mandate_types.map((m) => ({ value: m, label: m }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Province"
              selected={filters.province}
              onChange={(next) => setFilters((f) => ({ ...f, province: next }))}
              options={options.provinces.map((p) => ({ value: p, label: p }))}
              allLabel="All"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Suburb</label>
            <input type="text" value={filters.suburb} list="llr-suburb-list" placeholder="All"
              onChange={(e) => setFilters((f) => ({ ...f, suburb: e.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }} />
            <datalist id="llr-suburb-list">
              {suburbSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Listing Agent</label>
            <input type="text" value={filters.agent_query} list="llr-agent-list" placeholder="All"
              onChange={(e) => setFilters((f) => ({ ...f, agent_query: e.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }} />
            <datalist id="llr-agent-list">
              {agentSuggestions.map((a) => <option key={a} value={a} />)}
            </datalist>
          </div>

          <div>
            {isRegionalAdmin ? (
              <MultiSelectFilter
                label="Market Centre"
                selected={filters.market_center_ids}
                onChange={(next) => setFilters((f) => ({ ...f, market_center_ids: next }))}
                options={options.market_centers.map((mc) => ({ value: mc.id, label: mc.name }))}
                allLabel="All"
              />
            ) : (
              <>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Market Centre (scoped)</label>
                <div className="w-full rounded-md border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
                  {scopedMarketCenterLabel}
                </div>
              </>
            )}
          </div>

        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!data || sortedRows.length === 0}
            onClick={() => exportCsv(sortedRows, filters.list_date_from, filters.list_date_to)}
            className="inline-flex h-[34px] items-center justify-center rounded-md border px-4 text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
          >
            Export CSV
          </button>
        </div>
      </FilterPanel>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Report could not be loaded.</strong> Please refresh or contact support. <span className="font-normal">{error}</span>
        </div>
      )}

      {/* ── Table ── */}
      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--border-soft)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading…' : `${sortedRows.length.toLocaleString()} listing${sortedRows.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b"
                style={{ background: 'var(--surface-strong)', borderColor: 'var(--border-soft)' }}>
                <Th label="KWL #"         k="listing_number" />
                <Th label="List Date"     k="list_date" />
                <Th label="Days"          k="days_on_market" right />
                <Th label="Agent"         k="primary_agent" />
                <Th label="Market Centre" k="market_center_name" />
                <Th label="City"          k="city" />
                <Th label="Suburb"        k="suburb" />
                <Th label="Province"      k="province" />
                <PlainTh label="Address" />
                <Th label="Price"         k="price" right />
                <Th label="Mandate"       k="mandate_type" />
                <Th label="Type"          k="listing_type" />
                <Th label="Status"        k="listing_status_tag" />
                <Th label="Sale/Rent"     k="sale_or_rent" />
                <Th label="Bed"           k="bedrooms" right />
                <Th label="Bath"          k="bathrooms" right />
                <Th label="Garage"        k="garages" right />
                <PlainTh label="Lounge"   right />
                <PlainTh label="Dining"   right />
                <PlainTh label="Pool"     right />
                <PlainTh label="Reduced" />
                <PlainTh label="P24 Ref" />
                <PlainTh label="PP Ref" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={23} className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Loading report...
                  </td>
                </tr>
              )}
              {!isLoading && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={23} className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No results found for the selected filters.{emptyStateHint ? ` ${emptyStateHint}` : ''}
                  </td>
                </tr>
              )}
              {!isLoading && sortedRows.map((row, idx) => (
                <tr
                  key={row.listing_number + idx}
                  className="border-b transition-colors hover:bg-slate-50"
                  style={{ borderColor: 'var(--border-soft)' }}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                    {row.listing_number}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(row.list_date)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {row.days_on_market}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {getDisplayAgent(row) || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {row.market_center_name || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.city || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.suburb || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.province || <Dash />}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}
                    title={row.full_address}>
                    {row.full_address || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums"
                    style={{ color: 'var(--text-primary)' }}>
                    {formatMoney(row.price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.mandate_type || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.listing_type || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <StatusChip value={(row.listing_status_tag || row.status_name || 'Unknown')} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.sale_or_rent || <Dash />}
                  </td>
                  <Num v={row.bedrooms} />
                  <Num v={row.bathrooms} />
                  <Num v={row.garages} />
                  <Num v={row.lounges} />
                  <Num v={row.dining_rooms} />
                  <Num v={row.pools} />
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(row.reduced_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.p24_ref || <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {row.private_property_ref || <Dash />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
