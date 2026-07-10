import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import type { CSSProperties } from 'react';

interface AgentProfile {
  agentName: string;
  agentEmail: string;
  agentPhone: string;
  agentTitle: string;
  marketCentre: string;
  logoUrl: string | null;
}

interface CmaHistoryItem {
  id: number;
  property_address: string | null;
  seller_name: string | null;
  seller_first_name: string | null;
  seller_last_name: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  loom_file_url: string | null;
  loom_original_name: string | null;
  file_name: string;
  file_url: string;
  created_at: string;
}

interface MarketingFormState {
  sellerName: string;
  sellerSurname: string;
  sellerEmail: string;
  sellerPhone: string;
  propertyAddress: string;
  suburbArea: string;
  customPromptInput: string;
}

const EMPTY_FORM: MarketingFormState = {
  sellerName: '',
  sellerSurname: '',
  sellerEmail: '',
  sellerPhone: '',
  propertyAddress: '',
  suburbArea: '',
  customPromptInput: '',
};

// ---- Icon Helper ------------------------------------------------------------------

function UiIcon({
  kind,
  className = 'h-4 w-4',
  style,
}: {
  kind: 'user' | 'file-search' | 'contact' | 'home' | 'sparkles' | 'check' | 'chevron-right';
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
  if (kind === 'file-search') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 2v7h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="m14 19 2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

export default function MarketingPlanGeneratorPage() {
  const { token, activeContext } = useAuth();

  const [form, setForm] = useState<MarketingFormState>(EMPTY_FORM);
  const [agentForm, setAgentForm] = useState({ agentName: '', agencyBrand: '', agentPhone: '', agentEmail: '' });

  const [selectedCmaId, setSelectedCmaId] = useState<string>('');
  const [selectedCmaItem, setSelectedCmaItem] = useState<CmaHistoryItem | null>(null);
  const [loomFile, setLoomFile] = useState<File | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loomFileRef = useRef<HTMLInputElement>(null);

  const authHeaders = {
    Authorization: `Bearer ${token ?? ''}`,
    'X-Active-Context': activeContext?.id ?? '',
  };

  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['marketing-profile', token],
    queryFn: async () => {
      const res = await fetch('/api/marketing/profile', { headers: authHeaders });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Failed to load agent profile.');
      }
      return (await res.json()) as { profile: AgentProfile; partial: boolean };
    },
    enabled: Boolean(token),
  });

  const { data: cmaHistoryData, isLoading: cmaHistoryLoading } = useQuery({
    queryKey: ['marketing-cma-history', token],
    queryFn: async () => {
      const res = await fetch('/api/marketing/cma-history', { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load CMA history.');
      return (await res.json() as { items: CmaHistoryItem[] }).items;
    },
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (!profileData) return;
    const p = profileData.profile;
    setAgentForm({
      agentName: p.agentName ?? '',
      agencyBrand: p.marketCentre ?? '',
      agentPhone: p.agentPhone ?? '',
      agentEmail: p.agentEmail ?? '',
    });
  }, [profileData]);

  function handleFieldChange(field: keyof MarketingFormState, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
    setGenError(null);
    setSuccessMsg(null);
  }

  function handleCmaSelect(cmaId: string, items: CmaHistoryItem[]): void {
    setSelectedCmaId(cmaId);
    setGenError(null);
    setSuccessMsg(null);

    if (!cmaId) {
      setSelectedCmaItem(null);
      return;
    }

    const item = items.find((i) => String(i.id) === cmaId) ?? null;
    setSelectedCmaItem(item);

    if (item) {
      // Auto-populate seller details and address from the selected CMA
      setForm((prev) => ({
        ...prev,
        propertyAddress: item.property_address ?? prev.propertyAddress,
        suburbArea: prev.suburbArea, // keep existing unless blank
        sellerName: item.seller_first_name ?? prev.sellerName,
        sellerSurname: item.seller_last_name ?? prev.sellerSurname,
        sellerEmail: item.seller_email ?? prev.sellerEmail,
        sellerPhone: item.seller_phone ?? prev.sellerPhone,
      }));
    }
  }

  function handleLoomFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    setLoomFile(file);
    setGenError(null);
  }

  async function handleGenerate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setGenError(null);
    setSuccessMsg(null);

    if (!selectedCmaId) {
      setGenError('Please select a CMA from the dropdown.');
      return;
    }
    if (!loomFile && !selectedCmaItem?.loom_file_url) {
      setGenError('No LOOM report found for the selected CMA. Please upload the LOOM report PDF.');
      return;
    }
    if (!form.propertyAddress.trim()) {
      setGenError('Property address is required.');
      return;
    }

    setGenerating(true);
    try {
      const fd = new FormData();
      if (loomFile) fd.append('loomReport', loomFile);
      fd.append('selectedCmaId', selectedCmaId);

      Object.entries(form).forEach(([key, val]) => fd.append(key, val));
      Object.entries(agentForm).forEach(([key, val]) => fd.append(key, val));

      const res = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          'X-Active-Context': activeContext?.id ?? '',
        },
        body: fd,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; requestId?: string; stage?: string };
        const parts = [err.error ?? 'Marketing plan generation failed.'];
        if (err.stage) parts.push(`Stage: ${err.stage}`);
        if (err.requestId) parts.push(`Ref: ${err.requestId}`);
        throw new Error(parts.join(' '));
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') ?? '';
      const fileNameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const downloadName = fileNameMatch?.[1] ?? 'Marketing_Plan.docx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(url);

      setSuccessMsg(`Marketing plan generated: ${downloadName}`);
    } catch (err) {
      setGenError((err as Error).message ?? 'An unexpected error occurred.');
    } finally {
      setGenerating(false);
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  // Determine current step based on form completion
  const currentStep = (() => {
    if (!agentForm.agentName) return 1;
    if (!selectedCmaId) return 2;
    if (!loomFile && !selectedCmaItem?.loom_file_url) return 3;
    if (!form.propertyAddress) return 4;
    return 5;
  })();

  const marketingSteps = ['Agent Details', 'Select CMA', 'Upload LOOM Report', 'Confirm Details', 'Generate Marketing Plan'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Marketing Plan Generator</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Select a CMA, upload the LOOM report, then generate a structured seller-facing marketing plan.
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} totalSteps={5} steps={marketingSteps} />

      {/* What This Creates Card */}
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)' }}>
        <div className="flex gap-3">
          <div style={{ color: 'var(--brand)' }}>
            <UiIcon kind="sparkles" className="h-5 w-5 flex-shrink-0" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>What This Creates</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              A seller-facing marketing plan document based on the CMA you selected and LOOM report. Includes valuation context, comparable properties, and marketing recommendations — ready to email or print.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void handleGenerate(e)} className="space-y-6">
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UiIcon kind="user" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--brand)' }}>
              Agent Details
            </h2>
          </div>
          {profileLoading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading profile...</p>}
          {profileError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Could not auto-fill profile. Please complete manually.
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Agent Name" value={agentForm.agentName} onChange={(v) => setAgentForm((p) => ({ ...p, agentName: v }))} />
            <FormField label="Agency / Brand" value={agentForm.agencyBrand} onChange={(v) => setAgentForm((p) => ({ ...p, agencyBrand: v }))} />
            <FormField label="Agent Phone" value={agentForm.agentPhone} onChange={(v) => setAgentForm((p) => ({ ...p, agentPhone: v }))} />
            <FormField label="Agent Email" value={agentForm.agentEmail} onChange={(v) => setAgentForm((p) => ({ ...p, agentEmail: v }))} />
          </div>
        </div>

        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UiIcon kind="file-search" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--brand)' }}>
              Select Property
            </h2>
          </div>
          <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Select the property CMA you generated. Seller details, address, and LOOM report will be auto-populated.
          </p>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Select CMA *
              </label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                value={selectedCmaId}
                onChange={(e) => handleCmaSelect(e.target.value, cmaHistoryData ?? [])}
                disabled={cmaHistoryLoading}
              >
                <option value="">-- Select a property from your CMA history --</option>
                {(cmaHistoryData ?? []).map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.property_address ?? 'No address'}{item.seller_name ? ` — ${item.seller_name}` : ''} ({formatDate(item.created_at)})
                  </option>
                ))}
              </select>
            </div>

            {/* LOOM status / override */}
            {selectedCmaItem && (
              <div
                className="rounded-lg border px-3 py-2 text-xs"
                style={
                  selectedCmaItem.loom_file_url
                    ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--brand-strong)' }
                    : { borderColor: '#f59e0b', background: '#fffbeb', color: '#92400e' }
                }
              >
                {selectedCmaItem.loom_file_url ? (
                  <>
                    <span className="font-semibold">LOOM report loaded:</span>{' '}
                    {selectedCmaItem.loom_original_name ?? 'Saved LOOM report'}
                  </>
                ) : (
                  <>
                    <span className="font-semibold">No LOOM saved for this CMA.</span>{' '}
                    Please upload the LOOM report below.
                  </>
                )}
              </div>
            )}

            {/* Show LOOM upload when: no CMA selected, OR selected CMA has no LOOM */}
            {(!selectedCmaItem || !selectedCmaItem.loom_file_url) && (
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {selectedCmaItem ? 'Upload LOOM Report (PDF) *' : 'Upload LOOM Report (PDF or DOCX)'}
                </label>
                <input
                  ref={loomFileRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleLoomFileChange}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
            )}

            {/* Optional LOOM override when CMA has a stored LOOM */}
            {selectedCmaItem?.loom_file_url && (
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Override LOOM Report (optional — leave blank to use saved)
                </label>
                <input
                  ref={loomFileRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleLoomFileChange}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <UiIcon kind="contact" className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--brand)' }}>
              Seller and Property Details
            </h2>
          </div>
          <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Auto-populated from the selected CMA. You can edit if needed.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Seller First Name" value={form.sellerName} onChange={(v) => handleFieldChange('sellerName', v)} />
            <FormField label="Seller Surname" value={form.sellerSurname} onChange={(v) => handleFieldChange('sellerSurname', v)} />
            <FormField label="Seller Email" type="email" value={form.sellerEmail} onChange={(v) => handleFieldChange('sellerEmail', v)} />
            <FormField label="Seller Phone" value={form.sellerPhone} onChange={(v) => handleFieldChange('sellerPhone', v)} />

            <FormField label="Property Address *" value={form.propertyAddress} onChange={(v) => handleFieldChange('propertyAddress', v)} />
            <FormField label="Suburb / Area" value={form.suburbArea} onChange={(v) => handleFieldChange('suburbArea', v)} />

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Additional AI Prompt Input
              </label>
              <textarea
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                rows={5}
                value={form.customPromptInput}
                onChange={(e) => handleFieldChange('customPromptInput', e.target.value)}
                placeholder="Optional instructions to refine output while keeping the standard section structure."
              />
            </div>
          </div>
        </div>

        {genError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {genError}
          </div>
        )}

        {successMsg && (
          <div className="rounded-lg border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--brand-strong)' }}>
            {successMsg}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button type="submit" disabled={generating || profileLoading} className="primary-btn inline-flex items-center gap-2 disabled:opacity-60">
            {generating ? (
              <>
                <Spinner />
                <span>Generating Marketing Plan…</span>
              </>
            ) : (
              <>
                <UiIcon kind="sparkles" className="h-4 w-4" />
                <span>Generate Marketing Plan</span>
              </>
            )}
          </button>
        </div>

        {generating && (
          <div className="rounded-lg border px-4 py-3 text-xs flex items-start gap-2" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)', color: 'var(--text-muted)' }}>
            <div className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8v0" opacity="0.75" />
              </svg>
            </div>
            <p>Combining CMA data and LOOM report into marketing plan — typically takes 2–3 minutes…</p>
          </div>
        )}
      </form>

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
