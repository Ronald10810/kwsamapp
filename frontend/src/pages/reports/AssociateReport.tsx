import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FilterPanel, MultiSelectFilter, ReportActionButton, ReportHeader, ReportIcon, ReportKpiCard, ReportPagination, ReportState, SortableHeaderButton, StatusChip } from './ReportUi';

type AssociateReportRow = {
  market_center_name: string;
  mc_source_id: string;
  team_name: string;
  team_source_id: string;
  associate_name: string;
  source_associate_id: string;
  status_name: string;
  kw_start_date: string | null;
  end_date: string | null;
  anniversary_date: string | null;
  birthday: string | null;
  birthday_source: 'id_number' | 'unknown';
  mobile_number: string | null;
  associate_email: string | null;
  roles: string;
};

type AssociateReportResponse = {
  rows: AssociateReportRow[];
  totals: {
    total_associates: number;
    active_associates: number;
    birthdays_found: number;
  };
};

type AssociateReportFilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  statuses: string[];
  roles: string[];
};

type Filters = {
  market_center_ids: string[];
  team_ids: string[];
  statuses: string[];
  roles: string[];
  associate_query: string;
  birthday_months: string[];
};

type SortKey =
  | 'market_center_name'
  | 'team_name'
  | 'associate_name'
  | 'status_name'
  | 'kw_start_date'
  | 'end_date'
  | 'anniversary_date'
  | 'birthday'
  | 'mobile_number'
  | 'associate_email'
  | 'roles';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const raw = value.split('T')[0];
  const parts = raw.split('-');
  if (parts.length !== 3) return raw;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function getMonthFromIsoDate(value: string | null): string {
  if (!value) return '';
  const raw = value.split('T')[0];
  const parts = raw.split('-');
  if (parts.length !== 3) return '';
  return parts[1];
}

function monthName(month: string): string {
  const num = Number(month);
  if (!Number.isFinite(num) || num < 1 || num > 12) return '';
  return new Date(Date.UTC(2024, num - 1, 1)).toLocaleString('en-ZA', { month: 'long' });
}

function isActiveStatusValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'active' || normalized === '1';
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

export default function AssociateReport() {
  const { token, activeContext, isRegionalAdmin } = useAuth();
  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  }), [token, activeContext?.id]);

  const [filters, setFilters] = useState<Filters>({
    market_center_ids: [],
    team_ids: [],
    statuses: ['Active'],
    roles: [],
    associate_query: '',
    birthday_months: [],
  });
  const [options, setOptions] = useState<AssociateReportFilterOptions>({
    market_centers: [],
    teams: [],
    statuses: [],
    roles: [],
  });
  const [data, setData] = useState<AssociateReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('associate_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadOptions(): Promise<void> {
      try {
        const response = await fetch('/api/reports/associate/filter-options', {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error(`Failed to load associate report filter options (${response.status})`);
        }

        const nextOptions = (await response.json()) as AssociateReportFilterOptions;
        if (cancelled) return;

        setOptions(nextOptions);

        const activeStatusOption =
          nextOptions.statuses.find((status) => status.trim().toLowerCase() === 'active') ??
          nextOptions.statuses.find((status) => status.trim() === '1') ??
          'Active';

        setFilters((prev) => ({
          ...prev,
          statuses: prev.statuses.length > 0 ? prev.statuses : [activeStatusOption],
        }));

        const scopedMarketCenterId = !isRegionalAdmin
          ? resolveScopedMarketCenterId(nextOptions.market_centers, activeContext?.marketCenterId, activeContext?.marketCenter)
          : '';

        if (scopedMarketCenterId) {
          setFilters((prev) => ({
            ...prev,
            market_center_ids: [scopedMarketCenterId],
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
  }, [token, isRegionalAdmin, activeContext, authHeaders]);

  const fetchReport = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.market_center_ids.length > 0) params.set('market_center_ids', filters.market_center_ids.join(','));
      if (filters.team_ids.length > 0) params.set('team_ids', filters.team_ids.join(','));
      if (filters.statuses.length > 0) params.set('statuses', filters.statuses.join(','));
      if (filters.roles.length > 0) params.set('roles', filters.roles.join(','));
      if (filters.associate_query.trim()) params.set('associate_query', filters.associate_query.trim());

      const response = await fetch(`/api/reports/associate?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Associate report (${response.status})`);
      }

      const reportData = (await response.json()) as AssociateReportResponse;
      setData(reportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Associate report';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters.market_center_ids, filters.team_ids, filters.statuses, filters.roles, filters.associate_query, authHeaders]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (filters.birthday_months.length === 0) return data.rows;

    return data.rows.filter((row) => filters.birthday_months.includes(getMonthFromIsoDate(row.birthday)));
  }, [data, filters.birthday_months]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => {
      const leftValue = left[sortKey] ?? '';
      const rightValue = right[sortKey] ?? '';
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRows, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filters.market_center_ids, filters.team_ids, filters.statuses, filters.roles, filters.associate_query, filters.birthday_months]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const filteredTotals = useMemo(() => {
    const totalAssociates = filteredRows.length;
    const activeAssociates = filteredRows.filter((row) => {
      const normalized = row.status_name.trim().toLowerCase();
      return normalized === 'active' || normalized === '1';
    }).length;
    const birthdaysFound = filteredRows.filter((row) => row.birthday !== null).length;

    return {
      total_associates: totalAssociates,
      active_associates: activeAssociates,
      birthdays_found: birthdaysFound,
    };
  }, [filteredRows]);

  const teamsForCurrentMarketCenter = useMemo(() => {
    if (filters.market_center_ids.length === 0) return options.teams;
    return options.teams.filter((team) => filters.market_center_ids.includes(team.market_center_id));
  }, [options.teams, filters.market_center_ids]);

  const hideEndDateColumn = useMemo(() => {
    if (filters.statuses.length !== 1) return false;
    return isActiveStatusValue(filters.statuses[0]);
  }, [filters.statuses]);

  useEffect(() => {
    if (hideEndDateColumn && sortKey === 'end_date') {
      setSortKey('kw_start_date');
      setSortDirection('asc');
    }
  }, [hideEndDateColumn, sortKey]);

  function onSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection('asc');
  }

  function exportCsv(): void {
    if (sortedRows.length === 0) return;

    const headers = [
      'Market Centre',
      'Team',
      'Associate',
      'Status',
      'KW Start Date',
      'Anniversary Date',
      'Birthday',
      'Mobile Number',
      'Associate Email',
      'Roles',
    ];

    if (!hideEndDateColumn) {
      headers.splice(5, 0, 'End Date');
    }

    const csvRows = sortedRows.map((row) => {
      const values = [
        row.market_center_name,
        row.team_name,
        row.associate_name,
        row.status_name,
        row.kw_start_date ?? '',
        row.anniversary_date ?? '',
        row.birthday ?? '',
        row.mobile_number ?? '',
        row.associate_email ?? '',
        row.roles,
      ];

      if (!hideEndDateColumn) {
        values.splice(5, 0, row.end_date ?? '');
      }

      return values;
    });

    const csvContent = [headers, ...csvRows]
      .map((row) => row.map((value) => `"${String(value).split('"').join('""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'associate-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Associate Report"
        subtitle="Associate status, role and key dates across Market Centres and Teams."
        actions={
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <ReportKpiCard
              label="Associates"
              icon={<ReportIcon kind="users" className="h-3.5 w-3.5" />}
              value={filteredTotals.total_associates}
            />
            <ReportKpiCard
              label="Active"
              icon={<ReportIcon kind="check-circle" className="h-3.5 w-3.5" />}
              value={filteredTotals.active_associates}
            />
            <ReportKpiCard
              label="Birthdays Found"
              icon={<ReportIcon kind="calendar" className="h-3.5 w-3.5" />}
              value={filteredTotals.birthdays_found}
            />
          </div>
        }
      />

      <FilterPanel>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div>
            {isRegionalAdmin ? (
              <MultiSelectFilter
                label="Market Centre"
                selected={filters.market_center_ids}
                onChange={(next) => setFilters((prev) => ({ ...prev, market_center_ids: next, team_ids: [] }))}
                options={options.market_centers.map((marketCenter) => ({ value: marketCenter.id, label: marketCenter.name }))}
                allLabel="All"
              />
            ) : (
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Market Centre (scoped)
              </label>
            )}
            {!isRegionalAdmin ? (
              <div className="w-full rounded-md border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
                {options.market_centers.find((mc) => mc.id === filters.market_center_ids[0])?.name ?? 'Scoped by your role'}
              </div>
            ) : null}
          </div>

          <div>
            <MultiSelectFilter
              label="Team"
              selected={filters.team_ids}
              onChange={(next) => setFilters((prev) => ({ ...prev, team_ids: next }))}
              options={teamsForCurrentMarketCenter.map((team) => ({ value: team.id, label: team.name }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Status"
              selected={filters.statuses}
              onChange={(next) => setFilters((prev) => ({ ...prev, statuses: next }))}
              options={options.statuses.map((status) => ({ value: status, label: status }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Role"
              selected={filters.roles}
              onChange={(next) => setFilters((prev) => ({ ...prev, roles: next }))}
              options={options.roles.map((role) => ({ value: role, label: role }))}
              allLabel="All"
            />
          </div>

          <div>
            <MultiSelectFilter
              label="Birthday Month"
              selected={filters.birthday_months}
              onChange={(next) => setFilters((prev) => ({ ...prev, birthday_months: next }))}
              options={Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((month) => ({ value: month, label: monthName(month) }))}
              allLabel="All"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Associate Search</label>
            <input
              type="text"
              value={filters.associate_query}
              onChange={(event) => setFilters((prev) => ({ ...prev, associate_query: event.target.value }))}
              placeholder="Name, source ID, or ID number"
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <ReportActionButton label="Export CSV" onClick={exportCsv} disabled={sortedRows.length === 0} />
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
        ) : sortedRows.length === 0 ? (
          <ReportState type="empty" message="No results found for the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${hideEndDateColumn ? 'min-w-[1220px]' : 'min-w-[1320px]'}`}>
              <thead>
                <tr className="sticky top-0 z-10 border-b text-left" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Market Centre" active={sortKey === 'market_center_name'} direction={sortDirection} onClick={() => onSort('market_center_name')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Team" active={sortKey === 'team_name'} direction={sortDirection} onClick={() => onSort('team_name')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Associate" active={sortKey === 'associate_name'} direction={sortDirection} onClick={() => onSort('associate_name')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Status" active={sortKey === 'status_name'} direction={sortDirection} onClick={() => onSort('status_name')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="KW Start Date" active={sortKey === 'kw_start_date'} direction={sortDirection} onClick={() => onSort('kw_start_date')} /></th>
                  {!hideEndDateColumn ? <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="End Date" active={sortKey === 'end_date'} direction={sortDirection} onClick={() => onSort('end_date')} /></th> : null}
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Anniversary Date" active={sortKey === 'anniversary_date'} direction={sortDirection} onClick={() => onSort('anniversary_date')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Birthday" active={sortKey === 'birthday'} direction={sortDirection} onClick={() => onSort('birthday')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Mobile Number" active={sortKey === 'mobile_number'} direction={sortDirection} onClick={() => onSort('mobile_number')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Associate Email" active={sortKey === 'associate_email'} direction={sortDirection} onClick={() => onSort('associate_email')} /></th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide"><SortableHeaderButton label="Role/s" active={sortKey === 'roles'} direction={sortDirection} onClick={() => onSort('roles')} /></th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr
                    key={`${row.source_associate_id}-${row.mc_source_id}-${row.team_source_id}`}
                    className="border-b hover:bg-slate-50"
                    style={{ borderColor: 'var(--border-soft)' }}
                  >
                    <td className="px-3 py-1.5">{row.market_center_name}</td>
                    <td className="px-3 py-1.5">{row.team_name}</td>
                    <td className="px-3 py-1.5 font-medium">{row.associate_name}</td>
                    <td className="px-3 py-1.5">{row.status_name ? <StatusChip value={row.status_name} /> : '—'}</td>
                    <td className="px-3 py-1.5">{formatDate(row.kw_start_date)}</td>
                    {!hideEndDateColumn ? <td className="px-3 py-1.5">{formatDate(row.end_date)}</td> : null}
                    <td className="px-3 py-1.5">{formatDate(row.anniversary_date)}</td>
                    <td className="px-3 py-1.5">
                      {row.birthday ? (
                        <span className="inline-flex items-center gap-2">
                          <span>{formatDate(row.birthday)}</span>
                          {row.birthday_source === 'id_number' && (
                            <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                              ID
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5">{row.mobile_number ? <a href={`tel:${row.mobile_number}`} className="text-red-700 hover:underline">{row.mobile_number}</a> : '—'}</td>
                    <td className="px-3 py-1.5">{row.associate_email ? <a href={`mailto:${row.associate_email}`} className="text-red-700 hover:underline">{row.associate_email}</a> : '—'}</td>
                    <td className="px-3 py-1.5">{row.roles || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && sortedRows.length > 0 ? (
          <ReportPagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={sortedRows.length}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
