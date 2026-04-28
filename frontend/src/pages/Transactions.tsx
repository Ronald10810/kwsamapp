import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type TransactionAgent = {
  associate_id: number | null;
  associate_name: string | null;
  image_url: string | null;
  source_associate_id: string | null;
  agent_role: string | null;
  split_percentage: number | null;
  summary?: {
    office_name: string | null;
    transaction_type: string | null;
    split_percentage: string | null;
    variance_sale_list_pct: string | null;
    transaction_gci_before_fees: string | null;
    average_commission_pct: string | null;
    production_royalties: string | null;
    growth_share: string | null;
    total_pr_and_gs: string | null;
    gci_after_fees_excl_vat: string | null;
    associate_dollar: string | null;
    cap_amount: string | null;
    cap_remaining: string | null;
    team_dollar: string | null;
    market_center_dollar: string | null;
    is_outside_agent: boolean;
  };
};

type TransactionRow = {
  id: string;
  source_transaction_id: string;
  transaction_number: string | null;
  agents: TransactionAgent[];
  source_market_center_id?: string | null;
  transaction_status: string | null;
  transaction_type: string | null;
  listing_number: string | null;
  source_listing_id: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  sales_price: string | null;
  list_price: string | null;
  gci_excl_vat: string | null;
  net_comm: string | null;
  total_gci: string | null;
  sale_type: string | null;
  buyer: string | null;
  seller: string | null;
  list_date: string | null;
  transaction_date: string | null;
  status_change_date: string | null;
  expected_date: string | null;
  created_at?: string | null;
  market_center_name: string | null;
  updated_at: string;
};

type TransactionsResponse = {
  total: number;
  limit: number;
  offset: number;
  items: TransactionRow[];
};

type TransactionsSummaryResponse = {
  totals: {
    total_transactions: number;
    total_sales_value: number;
    total_net_commission: number;
    average_split_percentage: number;
  };
  mtd_registered_active: {
    total_transactions: number;
    total_sales_value: number;
    total_net_commission: number;
    average_split_percentage: number;
  };
  by_status: Array<{ label: string; count: number }>;
  by_type: Array<{ label: string; count: number }>;
  market_center_performance: Array<{
    market_center: string;
    total_transactions: number;
    total_sales_value: number;
    total_net_commission: number;
    total_gci: number;
  }>;
  associate_performance: Array<{
    associate_name: string;
    market_center: string;
    total_transactions: number;
    total_sales_value: number;
    total_gci: number;
  }>;
  expected_closings_90_days: Array<{ bucket: string; count: number; total_gci: number }>;
  reporting_window?: {
    start_date: string;
    end_date: string;
    basis: 'registered' | 'allStatuses';
  } | null;
  performance_basis?: 'registered' | 'allStatuses';
};

type OutsideAgencyContact = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  agency_name: string;
};

type ListingSearchResult = {
  id: string;
  source_listing_id: string;
  listing_number: string;
  address: string | null;
  suburb: string | null;
  city: string | null;
  list_price: string | null;
};

type ListingSearchResponse = { items: ListingSearchResult[] };

type TransactionFormAgent = {
  source_associate_id: string;
  associate_name: string;
  agent_role: string;
  split_percentage: string;
  outside_agency: OutsideAgencyContact;
};

type TransactionFormState = {
  source_transaction_id: string;
  transaction_number: string;
  transaction_status: string;
  transaction_type: string;
  source_listing_id: string;
  listing_number: string;
  address: string;
  suburb: string;
  city: string;
  sales_price: string;
  list_price: string;
  net_comm: string;
  total_gci: string;
  transaction_date: string;
  expected_date: string;
  agents: TransactionFormAgent[];
};

type TransactionEditTab = 'details' | 'parties' | 'documents' | 'notes' | 'emails' | 'summary';

type AgentOption = {
  source_associate_id: string;
  full_name: string | null;
  source_market_center_id: string | null;
  market_center_name: string | null;
};

type AgentOptionsResponse = {
  items: AgentOption[];
};

const TRANSACTION_STATUSES = [
  'Start',
  'Working',
  'Submitted',
  'Registered',
  'Accepted',
  'Rejected',
  'Withdrawn',
  'Pending',
];

const AGENT_ROLES = ['Seller', 'Buyer', 'Both', 'PC', 'Outside Agency Referral', 'Other'] as const;

function getRoleOptions(currentRole: string): string[] {
  if (!currentRole) return [...AGENT_ROLES];
  return AGENT_ROLES.includes(currentRole as (typeof AGENT_ROLES)[number])
    ? [...AGENT_ROLES]
    : [currentRole, ...AGENT_ROLES];
}

const PAGE_SIZE = 25;
type TransactionsView = 'summary' | 'register';
type RegisterSortKey =
  | 'transaction'
  | 'associate'
  | 'market_center'
  | 'type'
  | 'status'
  | 'created_date'
  | 'status_change_date'
  | 'sales_price'
  | 'net_comm';
type SortDirection = 'asc' | 'desc';

function toMoney(val: string | null): string {
  if (!val) return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

function toShortDate(val: string | null): string {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
}

function toNumberOrZero(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function buildEmptyOutsideAgency(): OutsideAgencyContact {
  return { first_name: '', last_name: '', email: '', phone: '', agency_name: '' };
}

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<TransactionsView>('summary');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<TransactionEditTab>('details');
  const [quickSummaryRow, setQuickSummaryRow] = useState<TransactionRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [registerSortKey, setRegisterSortKey] = useState<RegisterSortKey>('status_change_date');
  const [registerSortDirection, setRegisterSortDirection] = useState<SortDirection>('desc');
  const [listingSearchQuery, setListingSearchQuery] = useState('');
  const [listingSearchOpen, setListingSearchOpen] = useState(false);
  const [form, setForm] = useState<TransactionFormState>({
    source_transaction_id: '',
    transaction_number: '',
    transaction_status: 'Registered',
    transaction_type: '',
    source_listing_id: '',
    listing_number: '',
    address: '',
    suburb: '',
    city: '',
    sales_price: '',
    list_price: '',
    net_comm: '',
    total_gci: '',
    transaction_date: '',
    expected_date: '',
    agents: [],
  });

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['transactions', page, search, status],
    queryFn: () => {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      if (status.trim()) params.set('status', status.trim());

      return fetch(`/api/transactions?${params.toString()}`).then(async (r) => {
        if (!r.ok) {
          throw new Error('Unable to load transactions');
        }
        return r.json() as Promise<TransactionsResponse>;
      });
    },
    placeholderData: (prev) => prev,
  });

  const { data: summaryData, isLoading: isSummaryLoading, isError: isSummaryError } = useQuery({
    queryKey: ['transactions-summary'],
    queryFn: () =>
      fetch('/api/transactions/summary').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load transactions summary');
        return r.json() as Promise<TransactionsSummaryResponse>;
      }),
  });

  const { data: agentOptionsData } = useQuery({
    queryKey: ['agent-options'],
    queryFn: () =>
      fetch('/api/agents/options').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load agent options');
        return r.json() as Promise<AgentOptionsResponse>;
      }),
  });

  const { refetch: refetchNextNumber } = useQuery({
    queryKey: ['transactions-next-number'],
    queryFn: () =>
      fetch('/api/transactions/next-number').then(async (r) => {
        if (!r.ok) throw new Error('Unable to fetch next transaction number');
        return r.json() as Promise<{ next_transaction_number: string }>;
      }),
    enabled: false,
  });

  const { data: listingSearchData } = useQuery({
    queryKey: ['listing-search', listingSearchQuery],
    queryFn: () =>
      fetch(`/api/listings/search?q=${encodeURIComponent(listingSearchQuery)}`).then(r => r.json() as Promise<ListingSearchResponse>),
    enabled: listingSearchQuery.length >= 2,
    staleTime: 30000,
  });

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data?.total]);

  const filteredItems = useMemo(() => {
    return data?.items ?? [];
  }, [data?.items]);

  const sortedItems = useMemo(() => {
    const rows = [...filteredItems];

    const compareText = (left: string | null | undefined, right: string | null | undefined): number =>
      (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base', numeric: true });

    const compareDate = (left: string | null | undefined, right: string | null | undefined): number => {
      const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    };

    const compareNumber = (left: string | null | undefined, right: string | null | undefined): number =>
      toNumberOrZero(left) - toNumberOrZero(right);

    rows.sort((a, b) => {
      let result = 0;
      switch (registerSortKey) {
        case 'transaction':
          result = compareText(a.transaction_number ?? a.source_transaction_id, b.transaction_number ?? b.source_transaction_id);
          break;
        case 'associate':
          result = compareText(
            a.agents.length > 0 ? a.agents[0].associate_name : '',
            b.agents.length > 0 ? b.agents[0].associate_name : ''
          );
          break;
        case 'market_center':
          result = compareText(a.market_center_name, b.market_center_name);
          break;
        case 'type':
          result = compareText(a.transaction_type, b.transaction_type);
          break;
        case 'status':
          result = compareText(a.transaction_status, b.transaction_status);
          break;
        case 'created_date':
          result = compareDate(a.transaction_date ?? a.created_at, b.transaction_date ?? b.created_at);
          break;
        case 'status_change_date':
          result = compareDate(a.status_change_date, b.status_change_date);
          break;
        case 'sales_price':
          result = compareNumber(a.sales_price, b.sales_price);
          break;
        case 'net_comm':
          result = compareNumber(a.net_comm, b.net_comm);
          break;
      }

      if (result === 0) {
        result = compareText(a.id, b.id);
      }

      return registerSortDirection === 'asc' ? result : -result;
    });

    return rows;
  }, [filteredItems, registerSortDirection, registerSortKey]);

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const periodLabel = summaryData?.reporting_window
    ? `${new Date(summaryData.reporting_window.start_date).toLocaleDateString()} - ${new Date(summaryData.reporting_window.end_date).toLocaleDateString()}`
    : (() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return `${monthStart.toLocaleDateString()} - ${now.toLocaleDateString()}`;
      })();
  const performanceBasis = summaryData?.performance_basis ?? summaryData?.reporting_window?.basis ?? 'registered';
  const performanceLabel =
    performanceBasis === 'allStatuses'
      ? 'All Statuses This Month (Active Market Centres + Active Associates)'
      : 'Registered MTD (Active Market Centres + Active Associates)';

  function toInputDate(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function openCreateForm(): void {
    const today = new Date().toISOString().slice(0, 10);
    const threeMonths = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setEditingId(null);
    setFormError(null);
    setListingSearchQuery('');
    setListingSearchOpen(false);
    setForm({
      source_transaction_id: '',
      transaction_number: '',
      transaction_status: 'Registered',
      transaction_type: '',
      source_listing_id: '',
      listing_number: '',
      address: '',
      suburb: '',
      city: '',
      sales_price: '',
      list_price: '',
      net_comm: '',
      total_gci: '',
      transaction_date: today,
      expected_date: threeMonths,
      agents: [],
    });
    setIsFormOpen(true);
    setEditTab('details');
    void refetchNextNumber().then((result) => {
      const next = result.data?.next_transaction_number;
      if (next) {
        setForm((prev) => ({ ...prev, transaction_number: next }));
      }
    });
  }

  function openEditForm(item: TransactionRow): void {
    setEditingId(item.id);
    setFormError(null);
    setListingSearchQuery('');
    setListingSearchOpen(false);
    setForm({
      source_transaction_id: item.source_transaction_id,
      transaction_number: item.transaction_number ?? '',
      transaction_status: item.transaction_status ?? '',
      transaction_type: item.transaction_type ?? '',
      source_listing_id: item.source_listing_id ?? '',
      listing_number: item.listing_number ?? '',
      address: item.address ?? '',
      suburb: item.suburb ?? '',
      city: item.city ?? '',
      sales_price: item.sales_price ?? '',
      list_price: item.list_price ?? '',
      net_comm: item.net_comm ?? '',
      total_gci: item.total_gci ?? '',
      transaction_date: toInputDate(item.transaction_date),
      expected_date: toInputDate(item.expected_date),
      agents: (item.agents ?? []).map((a) => ({
        source_associate_id: a.source_associate_id ?? '',
        associate_name: a.associate_name ?? '',
        agent_role: a.agent_role ?? a.summary?.transaction_type ?? item.transaction_type ?? '',
        split_percentage: a.split_percentage ? String(a.split_percentage) : '',
        outside_agency: buildEmptyOutsideAgency(),
      })),
    });
    setIsFormOpen(true);
    setEditTab('details');
  }

  async function saveTransaction(): Promise<void> {
    setIsSaving(true);
    setFormError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/transactions/${editingId}` : '/api/transactions';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          agents: form.agents.filter((a) => a.source_associate_id),
        }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Failed to save transaction');
      }
      setIsFormOpen(false);
      await refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save transaction');
    } finally {
      setIsSaving(false);
    }
  }

  function addAgent(): void {
    setForm((prev) => {
      const newCount = prev.agents.length + 1;
      const evenSplit = (100 / newCount).toFixed(2);
      const emptyOA = buildEmptyOutsideAgency();
      const updated = prev.agents.map((a) => ({ ...a, split_percentage: evenSplit }));
      return {
        ...prev,
        agents: [...updated, { source_associate_id: '', associate_name: '', agent_role: '', split_percentage: evenSplit, outside_agency: emptyOA }],
      };
    });
  }

  function removeAgent(index: number): void {
    setForm((prev) => {
      const remaining = prev.agents.filter((_, i) => i !== index);
      if (remaining.length === 0) return { ...prev, agents: [] };
      const evenSplit = (100 / remaining.length).toFixed(2);
      return { ...prev, agents: remaining.map((a) => ({ ...a, split_percentage: evenSplit })) };
    });
  }

  function updateAgent(index: number, field: keyof TransactionFormAgent, value: string): void {
    setForm((prev) => {
      const updated = [...prev.agents];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'source_associate_id') {
        const selected = (agentOptionsData?.items ?? []).find((x) => x.source_associate_id === value);
        if (selected) {
          updated[index].associate_name = selected.full_name ?? value;
        }
      }
      return { ...prev, agents: updated };
    });
  }

  function updateOutsideAgency(index: number, field: keyof OutsideAgencyContact, value: string): void {
    setForm((prev) => {
      const updated = [...prev.agents];
      updated[index] = { ...updated[index], outside_agency: { ...updated[index].outside_agency, [field]: value } };
      return { ...prev, agents: updated };
    });
  }

  function selectListing(listing: ListingSearchResult): void {
    setForm((prev) => ({
      ...prev,
      source_listing_id: listing.source_listing_id,
      listing_number: listing.listing_number,
      address: listing.address ?? prev.address,
      suburb: listing.suburb ?? prev.suburb,
      city: listing.city ?? prev.city,
      list_price: listing.list_price ?? prev.list_price,
    }));
    setListingSearchQuery(listing.listing_number);
    setListingSearchOpen(false);
  }

  const currentEditingRow = editingId ? (data?.items ?? []).find((x) => x.id === editingId) : null;
  const calculatedAgents = (currentEditingRow?.agents ?? []).filter((agent) => Boolean(agent.summary));

  function toggleRegisterSort(key: RegisterSortKey): void {
    if (registerSortKey === key) {
      setRegisterSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    const defaultDirection: SortDirection =
      key === 'created_date' || key === 'status_change_date' || key === 'sales_price' || key === 'net_comm'
        ? 'desc'
        : 'asc';
    setRegisterSortKey(key);
    setRegisterSortDirection(defaultDirection);
  }

  function sortIndicator(key: RegisterSortKey): string {
    if (registerSortKey !== key) return '↕';
    return registerSortDirection === 'asc' ? '↑' : '↓';
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="mt-0.5 text-sm text-slate-500">Manage transaction records and monitor pipeline performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-chip info">{(data?.total ?? 0).toLocaleString()} total</span>
          <button className="primary-btn" type="button" onClick={() => refetch()}>
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="primary-btn" type="button" onClick={openCreateForm}>
            Add Transaction
          </button>
        </div>
      </div>

      <section className="surface-card p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('summary')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${view === 'summary' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setView('register')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${view === 'register' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Transaction Register
          </button>
        </div>
      </section>

      {/* Transaction Workspace Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">

            {/* Modal Header */}
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Transaction Workspace</p>
                <h2 className="text-2xl font-semibold text-slate-900 flex items-center gap-3">
                  {form.transaction_number ? (
                    <span className="rounded-md bg-red-50 px-2 py-0.5 text-base font-bold text-red-700 border border-red-200">{form.transaction_number}</span>
                  ) : (
                    <span className="text-slate-400 text-base">Number auto-generated on save</span>
                  )}
                  {form.address ? ` - ${form.address}` : currentEditingRow ? 'Edit Transaction' : 'New Transaction'}
                </h2>
                {form.transaction_status && (
                  <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{form.transaction_status}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" type="button" onClick={() => setIsFormOpen(false)}>Cancel</button>
                <button className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button">
                  Feed to Frontdoor
                </button>
                <button className="primary-btn" type="button" onClick={() => void saveTransaction()} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Body: sidebar + content */}
            <div className="flex min-h-0 flex-1">

              {/* Sidebar Navigation */}
              <aside className="w-56 border-r border-slate-200 bg-slate-50 p-3 space-y-1 shrink-0">
                {([
                  ['details', 'Transaction Details'],
                  ['parties', 'Transaction Parties'],
                  ['documents', 'Documents'],
                  ['notes', 'Notes'],
                  ['emails', 'Email History'],
                  ['summary', 'Summary'],
                ] as [TransactionEditTab, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setEditTab(key)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${editTab === key ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </aside>

              {/* Content Panel */}
              <div className="flex-1 overflow-auto p-6 space-y-6">
                {formError && <p className="text-sm text-amber-700 rounded-lg bg-amber-50 p-3 border border-amber-200">{formError}</p>}

                {editTab === 'details' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Details</h3>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-slate-700">Transaction Information</h4>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Source Transaction ID</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source transaction ID" value={form.source_transaction_id} onChange={(e) => setForm((p) => ({ ...p, source_transaction_id: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Number</span>
                          <input className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" placeholder="Auto-generated on save" value={form.transaction_number} readOnly />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Status</span>
                          <select
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={form.transaction_status}
                            onChange={(e) => setForm((p) => ({ ...p, transaction_status: e.target.value }))}
                          >
                            {TRANSACTION_STATUSES.map((sv) => (
                              <option key={sv} value={sv}>{sv}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Type</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Type" value={form.transaction_type} onChange={(e) => setForm((p) => ({ ...p, transaction_type: e.target.value }))} />
                        </label>
                        <div className="flex flex-col gap-1 relative lg:col-span-2">
                          <span className="text-xs font-medium text-slate-600">Listing</span>
                          <input
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Search by listing number, address or suburb..."
                            value={listingSearchQuery}
                            onChange={(e) => { setListingSearchQuery(e.target.value); setListingSearchOpen(true); }}
                            onFocus={() => { if (listingSearchQuery.length >= 2) setListingSearchOpen(true); }}
                            onBlur={() => setTimeout(() => setListingSearchOpen(false), 150)}
                            autoComplete="off"
                          />
                          {listingSearchOpen && (listingSearchData?.items ?? []).length > 0 && (
                            <ul className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm">
                              {(listingSearchData?.items ?? []).map((item) => (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50"
                                    onMouseDown={() => selectListing(item)}
                                  >
                                    <span className="font-medium text-slate-800">{item.listing_number}</span>
                                    {item.address && <span className="ml-2 text-slate-500">{item.address}{item.suburb ? `, ${item.suburb}` : ''}</span>}
                                    {item.list_price && <span className="ml-2 text-green-700 font-medium">{toMoney(item.list_price)}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {form.listing_number && (
                            <p className="text-xs text-slate-500">Selected: <span className="font-medium">{form.listing_number}</span>{form.source_listing_id ? ` (ID: ${form.source_listing_id})` : ''}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-slate-700 border-t pt-4">Property Details</h4>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Address</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Address" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Suburb</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Suburb" value={form.suburb} onChange={(e) => setForm((p) => ({ ...p, suburb: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">City</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="City" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
                        </label>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-slate-700 border-t pt-4">Financial Details</h4>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Sales Price</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Sales price" value={form.sales_price} onChange={(e) => setForm((p) => ({ ...p, sales_price: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">List Price</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="List price" value={form.list_price} onChange={(e) => setForm((p) => ({ ...p, list_price: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Net Commission</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Net commission" value={form.net_comm} onChange={(e) => setForm((p) => ({ ...p, net_comm: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Total GCI</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Total GCI" value={form.total_gci} onChange={(e) => setForm((p) => ({ ...p, total_gci: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Date</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={form.transaction_date} onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Expected Date</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={form.expected_date} onChange={(e) => setForm((p) => ({ ...p, expected_date: e.target.value }))} />
                        </label>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-700">Transaction Agents</h4>
                        <button type="button" onClick={addAgent} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                          + Add Agent
                        </button>
                      </div>
                      {form.agents.length === 0 ? (
                        <p className="text-sm text-slate-500">No agents added yet. Click + Add Agent to proceed.</p>
                      ) : (
                        <div className="space-y-3">
                          {(() => {
                            const totalSplit = form.agents.reduce((sum, a) => sum + (parseFloat(a.split_percentage) || 0), 0);
                            const splitOk = Math.abs(totalSplit - 100) < 0.05;
                            return (
                              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${splitOk ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                                <span>Total Split: {totalSplit.toFixed(2)}%</span>
                                {!splitOk && <span className="text-xs">Must equal 100%</span>}
                                {splitOk && <span className="text-xs">Valid</span>}
                              </div>
                            );
                          })()}
                          {form.agents.map((agent, idx) => (
                            <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                              <div className="flex items-end gap-2">
                                <label className="flex-1 flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Agent Name</span>
                                  <select
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    value={agent.source_associate_id}
                                    onChange={(e) => updateAgent(idx, 'source_associate_id', e.target.value)}
                                  >
                                    <option value="">Select agent</option>
                                    {(agentOptionsData?.items ?? []).map((opt) => (
                                      <option key={opt.source_associate_id} value={opt.source_associate_id}>
                                        {(opt.full_name ?? opt.source_associate_id) + (opt.market_center_name ? ` - ${opt.market_center_name}` : '')}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex-1 flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Role</span>
                                  <select
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    value={agent.agent_role}
                                    onChange={(e) => updateAgent(idx, 'agent_role', e.target.value)}
                                  >
                                    <option value="">Select role</option>
                                    {getRoleOptions(agent.agent_role).map((r) => (
                                      <option key={r} value={r}>{r}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="w-28 flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Split %</span>
                                  <input type="number" step="0.01" min="0" max="100" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="0.00" value={agent.split_percentage} onChange={(e) => updateAgent(idx, 'split_percentage', e.target.value)} />
                                </label>
                                <button type="button" onClick={() => removeAgent(idx)} className="rounded-lg bg-red-50 px-2 py-2 text-sm font-medium text-red-600 hover:bg-red-100">
                                  Remove
                                </button>
                              </div>
                              {agent.agent_role === 'Outside Agency Referral' && (
                                <div className="grid grid-cols-2 gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                                  <p className="col-span-2 text-xs font-semibold text-amber-900">Outside Agency Details</p>
                                  <input className="rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="First Name" value={agent.outside_agency.first_name} onChange={(e) => updateOutsideAgency(idx, 'first_name', e.target.value)} />
                                  <input className="rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="Last Name" value={agent.outside_agency.last_name} onChange={(e) => updateOutsideAgency(idx, 'last_name', e.target.value)} />
                                  <input className="rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="Email" type="email" value={agent.outside_agency.email} onChange={(e) => updateOutsideAgency(idx, 'email', e.target.value)} />
                                  <input className="rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="Phone" value={agent.outside_agency.phone} onChange={(e) => updateOutsideAgency(idx, 'phone', e.target.value)} />
                                  <input className="col-span-2 rounded-lg border border-amber-300 px-3 py-2 text-sm" placeholder="Agency Name" value={agent.outside_agency.agency_name} onChange={(e) => updateOutsideAgency(idx, 'agency_name', e.target.value)} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {editTab === 'parties' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Parties</h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="text-base font-semibold">Agents</h4>
                        <p className="mt-3 text-sm text-slate-500">
                          {form.agents.length > 0 ? form.agents.map(a => a.associate_name).filter(Boolean).join(', ') : 'No agents linked'}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Manage agents in the Transaction Details tab.</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="text-base font-semibold">Contacts</h4>
                        <p className="mt-3 text-sm text-slate-500">Buyer: {currentEditingRow?.buyer ?? '-'}</p>
                        <p className="text-sm text-slate-500">Seller: {currentEditingRow?.seller ?? '-'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {editTab === 'documents' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Documents</h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">Drag and drop file here or click</div>
                      <div className="rounded-xl border border-slate-200 p-6 text-slate-500">OTP Document area</div>
                    </div>
                  </div>
                )}

                {editTab === 'notes' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Notes</h3>
                    <textarea className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-700" rows={8} placeholder="Add notes about this transaction..." />
                  </div>
                )}

                {editTab === 'emails' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Email History</h3>
                    <p className="text-sm text-slate-500">No email history available for this transaction.</p>
                  </div>
                )}

                {editTab === 'summary' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Summary</h3>
                    {currentEditingRow && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Summary values are calculated and saved by the backend. Save the transaction to refresh this view.
                      </div>
                    )}
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Agent Name</th>
                            <th className="px-4 py-3 font-semibold">Office Name</th>
                            <th className="px-4 py-3 font-semibold">Transaction Type</th>
                            <th className="px-4 py-3 font-semibold">Split %</th>
                            <th className="px-4 py-3 font-semibold">Variance %</th>
                            <th className="px-4 py-3 font-semibold">GCI Before Fees</th>
                            <th className="px-4 py-3 font-semibold">Avg Comm %</th>
                            <th className="px-4 py-3 font-semibold">PR</th>
                            <th className="px-4 py-3 font-semibold">GS</th>
                            <th className="px-4 py-3 font-semibold">Total PR+GS</th>
                            <th className="px-4 py-3 font-semibold">GCI After Fees</th>
                            <th className="px-4 py-3 font-semibold">Associate $</th>
                            <th className="px-4 py-3 font-semibold">Cap Amount</th>
                            <th className="px-4 py-3 font-semibold">Cap Remaining</th>
                            <th className="px-4 py-3 font-semibold">Team $</th>
                            <th className="px-4 py-3 font-semibold">Market Centre $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                          {calculatedAgents.map((agent, index) => (
                            <tr key={`${agent.source_associate_id || agent.associate_name}-${index}`}>
                              <td className="px-4 py-3 text-slate-900">{agent.associate_name ?? '-'}</td>
                              <td className="px-4 py-3">{agent.summary?.office_name ?? currentEditingRow?.market_center_name ?? '-'}</td>
                              <td className="px-4 py-3">{agent.summary?.transaction_type ?? '-'}</td>
                              <td className="px-4 py-3">{toPercent(Number(agent.summary?.split_percentage ?? 0))}</td>
                              <td className="px-4 py-3">{toPercent(Number(agent.summary?.variance_sale_list_pct ?? 0))}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.transaction_gci_before_fees ?? '0')}</td>
                              <td className="px-4 py-3">{toPercent(Number(agent.summary?.average_commission_pct ?? 0))}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.production_royalties ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.growth_share ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.total_pr_and_gs ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.gci_after_fees_excl_vat ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.associate_dollar ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.cap_amount ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.cap_remaining ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.team_dollar ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(agent.summary?.market_center_dollar ?? '0')}</td>
                            </tr>
                          ))}
                          {calculatedAgents.length === 0 && (
                            <tr>
                              <td className="px-4 py-4 text-slate-500" colSpan={16}>
                                No calculated summary rows available yet. Save or re-import transactions and run the transaction calculation backfill.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'summary' && (
        <section className="space-y-4">
          <div className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">{performanceLabel}</h3>
              <span className="text-xs text-slate-500">Window: {periodLabel}</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Transactions</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : (summaryData?.mtd_registered_active.total_transactions ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Sales Value</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : toMoney(String(summaryData?.mtd_registered_active.total_sales_value ?? 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Net Commission</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : toMoney(String(summaryData?.mtd_registered_active.total_net_commission ?? 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Average Split</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : `${(summaryData?.mtd_registered_active.average_split_percentage ?? 0).toFixed(2)}%`}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">Top Market Centres This Month</h3>
              <div className="mt-3 space-y-2">
                {(summaryData?.market_center_performance ?? []).map((row, index) => (
                  <div key={`${row.market_center}-${index}`} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="col-span-5 truncate text-sm text-slate-700"><span className="mr-1 text-slate-400">#{index + 1}</span>{row.market_center}</span>
                    <span className="col-span-2 text-xs text-slate-600">{row.total_transactions.toLocaleString()} tx</span>
                    <span className="col-span-3 text-sm font-semibold text-slate-900">{toMoney(String(row.total_gci))}</span>
                    <span className="col-span-2 text-[11px] text-slate-500">Net {toMoney(String(row.total_net_commission))}</span>
                  </div>
                ))}
                {!isSummaryLoading && (summaryData?.market_center_performance.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No market centre data in this month window.</p>
                )}
              </div>
            </div>

            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">Top 10 Associates This Month</h3>
              <div className="mt-3 space-y-2">
                {(summaryData?.associate_performance ?? []).map((row, index) => (
                  <div key={`${row.associate_name}-${index}`} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="col-span-5 truncate text-sm text-slate-700"><span className="mr-1 text-slate-400">#{index + 1}</span>{row.associate_name}</span>
                    <span className="col-span-3 truncate text-xs text-slate-600">{row.market_center}</span>
                    <span className="col-span-2 text-xs text-slate-600">{row.total_transactions.toLocaleString()} tx</span>
                    <span className="col-span-2 text-sm font-semibold text-slate-900">{toMoney(String(row.total_gci))}</span>
                  </div>
                ))}
                {!isSummaryLoading && (summaryData?.associate_performance.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No associate data in this month window.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Transactions</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : (summaryData?.totals.total_transactions ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Sales Value</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : toMoney(String(summaryData?.totals.total_sales_value ?? 0))}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Net Commission</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : toMoney(String(summaryData?.totals.total_net_commission ?? 0))}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Average Split</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : `${(summaryData?.totals.average_split_percentage ?? 0).toFixed(2)}%`}
              </p>
            </div>
          </div>

          {isSummaryError && (
            <div className="surface-card p-4 text-amber-700">Could not load summary metrics.</div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">By Status</h3>
              <div className="mt-3 space-y-2">
                {(summaryData?.by_status ?? []).map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-700">{row.label}</span>
                    <span className="status-chip info">{row.count.toLocaleString()}</span>
                  </div>
                ))}
                {!isSummaryLoading && (summaryData?.by_status.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No status data available.</p>
                )}
              </div>
            </div>

            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">By Transaction Type</h3>
              <div className="mt-3 space-y-2">
                {(summaryData?.by_type ?? []).map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-700">{row.label}</span>
                    <span className="status-chip info">{row.count.toLocaleString()}</span>
                  </div>
                ))}
                {!isSummaryLoading && (summaryData?.by_type.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No type data available.</p>
                )}
              </div>
            </div>
          </div>

          <div className="surface-card p-4">
            <h3 className="text-sm font-semibold text-slate-900">Expected Closings (Next 120 Days)</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(summaryData?.expected_closings_90_days ?? []).map((row) => (
                <div key={row.bucket} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">{row.bucket}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{row.count.toLocaleString()} units</p>
                  <p className="mt-1 text-xs text-slate-600">Total GCI: {toMoney(String(row.total_gci ?? 0))}</p>
                </div>
              ))}
              {!isSummaryLoading && (summaryData?.expected_closings_90_days.length ?? 0) === 0 && (
                <p className="text-sm text-slate-500">No expected closings in next 90 days.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'register' && (
      <section className="surface-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search transaction, listing, market centre, agent, suburb, city, status or type"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 md:max-w-xl"
          />

          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">All statuses</option>
              {TRANSACTION_STATUSES.map((statusValue) => (
                <option key={statusValue} value={statusValue}>{statusValue}</option>
              ))}
            </select>

            <span className="text-xs text-slate-600 whitespace-nowrap">Page {page} of {totalPages}</span>
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('transaction')}>
                    Transaction <span>{sortIndicator('transaction')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('associate')}>
                    Associate <span>{sortIndicator('associate')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('market_center')}>
                    Market Center <span>{sortIndicator('market_center')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('type')}>
                    Type <span>{sortIndicator('type')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('status')}>
                    Status <span>{sortIndicator('status')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('created_date')}>
                    Transaction Date <span>{sortIndicator('created_date')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('status_change_date')}>
                    Status Change Date <span>{sortIndicator('status_change_date')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('sales_price')}>
                    Sales Price <span>{sortIndicator('sales_price')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('net_comm')}>
                    Net Comm <span>{sortIndicator('net_comm')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {isLoading && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={10}>Loading transactions...</td>
                </tr>
              )}

              {isError && (
                <tr>
                  <td className="px-3 py-4 text-amber-700" colSpan={10}>Could not load transactions from backend API.</td>
                </tr>
              )}

              {!isLoading && !isError && filteredItems.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={10}>No transactions found for this filter.</td>
                </tr>
              )}

              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{item.transaction_number ?? item.source_transaction_id}</div>
                    <div className="text-xs text-slate-500">Listing: {item.listing_number ?? item.source_listing_id ?? '-'}</div>
                    <div className="text-[11px] text-slate-400">ID: {item.source_transaction_id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {item.agents.length > 0
                        ? item.agents.map((a) => a.associate_name).join(', ')
                        : '-'}
                    </div>
                    <div className="text-xs text-slate-500 truncate max-w-64">{item.address ?? '-'}</div>
                    <div className="text-[11px] text-slate-400">
                      {item.suburb ?? '-'}{item.suburb && item.city ? ', ' : ''}{item.city ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{item.market_center_name ?? '-'}</td>
                  <td className="px-3 py-2">{item.transaction_type ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span className="status-chip info">{item.transaction_status ?? '-'}</span>
                  </td>
                  <td className="px-3 py-2">{toShortDate(item.transaction_date ?? item.created_at)}</td>
                  <td className="px-3 py-2">{toShortDate(item.status_change_date)}</td>
                  <td className="px-3 py-2">{toMoney(item.sales_price)}</td>
                  <td className="px-3 py-2">{toMoney(item.net_comm)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => openEditForm(item)}>
                        Edit
                      </button>
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => setQuickSummaryRow(item)}>
                        Summary
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => setPage((prev) => prev - 1)}
            disabled={!canGoPrev}
          >
            Previous
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={!canGoNext}
          >
            Next
          </button>
        </div>
      </section>
      )}

      {quickSummaryRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-6xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-lg font-semibold text-slate-900">Quick Transaction Summary</h3>
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs" type="button" onClick={() => setQuickSummaryRow(null)}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Transaction: <strong>{quickSummaryRow.transaction_number ?? quickSummaryRow.source_transaction_id}</strong>
              </div>
              <table className="min-w-[1100px] w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 whitespace-nowrap">Agent</th>
                    <th className="px-3 py-2 whitespace-nowrap">Office</th>
                    <th className="px-3 py-2 whitespace-nowrap">Side</th>
                    <th className="px-3 py-2 whitespace-nowrap">Split</th>
                    <th className="px-3 py-2 whitespace-nowrap">GCI Before Fees</th>
                    <th className="px-3 py-2 whitespace-nowrap">GCI After Fees</th>
                    <th className="px-3 py-2 whitespace-nowrap">Associate $</th>
                    <th className="px-3 py-2 whitespace-nowrap">Cap Remaining</th>
                    <th className="px-3 py-2 whitespace-nowrap">Market Centre $</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                  {quickSummaryRow.agents.filter((a) => a.summary).map((agent, index) => (
                    <tr key={`${agent.source_associate_id || agent.associate_name}-${index}`}>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{agent.associate_name ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{agent.summary?.office_name ?? quickSummaryRow.market_center_name ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{agent.summary?.transaction_type ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toPercent(Number(agent.summary?.split_percentage ?? 0))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(agent.summary?.transaction_gci_before_fees ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(agent.summary?.gci_after_fees_excl_vat ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(agent.summary?.associate_dollar ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(agent.summary?.cap_remaining ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(agent.summary?.market_center_dollar ?? '0')}</td>
                    </tr>
                  ))}
                  {quickSummaryRow.agents.filter((a) => a.summary).length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={9}>No calculated rows found for this transaction yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
