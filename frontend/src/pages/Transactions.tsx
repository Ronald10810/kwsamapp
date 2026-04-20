import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type TransactionRow = {
  id: string;
  source_transaction_id: string;
  transaction_number: string | null;
  source_associate_id?: string | null;
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
  split_percentage: string | null;
  net_comm: string | null;
  total_gci: string | null;
  sale_type: string | null;
  agent_type: string | null;
  buyer: string | null;
  seller: string | null;
  list_date: string | null;
  transaction_date: string | null;
  status_change_date: string | null;
  expected_date: string | null;
  associate_name: string | null;
  associate_image_url: string | null;
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
  }>;
  associate_performance: Array<{
    associate_name: string;
    market_center: string;
    total_transactions: number;
    total_sales_value: number;
  }>;
  expected_closings_90_days: Array<{ bucket: string; count: number; total_gci: number }>;
};

type TransactionFormState = {
  source_transaction_id: string;
  source_associate_id: string;
  source_market_center_id: string;
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

function normalizeTransactionStatus(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
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
  const [form, setForm] = useState<TransactionFormState>({
    source_transaction_id: '',
    source_associate_id: '',
    source_market_center_id: '',
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

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data?.total]);
  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const selected = normalizeTransactionStatus(status);
    if (!selected) return items;
    return items.filter((item) => normalizeTransactionStatus(item.transaction_status) === selected);
  }, [data?.items, status]);

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
          result = compareText(a.associate_name, b.associate_name);
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
          result = compareDate(a.transaction_date, b.transaction_date);
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
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodLabel = `${monthStart.toLocaleDateString()} - ${now.toLocaleDateString()}`;

  function toInputDate(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function openCreateForm(): void {
    setEditingId(null);
    setFormError(null);
    setForm({
      source_transaction_id: '',
      source_associate_id: '',
      source_market_center_id: '',
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
    setForm({
      source_transaction_id: item.source_transaction_id,
      source_associate_id: item.source_associate_id ?? '',
      source_market_center_id: item.source_market_center_id ?? '',
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
    });
    setIsFormOpen(true);
    setEditTab('details');
  }

  const selectedAgent = (agentOptionsData?.items ?? []).find(
    (option) => option.source_associate_id === form.source_associate_id
  );

  async function saveTransaction(): Promise<void> {
    setIsSaving(true);
    setFormError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/transactions/${editingId}` : '/api/transactions';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  const currentEditingRow = editingId ? (data?.items ?? []).find((x) => x.id === editingId) : null;
  const salesValue = toNumberOrZero(form.sales_price || currentEditingRow?.sales_price);
  const listValue = toNumberOrZero(form.list_price || currentEditingRow?.list_price);
  const netCommValue = toNumberOrZero(form.net_comm || currentEditingRow?.net_comm);
  const totalGciValue = toNumberOrZero(form.total_gci || currentEditingRow?.total_gci || form.net_comm);
  const splitValue = toNumberOrZero(currentEditingRow?.split_percentage);
  const variancePct = listValue > 0 ? ((salesValue - listValue) / listValue) * 100 : 0;
  const avgCommsPct = salesValue > 0 ? (totalGciValue / salesValue) * 100 : 0;
  const fees = Math.max(totalGciValue - netCommValue, 0);
  const productionRoyalties = fees * 0.75;
  const growthShare = fees * 0.25;
  const marketCentreDollar = Math.max(netCommValue * 0.3, 0);
  const associateDollar = Math.max(netCommValue - marketCentreDollar, 0);
  const capRemaining = 0;

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

      {isFormOpen && (
        <section className="space-y-4">
          <section className="surface-card p-4 md:p-5">
            <h2 className="text-3xl font-semibold text-slate-900">Transaction Edit</h2>
            <p className="mt-1 text-sm text-slate-500">Manage transactions, parties, documents and more</p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
              <div className="flex min-w-[720px] items-center gap-2">
                {[
                  ['details', 'Transaction Details'],
                  ['parties', 'Transaction Parties'],
                  ['documents', 'Documents'],
                  ['notes', 'Notes'],
                  ['emails', 'Email History'],
                  ['summary', 'Summary'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEditTab(value as TransactionEditTab)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold uppercase tracking-wide ${
                      editTab === value ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="surface-card p-4 md:p-5">
            {editTab === 'details' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Transaction Details</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Source Transaction ID</span>
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source transaction ID" value={form.source_transaction_id} onChange={(e) => setForm((p) => ({ ...p, source_transaction_id: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Transaction Number</span>
                    <input className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" placeholder="Transaction number" value={form.transaction_number} readOnly />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Transaction Status</span>
                    <select
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={form.transaction_status}
                      onChange={(e) => setForm((p) => ({ ...p, transaction_status: e.target.value }))}
                    >
                      {TRANSACTION_STATUSES.map((statusValue) => (
                        <option key={statusValue} value={statusValue}>{statusValue}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Transaction Type</span>
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Type" value={form.transaction_type} onChange={(e) => setForm((p) => ({ ...p, transaction_type: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Agent</span>
                    <select
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={form.source_associate_id}
                      onChange={(e) => {
                        const selected = (agentOptionsData?.items ?? []).find((x) => x.source_associate_id === e.target.value);
                        setForm((p) => ({
                          ...p,
                          source_associate_id: e.target.value,
                          source_market_center_id: selected?.source_market_center_id ?? '',
                        }));
                      }}
                    >
                      <option value="">Select agent</option>
                      {(agentOptionsData?.items ?? []).map((option) => (
                        <option key={option.source_associate_id} value={option.source_associate_id}>
                          {(option.full_name ?? option.source_associate_id) + (option.market_center_name ? ` - ${option.market_center_name}` : '')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Source Market Centre ID</span>
                    <input
                      className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                      placeholder="Source market center ID"
                      value={selectedAgent?.source_market_center_id ?? form.source_market_center_id}
                      readOnly
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Source Listing ID</span>
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source listing ID" value={form.source_listing_id} onChange={(e) => setForm((p) => ({ ...p, source_listing_id: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Listing Number</span>
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Listing number" value={form.listing_number} onChange={(e) => setForm((p) => ({ ...p, listing_number: e.target.value }))} />
                  </label>
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
                    <input className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" type="date" value={form.transaction_date} readOnly />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Expected Date</span>
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={form.expected_date} onChange={(e) => setForm((p) => ({ ...p, expected_date: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Status Change Date</span>
                    <input className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" placeholder="Status change date" value={toShortDate(currentEditingRow?.status_change_date ?? null)} readOnly />
                  </label>
                </div>
              </div>
            )}

            {editTab === 'parties' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Transaction Parties</h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold">Agents</h4>
                      <button className="primary-btn" type="button">Add Agent</button>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">Associate linked: {currentEditingRow?.associate_name ?? 'Not linked'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold">Contacts</h4>
                      <button className="primary-btn" type="button">Add Contact</button>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">Buyer: {currentEditingRow?.buyer ?? '-'}</p>
                    <p className="text-sm text-slate-500">Seller: {currentEditingRow?.seller ?? '-'}</p>
                  </div>
                </div>
              </div>
            )}

            {editTab === 'documents' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Transaction Documents</h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">Drag and drop file here or click</div>
                  <div className="rounded-xl border border-slate-200 p-6 text-slate-500">OTP Document area</div>
                </div>
              </div>
            )}

            {editTab === 'notes' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Transaction Notes</h3>
                <button className="primary-btn" type="button">Add Note</button>
              </div>
            )}

            {editTab === 'emails' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Email History</h3>
                <p className="text-sm text-slate-500">Email tracking can be connected here.</p>
              </div>
            )}

            {editTab === 'summary' && (
              <div className="space-y-4">
                <h3 className="text-3xl font-semibold text-slate-900">Transaction Summary</h3>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                      {[
                        ['Agent Name', currentEditingRow?.associate_name ?? '-'],
                        ['Office Name', currentEditingRow?.market_center_name ?? '-'],
                        ['Transaction Type', form.transaction_type || currentEditingRow?.transaction_type || '-'],
                        ['Split Percentage', toPercent(splitValue)],
                        ['% Variance Sale and List Price', toPercent(variancePct)],
                        ['Transaction GCI Before Fees', toMoney(String(totalGciValue))],
                        ['Average Comms %', toPercent(avgCommsPct)],
                        ['Production Royalties', toMoney(String(productionRoyalties))],
                        ['Growth Share', toMoney(String(growthShare))],
                        ['Total PR and GS', toMoney(String(productionRoyalties + growthShare))],
                        ['GCI After Fees Excl VAT', toMoney(String(netCommValue))],
                        ['Associate Dollar', toMoney(String(associateDollar))],
                        ['Cap Remaining', toMoney(String(capRemaining))],
                        ['Team Dollar', toMoney('0')],
                        ['Market Centre Dollar', toMoney(String(marketCentreDollar))],
                      ].map(([label, value]) => (
                        <tr key={label}>
                          <td className="px-4 py-3 font-semibold text-slate-700">{label}</td>
                          <td className="px-4 py-3 text-slate-900">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {formError && <p className="mt-4 text-sm text-amber-700">{formError}</p>}
          </section>

          <div className="flex items-center justify-end gap-2">
            <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" type="button" onClick={() => setIsFormOpen(false)}>
              Cancel
            </button>
            <button className="primary-btn" type="button" onClick={() => void saveTransaction()} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" type="button">
              Feed to Frontdoor
            </button>
          </div>
        </section>
      )}

      {view === 'summary' && (
        <section className="space-y-4">
          <div className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Registered MTD (Active Market Centres + Active Associates)</h3>
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
                    <span className="col-span-3 text-sm font-semibold text-slate-900">{toMoney(String(row.total_sales_value))}</span>
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
                    <span className="col-span-2 text-sm font-semibold text-slate-900">{toMoney(String(row.total_sales_value))}</span>
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
            placeholder="Search transaction #, listing #, address, associate, market center"
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
                    Created Date <span>{sortIndicator('created_date')}</span>
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
                <tr key={`${item.source_transaction_id}-${item.id}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{item.transaction_number ?? item.source_transaction_id}</div>
                    <div className="text-xs text-slate-500">Listing: {item.listing_number ?? item.source_listing_id ?? '-'}</div>
                    <div className="text-[11px] text-slate-400">ID: {item.source_transaction_id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.associate_name ?? '-'}</div>
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
                  <td className="px-3 py-2">{toShortDate(item.transaction_date)}</td>
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
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-lg font-semibold text-slate-900">Quick Transaction Summary</h3>
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs" type="button" onClick={() => setQuickSummaryRow(null)}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                  {[
                    ['Transaction Number', quickSummaryRow.transaction_number ?? quickSummaryRow.source_transaction_id],
                    ['Agent Name', quickSummaryRow.associate_name ?? '-'],
                    ['Office Name', quickSummaryRow.market_center_name ?? '-'],
                    ['Transaction Type', quickSummaryRow.transaction_type ?? '-'],
                    ['Transaction Status', quickSummaryRow.transaction_status ?? '-'],
                    ['% Variance Sale and List Price', toPercent(((toNumberOrZero(quickSummaryRow.sales_price) - toNumberOrZero(quickSummaryRow.list_price)) / (toNumberOrZero(quickSummaryRow.list_price) || 1)) * 100)],
                    ['Transaction GCI Before Fees', toMoney(quickSummaryRow.total_gci)],
                    ['Average Comms %', toPercent((toNumberOrZero(quickSummaryRow.total_gci) / (toNumberOrZero(quickSummaryRow.sales_price) || 1)) * 100)],
                    ['GCI After Fees Excl VAT', toMoney(quickSummaryRow.net_comm)],
                    ['Last Updated', toShortDate(quickSummaryRow.updated_at)],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="px-3 py-2 font-semibold text-slate-700">{label}</td>
                      <td className="px-3 py-2 text-slate-900">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
