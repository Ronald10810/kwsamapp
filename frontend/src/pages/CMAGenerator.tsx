import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import type { CSSProperties } from 'react';

// ---- Types ------------------------------------------------------------------

interface OptionsData {
  provinces: string[];
  cities: string[];
  suburbs: string[];
  city_by_province: Record<string, string[]>;
  suburb_by_city: Record<string, string[]>;
  suburb_by_province: Record<string, string[]>;
}

const SOUTH_AFRICA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
];

interface AgentProfile {
  agentName: string;
  agentEmail: string;
  agentPhone: string;
  agentTitle: string;
  marketCentre: string;
  logoUrl: string | null;
}

interface FormState {
  unitComplex: string;
  streetNumber: string;
  streetName: string;
  suburb: string;
  city: string;
  province: string;
  propertyType: string;
  bedrooms: string;
  bathrooms: string;
  parking: string;
  specialFeatures: string;
  sellerName: string;
  sellerSurname: string;
  sellerEmail: string;
  sellerPhone: string;
}

const EMPTY_FORM: FormState = {
  unitComplex: '',
  streetNumber: '',
  streetName: '',
  suburb: '',
  city: '',
  province: '',
  propertyType: '',
  bedrooms: '',
  bathrooms: '',
  parking: '',
  specialFeatures: '',
  sellerName: '',
  sellerSurname: '',
  sellerEmail: '',
  sellerPhone: '',
};

const PROPERTY_TYPES = [
  'House',
  'Apartment / Flat',
  'Townhouse',
  'Duet',
  'Cluster Home',
  'Estate Home',
  'Retirement Living',
  'Smallholding',
  'Farm',
  'Vacant Land',
  'Commercial',
  'Industrial',
];

function ensurePropertyTypes(baseTypes: string[]): string[] {
  const types = [...baseTypes];

  if (!types.includes('Duet')) {
    const townhouseIndex = types.indexOf('Townhouse');
    if (townhouseIndex >= 0) {
      types.splice(townhouseIndex + 1, 0, 'Duet');
    } else {
      types.push('Duet');
    }
  }

  if (!types.includes('Retirement Living')) {
    const estateIndex = types.indexOf('Estate Home');
    if (estateIndex >= 0) {
      types.splice(estateIndex + 1, 0, 'Retirement Living');
    } else {
      types.push('Retirement Living');
    }
  }

  return types;
}

// ---- Icon Helper ------------------------------------------------------------------

function UiIcon({
  kind,
  className = 'h-4 w-4',
  style,
}: {
  kind: 'user' | 'contact' | 'home' | 'file-upload' | 'sparkles' | 'check' | 'chevron-right';
  className?: string;
  style?: CSSProperties;
}) {
  if (kind === 'user') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'contact') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3 21c0-3 2-5 9-5s9 2 9 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'home') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="M3 10l9-7 9 7v11c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 21v-7h6v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'file-upload') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="M12 3v12M7 8l5-5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 19h16c1.1 0 2 .9 2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'sparkles') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="M12 2L9.5 8h-7l5.5 4-2 6.5L12 14l5 6.5-2-6.5 5.5-4h-7L12 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'chevron-right') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

// ---- Step Indicator Component ------------------------------------------------------------------

function StepIndicator({
  currentStep,
  totalSteps,
  steps,
}: {
  currentStep: number;
  totalSteps: number;
  steps: string[];
}) {
  return (
    <div className="mb-6 rounded-lg border px-5 py-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)' }}>
      <div className="flex items-center justify-between text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
        <span>Setup Guide</span>
        <span style={{ color: 'var(--brand)' }}>Step {currentStep} of {totalSteps}</span>
      </div>
      <div className="flex items-center gap-1">
        {steps.map((_, idx) => (
          <div key={idx} className="flex items-center gap-1 flex-1">
            <div
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                idx + 1 < currentStep
                  ? 'bg-emerald-100 text-emerald-700'
                  : idx + 1 === currentStep
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {idx + 1 < currentStep ? <UiIcon kind="check" className="h-3 w-3" /> : idx + 1}
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-1 mx-0.5 ${idx < currentStep ? 'bg-emerald-100' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {steps[currentStep - 1]}
      </p>
    </div>
  );
}

// ---- Component --------------------------------------------------------------

export default function CMAGenerator() {
  const { token, activeContext } = useAuth();
  const propertyTypeOptions = ensurePropertyTypes(PROPERTY_TYPES);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [agentForm, setAgentForm] = useState({ agentName: '', agentTitle: '', marketCentre: '', agentPhone: '', agentEmail: '' });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [profilePartial, setProfilePartial] = useState(false);
  const [loomFile, setLoomFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = {
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  };

  // Load listings options for province/city/suburb dropdowns
  const { data: options } = useQuery({
    queryKey: ['listings-options'],
    queryFn: async () => {
      const res = await fetch('/api/listings/options', { headers: authHeaders });
      if (!res.ok) return null;
      return (await res.json()) as OptionsData;
    },
    staleTime: 10 * 60 * 1000,
    enabled: Boolean(token),
  });

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

  const provinceOptions = useMemo(() => {
    const list = options?.provinces && options.provinces.length > 0
      ? options.provinces
      : SOUTH_AFRICA_PROVINCES;
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  }, [options]);

  const cityOptions = useMemo(
    () => Array.from(new Set(filteredCities)).sort((a, b) => a.localeCompare(b)),
    [filteredCities]
  );

  const suburbOptions = useMemo(
    () => Array.from(new Set(filteredSuburbs)).sort((a, b) => a.localeCompare(b)),
    [filteredSuburbs]
  );
  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['cma-profile', token],
    queryFn: async () => {
      const res = await fetch('/api/cma/profile', { headers: authHeaders });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to load agent profile.');
      }
      return await res.json() as { profile: AgentProfile; partial: boolean };
    },
    enabled: Boolean(token),
  });

  // Populate agent fields when profile loads
  useEffect(() => {
    if (!profileData) return;
    const p = profileData.profile;
    setAgentForm({
      agentName: p.agentName ?? '',
      agentTitle: p.agentTitle ?? '',
      marketCentre: p.marketCentre ?? '',
      agentPhone: p.agentPhone ?? '',
      agentEmail: p.agentEmail ?? '',
    });
    setLogoUrl(p.logoUrl ?? null);
    setProfilePartial(profileData.partial);
  }, [profileData]);

  function handleFieldChange(field: keyof FormState, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
    setGenError(null);
    setSuccessMsg(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    setLoomFile(file);
    setGenError(null);
  }

  async function handleGenerate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setGenError(null);
    setSuccessMsg(null);

    if (!loomFile) {
      setGenError('Please upload the Loom property report PDF before generating.');
      return;
    }
    if (!form.streetName.trim() || !form.suburb.trim()) {
      setGenError('Street name and suburb are required.');
      return;
    }
    if (!form.sellerName.trim()) {
      setGenError('Seller first name is required.');
      return;
    }

    setGenerating(true);
    try {
      const fd = new FormData();
      fd.append('loomReport', loomFile);
      // Build full address from structured fields
      const streetLine = [form.streetNumber, form.streetName].filter(Boolean).join(' ');
      const propertyAddress = [form.unitComplex || null, streetLine || null, form.suburb || null, form.city || null, form.province || null].filter(Boolean).join(', ');
      fd.append('propertyAddress', propertyAddress);
      fd.append('propertyType', form.propertyType);
      fd.append('bedrooms', form.bedrooms);
      fd.append('bathrooms', form.bathrooms);
      fd.append('parking', form.parking);
      fd.append('specialFeatures', form.specialFeatures);
      fd.append('sellerName', form.sellerName);
      fd.append('sellerSurname', form.sellerSurname);
      fd.append('sellerEmail', form.sellerEmail);
      fd.append('sellerPhone', form.sellerPhone);
      // Agent fields (editable, may override DB values)
      Object.entries(agentForm).forEach(([key, val]) => fd.append(key, val));

      const res = await fetch('/api/cma/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          'X-Active-Context': activeContext?.id ?? '',
        },
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'CMA generation failed.');
      }

      // Trigger file download
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') ?? '';
      const fileNameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const downloadName = fileNameMatch?.[1] ?? 'kwsa-cma.docx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(url);

      setSuccessMsg(`CMA generated: ${downloadName}`);
      setForm(EMPTY_FORM);
      // Keep agent form fields — only clear seller/property
      setLoomFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setGenError((err as Error).message ?? 'An unexpected error occurred.');
    } finally {
      setGenerating(false);
    }
  }

  const profile = profileData?.profile ?? null;

  // Determine current step based on form completion
  const currentStep = useMemo(() => {
    if (!agentForm.agentName && !profileData) return 1;
    if (!form.sellerName) return 2;
    if (!form.streetName || !form.suburb) return 3;
    if (!loomFile) return 4;
    return 5;
  }, [agentForm.agentName, profileData, form.sellerName, form.streetName, form.suburb, loomFile]);

  const cmaSteps = ['Prepared By', 'Seller Details', 'Property Details', 'LOOM Report', 'Generate CMA'];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="page-title">CMA Generator</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Generate a professional Comparative Market Analysis using AI, LOOM reports, and KW market data.
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} totalSteps={5} steps={cmaSteps} />

      {/* What This Creates Card */}
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)' }}>
        <div className="flex gap-3">
          <div style={{ color: 'var(--brand)' }}>
            <UiIcon kind="sparkles" className="h-5 w-5 flex-shrink-0" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>What This Creates</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              A professional Comparative Market Analysis document using the property details, LOOM report inputs, and live KW market listings. Seller-ready and ready to print or email.
            </p>
          </div>
        </div>
      </div>

      {/* Agent profile banner */}
      <div className="surface-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <UiIcon kind="user" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
          <h2
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--brand)' }}
          >
            Prepared By — Auto-filled from Your Profile
          </h2>
        </div>

        {profileLoading && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading profile…
          </p>
        )}

        {profileError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <strong>Profile not found in system</strong> — your details were not matched to an associate record.
            Please fill in your agent details manually below.
          </div>
        )}

        {profilePartial && !profileError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Some details could not be auto-filled from your profile. Please complete the fields below.
          </div>
        )}

        {profile && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AgentFormField label="Agent Name" value={agentForm.agentName} onChange={(v) => setAgentForm(p => ({ ...p, agentName: v }))} />
            <AgentFormField label="Title / Designation" value={agentForm.agentTitle} onChange={(v) => setAgentForm(p => ({ ...p, agentTitle: v }))} placeholder="e.g. Agent, Lead Agent, Operating Partner" />
            <AgentFormField label="Phone" value={agentForm.agentPhone} onChange={(v) => setAgentForm(p => ({ ...p, agentPhone: v }))} />
            <AgentFormField label="Email" value={agentForm.agentEmail} onChange={(v) => setAgentForm(p => ({ ...p, agentEmail: v }))} />
            <div className="sm:col-span-2">
              <AgentFormField label="Market Centre" value={agentForm.marketCentre} onChange={(v) => setAgentForm(p => ({ ...p, marketCentre: v }))} />
            </div>
            {logoUrl && (
              <div className="sm:col-span-2 flex items-center gap-3">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>MC Logo (from profile)</span>
                <img src={logoUrl} alt="Market Centre Logo" className="h-10 object-contain" />
              </div>
            )}
          </div>
        )}

        {!profile && !profileLoading && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AgentFormField label="Agent Name" value={agentForm.agentName} onChange={(v) => setAgentForm(p => ({ ...p, agentName: v }))} />
            <AgentFormField label="Title / Designation" value={agentForm.agentTitle} onChange={(v) => setAgentForm(p => ({ ...p, agentTitle: v }))} placeholder="e.g. Agent, Lead Agent, Operating Partner" />
            <AgentFormField label="Phone" value={agentForm.agentPhone} onChange={(v) => setAgentForm(p => ({ ...p, agentPhone: v }))} />
            <AgentFormField label="Email" value={agentForm.agentEmail} onChange={(v) => setAgentForm(p => ({ ...p, agentEmail: v }))} />
            <div className="sm:col-span-2">
              <AgentFormField label="Market Centre" value={agentForm.marketCentre} onChange={(v) => setAgentForm(p => ({ ...p, marketCentre: v }))} />
            </div>
          </div>
        )}
      </div>

      {/* Generation form */}
      <form onSubmit={(e) => void handleGenerate(e)} className="space-y-6">
        {/* Seller details */}
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UiIcon kind="contact" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--brand)' }}
            >
              Seller Details
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="First Name *"
              value={form.sellerName}
              onChange={(v) => handleFieldChange('sellerName', v)}
              placeholder="e.g. James"
            />
            <FormField
              label="Last Name"
              value={form.sellerSurname}
              onChange={(v) => handleFieldChange('sellerSurname', v)}
              placeholder="e.g. Smith"
            />
            <FormField
              label="Email"
              type="email"
              value={form.sellerEmail}
              onChange={(v) => handleFieldChange('sellerEmail', v)}
              placeholder="seller@email.com"
            />
            <FormField
              label="Phone"
              type="tel"
              value={form.sellerPhone}
              onChange={(v) => handleFieldChange('sellerPhone', v)}
              placeholder="+27 82 000 0000"
            />
          </div>
        </div>

        {/* Property details */}
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UiIcon kind="home" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--brand)' }}
            >
              Property Details
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Province — searchable datalist */}
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Province *
              </label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                list="cma-province-options"
                value={form.province}
                placeholder="Search or select province"
                autoComplete="new-password"
                onChange={(e) => {
                  handleFieldChange('province', e.target.value);
                  setForm((p) => ({ ...p, province: e.target.value, city: '', suburb: '' }));
                }}
              />
              <datalist id="cma-province-options">
                {provinceOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>

            {/* City — filtered by province */}
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                City
              </label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                list="cma-city-options"
                value={form.city}
                placeholder={form.province ? 'Search cities' : 'Select province first'}
                autoComplete="new-password"
                onChange={(e) => {
                  setForm((p) => ({ ...p, city: e.target.value, suburb: '' }));
                  setGenError(null);
                }}
              />
              <datalist id="cma-city-options">
                {cityOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>

            {/* Suburb — filtered by city / province */}
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Suburb *
              </label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                list="cma-suburb-options"
                value={form.suburb}
                placeholder={form.city || form.province ? 'Search suburbs' : 'Select province first'}
                autoComplete="new-password"
                onChange={(e) => handleFieldChange('suburb', e.target.value)}
              />
              <datalist id="cma-suburb-options">
                {suburbOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>

            {/* Street Number */}
            <FormField
              label="Street Number"
              value={form.streetNumber}
              onChange={(v) => handleFieldChange('streetNumber', v)}
              placeholder="e.g. 510"
            />

            {/* Street Name */}
            <div className="sm:col-span-2">
              <FormField
                label="Street Name *"
                value={form.streetName}
                onChange={(v) => handleFieldChange('streetName', v)}
                placeholder="e.g. Alandale Street"
              />
            </div>

            {/* Unit / Complex (optional) */}
            <div className="sm:col-span-2">
              <FormField
                label="Unit / Complex Name (optional)"
                value={form.unitComplex}
                onChange={(v) => handleFieldChange('unitComplex', v)}
                placeholder="e.g. Unit 65 Die Meent — leave blank if not a unit/complex"
              />
            </div>

            {/* Full Address — auto-built, read-only preview sent to the LLM */}
            {(() => {
              const streetLine = [form.streetNumber, form.streetName].filter(Boolean).join(' ');
              const fullAddress = [form.unitComplex || null, streetLine || null, form.suburb || null, form.city || null, form.province || null].filter(Boolean).join(', ');
              return fullAddress ? (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Full Address <span className="ml-1 text-[10px] font-normal opacity-60">(auto-built — sent to AI)</span>
                  </label>
                  <div
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--brand-strong)' }}
                  >
                    {fullAddress}
                  </div>
                </div>
              ) : null;
            })()}

            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Property Type
              </label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  borderColor: 'var(--border-soft)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  // @ts-expect-error custom property
                  '--tw-ring-color': 'var(--brand)',
                }}
                value={form.propertyType}
                onChange={(e) => handleFieldChange('propertyType', e.target.value)}
              >
                <option value="">Select type…</option>
                {propertyTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <FormField
              label="Bedrooms"
              value={form.bedrooms}
              onChange={(v) => handleFieldChange('bedrooms', v)}
              placeholder="e.g. 3"
            />
            <FormField
              label="Bathrooms"
              value={form.bathrooms}
              onChange={(v) => handleFieldChange('bathrooms', v)}
              placeholder="e.g. 2"
            />
            <FormField
              label="Garages / Parking"
              value={form.parking}
              onChange={(v) => handleFieldChange('parking', v)}
              placeholder="e.g. 2 garages"
            />
            <div className="sm:col-span-2">
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Special Features
              </label>
              <textarea
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                rows={3}
                placeholder="e.g. Pool, solar, fibre, security estate, inverter…"
                value={form.specialFeatures}
                onChange={(e) => handleFieldChange('specialFeatures', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Loom report upload */}
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <UiIcon kind="file-upload" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--brand)' }}
            >
              LOOM Property Report *
            </h2>
          </div>
          <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            Upload the PDF export of the LOOM property report. The AI uses this to extract
            property details, valuation trends, and comparable sales context.
          </p>

          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-all"
            style={{
              borderColor: loomFile ? 'var(--brand)' : 'var(--border-soft)',
              background: loomFile ? 'var(--brand-soft)' : 'var(--surface-strong)',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            {loomFile ? (
              <>
                <div style={{ color: 'var(--brand)' }}>
                  <UiIcon kind="check" className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'var(--brand)' }}>
                    {loomFile.name}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {(loomFile.size / 1024 / 1024).toFixed(1)} MB — click to replace
                  </p>
                </div>
              </>
            ) : (
              <>
                <div style={{ color: 'var(--text-muted)' }}>
                  <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 3v12M7 8l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 20h18" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Drag and drop PDF here, or click to upload
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    PDF only — max 50 MB
                  </p>
                </div>
              </>
            )}
          </label>
        </div>

        {/* Error / Success feedback */}
        {genError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {genError}
          </div>
        )}
        {successMsg && (
          <div
            className="rounded-lg border px-4 py-3 text-sm font-medium"
            style={{
              borderColor: 'var(--brand)',
              background: 'var(--brand-soft)',
              color: 'var(--brand-strong)',
            }}
          >
            {successMsg} — your download started automatically.
          </div>
        )}

        {/* Generate button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={generating || profileLoading}
            className="primary-btn inline-flex items-center gap-2 disabled:opacity-60"
          >
            {generating ? (
              <>
                <Spinner />
                <span>Generating CMA…</span>
              </>
            ) : (
              <>
                <UiIcon kind="sparkles" className="h-4 w-4" />
                <span>Generate CMA Document</span>
              </>
            )}
          </button>
          {generating && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Reading LOOM report and searching listings — this takes 60–90 seconds…
            </p>
          )}
        </div>
      </form>

      {/* Info Footer */}
      <div className="rounded-lg border px-4 py-3 text-xs flex items-start gap-2" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)', color: 'var(--text-muted)' }}>
        <div className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p>Generation may take a few minutes. Please keep this page open. Your document will download automatically when ready.</p>
      </div>
    </div>
  );
}

// ---- Sub-components ---------------------------------------------------------

function AgentFormField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          {label}
        </label>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          <UiIcon kind="check" className="h-2.5 w-2.5" />
          auto-filled
        </span>
      </div>
      <input
        type="text"
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <input
        type={type}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
        style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
