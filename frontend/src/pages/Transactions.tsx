import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import TransactionDetailView from '../components/TransactionDetailView';

const HOUR_MS = 60 * 60 * 1000;
const API_FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = API_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function msUntilNextHour(): number {
  const now = Date.now();
  const remainder = now % HOUR_MS;
  return remainder === 0 ? HOUR_MS : HOUR_MS - remainder;
}

type TransactionAgent = {
  associate_id: number | null;
  associate_name: string | null;
  image_url: string | null;
  source_associate_id: string | null;
  agent_role: string | null;
  split_percentage: number | null;
  outside_agency?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    agency_name?: string | null;
  } | null;
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
  transaction_category?: string | null;
  source_type?: string | null;
  source_rental_id?: string | number | null;
  source_rental_payment_schedule_id?: string | number | null;
  counts_toward_cap?: boolean;
  source_market_center_id?: string | null;
  can_edit?: boolean;
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
  transfer_attorney?: string | null;
  ta_mobile_phone?: string | null;
  ta_email?: string | null;
  bond_attorney?: string | null;
  ba_mobile_phone?: string | null;
  ba_email?: string | null;
  bond_originator?: string | null;
  all_parties_invoiced?: string | null;
  party_contact_details?: Record<string, unknown> | null;
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

type MonthEndPreviewItem = {
  transaction_agent_id: string;
  transaction_id: string;
  transaction_number: string | null;
  associate_name: string | null;
  market_center_name: string | null;
  listing_number: string | null;
  sales_price: number;
  effective_reporting_date: string;
  transaction_type: string | null;
  agent_role: string | null;
  frontdoor_org_id: string | null;
  kwuid: string | null;
  region_transaction_id: string;
  status: 'ready' | 'error';
  error: string | null;
};

type MonthEndPreviewResponse = {
  date_from: string;
  date_to: string;
  total_candidates: number;
  ready_to_submit: number;
  will_be_skipped: number;
  limit_applied: number;
  details_included: boolean;
  items: MonthEndPreviewItem[];
};

type MonthEndSubmitResponse = {
  run_id: string;
  mode: 'monthly';
  date_from: string;
  date_to: string;
  limit: number;
  total: number;
  submitted: number;
  failed: number;
  skipped: number;
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
    total_gci: number;
  }>;
  associate_performance: Array<{
    associate_name: string;
    team_name: string;
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

type CalculatedSummaryItem = {
  id: string;
  transaction_id: string;
  transaction_agent_id: string;
  associate_id: string | null;
  source_associate_id: string | null;
  is_outside_agent: boolean;
  agent_name: string | null;
  office_name: string | null;
  transaction_side: string | null;
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
  current_cap_remaining?: string | null;
  display_cap_remaining?: string | null;
  team_dollar: string | null;
  market_center_dollar: string | null;
};

type CalculatedSummaryResponse = {
  items: CalculatedSummaryItem[];
};

type TransactionDocumentRow = {
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

type OutsideAgencyContact = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  agency_name: string;
};

type PartyContactForm = {
  first_name: string;
  last_name: string;
  contact_number: string;
  email_address: string;
  company_name: string;
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
  status_change_date: string;
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
  buyer: string;
  seller: string;
  transfer_attorney: string;
  buyer_contacts: PartyContactForm[];
  seller_contacts: PartyContactForm[];
  transfer_attorney_contact: PartyContactForm;
  bond_attorney_contact: PartyContactForm;
  bond_originator_contact: PartyContactForm;
  bond_attorney: string;
  bond_originator: string;
  all_parties_invoiced: string;
  transaction_date: string;
  expected_date: string;
  agents: TransactionFormAgent[];
};

type TransactionEditTab = 'details' | 'parties' | 'documents' | 'notes' | 'emails' | 'summary';

type AgentOption = {
  id: string;
  source_associate_id: string;
  full_name: string | null;
  source_market_center_id: string | null;
  market_center_name: string | null;
};

type AgentOptionsResponse = {
  items: AgentOption[];
};

type CapRemainingPreviewItem = {
  associate_id: string;
  source_associate_id: string;
  team_id: string | null;
  associate_split_pct: string | null;
  team_commission_split_to_team: string | null;
  cap_amount: string;
  cap_remaining: string;
};

type CapRemainingPreviewResponse = {
  items: CapRemainingPreviewItem[];
};

type StagedTransactionDocument = {
  id: string;
  file: File;
  transaction_document_type: string;
  created_at: string;
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

const AGENT_ROLES = ['Seller', 'Buyer', 'Both', 'PC', 'Outside Agent', 'Other'] as const;

function getRoleOptions(currentRole: string): string[] {
  if (!currentRole) return [...AGENT_ROLES];
  return AGENT_ROLES.includes(currentRole as (typeof AGENT_ROLES)[number])
    ? [...AGENT_ROLES]
    : [currentRole, ...AGENT_ROLES];
}

const PAGE_SIZE = 25;
type TransactionsView = 'summary' | 'register' | 'month_end';
type RegisterDateFilter = '' | 'transaction_date' | 'status_change_date';
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
type MonthEndSortKey =
  | 'status'
  | 'transaction'
  | 'associate'
  | 'market_center'
  | 'listing'
  | 'sales_price'
  | 'reporting_date';
type SortDirection = 'asc' | 'desc';
type TransactionCategoryView = 'sales' | 'rentals';

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

function getPreviousMonthWindow(): { from: string; to: string } {
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    from: prevMonthStart.toISOString().slice(0, 10),
    to: prevMonthEnd.toISOString().slice(0, 10),
  };
}

function toNumberOrZero(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRole(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isContactPlaceholder(value: string | null | undefined): boolean {
  return /^CONTACT:/i.test((value ?? '').trim());
}

function isOutsideRole(value: string): boolean {
  return value.includes('outside');
}

function isOutsideAgentRole(value: string | null | undefined): boolean {
  const normalized = normalizeRole(value);
  return normalized === 'outside agency referral' || normalized === 'outside agent' || normalized === 'outside agency';
}

function normalizeAgentRoleForForm(value: string | null | undefined): string {
  const normalized = normalizeRole(value);
  if (normalized === 'outside agent' || normalized === 'outside agency referral' || normalized === 'outside agency') return 'Outside Agent';
  return value?.trim() ?? '';
}

function getOutsideAgencyDisplayName(outsideAgency: TransactionAgent['outside_agency'] | TransactionFormAgent['outside_agency'] | null | undefined): string {
  const fullName = joinContactName(outsideAgency?.first_name ?? '', outsideAgency?.last_name ?? '');
  if (fullName.length > 0) return fullName;
  const agencyName = (outsideAgency?.agency_name ?? '').trim();
  if (agencyName.length > 0) return agencyName;
  return '';
}

function getTransactionAgentDisplayName(agent: TransactionAgent): string {
  const outsideDisplayName = getOutsideAgencyDisplayName(agent.outside_agency);
  const normalizedRole = normalizeRole(agent.agent_role ?? agent.summary?.transaction_type ?? null);
  const associateName = (agent.associate_name ?? '').trim();
  const sourceAssociateId = (agent.source_associate_id ?? '').trim();

  if (isOutsideRole(normalizedRole) && outsideDisplayName.length > 0) return outsideDisplayName;
  if (associateName.length > 0 && !isContactPlaceholder(associateName)) return associateName;
  if (outsideDisplayName.length > 0) return outsideDisplayName;
  if (sourceAssociateId.length > 0 && !isContactPlaceholder(sourceAssociateId)) return sourceAssociateId;
  if (associateName.length > 0) return associateName;
  if (sourceAssociateId.length > 0) return sourceAssociateId;
  return '-';
}

function getOutsideAgentDisplayName(agent: TransactionFormAgent): string {
  if (!isOutsideAgentRole(agent.agent_role)) return agent.associate_name;
  const outsideDisplayName = getOutsideAgencyDisplayName(agent.outside_agency);
  if (outsideDisplayName.length > 0) return outsideDisplayName;
  if (!isContactPlaceholder(agent.associate_name)) return agent.associate_name;
  return '';
}

function splitNameParts(value: string | null | undefined): { first: string; last: string } {
  const clean = (value ?? '').trim();
  if (clean.length === 0) return { first: '', last: '' };
  const parts = clean.split(/\s+/);
  return {
    first: parts[0] ?? '',
    last: parts.slice(1).join(' '),
  };
}

function toRoleLabel(value: string): string {
  if (value === 'both') return 'Both';
  if (value === 'seller') return 'Seller';
  if (value === 'buyer') return 'Buyer';
  if (value.length === 0) return '-';
  return value
    .split(' ')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function getDerivedTransactionType(formType: string, agents: TransactionFormAgent[]): string {
  const explicit = formType.trim();
  if (explicit.length > 0) {
    return explicit;
  }

  const roles = new Set<string>();
  let hasOutsideRole = false;

  for (const agent of agents) {
    const role = normalizeRole(agent.agent_role);
    if (role.length === 0) {
      continue;
    }
    if (isOutsideAgentRole(role)) {
      hasOutsideRole = true;
      continue;
    }
    roles.add(role);
  }

  if (roles.has('both') || (roles.has('buyer') && roles.has('seller'))) return 'Both';
  if (roles.has('buyer')) return 'Buyer';
  if (roles.has('seller')) return 'Seller';
  if (roles.has('referral')) return 'Referral';
  if (roles.has('other')) return 'Other';
  if (hasOutsideRole) return 'Outside Agency';
  return '';
}

function getDisplayTransactionType(item: TransactionRow): string {
  const explicit = (item.transaction_type ?? '').trim();
  const explicitNormalized = normalizeRole(explicit);

  const internalRoles = new Set<string>();
  let hasOutsideRole = false;

  for (const agent of item.agents ?? []) {
    const role = normalizeRole(agent.agent_role ?? agent.summary?.transaction_type ?? null);
    if (role.length === 0) {
      continue;
    }
    if (isOutsideRole(role)) {
      hasOutsideRole = true;
      continue;
    }
    internalRoles.add(role);
  }

  let inferredInternalType = '';
  if (internalRoles.has('both') || (internalRoles.has('seller') && internalRoles.has('buyer'))) {
    inferredInternalType = 'Both';
  } else if (internalRoles.has('seller')) {
    inferredInternalType = 'Seller';
  } else if (internalRoles.has('buyer')) {
    inferredInternalType = 'Buyer';
  } else if (internalRoles.size === 1) {
    inferredInternalType = toRoleLabel(Array.from(internalRoles)[0]);
  }

  if (explicit.length > 0) {
    if (isOutsideRole(explicitNormalized) && inferredInternalType.length > 0) {
      return inferredInternalType;
    }
    return explicit;
  }

  if (inferredInternalType.length > 0) {
    return inferredInternalType;
  }

  if (hasOutsideRole) {
    return 'Outside Agency';
  }

  return '-';
}

function isRentalTransactionItem(item: TransactionRow | null | undefined): boolean {
  if (!item) return false;
  const category = (item.transaction_category ?? '').trim().toLowerCase();
  const sourceType = (item.source_type ?? '').trim().toLowerCase();
  return category === 'rentals'
    || sourceType === 'rental_payment'
    || item.source_rental_id != null
    || item.source_rental_payment_schedule_id != null;
}

function toPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function toDecimalText(value: number): string {
  return roundMoney(value).toFixed(2);
}

function normalizeAssociateSplitPct(rawSplit: number): number {
  if (rawSplit <= 0) return 70;
  if (rawSplit <= 1) return rawSplit * 100;
  return Math.max(Math.min(rawSplit, 100), 0);
}

function normalizeTeamSplitPct(rawSplit: number): number {
  if (rawSplit <= 0) return 0;
  if (rawSplit <= 1) return Math.max(Math.min(rawSplit * 100, 100), 0);
  return Math.max(Math.min(rawSplit, 100), 0);
}

function normalizeSummarySide(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').trim();
  if (clean.length > 0) return clean;
  return fallback;
}

function buildPreviewCalculatedRows(
  form: TransactionFormState,
  transactionId: string,
  officeFallback: string | null,
  derivedTransactionType: string,
  capRemainingBySourceAssociateId: Map<string, {
    cap_amount: number;
    cap_remaining: number;
    team_id: string | null;
    associate_split_pct: number;
    team_commission_split_to_team: number;
  }>
): CalculatedSummaryItem[] {
  const totalGci = Math.max(toNumberOrZero(form.total_gci), 0);
  const salePrice = Math.max(toNumberOrZero(form.sales_price), 0);
  const listPrice = Math.max(toNumberOrZero(form.list_price), 0);
  const varianceSaleListPct = listPrice > 0 ? ((salePrice - listPrice) / listPrice) * 100 : 0;
  const baseAverageCommissionPct = salePrice > 0 ? (totalGci / salePrice) * 100 : 0;

  return form.agents
    .map((agent, index) => {
      const splitPercentage = Math.max(toNumberOrZero(agent.split_percentage), 0);
      const splitRatio = splitPercentage / 100;
      const transactionGciBeforeFees = roundMoney(totalGci * splitRatio);
      const productionRoyalties = roundMoney(transactionGciBeforeFees * 0.06);
      const growthShare = roundMoney(transactionGciBeforeFees * 0.02);
      const totalPrAndGs = roundMoney(productionRoyalties + growthShare);
      const gciAfterFeesExclVat = roundMoney(transactionGciBeforeFees * 0.92);
      const displayAgentName = getOutsideAgentDisplayName(agent).trim() || agent.associate_name.trim() || '-';
      const roleLabel = normalizeSummarySide(agent.agent_role, derivedTransactionType || '-');
      const isOutsideAgent = isOutsideAgentRole(agent.agent_role);
      const capLookup = capRemainingBySourceAssociateId.get(agent.source_associate_id);
      const effectiveCapRemaining = Math.max(capLookup?.cap_remaining ?? 0, 0);
      const isTeamTransaction = Boolean(capLookup?.team_id);
      const configuredTeamSplit = normalizeTeamSplitPct(capLookup?.team_commission_split_to_team ?? 0);
      const associateSplitPct = isOutsideAgent
        ? 100
        : isTeamTransaction && configuredTeamSplit > 0
          ? configuredTeamSplit
          : normalizeAssociateSplitPct(capLookup?.associate_split_pct ?? 0);
      const marketCenterSplitPct = Math.max(100 - associateSplitPct, 0);
      const associateDollarPreCap = roundMoney(gciAfterFeesExclVat * (associateSplitPct / 100));
      const marketCenterDollar = roundMoney(gciAfterFeesExclVat * (marketCenterSplitPct / 100));

      let adjustedAssociateDollar = isTeamTransaction ? 0 : associateDollarPreCap;
      let adjustedTeamDollar = isTeamTransaction ? associateDollarPreCap : 0;
      let adjustedMarketCenterDollar = marketCenterDollar;

      if (marketCenterDollar > 0) {
        if (effectiveCapRemaining <= 0) {
          const overflow = marketCenterDollar;
          adjustedMarketCenterDollar = 0;
          if (isTeamTransaction) {
            adjustedTeamDollar = roundMoney(adjustedTeamDollar + overflow);
          } else {
            adjustedAssociateDollar = roundMoney(adjustedAssociateDollar + overflow);
          }
        } else if (marketCenterDollar > effectiveCapRemaining) {
          const overflow = roundMoney(marketCenterDollar - effectiveCapRemaining);
          adjustedMarketCenterDollar = roundMoney(effectiveCapRemaining);
          if (isTeamTransaction) {
            adjustedTeamDollar = roundMoney(adjustedTeamDollar + overflow);
          } else {
            adjustedAssociateDollar = roundMoney(adjustedAssociateDollar + overflow);
          }
        }
      }

      return {
        id: `preview-${transactionId}-${index}`,
        transaction_id: transactionId,
        transaction_agent_id: `preview-agent-${index}`,
        associate_id: null,
        source_associate_id: agent.source_associate_id || null,
        is_outside_agent: isOutsideAgent,
        agent_name: displayAgentName,
        office_name: officeFallback,
        transaction_side: roleLabel,
        split_percentage: toDecimalText(splitPercentage),
        variance_sale_list_pct: toDecimalText(varianceSaleListPct),
        transaction_gci_before_fees: toDecimalText(transactionGciBeforeFees),
        average_commission_pct: toDecimalText(baseAverageCommissionPct),
        production_royalties: toDecimalText(productionRoyalties),
        growth_share: toDecimalText(growthShare),
        total_pr_and_gs: toDecimalText(totalPrAndGs),
        gci_after_fees_excl_vat: toDecimalText(gciAfterFeesExclVat),
        associate_dollar: toDecimalText(adjustedAssociateDollar),
        cap_amount: toDecimalText(capLookup?.cap_amount ?? 0),
        cap_remaining: toDecimalText(capLookup?.cap_remaining ?? 0),
        current_cap_remaining: toDecimalText(capLookup?.cap_remaining ?? 0),
        display_cap_remaining: toDecimalText(capLookup?.cap_remaining ?? 0),
        team_dollar: toDecimalText(adjustedTeamDollar),
        market_center_dollar: toDecimalText(adjustedMarketCenterDollar),
      };
    })
    .filter((row) => row.agent_name !== '-' && toNumberOrZero(row.split_percentage) > 0);
}

function buildSnapshotCalculatedRows(transaction: TransactionRow | null | undefined): CalculatedSummaryItem[] {
  if (!transaction) return [];

  return (transaction.agents ?? [])
    .filter((agent) => Boolean(agent.summary))
    .map((agent, index) => ({
      id: `snapshot-${transaction.id}-${index}`,
      transaction_id: String(transaction.id),
      transaction_agent_id: `snapshot-agent-${index}`,
      associate_id: agent.associate_id != null ? String(agent.associate_id) : null,
      source_associate_id: agent.source_associate_id,
      is_outside_agent: Boolean(agent.summary?.is_outside_agent),
      agent_name: getTransactionAgentDisplayName(agent),
      office_name: agent.summary?.office_name ?? transaction.market_center_name,
      transaction_side: agent.summary?.transaction_type ?? null,
      split_percentage: agent.summary?.split_percentage ?? '0',
      variance_sale_list_pct: agent.summary?.variance_sale_list_pct ?? '0',
      transaction_gci_before_fees: agent.summary?.transaction_gci_before_fees ?? '0',
      average_commission_pct: agent.summary?.average_commission_pct ?? '0',
      production_royalties: agent.summary?.production_royalties ?? '0',
      growth_share: agent.summary?.growth_share ?? '0',
      total_pr_and_gs: agent.summary?.total_pr_and_gs ?? '0',
      gci_after_fees_excl_vat: agent.summary?.gci_after_fees_excl_vat ?? '0',
      associate_dollar: agent.summary?.associate_dollar ?? '0',
      cap_amount: agent.summary?.cap_amount ?? '0',
      cap_remaining: agent.summary?.cap_remaining ?? '0',
      team_dollar: agent.summary?.team_dollar ?? '0',
      market_center_dollar: agent.summary?.market_center_dollar ?? '0',
    }));
}

function UiIcon({
  kind,
  className = 'h-4 w-4',
}: {
  kind:
    | 'sales'
    | 'rentals'
    | 'summary'
    | 'register'
    | 'filters'
    | 'window'
    | 'tx'
    | 'value'
    | 'gci'
    | 'split'
    | 'expected'
    | 'net'
    | 'calendar'
    | 'calendar-clock'
    | 'hourglass'
    | 'timeline'
    | 'eye'
    | 'edit'
    | 'file';
  className?: string;
}) {
  if (kind === 'sales') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'rentals') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'summary') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'register') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'filters') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'window') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'tx') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8.5 12 2 2 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'value') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 16.5 10 10.5l4 4L20 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 8h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'gci') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7v10M9.5 9.5c0-1.1 1-2 2.5-2s2.5.9 2.5 2-1 2-2.5 2-2.5.9-2.5 2 1 2 2.5 2 2.5-.9 2.5-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'split') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M19 5 5 19M8 7h.01M16 17h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'expected') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="m9.5 14 1.7 1.7 3.3-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'net') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M21 10h-6a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'calendar-clock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 12v3l2 1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'hourglass') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M7 4h10M7 20h10M8 4c0 4 2 4 4 6-2 2-4 2-4 6M16 4c0 4-2 4-4 6 2 2 4 2 4 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'timeline') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="12" r="1.5" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="17" cy="12" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'eye') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'edit') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="m4 20 4.5-1 9-9-3.5-3.5-9 9L4 20Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="m12.5 6.5 3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function transactionStatusClass(status: string | null | undefined): string {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'registered') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'submitted') return 'bg-blue-100 text-blue-700';
  if (normalized === 'start') return 'bg-slate-100 text-slate-700';
  if (normalized === 'working') return 'bg-amber-100 text-amber-700';
  if (normalized === 'pending') return 'bg-violet-100 text-violet-700';
  if (normalized === 'withdrawn') return 'bg-rose-100 text-rose-700';
  if (normalized === 'rejected') return 'bg-red-100 text-red-700';
  if (normalized === 'accepted') return 'bg-cyan-100 text-cyan-700';
  return 'bg-slate-100 text-slate-700';
}

function buildEmptyOutsideAgency(): OutsideAgencyContact {
  return { first_name: '', last_name: '', email: '', phone: '', agency_name: '' };
}

function buildEmptyPartyContact(): PartyContactForm {
  return { first_name: '', last_name: '', contact_number: '', email_address: '', company_name: '' };
}

function normalizePartyContact(input: unknown): PartyContactForm {
  if (!input || typeof input !== 'object') return buildEmptyPartyContact();
  const value = input as Partial<PartyContactForm> & Record<string, unknown>;
  return {
    first_name: typeof value.first_name === 'string' ? value.first_name : '',
    last_name: typeof value.last_name === 'string' ? value.last_name : '',
    contact_number: typeof value.contact_number === 'string'
      ? value.contact_number
      : typeof value.phone === 'string'
        ? value.phone
        : '',
    email_address: typeof value.email_address === 'string'
      ? value.email_address
      : typeof value.email === 'string'
        ? value.email
        : '',
    company_name: typeof value.company_name === 'string' ? value.company_name : '',
  };
}

function normalizePartyContactList(input: unknown, fallbackName?: string | null): PartyContactForm[] {
  if (Array.isArray(input)) {
    const normalized = input.map((entry) => normalizePartyContact(entry));
    if (normalized.length > 0) return normalized;
  }

  if (input && typeof input === 'object') {
    return [normalizePartyContact(input)];
  }

  const fallback = (fallbackName ?? '').trim();
  if (fallback.length > 0) {
    const parts = fallback.split(/\s+/);
    return [{
      ...buildEmptyPartyContact(),
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
    }];
  }

  return [buildEmptyPartyContact()];
}

function isPartyContactFilled(contact: PartyContactForm): boolean {
  return [contact.first_name, contact.last_name, contact.contact_number, contact.email_address, contact.company_name]
    .some((value) => value.trim().length > 0);
}

function compactPartyContactName(contact: PartyContactForm, fallbackLabel: string): string {
  const fullName = joinContactName(contact.first_name, contact.last_name);
  if (fullName.length > 0) return fullName;
  if (contact.company_name.trim().length > 0) return contact.company_name.trim();
  return fallbackLabel;
}

function sanitizePartyContacts(contacts: PartyContactForm[]): PartyContactForm[] {
  const filtered = contacts.filter((contact) => isPartyContactFilled(contact));
  return filtered.length > 0 ? filtered : [buildEmptyPartyContact()];
}

function joinContactName(firstName: string, lastName: string): string {
  return [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(' ');
}

export default function TransactionsPage() {
  const { token, activeContext, isRegionalAdmin } = useAuth();
  const previousMonthWindow = useMemo(() => getPreviousMonthWindow(), []);
  const [categoryView, setCategoryView] = useState<TransactionCategoryView>('sales');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [registerDateFilter, setRegisterDateFilter] = useState<RegisterDateFilter>('');
  const [registerDateFrom, setRegisterDateFrom] = useState('');
  const [registerDateTo, setRegisterDateTo] = useState('');
  const [view, setView] = useState<TransactionsView>('summary');
  const [showSummaryFilters, setShowSummaryFilters] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [detailViewId, setDetailViewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<TransactionEditTab>('details');
  const [quickSummaryRow, setQuickSummaryRow] = useState<TransactionRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [registerSortKey, setRegisterSortKey] = useState<RegisterSortKey>('status_change_date');
  const [registerSortDirection, setRegisterSortDirection] = useState<SortDirection>('desc');
  const [listingSearchQuery, setListingSearchQuery] = useState('');
  const [listingSearchOpen, setListingSearchOpen] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentTypeInput, setDocumentTypeInput] = useState('');
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [stagedDocuments, setStagedDocuments] = useState<StagedTransactionDocument[]>([]);
  const [monthEndDateFrom, setMonthEndDateFrom] = useState(previousMonthWindow.from);
  const [monthEndDateTo, setMonthEndDateTo] = useState(previousMonthWindow.to);
  const [isPreviewingMonthEnd, setIsPreviewingMonthEnd] = useState(false);
  const [isSubmittingMonthEnd, setIsSubmittingMonthEnd] = useState(false);
  const [monthEndError, setMonthEndError] = useState<string | null>(null);
  const [monthEndPreview, setMonthEndPreview] = useState<MonthEndPreviewResponse | null>(null);
  const [monthEndSubmission, setMonthEndSubmission] = useState<MonthEndSubmitResponse | null>(null);
  const [allowSubmitWithErrors, setAllowSubmitWithErrors] = useState(false);
  const [monthEndSortKey, setMonthEndSortKey] = useState<MonthEndSortKey>('status');
  const [monthEndSortDirection, setMonthEndSortDirection] = useState<SortDirection>('asc');
  const [form, setForm] = useState<TransactionFormState>({
    source_transaction_id: '',
    transaction_number: '',
    transaction_status: 'Start',
    status_change_date: '',
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
    buyer: '',
    seller: '',
    transfer_attorney: '',
    buyer_contacts: [buildEmptyPartyContact()],
    seller_contacts: [buildEmptyPartyContact()],
    transfer_attorney_contact: buildEmptyPartyContact(),
    bond_attorney_contact: buildEmptyPartyContact(),
    bond_originator_contact: buildEmptyPartyContact(),
    bond_attorney: '',
    bond_originator: '',
    all_parties_invoiced: '',
    transaction_date: '',
    expected_date: '',
    agents: [],
  });

  const activeContextId = activeContext?.id ?? 'no-context';
  const authHeaders: Record<string, string> = {};
  if (token) authHeaders.Authorization = `Bearer ${token}`;
  if (activeContext?.id) authHeaders['X-Active-Context'] = activeContext.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      'transactions',
      activeContextId,
      categoryView,
      page,
      search,
      status,
      registerDateFilter,
      registerDateFrom,
      registerDateTo,
    ],
    queryFn: async ({ signal }) => {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      if (status.trim()) params.set('status', status.trim());
      if (registerDateFilter) {
        params.set('date_filter', registerDateFilter);
        if (registerDateFrom) params.set('date_from', registerDateFrom);
        if (registerDateTo) params.set('date_to', registerDateTo);
      }
      params.set('category', categoryView);

      const response = await fetchWithTimeout(`/api/transactions?${params.toString()}`, { signal });
      if (!response.ok) {
        throw new Error('Unable to load transactions');
      }
      return response.json() as Promise<TransactionsResponse>;
    },
    placeholderData: (prev) => prev,
    refetchInterval: () => msUntilNextHour(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    setPage(1);
    void refetch();
  }, [activeContextId, refetch]);

  const { data: summaryData, isLoading: isSummaryLoading, isError: isSummaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['transactions-summary', activeContextId, categoryView],
    queryFn: async ({ signal }) => {
      const response = await fetchWithTimeout(`/api/transactions/summary?category=${encodeURIComponent(categoryView)}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unable to load transactions summary');
      return response.json() as Promise<TransactionsSummaryResponse>;
    },
    refetchInterval: () => msUntilNextHour(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: agentOptionsData } = useQuery({
    queryKey: ['agent-options', activeContextId],
    queryFn: () =>
      fetch('/api/agents/options').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load agent options');
        return r.json() as Promise<AgentOptionsResponse>;
      }),
  });

  const { refetch: refetchNextNumber } = useQuery({
    queryKey: ['transactions-next-number', activeContextId],
    queryFn: () =>
      fetch('/api/transactions/next-number').then(async (r) => {
        if (!r.ok) throw new Error('Unable to fetch next transaction number');
        return r.json() as Promise<{ next_transaction_number: string }>;
      }),
    enabled: false,
  });

  const { refetch: refetchNextPocketListingNumber, isFetching: isGeneratingPocketListingNumber } = useQuery({
    queryKey: ['transactions-next-pocket-listing-number', activeContextId],
    queryFn: async ({ signal }) => {
      let response = await fetchWithTimeout('/api/transactions/pocket-listing-number/next', {
        method: 'POST',
        headers: authHeaders,
        signal,
      });
      if (response.status === 404) {
        response = await fetchWithTimeout('/api/transactions/next-pocket-listing-number', {
          method: 'POST',
          headers: authHeaders,
          signal,
        });
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Unable to generate pocket listing number');
      }
      return response.json() as Promise<{ pocket_listing_number: string }>;
    },
    enabled: false,
  });

  const { data: listingSearchData } = useQuery({
    queryKey: ['listing-search', activeContextId, listingSearchQuery],
    queryFn: () =>
      fetch(`/api/listings/search?q=${encodeURIComponent(listingSearchQuery)}`).then(r => r.json() as Promise<ListingSearchResponse>),
    enabled: listingSearchQuery.length >= 2,
    staleTime: 30000,
  });

  const {
    data: editDocumentsData,
    isLoading: isEditDocumentsLoading,
    refetch: refetchEditDocuments,
  } = useQuery({
    queryKey: ['transaction-edit-documents', activeContextId, editingId],
    queryFn: () =>
      fetch(`/api/transactions/${editingId}/documents`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) throw new Error('Unable to load transaction documents');
        return r.json() as Promise<{ items: TransactionDocumentRow[] }>;
      }),
    enabled: Boolean(editingId) && editTab === 'documents',
  });

  const {
    data: quickSummaryData,
    isLoading: isQuickSummaryLoading,
  } = useQuery({
    queryKey: ['transaction-quick-summary', activeContextId, quickSummaryRow?.id],
    queryFn: async ({ signal }) => {
      const response = await fetchWithTimeout(`/api/transactions/${quickSummaryRow!.id}/calculated-summary`, {
        headers: authHeaders,
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unable to load quick summary');
      return response.json() as Promise<CalculatedSummaryResponse>;
    },
    enabled: Boolean(quickSummaryRow?.id),
    retry: 1,
  });

  const {
    data: editSummaryData,
    isLoading: isEditSummaryLoading,
  } = useQuery({
    queryKey: ['transaction-edit-summary', activeContextId, editingId],
    queryFn: async ({ signal }) => {
      const response = await fetchWithTimeout(`/api/transactions/${editingId}/calculated-summary`, {
        headers: authHeaders,
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unable to load transaction summary');
      return response.json() as Promise<CalculatedSummaryResponse>;
    },
    enabled: Boolean(editingId) && editTab === 'summary',
    retry: 1,
  });

  const previewAssociateIds = useMemo(() => {
    const bySourceAssociateId = new Map((agentOptionsData?.items ?? []).map((item) => [item.source_associate_id, item]));
    return Array.from(new Set(
      form.agents
        .map((agent) => bySourceAssociateId.get(agent.source_associate_id)?.id ?? null)
        .filter((value): value is string => Boolean(value))
    ));
  }, [agentOptionsData?.items, form.agents]);

  const { data: previewCapRemainingData } = useQuery({
    queryKey: ['transaction-preview-cap-remaining', activeContextId, previewAssociateIds.join(',')],
    queryFn: async ({ signal }) => {
      const response = await fetchWithTimeout('/api/transactions/preview-cap-remaining', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ associate_ids: previewAssociateIds }),
        signal,
      });
      if (!response.ok) {
        throw new Error('Unable to load preview cap remaining');
      }
      return response.json() as Promise<CapRemainingPreviewResponse>;
    },
    enabled: previewAssociateIds.length > 0,
    retry: 1,
  });

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data?.total]);

  const filteredItems = useMemo(() => {
    return data?.items ?? [];
  }, [data?.items]);

  const isRentalsCategory = categoryView === 'rentals';

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
            a.agents.length > 0 ? getTransactionAgentDisplayName(a.agents[0]) : '',
            b.agents.length > 0 ? getTransactionAgentDisplayName(b.agents[0]) : ''
          );
          break;
        case 'market_center':
          result = compareText(a.market_center_name, b.market_center_name);
          break;
        case 'type':
          result = compareText(getDisplayTransactionType(a), getDisplayTransactionType(b));
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
      ? 'All Statuses This Month (Month End parity)'
      : 'Registered MTD (Month End parity)';

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
    setDocumentActionError(null);
    setDocumentTypeInput('');
    setStagedDocuments([]);
    setForm({
      source_transaction_id: '',
      transaction_number: '',
      transaction_status: 'Start',
      status_change_date: today,
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
      buyer: '',
      seller: '',
      transfer_attorney: '',
      buyer_contacts: [buildEmptyPartyContact()],
      seller_contacts: [buildEmptyPartyContact()],
      transfer_attorney_contact: buildEmptyPartyContact(),
      bond_attorney_contact: buildEmptyPartyContact(),
      bond_originator_contact: buildEmptyPartyContact(),
      bond_attorney: '',
      bond_originator: '',
      all_parties_invoiced: '',
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
    setListingSearchQuery(item.listing_number ?? '');
    setListingSearchOpen(false);
    setDocumentActionError(null);
    setDocumentTypeInput('');
    setStagedDocuments([]);
    setForm({
      source_transaction_id: item.source_transaction_id,
      transaction_number: item.transaction_number ?? '',
      transaction_status: item.transaction_status ?? '',
      status_change_date: toInputDate(item.status_change_date),
      transaction_type: item.transaction_type ?? (getDisplayTransactionType(item) === '-' ? '' : getDisplayTransactionType(item)),
      source_listing_id: item.source_listing_id ?? '',
      listing_number: item.listing_number ?? '',
      address: item.address ?? '',
      suburb: item.suburb ?? '',
      city: item.city ?? '',
      sales_price: item.sales_price ?? '',
      list_price: item.list_price ?? '',
      net_comm: item.net_comm ?? '',
      total_gci: item.total_gci ?? '',
      buyer: item.buyer ?? '',
      seller: item.seller ?? '',
      transfer_attorney: item.transfer_attorney ?? '',
      buyer_contacts: normalizePartyContactList(item.party_contact_details?.buyer_contacts ?? item.party_contact_details?.buyer, item.buyer),
      seller_contacts: normalizePartyContactList(item.party_contact_details?.seller_contacts ?? item.party_contact_details?.seller, item.seller),
      transfer_attorney_contact: normalizePartyContact(item.party_contact_details?.transfer_attorney),
      bond_attorney_contact: normalizePartyContact(item.party_contact_details?.bond_attorney),
      bond_originator_contact: normalizePartyContact(item.party_contact_details?.bond_originator),
      bond_attorney: item.bond_attorney ?? '',
      bond_originator: item.bond_originator ?? '',
      all_parties_invoiced: item.all_parties_invoiced ?? '',
      transaction_date: toInputDate(item.transaction_date),
      expected_date: toInputDate(item.expected_date),
      agents: (item.agents ?? []).map((a) => ({
        ...(function buildAgentWithOutsideFallback() {
          const displayName = getTransactionAgentDisplayName(a);
          const parsedName = splitNameParts(displayName === '-' ? '' : displayName);
          return {
            source_associate_id: a.source_associate_id ?? '',
            associate_name: displayName === '-' ? '' : displayName,
            agent_role: normalizeAgentRoleForForm(a.agent_role ?? a.summary?.transaction_type ?? item.transaction_type ?? ''),
            split_percentage: a.split_percentage ? String(a.split_percentage) : '',
            outside_agency: {
              first_name: a.outside_agency?.first_name ?? parsedName.first,
              last_name: a.outside_agency?.last_name ?? parsedName.last,
              email: a.outside_agency?.email ?? '',
              phone: a.outside_agency?.phone ?? '',
              agency_name: a.outside_agency?.agency_name ?? '',
            },
          };
        })(),
      })),
    });
    setIsFormOpen(true);
    setEditTab('details');
  }

  async function uploadTransactionDocumentToId(transactionId: string, file: File, documentType: string): Promise<void> {
    const payload = new FormData();
    payload.append('document', file);
    payload.append('transaction_document_type', documentType.trim() || 'OTHER');

    const response = await fetch(`/api/transactions/${transactionId}/documents/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: payload,
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `Failed to upload ${file.name}`);
    }
  }

  async function saveTransaction(): Promise<void> {
    setIsSaving(true);
    setFormError(null);
    try {
      const isCreating = !editingId;
      const computedAfterFeesExclVat = toDecimalText(Math.max(toNumberOrZero(form.total_gci), 0) * 0.92);
      const effectiveNetCommission = isEditingRentalTransaction
        ? form.net_comm
        : computedAfterFeesExclVat;
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/transactions/${editingId}` : '/api/transactions';
      const buyerContacts = sanitizePartyContacts(form.buyer_contacts);
      const sellerContacts = sanitizePartyContacts(form.seller_contacts);
      const primaryBuyer = buyerContacts[0];
      const primarySeller = sellerContacts[0];
      const buyerName = buyerContacts.map((contact, idx) => compactPartyContactName(contact, `Buyer ${idx + 1}`)).join(', ');
      const sellerName = sellerContacts.map((contact, idx) => compactPartyContactName(contact, `Seller ${idx + 1}`)).join(', ');
      const transferAttorneyName = joinContactName(form.transfer_attorney_contact.first_name, form.transfer_attorney_contact.last_name);
      const bondAttorneyName = joinContactName(form.bond_attorney_contact.first_name, form.bond_attorney_contact.last_name);
      const bondOriginatorName = joinContactName(form.bond_originator_contact.first_name, form.bond_originator_contact.last_name);
      const partyContactDetails = {
        buyer: primaryBuyer,
        seller: primarySeller,
        buyer_contacts: buyerContacts,
        seller_contacts: sellerContacts,
        transfer_attorney: form.transfer_attorney_contact,
        bond_attorney: form.bond_attorney_contact,
        bond_originator: form.bond_originator_contact,
      };
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          net_comm: effectiveNetCommission,
          transaction_type: derivedTransactionType || form.transaction_type || null,
          status_change_date: form.status_change_date || null,
          buyer: form.buyer || buyerName,
          seller: form.seller || sellerName,
          transfer_attorney: form.transfer_attorney || transferAttorneyName || form.transfer_attorney_contact.company_name,
          ta_mobile_phone: form.transfer_attorney_contact.contact_number,
          ta_email: form.transfer_attorney_contact.email_address,
          bond_attorney: form.bond_attorney || bondAttorneyName || form.bond_attorney_contact.company_name,
          ba_mobile_phone: form.bond_attorney_contact.contact_number,
          ba_email: form.bond_attorney_contact.email_address,
          bond_originator: form.bond_originator || bondOriginatorName || form.bond_originator_contact.company_name,
          party_contact_details: partyContactDetails,
          buyer_contacts: buyerContacts,
          seller_contacts: sellerContacts,
          buyer_first_name: primaryBuyer.first_name,
          buyer_last_name: primaryBuyer.last_name,
          buyer_contact_number: primaryBuyer.contact_number,
          buyer_email_address: primaryBuyer.email_address,
          seller_first_name: primarySeller.first_name,
          seller_last_name: primarySeller.last_name,
          seller_contact_number: primarySeller.contact_number,
          seller_email_address: primarySeller.email_address,
          transfer_attorney_first_name: form.transfer_attorney_contact.first_name,
          transfer_attorney_last_name: form.transfer_attorney_contact.last_name,
          transfer_attorney_contact_number: form.transfer_attorney_contact.contact_number,
          transfer_attorney_email_address: form.transfer_attorney_contact.email_address,
          transfer_attorney_company_name: form.transfer_attorney_contact.company_name,
          bond_attorney_first_name: form.bond_attorney_contact.first_name,
          bond_attorney_last_name: form.bond_attorney_contact.last_name,
          bond_attorney_contact_number: form.bond_attorney_contact.contact_number,
          bond_attorney_email_address: form.bond_attorney_contact.email_address,
          bond_attorney_company_name: form.bond_attorney_contact.company_name,
          bond_originator_first_name: form.bond_originator_contact.first_name,
          bond_originator_last_name: form.bond_originator_contact.last_name,
          bond_originator_contact_number: form.bond_originator_contact.contact_number,
          bond_originator_email_address: form.bond_originator_contact.email_address,
          bond_originator_company_name: form.bond_originator_contact.company_name,
          agents: form.agents
            .filter((a) => {
              if (a.source_associate_id) return true;
              if (isOutsideAgentRole(a.agent_role)) {
                return Boolean(
                  a.outside_agency.first_name.trim()
                  || a.outside_agency.last_name.trim()
                  || a.outside_agency.agency_name.trim()
                );
              }
              return false;
            })
            .map((a) => ({
              ...a,
              agent_role: normalizeAgentRoleForForm(a.agent_role),
              associate_name: getOutsideAgentDisplayName(a),
            })),
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string; warning?: string };
      if (!response.ok) {
        throw new Error(json.error ?? 'Failed to save transaction');
      }

      const savedTransactionId = String(editingId ?? json.id ?? '');
      if (isCreating && savedTransactionId && stagedDocuments.length > 0) {
        const uploadResults = await Promise.allSettled(
          stagedDocuments.map((doc) => uploadTransactionDocumentToId(savedTransactionId, doc.file, doc.transaction_document_type))
        );
        const failedFiles = uploadResults
          .map((result, index) => ({ result, fileName: stagedDocuments[index]?.file.name ?? 'Unknown file' }))
          .filter((entry) => entry.result.status === 'rejected')
          .map((entry) => entry.fileName);

        if (failedFiles.length > 0) {
          setEditingId(savedTransactionId);
          setEditTab('documents');
          setStagedDocuments([]);
          setFormError(`Transaction saved, but document upload failed for: ${failedFiles.join(', ')}`);
          await Promise.all([refetch(), refetchSummary()]);
          return;
        }

        setStagedDocuments([]);
      }

      setIsFormOpen(false);
      await Promise.all([refetch(), refetchSummary()]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save transaction');
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadTransactionDocument(file: File): Promise<void> {
    if (!editingId) return;
    setIsUploadingDocument(true);
    setDocumentActionError(null);

    try {
      await uploadTransactionDocumentToId(editingId, file, documentTypeInput);

      await refetchEditDocuments();
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Failed to upload document');
    } finally {
      setIsUploadingDocument(false);
    }
  }

  async function deleteTransactionDocument(documentId: string): Promise<void> {
    if (!editingId) return;
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
    try {
      const response = await fetch(`/api/transactions/${editingId}/documents/${numericId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      if (!response.ok && response.status !== 204) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Failed to delete document');
      }

      await refetchEditDocuments();
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Failed to delete document');
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
      } else if (field === 'agent_role') {
        updated[index].agent_role = normalizeAgentRoleForForm(value);
        if (isOutsideAgentRole(updated[index].agent_role)) {
          updated[index].source_associate_id = '';
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

  async function generatePocketListingNumber(): Promise<void> {
    setFormError(null);
    try {
      const result = await refetchNextPocketListingNumber();
      const pocketListingNumber = result.data?.pocket_listing_number?.trim() ?? '';
      if (!pocketListingNumber) {
        throw new Error('Unable to generate pocket listing number');
      }

      setForm((prev) => ({
        ...prev,
        listing_number: pocketListingNumber,
        source_listing_id: pocketListingNumber,
      }));
      setListingSearchQuery(pocketListingNumber);
      setListingSearchOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to generate pocket listing number');
    }
  }

  const derivedTransactionType = getDerivedTransactionType(form.transaction_type, form.agents);
  const isPocketListingLocked = /^KWPL\d+$/i.test((form.listing_number ?? '').trim())
    || /^KWPL\d+$/i.test((form.source_listing_id ?? '').trim());
  const currentEditingRow = editingId ? (data?.items ?? []).find((x) => x.id === editingId) : null;
  const isEditingRentalTransaction = isRentalTransactionItem(currentEditingRow);
  const previewCapRemainingLookup = useMemo(() => {
    const map = new Map<string, {
      cap_amount: number;
      cap_remaining: number;
      team_id: string | null;
      associate_split_pct: number;
      team_commission_split_to_team: number;
    }>();
    for (const item of previewCapRemainingData?.items ?? []) {
      map.set(item.source_associate_id, {
        cap_amount: toNumberOrZero(item.cap_amount),
        cap_remaining: toNumberOrZero(item.cap_remaining),
        team_id: item.team_id ?? null,
        associate_split_pct: toNumberOrZero(item.associate_split_pct),
        team_commission_split_to_team: toNumberOrZero(item.team_commission_split_to_team),
      });
    }
    return map;
  }, [previewCapRemainingData?.items]);
  const livePreviewRows = useMemo(
    () => buildPreviewCalculatedRows(
      form,
      editingId ?? 'new-transaction',
      currentEditingRow?.market_center_name ?? null,
      derivedTransactionType,
      previewCapRemainingLookup,
    ),
    [currentEditingRow?.market_center_name, derivedTransactionType, editingId, form, previewCapRemainingLookup]
  );
  const hasLivePreviewInputs = useMemo(() => {
    if (isEditingRentalTransaction) return false;
    const hasTotalGci = toNumberOrZero(form.total_gci) > 0;
    const hasSalePrice = toNumberOrZero(form.sales_price) > 0;
    const hasListPrice = toNumberOrZero(form.list_price) > 0;
    const hasAgents = form.agents.some((agent) => {
      const hasRole = normalizeRole(agent.agent_role).length > 0;
      const hasIdentity = isOutsideAgentRole(agent.agent_role)
        ? getOutsideAgentDisplayName(agent).trim().length > 0
        : agent.source_associate_id.trim().length > 0;
      const hasSplit = toNumberOrZero(agent.split_percentage) > 0;
      return hasRole && hasIdentity && hasSplit;
    });
    const hasType = derivedTransactionType.trim().length > 0 || form.agents.some((agent) => normalizeRole(agent.agent_role).length > 0);
    return hasTotalGci && hasSalePrice && hasListPrice && hasAgents && hasType;
  }, [derivedTransactionType, form.agents, form.list_price, form.sales_price, form.total_gci, isEditingRentalTransaction]);
  // Keep backend calculated-summary as source of truth for persisted transactions.
  // Use frontend live preview only while creating a new unsaved transaction.
  const shouldUseLivePreviewRows = !editingId && hasLivePreviewInputs && livePreviewRows.length > 0;
  const snapshotEditCalculatedRows = useMemo(() => buildSnapshotCalculatedRows(currentEditingRow), [currentEditingRow]);
  const savedCalculatedSummaryRows = (editSummaryData?.items?.length ?? 0) > 0
    ? (editSummaryData?.items ?? [])
    : snapshotEditCalculatedRows;
  const calculatedSummaryRows = shouldUseLivePreviewRows
    ? livePreviewRows
    : savedCalculatedSummaryRows;
  const snapshotQuickCalculatedRows = useMemo(() => buildSnapshotCalculatedRows(quickSummaryRow), [quickSummaryRow]);
  const quickSummaryCalculatedRows = (quickSummaryData?.items?.length ?? 0) > 0
    ? (quickSummaryData?.items ?? [])
    : snapshotQuickCalculatedRows;
  const isShowingPreviewForEdit = Boolean(editingId) && shouldUseLivePreviewRows;

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

  const sortedMonthEndItems = useMemo(() => {
    const rows = [...(monthEndPreview?.items ?? [])];

    const compareText = (left: string | null | undefined, right: string | null | undefined): number =>
      (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base', numeric: true });

    const compareNumber = (left: number | null | undefined, right: number | null | undefined): number =>
      (left ?? 0) - (right ?? 0);

    const compareDate = (left: string | null | undefined, right: string | null | undefined): number => {
      const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    };

    rows.sort((left, right) => {
      let result = 0;

      switch (monthEndSortKey) {
        case 'status': {
          const rank = (value: 'ready' | 'error') => (value === 'ready' ? 0 : 1);
          result = rank(left.status) - rank(right.status);
          break;
        }
        case 'transaction':
          result = compareText(left.transaction_number ?? left.transaction_id, right.transaction_number ?? right.transaction_id);
          break;
        case 'associate':
          result = compareText(left.associate_name, right.associate_name);
          break;
        case 'market_center':
          result = compareText(left.market_center_name, right.market_center_name);
          break;
        case 'listing':
          result = compareText(left.listing_number, right.listing_number);
          break;
        case 'sales_price':
          result = compareNumber(left.sales_price, right.sales_price);
          break;
        case 'reporting_date':
          result = compareDate(left.effective_reporting_date, right.effective_reporting_date);
          break;
      }

      if (result === 0) {
        result = compareText(left.transaction_number ?? left.transaction_id, right.transaction_number ?? right.transaction_id);
      }

      return monthEndSortDirection === 'asc' ? result : -result;
    });

    return rows;
  }, [monthEndPreview?.items, monthEndSortDirection, monthEndSortKey]);

  function toggleMonthEndSort(key: MonthEndSortKey): void {
    if (monthEndSortKey === key) {
      setMonthEndSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    const defaultDirection: SortDirection = key === 'sales_price' || key === 'reporting_date' ? 'desc' : 'asc';
    setMonthEndSortKey(key);
    setMonthEndSortDirection(defaultDirection);
  }

  function monthEndSortIndicator(key: MonthEndSortKey): string {
    if (monthEndSortKey !== key) return '↕';
    return monthEndSortDirection === 'asc' ? '↑' : '↓';
  }

  async function runMonthEndPreview(): Promise<void> {
    setIsPreviewingMonthEnd(true);
    setMonthEndError(null);
    setMonthEndSubmission(null);
    try {
      const params = new URLSearchParams({
        date_from: monthEndDateFrom,
        date_to: monthEndDateTo,
        include_details: '1',
        limit: '400',
      });
      const response = await fetchWithTimeout(`/api/frontdoor-submissions/monthly/preview?${params.toString()}`, {
        headers: authHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as MonthEndPreviewResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to run FrontDoor test batch preview');
      }
      setMonthEndPreview(payload);
    } catch (error) {
      setMonthEndError(error instanceof Error ? error.message : 'Unable to run month-end preview');
    } finally {
      setIsPreviewingMonthEnd(false);
    }
  }

  async function submitMonthEndBatch(): Promise<void> {
    setIsSubmittingMonthEnd(true);
    setMonthEndError(null);
    try {
      const response = await fetchWithTimeout('/api/frontdoor-submissions/monthly', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date_from: monthEndDateFrom,
          date_to: monthEndDateTo,
          limit: Math.max(monthEndPreview?.total_candidates ?? 500, 500),
        }),
      }, 60000);
      const payload = (await response.json().catch(() => ({}))) as MonthEndSubmitResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to submit month-end FrontDoor batch');
      }
      setMonthEndSubmission(payload);
    } catch (error) {
      setMonthEndError(error instanceof Error ? error.message : 'Unable to submit month-end batch');
    } finally {
      setIsSubmittingMonthEnd(false);
    }
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
          {!isRentalsCategory && (
            <button className="primary-btn inline-flex items-center gap-2" type="button" onClick={openCreateForm}>
              <UiIcon kind="file" className="h-4 w-4" />
              Add Transaction
            </button>
          )}
        </div>
      </div>

      <section className="surface-card p-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCategoryView('sales');
              setView('summary');
              setSearch('');
              setStatus('');
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${categoryView === 'sales' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <UiIcon kind="sales" className="h-4 w-4" />
            Sales
          </button>
          <button
            type="button"
            onClick={() => {
              setCategoryView('rentals');
              setView('register');
              setSearch('');
              setStatus('');
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${categoryView === 'rentals' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <UiIcon kind="rentals" className="h-4 w-4" />
            Rentals
          </button>

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setView('summary')}
            disabled={isRentalsCategory}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${view === 'summary' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'} ${isRentalsCategory ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <UiIcon kind="summary" className="h-4 w-4" />
            Summary
          </button>
          <button
            type="button"
            onClick={() => setView('register')}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${view === 'register' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <UiIcon kind="register" className="h-4 w-4" />
            {isRentalsCategory ? 'Rental Transactions' : 'Transaction Register'}
          </button>
          {!isRentalsCategory && isRegionalAdmin && (
            <button
              type="button"
              onClick={() => setView('month_end')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${view === 'month_end' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <UiIcon kind="calendar-clock" className="h-4 w-4" />
              Month End
            </button>
          )}
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
                    <h3 className="text-lg font-semibold text-slate-900">{isEditingRentalTransaction ? 'Rental Transaction Details' : 'Transaction Details'}</h3>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-slate-700">Transaction Information</h4>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Number</span>
                          <input className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" placeholder="Auto-generated on save" value={form.transaction_number} readOnly />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Status</span>
                          <select
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={form.transaction_status}
                            onChange={(e) => setForm((p) => {
                              const nextStatus = e.target.value;
                              const today = new Date().toISOString().slice(0, 10);
                              return {
                                ...p,
                                transaction_status: nextStatus,
                                status_change_date: p.transaction_status !== nextStatus ? today : p.status_change_date,
                              };
                            })}
                          >
                            {TRANSACTION_STATUSES.map((sv) => (
                              <option key={sv} value={sv}>{sv}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Status Change Date</span>
                          <input
                            className={`rounded-lg border border-slate-300 px-3 py-2 text-sm ${isRegionalAdmin ? '' : 'bg-slate-50 text-slate-600'}`}
                            type="date"
                            value={form.status_change_date}
                            onChange={(e) => setForm((p) => ({ ...p, status_change_date: e.target.value }))}
                            readOnly={!isRegionalAdmin}
                            disabled={!isRegionalAdmin}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Transaction Type</span>
                          <input
                            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                            value={derivedTransactionType}
                            readOnly
                          />
                          <span className="text-[11px] text-slate-500">
                            Derived from the assigned agent roles. If both buyer and seller roles are present, this becomes Both.
                          </span>
                        </label>
                        <div className="flex flex-col gap-1 relative lg:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-600">Listing</span>
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => { void generatePocketListingNumber(); }}
                              disabled={isGeneratingPocketListingNumber || isPocketListingLocked}
                            >
                              {isGeneratingPocketListingNumber ? 'Generating...' : 'Pocket Listings'}
                            </button>
                          </div>
                          <input
                            className={`rounded-lg border border-slate-300 px-3 py-2 text-sm ${isPocketListingLocked ? 'bg-slate-50 text-slate-600' : ''}`}
                            placeholder="Search by listing number, address or suburb..."
                            value={isPocketListingLocked ? form.listing_number : (listingSearchQuery || form.listing_number)}
                            onChange={(e) => {
                              if (isPocketListingLocked) return;
                              setListingSearchQuery(e.target.value);
                              setListingSearchOpen(true);
                            }}
                            onFocus={() => {
                              if (isPocketListingLocked) return;
                              if (listingSearchQuery.length >= 2) setListingSearchOpen(true);
                            }}
                            onBlur={() => setTimeout(() => setListingSearchOpen(false), 150)}
                            autoComplete="off"
                            readOnly={isPocketListingLocked}
                          />
                          {listingSearchOpen && !isPocketListingLocked && (listingSearchData?.items ?? []).length > 0 && (
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
                          {isPocketListingLocked && (
                            <p className="text-[11px] text-slate-500">Pocket listing number is locked once generated.</p>
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
                        {isEditingRentalTransaction ? (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-600">Rental Amount (Optional)</span>
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Rental amount" value={form.sales_price} onChange={(e) => setForm((p) => ({ ...p, sales_price: e.target.value }))} />
                          </label>
                        ) : (
                          <>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-slate-600">Sales Price</span>
                              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Sales price" value={form.sales_price} onChange={(e) => setForm((p) => ({ ...p, sales_price: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-slate-600">List Price</span>
                              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="List price" value={form.list_price} onChange={(e) => setForm((p) => ({ ...p, list_price: e.target.value }))} />
                            </label>
                          </>
                        )}
                        {isEditingRentalTransaction && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-600">Agent Net Amount</span>
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Agent net amount" value={form.net_comm} onChange={(e) => setForm((p) => ({ ...p, net_comm: e.target.value }))} />
                          </label>
                        )}
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">{isEditingRentalTransaction ? 'Gross Commission' : 'Total GCI'}</span>
                          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={isEditingRentalTransaction ? 'Gross commission' : 'Total GCI'} value={form.total_gci} onChange={(e) => setForm((p) => ({ ...p, total_gci: e.target.value }))} />
                        </label>
                        {!isEditingRentalTransaction && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-600">GCI After Fees Excl VAT (Auto)</span>
                            <input
                              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                              value={toDecimalText(Math.max(toNumberOrZero(form.total_gci), 0) * 0.92)}
                              readOnly
                            />
                          </label>
                        )}
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
                                {!isOutsideAgentRole(agent.agent_role) && (
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
                                )}
                                <label className="w-28 flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Split %</span>
                                  <input type="number" step="0.01" min="0" max="100" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="0.00" value={agent.split_percentage} onChange={(e) => updateAgent(idx, 'split_percentage', e.target.value)} />
                                </label>
                                <button type="button" onClick={() => removeAgent(idx)} className="rounded-lg bg-red-50 px-2 py-2 text-sm font-medium text-red-600 hover:bg-red-100">
                                  Remove
                                </button>
                              </div>
                              {isOutsideAgentRole(agent.agent_role) && (
                                <div className="grid grid-cols-2 gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                                  <p className="col-span-2 text-xs font-semibold text-amber-900">Outside Agent Details</p>
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
                    <div className="grid gap-4 xl:grid-cols-2">
                      <section className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-base font-semibold">Buyers</h4>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            onClick={() => setForm((prev) => ({ ...prev, buyer_contacts: [...prev.buyer_contacts, buildEmptyPartyContact()] }))}
                          >
                            + Add Buyer
                          </button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {form.buyer_contacts.map((contact, idx) => (
                            <details key={`buyer-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50">
                              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-800">
                                <span>{compactPartyContactName(contact, `Buyer ${idx + 1}`)}</span>
                                {form.buyer_contacts.length > 1 && (
                                  <button
                                    type="button"
                                    className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setForm((prev) => ({ ...prev, buyer_contacts: prev.buyer_contacts.filter((_, i) => i !== idx) }));
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </summary>
                              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">First Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.first_name} onChange={(e) => setForm((prev) => ({ ...prev, buyer_contacts: prev.buyer_contacts.map((entry, i) => i === idx ? { ...entry, first_name: e.target.value } : entry) }))} placeholder="First name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Last Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.last_name} onChange={(e) => setForm((prev) => ({ ...prev, buyer_contacts: prev.buyer_contacts.map((entry, i) => i === idx ? { ...entry, last_name: e.target.value } : entry) }))} placeholder="Last name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Contact Number</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.contact_number} onChange={(e) => setForm((prev) => ({ ...prev, buyer_contacts: prev.buyer_contacts.map((entry, i) => i === idx ? { ...entry, contact_number: e.target.value } : entry) }))} placeholder="Contact number" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Email Address</span>
                                  <input type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.email_address} onChange={(e) => setForm((prev) => ({ ...prev, buyer_contacts: prev.buyer_contacts.map((entry, i) => i === idx ? { ...entry, email_address: e.target.value } : entry) }))} placeholder="Email address" />
                                </label>
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-base font-semibold">Sellers</h4>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            onClick={() => setForm((prev) => ({ ...prev, seller_contacts: [...prev.seller_contacts, buildEmptyPartyContact()] }))}
                          >
                            + Add Seller
                          </button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {form.seller_contacts.map((contact, idx) => (
                            <details key={`seller-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50">
                              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-800">
                                <span>{compactPartyContactName(contact, `Seller ${idx + 1}`)}</span>
                                {form.seller_contacts.length > 1 && (
                                  <button
                                    type="button"
                                    className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setForm((prev) => ({ ...prev, seller_contacts: prev.seller_contacts.filter((_, i) => i !== idx) }));
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </summary>
                              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">First Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.first_name} onChange={(e) => setForm((prev) => ({ ...prev, seller_contacts: prev.seller_contacts.map((entry, i) => i === idx ? { ...entry, first_name: e.target.value } : entry) }))} placeholder="First name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Last Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.last_name} onChange={(e) => setForm((prev) => ({ ...prev, seller_contacts: prev.seller_contacts.map((entry, i) => i === idx ? { ...entry, last_name: e.target.value } : entry) }))} placeholder="Last name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Contact Number</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.contact_number} onChange={(e) => setForm((prev) => ({ ...prev, seller_contacts: prev.seller_contacts.map((entry, i) => i === idx ? { ...entry, contact_number: e.target.value } : entry) }))} placeholder="Contact number" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Email Address</span>
                                  <input type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.email_address} onChange={(e) => setForm((prev) => ({ ...prev, seller_contacts: prev.seller_contacts.map((entry, i) => i === idx ? { ...entry, email_address: e.target.value } : entry) }))} placeholder="Email address" />
                                </label>
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2">
                        <h4 className="text-base font-semibold">Legal Parties</h4>
                        <div className="mt-3 grid gap-4 lg:grid-cols-3">
                          {[
                            ['Transferring Attorney', form.transfer_attorney_contact, 'transfer_attorney_contact'] as const,
                            ['Bond Attorney', form.bond_attorney_contact, 'bond_attorney_contact'] as const,
                            ['Bond Originator', form.bond_originator_contact, 'bond_originator_contact'] as const,
                          ].map(([label, contact, key]) => (
                            <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <h5 className="text-sm font-semibold text-slate-800">{label}</h5>
                              <div className="mt-3 grid grid-cols-1 gap-3">
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">First Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.first_name} onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], first_name: e.target.value } }))} placeholder="First name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Last Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.last_name} onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], last_name: e.target.value } }))} placeholder="Last name" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Contact Number</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.contact_number} onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], contact_number: e.target.value } }))} placeholder="Contact number" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Email Address</span>
                                  <input type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.email_address} onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], email_address: e.target.value } }))} placeholder="Email address" />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-slate-600">Company Name</span>
                                  <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={contact.company_name} onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], company_name: e.target.value } }))} placeholder="Company name" />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
                          <div>
                            <h4 className="text-base font-semibold">Invoicing</h4>
                            <p className="mt-1 text-sm text-slate-500">Keep the invoicing note short and readable for the register and detail screens.</p>
                          </div>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-600">All Parties Invoiced</span>
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.all_parties_invoiced} onChange={(e) => setForm((prev) => ({ ...prev, all_parties_invoiced: e.target.value }))} placeholder="Yes / No / Notes" />
                          </label>
                        </div>
                      </section>

                      <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2">
                        <h4 className="text-base font-semibold">Agents</h4>
                        <p className="mt-2 text-sm text-slate-500">
                          {form.agents.length > 0 ? form.agents.map((a) => getOutsideAgentDisplayName(a) || a.associate_name).filter(Boolean).join(', ') : 'No agents linked'}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">Manage agent splits and roles in the Transaction Details tab.</p>
                      </section>
                    </div>
                  </div>
                )}

                {editTab === 'documents' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Transaction Documents</h3>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                        <label className="flex-1">
                          <span className="mb-1 block text-xs font-medium text-slate-600">Document Name / Type</span>
                          <input
                            type="text"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={documentTypeInput}
                            onChange={(e) => setDocumentTypeInput(e.target.value)}
                            placeholder="Document name, e.g. OTP, Property Declaration, FICA"
                          />
                        </label>
                        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400">
                          {isUploadingDocument ? 'Uploading...' : 'Upload Document'}
                          <input
                            type="file"
                            className="hidden"
                            disabled={isUploadingDocument}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (!editingId) {
                                const stagedId = `staged:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
                                setStagedDocuments((prev) => [
                                  ...prev,
                                  {
                                    id: stagedId,
                                    file,
                                    transaction_document_type: documentTypeInput.trim() || 'OTHER',
                                    created_at: new Date().toISOString(),
                                  },
                                ]);
                              } else {
                                void uploadTransactionDocument(file);
                              }
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {editingId
                          ? 'Upload directly to the transaction record.'
                          : 'Files are staged now and uploaded automatically after the transaction is saved.'}
                      </p>
                      {documentActionError && <p className="mt-2 text-sm text-red-600">{documentActionError}</p>}
                    </div>

                    <div className="rounded-xl border border-slate-200">
                      {isEditDocumentsLoading ? (
                        <p className="p-4 text-sm text-slate-500">Loading documents...</p>
                      ) : editingId ? (editDocumentsData?.items ?? []).length > 0 : stagedDocuments.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                          {(editingId ? (editDocumentsData?.items ?? []) : stagedDocuments.map((doc) => ({
                            id: doc.id,
                            transaction_id: 'new',
                            source_document_id: null,
                            source_transaction_document_type_id: null,
                            transaction_document_type: doc.transaction_document_type,
                            file_name: doc.file.name,
                            document_url: null,
                            preview_url: null,
                            created_at: doc.created_at,
                            updated_at: doc.created_at,
                          }))).map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between gap-3 p-4">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{doc.file_name || 'Document'}</p>
                                <p className="text-xs text-slate-500">
                                  {doc.transaction_document_type || 'Document'} • {toShortDate(doc.created_at)}
                                  {!editingId ? ' • Staged' : doc.id.startsWith('staging:') ? ' • Legacy source' : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {doc.document_url && (
                                  <a
                                    href={doc.document_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    Open
                                  </a>
                                )}
                                <button
                                  type="button"
                                  disabled={editingId ? doc.id.startsWith('staging:') : false}
                                  onClick={() => {
                                    if (!editingId) {
                                      setStagedDocuments((prev) => prev.filter((entry) => entry.id !== doc.id));
                                      return;
                                    }
                                    void deleteTransactionDocument(doc.id);
                                  }}
                                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {editingId ? 'Delete' : 'Remove'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="p-4 text-sm text-slate-500">
                          {editingId ? 'No documents attached to this transaction yet.' : 'No staged documents yet. Add files now and they will be linked after save.'}
                        </p>
                      )}
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
                    <h3 className="text-lg font-semibold text-slate-900">{isEditingRentalTransaction ? 'Rental Transaction Summary' : 'Transaction Summary'}</h3>
                    {isShowingPreviewForEdit ? (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                        Live preview is showing unsaved values based on current form inputs. Save the transaction to persist these summary values.
                      </div>
                    ) : currentEditingRow ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {isEditingRentalTransaction
                          ? 'Rental summary values are calculated from payment details and participant splits. Save or refresh to load the latest values.'
                          : 'Summary values are calculated and saved by the backend. Save the transaction to refresh this view.'}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        This is a live business preview. Complete pricing, roles, and split percentages to see projected summary rows before save.
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
                            <th className="px-4 py-3 font-semibold">{isEditingRentalTransaction ? 'Variance % (N/A)' : 'Variance %'}</th>
                            <th className="px-4 py-3 font-semibold">GCI Before Fees</th>
                            <th className="px-4 py-3 font-semibold">{isEditingRentalTransaction ? 'Effective Split %' : 'Avg Comm %'}</th>
                            <th className="px-4 py-3 font-semibold">PR</th>
                            <th className="px-4 py-3 font-semibold">GS</th>
                            <th className="px-4 py-3 font-semibold">Total PR &amp; GS</th>
                            <th className="px-4 py-3 font-semibold">GCI After Fees Excl VAT</th>
                            <th className="px-4 py-3 font-semibold">Associate $</th>
                            <th className="px-4 py-3 font-semibold">Cap Amount</th>
                            <th className="px-4 py-3 font-semibold">Cap Remaining</th>
                            <th className="px-4 py-3 font-semibold">Team $</th>
                            <th className="px-4 py-3 font-semibold">Market Centre $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                          {calculatedSummaryRows.map((item) => (
                            <tr key={item.id}>
                              <td className="px-4 py-3 text-slate-900">{item.agent_name ?? '-'}</td>
                              <td className="px-4 py-3">{item.office_name ?? currentEditingRow?.market_center_name ?? '-'}</td>
                              <td className="px-4 py-3">{item.transaction_side ?? '-'}</td>
                              <td className="px-4 py-3">{toPercent(Number(item.split_percentage ?? 0))}</td>
                              <td className="px-4 py-3">{isEditingRentalTransaction ? '-' : toPercent(Number(item.variance_sale_list_pct ?? 0))}</td>
                              <td className="px-4 py-3">{toMoney(item.transaction_gci_before_fees ?? '0')}</td>
                              <td className="px-4 py-3">{isEditingRentalTransaction ? toPercent(Number(item.split_percentage ?? 0)) : toPercent(Number(item.average_commission_pct ?? 0))}</td>
                              <td className="px-4 py-3">{toMoney(item.production_royalties ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.growth_share ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.total_pr_and_gs ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.gci_after_fees_excl_vat ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.associate_dollar ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.cap_amount ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.display_cap_remaining ?? item.current_cap_remaining ?? item.cap_remaining ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.team_dollar ?? '0')}</td>
                              <td className="px-4 py-3">{toMoney(item.market_center_dollar ?? '0')}</td>
                            </tr>
                          ))}
                          {isEditSummaryLoading && (
                            <tr>
                              <td className="px-4 py-4 text-slate-500" colSpan={16}>
                                Loading latest calculated summary...
                              </td>
                            </tr>
                          )}
                          {!isEditSummaryLoading && calculatedSummaryRows.length === 0 && (
                            <tr>
                              <td className="px-4 py-4 text-slate-500" colSpan={16}>
                                No summary rows are available yet. Enter the required values to see a live preview, or save to load backend-calculated rows.
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

      {view === 'summary' && !isRentalsCategory && (
        <section className="space-y-4">
          <div className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">{performanceLabel}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSummaryFilters((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <UiIcon kind="filters" className="h-3.5 w-3.5" />
                  Filters
                </button>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <UiIcon kind="window" className="h-3.5 w-3.5" />
                  Window: {periodLabel}
                </span>
              </div>
            </div>
            {showSummaryFilters && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Summary filters follow your selected category, active context, and reporting window from backend aggregation.
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="tx" className="h-3.5 w-3.5" />Total Transactions</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : (summaryData?.mtd_registered_active.total_transactions ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="value" className="h-3.5 w-3.5" />Total Sales Value</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : toMoney(String(summaryData?.mtd_registered_active.total_sales_value ?? 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="gci" className="h-3.5 w-3.5" />Total GCI</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : toMoney(String(summaryData?.mtd_registered_active.total_net_commission ?? 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="split" className="h-3.5 w-3.5" />Average Split</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {isSummaryLoading ? '...' : `${(summaryData?.mtd_registered_active.average_split_percentage ?? 0).toFixed(2)}%`}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">Top 10 Market Centres This Month</h3>
              <div className="mt-3 space-y-2">
                {(summaryData?.market_center_performance ?? []).map((row, index) => (
                  <div key={`${row.market_center}-${index}`} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="col-span-5 truncate text-sm text-slate-700"><span className="mr-1 text-slate-400">#{index + 1}</span>{row.market_center}</span>
                    <span className="col-span-2 text-xs text-slate-600">{row.total_transactions.toLocaleString()} tx</span>
                    <span className="col-span-5 text-sm font-semibold text-slate-900">GCI {toMoney(String(row.total_gci))}</span>
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
                    <span className="col-span-4 truncate text-sm text-slate-700"><span className="mr-1 text-slate-400">#{index + 1}</span>{row.associate_name}</span>
                    <span className="col-span-3 truncate text-xs text-slate-600">{row.team_name || 'No Team'}</span>
                    <span className="col-span-2 truncate text-xs text-slate-600">{row.market_center}</span>
                    <span className="col-span-1 text-xs text-slate-600">{row.total_transactions.toLocaleString()} tx</span>
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
              <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="tx" className="h-3.5 w-3.5" />Total Transactions</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : (summaryData?.totals.total_transactions ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="value" className="h-3.5 w-3.5" />Total Sales Value</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : toMoney(String(summaryData?.totals.total_sales_value ?? 0))}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="net" className="h-3.5 w-3.5" />Total GCI</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : toMoney(String(summaryData?.totals.total_net_commission ?? 0))}
              </p>
            </div>
            <div className="surface-card p-4">
              <p className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500"><UiIcon kind="split" className="h-3.5 w-3.5" />Average Split</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {isSummaryLoading ? '...' : `${(summaryData?.totals.average_split_percentage ?? 0).toFixed(2)}%`}
              </p>
            </div>
          </div>

          {isSummaryError && (
            <div className="surface-card p-4 text-amber-700">
              <p className="font-medium">Could not load summary metrics.</p>
              <button
                type="button"
                onClick={() => void refetchSummary()}
                className="mt-2 inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Retry Summary
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">By Status</h3>
              <div className="mt-3 space-y-2">
                {(() => {
                  const rows = summaryData?.by_status ?? [];
                  const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);
                  return rows.map((row) => {
                    const widthPercent = maxCount > 0 ? Math.max(8, Math.round((row.count / maxCount) * 100)) : 8;
                    return (
                      <div key={row.label} className="rounded-lg border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-700">{row.label}</span>
                          <span className="status-chip info">{row.count.toLocaleString()}</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-slate-400" style={{ width: `${widthPercent}%` }} />
                        </div>
                      </div>
                    );
                  });
                })()}
                {!isSummaryLoading && (summaryData?.by_status.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No status data available for the current window.</p>
                )}
              </div>
            </div>

            <div className="surface-card p-4">
              <h3 className="text-sm font-semibold text-slate-900">By Transaction Type</h3>
              <div className="mt-3 space-y-2">
                {(() => {
                  const rows = summaryData?.by_type ?? [];
                  const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);
                  return rows.map((row) => {
                    const widthPercent = maxCount > 0 ? Math.max(8, Math.round((row.count / maxCount) * 100)) : 8;
                    return (
                      <div key={row.label} className="rounded-lg border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-700">{row.label}</span>
                          <span className="status-chip info">{row.count.toLocaleString()}</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-red-400" style={{ width: `${widthPercent}%` }} />
                        </div>
                      </div>
                    );
                  });
                })()}
                {!isSummaryLoading && (summaryData?.by_type.length ?? 0) === 0 && (
                  <p className="text-sm text-slate-500">No type data available for the current window.</p>
                )}
              </div>
            </div>
          </div>

          <div className="surface-card p-4">
            <h3 className="text-sm font-semibold text-slate-900">Expected Closings (Next 120 Days)</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(summaryData?.expected_closings_90_days ?? []).map((row) => {
                const normalizedBucket = row.bucket.toLowerCase();
                const bucketIcon = normalizedBucket.includes('30')
                  ? 'calendar'
                  : normalizedBucket.includes('60')
                    ? 'calendar-clock'
                    : normalizedBucket.includes('90')
                      ? 'hourglass'
                      : 'timeline';
                return (
                  <div key={row.bucket} className="rounded-lg border border-slate-200 p-3">
                    <p className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                      <UiIcon kind={bucketIcon} className="h-3.5 w-3.5" />
                      {row.bucket}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{row.count.toLocaleString()} units</p>
                    <p className="mt-1 text-xs text-slate-600">Total GCI: {toMoney(String(row.total_gci ?? 0))}</p>
                  </div>
                );
              })}
              {!isSummaryLoading && (summaryData?.expected_closings_90_days.length ?? 0) === 0 && (
                <p className="text-sm text-slate-500">No expected closings in the configured forecast window.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'month_end' && !isRentalsCategory && isRegionalAdmin && (
        <section className="space-y-4">
          <div className="surface-card p-4">
            <h3 className="text-base font-semibold text-slate-900">Month End FrontDoor Batch</h3>
            <p className="mt-1 text-sm text-slate-600">
              Run a test batch first to inspect exactly what will be sent and which items will error. Then decide whether to fix first or submit ready items as-is.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Date From</span>
                <input
                  type="date"
                  value={monthEndDateFrom}
                  onChange={(event) => setMonthEndDateFrom(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Date To</span>
                <input
                  type="date"
                  value={monthEndDateTo}
                  onChange={(event) => setMonthEndDateTo(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="md:col-span-2 flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => void runMonthEndPreview()}
                  disabled={isPreviewingMonthEnd || isSubmittingMonthEnd}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPreviewingMonthEnd ? 'Testing Batch...' : 'Test Batch'}
                </button>
                <button
                  type="button"
                  onClick={() => void submitMonthEndBatch()}
                  disabled={
                    isSubmittingMonthEnd
                    || isPreviewingMonthEnd
                    || !monthEndPreview
                    || monthEndPreview.ready_to_submit <= 0
                    || (monthEndPreview.will_be_skipped > 0 && !allowSubmitWithErrors)
                  }
                  className="primary-btn disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmittingMonthEnd ? 'Submitting...' : 'Submit To FrontDoor'}
                </button>
              </div>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allowSubmitWithErrors}
                onChange={(event) => setAllowSubmitWithErrors(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow submit as-is when errors exist (only ready items will be sent)
            </label>

            {monthEndError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{monthEndError}</p>
            )}
          </div>

          {monthEndPreview && (
            <div className="surface-card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-chip info">Total: {monthEndPreview.total_candidates.toLocaleString()}</span>
                <span className="status-chip good">Ready: {monthEndPreview.ready_to_submit.toLocaleString()}</span>
                <span className="status-chip">Errors/Skipped: {monthEndPreview.will_be_skipped.toLocaleString()}</span>
                <span className="status-chip">Window: {monthEndPreview.date_from} to {monthEndPreview.date_to}</span>
              </div>

              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                          onClick={() => toggleMonthEndSort('status')}
                        >
                          Status <span>{monthEndSortIndicator('status')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('transaction')}>
                          Transaction <span>{monthEndSortIndicator('transaction')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('associate')}>
                          Associate <span>{monthEndSortIndicator('associate')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('market_center')}>
                          Market Center <span>{monthEndSortIndicator('market_center')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('listing')}>
                          Listing <span>{monthEndSortIndicator('listing')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('sales_price')}>
                          Sales Price <span>{monthEndSortIndicator('sales_price')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleMonthEndSort('reporting_date')}>
                          Reporting Date <span>{monthEndSortIndicator('reporting_date')}</span>
                        </button>
                      </th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                    {sortedMonthEndItems.map((item) => (
                      <tr key={`${item.transaction_agent_id}-${item.region_transaction_id}`}>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {item.status === 'ready' ? 'Ready' : 'Error'}
                          </span>
                        </td>
                        <td className="px-3 py-2">{item.transaction_number ?? item.transaction_id}</td>
                        <td className="px-3 py-2">{item.associate_name ?? '-'}</td>
                        <td className="px-3 py-2">{item.market_center_name ?? '-'}</td>
                        <td className="px-3 py-2">{item.listing_number ?? '-'}</td>
                        <td className="px-3 py-2">{toMoney(String(item.sales_price ?? 0))}</td>
                        <td className="px-3 py-2">{item.effective_reporting_date}</td>
                        <td className="px-3 py-2">{item.error ?? 'Will be submitted'}</td>
                      </tr>
                    ))}
                    {monthEndPreview.items.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={8}>No records returned for the selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {monthEndSubmission && (
            <div className="surface-card p-4">
              <h4 className="text-sm font-semibold text-slate-900">Submission Result</h4>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="status-chip info">Run ID: {monthEndSubmission.run_id}</span>
                <span className="status-chip good">Submitted: {monthEndSubmission.submitted}</span>
                <span className="status-chip">Failed: {monthEndSubmission.failed}</span>
                <span className="status-chip">Skipped: {monthEndSubmission.skipped}</span>
                <span className="status-chip">Total: {monthEndSubmission.total}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {view === 'register' && (
      <section className="surface-card p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <p className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
            <UiIcon kind="filters" className="h-3.5 w-3.5" />
            Filters
          </p>
        </div>
        <div>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={isRentalsCategory ? 'Search rental transaction, address, market centre, agent, suburb, city, status or type' : 'Search transaction, listing, market centre, agent, suburb, city, status or type'}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0"
          />
        </div>

        <div className="my-3 border-t border-slate-200" />

        <div className="flex flex-wrap items-end gap-2 md:gap-3">
          <label className="flex w-full flex-col gap-1 sm:w-[190px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            >
              <option value="">All statuses</option>
              {TRANSACTION_STATUSES.map((statusValue) => (
                <option key={statusValue} value={statusValue}>{statusValue}</option>
              ))}
            </select>
          </label>

          <label className="flex w-full flex-col gap-1 sm:w-[190px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Date Basis</span>
            <select
              value={registerDateFilter}
              onChange={(event) => {
                const nextValue = event.target.value as RegisterDateFilter;
                setRegisterDateFilter(nextValue);
                if (!nextValue) {
                  setRegisterDateFrom('');
                  setRegisterDateTo('');
                }
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            >
              <option value="">No date filter</option>
              <option value="transaction_date">Transaction Date</option>
              <option value="status_change_date">Status Change Date</option>
            </select>
          </label>

          <label className="flex w-full flex-col gap-1 sm:w-[190px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Date From</span>
            <input
              type="date"
              value={registerDateFrom}
              disabled={!registerDateFilter}
              onChange={(event) => {
                setRegisterDateFrom(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </label>

          <label className="flex w-full flex-col gap-1 sm:w-[190px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Date To</span>
            <input
              type="date"
              value={registerDateTo}
              disabled={!registerDateFilter}
              onChange={(event) => {
                setRegisterDateTo(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatus('');
              setRegisterDateFilter('');
              setRegisterDateFrom('');
              setRegisterDateTo('');
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:self-end"
          >
            Clear Filters
          </button>

          <span className="w-full text-xs text-slate-600 sm:ml-auto sm:w-auto sm:self-end sm:pb-0.5">Page {page} of {totalPages}</span>
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
                <th className="px-3 py-2 text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('sales_price')}>
                    {isRentalsCategory ? 'Gross Commission' : 'Sales Price'} <span>{sortIndicator('sales_price')}</span>
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => toggleRegisterSort('net_comm')}>
                    {isRentalsCategory ? 'Agent Net Amount' : 'Net Comm'} <span>{sortIndicator('net_comm')}</span>
                  </button>
                </th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {isLoading && (
                <tr>
                  <td className="px-3 py-5 text-slate-500" colSpan={10}>Loading transactions and applying your current filters...</td>
                </tr>
              )}

              {isError && (
                <tr>
                  <td className="px-3 py-5 text-amber-700" colSpan={10}>
                    Could not load transactions from backend API.
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      className="ml-2 inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )}

              {!isLoading && !isError && filteredItems.length === 0 && (
                <tr>
                  <td className="px-3 py-5 text-slate-500" colSpan={10}>No transactions found for the current search and status filters.</td>
                </tr>
              )}

              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setDetailViewId(item.id)}
                      className="font-medium text-slate-900 hover:text-red-700"
                    >
                      {item.transaction_number ?? item.source_transaction_id}
                    </button>
                    <div className="text-xs text-slate-500">
                      Listing:{' '}
                      {item.source_listing_id ? (
                        <a
                          href={`/listings?review=${encodeURIComponent(item.source_listing_id)}`}
                          className="font-medium text-blue-700 hover:text-blue-800"
                        >
                          {item.listing_number ?? item.source_listing_id}
                        </a>
                      ) : (
                        item.listing_number ?? '-'
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">ID: {item.source_transaction_id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {item.agents.length > 0
                        ? item.agents.map((a) => getTransactionAgentDisplayName(a)).join(', ')
                        : '-'}
                    </div>
                    <div className="text-xs text-slate-500 truncate max-w-64">{item.address ?? '-'}</div>
                    <div className="text-[11px] text-slate-400">
                      {item.suburb ?? '-'}{item.suburb && item.city ? ', ' : ''}{item.city ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{item.market_center_name ?? '-'}</td>
                  <td className="px-3 py-2">{getDisplayTransactionType(item)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${transactionStatusClass(item.transaction_status)}`}>
                      {item.transaction_status ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{toShortDate(item.transaction_date ?? item.created_at ?? null)}</td>
                  <td className="px-3 py-2">{toShortDate(item.status_change_date)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{toMoney(isRentalsCategory ? (item.total_gci ?? item.sales_price) : item.sales_price)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{toMoney(item.net_comm)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => setDetailViewId(item.id)}>
                        <UiIcon kind="eye" className="h-3.5 w-3.5" />
                        View
                      </button>
                      {item.can_edit && (
                        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => openEditForm(item)}>
                          <UiIcon kind="edit" className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                      <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => setQuickSummaryRow(item)}>
                        <UiIcon kind="file" className="h-3.5 w-3.5" />
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
              <table className="min-w-[1500px] w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 whitespace-nowrap">Agent</th>
                    <th className="px-3 py-2 whitespace-nowrap">Office</th>
                    <th className="px-3 py-2 whitespace-nowrap">Side</th>
                    <th className="px-3 py-2 whitespace-nowrap">Split</th>
                    <th className="px-3 py-2 whitespace-nowrap">Variance %</th>
                    <th className="px-3 py-2 whitespace-nowrap">GCI Before Fees</th>
                    <th className="px-3 py-2 whitespace-nowrap">Avg Comm %</th>
                    <th className="px-3 py-2 whitespace-nowrap">PR</th>
                    <th className="px-3 py-2 whitespace-nowrap">GS</th>
                    <th className="px-3 py-2 whitespace-nowrap">Total PR &amp; GS</th>
                    <th className="px-3 py-2 whitespace-nowrap">GCI After Fees Excl VAT</th>
                    <th className="px-3 py-2 whitespace-nowrap">Associate $</th>
                    <th className="px-3 py-2 whitespace-nowrap">Cap Amount</th>
                    <th className="px-3 py-2 whitespace-nowrap">Cap Remaining</th>
                    <th className="px-3 py-2 whitespace-nowrap">Market Centre $</th>
                    <th className="px-3 py-2 whitespace-nowrap">Team $</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                  {quickSummaryCalculatedRows.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{item.agent_name ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.office_name ?? quickSummaryRow.market_center_name ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.transaction_side ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toPercent(Number(item.split_percentage ?? 0))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toPercent(Number(item.variance_sale_list_pct ?? 0))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.transaction_gci_before_fees ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toPercent(Number(item.average_commission_pct ?? 0))}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.production_royalties ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.growth_share ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.total_pr_and_gs ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.gci_after_fees_excl_vat ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.associate_dollar ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.cap_amount ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.display_cap_remaining ?? item.current_cap_remaining ?? item.cap_remaining ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.market_center_dollar ?? '0')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{toMoney(item.team_dollar ?? '0')}</td>
                    </tr>
                  ))}
                  {isQuickSummaryLoading && (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={16}>Loading latest summary...</td>
                    </tr>
                  )}
                  {!isQuickSummaryLoading && quickSummaryCalculatedRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={16}>No calculated rows found for this transaction yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail View Modal */}
      {detailViewId && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-4 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto p-6">
              <TransactionDetailView transactionId={detailViewId} onClose={() => setDetailViewId(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
