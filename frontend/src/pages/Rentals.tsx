import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';
import { AddressSearch, type AddressResult } from '../components/AddressSearch';

// ─── Types ──────────────────────────────────────────────────────────────────

type RentalParticipant = {
  id?: number;
  associate_id: string;
  associate_name: string;
  participant_role: string;
  agent_deal_split: number;         // e.g., Agent A 15% of deal, Agent B 85%
  market_center_split: number;      // MC split % for this agent
  agent_split: number;              // Agent split % for this agent (MC + Agent = 100%)
  gross_commission_amount: number;
  company_dollar_amount: number;
  royalty_amount: number;
  growth_share_amount: number;
  agent_net_amount: number;
  counts_toward_cap: boolean;
};

type Rental = {
  id: number;
  rental_number: string;
  source_listing_id: string | null;
  listing_number: string | null;
  market_centre_id: string | null;
  market_centre_name: string | null;
  property_address: string;
  suburb: string | null;
  city: string | null;
  province: string | null;
  property_reference: string | null;
  landlord_name: string | null;
  landlord_surname_or_company: string | null;
  landlord_email: string | null;
  landlord_phone: string | null;
  tenant_name: string | null;
  tenant_surname_or_company: string | null;
  tenant_email: string | null;
  tenant_phone: string | null;
  rental_type: string;
  rental_status: string;
  lease_start_date: string | null;
  lease_end_date: string | null;
  frequency: string;
  payment_due_day: number | null;
  rental_amount: string;
  gross_commission: string;
  company_dollar: string;
  counts_toward_cap: boolean;
  notes: string | null;
  created_at: string;
  participants: RentalParticipant[];
};

type PaymentScheduleItem = {
  id: number;
  rental_id: number;
  rental_number: string;
  rental_type: string;
  property_address: string;
  suburb: string | null;
  city: string | null;
  market_centre_name: string | null;
  landlord_name: string | null;
  tenant_name: string | null;
  payment_sequence_number: number;
  due_date: string;
  period_start_date: string | null;
  period_end_date: string | null;
  expected_rental_amount: string;
  expected_commission_amount: string;
  gross_commission: string;
  company_dollar: string;
  royalty: string;
  growth_share: string;
  agent_net_amount: string;
  payment_status: string;
  paid_date: string | null;
  cancelled_date: string | null;
  cancelled_reason: string | null;
  transaction_created: boolean;
  transaction_id: string | null;
  participants: RentalParticipant[];
};

type RentalDocument = {
  id: number;
  rental_id: number;
  document_name: string;
  document_type: string;
  file_name: string | null;
  file_url: string | null;
  storage_path: string | null;
  uploaded_by_user_id: string | null;
  uploaded_at: string;
};

type RentalAuditItem = {
  id: number;
  rental_id: number | null;
  payment_schedule_id: number | null;
  transaction_id: string | null;
  action: string;
  old_value: unknown;
  new_value: unknown;
  changed_by_user_id: string | null;
  changed_at: string;
};

type RentalFormState = {
  source_listing_id: string;
  listing_number: string;
  market_centre_id: string;
  market_centre_name: string;
  property_address: string;
  suburb: string;
  city: string;
  province: string;
  property_reference: string;
  property_notes: string;
  // Landlord
  landlord_name: string;
  landlord_surname_or_company: string;
  landlord_id_or_reg_number: string;
  landlord_email: string;
  landlord_phone: string;
  landlord_alternative_phone: string;
  landlord_country: string;
  landlord_province: string;
  landlord_city: string;
  landlord_suburb: string;
  landlord_street_number: string;
  landlord_street_name: string;
  landlord_postal_address: string;
  landlord_notes: string;
  // Tenant
  tenant_name: string;
  tenant_surname_or_company: string;
  tenant_id_or_reg_number: string;
  tenant_email: string;
  tenant_phone: string;
  tenant_alternative_phone: string;
  tenant_country: string;
  tenant_province: string;
  tenant_city: string;
  tenant_suburb: string;
  tenant_street_number: string;
  tenant_street_name: string;
  tenant_notes: string;
  // Rental details
  rental_type: string;
  rental_status: string;
  frequency: string;
  lease_start_date: string;
  lease_end_date: string;
  lease_signed_date: string;
  occupation_date: string;
  payment_due_day: string;
  payment_due_rule: string;
  rental_amount: string;
  deposit_amount: string;
  procurement_fee_amount: string;
  management_fee_percentage: string;
  management_fee_amount: string;
  royalty: string;
  growth_share: string;
  gross_commission: string;
  notes: string;
};

const EMPTY_FORM: RentalFormState = {
  source_listing_id: '', listing_number: '',
  market_centre_id: '', market_centre_name: '',
  property_address: '', suburb: '', city: '', province: '', property_reference: '', property_notes: '',
  landlord_name: '', landlord_surname_or_company: '', landlord_id_or_reg_number: '',
  landlord_email: '', landlord_phone: '', landlord_alternative_phone: '',
  landlord_country: 'South Africa', landlord_province: '', landlord_city: '', landlord_suburb: '',
  landlord_street_number: '', landlord_street_name: '', landlord_postal_address: '', landlord_notes: '',
  tenant_name: '', tenant_surname_or_company: '', tenant_id_or_reg_number: '',
  tenant_email: '', tenant_phone: '', tenant_alternative_phone: '',
  tenant_country: 'South Africa', tenant_province: '', tenant_city: '', tenant_suburb: '',
  tenant_street_number: '', tenant_street_name: '', tenant_notes: '',
  rental_type: 'PROCUREMENT', rental_status: 'DRAFT',
  frequency: 'MONTHLY',
  lease_start_date: '', lease_end_date: '', lease_signed_date: '', occupation_date: '',
  payment_due_day: '25', payment_due_rule: '',
  rental_amount: '', deposit_amount: '', procurement_fee_amount: '',
  management_fee_percentage: '', management_fee_amount: '',
  royalty: '', growth_share: '', gross_commission: '',
  notes: '',
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

type AssociateLookupRow = {
  source_associate_id: string;
  full_name: string | null;
  email: string | null;
  status_name: string | null;
  market_center_name: string | null;
};

type AssociateLookupResponse = {
  items: AssociateLookupRow[];
};

type Property24ProvinceOption = {
  id: string;
  name: string;
};

type Property24ProvinceSearchResponse = {
  items: Property24ProvinceOption[];
};

type Property24CityOption = {
  id: string;
  name: string;
  province: string | null;
  alternateNames: string[];
};

type Property24CitySearchResponse = {
  items: Property24CityOption[];
};

type Property24SuburbOption = {
  id: string;
  name: string;
  city: string | null;
  province: string | null;
  alternateNames: string[];
};

type Property24SuburbSearchResponse = {
  items: Property24SuburbOption[];
};

const RENTAL_TYPES = ['PROCUREMENT', 'MANAGEMENT'];
const RENTAL_STATUSES = ['DRAFT', 'ACTIVE', 'CANCELLED', 'COMPLETED'];
const FREQUENCIES = ['ONCE_OFF', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const PARTICIPANT_ROLES = ['RENTAL_AGENT', 'LISTING_AGENT', 'REFERRING_AGENT', 'REFERRAL_OFFICE', 'TEAM_LEAD', 'OTHER'];
const RENTAL_DOCUMENT_TYPES = [
  'LEASE_AGREEMENT',
  'SIGNED_MANDATE',
  'PROOF_OF_PAYMENT',
  'LANDLORD_FICA',
  'TENANT_FICA',
  'INSPECTION_DOCUMENT',
  'DEPOSIT_PROOF',
  'OTHER',
];

const PARTICIPANT_ROLE_LABELS: Record<string, string> = {
  RENTAL_AGENT: 'Rental Agent',
  LISTING_AGENT: 'Listing Agent',
  REFERRING_AGENT: 'Referring Agent',
  REFERRAL_OFFICE: 'Referral Office',
  TEAM_LEAD: 'Team Lead',
  OTHER: 'Other',
};

const STATUS_CLASSES: Record<string, string> = {
  UPCOMING:  'bg-blue-100 text-blue-800',
  DUE:       'bg-amber-100 text-amber-800',
  OVERDUE:   'bg-red-100 text-red-800',
  PAID:      'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  DRAFT:     'bg-slate-100 text-slate-600',
  ACTIVE:    'bg-green-100 text-green-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
};

function toMoney(val: string | number | null | undefined): string {
  const n = typeof val === 'string' ? Number(val) : (val ?? 0);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

function toShortDate(val: string | null | undefined): string {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-ZA');
}

function normalizeDateInput(val: unknown): string {
  if (typeof val !== 'string' || !val.trim()) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function UiIcon({ kind, className = 'h-4 w-4' }: { kind: 'home' | 'calendar' | 'alert' | 'check' | 'trend' | 'wallet' | 'plus' | 'register' | 'schedule' | 'info'; className?: string }) {
  if (kind === 'home') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
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
  if (kind === 'alert') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="16.7" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8.5 12.2 2.4 2.4 4.8-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'trend') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 16.5 10 10.5l4 4L20 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 8h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'wallet') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M21 10h-6a2 2 0 0 0 0 4h6" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (kind === 'plus') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
  if (kind === 'schedule') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx="12" cy="13" r="7" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 9v4l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8 3v2M16 3v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" />
    </svg>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-700')}>
      {formatEnumLabel(status)}
    </span>
  );
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> | undefined) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Calculation Helpers ────────────────────────────────────────────────────

function calculateManagementFeeAmount(rentalAmount: number, feePercentage: number): number {
  if (!rentalAmount || !feePercentage) return 0;
  return (rentalAmount * feePercentage) / 100;
}

function calculateGCI(managementFee: number): number {
  if (!managementFee) return 0;
  const royalty = (managementFee * 6) / 100;  // 6% of management fee
  const growthShare = (managementFee * 2) / 100;  // 2% of management fee
  return managementFee - royalty - growthShare;
}

function calculateRoyalty(managementFee: number): number {
  if (!managementFee) return 0;
  return (managementFee * 6) / 100;
}

function calculateGrowthShare(managementFee: number): number {
  if (!managementFee) return 0;
  return (managementFee * 2) / 100;
}

function parsePercentageInput(value: string): number {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ─── Rental Form Modal ───────────────────────────────────────────────────────

function RentalFormModal({
  initial,
  onClose,
  onSaved,
  token,
  activeContext,
}: {
  initial?: Partial<RentalFormState & { id?: number; participants?: RentalParticipant[] }>;
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
  activeContext: import('../contexts/AuthContext').UserContext | null;
}) {
  const isEdit = !!initial?.id;
  const normalizedInitial = {
    ...initial,
    lease_start_date: normalizeDateInput(initial?.lease_start_date),
    lease_end_date: normalizeDateInput(initial?.lease_end_date),
    lease_signed_date: normalizeDateInput(initial?.lease_signed_date),
    occupation_date: normalizeDateInput(initial?.occupation_date),
  } as Partial<RentalFormState & { id?: number; participants?: RentalParticipant[] }>;

  const normalizedParticipants: RentalParticipant[] = (initial?.participants ?? []).map((p) => ({
    associate_id: p.associate_id ?? '',
    associate_name: p.associate_name ?? '',
    participant_role: p.participant_role ?? 'RENTAL_AGENT',
    agent_deal_split: Number(p.agent_deal_split ?? 0),
    market_center_split: Number(p.market_center_split ?? 0),
    agent_split: Number(p.agent_split ?? 0),
    gross_commission_amount: Number(p.gross_commission_amount ?? 0),
    company_dollar_amount: Number(p.company_dollar_amount ?? 0),
    royalty_amount: Number(p.royalty_amount ?? 0),
    growth_share_amount: Number(p.growth_share_amount ?? 0),
    agent_net_amount: Number(p.agent_net_amount ?? 0),
    counts_toward_cap: Boolean(p.counts_toward_cap),
  }));

  const [form, setForm] = useState<RentalFormState>({
    ...EMPTY_FORM,
    market_centre_id: activeContext?.marketCenterId ?? '',
    market_centre_name: activeContext?.marketCenter ?? '',
    ...normalizedInitial,
  });
  
  // Determine initial procurement mode based on form data
  const determineInitialProcurementMode = () => {
    if (normalizedInitial.procurement_fee_amount) return 'amount';
    if (normalizedInitial.management_fee_percentage) return 'percent';
    return 'amount'; // Default to amount mode
  };
  
  const [procurementMode, setProcurementMode] = useState<'percent' | 'amount'>(determineInitialProcurementMode());
  const [participants, setParticipants] = useState<RentalParticipant[]>(normalizedParticipants);
  const [listingSearchQuery, setListingSearchQuery] = useState(initial?.listing_number ?? '');
  const [listingSearchOpen, setListingSearchOpen] = useState(false);
  const [activeParticipantIdx, setActiveParticipantIdx] = useState<number | null>(null);
  const [associateSearchQuery, setAssociateSearchQuery] = useState('');
  const [associateSearchOpen, setAssociateSearchOpen] = useState(false);
  const [selectedLandlordProperty24SuburbId, setSelectedLandlordProperty24SuburbId] = useState<string | null>(null);
  const [selectedTenantProperty24SuburbId, setSelectedTenantProperty24SuburbId] = useState<string | null>(null);
  const [formTab, setFormTab] = useState<'property' | 'landlord' | 'tenant' | 'rental' | 'agents'>('property');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeContext ? { 'X-Active-Context': activeContext.id } : {}),
  };

  const { data: listingSearchData } = useQuery({
    queryKey: ['rental-listing-search', listingSearchQuery],
    queryFn: () =>
      apiFetch<ListingSearchResponse>(
        `/api/listings/search?q=${encodeURIComponent(listingSearchQuery)}&saleOrRent=For%20Rent&status=Active`,
        { headers: reqHeaders },
        null
      ),
    enabled: listingSearchQuery.trim().length >= 2,
    staleTime: 30000,
  });

  const { data: associateSearchData } = useQuery({
    queryKey: ['rental-associate-search', associateSearchQuery],
    queryFn: () =>
      apiFetch<AssociateLookupResponse>(
        `/api/associates?limit=20&offset=0&status=Active&search=${encodeURIComponent(associateSearchQuery.trim())}`,
        { headers: reqHeaders },
        null
      ),
    enabled: activeParticipantIdx !== null && associateSearchQuery.trim().length >= 2,
    staleTime: 30000,
  });

  const { data: property24ProvinceData, isFetching: isSearchingProperty24Provinces } = useQuery<Property24ProvinceSearchResponse>({
    queryKey: ['rental-property24-provinces'],
    queryFn: () => apiFetch<Property24ProvinceSearchResponse>('/api/listings/property24-provinces'),
    enabled: formTab === 'landlord' || formTab === 'tenant',
    staleTime: Infinity,
  });

  const { data: property24LandlordCityData, isFetching: isSearchingLandlordProperty24Cities } = useQuery<Property24CitySearchResponse>({
    queryKey: ['rental-landlord-property24-cities', form.landlord_province, form.landlord_city],
    queryFn: () => {
      const params = new URLSearchParams({ province: form.landlord_province, q: form.landlord_city });
      return apiFetch<Property24CitySearchResponse>(`/api/listings/property24-cities/search?${params.toString()}`);
    },
    enabled: formTab === 'landlord' && Boolean(form.landlord_province.trim()),
    staleTime: 30000,
  });

  const { data: property24LandlordSuburbData, isFetching: isSearchingLandlordProperty24Suburbs } = useQuery<Property24SuburbSearchResponse>({
    queryKey: ['rental-landlord-property24-suburbs', form.landlord_province, form.landlord_city, form.landlord_suburb],
    queryFn: () => {
      const params = new URLSearchParams({ province: form.landlord_province, city: form.landlord_city, q: form.landlord_suburb });
      return apiFetch<Property24SuburbSearchResponse>(`/api/listings/property24-suburbs/search?${params.toString()}`);
    },
    enabled: formTab === 'landlord' && Boolean(form.landlord_province.trim()) && Boolean(form.landlord_city.trim()),
    staleTime: 30000,
  });

  const { data: property24TenantCityData, isFetching: isSearchingTenantProperty24Cities } = useQuery<Property24CitySearchResponse>({
    queryKey: ['rental-tenant-property24-cities', form.tenant_province, form.tenant_city],
    queryFn: () => {
      const params = new URLSearchParams({ province: form.tenant_province, q: form.tenant_city });
      return apiFetch<Property24CitySearchResponse>(`/api/listings/property24-cities/search?${params.toString()}`);
    },
    enabled: formTab === 'tenant' && Boolean(form.tenant_province.trim()),
    staleTime: 30000,
  });

  const { data: property24TenantSuburbData, isFetching: isSearchingTenantProperty24Suburbs } = useQuery<Property24SuburbSearchResponse>({
    queryKey: ['rental-tenant-property24-suburbs', form.tenant_province, form.tenant_city, form.tenant_suburb],
    queryFn: () => {
      const params = new URLSearchParams({ province: form.tenant_province, city: form.tenant_city, q: form.tenant_suburb });
      return apiFetch<Property24SuburbSearchResponse>(`/api/listings/property24-suburbs/search?${params.toString()}`);
    },
    enabled: formTab === 'tenant' && Boolean(form.tenant_province.trim()) && Boolean(form.tenant_city.trim()),
    staleTime: 30000,
  });

  const property24ProvinceOptions = Array.from(new Set((property24ProvinceData?.items ?? []).map((item) => item.name))).sort((a, b) => a.localeCompare(b));
  const property24LandlordCityOptions = Array.from(new Set((property24LandlordCityData?.items ?? []).map((item) => item.name))).sort((a, b) => a.localeCompare(b));
  const property24LandlordSuburbOptions = property24LandlordSuburbData?.items ?? [];
  const property24TenantCityOptions = Array.from(new Set((property24TenantCityData?.items ?? []).map((item) => item.name))).sort((a, b) => a.localeCompare(b));
  const property24TenantSuburbOptions = property24TenantSuburbData?.items ?? [];

  const set = (key: keyof RentalFormState, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const applyPartyAddress = (target: 'landlord' | 'tenant', result: AddressResult) => {
    setForm((prev) => {
      if (target === 'landlord') {
        setSelectedLandlordProperty24SuburbId(null);
        return {
          ...prev,
          landlord_street_number: result.streetNumber || prev.landlord_street_number,
          landlord_street_name: result.streetName || prev.landlord_street_name,
          landlord_suburb: result.suburb || prev.landlord_suburb,
          landlord_city: result.city || prev.landlord_city,
          landlord_province: result.province || prev.landlord_province,
          landlord_postal_address: result.postalCode || prev.landlord_postal_address,
          landlord_country: prev.landlord_country || 'South Africa',
        };
      }

      setSelectedTenantProperty24SuburbId(null);
      return {
        ...prev,
        tenant_street_number: result.streetNumber || prev.tenant_street_number,
        tenant_street_name: result.streetName || prev.tenant_street_name,
        tenant_suburb: result.suburb || prev.tenant_suburb,
        tenant_city: result.city || prev.tenant_city,
        tenant_province: result.province || prev.tenant_province,
        tenant_country: prev.tenant_country || 'South Africa',
      };
    });
  };

  const addParticipant = () => {
    setParticipants((prev) => [...prev, {
      associate_id: '', associate_name: '', participant_role: 'RENTAL_AGENT',
      agent_deal_split: 0, market_center_split: 0, agent_split: 0,
      gross_commission_amount: 0, company_dollar_amount: 0,
      royalty_amount: 0, growth_share_amount: 0, agent_net_amount: 0, counts_toward_cap: false,
    }]);
    setActiveParticipantIdx(participants.length);
    setAssociateSearchQuery('');
    setAssociateSearchOpen(false);
  };

  const removeParticipant = (idx: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
    if (activeParticipantIdx === idx) {
      setActiveParticipantIdx(null);
      setAssociateSearchQuery('');
      setAssociateSearchOpen(false);
    } else if (activeParticipantIdx !== null && activeParticipantIdx > idx) {
      setActiveParticipantIdx(activeParticipantIdx - 1);
    }
  };

  const updateParticipant = (idx: number, key: keyof RentalParticipant, value: string | boolean | number) => {
    setParticipants((prev) => prev.map((p, i) => i === idx ? { ...p, [key]: value } : p));
  };

  const selectListing = (listing: ListingSearchResult) => {
    setForm((prev) => ({
      ...prev,
      source_listing_id: listing.source_listing_id,
      listing_number: listing.listing_number,
      property_address: listing.address ?? prev.property_address,
      suburb: listing.suburb ?? prev.suburb,
      city: listing.city ?? prev.city,
    }));
    setListingSearchQuery(listing.listing_number);
    setListingSearchOpen(false);
  };

  const selectAssociateForParticipant = (idx: number, associate: AssociateLookupRow) => {
    updateParticipant(idx, 'associate_id', associate.source_associate_id);
    updateParticipant(idx, 'associate_name', associate.full_name ?? associate.source_associate_id);
    setActiveParticipantIdx(null);
    setAssociateSearchQuery('');
    setAssociateSearchOpen(false);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = { ...form, participants };
      if (isEdit) {
        await apiFetch(
          `/api/rentals/${initial!.id}`,
          { method: 'PUT', body: JSON.stringify(payload), headers: reqHeaders },
          null
        );
      } else {
        await apiFetch(
          '/api/rentals',
          { method: 'POST', body: JSON.stringify(payload), headers: reqHeaders },
          null
        );
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rental.');
    } finally {
      setSaving(false);
    }
  };

  const TABS: { key: typeof formTab; label: string }[] = [
    { key: 'property', label: 'Property' },
    { key: 'landlord', label: 'Landlord' },
    { key: 'tenant', label: 'Tenant' },
    { key: 'rental', label: 'Rental Details' },
    { key: 'agents', label: 'Agents' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
      <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 shrink-0">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Rental Workspace</p>
            <h2 className="text-2xl font-semibold text-slate-900">{isEdit ? 'Edit Rental' : 'New Rental'}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="primary-btn">
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Rental'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 gap-1 overflow-x-auto shrink-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFormTab(t.key)}
              className={clsx(
                'px-4 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                formTab === t.key
                  ? 'border-red-600 text-red-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-8 py-6 space-y-6">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          {/* Property Tab */}
          {formTab === 'property' && (
            <div className="grid grid-cols-3 gap-5">
              <div className="col-span-3 relative">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Link Rental Listing</span>
                  <input
                    value={listingSearchQuery}
                    onChange={(e) => {
                      const next = e.target.value;
                      setListingSearchQuery(next);
                      setListingSearchOpen(next.trim().length >= 2);
                    }}
                    onFocus={() => {
                      if (listingSearchQuery.trim().length >= 2) setListingSearchOpen(true);
                    }}
                    onBlur={() => setTimeout(() => setListingSearchOpen(false), 120)}
                    className="input-field"
                    placeholder="Search listing number, address, suburb..."
                  />
                </label>
                {listingSearchOpen && (listingSearchData?.items ?? []).length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {(listingSearchData?.items ?? []).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectListing(item);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <p className="text-sm font-medium text-slate-900">{item.listing_number}</p>
                        <p className="text-xs text-slate-500">{item.address ?? '-'} {item.suburb ? `| ${item.suburb}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Linked Listing Number</span>
                <input value={form.listing_number} onChange={(e) => set('listing_number', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Linked Listing ID</span>
                <input value={form.source_listing_id} onChange={(e) => set('source_listing_id', e.target.value)} className="input-field" />
              </label>

              <div className="col-span-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Property Address *</span>
                  <input value={form.property_address} onChange={(e) => set('property_address', e.target.value)} className="input-field" placeholder="e.g. 12 Jacaranda Street" />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Suburb</span>
                <input value={form.suburb} onChange={(e) => set('suburb', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">City</span>
                <input value={form.city} onChange={(e) => set('city', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Province</span>
                <input value={form.province} onChange={(e) => set('province', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Property Reference</span>
                <input value={form.property_reference} onChange={(e) => set('property_reference', e.target.value)} className="input-field" />
              </label>
              <div className="col-span-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Property Notes</span>
                  <textarea value={form.property_notes} onChange={(e) => set('property_notes', e.target.value)} className="input-field" rows={3} />
                </label>
              </div>
            </div>
          )}

          {/* Landlord Tab */}
          {formTab === 'landlord' && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-slate-900">Landlord Details</h4>
                  <p className="text-xs text-slate-500">Primary contact and identity information.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Name</span>
                    <input value={form.landlord_name} onChange={(e) => set('landlord_name', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Surname / Company</span>
                    <input value={form.landlord_surname_or_company} onChange={(e) => set('landlord_surname_or_company', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">ID / Reg Number</span>
                    <input value={form.landlord_id_or_reg_number} onChange={(e) => set('landlord_id_or_reg_number', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Email</span>
                    <input type="email" value={form.landlord_email} onChange={(e) => set('landlord_email', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Phone</span>
                    <input value={form.landlord_phone} onChange={(e) => set('landlord_phone', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Alt Phone</span>
                    <input value={form.landlord_alternative_phone} onChange={(e) => set('landlord_alternative_phone', e.target.value)} className="input-field" />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-slate-900">Physical Address</h4>
                  <p className="text-xs text-slate-500">Use lookup for fast and consistent address capture.</p>
                </div>

                <AddressSearch onSelect={(result) => applyPartyAddress('landlord', result)} />

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Country</span>
                    <input value={form.landlord_country} onChange={(e) => set('landlord_country', e.target.value)} className="input-field" placeholder="e.g. South Africa" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Province</span>
                    <input
                      list="rental-landlord-province-options"
                      value={form.landlord_province}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setForm((prev) => ({ ...prev, landlord_province: nextValue, landlord_city: '', landlord_suburb: '' }));
                        setSelectedLandlordProperty24SuburbId(null);
                      }}
                      className="input-field"
                      placeholder={isSearchingProperty24Provinces ? 'Loading provinces...' : 'Search or select province'}
                    />
                    <datalist id="rental-landlord-province-options">
                      {property24ProvinceOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">City</span>
                    <input
                      list="rental-landlord-city-options"
                      value={form.landlord_city}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setForm((prev) => ({ ...prev, landlord_city: nextValue, landlord_suburb: '' }));
                        setSelectedLandlordProperty24SuburbId(null);
                      }}
                      className="input-field"
                      placeholder={form.landlord_province ? 'Search Property24 cities' : 'Select province first'}
                    />
                    <datalist id="rental-landlord-city-options">
                      {property24LandlordCityOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <div className="flex min-h-5 items-center justify-end text-[11px] text-slate-500">
                      {isSearchingLandlordProperty24Cities && <span>Searching...</span>}
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Suburb</span>
                    <input
                      list="rental-landlord-suburb-options"
                      value={form.landlord_suburb}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        const matched = property24LandlordSuburbOptions.find((option) => option.name.toLowerCase() === nextValue.trim().toLowerCase());
                        set('landlord_suburb', nextValue);
                        setSelectedLandlordProperty24SuburbId(matched?.id || null);
                      }}
                      className="input-field"
                      placeholder={form.landlord_city && form.landlord_province ? 'Search Property24 suburbs' : 'Select province and city first'}
                    />
                    <datalist id="rental-landlord-suburb-options">
                      {Array.from(new Set(property24LandlordSuburbOptions.map((item) => item.name))).sort((a, b) => a.localeCompare(b)).map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <div className="flex min-h-5 items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {selectedLandlordProperty24SuburbId
                          ? `Matched to Property24 suburb ID ${selectedLandlordProperty24SuburbId}`
                          : 'Choose a suburb from the Property24 list to lock the suburb ID.'}
                      </span>
                      {isSearchingLandlordProperty24Suburbs && <span>Searching...</span>}
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Street Number</span>
                    <input value={form.landlord_street_number} onChange={(e) => set('landlord_street_number', e.target.value)} className="input-field" placeholder="e.g. 12" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Street Name</span>
                    <input value={form.landlord_street_name} onChange={(e) => set('landlord_street_name', e.target.value)} className="input-field" placeholder="e.g. Main Road" />
                  </label>
                  <div className="md:col-span-2 xl:col-span-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Postal Address</span>
                      <input value={form.landlord_postal_address} onChange={(e) => set('landlord_postal_address', e.target.value)} className="input-field" />
                    </label>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Landlord Notes</span>
                  <textarea value={form.landlord_notes} onChange={(e) => set('landlord_notes', e.target.value)} className="input-field" rows={3} />
                </label>
              </section>
            </div>
          )}

          {/* Tenant Tab */}
          {formTab === 'tenant' && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-slate-900">Tenant Details</h4>
                  <p className="text-xs text-slate-500">Primary contact and identity information.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Name</span>
                    <input value={form.tenant_name} onChange={(e) => set('tenant_name', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Surname / Company</span>
                    <input value={form.tenant_surname_or_company} onChange={(e) => set('tenant_surname_or_company', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">ID / Reg Number</span>
                    <input value={form.tenant_id_or_reg_number} onChange={(e) => set('tenant_id_or_reg_number', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Email</span>
                    <input type="email" value={form.tenant_email} onChange={(e) => set('tenant_email', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Phone</span>
                    <input value={form.tenant_phone} onChange={(e) => set('tenant_phone', e.target.value)} className="input-field" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Alt Phone</span>
                    <input value={form.tenant_alternative_phone} onChange={(e) => set('tenant_alternative_phone', e.target.value)} className="input-field" />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-slate-900">Current Address</h4>
                  <p className="text-xs text-slate-500">Use lookup for fast and consistent address capture.</p>
                </div>

                <AddressSearch onSelect={(result) => applyPartyAddress('tenant', result)} />

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Country</span>
                    <input value={form.tenant_country} onChange={(e) => set('tenant_country', e.target.value)} className="input-field" placeholder="e.g. South Africa" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Province</span>
                    <input
                      list="rental-tenant-province-options"
                      value={form.tenant_province}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setForm((prev) => ({ ...prev, tenant_province: nextValue, tenant_city: '', tenant_suburb: '' }));
                        setSelectedTenantProperty24SuburbId(null);
                      }}
                      className="input-field"
                      placeholder={isSearchingProperty24Provinces ? 'Loading provinces...' : 'Search or select province'}
                    />
                    <datalist id="rental-tenant-province-options">
                      {property24ProvinceOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">City</span>
                    <input
                      list="rental-tenant-city-options"
                      value={form.tenant_city}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setForm((prev) => ({ ...prev, tenant_city: nextValue, tenant_suburb: '' }));
                        setSelectedTenantProperty24SuburbId(null);
                      }}
                      className="input-field"
                      placeholder={form.tenant_province ? 'Search Property24 cities' : 'Select province first'}
                    />
                    <datalist id="rental-tenant-city-options">
                      {property24TenantCityOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <div className="flex min-h-5 items-center justify-end text-[11px] text-slate-500">
                      {isSearchingTenantProperty24Cities && <span>Searching...</span>}
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Suburb</span>
                    <input
                      list="rental-tenant-suburb-options"
                      value={form.tenant_suburb}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        const matched = property24TenantSuburbOptions.find((option) => option.name.toLowerCase() === nextValue.trim().toLowerCase());
                        set('tenant_suburb', nextValue);
                        setSelectedTenantProperty24SuburbId(matched?.id || null);
                      }}
                      className="input-field"
                      placeholder={form.tenant_city && form.tenant_province ? 'Search Property24 suburbs' : 'Select province and city first'}
                    />
                    <datalist id="rental-tenant-suburb-options">
                      {Array.from(new Set(property24TenantSuburbOptions.map((item) => item.name))).sort((a, b) => a.localeCompare(b)).map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <div className="flex min-h-5 items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {selectedTenantProperty24SuburbId
                          ? `Matched to Property24 suburb ID ${selectedTenantProperty24SuburbId}`
                          : 'Choose a suburb from the Property24 list to lock the suburb ID.'}
                      </span>
                      {isSearchingTenantProperty24Suburbs && <span>Searching...</span>}
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Street Number</span>
                    <input value={form.tenant_street_number} onChange={(e) => set('tenant_street_number', e.target.value)} className="input-field" placeholder="e.g. 12" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Street Name</span>
                    <input value={form.tenant_street_name} onChange={(e) => set('tenant_street_name', e.target.value)} className="input-field" placeholder="e.g. Main Road" />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Tenant Notes</span>
                  <textarea value={form.tenant_notes} onChange={(e) => set('tenant_notes', e.target.value)} className="input-field" rows={3} />
                </label>
              </section>
            </div>
          )}

          {/* Rental Details Tab */}
          {formTab === 'rental' && (
            <div className="grid grid-cols-3 gap-5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Rental Type *</span>
                <select value={form.rental_type} onChange={(e) => set('rental_type', e.target.value)} className="input-field">
                  {RENTAL_TYPES.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select value={form.rental_status} onChange={(e) => set('rental_status', e.target.value)} className="input-field">
                  {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Payment Frequency</span>
                <select value={form.frequency} onChange={(e) => set('frequency', e.target.value)} className="input-field">
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{formatEnumLabel(f)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Lease Start Date</span>
                <input type="date" value={form.lease_start_date} onChange={(e) => set('lease_start_date', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Lease End Date {form.rental_type === 'MANAGEMENT' && <span className="text-red-500">*</span>}</span>
                <input type="date" value={form.lease_end_date} onChange={(e) => set('lease_end_date', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Occupation Date</span>
                <input type="date" value={form.occupation_date} onChange={(e) => set('occupation_date', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Lease Signed Date</span>
                <input type="date" value={form.lease_signed_date} onChange={(e) => set('lease_signed_date', e.target.value)} className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Payment Due Day (1–31)</span>
                <input type="number" min={1} max={31} value={form.payment_due_day} onChange={(e) => set('payment_due_day', e.target.value)} className="input-field" />
              </label>

              {/* Divider */}
              <div className="col-span-3 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-4">Amounts &amp; Commissions</p>
                <div className="grid grid-cols-3 gap-5">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Rental Amount (R)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-medium min-w-fit">R</span>
                      <input type="number" value={form.rental_amount} onChange={(e) => set('rental_amount', e.target.value)} className="input-field flex-1" />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Deposit Amount (R)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-medium min-w-fit">R</span>
                      <input type="number" value={form.deposit_amount} onChange={(e) => set('deposit_amount', e.target.value)} className="input-field flex-1" />
                    </div>
                  </label>
                  {form.rental_type === 'PROCUREMENT' && (
                    <>
                      <div className="col-span-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Procurement Commission</p>
                        <div className="flex gap-4 mb-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="radio" 
                              name="procurementMode" 
                              value="percent" 
                              checked={procurementMode === 'percent'}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setProcurementMode('percent');
                                  set('procurement_fee_amount', '');
                                }
                              }} 
                              className="h-4 w-4 accent-red-700" 
                            />
                            <span className="text-sm font-medium text-slate-700">As % of Rental Amount</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="radio" 
                              name="procurementMode" 
                              value="amount" 
                              checked={procurementMode === 'amount'}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setProcurementMode('amount');
                                  set('management_fee_percentage', '');
                                }
                              }} 
                              className="h-4 w-4 accent-red-700" 
                            />
                            <span className="text-sm font-medium text-slate-700">As Fixed Amount (R)</span>
                          </label>
                        </div>
                      </div>

                      {procurementMode === 'percent' && (
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Commission % of Rental Amount</span>
                          <input 
                            type="number" 
                            step="0.01" 
                            value={form.management_fee_percentage} 
                            onChange={(e) => {
                              set('management_fee_percentage', e.target.value);
                              const newAmount = calculateManagementFeeAmount(Number(form.rental_amount) || 0, Number(e.target.value) || 0);
                              set('management_fee_amount', String(newAmount));
                              set('gross_commission', String(calculateGCI(newAmount)));
                              set('royalty', String(calculateRoyalty(newAmount)));
                              set('growth_share', String(calculateGrowthShare(newAmount)));
                              set('procurement_fee_amount', '');
                            }} 
                            className="input-field" 
                            placeholder="e.g., 5 for 5%"
                          />
                        </label>
                      )}

                      {procurementMode === 'amount' && (
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Commission Amount (R)</span>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 font-medium min-w-fit">R</span>
                            <input 
                              type="number" 
                              value={form.procurement_fee_amount} 
                              onChange={(e) => {
                                set('procurement_fee_amount', e.target.value);
                                const newAmount = Number(e.target.value) || 0;
                                set('management_fee_amount', String(newAmount));
                                set('gross_commission', String(calculateGCI(newAmount)));
                                set('royalty', String(calculateRoyalty(newAmount)));
                                set('growth_share', String(calculateGrowthShare(newAmount)));
                                set('management_fee_percentage', '');
                              }} 
                              className="input-field flex-1" 
                              placeholder="e.g., 25000"
                            />
                          </div>
                        </label>
                      )}

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Commission Amount Calculated (R)</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 font-medium min-w-fit">R</span>
                          <input 
                            type="number" 
                            value={form.management_fee_amount} 
                            disabled 
                            className="input-field flex-1 bg-slate-100 text-slate-600 cursor-not-allowed"
                            title="Auto-calculated"
                          />
                        </div>
                      </label>
                    </>
                  )}
                  {form.rental_type === 'MANAGEMENT' && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Management Fee %</span>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={form.management_fee_percentage} 
                          onChange={(e) => {
                            set('management_fee_percentage', e.target.value);
                            const newAmount = calculateManagementFeeAmount(Number(form.rental_amount) || 0, Number(e.target.value) || 0);
                            set('management_fee_amount', String(newAmount));
                            set('gross_commission', String(calculateGCI(newAmount)));
                            set('royalty', String(calculateRoyalty(newAmount)));
                            set('growth_share', String(calculateGrowthShare(newAmount)));
                          }} 
                          className="input-field" 
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Management Fee (R)</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 font-medium min-w-fit">R</span>
                          <input 
                            type="number" 
                            value={form.management_fee_amount} 
                            disabled 
                            className="input-field flex-1 bg-slate-100 text-slate-600 cursor-not-allowed"
                            title="Auto-calculated from management fee percentage"
                          />
                        </div>
                      </label>
                    </>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Gross Commission (R)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-medium min-w-fit">R</span>
                      <input 
                        type="number" 
                        value={form.gross_commission} 
                        disabled 
                        className="input-field flex-1 bg-slate-100 text-slate-600 cursor-not-allowed"
                        title="Auto-calculated from Management Fee - Royalty - Growth Share"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Royalty (R)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-medium min-w-fit">R</span>
                      <input 
                        type="number" 
                        value={form.royalty} 
                        disabled 
                        className="input-field flex-1 bg-slate-100 text-slate-600 cursor-not-allowed"
                        title="Auto-calculated: 6% of Management Fee"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Growth Share (R)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-medium min-w-fit">R</span>
                      <input 
                        type="number" 
                        value={form.growth_share} 
                        disabled 
                        className="input-field flex-1 bg-slate-100 text-slate-600 cursor-not-allowed"
                        title="Auto-calculated: 2% of Management Fee"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="col-span-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Notes</span>
                  <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="input-field" rows={4} />
                </label>
              </div>
            </div>
          )}

          {/* Agents Tab */}
          {formTab === 'agents' && (
            <div className="space-y-5">
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                <p className="text-sm text-blue-800">
                  <strong>Setup Instructions:</strong> Add agents with their deal split percentages. For each agent, set CO$ Split and Agent Split (must total 100% per agent). 
                  Calculations will auto-populate based on GCI from Rental Details tab.
                </p>
              </div>
              {participants.length > 0 && (
                <div className="text-sm font-medium text-slate-700 bg-slate-50 p-3 rounded-lg">
                  Total agent deal split: {participants.reduce((s, p) => s + (p.agent_deal_split ?? 0), 0).toFixed(2)}%
                  {Math.abs(participants.reduce((s, p) => s + (p.agent_deal_split ?? 0), 0) - 100) > 0.01 && (
                    <span className="ml-2 text-amber-600">Must equal 100%</span>
                  )}
                </div>
              )}
              {participants.map((p, idx) => {
                const gciPercentage = (p.agent_deal_split ?? 0) / 100;
                const agentGCI = (Number(form.gross_commission) || 0) * gciPercentage;
                const agentMCShare = (agentGCI * (p.market_center_split ?? 0)) / 100;
                const agentShare = (agentGCI * (p.agent_split ?? 0)) / 100;
                
                return (
                  <div key={idx} className="rounded-xl border border-slate-200 p-5 space-y-4 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">Agent {idx + 1}</span>
                      <button type="button" onClick={() => removeParticipant(idx)} className="text-sm text-red-600 hover:underline">Remove</button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {/* Agent Selection */}
                      <div className="relative col-span-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Rental Associate *</span>
                          <input
                            value={activeParticipantIdx === idx ? associateSearchQuery : (p.associate_name || '')}
                            onChange={(e) => {
                              setActiveParticipantIdx(idx);
                              setAssociateSearchQuery(e.target.value);
                              setAssociateSearchOpen(e.target.value.trim().length >= 2);
                              if (!e.target.value.trim()) {
                                updateParticipant(idx, 'associate_id', '');
                                updateParticipant(idx, 'associate_name', '');
                              }
                            }}
                            onFocus={() => {
                              setActiveParticipantIdx(idx);
                              setAssociateSearchQuery(p.associate_name || '');
                              if ((p.associate_name || '').trim().length >= 2) setAssociateSearchOpen(true);
                            }}
                            onBlur={() => setTimeout(() => setAssociateSearchOpen(false), 120)}
                            placeholder="Search active associates..."
                            className="input-field"
                          />
                        </label>
                        {associateSearchOpen && activeParticipantIdx === idx && (associateSearchData?.items ?? []).length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {(associateSearchData?.items ?? []).map((item) => (
                              <button
                                key={`${item.source_associate_id}_${item.email ?? ''}`}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  selectAssociateForParticipant(idx, item);
                                }}
                                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                              >
                                <p className="text-sm font-medium text-slate-900">{item.full_name ?? item.source_associate_id}</p>
                                <p className="text-xs text-slate-500">{item.source_associate_id}{item.market_center_name ? ` | ${item.market_center_name}` : ''}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Deal Split */}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Agent Deal Split (%)</span>
                        <input 
                          type="text"
                          inputMode="decimal"
                          value={p.agent_deal_split} 
                          onChange={(e) => updateParticipant(idx, 'agent_deal_split', parsePercentageInput(e.target.value))} 
                          className="input-field" 
                          placeholder="e.g., 15 for 15% of deal"
                        />
                      </label>
                      
                      {/* Market Centre Split */}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">CO$ Split (%)</span>
                        <input 
                          type="text"
                          inputMode="decimal"
                          value={p.market_center_split} 
                          onChange={(e) => {
                            const newMCVal = parsePercentageInput(e.target.value);
                            updateParticipant(idx, 'market_center_split', newMCVal);
                            // Auto-adjust agent split to maintain 100%
                            if (newMCVal + (p.agent_split ?? 0) > 100) {
                              updateParticipant(idx, 'agent_split', Math.max(0, 100 - newMCVal));
                            }
                          }} 
                          className="input-field" 
                          placeholder="e.g., 40"
                        />
                      </label>
                      
                      {/* Agent Split */}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Agent Split (%)</span>
                        <input 
                          type="text"
                          inputMode="decimal"
                          value={p.agent_split} 
                          onChange={(e) => {
                            const newAgentVal = parsePercentageInput(e.target.value);
                            updateParticipant(idx, 'agent_split', newAgentVal);
                            // Auto-adjust MC split to maintain 100%
                            if ((p.market_center_split ?? 0) + newAgentVal > 100) {
                              updateParticipant(idx, 'market_center_split', Math.max(0, 100 - newAgentVal));
                            }
                          }} 
                          className="input-field" 
                          placeholder="e.g., 60"
                        />
                      </label>

                      {/* Role */}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Role</span>
                        <select value={p.participant_role} onChange={(e) => updateParticipant(idx, 'participant_role', e.target.value)} className="input-field">
                          {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{PARTICIPANT_ROLE_LABELS[r] ?? formatEnumLabel(r)}</option>)}
                        </select>
                      </label>

                      {/* Calculated Values Section */}
                      <div className="col-span-3 border-t pt-3 mt-2">
                        <p className="text-xs font-semibold text-slate-700 mb-2">Auto-Calculated Values (Monthly)</p>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <span className="text-xs text-slate-600">Agent GCI</span>
                            <p className="font-semibold text-slate-900">R {agentGCI.toLocaleString('en-ZA', {maximumFractionDigits: 2})}</p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-600">CO$</span>
                            <p className="font-semibold text-slate-900">R {agentMCShare.toLocaleString('en-ZA', {maximumFractionDigits: 2})}</p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-600">Agent Share (Net)</span>
                            <p className="font-semibold text-slate-900">R {agentShare.toLocaleString('en-ZA', {maximumFractionDigits: 2})}</p>
                          </div>
                        </div>
                      </div>

                      {/* Cap Checkbox */}
                      <div className="col-span-3 flex items-center gap-2 pt-2">
                        <input type="checkbox" id={`cap_${idx}`} checked={p.counts_toward_cap} onChange={(e) => updateParticipant(idx, 'counts_toward_cap', e.target.checked)} className="h-4 w-4 rounded accent-red-700" />
                        <label htmlFor={`cap_${idx}`} className="text-sm font-medium text-slate-700">Counts toward agent cap</label>
                      </div>

                      {/* Split Validation */}
                      {(Math.abs((p.market_center_split ?? 0) + (p.agent_split ?? 0) - 100) > 0.01) && (
                        <div className="col-span-3 text-xs text-amber-600 font-medium">
                          ⚠ CO$ Split + Agent Split must equal 100% (currently {((p.market_center_split ?? 0) + (p.agent_split ?? 0)).toFixed(2)}%)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={addParticipant} className="text-sm text-red-700 hover:underline font-medium">+ Add Agent</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────

function MarkPaidModal({
  scheduleItem,
  onClose,
  onSaved,
  token,
  activeContext,
}: {
  scheduleItem: PaymentScheduleItem;
  onClose: () => void;
  onSaved: (result: { transactionId: string | null; transactionNumber: string | null }) => void;
  token: string | null;
  activeContext: import('../contexts/AuthContext').UserContext | null;
}) {
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeContext ? { 'X-Active-Context': activeContext.id } : {}),
  };

  const handleMarkPaid = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await apiFetch<{ transaction_id: string | null; transaction_number?: string | null }>(
        `/api/rentals/payment-schedule/${scheduleItem.id}/mark-paid`,
        { method: 'POST', body: JSON.stringify({ paid_date: paidDate }), headers: reqHeaders },
        null
      );
      onSaved({
        transactionId: result.transaction_id ?? null,
        transactionNumber: result.transaction_number ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as paid.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Mark Payment as Paid</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <p className="text-sm text-slate-600">
            Marking <strong>{scheduleItem.rental_number}</strong> — Due {toShortDate(scheduleItem.due_date)} — {toMoney(scheduleItem.expected_rental_amount)} as PAID.
          </p>
          <p className="text-sm text-slate-600">This will create a Rental Transaction automatically.</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Paid Date *</label>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="input-field w-full" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium text-sm">Cancel</button>
          <button type="button" onClick={handleMarkPaid} disabled={saving} className="primary-btn text-sm">
            {saving ? 'Processing...' : 'Confirm Paid'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancel Payment Modal ─────────────────────────────────────────────────────

function CancelPaymentModal({
  scheduleItem,
  onClose,
  onSaved,
  token,
  activeContext,
}: {
  scheduleItem: PaymentScheduleItem;
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
  activeContext: import('../contexts/AuthContext').UserContext | null;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeContext ? { 'X-Active-Context': activeContext.id } : {}),
  };

  const handleCancel = async () => {
    if (!reason.trim()) { setError('Cancellation reason is required.'); return; }
    setError(null);
    setSaving(true);
    try {
      await apiFetch(
        `/api/rentals/payment-schedule/${scheduleItem.id}/cancel`,
        { method: 'POST', body: JSON.stringify({ cancelled_reason: reason }), headers: reqHeaders },
        null
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Cancel Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <p className="text-sm text-slate-600">
            Cancelling payment for <strong>{scheduleItem.rental_number}</strong> due on {toShortDate(scheduleItem.due_date)}.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Cancellation Reason *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="input-field w-full" rows={3} placeholder="Enter reason..." />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium text-sm">Close</button>
          <button type="button" onClick={handleCancel} disabled={saving} className="bg-red-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm text-sm hover:bg-red-800">
            {saving ? 'Cancelling...' : 'Cancel Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function toAuditValueText(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toAuditActionLabel(action: string): string {
  switch (action) {
    case 'RENTAL_CREATED':
      return 'Rental created';
    case 'RENTAL_UPDATED':
      return 'Rental updated';
    case 'DOCUMENT_ADDED':
      return 'Document added';
    case 'DOCUMENT_DELETED':
      return 'Document deleted';
    case 'PAYMENT_MARKED_PAID':
      return 'Payment marked as paid';
    case 'PAYMENT_CANCELLED':
      return 'Payment cancelled';
    default:
      return formatEnumLabel(action);
  }
}

function toAuditFieldLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function toAuditSummaryLines(item: RentalAuditItem): string[] {
  const source = (item.new_value && typeof item.new_value === 'object' && !Array.isArray(item.new_value))
    ? item.new_value as Record<string, unknown>
    : (item.old_value && typeof item.old_value === 'object' && !Array.isArray(item.old_value))
      ? item.old_value as Record<string, unknown>
      : null;

  if (!source) return [];

  const preferredKeys = [
    'rental_number',
    'rental_type',
    'document_name',
    'document_type',
    'file_name',
    'file_url',
    'paid_date',
    'cancelled_reason',
    'transaction_id',
  ];

  const orderedKeys = [
    ...preferredKeys.filter((k) => Object.prototype.hasOwnProperty.call(source, k)),
    ...Object.keys(source).filter((k) => !preferredKeys.includes(k)),
  ];

  return orderedKeys
    .map((key) => {
      const value = source[key];
      if (value == null || value === '') return null;
      if (typeof value === 'object') return `${toAuditFieldLabel(key)}: ${toAuditValueText(value)}`;
      return `${toAuditFieldLabel(key)}: ${String(value)}`;
    })
    .filter((line): line is string => Boolean(line));
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read selected file.'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function RentalWorkspaceModal({
  rental,
  onClose,
  token,
  activeContext,
  onChanged,
}: {
  rental: Rental;
  onClose: () => void;
  token: string | null;
  activeContext: import('../contexts/AuthContext').UserContext | null;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'documents' | 'audit'>('overview');
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('OTHER');
  const [docFileName, setDocFileName] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const reqHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeContext ? { 'X-Active-Context': activeContext.id } : {}),
  };

  const workspaceQuery = useQuery({
    queryKey: ['rental-workspace', rental.id],
    queryFn: () => apiFetch<Rental & { documents: RentalDocument[] }>(`/api/rentals/${rental.id}`, { headers: reqHeaders }, null),
  });

  const auditQuery = useQuery({
    queryKey: ['rental-audit', rental.id],
    queryFn: () => apiFetch<{ items: RentalAuditItem[] }>(`/api/rentals/${rental.id}/audit-log`, { headers: reqHeaders }, null),
    enabled: tab === 'audit',
  });

  const addDocumentMutation = useMutation({
    mutationFn: async () => {
      if (docFile) {
        const contentBase64 = await readFileAsBase64(docFile);
        return apiFetch<RentalDocument>(
          `/api/rentals/${rental.id}/documents/upload`,
          {
            method: 'POST',
            body: JSON.stringify({
              document_name: docName,
              document_type: docType,
              file_name: docFile.name,
              mime_type: docFile.type || 'application/octet-stream',
              content_base64: contentBase64,
            }),
            headers: { ...reqHeaders },
          },
          null
        );
      }

      return apiFetch<RentalDocument>(
        `/api/rentals/${rental.id}/documents`,
        {
          method: 'POST',
          body: JSON.stringify({
            document_name: docName,
            document_type: docType,
            file_name: docFileName || null,
            file_url: docUrl || null,
          }),
          headers: { ...reqHeaders },
        },
        null
      );
    },
    onSuccess: () => {
      setDocName('');
      setDocType('OTHER');
      setDocFileName('');
      setDocUrl('');
      setDocFile(null);
      setDocError(null);
      void workspaceQuery.refetch();
      void auditQuery.refetch();
      onChanged();
    },
    onError: (error: unknown) => {
      setDocError(error instanceof Error ? error.message : 'Failed to add document.');
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      return apiFetch<{ deleted: boolean }>(`/api/rentals/documents/${documentId}`, { method: 'DELETE', headers: { ...reqHeaders } }, null);
    },
    onSuccess: () => {
      setDocError(null);
      void workspaceQuery.refetch();
      void auditQuery.refetch();
      onChanged();
    },
    onError: (error: unknown) => {
      setDocError(error instanceof Error ? error.message : 'Failed to delete document.');
    },
  });

  const rentalData = workspaceQuery.data;
  const documents = rentalData?.documents ?? [];
  const participants = rentalData?.participants ?? [];
  const auditItems = auditQuery.data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Rental Workspace</p>
            <h2 className="text-xl font-semibold text-slate-900">{rental.rental_number} - {rental.property_address}</h2>
          </div>
          <button onClick={onClose} type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Close</button>
        </div>

        <div className="flex border-b border-slate-200 px-6">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'documents', label: 'Documents' },
            { key: 'audit', label: 'Audit Trail' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as 'overview' | 'documents' | 'audit')}
              className={clsx(
                'mr-6 border-b-2 px-2 py-3 text-sm font-medium',
                tab === item.key ? 'border-red-600 text-red-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          {workspaceQuery.isLoading && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">Loading rental workspace...</div>}
          {workspaceQuery.isError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">Failed to load rental workspace.</div>}

          {!workspaceQuery.isLoading && rentalData && tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="kpi-card">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{formatEnumLabel(rentalData.rental_status)}</p>
                </div>
                <div className="kpi-card">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Rental Amount</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{toMoney(rentalData.rental_amount)}</p>
                </div>
                <div className="kpi-card">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Gross Commission</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{toMoney(rentalData.gross_commission)}</p>
                </div>
                <div className="kpi-card">
                  <p className="text-xs uppercase tracking-wide text-slate-500">CO$</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{toMoney(rentalData.company_dollar)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Participants</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Associate</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Split %</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">CO$</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Cap</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {participants.map((participant, idx) => (
                        <tr key={`${participant.associate_id}-${idx}`}>
                          <td className="px-3 py-2">{participant.associate_name || participant.associate_id || '-'}</td>
                          <td className="px-3 py-2">{PARTICIPANT_ROLE_LABELS[participant.participant_role] ?? formatEnumLabel(participant.participant_role)}</td>
                          <td className="px-3 py-2">{Number(participant.agent_deal_split ?? 0).toFixed(2)}%</td>
                          <td className="px-3 py-2">{toMoney(participant.company_dollar_amount)}</td>
                          <td className="px-3 py-2">{participant.counts_toward_cap ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                      {participants.length === 0 && (
                        <tr>
                          <td className="px-3 py-4 text-slate-500" colSpan={5}>No participants attached to this rental yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {!workspaceQuery.isLoading && rentalData && tab === 'documents' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Add Document</h3>
                {docError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{docError}</div>}
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Document Name *</span>
                    <input value={docName} onChange={(e) => setDocName(e.target.value)} className="input-field" placeholder="Lease Agreement - May 2026" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Document Type</span>
                    <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input-field">
                      {RENTAL_DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type}>{formatEnumLabel(type)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">File Name</span>
                    <input value={docFileName} onChange={(e) => setDocFileName(e.target.value)} className="input-field" placeholder="lease-may-2026.pdf" disabled={Boolean(docFile)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">File URL</span>
                    <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} className="input-field" placeholder="https://... or /uploads/..." disabled={Boolean(docFile)} />
                  </label>
                  <label className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs font-medium text-slate-600">Upload From Your PC</span>
                    <input
                      type="file"
                      className="input-field"
                      onChange={(e) => {
                        const selected = e.target.files?.[0] ?? null;
                        setDocFile(selected);
                        if (selected) {
                          setDocFileName(selected.name);
                          setDocUrl('');
                        }
                      }}
                    />
                    <p className="text-xs text-slate-500">
                      Choose a file to upload and store as a URL automatically. If no file is selected, the manual URL fields are used.
                    </p>
                  </label>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={addDocumentMutation.isPending}
                    onClick={() => {
                      if (!docName.trim()) {
                        setDocError('Document name is required.');
                        return;
                      }
                      setDocError(null);
                      addDocumentMutation.mutate();
                    }}
                    className="primary-btn text-sm"
                  >
                    {addDocumentMutation.isPending ? 'Saving...' : 'Add Document'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">File</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="px-3 py-2 font-medium text-slate-900">{doc.document_name}</td>
                        <td className="px-3 py-2 text-slate-700">{formatEnumLabel(doc.document_type)}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {doc.file_url ? (
                            <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-red-700 hover:underline">
                              {doc.file_name ?? 'Open file'}
                            </a>
                          ) : (
                            doc.file_name ?? '-'
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{toShortDate(doc.uploaded_at)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => deleteDocumentMutation.mutate(doc.id)}
                            disabled={deleteDocumentMutation.isPending}
                            className="text-xs font-medium text-slate-500 hover:text-red-700 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {documents.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={5}>No documents added yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!workspaceQuery.isLoading && rentalData && tab === 'audit' && (
            <div className="space-y-3">
              {auditQuery.isLoading && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">Loading audit trail...</div>}
              {!auditQuery.isLoading && auditItems.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">No audit entries found for this rental.</div>
              )}
              {auditItems.map((item) => (
                <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{toAuditActionLabel(item.action)}</p>
                    <p className="text-xs text-slate-500">{new Date(item.changed_at).toLocaleString('en-ZA')}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">By: {item.changed_by_user_id ?? 'Unknown'}</p>
                  {toAuditSummaryLines(item).length > 0 ? (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                      {toAuditSummaryLines(item).map((line, idx) => (
                        <p key={`${item.id}-line-${idx}`} className="leading-5">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                      No additional details were captured for this event.
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Summary Cards ──────────────────────────────────────────────────

function RentalDashboardCards({ token, activeContext }: { token: string | null; activeContext: import('../contexts/AuthContext').UserContext | null }) {
  const { data } = useQuery({
    queryKey: ['rentals-dashboard'],
    queryFn: () => {
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const activeContextHeader: Record<string, string> = activeContext ? { 'X-Active-Context': activeContext.id } : {};
      const headers = { ...authHeaders, ...activeContextHeader };
      return apiFetch<{
        active_rentals: number;
        cancelled_rentals: number;
        due_today: number;
        overdue_payments: number;
        paid_this_month: number;
        rental_gci_this_month: number;
        rental_co_dollar_this_month: number;
      }>('/api/rentals/dashboard/summary', { headers });
    },
    refetchInterval: 60000,
  });

  const cards = [
    { label: 'Active Rentals', value: data?.active_rentals ?? '-', icon: 'home' as const },
    { label: 'Due Today', value: data?.due_today ?? '-', icon: 'calendar' as const, highlight: (data?.due_today ?? 0) > 0 },
    { label: 'Overdue', value: data?.overdue_payments ?? '-', icon: 'alert' as const, highlight: (data?.overdue_payments ?? 0) > 0, urgent: true },
    { label: 'Paid This Month', value: data?.paid_this_month ?? '-', icon: 'check' as const },
    { label: 'Rental GCI (MTD)', value: toMoney(data?.rental_gci_this_month ?? 0), icon: 'trend' as const },
    { label: 'Rental CO$ (MTD)', value: toMoney(data?.rental_co_dollar_this_month ?? 0), icon: 'wallet' as const },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className={clsx('kpi-card', c.urgent ? 'border-red-200 bg-gradient-to-br from-red-50 to-white' : '')}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <span className={clsx('rounded-md p-1.5', c.urgent ? 'bg-red-100 text-red-700' : c.highlight ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
              <UiIcon kind={c.icon} className="h-4 w-4" />
            </span>
          </div>
          <p className={clsx('mt-3 text-2xl font-bold', c.urgent ? 'text-red-700' : c.highlight ? 'text-amber-700' : 'text-slate-900')}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RentalsPage() {
  const { token, activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();
  const queryClient = useQueryClient();

  const isAdminRole = isOfficeAdmin || isRegionalAdmin;

  const [view, setView] = useState<'register' | 'schedule'>('register');

  // Register state
  const [regPage, setRegPage] = useState(1);
  const [regSearch, setRegSearch] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [regType, setRegType] = useState('');
  const [showNewRental, setShowNewRental] = useState(false);
  const [editRental, setEditRental] = useState<Partial<RentalFormState & { id?: number; participants?: RentalParticipant[] }> | null>(null);
  const [workspaceRental, setWorkspaceRental] = useState<Rental | null>(null);

  // Payment schedule state
  const [schedPage, setSchedPage] = useState(1);
  const [schedStatus, setSchedStatus] = useState('');
  const [schedSearch, setSchedSearch] = useState('');
  const [markPaidItem, setMarkPaidItem] = useState<PaymentScheduleItem | null>(null);
  const [cancelPayItem, setCancelPayItem] = useState<PaymentScheduleItem | null>(null);
  const [markPaidSuccess, setMarkPaidSuccess] = useState<string | null>(null);

  const PAGE_SIZE = 25;

  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const activeContextHeader: Record<string, string> = activeContext ? { 'X-Active-Context': activeContext.id } : {};
  const reqHeaders: Record<string, string> = { ...authHeaders, ...activeContextHeader };

  // Rentals register query
  const rentalsQuery = useQuery({
    queryKey: ['rentals', regPage, regSearch, regStatus, regType],
    queryFn: () => apiFetch<{ total: number; items: Rental[] }>(
      `/api/rentals?limit=${PAGE_SIZE}&offset=${(regPage - 1) * PAGE_SIZE}&search=${encodeURIComponent(regSearch)}&status=${regStatus}&type=${regType}`,
      { headers: reqHeaders }
    ),
    enabled: view === 'register',
  });

  // Payment schedule query
  const scheduleQuery = useQuery({
    queryKey: ['rental-schedule', schedPage, schedStatus, schedSearch],
    queryFn: () => apiFetch<{ total: number; items: PaymentScheduleItem[] }>(
      `/api/rentals/payment-schedule?limit=${PAGE_SIZE}&offset=${(schedPage - 1) * PAGE_SIZE}&status=${schedStatus}&search=${encodeURIComponent(schedSearch)}`,
      { headers: reqHeaders }
    ),
    enabled: view === 'schedule',
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['rentals'] });
    void queryClient.invalidateQueries({ queryKey: ['rental-schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['rentals-dashboard'] });
  };

  const cancelRentalMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      return apiFetch(`/api/rentals/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancelled_reason: reason }),
        headers: { 'Content-Type': 'application/json', ...reqHeaders },
      }, null);
    },
    onSuccess: () => invalidateAll(),
  });

  if (!isAdminRole) {
    return (
      <div className="flex items-center justify-center h-96 text-slate-500">
        <p>You do not have permission to access the Rentals module.</p>
      </div>
    );
  }

  const rentals = rentalsQuery.data?.items ?? [];
  const rentalsTotal = rentalsQuery.data?.total ?? 0;
  const scheduleItems = scheduleQuery.data?.items ?? [];
  const scheduleTotal = scheduleQuery.data?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Rentals</h1>
          <p className="muted-text mt-1 text-sm">Manage rental agreements, participants, and payment schedules.</p>
        </div>
        {view === 'register' && (
          <button onClick={() => setShowNewRental(true)} className="primary-btn inline-flex items-center gap-1.5 text-sm">
            <UiIcon kind="plus" className="h-4 w-4" />
            New Rental
          </button>
        )}
      </header>

      {/* Dashboard cards */}
      <RentalDashboardCards token={token} activeContext={activeContext} />

      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        <UiIcon kind="info" className="h-3.5 w-3.5 text-slate-500" />
        <span>Rental workflow: Load rental → Track monthly payment → Submit payment → Create rental transaction → Choose cap treatment.</span>
      </div>

      {/* View tabs */}
      <div className="surface-card">
        <div className="flex border-b border-slate-200 px-6">
          {(['register', 'schedule'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clsx(
                'mr-6 inline-flex items-center gap-2 py-4 px-2 text-sm font-medium border-b-2 transition-colors',
                view === v ? 'border-red-600 text-red-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              <UiIcon kind={v === 'register' ? 'register' : 'schedule'} className="h-4 w-4" />
              {v === 'register' ? 'Rentals Register' : 'Payment Schedule'}
            </button>
          ))}
        </div>

        {/* ── RENTALS REGISTER ── */}
        {view === 'register' && (
          <div className="p-6 space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <input
                value={regSearch}
                onChange={(e) => { setRegSearch(e.target.value); setRegPage(1); }}
                placeholder="Search by address, landlord, tenant, rental #…"
                className="input-field flex-1 min-w-48"
              />
              <select value={regStatus} onChange={(e) => { setRegStatus(e.target.value); setRegPage(1); }} className="input-field w-40">
                <option value="">All statuses</option>
                {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
              </select>
              <select value={regType} onChange={(e) => { setRegType(e.target.value); setRegPage(1); }} className="input-field w-44">
                <option value="">All types</option>
                {RENTAL_TYPES.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}
              </select>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Rental #', 'Property', 'Landlord', 'Tenant', 'Type', 'Status', 'Lease Period', 'Rental Amt', 'CO$', 'Cap', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rentalsQuery.isLoading && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">Loading rentals…</td></tr>
                  )}
                  {rentalsQuery.isError && (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-red-700">Rentals could not be loaded.</p>
                        <p className="mt-1 text-sm text-slate-500">Please refresh or check the connection. If the issue continues, report it to support.</p>
                        <button type="button" onClick={() => void rentalsQuery.refetch()} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Retry</button>
                      </td>
                    </tr>
                  )}
                  {!rentalsQuery.isLoading && rentals.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-slate-700">No rentals found yet.</p>
                        <p className="mt-1 text-sm text-slate-500">Create your first rental agreement to start tracking payments, commission and CO$.</p>
                        <button type="button" onClick={() => setShowNewRental(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                          <UiIcon kind="plus" className="h-3.5 w-3.5" />
                          New Rental
                        </button>
                      </td>
                    </tr>
                  )}
                  {rentals.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 font-medium">{r.rental_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 truncate max-w-44">{r.property_address}</div>
                        {r.suburb && <div className="text-xs text-slate-500">{r.suburb}{r.city ? `, ${r.city}` : ''}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {[r.landlord_name, r.landlord_surname_or_company].filter(Boolean).join(' ') || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {[r.tenant_name, r.tenant_surname_or_company].filter(Boolean).join(' ') || '-'}
                      </td>
                      <td className="px-4 py-3"><span className="status-chip info text-xs">{formatEnumLabel(r.rental_type)}</span></td>
                      <td className="px-4 py-3"><StatusChip status={r.rental_status} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {r.lease_start_date ? toShortDate(r.lease_start_date) : '-'} – {r.lease_end_date ? toShortDate(r.lease_end_date) : '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{toMoney(r.rental_amount)}</td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{toMoney(r.company_dollar)}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold', r.counts_toward_cap ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                          {r.counts_toward_cap ? 'Cap Linked' : 'Outside Cap'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setWorkspaceRental(r)}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                          >
                            Workspace
                          </button>
                          <button
                            onClick={() => setEditRental(r as unknown as Partial<RentalFormState & { id?: number; participants?: RentalParticipant[] }>)}
                            className="text-xs font-medium text-red-700 hover:underline"
                          >
                            Edit
                          </button>
                          {r.rental_status !== 'CANCELLED' && (
                            <button
                              onClick={() => {
                                const reason = window.prompt('Cancellation reason:');
                                if (reason) cancelRentalMutation.mutate({ id: r.id, reason });
                              }}
                              className="text-xs font-medium text-slate-500 hover:text-red-700 hover:underline"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {rentalsTotal > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>{rentalsTotal} total rentals</span>
                <div className="flex gap-2">
                  <button disabled={regPage === 1} onClick={() => setRegPage(p => p - 1)} className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Prev</button>
                  <span className="px-3 py-1">Page {regPage} / {Math.ceil(rentalsTotal / PAGE_SIZE)}</span>
                  <button disabled={regPage >= Math.ceil(rentalsTotal / PAGE_SIZE)} onClick={() => setRegPage(p => p + 1)} className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PAYMENT SCHEDULE ── */}
        {view === 'schedule' && (
          <div className="p-6 space-y-4">
            {markPaidSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                {markPaidSuccess}
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <input
                value={schedSearch}
                onChange={(e) => { setSchedSearch(e.target.value); setSchedPage(1); }}
                placeholder="Search by rental #, address, landlord, tenant…"
                className="input-field flex-1 min-w-48"
              />
              <select value={schedStatus} onChange={(e) => { setSchedStatus(e.target.value); setSchedPage(1); }} className="input-field w-40">
                <option value="">All statuses</option>
                <option value="DUE">Due Today</option>
                <option value="DUE_30">Due in 30 days</option>
                <option value="OVERDUE">Overdue</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="PAID">Paid</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            {/* Quick status pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'All', value: '' },
                { label: 'Due Today', value: 'DUE' },
                { label: 'Due in 30 days', value: 'DUE_30' },
                { label: 'Overdue', value: 'OVERDUE' },
                { label: 'Upcoming', value: 'UPCOMING' },
                { label: 'Paid', value: 'PAID' },
                { label: 'Cancelled', value: 'CANCELLED' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setSchedStatus(opt.value); setSchedPage(1); }}
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    schedStatus === opt.value
                      ? 'bg-red-700 text-white border-red-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Rental #', 'Property', 'MC', 'Landlord', 'Tenant', 'Due Date', 'Period', 'Rent Amt', 'Commission', 'CO$', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {scheduleQuery.isLoading && (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">Loading payment schedule…</td></tr>
                  )}
                  {scheduleQuery.isError && (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-red-700">Rentals could not be loaded.</p>
                        <p className="mt-1 text-sm text-slate-500">Please refresh or check the connection. If the issue continues, report it to support.</p>
                        <button type="button" onClick={() => void scheduleQuery.refetch()} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Retry</button>
                      </td>
                    </tr>
                  )}
                  {!scheduleQuery.isLoading && scheduleItems.length === 0 && (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">No payment schedule items found.</td></tr>
                  )}
                  {scheduleItems.map((item) => (
                    <tr key={item.id} className={clsx(
                      'transition-colors',
                      item.payment_status === 'OVERDUE' ? 'bg-red-50 hover:bg-red-100' :
                      item.payment_status === 'DUE' ? 'bg-amber-50 hover:bg-amber-100' :
                      'hover:bg-slate-50'
                    )}>
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700">{item.rental_number} <span className="text-slate-400">#{item.payment_sequence_number}</span></td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 truncate max-w-40">{item.property_address}</div>
                        {item.suburb && <div className="text-xs text-slate-500">{item.suburb}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-32 truncate">{item.market_centre_name ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">{item.landlord_name ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">{item.tenant_name ?? '-'}</td>
                      <td className={clsx('px-4 py-3 text-xs font-medium whitespace-nowrap', item.payment_status === 'OVERDUE' ? 'text-red-700' : item.payment_status === 'DUE' ? 'text-amber-700' : 'text-slate-700')}>{toShortDate(item.due_date)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {item.period_start_date ? toShortDate(item.period_start_date) : '-'} – {item.period_end_date ? toShortDate(item.period_end_date) : '-'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{toMoney(item.expected_rental_amount)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{toMoney(item.expected_commission_amount)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{toMoney(item.company_dollar)}</td>
                      <td className="px-4 py-3"><StatusChip status={item.payment_status} /></td>
                      <td className="px-4 py-3">
                        {item.payment_status !== 'PAID' && item.payment_status !== 'CANCELLED' && (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <button
                              onClick={() => setMarkPaidItem(item)}
                              className="text-xs font-medium text-green-700 hover:underline"
                            >
                              Mark Paid
                            </button>
                            <button
                              onClick={() => setCancelPayItem(item)}
                              className="text-xs font-medium text-slate-500 hover:text-red-700 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {item.payment_status === 'PAID' && (
                          <span className="text-xs text-slate-400">{item.transaction_created ? `TXN: ${item.transaction_id ?? 'Created'}` : 'Paid'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {scheduleTotal > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>{scheduleTotal} total payments</span>
                <div className="flex gap-2">
                  <button disabled={schedPage === 1} onClick={() => setSchedPage(p => p - 1)} className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Prev</button>
                  <span className="px-3 py-1">Page {schedPage} / {Math.ceil(scheduleTotal / PAGE_SIZE)}</span>
                  <button disabled={schedPage >= Math.ceil(scheduleTotal / PAGE_SIZE)} onClick={() => setSchedPage(p => p + 1)} className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {(showNewRental || editRental) && (
        <RentalFormModal
          initial={editRental ?? undefined}
          onClose={() => { setShowNewRental(false); setEditRental(null); }}
          onSaved={() => { setShowNewRental(false); setEditRental(null); invalidateAll(); }}
          token={token}
          activeContext={activeContext}
        />
      )}

      {markPaidItem && (
        <MarkPaidModal
          scheduleItem={markPaidItem}
          onClose={() => setMarkPaidItem(null)}
          onSaved={({ transactionId, transactionNumber }) => {
            setMarkPaidItem(null);
            setMarkPaidSuccess(
              transactionNumber
                ? `Payment marked as paid. Rental transaction ${transactionNumber} was created successfully.`
                : transactionId
                  ? `Payment marked as paid. Rental transaction ${transactionId} was created successfully.`
                  : 'Payment marked as paid successfully.',
            );
            invalidateAll();
          }}
          token={token}
          activeContext={activeContext}
        />
      )}

      {cancelPayItem && (
        <CancelPaymentModal
          scheduleItem={cancelPayItem}
          onClose={() => setCancelPayItem(null)}
          onSaved={() => { setCancelPayItem(null); invalidateAll(); }}
          token={token}
          activeContext={activeContext}
        />
      )}

      {workspaceRental && (
        <RentalWorkspaceModal
          rental={workspaceRental}
          onClose={() => setWorkspaceRental(null)}
          token={token}
          activeContext={activeContext}
          onChanged={invalidateAll}
        />
      )}
    </div>
  );
}
