import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DETAIL_FETCH_TIMEOUT_MS = 12000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = DETAIL_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

type TransactionDetailRow = {
  id: string;
  source_transaction_id: string;
  transaction_number: string | null;
  transaction_category: string | null;
  source_rental_id: string | null;
  source_rental_payment_schedule_id: string | null;
  counts_toward_cap: boolean | null;
  transaction_status: string | null;
  transaction_type: string | null;
  listing_number: string | null;
  source_listing_id: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  // Financial
  sales_price: string | null;
  list_price: string | null;
  variance_per: string | null;
  contract_gci_excl_vat: string | null;
  avg_comms_per: string | null;
  transaction_gci_excl_vat: string | null;
  gci_excl_vat: string | null;
  net_comm: string | null;
  total_gci: string | null;
  growth_share: string | null;
  production_royalties: string | null;
  cap_remaining: string | null;
  associate_dollar: string | null;
  mc_dollar: string | null;
  company_dollar: string | null;
  team_dollar: string | null;
  // Parties
  buyer: string | null;
  seller: string | null;
  all_parties_invoiced: string | null;
  // Attorneys
  transfer_attorney: string | null;
  ta_mobile_phone: string | null;
  ta_email: string | null;
  bond_attorney: string | null;
  ba_mobile_phone: string | null;
  ba_email: string | null;
  // Bond
  bond_originator: string | null;
  bond_amount: string | null;
  bond_due_date: string | null;
  // Financing
  transaction_financial_institution: string | null;
  transaction_financing_type: string | null;
  financial_institution_other: string | null;
  // Market Center & Team
  source_market_center_id: string | null;
  market_center_name: string | null;
  source_team_id: string | null;
  team_name: string | null;
  listing_office_name: string | null;
  // Dates
  list_date: string | null;
  transaction_date: string | null;
  status_change_date: string | null;
  expected_date: string | null;
  outside_agency_contacts?: Array<{
    agent_name: string | null;
    agency_name: string | null;
    phone: string | null;
    email: string | null;
  }>;
  agent_breakdown?: Array<{
    agent_name: string | null;
    agent_role: string | null;
    split_percentage: string | null;
    is_outside_agent: boolean;
  }>;
  created_at: string | null;
  // Documents & Status
  agent_id?: string;
  sale_type: string | null;
  updated_at?: string;
};

type RentalDetailParticipant = {
  id: number;
  associate_id: string | null;
  participant_role: string | null;
  split_percentage: string | null;
  gross_commission_amount: string | null;
  company_dollar_amount: string | null;
  royalty_amount: string | null;
  growth_share_amount: string | null;
  agent_net_amount: string | null;
  counts_toward_cap: boolean | null;
};

type RentalPaymentScheduleItem = {
  id: number;
  payment_sequence_number: number;
  due_date: string | null;
  payment_status: string | null;
  paid_date: string | null;
  gross_commission: string | null;
  company_dollar: string | null;
  royalty: string | null;
  growth_share: string | null;
  agent_net_amount: string | null;
  transaction_created: boolean;
  transaction_id: string | null;
};

type RentalDocumentRow = {
  id: number;
  document_name: string;
  document_type: string;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string;
};

type RentalAuditRow = {
  id: number;
  action: string;
  changed_by_user_id: string | null;
  changed_at: string;
  old_value: unknown;
  new_value: unknown;
};

type RentalDetailRow = {
  id: number;
  rental_number: string;
  rental_type: string;
  rental_status: string;
  property_address: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  landlord_name: string | null;
  landlord_surname_or_company: string | null;
  landlord_email: string | null;
  landlord_phone: string | null;
  tenant_name: string | null;
  tenant_surname_or_company: string | null;
  tenant_email: string | null;
  tenant_phone: string | null;
  frequency: string | null;
  payment_due_day: number | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  rental_amount: string | null;
  gross_commission: string | null;
  company_dollar: string | null;
  counts_toward_cap: boolean | null;
  notes: string | null;
  participants: RentalDetailParticipant[];
  payment_schedule: RentalPaymentScheduleItem[];
  documents: RentalDocumentRow[];
};

type DocumentRow = {
  id: string;
  transaction_id: string;
  source_document_id: string | null;
  source_transaction_document_type_id: string | null;
  transaction_document_type: string | null;
  file_name: string;
  document_url: string | null;
  preview_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StatusHistoryRow = {
  id: string;
  previous_status: string | null;
  new_status: string | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_user_id: string | null;
  changed_by_email: string | null;
  notes: string | null;
};

type DetailTab = 'overview' | 'financial' | 'documents' | 'status-history' | 'attorneys';

function formatMoney(value: string | null): string {
  if (!value) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

function formatPercent(value: string | null): string {
  if (!value) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function formatRoleLabel(value: string | null, isOutsideAgent = false): string {
  if (isOutsideAgent) return 'Outside Agent';
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'Unknown Side';
  if (normalized === 'both') return 'Both';
  if (normalized === 'buyer') return 'Buyer';
  if (normalized === 'seller') return 'Seller';
  return normalized
    .split(' ')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-slate-300">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value || '-'}</p>
    </div>
  );
}

export default function TransactionDetailView({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const { token, activeContext } = useAuth();
  const queryClient = useQueryClient();
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const authHeaders: Record<string, string> = {};
  if (token) authHeaders.Authorization = `Bearer ${token}`;
  if (activeContext?.id) authHeaders['X-Active-Context'] = activeContext.id;

  const { data: transaction, isLoading: isTxLoading, isError: isTxError } = useQuery({
    queryKey: ['transaction-detail', transactionId],
    queryFn: async ({ signal }) => {
      const response = await fetchWithTimeout(`/api/transactions/${transactionId}`, { headers: authHeaders, signal });
      if (!response.ok) throw new Error('Failed to load transaction');
      return response.json() as Promise<TransactionDetailRow>;
    },
    enabled: Boolean(transactionId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 60000,
  });

  const rentalId = Number(transaction?.source_rental_id ?? 0);
  const isRentalTransaction =
    String(transaction?.transaction_category ?? '').toUpperCase() === 'RENTALS'
    || String(transaction?.transaction_type ?? '').toLowerCase().includes('rental')
    || String(transaction?.source_transaction_id ?? '').toUpperCase().startsWith('RENTAL-PAY-');

  const { data: rentalDetail } = useQuery({
    queryKey: ['rental-detail-from-transaction', rentalId],
    queryFn: () =>
      fetch(`/api/rentals/${rentalId}`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) throw new Error('Failed to load rental details');
        return r.json() as Promise<RentalDetailRow>;
      }),
    enabled: isRentalTransaction && Number.isFinite(rentalId) && rentalId > 0,
  });

  const { data: documents, isLoading: isDocsLoading } = useQuery({
    queryKey: ['transaction-documents', transactionId],
    queryFn: () =>
      fetch(`/api/transactions/${transactionId}/documents`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) return { items: [] };
        return r.json() as Promise<{ items: DocumentRow[] }>;
      }),
    enabled: Boolean(transactionId) && detailTab === 'documents',
  });

  async function deleteTransactionDocument(documentId: string): Promise<void> {
    if (documentId.startsWith('staging:')) {
      setDocumentActionError('Legacy staged documents are read-only and cannot be deleted here.');
      return;
    }

    const numericId = Number(documentId);
    if (!Number.isFinite(numericId)) {
      setDocumentActionError('Invalid document id for delete operation.');
      return;
    }

    setDocumentActionError(null);
    setDeletingDocumentId(documentId);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/documents/${numericId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (!response.ok && response.status !== 204) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Failed to delete document');
      }

      await queryClient.invalidateQueries({ queryKey: ['transaction-documents', transactionId] });
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setDeletingDocumentId(null);
    }
  }

  const { data: statusHistory, isLoading: isStatusLoading } = useQuery({
    queryKey: ['transaction-status-history', transactionId],
    queryFn: () =>
      fetch(`/api/transactions/${transactionId}/status-history`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) return { items: [] };
        return r.json() as Promise<{ items: StatusHistoryRow[] }>;
      }),
    enabled: Boolean(transactionId) && detailTab === 'status-history',
  });

  const { data: rentalAudit, isLoading: isRentalAuditLoading } = useQuery({
    queryKey: ['rental-audit-from-transaction', rentalId],
    queryFn: () =>
      fetch(`/api/rentals/${rentalId}/audit-log`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) return { items: [] };
        return r.json() as Promise<{ items: RentalAuditRow[] }>;
      }),
    enabled: isRentalTransaction && Number.isFinite(rentalId) && rentalId > 0 && detailTab === 'status-history',
  });

  if (isTxLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-slate-500">Loading transaction details...</p>
      </div>
    );
  }

  if (isTxError || !transaction) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-red-600">Failed to load transaction details. Please close and try again.</p>
      </div>
    );
  }

  const agentBreakdown = transaction.agent_breakdown ?? [];
  const multiAgentSplitRows = agentBreakdown.filter((agent) => toNumberOrNull(agent.split_percentage) !== null);
  const baseNetComm = toNumberOrNull(transaction.net_comm);
  const baseTotalGci = toNumberOrNull(transaction.total_gci);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-rose-50 px-4 py-4 md:px-5 md:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Transaction View</p>
            <h2 className="mt-1 truncate text-2xl font-semibold text-slate-900">
              {transaction.transaction_number || transaction.source_transaction_id}
            </h2>
            <p className="mt-1 max-w-3xl break-words text-sm text-slate-600">{transaction.address || transaction.source_transaction_id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="status-chip">Status: {transaction.transaction_status || '-'}</span>
          <span className="status-chip info">Type: {transaction.transaction_type || '-'}</span>
          {transaction.listing_number && (
            <span className="status-chip good">Listing: {transaction.listing_number}</span>
          )}
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50/70 px-3 pt-2">
        <div className="flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['financial', 'Financial'],
            ['documents', 'Documents'],
            ['attorneys', isRentalTransaction ? 'Participants' : 'Attorneys'],
            ['status-history', 'Status History'],
          ] as [DetailTab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDetailTab(key)}
              className={`rounded-t-xl border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${
                detailTab === key
                  ? 'border-red-200 bg-white text-red-600'
                  : 'border-transparent text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[78vh] overflow-auto p-4 md:p-5">
        {detailTab === 'overview' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Basic Information</h3>
                <span className="text-xs text-slate-500">Core record details</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard label="Transaction Number" value={transaction.transaction_number} />
                <StatCard label="Source ID" value={transaction.source_transaction_id} />
                <StatCard label="Transaction Status" value={transaction.transaction_status} />
                <StatCard label="Transaction Type" value={transaction.transaction_type} />
                <StatCard label="Listing Number" value={transaction.listing_number} />
                <StatCard label="Address" value={`${transaction.address}${transaction.suburb ? `, ${transaction.suburb}` : ''}`} />
                <StatCard label="City" value={transaction.city} />
                <StatCard label="Buyer" value={transaction.buyer} />
                <StatCard label="Seller" value={transaction.seller} />
              </div>
            </section>

            {isRentalTransaction && rentalDetail && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Rental Information</h3>
                  <span className="text-xs text-slate-500">Rental-only fields</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard label="Rental Number" value={rentalDetail.rental_number} />
                  <StatCard label="Rental Status" value={rentalDetail.rental_status} />
                  <StatCard label="Rental Type" value={rentalDetail.rental_type} />
                  <StatCard label="Frequency" value={rentalDetail.frequency} />
                  <StatCard label="Payment Due Day" value={rentalDetail.payment_due_day ? String(rentalDetail.payment_due_day) : '-'} />
                  <StatCard label="Counts Toward Cap" value={rentalDetail.counts_toward_cap ? 'Yes' : 'No'} />
                  <StatCard label="Lease Start Date" value={formatDate(rentalDetail.lease_start_date)} />
                  <StatCard label="Lease End Date" value={formatDate(rentalDetail.lease_end_date)} />
                  <StatCard label="Rental Amount" value={formatMoney(rentalDetail.rental_amount)} />
                  <StatCard label="Landlord" value={[rentalDetail.landlord_name, rentalDetail.landlord_surname_or_company].filter(Boolean).join(' ') || '-'} />
                  <StatCard label="Landlord Email" value={rentalDetail.landlord_email} />
                  <StatCard label="Landlord Phone" value={rentalDetail.landlord_phone} />
                  <StatCard label="Tenant" value={[rentalDetail.tenant_name, rentalDetail.tenant_surname_or_company].filter(Boolean).join(' ') || '-'} />
                  <StatCard label="Tenant Email" value={rentalDetail.tenant_email} />
                  <StatCard label="Tenant Phone" value={rentalDetail.tenant_phone} />
                </div>
                {rentalDetail.notes && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-600">Rental Notes</p>
                    <p className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{rentalDetail.notes}</p>
                  </div>
                )}
              </section>
            )}

            {/* Market Center & Team */}
            {(transaction.market_center_name || transaction.team_name) && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Market Center & Team</h3>
                  <span className="text-xs text-slate-500">Context and ownership</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {transaction.market_center_name && (
                    <StatCard label="Market Center" value={transaction.market_center_name} />
                  )}
                  {transaction.team_name && (
                    <StatCard label="Team" value={transaction.team_name} />
                  )}
                  {transaction.listing_office_name && (
                    <StatCard label="Listing Office" value={transaction.listing_office_name} />
                  )}
                </div>
              </section>
            )}

            {/* Key Dates */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Key Dates</h3>
                <span className="text-xs text-slate-500">Lifecycle timeline</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {transaction.list_date && (
                  <StatCard label="List Date" value={formatDate(transaction.list_date)} />
                )}
                {transaction.transaction_date && (
                  <StatCard label="Transaction Date" value={formatDate(transaction.transaction_date)} />
                )}
                {transaction.status_change_date && (
                  <StatCard label="Status Change Date" value={formatDate(transaction.status_change_date)} />
                )}
                {transaction.expected_date && (
                  <StatCard label="Expected Date" value={formatDate(transaction.expected_date)} />
                )}
                {transaction.created_at && (
                  <StatCard label="Created" value={formatDateTime(transaction.created_at)} />
                )}
              </div>
            </section>

            {agentBreakdown.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Agent Breakdown</h3>
                  <span className="text-xs text-slate-500">By side and split</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Agent</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2 text-right">Split %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                      {agentBreakdown.map((agent, index) => (
                        <tr key={`${agent.agent_name ?? 'agent'}-${index}`}>
                          <td className="px-3 py-2 font-medium">{agent.agent_name || 'Unknown Agent'}</td>
                          <td className="px-3 py-2">{formatRoleLabel(agent.agent_role, agent.is_outside_agent)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatPercent(agent.split_percentage)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {(transaction.outside_agency_contacts ?? []).length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Outside Agents</h3>
                  <span className="text-xs text-slate-500">External contacts</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(transaction.outside_agency_contacts ?? []).map((contact, idx) => (
                    <div key={`${contact.agent_name ?? 'outside-agent'}-${idx}`} className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm">
                      <p className="text-sm font-semibold text-amber-950">{contact.agent_name || 'Outside Agent'}</p>
                      <p className="mt-1 text-xs text-amber-900">Agency: {contact.agency_name || '-'}</p>
                      <p className="text-xs text-amber-900">Phone: {contact.phone || '-'}</p>
                      <p className="text-xs text-amber-900">Email: {contact.email || '-'}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {detailTab === 'financial' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">{isRentalTransaction ? 'Rental & Commission Information' : 'Price Information'}</h3>
                <span className="text-xs text-slate-500">Financial overview</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard label={isRentalTransaction ? 'Rental Amount' : 'Sales Price'} value={isRentalTransaction ? formatMoney(rentalDetail?.rental_amount ?? null) : formatMoney(transaction.sales_price)} />
                <StatCard label={isRentalTransaction ? 'Gross Commission' : 'List Price'} value={isRentalTransaction ? formatMoney(rentalDetail?.gross_commission ?? transaction.total_gci) : formatMoney(transaction.list_price)} />
                <StatCard label={isRentalTransaction ? 'Type' : 'Price Variance %'} value={isRentalTransaction ? (rentalDetail?.rental_type ?? transaction.transaction_type) : formatPercent(transaction.variance_per)} />
                <StatCard label={isRentalTransaction ? 'Frequency' : 'Sale Type'} value={isRentalTransaction ? (rentalDetail?.frequency ?? '-') : transaction.sale_type} />
              </div>
            </section>

            {/* Commission & GCI */}
            <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Commission & GCI</h3>
                <span className="text-xs text-slate-500">Current calculations</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard label={isRentalTransaction ? 'Agent Net Amount' : 'Net Commission'} value={formatMoney(transaction.net_comm)} />
                <StatCard label={isRentalTransaction ? 'Gross Commission' : 'Total GCI'} value={formatMoney(transaction.total_gci)} />
                <StatCard label="GCI Excl VAT" value={formatMoney(transaction.gci_excl_vat)} />
                <StatCard label={isRentalTransaction ? 'Company Dollar' : 'Contract GCI Excl VAT'} value={isRentalTransaction ? formatMoney(rentalDetail?.company_dollar ?? transaction.company_dollar) : formatMoney(transaction.contract_gci_excl_vat)} />
                <StatCard label={isRentalTransaction ? 'Growth Share' : 'Transaction GCI Excl VAT'} value={isRentalTransaction ? formatMoney(transaction.growth_share) : formatMoney(transaction.transaction_gci_excl_vat)} />
                <StatCard label={isRentalTransaction ? 'Production Royalties' : 'Avg Commission %'} value={isRentalTransaction ? formatMoney(transaction.production_royalties) : formatPercent(transaction.avg_comms_per)} />
              </div>
            </section>

            {/* Splits & Distributions */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Splits & Distributions</h3>
                <span className="text-xs text-slate-500">Cap and payouts</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard label="Cap Remaining" value={formatMoney(transaction.cap_remaining)} />
                <StatCard label="Growth Share" value={formatMoney(transaction.growth_share)} />
                <StatCard label="Production Royalties" value={formatMoney(transaction.production_royalties)} />
                <StatCard label="Associate Dollar" value={formatMoney(transaction.associate_dollar)} />
                <StatCard label="Market Center Dollar" value={formatMoney(transaction.mc_dollar)} />
                <StatCard label="Company Dollar" value={formatMoney(transaction.company_dollar)} />
                <StatCard label="Team Dollar" value={formatMoney(transaction.team_dollar)} />
              </div>
            </section>

            {multiAgentSplitRows.length > 1 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Agent Split Allocation</h3>
                  <span className="text-xs text-slate-500">Per agent breakdown</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Agent</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2 text-right">Split %</th>
                        <th className="px-3 py-2 text-right">Net Comm Allocation</th>
                        <th className="px-3 py-2 text-right">Total GCI Allocation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                      {multiAgentSplitRows.map((agent, index) => {
                        const split = toNumberOrNull(agent.split_percentage) ?? 0;
                        const netAllocation = baseNetComm == null ? null : (baseNetComm * split) / 100;
                        const gciAllocation = baseTotalGci == null ? null : (baseTotalGci * split) / 100;
                        return (
                          <tr key={`${agent.agent_name ?? 'split-agent'}-${index}`}>
                            <td className="px-3 py-2 font-medium">{agent.agent_name || 'Unknown Agent'}</td>
                            <td className="px-3 py-2">{formatRoleLabel(agent.agent_role, agent.is_outside_agent)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{split.toFixed(2)}%</td>
                            <td className="px-3 py-2 text-right tabular-nums">{netAllocation == null ? '-' : formatMoney(String(netAllocation))}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{gciAllocation == null ? '-' : formatMoney(String(gciAllocation))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {detailTab === 'attorneys' && (
          <div className="space-y-5">
            {isRentalTransaction ? (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">Rental Participants</h3>
                    <span className="text-xs text-slate-500">Active participants</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    {rentalDetail && rentalDetail.participants.length > 0 ? (
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Associate ID</th>
                              <th className="px-3 py-2">Role</th>
                              <th className="px-3 py-2">Split %</th>
                              <th className="px-3 py-2">Agent Net</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                            {rentalDetail.participants.map((participant) => (
                              <tr key={participant.id}>
                                <td className="px-3 py-2">{participant.associate_id ?? '-'}</td>
                                <td className="px-3 py-2">{participant.participant_role ?? '-'}</td>
                                <td className="px-3 py-2">{formatPercent(participant.split_percentage)}</td>
                                <td className="px-3 py-2">{formatMoney(participant.agent_net_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No rental participants available</p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">Payment Schedule</h3>
                    <span className="text-xs text-slate-500">Due and paid milestones</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    {rentalDetail && rentalDetail.payment_schedule.length > 0 ? (
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Seq</th>
                              <th className="px-3 py-2">Due Date</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Gross Comm</th>
                              <th className="px-3 py-2">Agent Net</th>
                              <th className="px-3 py-2">Paid Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                            {rentalDetail.payment_schedule.map((row) => (
                              <tr key={row.id}>
                                <td className="px-3 py-2">{row.payment_sequence_number}</td>
                                <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                                <td className="px-3 py-2">{row.payment_status ?? '-'}</td>
                                <td className="px-3 py-2">{formatMoney(row.gross_commission)}</td>
                                <td className="px-3 py-2">{formatMoney(row.agent_net_amount)}</td>
                                <td className="px-3 py-2">{formatDateTime(row.paid_date)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No payment schedule available</p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">Transfer Attorney</h3>
                    <span className="text-xs text-slate-500">Primary conveyancing contact</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    {transaction.transfer_attorney ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <StatCard label="Name" value={transaction.transfer_attorney} />
                          <StatCard label="Mobile" value={transaction.ta_mobile_phone} />
                          <StatCard label="Email" value={transaction.ta_email} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No transfer attorney information available</p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">Bond Attorney</h3>
                    <span className="text-xs text-slate-500">Finance contact</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    {transaction.bond_attorney ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <StatCard label="Name" value={transaction.bond_attorney} />
                          <StatCard label="Mobile" value={transaction.ba_mobile_phone} />
                          <StatCard label="Email" value={transaction.ba_email} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-sm">No bond attorney information available</p>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {detailTab === 'documents' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">{isRentalTransaction ? 'Rental Documents' : 'Transaction Documents'}</h3>
              <span className="text-xs text-slate-500">Downloads and file actions</span>
            </div>
            {documentActionError && <p className="text-sm text-red-600">{documentActionError}</p>}
            {isDocsLoading ? (
              <p className="text-slate-500">Loading documents...</p>
            ) : isRentalTransaction ? (
              rentalDetail && rentalDetail.documents.length > 0 ? (
                <div className="space-y-2">
                  {rentalDetail.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div>
                        <p className="font-medium text-slate-900">{doc.document_name || doc.file_name || `Document #${doc.id}`}</p>
                        <p className="text-xs text-slate-500">
                          {doc.document_type || 'Document'} • {formatDate(doc.uploaded_at)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {doc.file_url && (
                          <a
                            href={doc.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">No documents attached to this rental</p>
              )
            ) : documents && documents.items.length > 0 ? (
              <div className="space-y-2">
                {documents.items.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div>
                      <p className="font-medium text-slate-900">{doc.file_name}</p>
                      <p className="text-xs text-slate-500">
                        {doc.transaction_document_type || 'Document'} • {formatDate(doc.created_at)}{doc.id.startsWith('staging:') ? ' • Legacy source' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {doc.document_url && (
                        <a
                          href={doc.document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                        >
                          Download
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={doc.id.startsWith('staging:') || deletingDocumentId === doc.id}
                        onClick={() => void deleteTransactionDocument(doc.id)}
                        className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingDocumentId === doc.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">No documents attached to this transaction</p>
            )}
          </div>
        )}

        {detailTab === 'status-history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Status History</h3>
              <span className="text-xs text-slate-500">Audit trail</span>
            </div>
            {isRentalTransaction ? (
              isRentalAuditLoading ? (
                <p className="text-slate-500">Loading rental history...</p>
              ) : rentalAudit && rentalAudit.items.length > 0 ? (
                <div className="space-y-3">
                  {rentalAudit.items.map((entry, idx) => (
                    <div key={`${entry.id}-${idx}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-3 rounded-full bg-red-600 shadow-sm" />
                        {idx < rentalAudit.items.length - 1 && <div className="h-8 w-0.5 bg-slate-200 mt-1" />}
                      </div>
                      <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="font-medium text-slate-900">{entry.action}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(entry.changed_at)}
                          {entry.changed_by_user_id && ` by ${entry.changed_by_user_id}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">No rental history available</p>
              )
            ) : isStatusLoading ? (
              <p className="text-slate-500">Loading status history...</p>
            ) : statusHistory && statusHistory.items.length > 0 ? (
              <div className="space-y-3">
                {statusHistory.items.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">
                          {entry.previous_status ? `${entry.previous_status} →` : 'Initial'} <span className="text-red-600">{entry.new_status}</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="font-medium">When:</span> {formatDateTime(entry.changed_at)}
                        </p>
                        {(entry.changed_by || entry.changed_by_email || entry.changed_by_user_id) && (
                          <p className="mt-1 text-xs text-slate-600">
                            <span className="font-medium">Changed by:</span>{' '}
                            {entry.changed_by ?? entry.changed_by_email ?? `User ${entry.changed_by_user_id}`}
                            {entry.changed_by_email && entry.changed_by !== entry.changed_by_email ? ` (${entry.changed_by_email})` : ''}
                          </p>
                        )}
                        {entry.notes && (
                          <p className="mt-2 text-xs text-slate-700 italic">
                            <span className="font-medium">Notes:</span> {entry.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">No status history available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
