import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGoogleMapsScript } from '../hooks/useGoogleMapsScript';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListingRow = {
  id: string;
  source_listing_id: string;
  source_market_center_id: string | null;
  market_center_id?: string | null;
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
  private_property_sync_status?: string | null;
  feed_to_private_property?: boolean | null;
  kww_reference_id?: string | null;
  entegral_reference_id?: string | null;
  is_draft?: boolean;
  is_published?: boolean;
  mandate_type?: string | null;
  image_urls?: string[];
  thumbnail_url?: string | null;
  can_edit?: boolean;
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
  entegral_reference_id: string;
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

type Property24CityOption = {
  id: string;
  name: string;
  province: string | null;
  alternateNames: string[];
};

type Property24CitySearchResponse = {
  items: Property24CityOption[];
};

type Property24ProvinceOption = {
  id: string;
  name: string;
};

type Property24ProvinceSearchResponse = {
  items: Property24ProvinceOption[];
};

type ActiveAgentRow = { id: string; full_name: string | null; source_market_center_id: string | null; market_center_id: string | null; market_center_name: string | null };

type ViewMode = 'card' | 'list';
type ListingSection = 'info' | 'address' | 'marketing' | 'images' | 'mandate' | 'property';

const PAGE_SIZE = 20;
const SOUTH_AFRICA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
];

type PortalPublishRequirement = {
  section: ListingSection;
  label: string;
  helpText: string;
  isMissing: (form: ListingFormState) => boolean;
  when?: (form: ListingFormState) => boolean;
};

type PublishValidationError = {
  section: ListingSection;
  sectionLabel: string;
  label: string;
  helpText: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const listingSectionLabels: Record<ListingSection, string> = {
  info: 'Listing Info',
  address: 'Address & Validation',
  marketing: 'Marketing',
  images: 'Images',
  mandate: 'Mandate',
  property: 'Property Details',
};

function hasPrimaryAgent(form: ListingFormState): boolean {
  return form.agents.some((agent) => {
    const assocId = (agent.associate_id ?? '').trim();
    const name = (agent.agent_name ?? '').trim();
    return Boolean(assocId || name);
  });
}

const MIN_PHOTOS_FOR_PUBLISH = 3;

function hasImageForPublish(form: ListingFormState): boolean {
  const normalizedCount = form.normalized_images.filter((item) => Boolean((item.file_url ?? '').trim())).length;
  const fallbackCount = form.image_urls.filter((url) => Boolean((url ?? '').trim())).length;
  return (normalizedCount + fallbackCount) >= MIN_PHOTOS_FOR_PUBLISH;
}

function hasPropertyAreaCount(form: ListingFormState, keyword: string): boolean {
  const key = keyword.trim().toLowerCase();
  return form.property_areas.some((area) => {
    const areaType = (area.area_type ?? '').trim().toLowerCase();
    const count = numericValue(area.count) ?? 0;
    return areaType.includes(key) && count > 0;
  });
}

function isResidentialProperty(form: ListingFormState): boolean {
  const propertyType = (form.property_type ?? '').trim().toLowerCase();
  return propertyType.length === 0 || (propertyType !== 'commercial' && propertyType !== 'industrial' && propertyType !== 'land' && propertyType !== 'farm');
}

function isLandProperty(form: ListingFormState): boolean {
  const subType = (form.property_sub_type ?? '').trim().toLowerCase();
  const propertyType = (form.property_type ?? '').trim().toLowerCase();
  return subType === 'vacant land' || subType === 'land' || propertyType === 'land';
}

// Sub-types that support a unit number (sectional title / complex / multi-unit)
const SECTIONAL_TITLE_SUB_TYPES = new Set([
  'flat/apartment', 'apartment/flat', 'apartment', 'townhouse', 'cluster',
]);

function isSectionalTitleSubType(form: ListingFormState): boolean {
  const subType = (form.property_sub_type ?? '').trim().toLowerCase();
  return SECTIONAL_TITLE_SUB_TYPES.has(subType);
}

const minimumPortalRequirements: PortalPublishRequirement[] = [
  {
    section: 'info',
    label: 'For Sale or For Rent',
    helpText: 'Please indicate whether this property is for sale or for rent.',
    isMissing: (form) => !form.sale_or_rent.trim(),
  },
  {
    section: 'info',
    label: 'Listing Status',
    helpText: 'The listing must have a status (e.g. Active) before it can be published.',
    isMissing: (form) => !form.status_name.trim(),
  },
  {
    section: 'info',
    label: 'Expiry Date',
    helpText: 'All portal listings need an expiry date. Please set the date this listing expires.',
    isMissing: (form) => !form.expiry_date.trim(),
  },
  {
    section: 'info',
    label: 'Asking Price',
    helpText: 'Please enter the asking price for this property, or tick "Price on Application" if you prefer not to show it.',
    isMissing: (form) => !form.price.trim() && !form.poa,
  },
  {
    section: 'property',
    label: 'Property Type',
    helpText: 'Portals need to know what kind of property this is (e.g. House, Apartment, Farm). Please select a property type.',
    isMissing: (form) => !form.property_type.trim(),
  },
  {
    section: 'property',
    label: 'Property Sub-Type',
    helpText: 'Please select a sub-type to help buyers find the right kind of property (e.g. Freehold, Sectional Title).',
    isMissing: (form) => !form.property_sub_type.trim(),
  },
  {
    section: 'property',
    label: 'Listing Headline',
    helpText: 'Add a short, catchy headline for this listing — this is what buyers see first on the portals.',
    isMissing: (form) => !form.property_title.trim(),
  },
  {
    section: 'property',
    label: 'Property Description',
    helpText: 'Write a description of the property. This tells buyers what makes it special and is required by all portals.',
    isMissing: (form) => !form.property_description.trim(),
  },
  {
    section: 'address',
    label: 'Suburb',
    helpText: 'The suburb is required so buyers can search for properties in the right area.',
    isMissing: (form) => !form.suburb.trim(),
  },
  {
    section: 'address',
    label: 'City',
    helpText: 'Please add the city where this property is located.',
    isMissing: (form) => !form.city.trim(),
  },
  {
    section: 'address',
    label: 'Province',
    helpText: 'Please select the province this property is in.',
    isMissing: (form) => !form.province.trim(),
  },
  {
    section: 'address',
    label: 'Street Address',
    helpText: 'A street address is needed so the portals can confirm the correct location.',
    isMissing: (form) => !form.address_line.trim() && !form.street_name.trim(),
  },
  {
    section: 'images',
    label: 'At Least 3 Photos',
    helpText: 'Listings with more photos get significantly more interest. Please upload at least 3 photos before publishing.',
    isMissing: (form) => !hasImageForPublish(form),
  },
  {
    section: 'mandate',
    label: 'Agent Assignment',
    helpText: 'This listing needs at least one agent assigned to it so that buyers know who to contact.',
    isMissing: (form) => !hasPrimaryAgent(form),
  },
  {
    section: 'property',
    label: 'Number of Bedrooms',
    helpText: 'Buyers filter their search by bedrooms — please add how many bedrooms this property has.',
    isMissing: (form) => !hasPropertyAreaCount(form, 'bedroom'),
    when: (form) => isResidentialProperty(form),
  },
  {
    section: 'property',
    label: 'Number of Bathrooms',
    helpText: 'Buyers filter their search by bathrooms — please add how many bathrooms this property has.',
    isMissing: (form) => !hasPropertyAreaCount(form, 'bathroom'),
    when: (form) => isResidentialProperty(form),
  },
  {
    section: 'property',
    label: 'Erf / Land Size (m²)',
    helpText: 'For land and vacant land listings, the stand size is required so buyers know the size of the plot.',
    isMissing: (form) => !(form.erf_size ?? '').trim(),
    when: (form) => isLandProperty(form),
  },
];

function getSelectedPortalNames(form: ListingFormState): string[] {
  return [
    form.feed_to_property24 ? 'Property24' : null,
    form.feed_to_private_property ? 'Private Property' : null,
    form.feed_to_kww ? 'KWW' : null,
    form.feed_to_entegral ? 'Entegral' : null,
  ].filter((name): name is string => Boolean(name));
}

function getPortalPublishMissingFields(form: ListingFormState): PublishValidationError[] {
  const missing: PublishValidationError[] = [];
  for (const requirement of minimumPortalRequirements) {
    if (requirement.when && !requirement.when(form)) continue;
    if (!requirement.isMissing(form)) continue;
    missing.push({
      section: requirement.section,
      sectionLabel: listingSectionLabels[requirement.section],
      label: requirement.label,
      helpText: requirement.helpText,
    });
  }
  return missing;
}

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
  return `https://www.property24.com/for-sale/modimolle/modimolle/limpopo/11294/${reference}`;
}

function buildPrivatePropertyUrl(referenceId: string | null | undefined): string | null {
  const reference = referenceId?.trim();
  if (!reference) return null;
  return `https://www.privateproperty.co.za/${reference}`;
}

function buildKwwUrl(referenceId: string | null | undefined): string | null {
  const reference = referenceId?.trim();
  if (!reference) return null;
  return `https://kw.com/property/${reference}`;
}

function normalizeReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return null;
  return trimmed;
}

function normalizePrivatePropertyReference(value: unknown): string | null {
  const normalized = normalizeReference(value);
  if (!normalized) return null;
  return /^T\d{5,}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function firstReference(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeReference(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstPrivatePropertyReference(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizePrivatePropertyReference(value);
    if (normalized) return normalized;
  }
  return null;
}

function buildPreviewDetailFromForm(form: ListingFormState, originalListingPayload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...originalListingPayload,
    property24_ref1: form.property24_ref1,
    property24_ref2: form.property24_ref2,
    private_property_ref1: form.private_property_ref1,
    private_property_ref2: form.private_property_ref2,
    kww_property_reference: form.kww_property_reference,
    kww_ref1: form.kww_ref1,
    kww_ref2: form.kww_ref2,
  };
}

function extractProperty24SuburbId(listingPayload: unknown): string | null {
  if (!listingPayload || typeof listingPayload !== 'object') return null;
  const payload = listingPayload as Record<string, unknown>;
  const propertyInfo = payload.propertyInfo;
  if (propertyInfo && typeof propertyInfo === 'object') {
    const suburbId = normalizeReference((propertyInfo as Record<string, unknown>).suburbId);
    if (suburbId && /^\d+$/.test(suburbId)) return suburbId;
  }

  const suburbId = normalizeReference(payload.suburbId);
  return suburbId && /^\d+$/.test(suburbId) ? suburbId : null;
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
  const cleaned = input.map((v) => v.trim()).filter((v) => /^https?:\/\//i.test(v) || v.startsWith('/uploads/') || v.startsWith('https://storage.googleapis.com/'));
  return [...new Set(cleaned)];
}

function isWithdrawalState(statusName: string | null | undefined, statusTag: string | null | undefined): boolean {
  const status = (statusName ?? '').toLowerCase().trim();
  const tag = (statusTag ?? '').toLowerCase().trim();
  return status === 'inactive' || status === 'withdrawn' || tag === 'withdrawn' || tag === 'withdraw';
}

function normalizeRenderableImageUrl(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const uploadHostMatch = v.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
  return uploadHostMatch ? uploadHostMatch[1] : v;
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

const MAX_LISTING_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;

async function getUploadErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  return body.error ?? body.message ?? fallback;
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
  /** Scope filter driven by active role in backend (cleared when user explicitly searches). */
  scoped?: boolean;
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
  if (filters.scoped) params.set('scoped', 'true');
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
  feed_to_entegral: false, entegral_reference_id: '', entegral_sync_status: '',
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
  const location = useLocation();
  const navigate = useNavigate();
  const { user, canCreateListing, canEditListing, isOfficeAdmin, isAgent, activeContext } = useAuth();
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
  /** When true, the query is scoped to the user's role (own listings / own MC). Cleared on any user-initiated filter change. */
  const [scopeActive, setScopeActive] = useState(true);

  // Reset scope whenever the active context changes (role switch)
  useEffect(() => {
    setScopeActive(true);
    setPage(1);
  }, [activeContext?.id]);

  const [previewItem, setPreviewItem] = useState<ListingRow | null>(null);
  const [previewDetail, setPreviewDetail] = useState<Record<string, unknown> | null>(null);
  const [previewImageIdx, setPreviewImageIdx] = useState(0);
  const [previewExpandedDescription, setPreviewExpandedDescription] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ListingSection>('info');
  const [form, setForm] = useState<ListingFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [publishValidationErrors, setPublishValidationErrors] = useState<PublishValidationError[]>([]);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [originalListingPayload, setOriginalListingPayload] = useState<Record<string, unknown>>({});
  const [selectedProperty24SuburbId, setSelectedProperty24SuburbId] = useState<string | null>(null);
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);
  const [geocodeStatusMessage, setGeocodeStatusMessage] = useState<string | null>(null);
  const [p24Result, setP24Result] = useState<{ success: boolean; message: string; property24_reference_id?: string | null; details?: unknown } | null>(null);
  const [ppResult, setPpResult] = useState<{ success: boolean; message: string; reference_id?: string | null; details?: unknown } | null>(null);
  const [kwwResult, setKwwResult] = useState<{ success: boolean; message: string; reference_id?: string | null; reference_uuid?: string | null; reference_key?: string | null; details?: unknown } | null>(null);
  const [entegralResult, setEntegralResult] = useState<{ success: boolean; message: string; reference_id?: string | null; details?: unknown } | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [isGeneratingNumber, setIsGeneratingNumber] = useState(false);
  const preloadedImagesRef = useRef<Set<string>>(new Set());
  const openedFromReviewParamRef = useRef<string | null>(null);

  // Scoped mode is backend permission-driven (OWN/MARKET_CENTRE) and lifted when user changes filters.
  const scopedMode = scopeActive && (isAgent || isOfficeAdmin);

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
    scoped: scopedMode,
  };

  const activeContextId = activeContext?.id ?? 'no-context';

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['listings', activeContextId, page, search, statusFilter, saleOrRentFilter, queryFilters],
    queryFn: () => fetchListings(page, search, statusFilter, saleOrRentFilter, queryFilters),
  });

  // Ensure we immediately refresh listing data when role/context changes,
  // so row-level can_edit flags are never carried over from a previous context.
  useEffect(() => {
    void refetch();
  }, [activeContextId, refetch]);

  // Poll for PP T-number after a successful publish that returned no reference yet.
  // PP assigns the T-number asynchronously — poll /api/listings/:id every 30s for up to 10 min.
  useEffect(() => {
    const awaitingRef = ppResult?.success && !ppResult.reference_id && editingId;
    if (!awaitingRef) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 × 30s = 10 minutes

    const poll = async () => {
      if (cancelled || attempts >= MAX_ATTEMPTS) return;
      attempts++;
      try {
        const res = await fetch(`/api/listings/${editingId}`);
        if (!res.ok) return;
        const body = await res.json() as Record<string, unknown>;
        const ref = (
          normalizePrivatePropertyReference(body.private_property_ref1) ??
          normalizePrivatePropertyReference(body.private_property_ref2) ??
          normalizePrivatePropertyReference((body.listing_payload as Record<string, unknown>)?.private_property_ref1)
        );
        if (ref && !cancelled) {
          // T-number arrived — fill form and refresh listing cards
          setForm((prev) => ({
            ...prev,
            private_property_ref1: ref,
            private_property_sync_status: `Active ${new Date().toISOString().slice(0, 10)}`,
          }));
          setPpResult((prev) => prev ? { ...prev, reference_id: ref } : prev);
          void refetch();
          return; // stop polling
        }
      } catch {
        // network hiccup — keep polling
      }
      if (!cancelled) {
        timerId = window.setTimeout(() => { void poll(); }, 30_000);
      }
    };

    let timerId = window.setTimeout(() => { void poll(); }, 30_000);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppResult?.success, ppResult?.reference_id, editingId]);

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
      const res = await fetch('/api/agents/options?status=active');
      if (!res.ok) return { items: [] as ActiveAgentRow[] };
      const body = (await res.json()) as {
        items?: Array<{
          id: string;
          full_name: string | null;
          source_market_center_id: string | null;
          market_center_id: string | null;
          market_center_name: string | null;
        }>;
      };
      return {
        items: (body.items ?? []).map((row) => ({
          id: row.id,
          full_name: row.full_name,
          source_market_center_id: row.source_market_center_id,
          market_center_id: row.market_center_id,
          market_center_name: row.market_center_name,
        })),
      };
    },
    staleTime: 60000,
  });

  const { data: property24SuburbData, isFetching: isSearchingProperty24Suburbs } = useQuery<Property24SuburbSearchResponse>({
    queryKey: ['listing-property24-suburbs', form.province, form.city, form.suburb],
    queryFn: async () => {
      const params = new URLSearchParams({ province: form.province, city: form.city, q: form.suburb });
      const res = await fetch(`/api/listings/property24-suburbs/search?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to load Property24 suburbs');
      }
      return res.json() as Promise<Property24SuburbSearchResponse>;
    },
    enabled: isFormOpen && activeSection === 'address' && Boolean(form.province.trim()) && Boolean(form.city.trim()),
    staleTime: 30000,
  });

  const { data: property24CityData, isFetching: isSearchingProperty24Cities } = useQuery<Property24CitySearchResponse>({
    queryKey: ['listing-property24-cities', form.province, form.city],
    queryFn: async () => {
      const params = new URLSearchParams({ province: form.province, q: form.city });
      const res = await fetch(`/api/listings/property24-cities/search?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to load Property24 cities');
      }
      return res.json() as Promise<Property24CitySearchResponse>;
    },
    enabled: isFormOpen && activeSection === 'address' && Boolean(form.province.trim()),
    staleTime: 30000,
  });

  const { data: property24ProvinceData, isFetching: isSearchingProperty24Provinces } = useQuery<Property24ProvinceSearchResponse>({
    queryKey: ['listing-property24-provinces'],
    queryFn: async () => {
      const res = await fetch('/api/listings/property24-provinces');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to load Property24 provinces');
      }
      return res.json() as Promise<Property24ProvinceSearchResponse>;
    },
    enabled: isFormOpen,
    staleTime: Infinity,
  });

  const activeAgents = activeAgentsData?.items ?? [];

  // Fetch whether the current agent requires admin approval before publish
  const { data: homeData } = useQuery<{ associate?: { listing_approval_required?: boolean } }>({
    queryKey: ['listings-home-approval-required', activeContextId],
    queryFn: async () => {
      const res = await fetch('/api/agents/me/home');
      if (!res.ok) return {};
      return res.json() as Promise<{ associate?: { listing_approval_required?: boolean } }>;
    },
    staleTime: 60000,
  });
  const listingApprovalRequired = Boolean(homeData?.associate?.listing_approval_required);
  const { ready: isGoogleMapsReady } = useGoogleMapsScript();

  const visibleItems = useMemo(() => data?.items ?? [], [data]);
  const editingRow = useMemo(() => {
    if (!editingId) return null;
    return visibleItems.find((item) => item.id === editingId) ?? null;
  }, [editingId, visibleItems]);
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

  const formPreviewItem = useMemo<ListingRow>(() => {
    const primaryAgent = form.agents.find((agent) => agent.is_primary) ?? form.agents[0] ?? null;
    const primaryContact = form.contacts[0] ?? null;
    const imageUrls = normalizeImageUrls([
      ...form.normalized_images.map((image) => image.file_url ?? '').filter(Boolean),
      ...form.image_urls,
    ]);

    return {
      id: editingId ?? 'draft-preview',
      source_listing_id: form.source_listing_id || editingId || 'draft-preview',
      source_market_center_id: form.source_market_center_id || editingRow?.source_market_center_id || null,
      market_center_id: editingRow?.market_center_id ?? (form.source_market_center_id || null),
      listing_number: form.listing_number || null,
      status_name: form.status_name || null,
      listing_status_tag: form.listing_status_tag || null,
      sale_or_rent: form.sale_or_rent || null,
      address_line: form.address_line || null,
      street_number: form.street_number || null,
      street_name: form.street_name || null,
      suburb: form.suburb || null,
      city: form.city || null,
      province: form.province || null,
      country: form.country || null,
      price: form.price || null,
      expiry_date: form.expiry_date || null,
      property_title: form.property_title || form.short_title || form.listing_number || 'Listing',
      short_title: form.short_title || null,
      property_description: form.property_description || null,
      short_description: form.short_description || null,
      property_type: form.property_type || null,
      property_sub_type: form.property_sub_type || null,
      primary_agent_name: primaryAgent?.agent_name || editingRow?.primary_agent_name || null,
      primary_agent_image_url: editingRow?.primary_agent_image_url ?? null,
      primary_agent_phone: editingRow?.primary_agent_phone ?? null,
      primary_agent_email: editingRow?.primary_agent_email ?? null,
      market_center_logo_url: editingRow?.market_center_logo_url ?? null,
      primary_contact_name: primaryContact?.full_name || null,
      primary_contact_phone: primaryContact?.phone_number || null,
      primary_contact_email: primaryContact?.email_address || null,
      bedroom_count: editingRow?.bedroom_count ?? null,
      bathroom_count: editingRow?.bathroom_count ?? null,
      garage_count: editingRow?.garage_count ?? null,
      parking_count: editingRow?.parking_count ?? null,
      erf_size: form.erf_size || editingRow?.erf_size || null,
      floor_area: form.floor_area || editingRow?.floor_area || null,
      property24_reference_id: form.property24_ref1 || form.property24_ref2 || editingRow?.property24_reference_id || null,
      private_property_reference_id: form.private_property_ref1 || form.private_property_ref2 || editingRow?.private_property_reference_id || null,
      kww_reference_id: form.kww_property_reference || form.kww_ref1 || form.kww_ref2 || editingRow?.kww_reference_id || null,
      entegral_reference_id: form.entegral_reference_id || editingRow?.entegral_reference_id || null,
      is_draft: form.is_draft,
      is_published: form.is_published,
      mandate_type: form.mandate_type || null,
      image_urls: imageUrls,
      thumbnail_url: imageUrls[0] ?? null,
      can_edit: true,
      updated_at: editingRow?.updated_at ?? new Date().toISOString(),
    };
  }, [editingId, editingRow, form]);

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

  const openFormPreview = (): void => {
    setPreviewItem(formPreviewItem);
    setPreviewDetail(buildPreviewDetailFromForm(form, originalListingPayload));
    setPreviewImageIdx(0);
    setPreviewExpandedDescription(false);
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

  const getDescriptiveFeatureOptions = (propertyType: string, propertySubType: string): string[] => {
    const map = options?.property_descriptives ?? {};
    const candidates = [
      propertySubType,
      propertySubType.replace('Town House', 'Townhouse'),
      propertySubType.replace('TownHouse', 'Townhouse'),
      propertySubType.replace('Apartment / Flat', 'Flat/Apartment'),
      propertySubType.replace('Apartment/Flat', 'Flat/Apartment'),
      propertySubType.replace('Flat / Apartment', 'Flat/Apartment'),
      propertySubType.replace('Flat/Apartment', 'Apartment'),
      propertyType,
    ].filter(Boolean);

    for (const key of candidates) {
      const opts = map[key];
      if (opts && opts.length > 0) return opts;
    }
    return [];
  };

  const descriptiveFeatureOptions = useMemo(() => {
    return getDescriptiveFeatureOptions(form.property_type, form.property_sub_type);
  }, [options, form.property_type, form.property_sub_type]);

  // Available agents filtered by same market center as the first selected agent (if any).
  // For Agent/OfficeAdmin roles, also restrict by the active context's market centre even before a primary is chosen.
  const agentMarketCenterId = form.agents[0]?.market_center_id ?? '';
  const filteredAgents = useMemo(() => {
    const mcFilter = agentMarketCenterId || (isAgent || isOfficeAdmin ? activeContext?.marketCenterId ?? '' : '');
    if (!mcFilter) return activeAgents;
    return activeAgents.filter((a) => a.market_center_id === mcFilter);
  }, [activeAgents, agentMarketCenterId, isAgent, isOfficeAdmin, activeContext]);

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

  const suburbPickerOptions = useMemo(() => {
    const property24Options = property24SuburbData?.items ?? [];
    if (property24Options.length > 0) return property24Options;

    return filteredSuburbs.map((name) => ({
      id: '',
      name,
      city: form.city || null,
      province: form.province || null,
      alternateNames: [],
    }));
  }, [property24SuburbData, filteredSuburbs, form.city, form.province]);

  const cityPickerOptions = useMemo(() => {
    const property24Options = property24CityData?.items ?? [];
    if (property24Options.length > 0) return property24Options;

    return filteredCities.map((name) => ({
      id: '',
      name,
      province: form.province || null,
      alternateNames: [],
    }));
  }, [property24CityData, filteredCities, form.province]);

  const isCommercialOrIndustrial = form.property_type === 'Commercial' || form.property_type === 'Industrial';
  const reviewListingId = useMemo(() => {
    const value = new URLSearchParams(location.search).get('review');
    return value ? value.trim() : '';
  }, [location.search]);

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
    if (!reviewListingId) {
      openedFromReviewParamRef.current = null;
      return;
    }
    if (openedFromReviewParamRef.current === reviewListingId) return;

    openedFromReviewParamRef.current = reviewListingId;
    void openEditForm({ id: reviewListingId } as ListingRow);

    const params = new URLSearchParams(location.search);
    params.delete('review');
    const nextSearch = params.toString();
    void navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, reviewListingId]);

  // Keep city/suburb searchable and free-typed while the user is typing.
  // We only reset dependent fields on explicit picker selections/change handlers.

  // Auto-populate Address Line (Full) from individual address fields
  const addressLineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (addressLineDebounceRef.current) clearTimeout(addressLineDebounceRef.current);
    addressLineDebounceRef.current = setTimeout(() => {
      const { street_number, street_name, suburb, city, province, postal_code } = form;
      if (!street_number && !street_name && !suburb && !city && !province) return;
      const parts = [
        [street_number, street_name].filter(Boolean).join(' '),
        suburb,
        city,
        province,
        postal_code,
      ].filter(Boolean);
      if (parts.length === 0) return;
      const assembled = parts.join(', ');
      setForm((p) => ({ ...p, address_line: assembled }));
    }, 400);
    return () => { if (addressLineDebounceRef.current) clearTimeout(addressLineDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.street_number, form.street_name, form.suburb, form.city, form.province, form.postal_code]);

  // Silent geocoding: when province + city + suburb + street number + street name are all present,
  // call the Google Maps JS Geocoder and fill latitude/longitude automatically.
  const geocodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const { province, city, suburb, street_number, street_name, country } = form;
    if (!province || !city || !suburb || !street_number || !street_name) {
      setIsGeocodingAddress(false);
      setGeocodeStatusMessage(null);
      return;
    }
    if (!isGoogleMapsReady || typeof window.google?.maps?.Geocoder === 'undefined') {
      setGeocodeStatusMessage('Google Maps is not ready yet.');
      return;
    }

    if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current);
    let disposed = false;

    geocodeDebounceRef.current = setTimeout(() => {
      const parts = [street_number, street_name, suburb, city, province, country || 'South Africa'].filter(Boolean);
      const addressStr = parts.join(', ');
      setIsGeocodingAddress(true);
      setGeocodeStatusMessage(null);
      let settled = false;

      const finish = (message: string | null, lat?: number, lng?: number) => {
        if (settled || disposed) return;
        settled = true;
        if (typeof lat === 'number' && typeof lng === 'number') {
          setForm((p) => ({
            ...p,
            latitude: String(lat),
            longitude: String(lng),
          }));
        }
        setGeocodeStatusMessage(message);
        setIsGeocodingAddress(false);
      };

      // Fallback: backend Nominatim (OpenStreetMap, no key, works server-side)
      const fetchBackendGeocode = async (): Promise<void> => {
        try {
          const url = `/api/listings/geocode-address/search?address=${encodeURIComponent(addressStr)}`;
          const response = await fetch(url);
          const body = await response.json().catch(() => ({})) as {
            found?: boolean;
            latitude?: number;
            longitude?: number;
            status?: string;
            error?: string;
          };
          if (response.ok && body.found && typeof body.latitude === 'number' && typeof body.longitude === 'number') {
            finish(null, body.latitude, body.longitude);
          } else {
            finish(null); // silent — coordinates just won't fill
          }
        } catch {
          finish(null);
        }
      };

      // Primary: browser fetch to Google Geocoding REST API.
      // The browser automatically sends the Origin header which satisfies HTTP Referrer key restrictions.
      const mapsKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '';
      if (!mapsKey) {
        void fetchBackendGeocode();
        return;
      }

      const googleUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      googleUrl.searchParams.set('address', addressStr);
      googleUrl.searchParams.set('components', 'country:ZA');
      googleUrl.searchParams.set('key', mapsKey);

      const controller = new AbortController();
      const watchdog = window.setTimeout(() => {
        controller.abort();
        if (!settled) void fetchBackendGeocode();
      }, 6000);

      fetch(googleUrl.toString(), { signal: controller.signal })
        .then((res) => res.json())
        .then((body: { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }> }) => {
          window.clearTimeout(watchdog);
          if (body.status === 'OK' && body.results.length > 0) {
            const { lat, lng } = body.results[0].geometry.location;
            finish(null, lat, lng);
          } else {
            void fetchBackendGeocode();
          }
        })
        .catch(() => {
          window.clearTimeout(watchdog);
          if (!settled) void fetchBackendGeocode();
        });
    }, 800);

    return () => {
      disposed = true;
      if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.province, form.city, form.suburb, form.street_number, form.street_name, form.country, isGoogleMapsReady]);

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
    let initialAgents: typeof emptyForm.agents = [];
    if ((isAgent || isOfficeAdmin) && activeContext?.associateId) {
      const me = activeAgents.find((a) => a.id === activeContext.associateId);
      initialAgents = [{
        associate_id: activeContext.associateId,
        agent_name: me?.full_name ?? user?.name ?? '',
        agent_role: 'Primary',
        is_primary: true,
        market_center_id: me?.market_center_id ?? activeContext.marketCenterId ?? '',
        sort_order: 0,
      }];
    }
    setForm({ ...emptyForm, agents: initialAgents });
    setEditingId(null);
    setActiveSection('info');
    setFormError(null);
    setOriginalListingPayload({});
    setSelectedProperty24SuburbId(null);
    setP24Result(null);
    setPpResult(null);
    setKwwResult(null);
    setEntegralResult(null);
    setIsFormOpen(true);
  }

  async function openEditForm(item: ListingRow): Promise<void> {
    setIsLoadingDetails(true);
    setEditingId(item.id);
    setActiveSection('info');
    setFormError(null);
    setP24Result(null);
    setPpResult(null);
    setKwwResult(null);
    setEntegralResult(null);
    setIsFormOpen(true);

    try {
      const detailsRes = await fetch(`/api/listings/${item.id}`);
      const listing = detailsRes.ok ? ((await detailsRes.json()) as Record<string, unknown>) : (item as unknown as Record<string, unknown>);

      const s = (key: string) => String(listing[key] ?? '');
      const b = (key: string) => parseBooleanLike(listing[key]);
      const payload = typeof listing.listing_payload === 'object' && listing.listing_payload !== null
        ? (listing.listing_payload as Record<string, unknown>)
        : {};
      const property24SuburbId = extractProperty24SuburbId(payload);
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

      const normalizePayloadKey = (key: string): string => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const findPayloadValue = (root: unknown, candidateKeys: string[]): unknown => {
        const wanted = new Set(candidateKeys.map(normalizePayloadKey));
        const stack: unknown[] = [root];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current || typeof current !== 'object') continue;
          for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
            if (wanted.has(normalizePayloadKey(k)) && v !== null && v !== undefined) return v;
            if (v && typeof v === 'object') stack.push(v);
          }
        }
        return undefined;
      };

      const privatePropertyRef = firstPrivatePropertyReference(
        listing.private_property_ref1,
        listing.private_property_ref2,
        listing.private_property_reference_id,
        payload.PrivatePropertyReference,
        payload.private_property_reference,
        payload.privatePropertyReference,
        payload.private_property_ref1,
        payload.private_property_ref2
      ) ?? '';
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

  setOriginalListingPayload(payload);
  setSelectedProperty24SuburbId(property24SuburbId);
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
        entegral_reference_id: entegralRef,
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
        erf_size: firstNonEmpty(
          listing.erf_size,
          findPayloadValue(payload, ['ErfSize', 'erf_size', 'erfSize', 'LandSize', 'land_size', 'landSize', 'LotSize', 'lot_size', 'lotSize', 'PlotSize', 'plot_size', 'plotSize'])
        ),
        floor_area: firstNonEmpty(
          listing.floor_area,
          findPayloadValue(payload, ['FloorArea', 'floor_area', 'floorArea', 'BuildingSize', 'building_size', 'buildingSize', 'GrossFloorArea', 'gross_floor_area', 'grossFloorArea'])
        ),
        construction_date: toInputDate(firstNonEmpty(
          listing.construction_date,
          findPayloadValue(payload, ['ConstructionDate', 'construction_date', 'constructionDate', 'BuiltDate', 'built_date', 'builtDate', 'YearBuilt', 'year_built', 'yearBuilt'])
        )),
        height_restriction: firstNonEmpty(
          listing.height_restriction,
          findPayloadValue(payload, ['HeightRestriction', 'height_restriction', 'heightRestriction', 'HeightOfRoof', 'height_of_roof', 'heightOfRoof'])
        ),
        out_building_size: firstNonEmpty(
          listing.out_building_size,
          findPayloadValue(payload, ['OutBuildingSize', 'out_building_size', 'outBuildingSize', 'OutbuildingSize', 'outbuilding_size', 'outbuildingSize'])
        ),
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
        agents: (() => {
          const loaded: AgentEntry[] = Array.isArray(listing.agents) ? (listing.agents as AgentEntry[]) : [];
          if (loaded.length === 0 && (isAgent || isOfficeAdmin) && activeContext?.associateId) {
            const me = activeAgents.find((a) => a.id === activeContext.associateId);
            return [{
              associate_id: activeContext.associateId,
              agent_name: me?.full_name ?? user?.name ?? '',
              agent_role: 'Primary',
              is_primary: true,
              market_center_id: me?.market_center_id ?? activeContext.marketCenterId ?? '',
              sort_order: 0,
            }];
          }
          return loaded;
        })(),
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
    setPublishValidationErrors([]);
    setP24Result(null);
    setPpResult(null);
    setKwwResult(null);
    setEntegralResult(null);

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

      const existingPropertyInfo = originalListingPayload.propertyInfo && typeof originalListingPayload.propertyInfo === 'object'
        ? (originalListingPayload.propertyInfo as Record<string, unknown>)
        : {};

      // Draft saves should always persist Listing Status as Draft.
      const effectiveStatusName = publish ? form.status_name : 'Draft';
      const effectiveForm = publish ? form : { ...form, status_name: effectiveStatusName };

      const withdrawing = isWithdrawalState(effectiveStatusName, form.listing_status_tag);
      const requiresApprovalOnPublish = publish && listingApprovalRequired && !isOfficeAdmin && !withdrawing;
      const shouldBePublished = publish && !requiresApprovalOnPublish && !withdrawing;
      const selectedPortalNames = getSelectedPortalNames(effectiveForm);
      const shouldValidatePortalMinimum = publish && selectedPortalNames.length > 0 && !requiresApprovalOnPublish;

      if (shouldValidatePortalMinimum) {
        const missingFields = getPortalPublishMissingFields(effectiveForm);
        if (missingFields.length > 0) {
          setPublishValidationErrors(missingFields);
          setIsSaving(false);
          return;
        }
      }

      const payload = {
        ...effectiveForm,
        status_name: effectiveStatusName,
        listing_number: listingNumber,
        // If approval required: keep as draft; approval flow will publish after review
        is_draft: requiresApprovalOnPublish ? true : !publish,
        is_published: shouldBePublished,
        listing_status_tag: requiresApprovalOnPublish ? 'Pending Approval' : form.listing_status_tag,
        image_urls: normalizeImageUrls([...form.normalized_images.map(ni => ni.file_url ?? '').filter(u => u), ...form.image_urls]),
        listing_payload: {
          ...originalListingPayload,
          EntegralReference: form.entegral_reference_id,
          EntegralId: form.entegral_reference_id,
          entegral_reference: form.entegral_reference_id,
          entegral_reference_id: form.entegral_reference_id,
          EntegralSyncMessage: form.entegral_sync_status,
          entegral_sync_status: form.entegral_sync_status,
          propertyInfo: {
            ...existingPropertyInfo,
            ...(selectedProperty24SuburbId ? { suburbId: Number(selectedProperty24SuburbId) } : {}),
          },
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
        const raw = await res.text();
        let message = `Failed to save listing (${res.status})`;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { error?: string; message?: string };
            message = parsed.error ?? parsed.message ?? message;
          } catch {
            message = raw;
          }
        }
        throw new Error(message);
      }

      let savedId = editingId;
      if (!editingId) {
        const body = (await res.json()) as { id: string };
        setEditingId(body.id);
        savedId = body.id;
      }

      // Approval flow: submit for admin review instead of direct publish
      if (requiresApprovalOnPublish && savedId) {
        const submitRes = await fetch(`/api/listings/${savedId}/submit-for-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: 'Submitted from listing workspace' }),
        });
        if (!submitRes.ok) {
          const body = (await submitRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Failed to submit listing for approval');
        }
        setFormSuccess('Your listing has been submitted for approval. Admins will be notified to review it.');
        await refetch();
        return;
      }

      // If publishing and any portal is enabled, call each independently in parallel
      const anyPortalEnabled = publish && savedId && (form.feed_to_property24 || form.feed_to_private_property || form.feed_to_kww || form.feed_to_entegral);
      if (anyPortalEnabled && savedId) {
        await Promise.all([
          form.feed_to_property24
            ? fetch(`/api/listings/${savedId}/publish-to-property24`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(async (r) => {
                  const body = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; property24_reference_id?: string | null; error?: string; details?: unknown };
                  if (r.ok && body.success) {
                    setP24Result({ success: true, message: body.message ?? 'Published to Property24.', property24_reference_id: body.property24_reference_id ?? null, details: body.details });
                    if (body.property24_reference_id) {
                      setForm((prev) => ({ ...prev, property24_ref1: body.property24_reference_id ?? prev.property24_ref1, property24_sync_status: `Published ${new Date().toISOString().slice(0, 10)}`, feed_to_property24: true }));
                    }
                  } else {
                    const errMsg = body.message ?? body.error ?? `Property24 publish failed (HTTP ${r.status})`;
                    setP24Result({ success: false, message: errMsg, details: body.details });
                    setForm((prev) => ({ ...prev, property24_sync_status: `Failed: ${errMsg.slice(0, 200)}` }));
                  }
                })
                .catch((err: unknown) => { setP24Result({ success: false, message: err instanceof Error ? err.message : 'Network error' }); })
            : Promise.resolve(),
          form.feed_to_private_property
            ? fetch(`/api/listings/${savedId}/publish-to-private-property`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(async (r) => {
                  const body = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; reference_id?: string | null; error?: string; details?: unknown };
                  const ok = r.ok && !!body.success;
                  const msg = body.message ?? body.error ?? (ok ? 'Published to Private Property.' : `Private Property publish failed (HTTP ${r.status})`);
                  setPpResult({ success: ok, message: msg, reference_id: body.reference_id ?? null, details: body.details });
                  if (ok) {
                    // Always update sync status; only update ref if PP returned one (T-number may arrive later)
                    setForm((prev) => ({
                      ...prev,
                      private_property_ref1: body.reference_id ?? prev.private_property_ref1,
                      private_property_sync_status: body.reference_id
                        ? `Active ${new Date().toISOString().slice(0, 10)}`
                        : `Active (awaiting ref)`,
                    }));
                  }
                })
                .catch((err: unknown) => { setPpResult({ success: false, message: err instanceof Error ? err.message : 'Network error' }); })
            : Promise.resolve(),
          form.feed_to_kww
            ? fetch(`/api/listings/${savedId}/publish-to-kww`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(async (r) => {
                  const body = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; reference_id?: string | null; reference?: string | null; reference_uuid?: string | null; reference_key?: string | null; error?: string; details?: unknown; rawResponse?: unknown };
                  const ok = r.ok && !!body.success;
                  const detailsText = !ok && body.details
                    ? (() => {
                        try { return JSON.stringify(body.details); } catch { return String(body.details); }
                      })()
                    : null;
                  const msg = body.message ?? body.error ?? detailsText ?? (ok ? 'Published to KW Worldwide.' : `KWW publish failed (HTTP ${r.status})`);
                  const ref = body.reference_id ?? body.reference ?? null;
                  setKwwResult({ success: ok, message: msg, reference_id: ref, reference_uuid: body.reference_uuid ?? null, reference_key: body.reference_key ?? null, details: body.details ?? body.rawResponse });
                  if (ok) {
                    setForm((prev) => ({
                      ...prev,
                      kww_property_reference: ref ?? prev.kww_property_reference,
                      kww_ref1: body.reference_uuid ?? prev.kww_ref1,
                      kww_ref2: body.reference_key ?? prev.kww_ref2,
                      kww_sync_status: 'Active',
                    }));
                  }
                })
                .catch((err: unknown) => { setKwwResult({ success: false, message: err instanceof Error ? err.message : 'Network error' }); })
            : Promise.resolve(),
          form.feed_to_entegral
            ? fetch(`/api/listings/${savedId}/publish-to-entegral`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                .then(async (r) => {
                  const body = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; reference_id?: string | null; error?: string; details?: unknown };
                  const ok = r.ok && !!body.success;
                  const msg = body.message ?? body.error ?? (ok ? 'Published to Entegral.' : `Entegral publish failed (HTTP ${r.status})`);
                  setEntegralResult({ success: ok, message: msg, reference_id: body.reference_id ?? null, details: body.details });
                  if (ok) {
                    setForm((prev) => ({ ...prev, entegral_sync_status: `Published ${new Date().toISOString().slice(0, 10)}` }));
                  }
                })
                .catch((err: unknown) => { setEntegralResult({ success: false, message: err instanceof Error ? err.message : 'Network error' }); })
            : Promise.resolve(),
        ]);

        await refetch();
        return; // Keep form open so user can see portal results
      }

      setIsFormOpen(false);
      await refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save listing');
    } finally {
      setIsSaving(false);
    }
  }

  function closeListingWorkspace(): void {
    setFormError(null);
    setFormSuccess(null);
    setP24Result(null);
    setPpResult(null);
    setKwwResult(null);
    setEntegralResult(null);
    setIsFormOpen(false);
  }

  async function uploadListingImages(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setIsUploadingImages(true);
    setFormError(null);
    const allNewUrls: string[] = [];
    const failures: string[] = [];
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/')) {
          failures.push(`${f.name}: unsupported file type.`);
          continue;
        }

        if (f.size > MAX_LISTING_IMAGE_SIZE_BYTES) {
          failures.push(`${f.name}: file too large. Maximum image size is 15MB.`);
          continue;
        }

        const payloadFiles = [{
          name: f.name,
          mimeType: f.type,
          contentBase64: await fileToBase64(f),
        }];
        const res = await fetch('/api/listings/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: payloadFiles }),
        });
        if (!res.ok) {
          failures.push(`${f.name}: ${await getUploadErrorMessage(res, 'Image upload failed.')}`);
          continue;
        }
        const body = (await res.json()) as { image_urls?: string[] };
        allNewUrls.push(...normalizeImageUrls(body.image_urls ?? []));
      }

      if (allNewUrls.length === 0 && failures.length > 0) {
        throw new Error(failures.join(' '));
      }

      const newNormalized: NormalizedImageEntry[] = allNewUrls.map((url, i) => ({
        file_url: url,
        file_name: url.split('/').pop() ?? '',
        media_type: 'image',
        uploaded_by: '',
        sort_order: form.normalized_images.length + i,
      }));
      setForm((p) => ({
        ...p,
        normalized_images: [...p.normalized_images, ...newNormalized],
        image_urls: normalizeImageUrls([...p.image_urls, ...allNewUrls]),
      }));

      if (failures.length > 0) {
        setFormError(failures.join(' '));
      }
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

  function property24ProvinceField() {
    const allProvinces = (property24ProvinceData?.items ?? []).length > 0
      ? (property24ProvinceData?.items ?? [])
      : (options?.provinces ?? []).length > 0
        ? (options?.provinces ?? []).map((name) => ({ id: name, name }))
        : SOUTH_AFRICA_PROVINCES.map((name) => ({ id: name, name }));
    const provinceOptions = Array.from(new Set(allProvinces.map((p) => p.name))).sort((a, b) => a.localeCompare(b));
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Province</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          list="listing-province-options"
          value={form.province}
          name="listingProvince"
          autoComplete="new-password"
          onChange={(e) => {
            const nextValue = e.target.value;
            setForm((p) => ({ ...p, province: nextValue, city: '', suburb: '' }));
            setSelectedProperty24SuburbId(null);
          }}
          placeholder={isSearchingProperty24Provinces ? 'Loading provinces…' : 'Search or select province'}
        />
        <datalist id="listing-province-options">
          {provinceOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
    );
  }

  function property24SuburbField() {
    const suburbOptions = Array.from(new Set(suburbPickerOptions.map((option) => option.name))).sort((a, b) => a.localeCompare(b));
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Suburb</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          list="listing-suburb-options"
          name="listingSuburb"
          autoComplete="new-password"
          value={form.suburb}
          onChange={(e) => {
            const nextValue = e.target.value;
            const matched = suburbPickerOptions.find((option) => option.name.toLowerCase() === nextValue.trim().toLowerCase());
            setForm((p) => ({ ...p, suburb: nextValue }));
            setSelectedProperty24SuburbId(matched?.id || null);
          }}
          placeholder={form.city && form.province ? 'Search Property24 suburbs' : 'Select province and city first'}
        />
        <datalist id="listing-suburb-options">
          {suburbOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="flex min-h-5 items-center justify-between text-[11px] text-slate-500">
          <span>
            {selectedProperty24SuburbId
              ? `Matched to Property24 suburb ID ${selectedProperty24SuburbId}`
              : 'Choose a suburb from the Property24 list to lock the suburb ID.'}
          </span>
          {isSearchingProperty24Suburbs && <span>Searching...</span>}
        </div>
      </label>
    );
  }

  function property24CityField() {
    const cityOptions = Array.from(new Set(cityPickerOptions.map((option) => option.name))).sort((a, b) => a.localeCompare(b));
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">City</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          list="listing-city-options"
          name="listingCity"
          autoComplete="new-password"
          value={form.city}
          onChange={(e) => {
            const nextValue = e.target.value;
            setForm((p) => ({ ...p, city: nextValue, suburb: '' }));
            setSelectedProperty24SuburbId(null);
          }}
          placeholder={form.province ? 'Search Property24 cities' : 'Select province first'}
        />
        <datalist id="listing-city-options">
          {cityOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="flex min-h-5 items-center justify-end text-[11px] text-slate-500">
          {isSearchingProperty24Cities && <span>Searching...</span>}
        </div>
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
    const agentListId = 'listing-agent-options';
    const [agentQuery, setAgentQuery] = useState('');
    const [agentRole, setAgentRole] = useState('Secondary');

    const searchableAgents = useMemo(() => filteredAgents.map((a) => ({
      ...a,
      display: `${a.full_name ?? a.id} (${a.source_market_center_id ?? ''})`,
    })), [filteredAgents]);

    function addAgent() {
      const query = agentQuery.trim().toLowerCase();
      if (!query) return;
      const found = searchableAgents.find((a) =>
        a.id.toLowerCase() === query
        || a.display.toLowerCase() === query
        || `${a.full_name ?? ''} ${a.id} ${a.source_market_center_id ?? ''} ${a.market_center_name ?? ''}`.toLowerCase().includes(query)
      );
      if (!found) return;
      if (form.agents.some((a) => a.associate_id === found.id)) return;
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
      setAgentQuery('');
    }

    return (
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input
            type="search"
            list={agentListId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white flex-1 min-w-48"
            value={agentQuery}
            onChange={(e) => setAgentQuery(e.target.value)}
            placeholder="-- Select Agent (type to search) --"
          />
          <datalist id={agentListId}>
            {searchableAgents.map((a) => (
              <option key={a.id} value={a.display} />
            ))}
          </datalist>
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
          {canCreateListing && (
            <button className="primary-btn" type="button" onClick={openCreateForm}>Add Listing</button>
          )}
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
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  type="button"
                  onClick={openFormPreview}
                >
                  Preview Listing
                </button>
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" type="button" onClick={closeListingWorkspace}>Cancel</button>
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
                  {isSaving
                    ? (form.feed_to_property24 ? 'Saving...' : 'Saving...')
                    : (() => {
                        const withdrawing = isWithdrawalState(form.status_name, form.listing_status_tag);
                        if (listingApprovalRequired && !isOfficeAdmin && !withdrawing) return 'Save & Submit for Approval';
                        const selectedPortals = [
                          form.feed_to_property24 ? 'Property24' : null,
                          form.feed_to_private_property ? 'Private Property' : null,
                          form.feed_to_kww ? 'KWW' : null,
                          form.feed_to_entegral ? 'Entegral' : null,
                        ].filter((name): name is string => Boolean(name));
                        if (selectedPortals.length === 0) return 'Save / Publish';
                        const action = withdrawing ? 'Withdraw from' : 'Publish to';
                        if (selectedPortals.length === 1) return `Save & ${action} ${selectedPortals[0]}`;
                        return `Save & ${action} Selected Portals`;
                      })()}
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
                ] as [ListingSection, string][]).map(([key, label]) => {
                  const sectionHasError = publishValidationErrors.some((e) => e.section === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveSection(key)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium flex items-center justify-between gap-2 ${activeSection === key ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-white'}`}
                    >
                      <span>{label}</span>
                      {sectionHasError && (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${activeSection === key ? 'bg-white' : 'bg-amber-500'}`} title="This section has required fields missing" />
                      )}
                    </button>
                  );
                })}
              </aside>

              {/* Content Panel */}
              <div className="flex-1 overflow-auto p-6 space-y-6">
                {isLoadingDetails && <p className="text-sm text-slate-500">Loading listing details...</p>}
                {formSuccess && <p className="text-sm text-green-700 rounded-lg bg-green-50 p-3 border border-green-200">{formSuccess}</p>}
                {formError && <p className="text-sm text-amber-700 rounded-lg bg-amber-50 p-3 border border-amber-200">{formError}</p>}
                {publishValidationErrors.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <span className="text-amber-500 text-lg leading-none mt-0.5">⚠️</span>
                      <div>
                        <p className="font-semibold text-amber-800 text-sm">A few things are needed before you can publish</p>
                        <p className="text-amber-700 text-xs mt-0.5">Please complete the following before publishing to the portals:</p>
                      </div>
                    </div>
                    <ul className="space-y-2 pl-1">
                      {publishValidationErrors.map((err, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <button
                            type="button"
                            className="text-xs bg-amber-200 text-amber-800 rounded px-1.5 py-0.5 font-medium shrink-0 mt-0.5 hover:bg-amber-300 transition-colors text-center"
                            style={{ minWidth: '9.5rem' }}
                            onClick={() => setActiveSection(err.section)}
                          >
                            {err.sectionLabel}
                          </button>
                          <div>
                            <p className="text-sm font-medium text-amber-900">{err.label}</p>
                            <p className="text-xs text-amber-700">{err.helpText}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="text-xs text-amber-600 hover:text-amber-800 underline"
                      onClick={() => setPublishValidationErrors([])}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {(p24Result || ppResult || kwwResult || entegralResult) && (
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      onClick={closeListingWorkspace}
                    >
                      Close Workspace
                    </button>
                  </div>
                )}
                {p24Result && (
                  <div className={`rounded-lg border p-4 flex items-start gap-3 ${p24Result.success ? 'bg-green-50 border-green-300 text-green-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
                    <span className="text-lg">{p24Result.success ? '✅' : '❌'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {p24Result.success
                          ? (p24Result.message.toLowerCase().includes('withdrawn') ? 'Property24 Withdraw Successful' : 'Property24 Publish Successful')
                          : (p24Result.message.toLowerCase().includes('withdraw') ? 'Property24 Withdraw Failed' : 'Property24 Publish Failed')}
                      </p>
                      <p className="text-sm mt-0.5">{p24Result.message}</p>
                      {p24Result.success && p24Result.property24_reference_id && (
                        <p className="text-xs mt-1 font-mono bg-white/60 rounded px-2 py-1 inline-block border border-green-200">
                          Reference ID: {p24Result.property24_reference_id}
                        </p>
                      )}
                      {!p24Result.success && Boolean(p24Result.details) && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white/60 px-3 py-2 text-xs leading-5 border border-red-200">
                          {JSON.stringify(p24Result.details, null, 2)}
                        </pre>
                      )}
                    </div>
                    <button type="button" className="text-xs opacity-60 hover:opacity-100 shrink-0" onClick={() => setP24Result(null)}>Dismiss</button>
                  </div>
                )}
                {ppResult && (
                  <div className={`rounded-lg border p-4 flex items-start gap-3 ${ppResult.success ? 'bg-green-50 border-green-300 text-green-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                    <span className="text-lg">{ppResult.success ? '✅' : '⚠️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {ppResult.success ? 'Private Property Publish Successful' : 'Private Property Not Published'}
                      </p>
                      <p className="text-sm mt-0.5">{ppResult.message}</p>
                      {ppResult.success && ppResult.reference_id && (
                        <p className="text-xs mt-1 font-mono bg-white/60 rounded px-2 py-1 inline-block border border-green-200">
                          Reference ID: {ppResult.reference_id}
                        </p>
                      )}
                      {ppResult.success && !ppResult.reference_id && (
                        <p className="text-xs mt-1 text-amber-700 animate-pulse">
                          Checking for PP reference number… (auto-fills when assigned)
                        </p>
                      )}
                    </div>
                    <button type="button" className="text-xs opacity-60 hover:opacity-100 shrink-0" onClick={() => setPpResult(null)}>Dismiss</button>
                  </div>
                )}
                {kwwResult && (
                  <div className={`rounded-lg border p-4 flex items-start gap-3 ${kwwResult.success ? 'bg-green-50 border-green-300 text-green-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                    <span className="text-lg">{kwwResult.success ? '✅' : '⚠️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {kwwResult.success ? 'KW Worldwide Publish Successful' : 'KW Worldwide Not Published'}
                      </p>
                      <p className="text-sm mt-0.5">{kwwResult.message}</p>
                      {kwwResult.success && kwwResult.reference_id && (
                        <p className="text-xs mt-1 font-mono bg-white/60 rounded px-2 py-1 inline-block border border-green-200">
                          Reference ID: {kwwResult.reference_id}
                        </p>
                      )}
                    </div>
                    <button type="button" className="text-xs opacity-60 hover:opacity-100 shrink-0" onClick={() => setKwwResult(null)}>Dismiss</button>
                  </div>
                )}
                {entegralResult && (
                  <div className={`rounded-lg border p-4 flex items-start gap-3 ${entegralResult.success ? 'bg-green-50 border-green-300 text-green-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                    <span className="text-lg">{entegralResult.success ? '✅' : '⚠️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {entegralResult.success ? 'Entegral Publish Successful' : 'Entegral Not Published'}
                      </p>
                      <p className="text-sm mt-0.5">{entegralResult.message}</p>
                      {entegralResult.success && entegralResult.reference_id && (
                        <p className="text-xs mt-1 font-mono bg-white/60 rounded px-2 py-1 inline-block border border-green-200">
                          Reference ID: {entegralResult.reference_id}
                        </p>
                      )}
                    </div>
                    <button type="button" className="text-xs opacity-60 hover:opacity-100 shrink-0" onClick={() => setEntegralResult(null)}>Dismiss</button>
                  </div>
                )}

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
                      {sel('For Sale or Rent', 'sale_or_rent', options?.sale_or_rent_types ?? [])}
                      {inp('Expiry Date', 'expiry_date', { type: 'date' })}
                      {sel('Listing Status', 'status_name', options?.listing_statuses ?? ['Active', 'Inactive', 'Draft'])}
                      {(() => {
                        const isRental = (form.sale_or_rent ?? '').toLowerCase().includes('rent');
                        // Portal mapping hints — vary by sale vs rental
                        const STATUS_TAG_HINTS: Record<string, string> = isRental ? {
                          'For Sale':          'P24: To Rent (active) · KWW: For Rent · PP: To Let',
                          'Reduced':           'P24: Reduced banner · KWW: For Rent · PP: To Let',
                          'Under Offer':       'P24: Pending banner · KWW: Pending · PP: Pending Offer',
                          'Sold':              'P24: Sold · KWW: Sold · PP: Sold',
                          'Withdrawn':         'P24: Withdrawn (delisted) · KWW: Withdrawn · PP: Inactive',
                          'Expired':           'P24: Expired (delisted) · KWW: Expired',
                          'Pending Approval':  'Internal only — not sent to portals until approved',
                          'Approval Declined': 'Internal only — listing blocked from publishing',
                        } : {
                          'For Sale':          'P24: Active · KWW: For Sale · PP: For Sale',
                          'Reduced':           'P24: Reduced banner · KWW: For Sale · PP: For Sale',
                          'Under Offer':       'P24: Pending banner · KWW: Pending · PP: Pending Offer',
                          'Sold':              'P24: Sold · KWW: Sold · PP: Sold',
                          'Withdrawn':         'P24: Withdrawn (delisted) · KWW: Withdrawn · PP: Inactive',
                          'Expired':           'P24: Expired (delisted) · KWW: Expired',
                          'Pending Approval':  'Internal only — not sent to portals until approved',
                          'Approval Declined': 'Internal only — listing blocked from publishing',
                        };
                        const currentHint = STATUS_TAG_HINTS[form.listing_status_tag] ?? null;
                        const tagChoices = options?.listing_status_tags ?? ['For Sale', 'Reduced', 'Under Offer', 'Sold', 'Withdrawn', 'Expired', 'Pending Approval', 'Approval Declined'];
                        return (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-600">Listing Status Tag</span>
                            <select
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                              value={form.listing_status_tag}
                              onChange={(e) => setForm((p) => ({ ...p, listing_status_tag: e.target.value }))}
                            >
                              <option value="">-- Select --</option>
                              {tagChoices.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            {currentHint && (
                              <span className="text-xs text-slate-500 leading-tight">{currentHint}</span>
                            )}
                          </label>
                        );
                      })()}
                      {sel('Ownership Type', 'ownership_type', options?.ownership_types ?? [])}
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
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Property Type</span>
                        <select
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                          value={form.property_type}
                          onChange={(e) => {
                            const nextType = e.target.value;
                            const nextSubTypeChoices = options?.property_sub_types?.[nextType] ?? [];
                            setForm((p) => {
                              const nextSubType = nextSubTypeChoices.includes(p.property_sub_type)
                                ? p.property_sub_type
                                : (nextSubTypeChoices[0] ?? '');
                              const nextDfOpts = getDescriptiveFeatureOptions(nextType, nextSubType);
                              const nextDescriptive = nextDfOpts.includes(p.descriptive_feature)
                                ? p.descriptive_feature
                                : '';
                              return {
                                ...p,
                                property_type: nextType,
                                property_sub_type: nextSubType,
                                descriptive_feature: nextDescriptive,
                              };
                            });
                          }}
                        >
                          <option value="">-- Select --</option>
                          {(options?.property_types ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-600">Property Sub Type</span>
                        <select
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                          value={form.property_sub_type}
                          onChange={(e) => {
                            const nextSubType = e.target.value;
                            setForm((p) => {
                              const nextDfOpts = getDescriptiveFeatureOptions(p.property_type, nextSubType);
                              const nextSubTypeLower = nextSubType.trim().toLowerCase();
                              const nextIsSectional = SECTIONAL_TITLE_SUB_TYPES.has(nextSubTypeLower);
                              return {
                                ...p,
                                property_sub_type: nextSubType,
                                descriptive_feature: nextDfOpts.includes(p.descriptive_feature)
                                  ? p.descriptive_feature
                                  : '',
                                // Clear unit/door number for freehold/non-sectional property types
                                unit_number: nextIsSectional ? p.unit_number : '',
                                door_number: nextIsSectional ? p.door_number : '',
                              };
                            });
                          }}
                        >
                          <option value="">-- Select --</option>
                          {subTypeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                        {(() => {
                          const dfOpts = descriptiveFeatureOptions;
                          if (dfOpts.length === 0) return inp('Descriptive Feature', 'descriptive_feature');
                          return (
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-slate-600">Descriptive Feature</span>
                              <select
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                                value={form.descriptive_feature}
                                onChange={(e) => setForm((p) => ({ ...p, descriptive_feature: e.target.value }))}
                              >
                                <option value="">-- Select --</option>
                                {form.descriptive_feature && !dfOpts.includes(form.descriptive_feature) && (
                                  <option value={form.descriptive_feature}>{form.descriptive_feature}</option>
                                )}
                                {dfOpts.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </label>
                          );
                        })()}
                      {chk('Retirement Living', 'retirement_living')}
                    </div>
                  </section>
                )}

                {/* ------------------ ADDRESS ------------------ */}
                {activeSection === 'address' && (
                  <section className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-900">Address & Validation</h3>

                    {/* Structured address entry — cascading P24 dropdowns, then street details */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <p className="text-xs text-slate-500">
                        Select your location step by step. Once all fields are filled in, the map coordinates will be set automatically.
                      </p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {inp('Country', 'country')}
                        {property24ProvinceField()}
                        {property24CityField()}
                        {property24SuburbField()}
                        {inp('Street Number', 'street_number')}
                        {inp('Street Name', 'street_name')}
                        {inp('Postal Code', 'postal_code')}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 border-t pt-3">
                        <span className={isGeocodingAddress ? 'text-amber-600 font-medium' : ''}>
                          {isGeocodingAddress ? '📍 Finding map coordinates…' : '📍 Coordinates are set automatically once all address fields are filled in.'}
                        </span>
                        {!isGeocodingAddress && geocodeStatusMessage && (
                          <span className="text-red-600 font-medium">{geocodeStatusMessage}</span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {inp('Erf Number', 'erf_number')}
                      {isSectionalTitleSubType(form) && inp('Unit Number', 'unit_number')}
                      {isSectionalTitleSubType(form) && inp('Door Number', 'door_number')}
                      {inp('Estate Name', 'estate_name')}
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
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {inp('Private Property Reference', 'private_property_ref1')}
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
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {inp('KWW Property Reference', 'kww_property_reference')}
                            {inp('Sync Status', 'kww_sync_status')}
                          </div>
                        )}
                      </div>

                      {/* Entegral */}
                      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          {chk('Feed to Entegral', 'feed_to_entegral')}
                        </div>
                        {(form.feed_to_entegral || Boolean(firstReference(form.entegral_reference_id, form.entegral_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {inp('Entegral Reference', 'entegral_reference_id')}
                            {inp('Sync Status', 'entegral_sync_status')}
                          </div>
                        )}
                      </div>

                      {/* Property24 */}
                      <div className={`rounded-lg border p-4 space-y-3 ${form.feed_to_property24 ? 'border-red-300 bg-red-50/30' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {chk('Feed to Property24', 'feed_to_property24')}
                          </div>
                          {form.feed_to_property24 && (
                            <span className="text-xs text-red-700 font-medium bg-red-100 rounded-full px-2 py-0.5">
                              Will publish live when &quot;Save &amp; Publish to Property24&quot; is clicked
                            </span>
                          )}
                        </div>
                        {(form.feed_to_property24 || Boolean(firstReference(form.property24_ref1, form.property24_ref2, form.property24_sync_status))) && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {inp('Property24 Reference', 'property24_ref1')}
                            {inp('Sync Status', 'property24_sync_status')}
                          </div>
                        )}
                        {form.feed_to_property24 && (
                          <p className="text-xs text-slate-500">
                            The primary agent must have a <strong>Property24 Agent ID</strong> set on their associate record for the publish to succeed.
                            Property description, price, address, suburb, city, and province are required.
                          </p>
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
        <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-sm" onClick={closePreview}>
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
                      src={normalizeRenderableImageUrl(previewItem.image_urls?.[previewImageIdx] ?? previewItem.image_urls?.[0] ?? '')}
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
                        <img src={normalizeRenderableImageUrl(url)} alt="thumbnail" className="h-full w-full object-cover" loading="lazy" decoding="async" />
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
                    const privatePropertyReference = firstPrivatePropertyReference(
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
                          ) : (form.feed_to_private_property || (form.private_property_sync_status ?? '').toLowerCase().startsWith('active')) ? (
                            <span className="text-amber-600 font-medium">Published — awaiting ref number</span>
                          ) : (
                            '-'
                          )}
                        </p>
                        <p>
                          KWW:{' '}
                          {buildKwwUrl(kwwReference) ? (
                            <a
                              href={buildKwwUrl(kwwReference) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-red-700 hover:underline"
                            >
                              {kwwReference}
                            </a>
                          ) : (
                            '-'
                          )}
                        </p>
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
              onChange={(e) => { setSaleOrRentFilter(e.target.value); setPage(1); setScopeActive(false); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">For Sale or Rent</option>
              <option value="For Sale">For Sale</option>
              <option value="Procurement Rental">Procurement Rental</option>
              <option value="Management Rental">Management Rental</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setScopeActive(false); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Draft">Draft</option>
            </select>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); setScopeActive(false); }}
              placeholder="Search agent, area, address, KWL number, P24 number, Private Property number..."
              className="md:col-span-4 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
            />
            <button type="button" className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700" onClick={() => void refetch()}>
              Search
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            <select value={propertyTypeFilter} onChange={(e) => { setPropertyTypeFilter(e.target.value); setPage(1); setScopeActive(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Property Type</option>
              {propertyTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>

            <select value={minPriceFilter} onChange={(e) => { setMinPriceFilter(e.target.value); setPage(1); setScopeActive(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Min Price</option>
              {priceOptions.map((v) => <option key={`min-${v}`} value={v}>{toMoney(v)}</option>)}
            </select>

            <select value={maxPriceFilter} onChange={(e) => { setMaxPriceFilter(e.target.value); setPage(1); setScopeActive(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Max Price</option>
              {priceOptions.map((v) => <option key={`max-${v}`} value={v}>{toMoney(v)}</option>)}
            </select>

            <select value={minBedroomsFilter} onChange={(e) => { setMinBedroomsFilter(e.target.value); setPage(1); setScopeActive(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">Bedrooms</option>
              {bedroomCountOptions.filter(Boolean).map((n) => <option key={`bed-${n}`} value={n}>{n}+</option>)}
            </select>

            <select value={minBathroomsFilter} onChange={(e) => { setMinBathroomsFilter(e.target.value); setPage(1); setScopeActive(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
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
                setScopeActive(true);
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
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={petFriendlyFilter} onChange={(e) => { setPetFriendlyFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Pet Friendly</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={poolFilter} onChange={(e) => { setPoolFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Pool</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={gardenFilter} onChange={(e) => { setGardenFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Garden</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={flatletFilter} onChange={(e) => { setFlatletFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Flatlet</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={retirementFilter} onChange={(e) => { setRetirementFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Retirement</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={onShowFilter} onChange={(e) => { setOnShowFilter(e.target.checked); setPage(1); setScopeActive(false); }} />On Show</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={auctionFilter} onChange={(e) => { setAuctionFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Auction</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={securityEstateFilter} onChange={(e) => { setSecurityEstateFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Security Estate / Cluster</label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={repossessedFilter} onChange={(e) => { setRepossessedFilter(e.target.checked); setPage(1); setScopeActive(false); }} />Repossessed</label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-3">
              {scopeActive && (isAgent || isOfficeAdmin) && (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {isAgent ? 'My listings' : `${activeContext?.marketCenter ?? 'My MC'} listings`}
                  {' · '}
                  <button type="button" className="underline" onClick={() => setScopeActive(false)}>Show all</button>
                </span>
              )}
              <span>{data?.total ?? 0} listings</span>
            </div>
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
              const images = (item.image_urls ?? []).map(normalizeRenderableImageUrl);
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
                        <div className="flex items-center gap-2">
                          {(item.can_edit ?? canEditListing(item.source_market_center_id, item.primary_agent_email)) && (
                            <button className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50" type="button" onClick={(e) => { e.stopPropagation(); void openEditForm(item); }}>Edit</button>
                          )}
                        </div>
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
                    ) : (item.feed_to_private_property || (item.private_property_sync_status ?? '').toLowerCase().startsWith('active')) ? (
                      <span className="text-amber-600 font-medium">PP Pending</span>
                    ) : (
                      <span>PP -</span>
                    )}
                    {' | '}
                    {buildKwwUrl(item.kww_reference_id) ? (
                      <a
                        href={buildKwwUrl(item.kww_reference_id) ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-red-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        KWW {item.kww_reference_id}
                      </a>
                    ) : (
                      <span>KWW -</span>
                    )}
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
                  const images = (item.image_urls ?? []).map(normalizeRenderableImageUrl);
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
                            ) : (item.feed_to_private_property || (item.private_property_sync_status ?? '').toLowerCase().startsWith('active')) ? (
                              <span className="text-amber-600 font-medium">Pending</span>
                            ) : (
                              '-'
                            )}
                          </div>
                          <div>
                            KWW:{' '}
                            {buildKwwUrl(item.kww_reference_id) ? (
                              <a
                                href={buildKwwUrl(item.kww_reference_id) ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-red-700 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.kww_reference_id}
                              </a>
                            ) : (
                              '-'
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {(item.can_edit ?? canEditListing(item.source_market_center_id, item.primary_agent_email)) && (
                            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={(e) => { e.stopPropagation(); void openEditForm(item); }}>Edit</button>
                          )}
                        </div>
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

