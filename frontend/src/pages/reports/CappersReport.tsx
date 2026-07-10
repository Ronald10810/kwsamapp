import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FilterPanel, ReportHeader, ReportIcon, ReportKpiCard, ReportState, StatusChip } from './ReportUi';

type ReportView = 'associate' | 'team';
type CapStatus = '' | 'capped' | 'not_capped';

type CappersTeamContribution = {
  associate_name: string;
  source_associate_id: string;
  company_dollar: number;
};

type CappersRow = {
  view: ReportView;
  entity_name: string;
  source_entity_id: string;
  market_center_name: string;
  mc_source_id: string;
  team_name: string;
  cap_date: string | null;
  cap_amount: number;
  cap_achieved: number;
  cap_remaining: number;
  cap_percent_remaining: number;
  months_to_cap_date: number | null;
  manual_cap: boolean;
  team_contributions?: CappersTeamContribution[];
};

type CappersData = {
  view: ReportView;
  rows: CappersRow[];
  totals: {
    entities: number;
    capped_entities: number;
    cap_amount: number;
    cap_achieved: number;
    cap_remaining: number;
  };
};

type FilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  associates: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
};

type Filters = {
  view: ReportView;
  market_center_ids: string[];
  market_center_search: string;
  associate_query: string;
  team_query: string;
  cap_status: CapStatus;
};

type SortKey = 'entity_name' | 'market_center_name' | 'cap_amount' | 'cap_achieved' | 'cap_remaining' | 'cap_percent_remaining' | 'months_to_cap_date';

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return 'R 0.00';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return value;
}

function formatMonths(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return String(value);
}

function resolveScopedMarketCenterId(
  options: Array<{ id: string; name: string }>,
  rawId: string | null | undefined,
  rawName: string | null | undefined,
): string {
  const normalizedId = String(rawId ?? '').trim();
  const normalizedName = String(rawName ?? '').trim().toLowerCase();

  if (!normalizedId && !normalizedName) return '';

  const idMatch = normalizedId
    ? options.find((option) => option.id === normalizedId)
    : undefined;
  if (idMatch) return idMatch.id;

  const nameMatch = normalizedName
    ? options.find((option) => option.name.trim().toLowerCase() === normalizedName)
    : undefined;
  if (nameMatch) return nameMatch.id;

  return /^\d+$/.test(normalizedId) ? '' : normalizedId;
}

export default function CappersReport() {
  const { token, activeContext, isRegionalAdmin } = useAuth();
  const normalizedContextRole = (activeContext?.role ?? '').trim().toLowerCase();
  const normalizedContextId = (activeContext?.id ?? '').trim().toLowerCase();
  const isRegionalContext = isRegionalAdmin || normalizedContextId === 'regional_admin' || normalizedContextRole.includes('regional');
  const isAgentOnlyContext = normalizedContextId === 'agent' || normalizedContextRole === 'agent';
  const isTeamAgentContext = normalizedContextRole === 'team agent'
    || normalizedContextId === 'team_agent'
    || normalizedContextId.startsWith('team_agent_');
  const isTeamManagerContext = normalizedContextRole === 'team admin'
    || normalizedContextRole === 'lead agent'
    || normalizedContextRole === 'tl'
    || normalizedContextId === 'team_admin'
    || normalizedContextId.startsWith('team_admin_')
    || normalizedContextId === 'lead_agent'
    || normalizedContextId.startsWith('lead_agent_');
  const isTeamContext = isTeamAgentContext || isTeamManagerContext || normalizedContextRole.includes('team');
  const isRoleScopedContext = isAgentOnlyContext || isTeamContext;
  const isMarketCenterContext = !isRegionalContext && !isRoleScopedContext;
  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  }), [token, activeContext?.id]);

  const [filters, setFilters] = useState<Filters>({
    view: 'associate',
    market_center_ids: [],
    market_center_search: '',
    associate_query: '',
    team_query: '',
    cap_status: '',
  });
  const [options, setOptions] = useState<FilterOptions>({ market_centers: [], associates: [], teams: [] });
  const [data, setData] = useState<CappersData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('cap_remaining');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const showTeamColumn = filters.view === 'team';
  const [expandedTeamIds, setExpandedTeamIds] = useState<string[]>([]);
  const visibleColumnCount = showTeamColumn ? 10 : 9;

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadOptions(): Promise<void> {
      try {
        const response = await fetch('/api/reports/cappers/filter-options', {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error(`Failed to load cappers filter options (${response.status})`);
        }

        const nextOptions = (await response.json()) as FilterOptions;
        if (cancelled) return;

        setOptions(nextOptions);

        const scopedMarketCenterId = isMarketCenterContext
          ? resolveScopedMarketCenterId(nextOptions.market_centers, activeContext?.marketCenterId, activeContext?.marketCenter)
          : '';
        const roleDefaults: Partial<Filters> = isTeamManagerContext
          ? { view: 'team' }
          : {};

        if (scopedMarketCenterId) {
          const matchingMc = nextOptions.market_centers.find((mc) => mc.id === scopedMarketCenterId);
          setFilters((prev) => ({
            ...prev,
            market_center_ids: [scopedMarketCenterId],
            market_center_search: matchingMc?.name ?? scopedMarketCenterId,
            ...roleDefaults,
          }));
        } else if (Object.keys(roleDefaults).length > 0) {
          setFilters((prev) => ({
            ...prev,
            market_center_ids: isRoleScopedContext ? [] : prev.market_center_ids,
            market_center_search: isRoleScopedContext ? '' : prev.market_center_search,
            ...roleDefaults,
          }));
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load filter options';
        setError(message);
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [token, activeContext, isRegionalAdmin, isTeamManagerContext, isRoleScopedContext, isMarketCenterContext, authHeaders]);

  const fetchReport = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        view: filters.view,
        cap_status: filters.cap_status,
      });

      if (filters.market_center_ids.length > 0) {
        params.set('market_center_ids', filters.market_center_ids.join(','));
      }
      if (filters.associate_query) {
        params.set('associate_query', filters.associate_query);
      }
      if (filters.team_query) {
        params.set('team_query', filters.team_query);
      }

      const response = await fetch(`/api/reports/cappers?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Cappers report (${response.status})`);
      }

      const reportData = (await response.json()) as CappersData;
      setData(reportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Cappers report';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, authHeaders]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    setExpandedTeamIds([]);
  }, [data, filters.view]);

  const sortedRows = useMemo(() => {
    if (!data) return [];

    return [...data.rows].sort((a, b) => {
      const left = a[sortKey] ?? 0;
      const right = b[sortKey] ?? 0;
      const comparable = typeof left === 'string'
        ? left.localeCompare(String(right))
        : Number(left) - Number(right);
      return sortDirection === 'asc' ? comparable : -comparable;
    });
  }, [data, sortKey, sortDirection]);

  const activeSearchPlaceholder = filters.view === 'associate' ? 'Search associate...' : 'Search team...';
  const activeSearchValue = filters.view === 'associate' ? filters.associate_query : filters.team_query;

  const emptyStateHint = useMemo(() => {
    const hints: string[] = [];
    if (filters.cap_status === 'capped') {
      hints.push('Only capped entities are included.');
    } else if (filters.cap_status === 'not_capped') {
      hints.push('Only not-capped entities are included.');
    }

    if (filters.view === 'associate' && filters.associate_query.trim()) {
      hints.push('Clear the associate search to broaden results.');
    }
    if (filters.view === 'team' && filters.team_query.trim()) {
      hints.push('Clear the team search to broaden results.');
    }

    if (isRegionalContext && filters.market_center_ids.length > 0) {
      hints.push('A market centre filter is active.');
    }

    if (isRoleScopedContext) {
      hints.push('Your role scope may limit visible entities.');
    }

    return hints.join(' ');
  }, [
    filters.cap_status,
    filters.view,
    filters.associate_query,
    filters.team_query,
    filters.market_center_ids,
    isRegionalContext,
    isRoleScopedContext,
  ]);

  function onSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === 'cap_remaining' ? 'asc' : 'desc');
  }

  function handleMarketCenterSearch(value: string): void {
    const selected = options.market_centers.find((mc) => mc.name.toLowerCase() === value.trim().toLowerCase());
    setFilters((prev) => ({
      ...prev,
      market_center_search: value,
      market_center_ids: selected ? [selected.id] : [],
    }));
  }

  function exportCsv(): void {
    if (!data || sortedRows.length === 0) return;

    const headers = [
      filters.view === 'associate' ? 'Associate' : 'Team',
      'Market Centre',
      ...(showTeamColumn ? ['Team'] : []),
      'Cap Date',
      'Cap Amount',
      'Cap Achieved',
      'Cap Remaining',
      'Cap % Remaining',
      'Months To Cap Date',
      'Manual Cap',
    ];

    const csvRows = sortedRows.map((row) => [
      row.entity_name,
      row.market_center_name,
      ...(showTeamColumn ? [row.team_name] : []),
      row.cap_date ?? '',
      String(row.cap_amount),
      String(row.cap_achieved),
      String(row.cap_remaining),
      String(row.cap_percent_remaining),
      row.months_to_cap_date === null ? '' : String(row.months_to_cap_date),
      row.manual_cap ? 'True' : 'False',
    ]);

    const csvContent = [headers, ...csvRows]
      .map((row) => row.map((value) => `"${String(value).split('"').join('""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cappers-${filters.view}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleTeamExpansion(teamId: string): void {
    setExpandedTeamIds((prev) => (
      prev.includes(teamId)
        ? prev.filter((currentId) => currentId !== teamId)
        : [...prev, teamId]
    ));
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Cappers Report"
        subtitle="Associate and Team cap progress using current transaction calculation logic."
        context={filters.view === 'associate' ? 'Default scope: Active associates only' : 'Default scope: Active teams only'}
        actions={
          <div className="space-y-3">
            <div className="inline-flex rounded-md border p-1" style={{ borderColor: 'var(--border-soft)' }}>
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, view: 'associate' }))}
                className="rounded px-3 py-1.5 text-xs font-semibold"
                style={filters.view === 'associate'
                  ? { background: 'var(--brand)', color: '#fff' }
                  : { color: 'var(--text-muted)' }}
              >
                Associate Cap Remaining
              </button>
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, view: 'team' }))}
                className="rounded px-3 py-1.5 text-xs font-semibold"
                style={filters.view === 'team'
                  ? { background: 'var(--brand)', color: '#fff' }
                  : { color: 'var(--text-muted)' }}
              >
                Team Cap Remaining
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              <ReportKpiCard label="Rows" icon={<ReportIcon kind="users" className="h-3.5 w-3.5" />} value={data?.totals.entities ?? 0} />
              <ReportKpiCard label="Capped" icon={<ReportIcon kind="check-circle" className="h-3.5 w-3.5" />} value={data?.totals.capped_entities ?? 0} />
              <ReportKpiCard label="Cap Amount" icon={<ReportIcon kind="gauge" className="h-3.5 w-3.5" />} value={formatMoney(data?.totals.cap_amount ?? 0)} />
              <ReportKpiCard label="Cap Achieved" icon={<ReportIcon kind="trending-up" className="h-3.5 w-3.5" />} value={formatMoney(data?.totals.cap_achieved ?? 0)} />
              <ReportKpiCard label="Cap Remaining" icon={<ReportIcon kind="target" className="h-3.5 w-3.5" />} value={formatMoney(data?.totals.cap_remaining ?? 0)} />
            </div>
          </div>
        }
      />

      <FilterPanel>
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--surface-strong)', color: 'var(--text-muted)' }}>
          Active-only scope is applied by default.
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          {!isRoleScopedContext ? <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Market Centre (search)
            </label>
            <input
              list="cappers-market-centres"
              value={filters.market_center_search}
              disabled={!isRegionalContext}
              onChange={(event) => handleMarketCenterSearch(event.target.value)}
              placeholder={isRegionalContext ? 'Type market centre...' : 'Scoped by your role'}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-80"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
            <datalist id="cappers-market-centres">
              {options.market_centers.map((mc) => (
                <option key={mc.id} value={mc.name} />
              ))}
            </datalist>
          </div> : null}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {filters.view === 'associate' ? 'Associate (search)' : 'Team (search)'}
            </label>
            <input
              type="text"
              value={activeSearchValue}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((prev) => prev.view === 'associate'
                  ? { ...prev, associate_query: value }
                  : { ...prev, team_query: value });
              }}
              placeholder={activeSearchPlaceholder}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Cap Status
            </label>
            <select
              value={filters.cap_status}
              onChange={(event) => setFilters((prev) => ({ ...prev, cap_status: event.target.value as CapStatus }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              <option value="">All</option>
              <option value="capped">Capped</option>
              <option value="not_capped">Not Capped</option>
            </select>
          </div>

          <div className="xl:col-span-2 flex items-end justify-end">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data || data.rows.length === 0}
              className="inline-flex h-[34px] items-center rounded-md border px-3 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
            >
              Export CSV
            </button>
          </div>
        </div>
      </FilterPanel>

      <section className="surface-card overflow-hidden">
        {error && (
          <div className="border-b px-4 py-3 text-sm text-red-700" style={{ borderColor: 'var(--border-soft)', background: '#fef2f2' }}>
            <strong>Report could not be loaded.</strong> Please refresh or contact support. <span className="font-normal">{error}</span>
          </div>
        )}

        {isLoading ? (
          <ReportState type="loading" message="Loading report..." />
        ) : !data || sortedRows.length === 0 ? (
          <ReportState type="empty" message={`No results found for the selected filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${showTeamColumn ? 'min-w-[1120px]' : 'min-w-[980px]'}`}>
              <thead>
                <tr className="border-b text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide">{filters.view === 'associate' ? 'Associate' : 'Team'}</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('market_center_name')}>Market Centre</th>
                  {showTeamColumn && <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide">Team</th>}
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide">Cap Date</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-right text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('cap_amount')}>Cap Amount</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-right text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('cap_achieved')}>Cap Achieved</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-right text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('cap_remaining')}>Cap Remaining</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-right text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('cap_percent_remaining')}>Cap % Remaining</th>
                  <th className="px-3 py-2.5 cursor-pointer select-none text-right text-[11px] font-bold uppercase tracking-wide" onClick={() => onSort('months_to_cap_date')}>Months To Cap Date</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide">Cap Type</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const isExpanded = expandedTeamIds.includes(row.source_entity_id);
                  const totalContribution = (row.team_contributions ?? []).reduce((sum, item) => sum + item.company_dollar, 0);

                  return (
                    <Fragment key={`${row.source_entity_id}-${row.mc_source_id}`}>
                      <tr className="border-b hover:bg-slate-50" style={{ borderColor: 'var(--border-soft)' }}>
                        <td className="px-3 py-2 font-medium">
                          {showTeamColumn ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleTeamExpansion(row.source_entity_id)}
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? `Hide ${row.entity_name} contributions` : `Show ${row.entity_name} contributions`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-sm font-bold transition-colors"
                                style={{
                                  borderColor: 'var(--border-soft)',
                                  background: isExpanded ? 'var(--brand)' : 'var(--surface-strong)',
                                  color: isExpanded ? '#fff' : 'var(--brand)',
                                }}
                              >
                                {isExpanded ? '−' : '+'}
                              </button>
                              <span>{row.entity_name}</span>
                            </div>
                          ) : row.entity_name}
                        </td>
                        <td className="px-3 py-2">{row.market_center_name}</td>
                        {showTeamColumn && <td className="px-3 py-2">{row.team_name}</td>}
                        <td className="px-3 py-2 tabular-nums">{formatDate(row.cap_date)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.cap_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.cap_achieved)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700">{formatMoney(row.cap_remaining)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div className="space-y-1">
                            <div>{formatPercent(row.cap_percent_remaining)}</div>
                            <div className="h-1.5 w-28 rounded-full bg-slate-200 ml-auto">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(0, Math.min(100, row.cap_percent_remaining))}%`,
                                  background: row.cap_percent_remaining <= 15 ? '#ef4444' : row.cap_percent_remaining <= 40 ? '#f59e0b' : '#10b981',
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMonths(row.months_to_cap_date)}</td>
                        <td className="px-3 py-2">{row.manual_cap ? <StatusChip value="Manual Cap" /> : <StatusChip value="System Cap" />}</td>
                      </tr>
                      {showTeamColumn && isExpanded && (
                        <tr className="border-b" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)' }}>
                          <td colSpan={visibleColumnCount} className="px-4 py-4">
                            <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-soft)', background: '#fff' }}>
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Team Agent Contributions</h3>
                                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    Registered Company Dollar attributed to team members for this cap cycle.
                                  </p>
                                </div>
                                <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--surface-strong)', color: 'var(--brand)' }}>
                                  Total Company Dollar {formatMoney(totalContribution)}
                                </div>
                              </div>
                              {row.team_contributions && row.team_contributions.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[420px] text-sm">
                                    <thead>
                                      <tr className="border-b text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                                        <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Agent</th>
                                        <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide">Company Dollar</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.team_contributions.map((contribution) => (
                                        <tr key={contribution.source_associate_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-soft)' }}>
                                          <td className="px-3 py-2 font-medium">{contribution.associate_name}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(contribution.company_dollar)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                  No registered Company Dollar contributions were found for this team in the current cap cycle.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
