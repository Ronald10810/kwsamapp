import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListingRow = {
  id: string;
  source_listing_id: string;
  listing_number: string | null;
  status_name: string | null;
  listing_status_tag: string | null;
  sale_or_rent: string | null;
  address_line: string | null;
  street_number: string | null;
  street_name: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  price: string | null;
  expiry_date: string | null;
  property_title?: string | null;
  short_title?: string | null;
  property_description?: string | null;
  short_description?: string | null;
  property_type?: string | null;
  property_sub_type?: string | null;
  primary_agent_name?: string | null;
  primary_agent_image_url?: string | null;
  primary_agent_phone?: string | null;
  primary_agent_email?: string | null;
  market_center_logo_url?: string | null;
  primary_contact_name?: string | null;
  primary_contact_phone?: string | null;
  primary_contact_email?: string | null;
  bedroom_count?: number | null;
  bathroom_count?: number | null;
  garage_count?: number | null;
  parking_count?: number | null;
  erf_size?: string | null;
  floor_area?: string | null;
  property24_reference_id?: string | null;
  private_property_reference_id?: string | null;
  kww_reference_id?: string | null;
  entegral_reference_id?: string | null;
  is_draft?: boolean;
  is_published?: boolean;
  mandate_type?: string | null;
  image_urls?: string[];
  thumbnail_url?: string | null;
  updated_at: string;
};

type ListingsResponse = { total: number; limit: number; offset: number; items: ListingRow[] };

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.\-]/g, '').trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function CardStatIcon({ kind }: { kind: 'bed' | 'bath' | 'garage' | 'parking' | 'erf' | 'floor' }) {
  const common = 'h-4 w-4 text-slate-500';
  if (kind === 'bed') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
        <path d="M3 12h18v6H3z" />
        <path d="M5 12V8a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3v3" />
        <path d="M3 18v2M21 18v2" />
      </svg>
    );
  }
  if (kind === 'bath') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
        <path d="M4 13h16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
        <path d="M7 13V7a2 2 0 1 1 4 0v1" />
      </svg>
    );
  }
  if (kind === 'garage') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
        <path d="M3 11l9-6 9 6" />
        <path d="M5 10h14v8H5z" />
        <path d="M8 18v-3M12 18v-3M16 18v-3" />
      </svg>
    );
  }
  if (kind === 'parking') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M10 16V8h4a3 3 0 0 1 0 6h-4" />
      </svg>
    );
  }
  if (kind === 'erf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
        <path d="M4 7h16v10H4z" />
        <path d="M9 7v10M15 7v10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common}>
      <path d="M5 5h14v14H5z" />
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

type AgentEntry = { associate_id: string; agent_name: string; agent_role: string; is_primary: boolean; market_center_id: string; sort_order: number };
type ContactEntry = { full_name: string; phone_number: string; email_address: string };
type ShowTimeEntry = { from_date: string; from_time: string; to_date: string; to_time: string; catch_phrase: string };
type OpenHouseEntry = { open_house_date: string; from_time: string; to_time: string; average_price: string; comments: string };
type MarketingUrlEntry = { url: string; url_type: string; display_name: string };
type FeatureEntry = { feature_category: string; feature_value: string };
type PropertyAreaEntry = { area_type: string; count: string; size: string; description: string; sub_features?: string[] };
type NormalizedImageEntry = { file_url: string; file_name: string; media_type: string; uploaded_by: string; sort_order: number };
type MandateDocumentEntry = { file_name: string; file_url: string; file_type?: string; uploaded_by?: string; uploaded_at?: string; sort_order?: number };

type ListingFormState = {
  // Listing Info
  source_listing_id: string;
  source_market_center_id: string;
  listing_number: string;
  status_name: string;
  listing_status_tag: string;
  ownership_type: string;
  sale_or_rent: string;
  is_draft: boolean;
  is_published: boolean;
  expiry_date: string;
  // Pricing
  price: string;
  agent_property_valuation: string;
  reduced_date: string;
  no_transfer_duty: boolean;
  property_auction: boolean;
  poa: boolean;
  // Description
  property_title: string;
  short_title: string;
  property_description: string;
  short_description: string;
  property_type: string;
  property_sub_type: string;
  descriptive_feature: string;
  retirement_living: boolean;
  // Address
  address_line: string;
  suburb: string;
  city: string;
  province: string;
  country: string;
  erf_number: string;
  unit_number: string;
  door_number: string;
  estate_name: string;
  street_number: string;
  street_name: string;
  postal_code: string;
  longitude: string;
  latitude: string;
  override_display_location: boolean;
  override_display_longitude: string;
  override_display_latitude: string;
  loom_validation_status: string;
  loom_property_id: string;
  loom_address: string;
  // Marketing
  display_address_on_website: boolean;
  viewing_instructions: string;
  viewing_directions: string;
  // Portal integrations
  feed_to_private_property: boolean;
  private_property_ref1: string;
  private_property_ref2: string;
  private_property_sync_status: string;
  feed_to_kww: boolean;
  kww_property_reference: string;
  kww_ref1: string;
  kww_ref2: string;
  kww_sync_status: string;
  feed_to_entegral: boolean;
  entegral_sync_status: string;
  feed_to_property24: boolean;
  property24_ref1: string;
  property24_ref2: string;
  property24_sync_status: string;
  // Mandate
  signed_date: string;
  on_market_since_date: string;
  rates_and_taxes: string;
  monthly_levy: string;
  occupation_date: string;
  mandate_type: string;
  // Property details
  erf_size: string;
  floor_area: string;
  construction_date: string;
  height_restriction: string;
  out_building_size: string;
  zoning_type: string;
  is_furnished: boolean;
  pet_friendly: boolean;
  has_standalone_building: boolean;
  has_flatlet: boolean;
  has_backup_water: boolean;
  wheelchair_accessible: boolean;
  has_generator: boolean;
  has_borehole: boolean;
  has_gas_geyser: boolean;
  has_solar_panels: boolean;
  has_backup_battery_or_inverter: boolean;
  has_solar_geyser: boolean;
  has_water_tank: boolean;
  adsl: boolean;
  fibre: boolean;
  isdn: boolean;
  dialup: boolean;
  fixed_wimax: boolean;
  satellite: boolean;
  nearby_bus_service: boolean;
  nearby_minibus_taxi_service: boolean;
  nearby_train_service: boolean;
  // Commercial / industrial details (P24-aligned)
  commercial_building_name: string;
  commercial_gross_lettable_area_sqm: string;
  commercial_green_building: boolean;
  commercial_building_grade: string;
  commercial_multi_tenanted: boolean;
  commercial_lease_type: string;
  commercial_gross_price: string;
  commercial_net_price: string;
  commercial_availability_date: string;
  commercial_height_of_roof: string;
  commercial_height_of_eaves: string;
  commercial_height_for_racking: string;
  commercial_truck_access: string;
  commercial_dock_levellers: string;
  commercial_height_of_dock_levellers: string;
  commercial_roller_shutter_doors: string;
  commercial_height_of_roller_shutter_doors: string;
  commercial_yard_space_sqm: string;
  commercial_warehouse_space_sqm: string;
  commercial_office_to_warehouse_ratio: string;
  commercial_has_natural_light: boolean;
  commercial_power_availability: string;
  commercial_power_details_description: string;
  commercial_boardrooms_count: string;
  commercial_boardrooms_description: string;
  commercial_boardrooms_furniture_included: boolean;
  commercial_boardrooms_internet_port: boolean;
  commercial_boardrooms_tv_port: boolean;
  commercial_boardrooms_wifi: boolean;
  // Repeatable
  agents: AgentEntry[];
  contacts: ContactEntry[];
  show_times: ShowTimeEntry[];
  open_house: OpenHouseEntry[];
  marketing_urls: MarketingUrlEntry[];
  features: FeatureEntry[];
  property_areas: PropertyAreaEntry[];
  mandate_documents: MandateDocumentEntry[];
  normalized_images: NormalizedImageEntry[];
  image_urls: string[];
};

type OptionsResponse = {
  listing_statuses: string[];
  listing_status_tags: string[];
  ownership_types: string[];
  sale_or_rent_types: string[];
  property_types: string[];
  property_sub_types: Record<string, string[]>;
  mandate_types: string[];
  zoning_types: string[];
  marketing_url_types: string[];
  agent_roles: string[];
  facing_options: string[];
  roof_options: string[];
  style_options: string[];
  walls_options: string[];
  windows_options: string[];
  lifestyle_options: string[];
  property_feature_options: string[];
  property_area_types: string[];
  property_area_sub_features: Record<string, string[]>;
  property_descriptives: Record<string, string[]>;
  commercial_industrial_options: {
    building_grade_options: string[];
    lease_type_options: string[];
    truck_access_options: string[];
    power_availability_options: string[];
  };
  average_price_options: string[];
  provinces: string[];
  cities: string[];
  suburbs: string[];
  city_by_province: Record<string, string[]>;
  suburb_by_city: Record<string, string[]>;
  suburb_by_province: Record<string, string[]>;
};

type ActiveAgentRow = { id: string; full_name: string | null; source_market_center_id: string | null; market_center_id: string | null; market_center_name: string | null };

type ViewMode = 'card' | 'list';
type ListingSection = 'info' | 'address' | 'marketing' | 'images' | 'mandate' | 'property';

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toInputDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function toMoney(value: string | null): string {
  if (!value) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}

function buildProperty24Url(referenceId: string | null | undefined): string | null {
  const reference = referenceId?.trim();
  if (!reference) return null;
  return `https://www.property24.com/search?query=${encodeURIComponent(reference)}`;
}

function buildPrivatePropertyUrl(referenceId: string | null | undefined): string | null {
  const reference = referenceId?.trim();
  if (!reference) return null;
  return `https://www.privateproperty.co.za/search?searchTerms=${encodeURIComponent(reference)}`;
}

function normalizeReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return null;
  return trimmed;
}

function firstReference(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeReference(value);
    if (normalized) return normalized;
  }
  return null;
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on', 't'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'f', ''].includes(normalized)) return false;
  }
  return false;
}

function deriveListingStatusTag(statusTag: string | null | undefined, saleOrRent: string | null | undefined): string {
  const rawStatusTag = (statusTag ?? '').trim();
  const rawSaleOrRent = (saleOrRent ?? '').trim();
  if (!rawStatusTag && !rawSaleOrRent) return '';

  const normalizedStatusTag = rawStatusTag.toLowerCase();
  const normalizedSaleOrRent = rawSaleOrRent.toLowerCase();
  const isRental = normalizedSaleOrRent.includes('rental') || normalizedSaleOrRent.includes('rent');

  if (isRental && (!rawStatusTag || normalizedStatusTag === 'for sale')) {
    return 'To Rent';
  }

  if (rawStatusTag) return rawStatusTag;
  return rawSaleOrRent;
}

function normalizeImageUrls(input: string[]): string[] {
  const cleaned = input.map((v) => v.trim()).filter((v) => /^https?:\/\//i.test(v) || v.startsWith('/uploads/'));
  return [...new Set(cleaned)];
}

function canonicalFeatureCategory(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'property descriptives') return 'property descriptive';
  if (normalized === 'lifestyle tags') return 'lifestyle';
  return normalized;
}

function parseSubFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      // Fall back to splitting below.
    }
    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

async function fileToBase64(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

type ListingQueryFilters = {
  propertyType: string;
  minPrice: string;
  maxPrice: string;
  minBedrooms: string;
  minBathrooms: string;
  petFriendly: boolean;
  pool: boolean;
  garden: boolean;
  flatlet: boolean;
  retirement: boolean;
  onShow: boolean;
  auction: boolean;
  securityEstate: boolean;
  repossessed: boolean;
};

async function fetchListings(page: number, search: string, status: string, saleOrRent: string, filters: ListingQueryFilters): Promise<ListingsResponse> {
  const offset = (page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (saleOrRent) params.set('saleOrRent', saleOrRent);
  if (filters.propertyType) params.set('propertyType', filters.propertyType);
  if (filters.minPrice) params.set('minPrice', filters.minPrice);
  if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
  if (filters.minBedrooms) params.set('minBedrooms', filters.minBedrooms);
  if (filters.minBathrooms) params.set('minBathrooms', filters.minBathrooms);
  if (filters.petFriendly) params.set('petFriendly', 'true');
  if (filters.pool) params.set('pool', 'true');
  if (filters.garden) params.set('garden', 'true');
  if (filters.flatlet) params.set('flatlet', 'true');
  if (filters.retirement) params.set('retirement', 'true');
  if (filters.onShow) params.set('onShow', 'true');
  if (filters.auction) params.set('auction', 'true');
  if (filters.securityEstate) params.set('securityEstate', 'true');
  if (filters.repossessed) params.set('repossessed', 'true');
  const res = await fetch(`/api/listings?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch listings');
  return res.json() as Promise<ListingsResponse>;
}

const emptyForm: ListingFormState = {
  source_listing_id: '', source_market_center_id: '', listing_number: '',
  status_name: 'Active', listing_status_tag: 'For Sale', ownership_type: 'Full Title',
  sale_or_rent: 'For Sale', is_draft: true, is_published: false,
  expiry_date: '', price: '', agent_property_valuation: '', reduced_date: '',
  no_transfer_duty: false, property_auction: false, poa: false,
  property_title: '', short_title: '', property_description: '', short_description: '',
  property_type: 'Residential', property_sub_type: 'House', descriptive_feature: '', retirement_living: false,
  address_line: '', suburb: '', city: '', province: '', country: 'South Africa',
  erf_number: '', unit_number: '', door_number: '', estate_name: '',
  street_number: '', street_name: '', postal_code: '', longitude: '', latitude: '',
  override_display_location: false, override_display_longitude: '', override_display_latitude: '',
  loom_validation_status: '', loom_property_id: '', loom_address: '',
  display_address_on_website: true, viewing_instructions: '', viewing_directions: '',
  feed_to_private_property: false, private_property_ref1: '', private_property_ref2: '', private_property_sync_status: '',
  feed_to_kww: false, kww_property_reference: '', kww_ref1: '', kww_ref2: '', kww_sync_status: '',
  feed_to_entegral: false, entegral_sync_status: '',
  feed_to_property24: false, property24_ref1: '', property24_ref2: '', property24_sync_status: '',
  signed_date: '', on_market_since_date: '', rates_and_taxes: '', monthly_levy: '',
  occupation_date: '', mandate_type: 'Sole Mandate',
  erf_size: '', floor_area: '', construction_date: '', height_restriction: '', out_building_size: '', zoning_type: '',
  is_furnished: false, pet_friendly: false, has_standalone_building: false, has_flatlet: false,
  has_backup_water: false, wheelchair_accessible: false, has_generator: false,
  has_borehole: false, has_gas_geyser: false, has_solar_panels: false, has_backup_battery_or_inverter: false,
  has_solar_geyser: false, has_water_tank: false,
  adsl: false, fibre: false, isdn: false, dialup: false, fixed_wimax: false, satellite: false,
  nearby_bus_service: false, nearby_minibus_taxi_service: false, nearby_train_service: false,
  commercial_building_name: '', commercial_gross_lettable_area_sqm: '', commercial_green_building: false,
  commercial_building_grade: '', commercial_multi_tenanted: false, commercial_lease_type: '',
  commercial_gross_price: '', commercial_net_price: '', commercial_availability_date: '',
  commercial_height_of_roof: '', commercial_height_of_eaves: '', commercial_height_for_racking: '',
  commercial_truck_access: '', commercial_dock_levellers: '', commercial_height_of_dock_levellers: '',
  commercial_roller_shutter_doors: '', commercial_height_of_roller_shutter_doors: '',
  commercial_yard_space_sqm: '', commercial_warehouse_space_sqm: '', commercial_office_to_warehouse_ratio: '',
  commercial_has_natural_light: false, commercial_power_availability: '', commercial_power_details_description: '',
  commercial_boardrooms_count: '', commercial_boardrooms_description: '',
  commercial_boardrooms_furniture_included: false, commercial_boardrooms_internet_port: false,
  commercial_boardrooms_tv_port: false, commercial_boardrooms_wifi: false,
  agents: [], contacts: [], show_times: [], open_house: [], marketing_urls: [],
  features: [], property_areas: [], mandate_documents: [], normalized_images: [], image_urls: [],
};

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function Listings() {
  const [view, setView] = useState<ViewMode>('card');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [saleOrRentFilter, setSaleOrRentFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [minPriceFilter, setMinPriceFilter] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [minBedroomsFilter, setMinBedroomsFilter] = useState('');
  const [minBathroomsFilter, setMinBathroomsFilter] = useState('');
  const [petFriendlyFilter, setPetFriendlyFilter] = useState(false);
  const [poolFilter, setPoolFilter] = useState(false);
  const [gardenFilter, setGardenFilter] = useState(false);
  const [flatletFilter, setFlatletFilter] = useState(false);
  const [retirementFilter, setRetirementFilter] = useState(false);
  const [onShowFilter, setOnShowFilter] = useState(false);
  const [auctionFilter, setAuctionFilter] = useState(false);
  const [securityEstateFilter, setSecurityEstateFilter] = useState(false);
  const [repossessedFilter, setRepossessedFilter] = useState(false);
  const [showOptionalFilters, setShowOptionalFilters] = useState(false);
  const [previewItem, setPreviewItem] = useState<ListingRow | null>(null);
  const [previewDetail, setPreviewDetail] = useState<Record<string, unknown> | null>(null);
  const [previewImageIdx, setPreviewImageIdx] = useState(0);
  const [previewExpandedDescription, setPreviewExpandedDescription] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ListingSection>('info');
  const [form, setForm] = useState<ListingFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [isGeneratingNumber, setIsGeneratingNumber] = useState(false);
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  const queryFilters: ListingQueryFilters = {
    propertyType: propertyTypeFilter,
    minPrice: minPriceFilter,
    maxPrice: maxPriceFilter,
    minBedrooms: minBedroomsFilter,
    minBathrooms: minBathroomsFilter,
    petFriendly: petFriendlyFilter,
    pool: poolFilter,
    garden: gardenFilter,
    flatlet: flatletFilter,
    retirement: retirementFilter,
    onShow: onShowFilter,
    auction: auctionFilter,
    securityEstate: securityEstateFilter,
    repossessed: repossessedFilter,
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['listings', page, search, statusFilter, saleOrRentFilter, queryFilters],
    queryFn: () => fetchListings(page, search, statusFilter, saleOrRentFilter, queryFilters),
  });

  const { data: options } = useQuery<OptionsResponse>({
    queryKey: ['listing-options'],
    queryFn: async () => {
      const res = await fetch('/api/listings/options');
      return res.json() as Promise<OptionsResponse>;
    },
    staleTime: Infinity,
  });

  const { data: activeAgentsData } = useQuery({
    queryKey: ['active-agents-for-listings'],
    queryFn: async () => {
      const res = await fetch('/api/agents?limit=500&offset=0&status=Active');
      if (!res.ok) return { items: [] as ActiveAgentRow[] };
      const body = (await res.json()) as { items?: ActiveAgentRow[] };
      return body;
    },
    staleTime: 60000,
  });

  const activeAgents = activeAgentsData?.items ?? [];

  const visibleItems = useMemo(() => data?.items ?? [], [data]);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const propertyTypeOptions = useMemo(() => {
    if (!options) return [];
    const set = new Set<string>();
    for (const type of options.property_types ?? []) set.add(type);
    for (const list of Object.values(options.property_sub_types ?? {})) {
      for (const sub of list) set.add(sub);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [options]);
  const priceOptions = ['250000', '500000', '750000', '1000000', '1500000', '2000000', '3000000', '5000000', '7500000', '10000000', '15000000', '20000000'];
  const bedroomCountOptions = ['', '1', '2', '3', '4', '5'];
  const bathroomCountOptions = ['', '1', '2', '3', '4', '5'];

  const openPreview = (item: ListingRow): void => {
    setPreviewItem(item);
    setPreviewDetail(null);
    setPreviewImageIdx(0);
    setPreviewExpandedDescription(false);

    void fetch(`/api/listings/${item.id}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as Record<string, unknown>;
      })
      .then((details) => {
        if (details) setPreviewDetail(details);
      })
      .catch(() => {
        // Preview should still open even if detail enrichment fails.
      });
  };

  const closePreview = (): void => {
    setPreviewItem(null);
    setPreviewDetail(null);
    setPreviewImageIdx(0);
    setPreviewExpandedDescription(false);
  };

  // Sub-type options based on selected property type
  const subTypeOptions = useMemo(() => {
    if (!options || !form.property_type) return [];
    return options.property_sub_types[form.property_type] ?? [];
  }, [options, form.property_type]);

  // Available agents filtered by same market center as the first selected agent (if any)
  const agentMarketCenterId = form.agents[0]?.market_center_id ?? '';
  const filteredAgents = useMemo(() => {
    if (!agentMarketCenterId) return activeAgents;
    return activeAgents.filter((a) => a.market_center_id === agentMarketCenterId || !a.market_center_id);
  }, [activeAgents, agentMarketCenterId]);

  const filteredCities = useMemo(() => {
    if (!options) return [];
    if (!form.province) return options.cities ?? [];
    return options.city_by_province?.[form.province] ?? [];
  }, [options, form.province]);

  const filteredSuburbs = useMemo(() => {
    if (!options) return [];
    if (form.city) return options.suburb_by_city?.[form.city] ?? [];
    if (form.province) return options.suburb_by_province?.[form.province] ?? [];
    return options.suburbs ?? [];
  }, [options, form.city, form.province]);

  const isCommercialOrIndustrial = form.property_type === 'Commercial' || form.property_type === 'Industrial';

  const preloadImage = (url: string): void => {
    if (!url || preloadedImagesRef.current.has(url)) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    preloadedImagesRef.current.add(url);
  };

  useEffect(() => {
    for (const item of visibleItems) {
      const images = item.image_urls ?? [];
      for (const url of images.slice(0, 5)) preloadImage(url);
    }
  }, [visibleItems]);

  useEffect(() => {
    if (!form.province || !options) return;
    if (form.city && !(options.city_by_province?.[form.province] ?? []).includes(form.city)) {
      setForm((p) => ({ ...p, city: '', suburb: '' }));
    }
  }, [form.province, form.city, options]);

  useEffect(() => {
    if (!form.city || !options) return;
    if (form.suburb && !(options.suburb_by_city?.[form.city] ?? []).includes(form.suburb)) {
      setForm((p) => ({ ...p, suburb: '' }));
    }
  }, [form.city, form.suburb, options]);

  async function generateListingNumber(): Promise<void> {
    if (form.listing_number) return; // already has one
    setIsGeneratingNumber(true);
    try {
      const res = await fetch('/api/listings/next-number');
      if (res.ok) {
        const body = (await res.json()) as { listing_number: string };
        setForm((p) => ({ ...p, listing_number: body.listing_number }));
      }
    } finally {
      setIsGeneratingNumber(false);
    }
  }

  function openCreateForm(): void {
    setForm(emptyForm);
    setEditingId(null);
    setActiveSection('info');
    setFormError(null);
    setIsFormOpen(true);
  }

  async function openEditForm(item: ListingRow): Promise<void> {
    setIsLoadingDetails(true);
    setEditingId(item.id);
    setActiveSection('info');
    setFormError(null);
    setIsFormOpen(true);

    try {
      const detailsRes = await fetch(`/api/listings/${item.id}`);
      const listing = detailsRes.ok ? ((await detailsRes.json()) as Record<string, unknown>) : (item as unknown as Record<string, unknown>);

      const s = (key: string) => String(listing[key] ?? '');
      const b = (key: string) => parseBooleanLike(listing[key]);
      const payload = typeof listing.listing_payload === 'object' && listing.listing_payload !== null
        ? (listing.listing_payload as Record<string, unknown>)
        : {};
      const payloadBool = (...keys: string[]): boolean => keys.some((key) => parseBooleanLike(payload[key]));
      const ci = typeof payload.commercial_industrial === 'object' && payload.commercial_industrial !== null
        ? (payload.commercial_industrial as Record<string, unknown>)
        : {};

      const firstNonEmpty = (...values: unknown[]): string => {
        for (const value of values) {
          if (value === null || value === undefined) continue;
          const text = String(value).trim();
          if (text) return text;
        }
        return '';
      };

      const privatePropertyRef = firstNonEmpty(
        listing.private_property_ref1,
        listing.private_property_ref2,
        listing.private_property_reference_id,
        payload.PrivatePropertyReference,
        payload.PrivatePropertyId,
        payload.private_property_reference,
        payload.privatePropertyReference,
        payload.private_property_ref1,
        payload.private_property_ref2
      );
      const property24Ref = firstNonEmpty(
        listing.property24_ref1,
        listing.property24_ref2,
        listing.property24_reference_id,
        payload.Property24Reference,
        payload.Property24Id,
        payload.property24_reference,
        payload.property24_id,
        payload.property24_ref1,
        payload.property24_ref2
      );
      const kwwRef = firstNonEmpty(
        listing.kww_property_reference,
        listing.kww_ref1,
        listing.kww_ref2,
        listing.kww_reference_id,
        payload.KWWReference,
        payload.KWWId,
        payload.kww_reference,
        payload.kww_id,
        payload.kww_ref1,
        payload.kww_ref2
      );
      const entegralRef = firstNonEmpty(
        listing.entegral_reference_id,
        payload.EntegralReference,
        payload.EntegralId,
        payload.entegral_reference,
        payload.entegral_id,
        payload.entegral_ref,
        payload.entegral_reference_id
      );

      const resolvedSaleOrRent = firstNonEmpty(
        listing.sale_or_rent,
        payload.sale_or_rent,
        payload.SaleOrRent
      );
      const resolvedListingStatusTag = firstNonEmpty(
        listing.listing_status_tag,
        payload.listing_status_tag,
        payload.ListingStatusTag,
        payload.status_tag,
        payload.StatusTag
      );

      const privatePropertySyncStatus = firstNonEmpty(
        listing.private_property_sync_status,
        listing.private_property_status,
        payload.PrivatePropertySyncStatus,
        payload.PrivatePropertySyncMessage,
        payload.PrivatePropertyStatus,
        payload.private_property_sync_status,
        payload.private_property_sync_message,
        payload.private_property_status
      );
      const kwwSyncStatus = firstNonEmpty(
        listing.kww_sync_status,
        listing.kww_status,
        payload.KwwSyncMessage,
        payload.KWWSyncMessage,
        payload.KWWStatus,
        payload.kww_sync_status,
        payload.kww_sync_message,
        payload.kww_status
      );
      const entegralSyncStatus = firstNonEmpty(
        listing.entegral_sync_status,
        listing.entegral_status,
        payload.EntegralSyncMessage,
        payload.EntegralStatus,
        payload.entegral_sync_status,
        payload.entegral_sync_message,
        payload.entegral_status
      );
      const property24SyncStatus = firstNonEmpty(
        listing.property24_sync_status,
        listing.property24_status,
        payload.P24SyncMessage,
        payload.Property24SyncMessage,
        payload.Property24Status,
        payload.property24_sync_status,
        payload.property24_sync_message,
        payload.property24_status
      );

      const feedToPrivateProperty = b('feed_to_private_property')
        || payloadBool('feed_to_private_property', 'FeedToPrivateProperty', 'private_property_opt_in', 'PrivatePropertyOptIn')
        || Boolean(privatePropertyRef);
      const feedToKww = b('feed_to_kww')
        || payloadBool('feed_to_kww', 'FeedToKWW', 'kww_opt_in', 'KWWOptIn')
        || Boolean(kwwRef);
      const feedToEntegral = b('feed_to_entegral')
        || payloadBool('feed_to_entegral', 'FeedToEntegral', 'entegral_opt_in', 'EntegralOptIn')
        || Boolean(entegralRef);
      const feedToProperty24 = b('feed_to_property24')
        || payloadBool('feed_to_property24', 'FeedToProperty24', 'property24_opt_in', 'Property24OptIn')
        || Boolean(property24Ref);

      const imageUrls = Array.isArray(listing.image_urls) ? (listing.image_urls as string[]) : [];
      const normalizedImages = Array.isArray(listing.normalized_images) ? (listing.normalized_images as NormalizedImageEntry[]) : [];
      const normalizedImagesWithFallback = normalizedImages.length > 0
        ? normalizedImages
        : imageUrls.map((url, index) => ({
            file_url: url,
            file_name: url.split('/').pop() ?? `image-${index + 1}`,
            media_type: 'image',
            uploaded_by: '',
            sort_order: index,
          }));

      setForm({
        source_listing_id: s('source_listing_id'),
        source_market_center_id: s('source_market_center_id'),
        listing_number: s('listing_number'),
        status_name: s('status_name') || 'Active',
        listing_status_tag: deriveListingStatusTag(resolvedListingStatusTag, resolvedSaleOrRent),
        ownership_type: s('ownership_type') || 'Full Title',
        sale_or_rent: resolvedSaleOrRent || 'For Sale',
        is_draft: Boolean(listing.is_draft ?? true),
        is_published: b('is_published'),
        expiry_date: toInputDate(s('expiry_date')),
        price: s('price'),
        agent_property_valuation: s('agent_property_valuation'),
        reduced_date: toInputDate(s('reduced_date')),
        no_transfer_duty: b('no_transfer_duty'),
        property_auction: b('property_auction'),
        poa: b('poa'),
        property_title: s('property_title'),
        short_title: s('short_title'),
        property_description: s('property_description'),
        short_description: s('short_description'),
        property_type: s('property_type') || 'Residential',
        property_sub_type: s('property_sub_type') || 'House',
        descriptive_feature: s('descriptive_feature'),
        retirement_living: b('retirement_living'),
        address_line: s('address_line'),
        suburb: s('suburb'),
        city: s('city'),
        province: s('province'),
        country: s('country') || 'South Africa',
        erf_number: s('erf_number'),
        unit_number: s('unit_number'),
        door_number: s('door_number'),
        estate_name: s('estate_name'),
        street_number: s('street_number'),
        street_name: s('street_name'),
        postal_code: s('postal_code'),
        longitude: s('longitude'),
        latitude: s('latitude'),
        override_display_location: b('override_display_location'),
        override_display_longitude: s('override_display_longitude'),
        override_display_latitude: s('override_display_latitude'),
        loom_validation_status: s('loom_validation_status'),
        loom_property_id: s('loom_property_id'),
        loom_address: s('loom_address'),
        display_address_on_website: Boolean(listing.display_address_on_website ?? true),
        viewing_instructions: s('viewing_instructions'),
        viewing_directions: s('viewing_directions'),
        feed_to_private_property: feedToPrivateProperty,
        private_property_ref1: privatePropertyRef,
        private_property_ref2: s('private_property_ref2'),
        private_property_sync_status: privatePropertySyncStatus,
        feed_to_kww: feedToKww,
        kww_property_reference: kwwRef,
        kww_ref1: s('kww_ref1'),
        kww_ref2: s('kww_ref2'),
        kww_sync_status: kwwSyncStatus,
        feed_to_entegral: feedToEntegral,
        entegral_sync_status: entegralSyncStatus,
        feed_to_property24: feedToProperty24,
        property24_ref1: property24Ref,
        property24_ref2: s('property24_ref2'),
        property24_sync_status: property24SyncStatus,
        signed_date: toInputDate(s('signed_date')),
        on_market_since_date: toInputDate(s('on_market_since_date')),
        rates_and_taxes: s('rates_and_taxes'),
        monthly_levy: s('monthly_levy'),
        occupation_date: toInputDate(s('occupation_date')),
        mandate_type: s('mandate_type') || 'Sole Mandate',
        erf_size: s('erf_size'),
        floor_area: s('floor_area'),
        construction_date: toInputDate(s('construction_date')),
        height_restriction: s('height_restriction'),
        out_building_size: s('out_building_size'),
        zoning_type: s('zoning_type'),
        is_furnished: b('is_furnished') || payloadBool('is_furnished', 'IsFurnished'),
        pet_friendly: b('pet_friendly') || payloadBool('pet_friendly', 'PetFriendly'),
        has_standalone_building: b('has_standalone_building') || payloadBool('has_standalone_building', 'HasStandaloneBuilding'),
        has_flatlet: b('has_flatlet') || payloadBool('has_flatlet', 'HasFlatlet'),
        has_backup_water: b('has_backup_water') || payloadBool('has_backup_water', 'HasBackupWater'),
        wheelchair_accessible: b('wheelchair_accessible') || payloadBool('wheelchair_accessible', 'WheelchairAccessible'),
        has_generator: b('has_generator') || payloadBool('has_generator', 'HasGenerator'),
        has_borehole: b('has_borehole') || payloadBool('has_borehole', 'HasBorehole'),
        has_gas_geyser: b('has_gas_geyser') || payloadBool('has_gas_geyser', 'HasGasGeyser'),
        has_solar_panels: b('has_solar_panels') || payloadBool('has_solar_panels', 'HasSolarPanels'),
        has_backup_battery_or_inverter: b('has_backup_battery_or_inverter') || payloadBool('has_backup_battery_or_inverter', 'HasBackupBatteryOrInverter'),
        has_solar_geyser: b('has_solar_geyser') || payloadBool('has_solar_geyser', 'HasSolarGeyser'),
        has_water_tank: b('has_water_tank') || payloadBool('has_water_tank', 'HasWaterTank'),
        adsl: b('adsl') || payloadBool('adsl', 'ADSL'),
        fibre: b('fibre') || payloadBool('fibre', 'Fibre'),
        isdn: b('isdn') || payloadBool('isdn', 'ISDN'),
        dialup: b('dialup') || payloadBool('dialup', 'Dialup'),
        fixed_wimax: b('fixed_wimax') || payloadBool('fixed_wimax', 'FixedWiMax', 'fixed_wimax'),
        satellite: b('satellite') || payloadBool('satellite', 'Satellite'),
        nearby_bus_service: b('nearby_bus_service') || payloadBool('nearby_bus_service', 'NearbyBusService'),
        nearby_minibus_taxi_service: b('nearby_minibus_taxi_service') || payloadBool('nearby_minibus_taxi_service', 'NearbyMinibusTaxiService'),
        nearby_train_service: b('nearby_train_service') || payloadBool('nearby_train_service', 'NearbyTrainService'),
        commercial_building_name: String(ci.building_name ?? ''),
        commercial_gross_lettable_area_sqm: String(ci.gross_lettable_area_sqm ?? ''),
        commercial_green_building: Boolean(ci.green_building),
        commercial_building_grade: String(ci.building_grade ?? ''),
        commercial_multi_tenanted: Boolean(ci.multi_tenanted),
        commercial_lease_type: String(ci.lease_type ?? ''),
        commercial_gross_price: String(ci.gross_price ?? ''),
        commercial_net_price: String(ci.net_price ?? ''),
        commercial_availability_date: String(ci.availability_date ?? ''),
        commercial_height_of_roof: String(ci.height_of_roof ?? ''),
        commercial_height_of_eaves: String(ci.height_of_eaves ?? ''),
        commercial_height_for_racking: String(ci.height_for_racking ?? ''),
        commercial_truck_access: String(ci.truck_access ?? ''),
        commercial_dock_levellers: String(ci.dock_levellers ?? ''),
        commercial_height_of_dock_levellers: String(ci.height_of_dock_levellers ?? ''),
        commercial_roller_shutter_doors: String(ci.roller_shutter_doors ?? ''),
        commercial_height_of_roller_shutter_doors: String(ci.height_of_roller_shutter_doors ?? ''),
        commercial_yard_space_sqm: String(ci.yard_space_sqm ?? ''),
        commercial_warehouse_space_sqm: String(ci.warehouse_space_sqm ?? ''),
        commercial_office_to_warehouse_ratio: String(ci.office_to_warehouse_ratio ?? ''),
        commercial_has_natural_light: Boolean(ci.has_natural_light),
        commercial_power_availability: String(ci.power_availability ?? ''),
        commercial_power_details_description: String(ci.power_details_description ?? ''),
        commercial_boardrooms_count: String(ci.boardrooms_count ?? ''),
        commercial_boardrooms_description: String(ci.boardrooms_description ?? ''),
        commercial_boardrooms_furniture_included: Boolean(ci.boardrooms_furniture_included),
        commercial_boardrooms_internet_port: Boolean(ci.boardrooms_internet_port),
        commercial_boardrooms_tv_port: Boolean(ci.boardrooms_tv_port),
        commercial_boardrooms_wifi: Boolean(ci.boardrooms_wifi),
        agents: Array.isArray(listing.agents) ? (listing.agents as AgentEntry[]) : [],
        contacts: Array.isArray(listing.contacts) ? (listing.contacts as ContactEntry[]) : [],
        show_times: Array.isArray(listing.show_times) ? (listing.show_times as ShowTimeEntry[]) : [],
        open_house: Array.isArray(listing.open_house) ? (listing.open_house as OpenHouseEntry[]) : [],
        marketing_urls: Array.isArray(listing.marketing_urls) ? (listing.marketing_urls as MarketingUrlEntry[]) : [],
        features: Array.isArray(listing.features) ? (listing.features as FeatureEntry[]) : [],
        property_areas: Array.isArray(listing.property_areas)
          ? (listing.property_areas as Array<PropertyAreaEntry & { sub_features?: unknown }>).map((pa) => ({
              ...pa,
              sub_features: parseSubFeatures(pa.sub_features),
            }))
          : [],
        mandate_documents: Array.isArray(listing.mandate_documents) ? (listing.mandate_documents as MandateDocumentEntry[]) : [],
        normalized_images: normalizedImagesWithFallback,
        image_urls: imageUrls,
      });
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function saveListing(publish: boolean): Promise<void> {
    setIsSaving(true);
    setFormError(null);

    try {
      // Auto-generate listing number on first save if not already set
      let listingNumber = form.listing_number;
      if (!listingNumber) {
        const numRes = await fetch('/api/listings/next-number');
        if (numRes.ok) {
          const numBody = (await numRes.json()) as { listing_number: string };
          listingNumber = numBody.listing_number;
          setForm((p) => ({ ...p, listing_number: listingNumber }));
        }
      }

      const payload = {
        ...form,
        listing_number: listingNumber,
        is_draft: !publish,
        is_published: publish,
        image_urls: normalizeImageUrls(form.image_urls),
        listing_payload: {
          commercial_industrial: {
            building_name: form.commercial_building_name,
            gross_lettable_area_sqm: form.commercial_gross_lettable_area_sqm,
            green_building: form.commercial_green_building,
            building_grade: form.commercial_building_grade,
            multi_tenanted: form.commercial_multi_tenanted,
            lease_type: form.commercial_lease_type,
            gross_price: form.commercial_gross_price,
            net_price: form.commercial_net_price,
            availability_date: form.commercial_availability_date,
            height_of_roof: form.commercial_height_of_roof,
            height_of_eaves: form.commercial_height_of_eaves,
            height_for_racking: form.commercial_height_for_racking,
            truck_access: form.commercial_truck_access,
            dock_levellers: form.commercial_dock_levellers,
            height_of_dock_levellers: form.commercial_height_of_dock_levellers,
            roller_shutter_doors: form.commercial_roller_shutter_doors,
            height_of_roller_shutter_doors: form.commercial_height_of_roller_shutter_doors,
            yard_space_sqm: form.commercial_yard_space_sqm,
            warehouse_space_sqm: form.commercial_warehouse_space_sqm,
            office_to_warehouse_ratio: form.commercial_office_to_warehouse_ratio,
            has_natural_light: form.commercial_has_natural_light,
            power_availability: form.commercial_power_availability,
            power_details_description: form.commercial_power_details_description,
            boardrooms_count: form.commercial_boardrooms_count,
            boardrooms_description: form.commercial_boardrooms_description,
            boardrooms_furniture_included: form.commercial_boardrooms_furniture_included,
            boardrooms_internet_port: form.commercial_boardrooms_internet_port,
            boardrooms_tv_port: form.commercial_boardrooms_tv_port,
            boardrooms_wifi: form.commercial_boardrooms_wifi,
          },
        },
      };

      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/listings/${editingId}` : '/api/listings';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to save listing');
      }

      if (!editingId) {
        const body = (await res.json()) as { id: string };
        setEditingId(body.id);
      }

      setIsFormOpen(false);
      await refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save listing');
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadListingImages(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setIsUploadingImages(true);
    setFormError(null);
    try {
      const payloadFiles = await Promise.all(
        Array.from(files).map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          contentBase64: await fileToBase64(f),
        }))
      );
      const res = await fetch('/api/listings/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payloadFiles }),
      });
      if (!res.ok) throw new Error('Image upload failed');
      const body = (await res.json()) as { image_urls?: string[] };
      const newUrls = normalizeImageUrls(body.image_urls ?? []);
      const newNormalized: NormalizedImageEntry[] = newUrls.map((url, i) => ({
        file_url: url,
        file_name: url.split('/').pop() ?? '',
        media_type: 'image',
        uploaded_by: '',
        sort_order: form.normalized_images.length + i,
      }));
      setForm((p) => ({
        ...p,
        normalized_images: [...p.normalized_images, ...newNormalized],
        image_urls: normalizeImageUrls([...p.image_urls, ...newUrls]),
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Image upload failed');
    } finally {
      setIsUploadingImages(false);
    }
  }

  async function uploadMandateDocuments(files: FileList | null): Promise<void> {
    if (!files || files.length === 0 || !editingId) return;
    setIsUploadingDocs(true);
    setFormError(null);
    try {
      const payloadFiles = await Promise.all(
        Array.from(files).map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          contentBase64: await fileToBase64(f),
        }))
      );
      const res = await fetch(`/api/listings/${editingId}/mandate-documents/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payloadFiles }),
      });
      if (!res.ok) throw new Error('Document upload failed');
      // Reload listing to get updated mandate docs
      await openEditForm({ id: editingId } as ListingRow);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Document upload failed');
    } finally {
      setIsUploadingDocs(false);
    }
  }

  function moveImage(index: number, direction: -1 | 1): void {
    setForm((prev) => {
      const next = index + direction;
      if (next < 0 || next >= prev.normalized_images.length) return prev;
      const updated = [...prev.normalized_images];
      const [item] = updated.splice(index, 1);
      updated.splice(next, 0, item);
      const reindexed = updated.map((img, i) => ({ ...img, sort_order: i }));
      return {
        ...prev,
        normalized_images: reindexed,
        image_urls: normalizeImageUrls(reindexed.map((img) => img.file_url)),
      };
    });
  }

  function removeImage(index: number): void {
    setForm((prev) => {
      const updated = prev.normalized_images.filter((_, i) => i !== index);
      return {
        ...prev,
        normalized_images: updated,
        image_urls: normalizeImageUrls(updated.map((img) => img.file_url)),
      };
    });
  }

  // Feature helpers
  function addFeature(category: string, value: string): void {
    const targetCategory = canonicalFeatureCategory(category);
    if (!value || form.features.some((f) => canonicalFeatureCategory(f.feature_category) === targetCategory && f.feature_value === value)) return;
    setForm((p) => ({ ...p, features: [...p.features, { feature_category: category, feature_value: value }] }));
  }

  function removeFeature(category: string, value: string): void {
    const targetCategory = canonicalFeatureCategory(category);
    setForm((p) => ({ ...p, features: p.features.filter((f) => !(canonicalFeatureCategory(f.feature_category) === targetCategory && f.feature_value === value)) }));
  }

  function featuresFor(category: string): string[] {
    const targetCategory = canonicalFeatureCategory(category);
    return form.features.filter((f) => canonicalFeatureCategory(f.feature_category) === targetCategory).map((f) => f.feature_value);
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function inp(label: string, key: keyof ListingFormState, opts?: { type?: string; placeholder?: string; readOnly?: boolean; span?: number }) {
    const val = form[key];
    const strVal = typeof val === 'string' ? val : String(val ?? '');
    const colSpan = opts?.span ? `md:col-span-${opts.span}` : '';
    return (
      <label key={key} className={`flex flex-col gap-1 ${colSpan}`}>
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <input
          type={opts?.type ?? 'text'}
          className={`rounded-lg border border-slate-300 px-3 py-2 text-sm ${opts?.readOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
          placeholder={opts?.placeholder}
          value={strVal}
          readOnly={opts?.readOnly}
          onChange={(e) => !opts?.readOnly && setForm((p) => ({ ...p, [key]: e.target.value }))}
        />
      </label>
    );
  }

  function chk(label: string, key: keyof ListingFormState) {
    const val = Boolean(form[key]);
    return (
      <label key={key} className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-red-600"
          checked={val}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.checked }))}
        />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
    );
  }

  function sel(label: string, key: keyof ListingFormState, choices: string[], opts?: { span?: number }) {
    const val = String(form[key] ?? '');
    const colSpan = opts?.span ? `md:col-span-${opts.span}` : '';
    return (
      <label key={key} className={`flex flex-col gap-1 ${colSpan}`}>
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          value={val}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        >
          <option value="">-- Select --</option>
          {choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    );
  }

  function searchableAddressField(label: string, key: 'province' | 'city' | 'suburb', choices: string[]) {
    const listId = `listing-${key}-options`;
    return (
      <label key={key} className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <input
          list={listId}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={form[key]}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={`Search ${label.toLowerCase()}`}
        />
        <datalist id={listId}>
          {choices.map((choice) => (
            <option key={choice} value={choice} />
          ))}
        </datalist>
      </label>
    );
  }

  function roomSubFeatureChoices(areaType: string): string[] {
    if (!options) return [];
    return options.property_area_sub_features?.[areaType]
      ?? options.property_area_sub_features?.['*']
      ?? [];
  }

  const FeatureMultiSelect = ({ category, options: opts }: { category: string; options: string[] }) => {
    const selected = featuresFor(category);
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{category}</h4>
        <div className="flex flex-wrap gap-2">
          {opts.map((opt) => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => active ? removeFeature(category, opt) : addFeature(category, opt)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${active ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const AgentSelector = ({ roles }: { roles: string[] }) => {
    const [agentId, setAgentId] = useState('');
    const [agentRole, setAgentRole] = useState('Secondary');

    function addAgent() {
      const found = activeAgents.find((a) => a.id === agentId);
      if (!found) return;
      if (form.agents.some((a) => a.associate_id === agentId)) return;
      const isPrimary = form.agents.length === 0;
      setForm((p) => ({
        ...p,
        agents: [
          ...p.agents,
          {
            associate_id: found.id,
            agent_name: found.full_name ?? '',
            agent_role: isPrimary ? 'Primary' : agentRole,
            is_primary: isPrimary,
            market_center_id: found.market_center_id ?? '',
            source_market_center_id: found.source_market_center_id ?? '',
            sort_order: p.agents.length,
          },
        ],
      }));
      setAgentId('');
    }

    return (
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white flex-1 min-w-48" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">-- Select Agent --</option>
            {filteredAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.full_name ?? a.id} ({a.source_market_center_id ?? ''})</option>
            ))}
          </select>
          {form.agents.length > 0 && (
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={agentRole} onChange={(e) => setAgentRole(e.target.value)}>
              {roles.filter((r) => r !== 'Primary').map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white hover:bg-slate-50" onClick={addAgent}>
            Add Agent
          </button>
        </div>
        {form.agents.length > 0 && (
          <table className="min-w-full text-sm divide-y divide-slate-200 rounded-lg border border-slate-200">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {form.agents.map((agent, i) => (
                <tr key={agent.associate_id}>
                  <td className="px-3 py-2">
                    {agent.agent_name}
                    {agent.is_primary && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Primary</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-xs bg-white"
                      value={agent.agent_role}
                      onChange={(e) => setForm((p) => {
                        const updated = [...p.agents];
                        updated[i] = { ...updated[i], agent_role: e.target.value, is_primary: e.target.value === 'Primary' };
                        return { ...p, agents: updated };
                      })}
                    >
                      {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setForm((p) => ({ ...p, agents: p.agents.filter((_, idx) => idx !== i) }))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Listing Management</h1>
          <p className="mt-1 text-sm text-slate-500">Manage listings, images, mandate information and portal feeds.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button type="button" onClick={() => setView('card')} className={`px-3 py-1.5 ${view === 'card' ? 'bg-black text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Cards</button>
            <button type="button" onClick={() => setView('list')} className={`px-3 py-1.5 border-l border-slate-300 ${view === 'list' ? 'bg-black text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>List</button>
          </div>
          <span className="status-chip info">{data?.total ?? 0} total</span>
          <button className="primary-btn" type="button" onClick={() => void refetch()}>{isFetching ? 'Refreshing...' : 'Refresh'}</button>
          <button className="primary-btn" type="button" onClick={openCreateForm}>Add Listing</button>
        </div>
      </div>

      {/* Workspace Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Listing Workspace</p>
                <h2 className="text-2xl font-semibold text-slate-900 flex items-center gap-3">
                  {form.listing_number ? (
                    <span className="rounded-md bg-red-50 px-2 py-0.5 text-base font-bold text-red-700 border border-red-200">{form.listing_number}</span>
                  ) : (
                    <span className="text-slate-400 text-base">Number auto-generated on save</span>
                  )}
                  {form.property_title ? ` - ${form.property_title}` : editingId ? 'Edit Listing' : 'New Listing'}
                </h2>
                {form.is_draft && !form.is_published && (
                  <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Draft</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" type="button" onClick={() => setIsFormOpen(false)}>Cancel</button>
                <button
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void saveListing(false)}
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void saveListing(true)}
                >
                  {isSaving ? 'Saving...' : 'Save / Publish'}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Sidebar Navigation */}
              <aside className="w-56 border-r border-slate-200 bg-slate-50 p-3 space-y-1 shrink-0">
                {([
                  ['info', 'Listing Info'],
                  ['address', 'Address & Validation'],
                  ['marketing', 'Marketing'],
                  ['images', 'Images'],
                  ['mandate', 'Mandate'],
                  ['property', 'Property Details'],
                ] as [ListingSection, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveSection(key)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeSection === key ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </aside>

              {/* Content Panel */}
              <div className="flex-1 overflow-auto p-6 space-y-6">
                {isLoadingDetails && <p className="text-sm text-slate-500">Loading listing details...</p>}
                {formError && <p className="text-sm text-amber-700 rounded-lg bg-amber-50 p-3 border border-amber-200">{formError}</p>}

                {/* ------------------ LISTING INFO ------------------ */}
                {activeSection === 'info' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Listing Info</h3>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Listing Number</span>
                        <div className="flex gap-2 items-center">
                          <input
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-slate-100 text-slate-500 cursor-not-allowed"
                            value={form.listing_number || 'Auto-generated on first save'}
                            readOnly
                          />
                          {!form.listing_number && (
                            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-50" onClick={() => void generateListingNumber()} disabled={isGeneratingNumber}>
                              {isGeneratingNumber ? '...' : 'Preview'}
                            </button>
                          )}
                        </div>
                      </label>
                      {inp('Source Listing ID', 'source_listing_id')}
                      {inp('Expiry Date', 'expiry_date', { type: 'date' })}
                      {sel('Listing Status', 'status_name', options?.listing_statuses ?? ['Active', 'Inactive', 'Draft'])}
                      {sel('Listing Status Tag', 'listing_status_tag', options?.listing_status_tags ?? [])}
                      {sel('Ownership Type', 'ownership_type', options?.ownership_types ?? [])}
                      {sel('For Sale or Rent', 'sale_or_rent', options?.sale_or_rent_types ?? [])}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Listing Price</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Listing Price (ZAR)', 'price', { placeholder: 'e.g. 1500000' })}
                      {inp('Agent Property Valuation', 'agent_property_valuation')}
                      {inp('Reduced Date', 'reduced_date', { type: 'date' })}
                      <div className="flex flex-col gap-2 pt-2">
                        {chk('No Transfer Duty', 'no_transfer_duty')}
                        {chk('Property Auction', 'property_auction')}
                        {chk('POA (Price on Application)', 'poa')}
                      </div>
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Listing Description</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Property Title (P24 Header)', 'property_title', { span: 3 })}
                      {inp('Short Title', 'short_title')}
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Property Description</span>
                      <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={4} value={form.property_description} onChange={(e) => setForm((p) => ({ ...p, property_description: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Short Description</span>
                      <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={form.short_description} onChange={(e) => setForm((p) => ({ ...p, short_description: e.target.value }))} />
                    </label>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Property Type</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {sel('Property Type', 'property_type', options?.property_types ?? [])}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Property Sub Type</span>
                        <select
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                          value={form.property_sub_type}
                          onChange={(e) => setForm((p) => ({ ...p, property_sub_type: e.target.value }))}
                        >
                          <option value="">-- Select --</option>
                          {subTypeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                      {inp('Descriptive Feature', 'descriptive_feature')}
                      {chk('Retirement Living', 'retirement_living')}
                    </div>
                  </section>
                )}

                {/* ------------------ ADDRESS ------------------ */}
                {activeSection === 'address' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Address & Validation</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Country', 'country')}
                      {searchableAddressField('Province', 'province', options?.provinces ?? [])}
                      {inp('Erf Number', 'erf_number')}
                      {inp('Unit Number', 'unit_number')}
                      {inp('Door Number', 'door_number')}
                      {inp('Estate Name', 'estate_name')}
                      {inp('Street Number', 'street_number')}
                      {inp('Street Name', 'street_name')}
                      {searchableAddressField('Suburb', 'suburb', filteredSuburbs)}
                      {searchableAddressField('City', 'city', filteredCities)}
                      {inp('Postal Code', 'postal_code')}
                      {inp('Address Line (Full)', 'address_line', { span: 3 })}
                      {inp('Longitude', 'longitude')}
                      {inp('Latitude', 'latitude')}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Override Display Location</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="flex flex-col gap-2 pt-1">
                        {chk('Override Display Location', 'override_display_location')}
                      </div>
                      {form.override_display_location && (
                        <>
                          {inp('Override Display Longitude', 'override_display_longitude')}
                          {inp('Override Display Latitude', 'override_display_latitude')}
                        </>
                      )}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Loom Validation</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Loom Validation Status', 'loom_validation_status')}
                      {inp('Loom Property ID', 'loom_property_id')}
                      {inp('Loom Address', 'loom_address', { span: 2 })}
                    </div>
                  </section>
                )}

                {/* ------------------ MARKETING ------------------ */}
                {activeSection === 'marketing' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Marketing</h3>

                    <div className="space-y-2">
                      <h4 className="text-base font-semibold text-slate-800">General Settings</h4>
                      {chk('Display Address on Website', 'display_address_on_website')}
                    </div>

                    {/* Portal Integrations */}
                    <div className="space-y-4">
                      <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Third Party Integrations</h4>

                      {/* Private Property */}
                      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {chk('Feed to Private Property', 'feed_to_private_property')}
                        </div>
                        {(form.feed_to_private_property || Boolean(firstReference(form.private_property_ref1, form.private_property_ref2, form.private_property_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            {inp('Private Property Reference 1', 'private_property_ref1')}
                            {inp('Private Property Reference 2', 'private_property_ref2')}
                            {inp('Sync Status', 'private_property_sync_status')}
                          </div>
                        )}
                      </div>

                      {/* KWW */}
                      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {chk('Feed to KWW', 'feed_to_kww')}
                        </div>
                        {(form.feed_to_kww || Boolean(firstReference(form.kww_property_reference, form.kww_ref1, form.kww_ref2, form.kww_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            {inp('KWW Property Reference', 'kww_property_reference')}
                            {inp('KWW Reference 1', 'kww_ref1')}
                            {inp('KWW Reference 2', 'kww_ref2')}
                            {inp('Sync Status', 'kww_sync_status')}
                          </div>
                        )}
                      </div>

                      {/* Entegral */}
                      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {chk('Feed to Entegral', 'feed_to_entegral')}
                        </div>
                        {(form.feed_to_entegral || Boolean(firstReference(form.entegral_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {inp('Sync Status', 'entegral_sync_status')}
                          </div>
                        )}
                      </div>

                      {/* Property24 */}
                      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {chk('Feed to Property24', 'feed_to_property24')}
                        </div>
                        {(form.feed_to_property24 || Boolean(firstReference(form.property24_ref1, form.property24_ref2, form.property24_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            {inp('Property24 Reference 1', 'property24_ref1')}
                            {inp('Property24 Reference 2', 'property24_ref2')}
                            {inp('Sync Status', 'property24_sync_status')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Marketing URLs */}
                    <div className="space-y-3 border-t pt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-800">Marketing URLs</h4>
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                          onClick={() => setForm((p) => ({ ...p, marketing_urls: [...p.marketing_urls, { url: '', url_type: '', display_name: '' }] }))}>
                          Add URL
                        </button>
                      </div>
                      {form.marketing_urls.map((mu, i) => (
                        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-4 items-end rounded-lg border border-slate-200 p-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">URL</span>
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={mu.url} onChange={(e) => { const u = [...form.marketing_urls]; u[i] = { ...u[i], url: e.target.value }; setForm((p) => ({ ...p, marketing_urls: u })); }} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Type</span>
                            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" value={mu.url_type} onChange={(e) => { const u = [...form.marketing_urls]; u[i] = { ...u[i], url_type: e.target.value }; setForm((p) => ({ ...p, marketing_urls: u })); }}>
                              <option value="">-- Select --</option>
                              {(options?.marketing_url_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Display Name</span>
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={mu.display_name} onChange={(e) => { const u = [...form.marketing_urls]; u[i] = { ...u[i], display_name: e.target.value }; setForm((p) => ({ ...p, marketing_urls: u })); }} />
                          </label>
                          <button type="button" className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs text-red-700 hover:bg-red-100 self-end" onClick={() => setForm((p) => ({ ...p, marketing_urls: p.marketing_urls.filter((_, idx) => idx !== i) }))}>Remove</button>
                        </div>
                      ))}
                    </div>

                    {/* Viewing Details */}
                    <div className="space-y-3 border-t pt-4">
                      <h4 className="text-base font-semibold text-slate-800">Viewing Details</h4>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1 md:col-span-2">
                          <span className="text-xs font-medium text-slate-600">Viewing Instructions</span>
                          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={form.viewing_instructions} onChange={(e) => setForm((p) => ({ ...p, viewing_instructions: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1 md:col-span-2">
                          <span className="text-xs font-medium text-slate-600">Viewing Directions</span>
                          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={form.viewing_directions} onChange={(e) => setForm((p) => ({ ...p, viewing_directions: e.target.value }))} />
                        </label>
                      </div>
                    </div>

                    {/* Show Times */}
                    <div className="space-y-3 border-t pt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-800">Show Times</h4>
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                          onClick={() => setForm((p) => ({ ...p, show_times: [...p.show_times, { from_date: '', from_time: '', to_date: '', to_time: '', catch_phrase: '' }] }))}>
                          Add Show Time
                        </button>
                      </div>
                      {form.show_times.map((st, i) => (
                        <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-6 items-end rounded-lg border border-slate-200 p-3">
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">From Date</span><input type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={st.from_date} onChange={(e) => { const u = [...form.show_times]; u[i] = { ...u[i], from_date: e.target.value }; setForm((p) => ({ ...p, show_times: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">From Time</span><input type="time" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={st.from_time} onChange={(e) => { const u = [...form.show_times]; u[i] = { ...u[i], from_time: e.target.value }; setForm((p) => ({ ...p, show_times: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">To Date</span><input type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={st.to_date} onChange={(e) => { const u = [...form.show_times]; u[i] = { ...u[i], to_date: e.target.value }; setForm((p) => ({ ...p, show_times: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">To Time</span><input type="time" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={st.to_time} onChange={(e) => { const u = [...form.show_times]; u[i] = { ...u[i], to_time: e.target.value }; setForm((p) => ({ ...p, show_times: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Catch Phrase</span><input className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={st.catch_phrase} onChange={(e) => { const u = [...form.show_times]; u[i] = { ...u[i], catch_phrase: e.target.value }; setForm((p) => ({ ...p, show_times: u })); }} /></label>
                          <button type="button" className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 self-end" onClick={() => setForm((p) => ({ ...p, show_times: p.show_times.filter((_, idx) => idx !== i) }))}>Remove</button>
                        </div>
                      ))}
                    </div>

                    {/* Open House */}
                    <div className="space-y-3 border-t pt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-800">Open House</h4>
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                          onClick={() => setForm((p) => ({ ...p, open_house: [...p.open_house, { open_house_date: '', from_time: '', to_time: '', average_price: '', comments: '' }] }))}>
                          Add Open House
                        </button>
                      </div>
                      {form.open_house.map((oh, i) => (
                        <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-6 items-end rounded-lg border border-slate-200 p-3">
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Date</span><input type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={oh.open_house_date} onChange={(e) => { const u = [...form.open_house]; u[i] = { ...u[i], open_house_date: e.target.value }; setForm((p) => ({ ...p, open_house: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">From Time</span><input type="time" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={oh.from_time} onChange={(e) => { const u = [...form.open_house]; u[i] = { ...u[i], from_time: e.target.value }; setForm((p) => ({ ...p, open_house: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">To Time</span><input type="time" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={oh.to_time} onChange={(e) => { const u = [...form.open_house]; u[i] = { ...u[i], to_time: e.target.value }; setForm((p) => ({ ...p, open_house: u })); }} /></label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Average Price</span>
                            <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white" value={oh.average_price} onChange={(e) => { const u = [...form.open_house]; u[i] = { ...u[i], average_price: e.target.value }; setForm((p) => ({ ...p, open_house: u })); }}>
                              <option value="">-- Select --</option>
                              {(options?.average_price_options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Comments</span><input className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={oh.comments} onChange={(e) => { const u = [...form.open_house]; u[i] = { ...u[i], comments: e.target.value }; setForm((p) => ({ ...p, open_house: u })); }} /></label>
                          <button type="button" className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 self-end" onClick={() => setForm((p) => ({ ...p, open_house: p.open_house.filter((_, idx) => idx !== i) }))}>Remove</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ------------------ IMAGES ------------------ */}
                {activeSection === 'images' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Images</h3>
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-3">
                      <p className="text-sm text-slate-500">Drag & drop or use the button below to upload listing images.</p>
                      <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 inline-block">
                        {isUploadingImages ? 'Uploading...' : 'Upload Images'}
                        <input type="file" accept="image/*" multiple className="hidden" disabled={isUploadingImages}
                          onChange={(e) => { void uploadListingImages(e.target.files); e.currentTarget.value = ''; }} />
                      </label>
                    </div>

                    {form.normalized_images.length > 0 && (
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                        {form.normalized_images.map((img, idx) => (
                          <div key={img.file_url + idx} className="rounded-lg border border-slate-200 bg-white p-2 space-y-2">
                            <div className="aspect-video overflow-hidden rounded bg-slate-100">
                              <img src={img.file_url} alt={`Image ${idx + 1}`} loading="eager" decoding="async" className="h-full w-full object-cover" />
                            </div>
                            <p className="text-xs text-slate-500 truncate">#{idx + 1} - {img.file_name || 'image'}</p>
                            <div className="flex items-center gap-1">
                              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => moveImage(idx, -1)} disabled={idx === 0}>Up</button>
                              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => moveImage(idx, 1)} disabled={idx === form.normalized_images.length - 1}>Down</button>
                              <button type="button" className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700" onClick={() => removeImage(idx)}>Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {form.normalized_images.length === 0 && <p className="text-sm text-slate-400">No images uploaded yet.</p>}
                    <p className="text-xs text-slate-500">Image order determines display order on listing cards and portals.</p>
                  </section>
                )}

                {/* ------------------ MANDATE ------------------ */}
                {activeSection === 'mandate' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Mandate</h3>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Signed Date', 'signed_date', { type: 'date' })}
                      {inp('On Market Since Date', 'on_market_since_date', { type: 'date' })}
                      {inp('Rates & Taxes', 'rates_and_taxes', { placeholder: 'Monthly amount' })}
                      {inp('Monthly Levy', 'monthly_levy', { placeholder: 'Monthly levy' })}
                      {inp('Occupation Date', 'occupation_date', { type: 'date' })}
                      {sel('Mandate Type', 'mandate_type', options?.mandate_types ?? [])}
                    </div>

                    {/* Listing Agents */}
                    <div className="border-t pt-4 space-y-3">
                      <h4 className="text-base font-semibold text-slate-800">Listing Agents</h4>
                      <p className="text-xs text-slate-500">All agents must be active and belong to the same Market Centre. The first agent added is the Primary agent.</p>
                      <AgentSelector roles={options?.agent_roles ?? ['Primary', 'Secondary', 'Third', 'Fourth', 'Referral']} />
                    </div>

                    {/* Contacts */}
                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-800">Contacts</h4>
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                          onClick={() => setForm((p) => ({ ...p, contacts: [...p.contacts, { full_name: '', phone_number: '', email_address: '' }] }))}>
                          Add Contact
                        </button>
                      </div>
                      {form.contacts.map((c, i) => (
                        <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-4 items-end rounded-lg border border-slate-200 p-3">
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Full Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={c.full_name} onChange={(e) => { const u = [...form.contacts]; u[i] = { ...u[i], full_name: e.target.value }; setForm((p) => ({ ...p, contacts: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Phone Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={c.phone_number} onChange={(e) => { const u = [...form.contacts]; u[i] = { ...u[i], phone_number: e.target.value.replace(/\s/g, '') }; setForm((p) => ({ ...p, contacts: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Email Address</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={c.email_address} onChange={(e) => { const u = [...form.contacts]; u[i] = { ...u[i], email_address: e.target.value }; setForm((p) => ({ ...p, contacts: u })); }} /></label>
                          <button type="button" className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs text-red-700 self-end" onClick={() => setForm((p) => ({ ...p, contacts: p.contacts.filter((_, idx) => idx !== i) }))}>Remove</button>
                        </div>
                      ))}
                    </div>

                    {/* Mandate Documents */}
                    <div className="border-t pt-4 space-y-3">
                      <h4 className="text-base font-semibold text-slate-800">Mandate Documents</h4>
                      {editingId ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 inline-block">
                            {isUploadingDocs ? 'Uploading...' : 'Upload Documents'}
                            <input type="file" multiple className="hidden" disabled={isUploadingDocs}
                              onChange={(e) => { void uploadMandateDocuments(e.target.files); e.currentTarget.value = ''; }} />
                          </label>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Save the listing first, then upload mandate documents.</p>
                      )}
                    </div>
                  </section>
                )}

                {/* ------------------ PROPERTY DETAILS ------------------ */}
                {activeSection === 'property' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Property Details</h3>

                    <h4 className="text-base font-semibold text-slate-800">Building Info</h4>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Erf Size (m2)', 'erf_size')}
                      {inp('Floor Area (m2)', 'floor_area')}
                      {inp('Construction Date', 'construction_date', { type: 'date' })}
                      {inp('Height Restriction (m)', 'height_restriction')}
                      {inp('Out Building Size (m2)', 'out_building_size')}
                      {sel('Zoning Type', 'zoning_type', options?.zoning_types ?? [])}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">General Property Features</h4>
                    <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4">
                      {chk('Is Furnished', 'is_furnished')}
                      {chk('Pet Friendly', 'pet_friendly')}
                      {chk('Has Standalone Building', 'has_standalone_building')}
                      {chk('Has Flatlet', 'has_flatlet')}
                      {chk('Has Backup Water', 'has_backup_water')}
                      {chk('Wheelchair Accessible', 'wheelchair_accessible')}
                      {chk('Has Generator', 'has_generator')}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Sustainability</h4>
                    <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4">
                      {chk('Has Borehole', 'has_borehole')}
                      {chk('Has Gas Geyser', 'has_gas_geyser')}
                      {chk('Has Solar Panels', 'has_solar_panels')}
                      {chk('Has Backup Battery/Inverter', 'has_backup_battery_or_inverter')}
                      {chk('Has Solar Geyser', 'has_solar_geyser')}
                      {chk('Has Water Tank', 'has_water_tank')}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Internet</h4>
                    <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4">
                      {chk('ADSL', 'adsl')}
                      {chk('Fibre', 'fibre')}
                      {chk('ISDN', 'isdn')}
                      {chk('Dialup', 'dialup')}
                      {chk('Fixed WiMax', 'fixed_wimax')}
                      {chk('Satellite', 'satellite')}
                    </div>

                    <h4 className="text-base font-semibold text-slate-800 border-t pt-4">Public Transport</h4>
                    <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4">
                      {chk('Nearby Bus Service', 'nearby_bus_service')}
                      {chk('Nearby Minibus Taxi Service', 'nearby_minibus_taxi_service')}
                      {chk('Nearby Train Service', 'nearby_train_service')}
                    </div>

                    {isCommercialOrIndustrial && (
                      <div className="border-t pt-4 space-y-4">
                        <h4 className="text-base font-semibold text-slate-800">Commercial / Industrial Details</h4>
                        {form.mandate_documents.length > 0 && (
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                            {form.mandate_documents
                              .slice()
                              .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
                              .map((doc, index) => (
                                <a
                                  key={`${doc.file_url}-${index}`}
                                  href={doc.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                                >
                                  <span className="truncate text-slate-800">{doc.file_name || `Document ${index + 1}`}</span>
                                  <span className="shrink-0 text-xs text-slate-500">Open</span>
                                </a>
                              ))}
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {inp('Building Name', 'commercial_building_name')}
                          {inp('Gross Lettable Area (sqm)', 'commercial_gross_lettable_area_sqm', { type: 'number' })}
                          {sel('Building Grade', 'commercial_building_grade', options?.commercial_industrial_options?.building_grade_options ?? [])}
                          {sel('Lease Type', 'commercial_lease_type', options?.commercial_industrial_options?.lease_type_options ?? [])}
                          {inp('Gross Price', 'commercial_gross_price', { type: 'number' })}
                          {inp('Net Price', 'commercial_net_price', { type: 'number' })}
                          {inp('Availability Date', 'commercial_availability_date', { type: 'date' })}
                          {inp('Height of Roof', 'commercial_height_of_roof', { type: 'number' })}
                          {inp('Height of Eaves', 'commercial_height_of_eaves', { type: 'number' })}
                          {inp('Height for Racking', 'commercial_height_for_racking', { type: 'number' })}
                          {sel('Truck Access', 'commercial_truck_access', options?.commercial_industrial_options?.truck_access_options ?? [])}
                          {inp('Dock Levellers', 'commercial_dock_levellers', { type: 'number' })}
                          {inp('Height of Dock Levellers', 'commercial_height_of_dock_levellers', { type: 'number' })}
                          {inp('Roller Shutter Doors', 'commercial_roller_shutter_doors', { type: 'number' })}
                          {inp('Height of Roller Shutters', 'commercial_height_of_roller_shutter_doors', { type: 'number' })}
                          {inp('Yard Space (sqm)', 'commercial_yard_space_sqm', { type: 'number' })}
                          {inp('Warehouse Space (sqm)', 'commercial_warehouse_space_sqm', { type: 'number' })}
                          {inp('Office to Warehouse Ratio', 'commercial_office_to_warehouse_ratio', { type: 'number' })}
                          {sel('Power Availability', 'commercial_power_availability', options?.commercial_industrial_options?.power_availability_options ?? [])}
                          {inp('Boardrooms', 'commercial_boardrooms_count', { type: 'number' })}
                        </div>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Power Details Description</span>
                          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={form.commercial_power_details_description} onChange={(e) => setForm((p) => ({ ...p, commercial_power_details_description: e.target.value }))} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-slate-600">Boardroom Description</span>
                          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={form.commercial_boardrooms_description} onChange={(e) => setForm((p) => ({ ...p, commercial_boardrooms_description: e.target.value }))} />
                        </label>

                        <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4">
                          {chk('Green Building', 'commercial_green_building')}
                          {chk('Multi Tenanted', 'commercial_multi_tenanted')}
                          {chk('Has Natural Light', 'commercial_has_natural_light')}
                          {chk('Boardroom Furniture Included', 'commercial_boardrooms_furniture_included')}
                          {chk('Boardroom Internet Port', 'commercial_boardrooms_internet_port')}
                          {chk('Boardroom TV Port', 'commercial_boardrooms_tv_port')}
                          {chk('Boardroom WiFi', 'commercial_boardrooms_wifi')}
                        </div>
                      </div>
                    )}

                    {/* Building Features */}
                    <div className="border-t pt-4 space-y-4">
                      <h4 className="text-base font-semibold text-slate-800">Building Features</h4>
                      <FeatureMultiSelect category="Style" options={options?.style_options ?? []} />
                      <FeatureMultiSelect category="Facing" options={options?.facing_options ?? []} />
                      <FeatureMultiSelect category="Roof" options={options?.roof_options ?? []} />
                      <FeatureMultiSelect category="Walls" options={options?.walls_options ?? []} />
                      <FeatureMultiSelect category="Windows" options={options?.windows_options ?? []} />
                    </div>

                    {/* Property Descriptives (conditional per property type) */}
                    {(options?.property_descriptives?.[form.property_sub_type] ?? options?.property_descriptives?.[form.property_type] ?? []).length > 0 && (
                      <div className="border-t pt-4 space-y-4">
                        <h4 className="text-base font-semibold text-slate-800">Property Descriptives</h4>
                        <FeatureMultiSelect
                          category="Property Descriptive"
                          options={options?.property_descriptives?.[form.property_sub_type] ?? options?.property_descriptives?.[form.property_type] ?? []}
                        />
                      </div>
                    )}

                    {/* Lifestyle Tags */}
                    <div className="border-t pt-4 space-y-4">
                      <h4 className="text-base font-semibold text-slate-800">Lifestyle Tags</h4>
                      <FeatureMultiSelect category="Lifestyle" options={options?.lifestyle_options ?? []} />
                    </div>

                    {/* Property Areas (Rooms) */}
                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-800">Property Areas / Rooms</h4>
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                          onClick={() => setForm((p) => ({ ...p, property_areas: [...p.property_areas, { area_type: '', count: '', size: '', description: '', sub_features: [] }] }))}>
                          Add Area
                        </button>
                      </div>
                      {form.property_areas.map((pa, i) => (
                        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-5 items-end">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Area Type</span>
                            <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white" value={pa.area_type} onChange={(e) => { const u = [...form.property_areas]; u[i] = { ...u[i], area_type: e.target.value }; setForm((p) => ({ ...p, property_areas: u })); }}>
                              <option value="">-- Select --</option>
                              {(options?.property_area_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Count</span><input type="number" min={0} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={pa.count} onChange={(e) => { const u = [...form.property_areas]; u[i] = { ...u[i], count: e.target.value }; setForm((p) => ({ ...p, property_areas: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Size (m2)</span><input type="number" min={0} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={pa.size} onChange={(e) => { const u = [...form.property_areas]; u[i] = { ...u[i], size: e.target.value }; setForm((p) => ({ ...p, property_areas: u })); }} /></label>
                          <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Description</span><input className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={pa.description} onChange={(e) => { const u = [...form.property_areas]; u[i] = { ...u[i], description: e.target.value }; setForm((p) => ({ ...p, property_areas: u })); }} /></label>
                          <button type="button" className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 self-end" onClick={() => setForm((p) => ({ ...p, property_areas: p.property_areas.filter((_, idx) => idx !== i) }))}>Remove</button>
                          </div>

                          <div className="space-y-1">
                            <span className="text-xs text-slate-600">Room Sub Features</span>
                            <div className="flex flex-wrap gap-2">
                              {roomSubFeatureChoices(pa.area_type).map((feature) => {
                                const selected = (pa.sub_features ?? []).includes(feature);
                                return (
                                  <button
                                    key={feature}
                                    type="button"
                                    className={`rounded-full border px-2 py-1 text-xs ${selected ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                                    onClick={() => {
                                      const updated = [...form.property_areas];
                                      const existing = updated[i].sub_features ?? [];
                                      updated[i] = {
                                        ...updated[i],
                                        sub_features: selected
                                          ? existing.filter((f) => f !== feature)
                                          : [...existing, feature],
                                      };
                                      setForm((p) => ({ ...p, property_areas: updated }));
                                    }}
                                  >
                                    {feature}
                                  </button>
                                );
                              })}
                              {roomSubFeatureChoices(pa.area_type).length === 0 && (
                                <span className="text-xs text-slate-400">Select an area type to see sub-feature options.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Listing Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm" onClick={closePreview}>
          <div className="absolute inset-4 md:inset-10 rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Listing Preview</p>
                <h3 className="text-lg font-semibold text-slate-900">{previewItem.property_title ?? previewItem.listing_number ?? 'Listing'}</h3>
              </div>
              <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onClick={closePreview}>Close</button>
            </div>
            <div className="grid h-[calc(100%-65px)] grid-cols-1 gap-4 overflow-y-auto overflow-x-hidden p-5 lg:grid-cols-3">
              <section className="lg:col-span-2 space-y-3">
                <div className="relative h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 md:h-96 lg:h-[32rem]">
                  {(previewItem.image_urls?.[previewImageIdx] ?? previewItem.image_urls?.[0]) ? (
                    <img
                      src={previewItem.image_urls?.[previewImageIdx] ?? previewItem.image_urls?.[0] ?? ''}
                      alt={previewItem.property_title ?? ''}
                      className="h-full w-full object-contain"
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">No image available</div>
                  )}
                  {(previewItem.image_urls?.length ?? 0) > 1 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-3">
                        <button
                          type="button"
                          aria-label="Previous image"
                          onClick={() => setPreviewImageIdx((prev) => (prev - 1 + (previewItem.image_urls?.length ?? 1)) % (previewItem.image_urls?.length ?? 1))}
                          className="pointer-events-auto z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-700 shadow-md transition-colors hover:bg-white hover:text-red-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" /></svg>
                        </button>
                        <button
                          type="button"
                          aria-label="Next image"
                          onClick={() => setPreviewImageIdx((prev) => (prev + 1) % (previewItem.image_urls?.length ?? 1))}
                          className="pointer-events-auto z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-700 shadow-md transition-colors hover:bg-white hover:text-red-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                        </button>
                    </div>
                  )}
                </div>
                {(previewItem.image_urls?.length ?? 0) > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(previewItem.image_urls ?? []).map((url, idx) => (
                      <button
                        key={`${previewItem.id}-thumb-${idx}`}
                        type="button"
                        onClick={() => setPreviewImageIdx(idx)}
                        className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border ${idx === previewImageIdx ? 'border-red-500' : 'border-slate-200'}`}
                      >
                        <img src={url} alt="thumbnail" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-2xl font-bold text-slate-900">{toMoney(previewItem.price ?? null)}</p>
                    <div className="flex max-w-[48%] flex-wrap justify-end gap-2 text-xs">
                      {deriveListingStatusTag(previewItem.listing_status_tag, previewItem.sale_or_rent) && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">{deriveListingStatusTag(previewItem.listing_status_tag, previewItem.sale_or_rent)}</span>}
                      {previewItem.status_name && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{previewItem.status_name}</span>}
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{[[previewItem.street_number, previewItem.street_name].filter(Boolean).join(' '), previewItem.suburb, previewItem.city].filter(Boolean).join(', ') || previewItem.address_line || '-'}</p>
                  {(() => {
                    const previewStats = [
                      { key: 'bedrooms', icon: 'bed' as const, value: numericValue(previewItem.bedroom_count), suffix: '' },
                      { key: 'bathrooms', icon: 'bath' as const, value: numericValue(previewItem.bathroom_count), suffix: '' },
                      { key: 'garages', icon: 'garage' as const, value: numericValue(previewItem.garage_count), suffix: '' },
                      { key: 'parking', icon: 'parking' as const, value: numericValue(previewItem.parking_count), suffix: '' },
                      { key: 'erf', icon: 'erf' as const, value: numericValue(previewItem.erf_size), suffix: ' m2' },
                      { key: 'floor', icon: 'floor' as const, value: numericValue(previewItem.floor_area), suffix: ' m2' },
                    ].filter((stat) => stat.value !== null && stat.value > 0);

                    if (previewStats.length === 0) return null;

                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
                        {previewStats.map((stat) => (
                          <span key={stat.key} className="inline-flex items-center gap-1.5">
                            <CardStatIcon kind={stat.icon} />
                            <span className="font-semibold text-slate-800">{stat.value}{stat.suffix}</span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="relative rounded-xl border border-slate-200 px-3.5 py-3">
                  <h4 className="text-sm font-semibold text-slate-900">Listing Agent</h4>
                  {previewItem.market_center_logo_url && (
                    <img
                      src={previewItem.market_center_logo_url}
                      alt="Market Centre"
                      className="absolute right-3 top-3 h-20 max-w-[280px] shrink-0 object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className="mt-2 flex items-start gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {previewItem.primary_agent_image_url ? (
                        <img
                          src={previewItem.primary_agent_image_url}
                          alt={previewItem.primary_agent_name ?? previewItem.primary_contact_name ?? 'Agent'}
                          className="h-11 w-11 rounded-full border border-slate-200 object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700">
                          {(previewItem.primary_agent_name ?? previewItem.primary_contact_name ?? 'AG')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((v) => v[0]?.toUpperCase() ?? '')
                            .join('')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-5 text-slate-900">{previewItem.primary_agent_name ?? previewItem.primary_contact_name ?? 'Assigned Agent'}</p>
                        <p className="truncate text-xs leading-5 text-slate-600">{previewItem.primary_agent_phone ?? previewItem.primary_contact_phone ?? '-'}</p>
                        <p className="truncate text-xs leading-5 text-slate-600">{previewItem.primary_agent_email ?? previewItem.primary_contact_email ?? '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <h4 className="text-sm font-semibold text-slate-900">Description</h4>
                  <p
                    className="mt-2 text-sm text-slate-700"
                    style={previewExpandedDescription ? undefined : { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {previewItem.property_description ?? previewItem.short_description ?? 'No description provided.'}
                  </p>
                  {!!(previewItem.property_description && previewItem.property_description.length > 420) && (
                    <button type="button" className="mt-2 text-sm font-medium text-red-700 hover:underline" onClick={() => setPreviewExpandedDescription((p) => !p)}>
                      {previewExpandedDescription ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                  <h4 className="text-sm font-semibold text-slate-900">Listing IDs</h4>
                  {(() => {
                    const p24Reference = firstReference(
                      previewDetail?.property24_ref1,
                      previewDetail?.property24_ref2,
                      previewDetail?.property24_reference_id,
                      previewItem.property24_reference_id
                    );
                    const privatePropertyReference = firstReference(
                      previewDetail?.private_property_ref1,
                      previewDetail?.private_property_ref2,
                      previewDetail?.private_property_reference_id,
                      previewItem.private_property_reference_id
                    );
                    const kwwReference = firstReference(
                      previewDetail?.kww_property_reference,
                      previewDetail?.kww_ref1,
                      previewDetail?.kww_ref2,
                      previewItem.kww_reference_id
                    );
                    const entegralReference = firstReference(
                      previewDetail?.entegral_reference_id,
                      previewItem.entegral_reference_id
                    );

                    return (
                      <>
                        <p className="mt-2">
                          P24:{' '}
                          {buildProperty24Url(p24Reference) ? (
                            <a
                              href={buildProperty24Url(p24Reference) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-red-700 hover:underline"
                            >
                              {p24Reference}
                            </a>
                          ) : (
                            '-'
                          )}
                        </p>
                        <p>
                          Private Property:{' '}
                          {buildPrivatePropertyUrl(privatePropertyReference) ? (
                            <a
                              href={buildPrivatePropertyUrl(privatePropertyReference) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-red-700 hover:underline"
                            >
                              {privatePropertyReference}
                            </a>
                          ) : (
                            '-'
                          )}
                        </p>
                        <p>KWW: {kwwReference ?? '-'}</p>
                        <p>Entegral: {entegralReference ?? '-'}</p>
                      </>
                    );
                  })()}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <section className="surface-card p-4 md:p-5">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            <select
              value={saleOrRentFilter}
              onChange={(e) => { setSaleOrRentFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">For Sale or Rent</option>
              <option value="For Sale">For Sale</option>
              <option value="Procurement Rental">Procurement Rental</option>
              <option value="Management Rental">Management Rental</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Draft">Draft</option>
            </select>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search agent, area, address, KWL number, P24 number, Private Property number..."
              className="md:col-span-4 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
            />
            <button type="button" className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700" onClick={() => void refetch()}>
              Search
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            <select value={propertyTypeFilter} onChange={(e) => { setPropertyTypeFilter(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Property Type</option>
              {propertyTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>

            <select value={minPriceFilter} onChange={(e) => { setMinPriceFilter(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Min Price</option>
              {priceOptions.map((v) => <option key={`min-${v}`} value={v}>{toMoney(v)}</option>)}
            </select>

            <select value={maxPriceFilter} onChange={(e) => { setMaxPriceFilter(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Max Price</option>
              {priceOptions.map((v) => <option key={`max-${v}`} value={v}>{toMoney(v)}</option>)}
            </select>

            <select value={minBedroomsFilter} onChange={(e) => { setMinBedroomsFilter(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Bedrooms</option>
              {bedroomCountOptions.filter(Boolean).map((n) => <option key={`bed-${n}`} value={n}>{n}+</option>)}
            </select>

            <select value={minBathroomsFilter} onChange={(e) => { setMinBathroomsFilter(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Bathrooms</option>
              {bathroomCountOptions.filter(Boolean).map((n) => <option key={`bath-${n}`} value={n}>{n}+</option>)}
            </select>

            <button type="button" onClick={() => setShowOptionalFilters((p) => !p)} className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${showOptionalFilters ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('Active');
                setSaleOrRentFilter('');
                setPropertyTypeFilter('');
                setMinPriceFilter('');
                setMaxPriceFilter('');
                setMinBedroomsFilter('');
                setMinBathroomsFilter('');
                setPetFriendlyFilter(false);
                setPoolFilter(false);
                setGardenFilter(false);
                setFlatletFilter(false);
                setRetirementFilter(false);
                setOnShowFilter(false);
                setAuctionFilter(false);
                setSecurityEstateFilter(false);
                setRepossessedFilter(false);
                setShowOptionalFilters(false);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              Clear Filters
            </button>
          </div>

          {showOptionalFilters && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={petFriendlyFilter} onChange={(e) => { setPetFriendlyFilter(e.target.checked); setPage(1); }} />Pet Friendly</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={poolFilter} onChange={(e) => { setPoolFilter(e.target.checked); setPage(1); }} />Pool</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={gardenFilter} onChange={(e) => { setGardenFilter(e.target.checked); setPage(1); }} />Garden</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={flatletFilter} onChange={(e) => { setFlatletFilter(e.target.checked); setPage(1); }} />Flatlet</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={retirementFilter} onChange={(e) => { setRetirementFilter(e.target.checked); setPage(1); }} />Retirement</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={onShowFilter} onChange={(e) => { setOnShowFilter(e.target.checked); setPage(1); }} />On Show</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={auctionFilter} onChange={(e) => { setAuctionFilter(e.target.checked); setPage(1); }} />Auction</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={securityEstateFilter} onChange={(e) => { setSecurityEstateFilter(e.target.checked); setPage(1); }} />Security Estate / Cluster</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={repossessedFilter} onChange={(e) => { setRepossessedFilter(e.target.checked); setPage(1); }} />Repossessed</label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>Page {page} of {totalPages}</span>
            <span>{data?.total ?? 0} listings</span>
          </div>
        </div>

        {/* Card View */}
        {view === 'card' && (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
                <div className="h-40 rounded-lg bg-slate-200" />
                <div className="mt-3 h-4 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
              </div>
            ))}
            {isError && <div className="col-span-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">Could not load listings.</div>}
            {!isLoading && !isError && visibleItems.length === 0 && <div className="col-span-full rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-500">No listings found for this filter.</div>}
            {visibleItems.map((item) => {
              const images = item.image_urls ?? [];
              const activeImage = images[0] ?? null;
              const statusTag = deriveListingStatusTag(item.listing_status_tag, item.sale_or_rent);
              const listingStatus = (item.status_name ?? '').trim();
              const agentDisplayName = item.primary_agent_name || item.primary_contact_name || 'Assigned Agent';
              const agentImageUrl = (item.primary_agent_image_url ?? '').trim();
              const marketCenterLogoUrl = (item.market_center_logo_url ?? '').trim();
              const agentInitials = agentDisplayName
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((v) => v[0]?.toUpperCase() ?? '')
                .join('') || 'AG';
              const cardDescription = (item.property_description ?? item.short_description ?? '').trim();
              const bedroomCount = numericValue(item.bedroom_count);
              const bathroomCount = numericValue(item.bathroom_count);
              const garageCount = numericValue(item.garage_count);
              const parkingCount = numericValue(item.parking_count);
              const erfSize = numericValue(item.erf_size);
              const floorArea = numericValue(item.floor_area);
              const stats = [
                { key: 'bedrooms', icon: 'bed' as const, value: bedroomCount, suffix: '' },
                { key: 'bathrooms', icon: 'bath' as const, value: bathroomCount, suffix: '' },
                { key: 'garages', icon: 'garage' as const, value: garageCount, suffix: '' },
                { key: 'parking', icon: 'parking' as const, value: parkingCount, suffix: '' },
                { key: 'erf', icon: 'erf' as const, value: erfSize, suffix: ' m2' },
                { key: 'floor', icon: 'floor' as const, value: floorArea, suffix: ' m2' },
              ].filter((stat) => stat.value !== null && stat.value > 0);
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.10)]"
                  onClick={() => openPreview(item)}
                >
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_232px]">
                    <div className="relative h-60 overflow-hidden bg-slate-100 md:h-[15.5rem]">
                      {activeImage ? <img src={activeImage} alt={item.property_title ?? ''} loading="eager" decoding="async" className="h-full w-full object-cover object-center" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No image</div>}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/10 to-transparent" />
                    </div>

                    <aside className="bg-slate-50/70 p-4 md:border-l md:border-slate-200">
                      <div className="flex h-full flex-col justify-start">
                        {agentImageUrl ? (
                          <img src={agentImageUrl} alt={agentDisplayName} className="mx-auto h-[4.4rem] w-[4.4rem] rounded-full border border-slate-200 object-cover shadow-sm" loading="lazy" decoding="async" />
                        ) : (
                          <div className="mx-auto flex h-[4.4rem] w-[4.4rem] items-center justify-center rounded-full bg-red-100 text-lg font-bold text-red-700 shadow-sm">{agentInitials}</div>
                        )}
                        <p className="mt-3 text-center text-sm font-semibold text-slate-900">{agentDisplayName}</p>
                        <div className="mt-2 space-y-1 text-[13px] text-slate-700">
                          <p className="text-center">{item.primary_agent_phone || item.primary_contact_phone || '-'}</p>
                          <p className="break-all text-center">{item.primary_agent_email || item.primary_contact_email || '-'}</p>
                        </div>
                        <div className="mt-4">
                          <button
                            type="button"
                            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPreview(item);
                            }}
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    </aside>
                  </div>

                  <div className="space-y-2.5 p-4 pt-3 md:p-5 md:pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xl font-semibold leading-tight text-slate-900">{item.property_title ?? item.short_title ?? item.listing_number ?? 'Untitled'}</p>
                      <button className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50" type="button" onClick={(e) => { e.stopPropagation(); void openEditForm(item); }}>Edit</button>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
                      <div className="space-y-2">
                        <p className="text-sm text-slate-500">{item.listing_number ?? item.source_listing_id}</p>
                        <p className="text-sm text-slate-600">{[[item.street_number, item.street_name].filter(Boolean).join(' '), item.suburb, item.city].filter(Boolean).join(', ') || item.address_line || '-'}</p>
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          {statusTag && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">{statusTag}</span>}
                          {listingStatus && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{listingStatus}</span>}
                        </div>
                      </div>
                      {marketCenterLogoUrl && (
                        <div className="flex min-w-[116px] justify-end overflow-visible pt-1">
                          <img src={marketCenterLogoUrl} alt="Market Centre" className="h-11 max-w-[126px] origin-top-right scale-[1.9] object-contain" loading="lazy" decoding="async" />
                        </div>
                      )}
                    </div>
                    <p className="min-h-[3.6rem] text-sm leading-7 text-slate-600" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {cardDescription || 'No description available.'}
                    </p>
                    {stats.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-sm text-slate-700">
                        {stats.map((stat) => (
                          <span key={stat.key} className="inline-flex items-center gap-1.5">
                            <CardStatIcon kind={stat.icon} />
                            <span className="font-semibold text-slate-800">{stat.value}{stat.suffix}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-[1.55rem] font-bold leading-none text-slate-900">{toMoney(item.price)}</p>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                    IDs:{' '}
                    {buildProperty24Url(item.property24_reference_id) ? (
                      <a
                        href={buildProperty24Url(item.property24_reference_id) ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-red-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        P24 {item.property24_reference_id}
                      </a>
                    ) : (
                      <span>P24 -</span>
                    )}
                    {' | '}
                    {buildPrivatePropertyUrl(item.private_property_reference_id) ? (
                      <a
                        href={buildPrivatePropertyUrl(item.private_property_reference_id) ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-red-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        PP {item.private_property_reference_id}
                      </a>
                    ) : (
                      <span>PP -</span>
                    )}
                    {' | '}KWW {item.kww_reference_id ?? '-'} | Entegral {item.entegral_reference_id ?? '-'}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* List View */}
        {view === 'list' && (
          <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Listing</th>
                  <th className="px-3 py-2">Image</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Portal IDs</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                {isLoading && <tr><td className="px-3 py-4 text-slate-500" colSpan={8}>Loading listings...</td></tr>}
                {isError && <tr><td className="px-3 py-4 text-amber-700" colSpan={8}>Could not load listings.</td></tr>}
                {!isLoading && !isError && visibleItems.length === 0 && <tr><td className="px-3 py-4 text-slate-500" colSpan={8}>No listings found.</td></tr>}
                {visibleItems.map((item) => {
                  const images = item.image_urls ?? [];
                  return (
                    <tr key={item.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openPreview(item)}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{item.property_title ?? item.short_title ?? item.listing_number ?? '-'}</div>
                        <div className="text-xs text-slate-500">{item.listing_number ?? item.source_listing_id}</div>
                      </td>
                      <td className="px-3 py-2">
                        {images[0] ? <img src={images[0]} alt="" loading="lazy" decoding="async" className="h-12 w-16 rounded border border-slate-200 object-cover" /> : <span className="text-xs text-slate-400">No image</span>}
                      </td>
                      <td className="px-3 py-2">
                        {item.sale_or_rent && <span className="mr-1">{item.sale_or_rent}</span>}
                        {deriveListingStatusTag(item.listing_status_tag, item.sale_or_rent) && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{deriveListingStatusTag(item.listing_status_tag, item.sale_or_rent)}</span>}
                      </td>
                      <td className="px-3 py-2">{item.status_name ?? '-'}</td>
                      <td className="px-3 py-2">{[[item.street_number, item.street_name].filter(Boolean).join(' '), item.suburb, item.city].filter(Boolean).join(', ') || item.address_line || '-'}</td>
                      <td className="px-3 py-2">{toMoney(item.price)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div className="space-y-0.5">
                          <div>
                            P24:{' '}
                            {buildProperty24Url(item.property24_reference_id) ? (
                              <a
                                href={buildProperty24Url(item.property24_reference_id) ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-red-700 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.property24_reference_id}
                              </a>
                            ) : (
                              '-'
                            )}
                          </div>
                          <div>
                            PP:{' '}
                            {buildPrivatePropertyUrl(item.private_property_reference_id) ? (
                              <a
                                href={buildPrivatePropertyUrl(item.private_property_reference_id) ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-red-700 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.private_property_reference_id}
                              </a>
                            ) : (
                              '-'
                            )}
                          </div>
                          <div>KWW: {item.kww_reference_id ?? '-'}</div>
                          <div>Entegral: {item.entegral_reference_id ?? '-'}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={(e) => { e.stopPropagation(); void openEditForm(item); }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50" type="button" onClick={() => setPage((p) => p - 1)} disabled={!canGoPrev}>Previous</button>
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50" type="button" onClick={() => setPage((p) => p + 1)} disabled={!canGoNext}>Next</button>
        </div>
      </section>
    </div>
  );
}

