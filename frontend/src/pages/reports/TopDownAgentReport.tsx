import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FilterPanel, MultiSelectFilter, ReportHeader, ReportIcon, ReportKpiCard, ReportState } from './ReportUi';

type TopDownAgentFilterOptions = {
  market_centers: Array<{ id: string; name: string }>;
  associates: Array<{ id: string; name: string; market_center_id: string; market_center_name: string; team_id: string }>;
  teams: Array<{ id: string; name: string; market_center_id: string; market_center_name: string }>;
  transaction_statuses: string[];
  sale_types: string[];
  listing_statuses: string[];
  sale_or_rent_options: string[];
  mandate_types: string[];
};

type TopDownAgentProductionRow = {
  source_associate_id: string;
  associate_name: string;
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  total_gci: number;
  growth_share: number;
  royalties: number;
  company_dollar: number;
  associate_dollar: number;
  team_dollar: number;
};

type TopDownAgentListingRow = {
  source_associate_id: string;
  associate_name: string;
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  listing_numbers: string;
  total_listings: number;
  active_listings: number;
  for_sale_listings: number;
  for_rent_listings: number;
  avg_days_on_market: number;
  avg_listing_price: number;
};

type ProductionSummaryRow = {
  market_center_name: string;
  mc_source_id: string;
  contracts: number;
  units: number;
  total_gci: number;
  company_dollar: number;
};

type ListingSummaryRow = {
  market_center_name: string;
  mc_source_id: string;
  total_listings: number;
  active_listings: number;
  for_sale_listings: number;
  for_rent_listings: number;
};

type TopDownAgentResponse = {
  production: {
    rows: TopDownAgentProductionRow[];
    summary_by_market_center: ProductionSummaryRow[];
  };
  listings: {
    rows: TopDownAgentListingRow[];
    summary_by_market_center: ListingSummaryRow[];
  };
  totals: {
    production_contracts: number;
    production_units: number;
    production_gci: number;
    production_company_dollar: number;
    listings_total: number;
    listings_active: number;
  };
};

type ViewBy = 'agents' | 'teams';

type TabKey = 'production' | 'listings' | 'production-summary' | 'listing-summary';

type Filters = {
  date_from: string;
  date_to: string;
  list_date_from: string;
  list_date_to: string;
  market_center_id: string;
  transaction_status: string[];
  sale_type: string[];
  listing_status: string[];
  sale_or_rent: string[];
  mandate_type: string[];
  associate_id: string;
  team_id: string;
  associate_query: string;
  team_query: string;
};

type SelectorOption = {
  id: string;
  name: string;
  description?: string;
};

type ProductionSortKey =
  | 'associate_name'
  | 'team_name'
  | 'market_center_name'
  | 'contracts'
  | 'units'
  | 'total_gci'
  | 'company_dollar';

type ListingSortKey =
  | 'associate_name'
  | 'team_name'
  | 'market_center_name'
  | 'total_listings'
  | 'active_listings'
  | 'for_sale_listings'
  | 'for_rent_listings'
  | 'avg_days_on_market'
  | 'avg_listing_price';

type TeamProductionRow = {
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  active_associates: number;
  contracts: number;
  units: number;
  total_gci: number;
  growth_share: number;
  royalties: number;
  company_dollar: number;
  associate_dollar: number;
  team_dollar: number;
};

type TeamListingRow = {
  team_name: string;
  market_center_name: string;
  mc_source_id: string;
  active_associates: number;
  total_listings: number;
  active_listings: number;
  for_sale_listings: number;
  for_rent_listings: number;
  avg_days_on_market: number;
  avg_listing_price: number;
};

type TeamProductionSortKey =
  | 'team_name'
  | 'market_center_name'
  | 'active_associates'
  | 'contracts'
  | 'units'
  | 'total_gci'
  | 'company_dollar';

type TeamListingSortKey =
  | 'team_name'
  | 'market_center_name'
  | 'active_associates'
  | 'total_listings'
  | 'active_listings'
  | 'for_sale_listings'
  | 'for_rent_listings'
  | 'avg_days_on_market'
  | 'avg_listing_price';

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFirstOfMonth(): string {
  const now = new Date();
  return formatDateForInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function getToday(): string {
  return formatDateForInput(new Date());
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return 'R0.00';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-ZA') : '0';
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return `${value.toFixed(1)} d`;
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

function SearchableSelector({
  label,
  placeholder,
  options,
  selectedId,
  onSelect,
  allLabel,
}: {
  label: string;
  placeholder: string;
  options: SelectorOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  allLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId]
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption?.name ?? '');
    }
  }, [isOpen, selectedOption]);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent): void {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      const inName = option.name.toLowerCase().includes(normalizedQuery);
      const inDescription = (option.description ?? '').toLowerCase().includes(normalizedQuery);
      return inName || inDescription;
    });
  }, [options, normalizedQuery]);

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <input
        type="text"
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          if (!event.target.value.trim()) {
            onSelect('');
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-md border px-2.5 py-1.5 text-sm"
        style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
      />
      {isOpen && (
        <div
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border shadow-lg"
          style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)' }}
        >
          <button
            type="button"
            onClick={() => {
              onSelect('');
              setQuery('');
              setIsOpen(false);
            }}
            className="block w-full border-b px-2.5 py-2 text-left text-sm"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
          >
            {allLabel}
          </button>
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onSelect(option.id);
                setQuery(option.name);
                setIsOpen(false);
              }}
              className="block w-full border-b px-2.5 py-2 text-left text-sm last:border-b-0"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              <div>{option.name}</div>
              {option.description ? (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{option.description}</div>
              ) : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="px-2.5 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              No matches found.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function getDefaultFilters(options: TopDownAgentFilterOptions): Filters {
  const transactionStatus = options.transaction_statuses.find((value) => value.trim().toLowerCase() === 'registered') ?? '';
  const saleType = options.sale_types.find((value) => value.trim().toLowerCase() === 'for sale') ?? '';

  return {
    date_from: getFirstOfMonth(),
    date_to: getToday(),
    list_date_from: getFirstOfMonth(),
    list_date_to: getToday(),
    market_center_id: '',
    transaction_status: transactionStatus ? [transactionStatus] : [],
    sale_type: saleType ? [saleType] : [],
    listing_status: [],
    sale_or_rent: [],
    mandate_type: [],
    associate_id: '',
    team_id: '',
    associate_query: '',
    team_query: '',
  };
}

export default function TopDownAgentReport() {
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
  const isMarketCenterContext = !isRegionalContext && !isAgentOnlyContext && !isTeamContext;
  const canShowMarketCenterRollups = isRegionalContext;
  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  }), [token, activeContext?.id]);

  const [tab, setTab] = useState<TabKey>(isRegionalContext ? 'production-summary' : 'production');
  const [viewBy, setViewBy] = useState<ViewBy>('agents');
  const [options, setOptions] = useState<TopDownAgentFilterOptions>({
    market_centers: [],
    associates: [],
    teams: [],
    transaction_statuses: [],
    sale_types: [],
    listing_statuses: [],
    sale_or_rent_options: [],
    mandate_types: [],
  });

  const [draftFilters, setDraftFilters] = useState<Filters>(() => getDefaultFilters({
    market_centers: [],
    associates: [],
    teams: [],
    transaction_statuses: [],
    sale_types: [],
    listing_statuses: [],
    sale_or_rent_options: [],
    mandate_types: [],
  }));
  const [appliedFilters, setAppliedFilters] = useState<Filters>(draftFilters);

  const [data, setData] = useState<TopDownAgentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productionSortKey, setProductionSortKey] = useState<ProductionSortKey>('total_gci');
  const [productionSortDirection, setProductionSortDirection] = useState<'asc' | 'desc'>('desc');

  const [listingSortKey, setListingSortKey] = useState<ListingSortKey>('total_listings');
  const [listingSortDirection, setListingSortDirection] = useState<'asc' | 'desc'>('desc');

  const [teamProductionSortKey, setTeamProductionSortKey] = useState<TeamProductionSortKey>('total_gci');
  const [teamProductionSortDirection, setTeamProductionSortDirection] = useState<'asc' | 'desc'>('desc');

  const [teamListingSortKey, setTeamListingSortKey] = useState<TeamListingSortKey>('total_listings');
  const [teamListingSortDirection, setTeamListingSortDirection] = useState<'asc' | 'desc'>('desc');

  const availableTabs = useMemo<Array<{ id: TabKey; label: string }>>(() => {
    const baseTabs: Array<{ id: TabKey; label: string }> = [
      { id: 'production', label: viewBy === 'teams' ? 'Production by Team' : 'Production by Agent' },
      { id: 'listings', label: viewBy === 'teams' ? 'Listings by Team' : 'Listings by Agent' },
    ];

    if (canShowMarketCenterRollups) {
      baseTabs.push({ id: 'production-summary', label: 'Production by Market Centre' });
      baseTabs.push({ id: 'listing-summary', label: 'Listings by Market Centre' });
    }

    return baseTabs;
  }, [viewBy, canShowMarketCenterRollups]);

  useEffect(() => {
    if (isAgentOnlyContext && viewBy !== 'agents') {
      setViewBy('agents');
    }
  }, [isAgentOnlyContext, viewBy]);

  useEffect(() => {
    const defaultTab: TabKey = isRegionalContext ? 'production-summary' : 'production';
    if (!availableTabs.some((tabOption) => tabOption.id === tab)) {
      setTab(defaultTab);
    }
  }, [availableTabs, tab, isRegionalContext]);

  useEffect(() => {
    setViewBy('agents');
    setTab(isRegionalContext ? 'production-summary' : 'production');
  }, [activeContext?.id, isRegionalContext]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadOptions(): Promise<void> {
      try {
        const response = await fetch('/api/reports/top-down-agent/filter-options', {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error(`Failed to load Top Down Performance filters (${response.status})`);
        }

        const nextOptions = (await response.json()) as TopDownAgentFilterOptions;
        if (cancelled) return;

        const defaults = getDefaultFilters(nextOptions);
        const scopedMcId = isMarketCenterContext && activeContext?.marketCenterId ? activeContext.marketCenterId : '';
        const ownAssociateId = nextOptions.associates[0]?.id ?? '';
        const ownTeamId = nextOptions.teams[0]?.id ?? nextOptions.associates[0]?.team_id ?? '';

        const roleDefaults: Partial<Filters> = (isAgentOnlyContext || isTeamAgentContext)
          ? {
              associate_id: ownAssociateId,
              team_id: ownTeamId,
            }
          : (isTeamManagerContext
            ? {
                team_id: ownTeamId,
              }
            : {});

        setOptions(nextOptions);
        setDraftFilters({ ...defaults, market_center_id: scopedMcId, ...roleDefaults });
        setAppliedFilters({ ...defaults, market_center_id: scopedMcId, ...roleDefaults });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load filters';
        setError(message);
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [token, isRegionalContext, activeContext, isAgentOnlyContext, isTeamAgentContext, isTeamManagerContext, isMarketCenterContext, authHeaders]);

  const loadReport = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        date_from: appliedFilters.date_from,
        date_to: appliedFilters.date_to,
        list_date_from: appliedFilters.list_date_from,
        list_date_to: appliedFilters.list_date_to,
        transaction_status: appliedFilters.transaction_status.join(','),
        sale_type: appliedFilters.sale_type.join(','),
        listing_status: appliedFilters.listing_status.join(','),
        sale_or_rent: appliedFilters.sale_or_rent.join(','),
        mandate_type: appliedFilters.mandate_type.join(','),
        associate_id: viewBy === 'agents' ? appliedFilters.associate_id : '',
        team_id: (viewBy === 'teams' || isTeamManagerContext) ? appliedFilters.team_id : '',
        associate_query: appliedFilters.associate_query,
        team_query: appliedFilters.team_query,
      });

      if (appliedFilters.market_center_id) {
        params.set('market_center_ids', appliedFilters.market_center_id);
      }

      const response = await fetch(`/api/reports/top-down-agent?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Top Down Performance report (${response.status})`);
      }

      const reportData = (await response.json()) as TopDownAgentResponse;
      setData(reportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load report';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, appliedFilters, viewBy, isTeamManagerContext, authHeaders]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const mergedProductionRows = useMemo(() => {
    if (!data) return [];

    const merged = new Map<string, TopDownAgentProductionRow>();
    for (const row of data.production.rows) {
      merged.set(`${row.source_associate_id}::${row.mc_source_id}`, row);
    }

    for (const listingRow of data.listings.rows) {
      const key = `${listingRow.source_associate_id}::${listingRow.mc_source_id}`;
      if (merged.has(key)) continue;

      merged.set(key, {
        source_associate_id: listingRow.source_associate_id,
        associate_name: listingRow.associate_name,
        team_name: listingRow.team_name,
        market_center_name: listingRow.market_center_name,
        mc_source_id: listingRow.mc_source_id,
        contracts: 0,
        units: 0,
        total_gci: 0,
        growth_share: 0,
        royalties: 0,
        company_dollar: 0,
        associate_dollar: 0,
        team_dollar: 0,
      });
    }

    return Array.from(merged.values());
  }, [data]);

  const sortedProductionRows = useMemo(() => {
    return [...mergedProductionRows].sort((left, right) => {
      const leftValue = left[productionSortKey];
      const rightValue = right[productionSortKey];
      const comparison = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue);
      return productionSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [mergedProductionRows, productionSortKey, productionSortDirection]);

  const sortedListingRows = useMemo(() => {
    if (!data) return [];
    return [...data.listings.rows].sort((left, right) => {
      const leftValue = left[listingSortKey];
      const rightValue = right[listingSortKey];
      const comparison = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue);
      return listingSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, listingSortKey, listingSortDirection]);

  const teamProductionRows = useMemo<TeamProductionRow[]>(() => {
    if (!data) return [];

    const grouped = new Map<string, TeamProductionRow>();
    const memberSets = new Map<string, Set<string>>();

    for (const row of data.production.rows) {
      const normalizedTeamName = row.team_name.trim().toLowerCase();
      if (normalizedTeamName === 'no team' || normalizedTeamName === 'unassigned / unknown team') {
        continue;
      }

      const key = `${row.mc_source_id}::${row.team_name}`;
      const existing = grouped.get(key) ?? {
        team_name: row.team_name,
        market_center_name: row.market_center_name,
        mc_source_id: row.mc_source_id,
        active_associates: 0,
        contracts: 0,
        units: 0,
        total_gci: 0,
        growth_share: 0,
        royalties: 0,
        company_dollar: 0,
        associate_dollar: 0,
        team_dollar: 0,
      };
      existing.contracts += row.contracts;
      existing.units += row.units;
      existing.total_gci += row.total_gci;
      existing.growth_share += row.growth_share;
      existing.royalties += row.royalties;
      existing.company_dollar += row.company_dollar;
      existing.associate_dollar += row.associate_dollar;
      existing.team_dollar += row.team_dollar;
      grouped.set(key, existing);

      const members = memberSets.get(key) ?? new Set<string>();
      members.add(row.source_associate_id);
      memberSets.set(key, members);
    }

    return Array.from(grouped.entries()).map(([key, row]) => ({
      ...row,
      active_associates: memberSets.get(key)?.size ?? 0,
      total_gci: Math.round(row.total_gci * 100) / 100,
      growth_share: Math.round(row.growth_share * 100) / 100,
      royalties: Math.round(row.royalties * 100) / 100,
      company_dollar: Math.round(row.company_dollar * 100) / 100,
      associate_dollar: Math.round(row.associate_dollar * 100) / 100,
      team_dollar: Math.round(row.team_dollar * 100) / 100,
    }));
  }, [data]);

  const sortedTeamProductionRows = useMemo(() => {
    return [...teamProductionRows].sort((left, right) => {
      const leftValue = left[teamProductionSortKey];
      const rightValue = right[teamProductionSortKey];
      const comparison = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue);
      return teamProductionSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [teamProductionRows, teamProductionSortKey, teamProductionSortDirection]);

  const teamListingRows = useMemo<TeamListingRow[]>(() => {
    if (!data) return [];

    const grouped = new Map<string, TeamListingRow>();
    const memberSets = new Map<string, Set<string>>();
    const weightedDays = new Map<string, number>();
    const weightedPrice = new Map<string, number>();

    for (const row of data.listings.rows) {
      const normalizedTeamName = row.team_name.trim().toLowerCase();
      if (normalizedTeamName === 'no team' || normalizedTeamName === 'unassigned / unknown team') {
        continue;
      }

      const key = `${row.mc_source_id}::${row.team_name}`;
      const existing = grouped.get(key) ?? {
        team_name: row.team_name,
        market_center_name: row.market_center_name,
        mc_source_id: row.mc_source_id,
        active_associates: 0,
        total_listings: 0,
        active_listings: 0,
        for_sale_listings: 0,
        for_rent_listings: 0,
        avg_days_on_market: 0,
        avg_listing_price: 0,
      };

      existing.total_listings += row.total_listings;
      existing.active_listings += row.active_listings;
      existing.for_sale_listings += row.for_sale_listings;
      existing.for_rent_listings += row.for_rent_listings;
      grouped.set(key, existing);

      weightedDays.set(key, (weightedDays.get(key) ?? 0) + (row.avg_days_on_market * row.total_listings));
      weightedPrice.set(key, (weightedPrice.get(key) ?? 0) + (row.avg_listing_price * row.total_listings));

      const members = memberSets.get(key) ?? new Set<string>();
      members.add(row.source_associate_id);
      memberSets.set(key, members);
    }

    return Array.from(grouped.entries()).map(([key, row]) => {
      const divisor = row.total_listings > 0 ? row.total_listings : 1;
      return {
        ...row,
        active_associates: memberSets.get(key)?.size ?? 0,
        avg_days_on_market: Math.round(((weightedDays.get(key) ?? 0) / divisor) * 100) / 100,
        avg_listing_price: Math.round(((weightedPrice.get(key) ?? 0) / divisor) * 100) / 100,
      };
    });
  }, [data]);

  const sortedTeamListingRows = useMemo(() => {
    return [...teamListingRows].sort((left, right) => {
      const leftValue = left[teamListingSortKey];
      const rightValue = right[teamListingSortKey];
      const comparison = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue);
      return teamListingSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [teamListingRows, teamListingSortKey, teamListingSortDirection]);

  const productionTotals = useMemo(() => (
    sortedProductionRows.reduce(
      (acc, row) => ({
        contracts: acc.contracts + row.contracts,
        units: acc.units + row.units,
        total_gci: acc.total_gci + row.total_gci,
        company_dollar: acc.company_dollar + row.company_dollar,
      }),
      { contracts: 0, units: 0, total_gci: 0, company_dollar: 0 }
    )
  ), [sortedProductionRows]);

  const teamProductionTotals = useMemo(() => (
    sortedTeamProductionRows.reduce(
      (acc, row) => ({
        active_associates: acc.active_associates + row.active_associates,
        contracts: acc.contracts + row.contracts,
        units: acc.units + row.units,
        total_gci: acc.total_gci + row.total_gci,
        company_dollar: acc.company_dollar + row.company_dollar,
      }),
      { active_associates: 0, contracts: 0, units: 0, total_gci: 0, company_dollar: 0 }
    )
  ), [sortedTeamProductionRows]);

  const listingTotals = useMemo(() => {
    const totals = sortedListingRows.reduce(
      (acc, row) => ({
        total_listings: acc.total_listings + row.total_listings,
        active_listings: acc.active_listings + row.active_listings,
        for_sale_listings: acc.for_sale_listings + row.for_sale_listings,
        for_rent_listings: acc.for_rent_listings + row.for_rent_listings,
        weighted_days_sum: acc.weighted_days_sum + (row.avg_days_on_market * row.total_listings),
        weighted_price_sum: acc.weighted_price_sum + (row.avg_listing_price * row.total_listings),
      }),
      {
        total_listings: 0,
        active_listings: 0,
        for_sale_listings: 0,
        for_rent_listings: 0,
        weighted_days_sum: 0,
        weighted_price_sum: 0,
      }
    );

    const divisor = totals.total_listings > 0 ? totals.total_listings : 1;
    return {
      total_listings: totals.total_listings,
      active_listings: totals.active_listings,
      for_sale_listings: totals.for_sale_listings,
      for_rent_listings: totals.for_rent_listings,
      avg_days_on_market: totals.weighted_days_sum / divisor,
      avg_listing_price: totals.weighted_price_sum / divisor,
    };
  }, [sortedListingRows]);

  const teamListingTotals = useMemo(() => {
    const totals = sortedTeamListingRows.reduce(
      (acc, row) => ({
        active_associates: acc.active_associates + row.active_associates,
        total_listings: acc.total_listings + row.total_listings,
        active_listings: acc.active_listings + row.active_listings,
        for_sale_listings: acc.for_sale_listings + row.for_sale_listings,
        for_rent_listings: acc.for_rent_listings + row.for_rent_listings,
        weighted_days_sum: acc.weighted_days_sum + (row.avg_days_on_market * row.total_listings),
        weighted_price_sum: acc.weighted_price_sum + (row.avg_listing_price * row.total_listings),
      }),
      {
        active_associates: 0,
        total_listings: 0,
        active_listings: 0,
        for_sale_listings: 0,
        for_rent_listings: 0,
        weighted_days_sum: 0,
        weighted_price_sum: 0,
      }
    );

    const divisor = totals.total_listings > 0 ? totals.total_listings : 1;
    return {
      active_associates: totals.active_associates,
      total_listings: totals.total_listings,
      active_listings: totals.active_listings,
      for_sale_listings: totals.for_sale_listings,
      for_rent_listings: totals.for_rent_listings,
      avg_days_on_market: totals.weighted_days_sum / divisor,
      avg_listing_price: totals.weighted_price_sum / divisor,
    };
  }, [sortedTeamListingRows]);

  const listingsByAssociateKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sortedListingRows) {
      map.set(`${row.source_associate_id}::${row.mc_source_id}`, row.total_listings);
    }
    return map;
  }, [sortedListingRows]);

  const listingsByTeamKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sortedTeamListingRows) {
      map.set(`${row.team_name}::${row.mc_source_id}`, row.total_listings);
    }
    return map;
  }, [sortedTeamListingRows]);

  function toggleProductionSort(nextKey: ProductionSortKey): void {
    if (productionSortKey === nextKey) {
      setProductionSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setProductionSortKey(nextKey);
    setProductionSortDirection('desc');
  }

  function toggleListingSort(nextKey: ListingSortKey): void {
    if (listingSortKey === nextKey) {
      setListingSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setListingSortKey(nextKey);
    setListingSortDirection('desc');
  }

  function toggleTeamProductionSort(nextKey: TeamProductionSortKey): void {
    if (teamProductionSortKey === nextKey) {
      setTeamProductionSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setTeamProductionSortKey(nextKey);
    setTeamProductionSortDirection('desc');
  }

  function toggleTeamListingSort(nextKey: TeamListingSortKey): void {
    if (teamListingSortKey === nextKey) {
      setTeamListingSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setTeamListingSortKey(nextKey);
    setTeamListingSortDirection('desc');
  }

  function resetFiltersToDefaults(): void {
    const defaults = getDefaultFilters(options);
    const scopedMcId = isMarketCenterContext && activeContext?.marketCenterId ? activeContext.marketCenterId : '';
    const ownAssociateId = options.associates[0]?.id ?? '';
    const ownTeamId = options.teams[0]?.id ?? options.associates[0]?.team_id ?? '';
    const roleDefaults: Partial<Filters> = (isAgentOnlyContext || isTeamAgentContext)
      ? {
          associate_id: ownAssociateId,
          team_id: ownTeamId,
        }
      : (isTeamManagerContext
        ? {
            team_id: ownTeamId,
          }
        : {});
    const next = { ...defaults, market_center_id: scopedMcId, ...roleDefaults };
    setDraftFilters(next);
    setAppliedFilters(next);
  }

  function exportCurrentTabCsv(): void {
    if (!data) return;

    const filePrefix = `top-down-performance-${viewBy}`;

    if (tab === 'production') {
      if (viewBy === 'teams') {
        const csv = toCsv(
          ['Team', 'Market Centre', 'Active Associates', 'Contracts', 'Units', 'Listings', 'Total GCI', 'Company Dollar', 'Associate Dollar', 'Team Dollar'],
          sortedTeamProductionRows.map((row) => [
            row.team_name,
            row.market_center_name,
            row.active_associates,
            row.contracts,
            row.units,
            listingsByTeamKey.get(`${row.team_name}::${row.mc_source_id}`) ?? 0,
            row.total_gci,
            row.company_dollar,
            row.associate_dollar,
            row.team_dollar,
          ])
        );
        downloadCsv(`${filePrefix}-production.csv`, csv);
        return;
      }

      const csv = toCsv(
        ['Associate', 'Team', 'Market Centre', 'Contracts', 'Units', 'Listings', 'Total GCI', 'Company Dollar', 'Associate Dollar', 'Team Dollar'],
        sortedProductionRows.map((row) => [
          row.associate_name,
          row.team_name,
          row.market_center_name,
          row.contracts,
          row.units,
          listingsByAssociateKey.get(`${row.source_associate_id}::${row.mc_source_id}`) ?? 0,
          row.total_gci,
          row.company_dollar,
          row.associate_dollar,
          row.team_dollar,
        ])
      );
      downloadCsv(`${filePrefix}-production.csv`, csv);
      return;
    }

    if (tab === 'listings') {
      if (viewBy === 'teams') {
        const csv = toCsv(
          ['Team', 'Market Centre', 'Active Associates', 'Total Listings', 'Active Listings', 'For Sale', 'For Rent', 'Avg Days On Market', 'Avg Listing Price'],
          sortedTeamListingRows.map((row) => [
            row.team_name,
            row.market_center_name,
            row.active_associates,
            row.total_listings,
            row.active_listings,
            row.for_sale_listings,
            row.for_rent_listings,
            row.avg_days_on_market,
            row.avg_listing_price,
          ])
        );
        downloadCsv(`${filePrefix}-listings.csv`, csv);
        return;
      }

      const csv = toCsv(
        ['Associate', 'Team', 'Market Centre', 'Listing Numbers', 'Total Listings', 'Active Listings', 'For Sale', 'For Rent', 'Avg Days On Market', 'Avg Listing Price'],
        sortedListingRows.map((row) => [
          row.associate_name,
          row.team_name,
          row.market_center_name,
          row.listing_numbers,
          row.total_listings,
          row.active_listings,
          row.for_sale_listings,
          row.for_rent_listings,
          row.avg_days_on_market,
          row.avg_listing_price,
        ])
      );
      downloadCsv(`${filePrefix}-listings.csv`, csv);
      return;
    }

    if (tab === 'production-summary') {
      const csv = toCsv(
        ['Market Centre', 'Contracts', 'Units', 'Total GCI', 'Company Dollar'],
        data.production.summary_by_market_center.map((row) => [
          row.market_center_name,
          row.contracts,
          row.units,
          row.total_gci,
          row.company_dollar,
        ])
      );
      downloadCsv(`${filePrefix}-production-summary.csv`, csv);
      return;
    }

    const csv = toCsv(
      ['Market Centre', 'Total Listings', 'Active Listings', 'For Sale', 'For Rent'],
      data.listings.summary_by_market_center.map((row) => [
        row.market_center_name,
        row.total_listings,
        row.active_listings,
        row.for_sale_listings,
        row.for_rent_listings,
      ])
    );
    downloadCsv(`${filePrefix}-listing-summary.csv`, csv);
  }

  const maxProductionSummaryValue = useMemo(() => {
    if (!data || data.production.summary_by_market_center.length === 0) return 0;
    return Math.max(...data.production.summary_by_market_center.map((row) => row.total_gci));
  }, [data]);

  const maxListingSummaryValue = useMemo(() => {
    if (!data || data.listings.summary_by_market_center.length === 0) return 0;
    return Math.max(...data.listings.summary_by_market_center.map((row) => row.total_listings));
  }, [data]);

  const totalProductionSummaryGci = useMemo(() => {
    if (!data) return 0;
    return data.production.summary_by_market_center.reduce((sum, row) => sum + row.total_gci, 0);
  }, [data]);

  const totalListingSummaryCount = useMemo(() => {
    if (!data) return 0;
    return data.listings.summary_by_market_center.reduce((sum, row) => sum + row.total_listings, 0);
  }, [data]);

  const scopedAssociates = useMemo(() => {
    let source = draftFilters.market_center_id
      ? options.associates.filter((associate) => associate.market_center_id === draftFilters.market_center_id)
      : options.associates;

    if (isTeamContext && draftFilters.team_id) {
      source = source.filter((associate) => associate.team_id === draftFilters.team_id);
    }

    return source
      .map((associate) => ({
        id: associate.id,
        name: associate.name,
        description: associate.market_center_name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options.associates, draftFilters.market_center_id, draftFilters.team_id, isTeamContext]);

  const scopedTeams = useMemo(() => {
    const source = draftFilters.market_center_id
      ? options.teams.filter((team) => team.market_center_id === draftFilters.market_center_id)
      : options.teams;
    return source
      .filter((team) => {
        const normalized = team.name.trim().toLowerCase();
        return normalized !== 'no team' && normalized !== 'unassigned / unknown team';
      })
      .map((team) => ({
        id: team.id,
        name: team.name,
        description: team.market_center_name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options.teams, draftFilters.market_center_id]);

  const selectedAssociateName = useMemo(
    () => scopedAssociates.find((associate) => associate.id === draftFilters.associate_id)?.name ?? '',
    [scopedAssociates, draftFilters.associate_id]
  );

  const selectedTeamName = useMemo(
    () => scopedTeams.find((team) => team.id === draftFilters.team_id)?.name ?? '',
    [scopedTeams, draftFilters.team_id]
  );

  const emptyStateHint = useMemo(() => {
    const hints: string[] = [];

    if (appliedFilters.associate_id && viewBy === 'agents') {
      hints.push('An agent filter is selected.');
    }
    if (appliedFilters.team_id && viewBy === 'teams') {
      hints.push('A team filter is selected.');
    }
    if (isTeamContext && viewBy === 'agents') {
      hints.push('Team context limits results to your team scope.');
    }
    if (appliedFilters.market_center_id) {
      hints.push('A market centre filter is active.');
    }
    if (appliedFilters.transaction_status.length > 0) {
      hints.push(`Transaction status is filtered to ${appliedFilters.transaction_status.join(', ')}.`);
    }
    if (appliedFilters.sale_type.length > 0) {
      hints.push(`Sale type is filtered to ${appliedFilters.sale_type.join(', ')}.`);
    }

    return hints.join(' ');
  }, [
    appliedFilters.associate_id,
    appliedFilters.team_id,
    appliedFilters.market_center_id,
    appliedFilters.transaction_status,
    appliedFilters.sale_type,
    isTeamContext,
    viewBy,
  ]);

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Top Down Performance"
        subtitle="Market Centre performance explorer with unified Agents and Teams views, role-scoped access, and CSV exports."
        context={`Production: ${appliedFilters.date_from} to ${appliedFilters.date_to} | Listings: ${appliedFilters.list_date_from} to ${appliedFilters.list_date_to}`}
        actions={
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <ReportKpiCard
              label="Production GCI"
              icon={<ReportIcon kind="wallet" className="h-3.5 w-3.5" />}
              value={formatMoney(data?.totals.production_gci ?? 0)}
            />
            <ReportKpiCard
              label="Contracts"
              icon={<ReportIcon kind="file-check" className="h-3.5 w-3.5" />}
              value={formatNumber(data?.totals.production_contracts ?? 0)}
            />
            <ReportKpiCard
              label="Listings"
              icon={<ReportIcon kind="home" className="h-3.5 w-3.5" />}
              value={formatNumber(data?.totals.listings_total ?? 0)}
            />
            <ReportKpiCard
              label="Active Listings"
              icon={<ReportIcon kind="check-circle" className="h-3.5 w-3.5" />}
              value={formatNumber(data?.totals.listings_active ?? 0)}
            />
          </div>
        }
      />

      <FilterPanel>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>View By</label>
            <select
              value={viewBy}
              disabled={isAgentOnlyContext}
              onChange={(event) => setViewBy(event.target.value === 'teams' ? 'teams' : 'agents')}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-80"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              <option value="agents">Agents</option>
              {!isAgentOnlyContext ? <option value="teams">Teams</option> : null}
            </select>
          </div>
          <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}>
            {isRegionalContext
              ? 'Regional context: market-centre and agent/team groupings are available.'
              : (isMarketCenterContext
                ? 'Market-centre context: default grouping is by agents/teams within your allowed market centre.'
                : (isTeamContext
                  ? 'Team context: team scope is locked and agent grouping is constrained to your team scope.'
                  : 'Agent context: showing your data only.'))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Production Date From</label>
            <input
              type="date"
              value={draftFilters.date_from}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, date_from: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Production Date To</label>
            <input
              type="date"
              value={draftFilters.date_to}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, date_to: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Listings Date From</label>
            <input
              type="date"
              value={draftFilters.list_date_from}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, list_date_from: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Listings Date To</label>
            <input
              type="date"
              value={draftFilters.list_date_to}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, list_date_to: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Market Centre</label>
            <select
              value={draftFilters.market_center_id}
              disabled={!isRegionalContext}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, market_center_id: event.target.value }))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-80"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              {isRegionalContext && <option value="">All</option>}
              {options.market_centers.map((marketCenter) => (
                <option key={marketCenter.id} value={marketCenter.id}>{marketCenter.name}</option>
              ))}
            </select>
          </div>

          <MultiSelectFilter
            label="Transaction Status"
            selected={draftFilters.transaction_status}
            onChange={(next) => setDraftFilters((prev) => ({ ...prev, transaction_status: next }))}
            options={options.transaction_statuses.map((status) => ({ value: status, label: status }))}
            allLabel="All"
          />

          <MultiSelectFilter
            label="Sale Type"
            selected={draftFilters.sale_type}
            onChange={(next) => setDraftFilters((prev) => ({ ...prev, sale_type: next }))}
            options={options.sale_types.map((value) => ({ value, label: value }))}
            allLabel="All"
          />

          <MultiSelectFilter
            label="Listing Status"
            selected={draftFilters.listing_status}
            onChange={(next) => setDraftFilters((prev) => ({ ...prev, listing_status: next }))}
            options={options.listing_statuses.map((value) => ({ value, label: value }))}
            allLabel="All"
          />

          <MultiSelectFilter
            label="Sale or Rent"
            selected={draftFilters.sale_or_rent}
            onChange={(next) => setDraftFilters((prev) => ({ ...prev, sale_or_rent: next }))}
            options={options.sale_or_rent_options.map((value) => ({ value, label: value }))}
            allLabel="All"
          />

          <MultiSelectFilter
            label="Mandate Type"
            selected={draftFilters.mandate_type}
            onChange={(next) => setDraftFilters((prev) => ({ ...prev, mandate_type: next }))}
            options={options.mandate_types.map((value) => ({ value, label: value }))}
            allLabel="All"
          />

          {viewBy === 'agents' ? (
            isAgentOnlyContext ? (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Agent Scope
                </label>
                <div
                  className="w-full rounded-md border px-2.5 py-2 text-sm"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
                >
                  Showing your data only
                </div>
              </div>
            ) : (
              <SearchableSelector
                label="Agent"
                placeholder="Search agent name..."
                options={scopedAssociates}
                selectedId={draftFilters.associate_id}
                onSelect={(id) => {
                  setDraftFilters((prev) => ({
                    ...prev,
                    associate_id: id,
                    associate_query: '',
                  }));
                }}
                allLabel={isTeamContext ? 'All agents in your team scope' : 'All agents in scope'}
              />
            )
          ) : (
            isAgentOnlyContext ? (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Team Scope
                </label>
                <div
                  className="w-full rounded-md border px-2.5 py-2 text-sm"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
                >
                  Showing your data only
                </div>
              </div>
            ) : isTeamManagerContext ? (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Team Scope
                </label>
                <div
                  className="w-full rounded-md border px-2.5 py-2 text-sm"
                  style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
                >
                  {selectedTeamName || 'Showing your team scope only'}
                </div>
              </div>
            ) : (
              <SearchableSelector
                label="Team"
                placeholder="Search team name..."
                options={scopedTeams}
                selectedId={draftFilters.team_id}
                onSelect={(id) => {
                  setDraftFilters((prev) => ({
                    ...prev,
                    team_id: id,
                    team_query: '',
                  }));
                }}
                allLabel="All teams in scope"
              />
            )
          )}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Selected Filter
            </label>
            <div
              className="w-full rounded-md border px-2.5 py-2 text-sm"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)', background: 'var(--surface-strong)' }}
            >
              {viewBy === 'agents'
                ? (selectedAssociateName || (isAgentOnlyContext ? 'Showing your data only' : 'All agents'))
                : (selectedTeamName || (isAgentOnlyContext ? 'Showing your data only' : 'All teams'))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={resetFiltersToDefaults}
            className="inline-flex h-[34px] items-center rounded-md border px-3 text-xs font-semibold"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
          >
            Clear to Defaults
          </button>
          <button
            type="button"
            onClick={() => setAppliedFilters(draftFilters)}
            className="inline-flex h-[34px] items-center rounded-md border px-3 text-xs font-semibold"
            style={{ borderColor: 'var(--brand-soft)', color: '#fff', background: 'var(--brand)' }}
          >
            Apply Filters
          </button>
          <button
            type="button"
            onClick={exportCurrentTabCsv}
            disabled={!data}
            className="inline-flex h-[34px] items-center rounded-md border px-3 text-xs font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)', background: 'var(--surface-strong)' }}
          >
            Export CSV
          </button>
        </div>
      </FilterPanel>

      <section className="surface-card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          {availableTabs.map((tabOption) => {
            const isActive = tab === tabOption.id;
            return (
              <button
                key={tabOption.id}
                type="button"
                onClick={() => setTab(tabOption.id as TabKey)}
                className="inline-flex rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: isActive ? 'var(--brand)' : 'var(--surface-strong)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                }}
              >
                {tabOption.label}
              </button>
            );
          })}
        </div>

        {isLoading ? <ReportState type="loading" message="Loading Top Down Performance report..." /> : null}
        {!isLoading && error ? <ReportState type="error" message={error} /> : null}

        {!isLoading && !error && !data ? <ReportState type="empty" message={`No report data is available for this selection.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} /> : null}

        {!isLoading && !error && data && tab === 'production' && (
          <div className="overflow-x-auto">
            {viewBy === 'teams' ? (
              <table className="min-w-[1200px] w-full">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('team_name')}>Team</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('market_center_name')}>Market Centre</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('active_associates')}>Active Associates</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('contracts')}>Contracts</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('units')}>Units</button></th>
                    <th className="px-4 py-2">Listings</th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('total_gci')}>Total GCI</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamProductionSort('company_dollar')}>Company Dollar</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeamProductionRows.map((row) => (
                    <tr key={`${row.mc_source_id}-${row.team_name}`} className="border-b text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="px-4 py-2">{row.team_name}</td>
                      <td className="px-4 py-2">{row.market_center_name}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.active_associates)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.contracts)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.units)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(listingsByTeamKey.get(`${row.team_name}::${row.mc_source_id}`) ?? 0)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.total_gci)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.company_dollar)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedTeamProductionRows.length > 0 ? (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                      <td className="px-4 py-2 text-sm font-bold text-white">TOTAL</td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamProductionTotals.active_associates)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamProductionTotals.contracts)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamProductionTotals.units)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.total_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(teamProductionTotals.total_gci)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(teamProductionTotals.company_dollar)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            ) : (
              <table className="min-w-[1100px] w-full">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('associate_name')}>Associate</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('team_name')}>Team</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('market_center_name')}>Market Centre</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('contracts')}>Contracts</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('units')}>Units</button></th>
                    <th className="px-4 py-2">Listings</th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('total_gci')}>Total GCI</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleProductionSort('company_dollar')}>Company Dollar</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProductionRows.map((row) => (
                    <tr key={`${row.source_associate_id}-${row.mc_source_id}`} className="border-b text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="px-4 py-2">{row.associate_name}</td>
                      <td className="px-4 py-2">{row.team_name}</td>
                      <td className="px-4 py-2">{row.market_center_name}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.contracts)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.units)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(listingsByAssociateKey.get(`${row.source_associate_id}::${row.mc_source_id}`) ?? 0)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.total_gci)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.company_dollar)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedProductionRows.length > 0 ? (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                      <td className="px-4 py-2 text-sm font-bold text-white">TOTAL</td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(productionTotals.contracts)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(productionTotals.units)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(listingTotals.total_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(productionTotals.total_gci)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(productionTotals.company_dollar)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            )}
            {viewBy === 'teams' && sortedTeamProductionRows.length === 0 && <ReportState type="empty" message={`No team production rows matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
            {viewBy === 'agents' && sortedProductionRows.length === 0 && <ReportState type="empty" message={`No production rows matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
          </div>
        )}

        {!isLoading && !error && data && tab === 'listings' && (
          <div className="overflow-x-auto">
            {viewBy === 'teams' ? (
              <table className="min-w-[1260px] w-full">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('team_name')}>Team</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('market_center_name')}>Market Centre</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('active_associates')}>Active Associates</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('total_listings')}>Total</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('active_listings')}>Active</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('for_sale_listings')}>For Sale</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('for_rent_listings')}>For Rent</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('avg_days_on_market')}>Avg DOM</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleTeamListingSort('avg_listing_price')}>Avg Price</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeamListingRows.map((row) => (
                    <tr key={`${row.mc_source_id}-${row.team_name}`} className="border-b text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="px-4 py-2">{row.team_name}</td>
                      <td className="px-4 py-2">{row.market_center_name}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.active_associates)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.total_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.active_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.for_sale_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.for_rent_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatDays(row.avg_days_on_market)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.avg_listing_price)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedTeamListingRows.length > 0 ? (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                      <td className="px-4 py-2 text-sm font-bold text-white">TOTAL</td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.active_associates)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.total_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.active_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.for_sale_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(teamListingTotals.for_rent_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatDays(teamListingTotals.avg_days_on_market)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(teamListingTotals.avg_listing_price)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            ) : (
              <table className="min-w-[1200px] w-full">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('associate_name')}>Associate</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('team_name')}>Team</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('market_center_name')}>Market Centre</button></th>
                    <th className="px-4 py-2">Listing Numbers</th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('total_listings')}>Total</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('active_listings')}>Active</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('for_sale_listings')}>For Sale</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('for_rent_listings')}>For Rent</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('avg_days_on_market')}>Avg DOM</button></th>
                    <th className="px-4 py-2"><button type="button" onClick={() => toggleListingSort('avg_listing_price')}>Avg Price</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListingRows.map((row) => (
                    <tr key={`${row.source_associate_id}-${row.mc_source_id}`} className="border-b text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                      <td className="px-4 py-2">{row.associate_name}</td>
                      <td className="px-4 py-2">{row.team_name}</td>
                      <td className="px-4 py-2">{row.market_center_name}</td>
                      <td className="px-4 py-2">{row.listing_numbers || '—'}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.total_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.active_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.for_sale_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatNumber(row.for_rent_listings)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatDays(row.avg_days_on_market)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(row.avg_listing_price)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedListingRows.length > 0 ? (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-soft)', background: 'var(--ink-dark)' }}>
                      <td className="px-4 py-2 text-sm font-bold text-white">TOTAL</td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold text-white"></td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(listingTotals.total_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(listingTotals.active_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(listingTotals.for_sale_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatNumber(listingTotals.for_rent_listings)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatDays(listingTotals.avg_days_on_market)}</td>
                      <td className="px-4 py-2 text-sm font-bold tabular-nums text-white">{formatMoney(listingTotals.avg_listing_price)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            )}
            {viewBy === 'teams' && sortedTeamListingRows.length === 0 && <ReportState type="empty" message={`No team listing rows matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
            {viewBy === 'agents' && sortedListingRows.length === 0 && <ReportState type="empty" message={`No listing rows matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
          </div>
        )}

        {!isLoading && !error && data && tab === 'production-summary' && (
          <div className="space-y-2 px-4 py-4">
            {data.production.summary_by_market_center.map((row) => {
              const width = maxProductionSummaryValue > 0 ? (row.total_gci / maxProductionSummaryValue) * 100 : 0;
              const share = totalProductionSummaryGci > 0 ? (row.total_gci / totalProductionSummaryGci) * 100 : 0;
              return (
                <div key={row.mc_source_id || row.market_center_name} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{row.market_center_name}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatMoney(row.total_gci)} ({share.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--surface-strong)' }}>
                    <div className="h-2 rounded-full" style={{ width: `${width}%`, background: 'var(--brand)' }} />
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Contracts {formatNumber(row.contracts)} | Units {formatNumber(row.units)} | Company Dollar {formatMoney(row.company_dollar)}
                  </div>
                </div>
              );
            })}
            {data.production.summary_by_market_center.length === 0 && <ReportState type="empty" message={`No production summary data matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
          </div>
        )}

        {!isLoading && !error && data && tab === 'listing-summary' && (
          <div className="space-y-2 px-4 py-4">
            {data.listings.summary_by_market_center.map((row) => {
              const width = maxListingSummaryValue > 0 ? (row.total_listings / maxListingSummaryValue) * 100 : 0;
              const share = totalListingSummaryCount > 0 ? (row.total_listings / totalListingSummaryCount) * 100 : 0;
              return (
                <div key={row.mc_source_id || row.market_center_name} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{row.market_center_name}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatNumber(row.total_listings)} ({share.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--surface-strong)' }}>
                    <div className="h-2 rounded-full" style={{ width: `${width}%`, background: 'var(--brand)' }} />
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Active {formatNumber(row.active_listings)} | For Sale {formatNumber(row.for_sale_listings)} | For Rent {formatNumber(row.for_rent_listings)}
                  </div>
                </div>
              );
            })}
            {data.listings.summary_by_market_center.length === 0 && <ReportState type="empty" message={`No listing summary data matched your filters.${emptyStateHint ? ` ${emptyStateHint}` : ''}`} />}
          </div>
        )}
      </section>
    </div>
  );
}
