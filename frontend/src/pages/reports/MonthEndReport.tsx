import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FilterPanel, MultiSelectFilter, ReportHeader, ReportIcon, ReportKpiCard, ReportState } from './ReportUi';

type MCRow = {
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  total_gci: number;
  growth_share: number;
  royalties: number;
  company_dollar: number;
  cos_to_gci_pct: number;
  associate_dollar: number;
  team_dollar: number;
};

type ReportTotals = Omit<MCRow, 'market_center_name' | 'mc_source_id'>;

type ReportData = {
  rows: MCRow[];
  totals: ReportTotals;
  kpi: { contracts: number; units: number; total_gci: number };
  debug?: {
    active_context?: string;
    scope?: string;
    scope_mc_id?: string | null;
    scoped_team_source_id?: string | null;
    requested_team_id?: string;
    effective_team_id?: string;
    resolved_scope_associate_id?: string | number | null;
    requested_associate_id?: string;
    effective_associate_id?: string;
    use_associate_grouping?: boolean;
    returned_rows?: number;
  };
};

type ReportTab = 'market-center-totals' | 'transaction-summary' | 'status-change-date' | 'transaction-date';

type MonthEndExtendedFilterOptions = {
  statuses: string[];
  sale_types: string[];
  market_centers: { id: string; name: string }[];
  teams: { id: string; name: string; market_center_id: string; market_center_name: string }[];
  associates: { id: string; name: string; team_id: string; market_center_id: string; market_center_name: string }[];
  debug?: {
    active_context?: string;
    scope?: string;
    scope_mc_id?: string | null;
    scoped_team_source_id?: string | null;
    resolved_scope_associate_id?: string | number | null;
    market_centers_count?: number;
    teams_count?: number;
    associates_count?: number;
  };
};

type SummaryRow = {
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  sales_price: number;
  mc_sales_volume: number;
  list_price: number;
  contract_gci: number;
  gci: number;
  royalties: number;
  growth_share: number;
  associate_dollar: number;
  company_dollar: number;
  team_dollar: number;
};

type SummaryData = {
  rows: SummaryRow[];
  totals: SummaryRow;
  date_basis: 'status_change' | 'transaction';
};

type DetailRow = {
  market_center_name: string;
  mc_source_id: string;
  associate_name: string;
  source_associate_id: string;
  team_name: string;
  source_team_id: string;
  transaction_number: string;
  transaction_date: string | null;
  list_date: string | null;
  status_change_date: string | null;
  kwl_number: string;
  transaction_type: string;
  sale_type: string;
  transaction_status: string;
  suburb: string;
  city: string;
  buyer: string;
  seller: string;
  list_price: number;
  sales_price: number;
  th_split_pct: number;
  agent_sales_volume: number;
  comm_pct: number;
  contract_gci: number;
  total_gci: number;
  royalties: number;
  growth_share: number;
  associate_dollar: number;
  company_dollar: number;
  team_dollar: number;
  cap_remaining: number;
  listing_office: string;
  bond_originator: string;
  bond_attorney: string;
  bond_attorney_email: string;
  bond_attorney_phone: string;
  transfer_attorney: string;
  transfer_attorney_email: string;
  transfer_attorney_phone: string;
};

type DetailTotals = {
  contracts: number;
  units: number;
  list_price: number;
  sales_price: number;
  agent_sales_volume: number;
  contract_gci: number;
  total_gci: number;
  royalties: number;
  growth_share: number;
  associate_dollar: number;
  company_dollar: number;
  team_dollar: number;
  cap_remaining: number;
};

type DetailData = {
  rows: DetailRow[];
  totals: DetailTotals;
  date_basis: 'status_change' | 'transaction';
};

type FilterOptions = {
  statuses: string[];
  sale_types: string[];
  market_centers: { id: string; name: string }[];
};

type Filters = {
  date_from: string;
  date_to: string;
  transaction_status: string[];
  sale_type: string[];
  market_center_ids: string[];
  team_id: string;
  associate_id: string;
};

type SortKey = keyof Omit<MCRow, 'market_center_name' | 'mc_source_id'>;

const TABLE_COLUMNS: Array<{ key: SortKey; label: string; kind: 'number' | 'currency' | 'percent' }> = [
  { key: 'contracts', label: 'Contracts', kind: 'number' },
  { key: 'units', label: 'Units', kind: 'number' },
  { key: 'total_gci', label: 'Total GCI', kind: 'currency' },
  { key: 'growth_share', label: 'Growth Share', kind: 'currency' },
  { key: 'royalties', label: 'Royalties', kind: 'currency' },
  { key: 'company_dollar', label: 'Company Dollar', kind: 'currency' },
  { key: 'cos_to_gci_pct', label: 'CO$ to GCI %', kind: 'percent' },
  { key: 'associate_dollar', label: 'Associate Dollar', kind: 'currency' },
  { key: 'team_dollar', label: 'Team Dollar', kind: 'currency' },
];

function getFirstOfMonth(): string {
  const now = new Date();
  return formatDateForInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function getToday(): string {
  return formatDateForInput(new Date());
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoneyAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function renderAlignedCurrency(value: number, emphasize = false): JSX.Element {
  return (
    <span className="inline-flex w-full justify-end tabular-nums">
      <span className="mr-1 inline-block w-3 text-left">R</span>
      <span className={emphasize ? 'font-semibold' : ''} style={emphasize ? { color: 'var(--brand)' } : undefined}>
        {formatMoneyAmount(value)}
      </span>
    </span>
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-ZA') : '0';
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}

function renderValue(kind: 'number' | 'currency' | 'percent', value: number): string {
  if (kind === 'currency') return formatMoney(value);
  if (kind === 'percent') return formatPercent(value);
  return formatNumber(value);
}

function normalizedSaleTypeDefault(values: string[]): string {
  const forSale = values.find((value) => value.trim().toLowerCase() === 'for sale');
  return forSale ?? 'For Sale';
}

function normalizedStatusDefault(values: string[], target: string, fallback: string): string {
  return values.find((value) => value.trim().toLowerCase() === target) ?? fallback;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).split('"').join('""')}"`).join(','))
    .join('\n');
}

function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseTeamContextToken(activeContextId: string | null | undefined): string {
  const normalized = (activeContextId ?? '').trim().toLowerCase();
  const match = /^(lead_agent|team_admin|team_agent)(?:_(.+))?$/.exec(normalized);
  return (match?.[2] ?? '').trim();
}

export default function MonthEndReport() {
  const { token, activeContext, isRegionalAdmin } = useAuth();
  const showScopeDebug = import.meta.env.DEV;
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
  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  }), [token, activeContext?.id]);
  const [activeTab, setActiveTab] = useState<ReportTab>('market-center-totals');

  const [filters, setFilters] = useState<Filters>({
    date_from: getFirstOfMonth(),
    date_to: getToday(),
    transaction_status: ['Registered'],
    sale_type: ['For Sale'],
    market_center_ids: [],
    team_id: '',
    associate_id: '',
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    statuses: [],
    sale_types: [],
    market_centers: [],
  });
  const [extendedFilterOptions, setExtendedFilterOptions] = useState<MonthEndExtendedFilterOptions>({
    statuses: [],
    sale_types: [],
    market_centers: [],
    teams: [],
    associates: [],
  });
  const [data, setData] = useState<ReportData | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setMonthEndScopeDebug] = useState<ReportData['debug'] | null>(null);
  const [, setOptionsScopeDebug] = useState<MonthEndExtendedFilterOptions['debug'] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_gci');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const selectedMarketCenterId = filters.market_center_ids[0] ?? '';
  const primaryDimensionLabel = isTeamContext ? 'Team Member' : (isAgentOnlyContext ? 'Agent' : 'Market Centre');
  const totalsTabLabel = isTeamContext ? 'Team Totals' : (isAgentOnlyContext ? 'Agent Totals' : 'Market Centre Totals');
  const detailContractsColSpan = isRoleScopedContext ? 13 : 14;
  const reportSubtitle = isTeamContext
    ? 'Executive summary of Team transaction totals for the selected reporting window.'
    : (isAgentOnlyContext
      ? 'Executive summary of your transaction totals for the selected reporting window.'
      : 'Executive summary of Market Centre transaction totals for the selected reporting window.');
  const registeredStatusDefault = useMemo(() => {
    return extendedFilterOptions.statuses.find((status) => status.trim().toLowerCase() === 'registered')
      ?? filterOptions.statuses.find((status) => status.trim().toLowerCase() === 'registered')
      ?? 'Registered';
  }, [extendedFilterOptions.statuses, filterOptions.statuses]);
  const startStatusDefault = useMemo(() => {
    return normalizedStatusDefault(extendedFilterOptions.statuses, 'start', normalizedStatusDefault(filterOptions.statuses, 'start', 'Start'));
  }, [extendedFilterOptions.statuses, filterOptions.statuses]);
  const saleTypeDefault = useMemo(() => {
    return normalizedSaleTypeDefault(extendedFilterOptions.sale_types.length > 0 ? extendedFilterOptions.sale_types : filterOptions.sale_types);
  }, [extendedFilterOptions.sale_types, filterOptions.sale_types]);

  const scopedTeams = useMemo(() => {
    const source = selectedMarketCenterId
      ? extendedFilterOptions.teams.filter((team) => team.market_center_id === selectedMarketCenterId)
      : extendedFilterOptions.teams;
    return source.sort((a, b) => a.name.localeCompare(b.name));
  }, [extendedFilterOptions.teams, selectedMarketCenterId]);

  const scopedAssociates = useMemo(() => {
    let source = selectedMarketCenterId
      ? extendedFilterOptions.associates.filter((associate) => associate.market_center_id === selectedMarketCenterId)
      : extendedFilterOptions.associates;

    if (filters.team_id) {
      source = source.filter((associate) => associate.team_id === filters.team_id);
    }

    return source.sort((a, b) => a.name.localeCompare(b.name));
  }, [extendedFilterOptions.associates, selectedMarketCenterId, filters.team_id]);

  const emptyStateHint = useMemo(() => {
    const hints: string[] = [];

    if (filters.associate_id) {
      hints.push('An associate filter is selected.');
    }
    if (filters.team_id) {
      hints.push('A team filter is selected.');
    }
    if (filters.market_center_ids.length > 0) {
      hints.push('A market centre filter is active.');
    }
    if (filters.transaction_status.length > 0) {
      hints.push(`Transaction status is filtered to ${filters.transaction_status.join(', ')}.`);
    }
    if (filters.sale_type.length > 0) {
      hints.push(`Sale type is filtered to ${filters.sale_type.join(', ')}.`);
    }
    if (isRoleScopedContext) {
      hints.push('Your role scope may limit visible rows.');
    }

    return hints.join(' ');
  }, [
    filters.associate_id,
    filters.team_id,
    filters.market_center_ids,
    filters.transaction_status,
    filters.sale_type,
    isRoleScopedContext,
  ]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadOptions(): Promise<void> {
      try {
        const response = await fetch('/api/reports/month-end/filter-options', {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error(`Failed to load report filters (${response.status})`);
        }

        const options = (await response.json()) as FilterOptions;
        if (cancelled) return;

        setFilterOptions(options);

        const statusDefault = options.statuses.find((s) => s.trim().toLowerCase() === 'registered') ?? 'Registered';
        const saleTypeDefault = normalizedSaleTypeDefault(options.sale_types);

        let scopedMarketCenterId = '';
        if (!isRegionalContext && activeContext?.marketCenterId) {
          scopedMarketCenterId = activeContext.marketCenterId;
        }

        setFilters((prev) => ({
          ...prev,
          transaction_status: [statusDefault],
          sale_type: [saleTypeDefault],
          market_center_ids: isRoleScopedContext ? [] : (scopedMarketCenterId ? [scopedMarketCenterId] : prev.market_center_ids),
        }));
      } catch {
        if (!cancelled) {
          setError('Failed to load filter options');
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [token, isRegionalContext, isRoleScopedContext, activeContext, authHeaders]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadExtendedOptions(): Promise<void> {
      try {
        const optionsPath = showScopeDebug
          ? '/api/reports/month-end/extended-filter-options?debug=1'
          : '/api/reports/month-end/extended-filter-options';
        const response = await fetch(optionsPath, {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error(`Failed to load extended report filters (${response.status})`);
        }

        const options = (await response.json()) as MonthEndExtendedFilterOptions;
        if (cancelled) return;

        setExtendedFilterOptions(options);
        setOptionsScopeDebug(options.debug ?? null);

        const statusDefault = options.statuses.find((s) => s.trim().toLowerCase() === 'registered') ?? 'Registered';
        const saleTypeDefault = normalizedSaleTypeDefault(options.sale_types);
        const scopedMarketCenterId = !isRegionalContext && activeContext?.marketCenterId ? activeContext.marketCenterId : '';
        const activeTeamToken = parseTeamContextToken(activeContext?.id);
        const contextMatchedTeam = activeTeamToken
          ? options.teams.find((team) => normalizeForMatch(team.id) === normalizeForMatch(activeTeamToken))
          : null;
        const ownAssociateId = options.associates[0]?.id ?? '';
        const ownTeamId = contextMatchedTeam?.id ?? options.teams[0]?.id ?? options.associates[0]?.team_id ?? '';

        const roleDefaults: Partial<Filters> = (isAgentOnlyContext || isTeamAgentContext)
          ? { associate_id: ownAssociateId, team_id: '' }
          : (isTeamManagerContext ? { team_id: ownTeamId, associate_id: '' } : {});

        setFilters((prev) => ({
          ...prev,
          transaction_status: [statusDefault],
          sale_type: [saleTypeDefault],
          market_center_ids: isRoleScopedContext ? [] : (scopedMarketCenterId ? [scopedMarketCenterId] : prev.market_center_ids),
          ...roleDefaults,
        }));
      } catch {
        if (!cancelled) {
          setError('Failed to load extended filter options');
        }
      }
    }

    void loadExtendedOptions();

    return () => {
      cancelled = true;
    };
  }, [token, isRegionalContext, isRoleScopedContext, activeContext, authHeaders, isAgentOnlyContext, isTeamAgentContext, isTeamManagerContext, showScopeDebug]);

  useEffect(() => {
    setFilters((prev) => {
      return {
        ...prev,
        transaction_status: [activeTab === 'transaction-date' ? startStatusDefault : registeredStatusDefault],
        sale_type: [saleTypeDefault],
      };
    });
  }, [activeTab, registeredStatusDefault, saleTypeDefault, startStatusDefault]);

  const fetchReport = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        date_from: filters.date_from,
        date_to: filters.date_to,
        transaction_status: filters.transaction_status.join(','),
        sale_type: filters.sale_type.join(','),
        team_id: filters.team_id,
        associate_id: filters.associate_id,
      });

      if (filters.market_center_ids.length > 0) {
        params.set('market_center_ids', filters.market_center_ids.join(','));
      }
      if (showScopeDebug) {
        params.set('debug', '1');
      }

      const response = await fetch(`/api/reports/month-end?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Month End report (${response.status})`);
      }

      const reportData = (await response.json()) as ReportData;
      setData(reportData);
      setMonthEndScopeDebug(reportData.debug ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load report';
      setError(message);
      setData(null);
      setMonthEndScopeDebug(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, authHeaders, showScopeDebug]);

  const fetchSummaryReport = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        date_from: filters.date_from,
        date_to: filters.date_to,
        transaction_status: filters.transaction_status.join(','),
        sale_type: filters.sale_type.join(','),
        date_basis: 'status_change',
        team_id: filters.team_id,
        associate_id: filters.associate_id,
      });

      if (filters.market_center_ids.length > 0) {
        params.set('market_center_ids', filters.market_center_ids.join(','));
      }

      const response = await fetch(`/api/reports/month-end/transaction-summary?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Transaction Summary (${response.status})`);
      }

      const reportData = (await response.json()) as SummaryData;
      setSummaryData(reportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Transaction Summary';
      setError(message);
      setSummaryData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, authHeaders]);

  const fetchDetailReport = useCallback(async (dateBasis: 'status_change' | 'transaction') => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        date_from: filters.date_from,
        date_to: filters.date_to,
        transaction_status: filters.transaction_status.join(','),
        sale_type: filters.sale_type.join(','),
        date_basis: dateBasis,
        team_id: filters.team_id,
        associate_id: filters.associate_id,
      });

      if (filters.market_center_ids.length > 0) {
        params.set('market_center_ids', filters.market_center_ids.join(','));
      }

      const response = await fetch(`/api/reports/month-end/transactions?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load detailed transactions (${response.status})`);
      }

      const reportData = (await response.json()) as DetailData;
      setDetailData(reportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load detailed transactions';
      setError(message);
      setDetailData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, authHeaders]);

  useEffect(() => {
    if (activeTab === 'market-center-totals') {
      void fetchReport();
      return;
    }

    if (activeTab === 'transaction-summary') {
      void fetchSummaryReport();
      return;
    }

    if (activeTab === 'status-change-date') {
      void fetchDetailReport('status_change');
      return;
    }

    void fetchDetailReport('transaction');
  }, [activeTab, fetchReport, fetchSummaryReport, fetchDetailReport]);

  const sortedRows = useMemo(() => {
    if (!data) return [];

    return [...data.rows].sort((a, b) => {
      const diff = Number(a[sortKey]) - Number(b[sortKey]);
      return sortDirection === 'asc' ? diff : -diff;
    });
  }, [data, sortKey, sortDirection]);

  function onSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('desc');
  }

  function exportMarketCsv(): void {
    if (!data || sortedRows.length === 0) return;

    const headers = [
      primaryDimensionLabel,
      'Contracts',
      'Units',
      'Total GCI',
      'Growth Share',
      'Royalties',
      'Company Dollar',
      'CO$ to GCI %',
      'Associate Dollar',
      'Team Dollar',
    ];

    const csvRows = [
      ...sortedRows.map((row) => [
        row.market_center_name,
        String(row.contracts),
        String(row.units),
        String(row.total_gci),
        String(row.growth_share),
        String(row.royalties),
        String(row.company_dollar),
        String(row.cos_to_gci_pct),
        String(row.associate_dollar),
        String(row.team_dollar),
      ]),
      [
        'TOTAL',
        String(data.totals.contracts),
        String(data.totals.units),
        String(data.totals.total_gci),
        String(data.totals.growth_share),
        String(data.totals.royalties),
        String(data.totals.company_dollar),
        String(data.totals.cos_to_gci_pct),
        String(data.totals.associate_dollar),
        String(data.totals.team_dollar),
      ],
    ];

    downloadCsv(`month-end-totals-${filters.date_from}-to-${filters.date_to}.csv`, toCsv(headers, csvRows));
  }

  function exportSummaryCsv(): void {
    if (!summaryData || summaryData.rows.length === 0) return;

    const headers = [
      primaryDimensionLabel,
      'Contracts',
      'Units',
      'Sales Price',
      'MC Sales Volume',
      'List Price',
      'Contract GCI',
      'GCI',
      'Royalties',
      'Growth Share',
      'Associate Dollar',
      'Company Dollar',
      'Team Dollar',
    ];

    const rows = [
      ...summaryData.rows.map((row) => [
        row.market_center_name,
        row.contracts,
        row.units,
        row.sales_price,
        row.mc_sales_volume,
        row.list_price,
        row.contract_gci,
        row.gci,
        row.royalties,
        row.growth_share,
        row.associate_dollar,
        row.company_dollar,
        row.team_dollar,
      ]),
      [
        'TOTAL',
        summaryData.totals.contracts,
        summaryData.totals.units,
        summaryData.totals.sales_price,
        summaryData.totals.mc_sales_volume,
        summaryData.totals.list_price,
        summaryData.totals.contract_gci,
        summaryData.totals.gci,
        summaryData.totals.royalties,
        summaryData.totals.growth_share,
        summaryData.totals.associate_dollar,
        summaryData.totals.company_dollar,
        summaryData.totals.team_dollar,
      ],
    ];

    downloadCsv(`month-end-transaction-summary-${filters.date_from}-to-${filters.date_to}.csv`, toCsv(headers, rows));
  }

  function exportDetailCsv(): void {
    if (!detailData || detailData.rows.length === 0) return;

    const headers = [
      ...(isRoleScopedContext ? [] : ['Market Centre']),
      'Associate', 'Team', 'TH Number / Transaction Number', 'Transaction Date', 'List Date', 'Status Change Date',
      'KWL Number', 'Transaction Type', 'Sale Type', 'Transaction Status', 'Suburb', 'City', 'Buyer', 'Seller',
      'List Price', 'Sales Price', 'TH Split %', 'Agent Sales Volume', 'Comm %', 'Contract GCI', 'Total GCI',
      'Royalties', 'Growth Share', 'Associate Dollar', 'Company Dollar', 'Team Dollar', 'Cap Remaining',
      'Listing Office', 'Bond Originator', 'Bond Attorney', 'Bond Attorney Email', 'Bond Attorney Phone',
      'Transfer Attorney', 'Transfer Attorney Email', 'Transfer Attorney Phone',
    ];

    const rows = detailData.rows.map((row) => [
      ...(isRoleScopedContext ? [] : [row.market_center_name]),
      row.associate_name,
      row.team_name,
      row.transaction_number,
      formatDate(row.transaction_date),
      formatDate(row.list_date),
      formatDate(row.status_change_date),
      row.kwl_number,
      row.transaction_type,
      row.sale_type,
      row.transaction_status,
      row.suburb,
      row.city,
      row.buyer,
      row.seller,
      row.list_price,
      row.sales_price,
      row.th_split_pct,
      row.agent_sales_volume,
      row.comm_pct,
      row.contract_gci,
      row.total_gci,
      row.royalties,
      row.growth_share,
      row.associate_dollar,
      row.company_dollar,
      row.team_dollar,
      row.cap_remaining,
      row.listing_office,
      row.bond_originator,
      row.bond_attorney,
      row.bond_attorney_email,
      row.bond_attorney_phone,
      row.transfer_attorney,
      row.transfer_attorney_email,
      row.transfer_attorney_phone,
    ]);

    downloadCsv(`month-end-${activeTab}-${filters.date_from}-to-${filters.date_to}.csv`, toCsv(headers, rows));
  }

  function exportActiveTabCsv(): void {
    if (activeTab === 'market-center-totals') {
      exportMarketCsv();
      return;
    }
    if (activeTab === 'transaction-summary') {
      exportSummaryCsv();
      return;
    }
    exportDetailCsv();
  }

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Month End Report"
        subtitle={reportSubtitle}
        context={`Reporting window: ${filters.date_from} to ${filters.date_to}`}
        actions={
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <ReportKpiCard
              label="Contracts"
              icon={<ReportIcon kind="file-check" className="h-3.5 w-3.5" />}
              value={formatNumber(data?.kpi.contracts ?? 0)}
            />
            <ReportKpiCard
              label="Units"
              icon={<ReportIcon kind="layers" className="h-3.5 w-3.5" />}
              value={formatNumber(data?.kpi.units ?? 0)}
            />
            <ReportKpiCard
              label="Total GCI"
              icon={<ReportIcon kind="wallet" className="h-3.5 w-3.5" />}
              value={formatMoney(data?.kpi.total_gci ?? 0)}
            />
          </div>
        }
      />

      <FilterPanel>
        <div className="mb-3 flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: 'var(--border-soft)' }}>
          {[
            { id: 'market-center-totals', label: totalsTabLabel },
            { id: 'transaction-summary', label: 'Transaction Summary' },
            { id: 'status-change-date', label: 'Status Change Date' },
            { id: 'transaction-date', label: 'Transaction Date' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ReportTab)}
                className="inline-flex rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: isActive ? 'var(--brand)' : 'var(--surface-strong)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {(activeTab === 'status-change-date' || activeTab === 'transaction-date') ? (
          <div className="mb-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}>
            {activeTab === 'status-change-date'
              ? 'Status Change Date tab filters by status_change_date.'
              : 'Transaction Date tab filters by transaction_date.'}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Date From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Date To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <MultiSelectFilter
            label="Status"
            selected={filters.transaction_status}
            onChange={(next) => setFilters((prev) => ({ ...prev, transaction_status: next }))}
            options={filterOptions.statuses.map((status) => ({ value: status, label: status }))}
            allLabel="All"
          />

          <MultiSelectFilter
            label="Sale Type"
            selected={filters.sale_type}
            onChange={(next) => setFilters((prev) => ({ ...prev, sale_type: next }))}
            options={filterOptions.sale_types.map((saleType) => ({ value: saleType, label: saleType }))}
            allLabel="All"
          />

          {!isRoleScopedContext ? <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Market Centre</label>
            <select
              value={selectedMarketCenterId}
              disabled={!isRegionalContext}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((prev) => ({
                  ...prev,
                  market_center_ids: value ? [value] : [],
                }));
              }}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-80"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              {isRegionalContext && <option value="">All</option>}
              {filterOptions.market_centers.map((marketCenter) => (
                <option key={marketCenter.id} value={marketCenter.id}>{marketCenter.name}</option>
              ))}
            </select>
          </div> : null}

          {activeTab !== 'market-center-totals' && !isRoleScopedContext ? (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Team</label>
              <select
                value={filters.team_id}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilters((prev) => ({ ...prev, team_id: value, associate_id: '' }));
                }}
                className="w-full rounded-md border px-2.5 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
              >
                <option value="">All</option>
                {scopedTeams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          {activeTab !== 'market-center-totals' && !isAgentOnlyContext ? (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Associate</label>
              <select
                value={filters.associate_id}
                onChange={(event) => setFilters((prev) => ({ ...prev, associate_id: event.target.value }))}
                className="w-full rounded-md border px-2.5 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
              >
                {!isTeamContext && <option value="">All</option>}
                {scopedAssociates.map((associate) => (
                  <option key={associate.id} value={associate.id}>{associate.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-end justify-end">
            <button
              type="button"
              onClick={exportActiveTabCsv}
              disabled={
                (activeTab === 'market-center-totals' && (!data || data.rows.length === 0))
                || (activeTab === 'transaction-summary' && (!summaryData || summaryData.rows.length === 0))
                || ((activeTab === 'status-change-date' || activeTab === 'transaction-date') && (!detailData || detailData.rows.length === 0))
              }
              className="inline-flex h-[34px] items-center rounded-md border px-3 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{
                borderColor: 'var(--border-soft)',
                color: 'var(--text-muted)',
                background: 'var(--surface-strong)',
              }}
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
        ) : activeTab === 'market-center-totals' ? (
          !data || data.rows.length === 0 ? <ReportState type="empty" message={`No results found for the selected filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-soft)', background: 'var(--surface-strong)' }}>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    {primaryDimensionLabel}
                  </th>
                  {TABLE_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      onClick={() => onSort(column.key)}
                      className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide"
                      style={{ color: sortKey === column.key ? 'var(--brand)' : 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      {column.label} {sortKey === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((row, index) => (
                  <tr
                    key={`${row.mc_source_id}-${row.market_center_name}`}
                    className="hover:bg-slate-50"
                    style={{
                      borderBottom: '1px solid var(--border-soft)',
                      background: index % 2 === 0 ? 'var(--surface)' : 'var(--surface-strong)',
                    }}
                  >
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {row.market_center_name}
                    </td>
                    {TABLE_COLUMNS.map((column) => {
                      const value = row[column.key] as number;
                      const display = renderValue(column.kind, value);

                      return (
                        <td key={column.key} className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                          {column.kind === 'currency'
                            ? renderAlignedCurrency(value, column.key === 'total_gci')
                            : (column.key === 'total_gci' ? <span className="font-semibold" style={{ color: 'var(--brand)' }}>{display}</span> : display)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                  <td className="px-3 py-2.5 text-sm font-bold text-white">TOTAL</td>
                  {TABLE_COLUMNS.map((column) => (
                    <td key={column.key} className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">
                        {column.kind === 'currency'
                          ? renderAlignedCurrency(data.totals[column.key] as number)
                          : renderValue(column.kind, data.totals[column.key] as number)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          )
        ) : activeTab === 'transaction-summary' ? (
          !summaryData || summaryData.rows.length === 0 ? <ReportState type="empty" message={`No transaction summary rows found for the selected filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-sm">
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-soft)', background: 'var(--surface-strong)' }}>
                    <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{primaryDimensionLabel}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Contracts</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Units</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Sales Price</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>MC Sales Volume</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>List Price</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Contract GCI</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>GCI</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Royalties</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Growth Share</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Associate Dollar</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Company Dollar</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Team Dollar</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryData.rows.map((row, index) => (
                    <tr key={`${row.mc_source_id}-${row.market_center_name}`} style={{ borderBottom: '1px solid var(--border-soft)', background: index % 2 === 0 ? 'var(--surface)' : 'var(--surface-strong)' }}>
                      <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{row.market_center_name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatNumber(row.contracts)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatNumber(row.units)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.sales_price)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.mc_sales_volume)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.list_price)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.contract_gci)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.gci, true)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.royalties)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.growth_share)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.associate_dollar)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.company_dollar)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.team_dollar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                    <td className="px-3 py-2.5 text-sm font-bold text-white">TOTAL</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{formatNumber(summaryData.totals.contracts)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{formatNumber(summaryData.totals.units)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.sales_price)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.mc_sales_volume)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.list_price)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.contract_gci)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.gci)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.royalties)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.growth_share)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.associate_dollar)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.company_dollar)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(summaryData.totals.team_dollar)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : (
          !detailData || detailData.rows.length === 0 ? <ReportState type="empty" message={`No detailed transaction rows found for the selected filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[3200px] text-sm">
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-soft)', background: 'var(--surface-strong)' }}>
                    {[
                      ...(isRoleScopedContext ? [] : ['Market Centre']),
                      'Associate', 'Team', 'TH Number / Transaction Number', 'Transaction Date', 'List Date', 'Status Change Date',
                      'KWL Number', 'Transaction Type', 'Sale Type', 'Transaction Status', 'Suburb', 'City', 'Buyer', 'Seller',
                      'List Price', 'Sales Price', 'TH Split %', 'Agent Sales Volume', 'Comm %', 'Contract GCI', 'Total GCI',
                      'Royalties', 'Growth Share', 'Associate Dollar', 'Company Dollar', 'Team Dollar', 'Cap Remaining',
                      'Listing Office', 'Bond Originator', 'Bond Attorney', 'Bond Attorney Email', 'Bond Attorney Phone',
                      'Transfer Attorney', 'Transfer Attorney Email', 'Transfer Attorney Phone',
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="sticky top-0 whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detailData.rows.map((row, index) => (
                    <tr key={`${row.mc_source_id}-${row.source_associate_id}-${row.transaction_number}-${index}`} style={{ borderBottom: '1px solid var(--border-soft)', background: index % 2 === 0 ? 'var(--surface)' : 'var(--surface-strong)' }}>
                      {!isRoleScopedContext && <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.market_center_name}</td>}
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.associate_name}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.team_name}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transaction_number}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{formatDate(row.transaction_date)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{formatDate(row.list_date)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{formatDate(row.status_change_date)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.kwl_number}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transaction_type}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.sale_type}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transaction_status}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.suburb}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.city}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.buyer}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.seller}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.list_price)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.sales_price)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatPercent(row.th_split_pct)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.agent_sales_volume)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatPercent(row.comm_pct)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.contract_gci)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.total_gci, true)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.royalties)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.growth_share)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.associate_dollar)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.company_dollar)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.team_dollar)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{renderAlignedCurrency(row.cap_remaining)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.listing_office}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.bond_originator}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.bond_attorney}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.bond_attorney_email}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.bond_attorney_phone}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transfer_attorney}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transfer_attorney_email}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>{row.transfer_attorney_phone}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                    <td className="px-3 py-2.5 text-sm font-bold text-white">TOTAL</td>
                    <td className="px-3 py-2.5 text-sm font-bold text-white" colSpan={detailContractsColSpan}>Contracts {formatNumber(detailData.totals.contracts)} | Units {formatNumber(detailData.totals.units)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.list_price)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.sales_price)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">-</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.agent_sales_volume)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">-</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.contract_gci)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.total_gci)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.royalties)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.growth_share)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.associate_dollar)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.company_dollar)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">{renderAlignedCurrency(detailData.totals.team_dollar)}</td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-white">-</td>
                    <td className="px-3 py-2.5 text-sm font-bold text-white" colSpan={8}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}
      </section>
    </div>
  );
}