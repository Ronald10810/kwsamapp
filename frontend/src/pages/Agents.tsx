import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type AgentRow = {
  id: string;
  source_associate_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status_name: string | null;
  kwuid: string | null;
  source_market_center_id: string | null;
  source_team_id: string | null;
  market_center_name: string | null;
  market_center_logo_url: string | null;
  active_listing_count: number;
  registered_transaction_count: number;
  image_url: string | null;
  mobile_number: string | null;
  updated_at: string;
};

type AgentsResponse = {
  total: number;
  limit: number;
  offset: number;
  items: AgentRow[];
};

type NoteRecord = {
  note_type: string;
  note_text: string;
  created_by: string | null;
  created_at: string;
};

type DocumentRecord = {
  document_type: string;
  document_name: string | null;
  document_url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

type AssociateDetailsResponse = {
  social_media?: Array<{ platform: string | null; url: string | null }>;
  roles?: string[];
  job_titles?: string[];
  service_communities?: string[];
  admin_market_centers?: string[];
  admin_teams?: string[];
  documents?: DocumentRecord[];
  commission_notes?: NoteRecord[];
  date_notes?: NoteRecord[];
  document_notes?: NoteRecord[];
  [key: string]: unknown;
};

type SocialMediaItem = {
  platform: string;
  url: string;
};

type DocumentItem = {
  document_type: string;
  document_name: string;
  document_url: string;
};

type AgentFormState = {
  source_associate_id: string;
  status_name: string;
  national_id: string;
  first_name: string;
  last_name: string;
  ffc_number: string;
  kwsa_email: string;
  private_email: string;
  mobile_number: string;
  office_number: string;
  image_url: string;
  social_media: SocialMediaItem[];
  source_market_center_id: string;
  source_team_id: string;
  growth_share_sponsor: string;
  temporary_growth_share_sponsor: string;
  kwuid: string;
  proposed_growth_share_sponsor: string;
  vested: boolean;
  vesting_period_start_date: string;
  listing_approval_required: boolean;
  exclude_from_individual_reports: boolean;
  roles: string[];
  job_titles: string[];
  service_communities: string[];
  admin_market_centers: string[];
  admin_teams: string[];
  property24_opt_in: boolean;
  agent_property24_id: string;
  property24_status: string;
  entegral_opt_in: boolean;
  agent_entegral_id: string;
  entegral_status: string;
  private_property_opt_in: boolean;
  private_property_status: string;
  cap: string;
  manual_cap: boolean;
  agent_split: string;
  projected_cos: string;
  projected_cap: string;
  commission_notes: string[];
  start_date: string;
  end_date: string;
  anniversary_date: string;
  cap_date: string;
  date_notes: string[];
  documents: DocumentItem[];
  document_notes: string[];
};

type ViewMode = 'card' | 'list';
type AssociateSection = 'personal' | 'kw' | 'commission' | 'dates' | 'documents';

type MarketCenterOption = {
  source_market_center_id: string;
  name: string;
};

type TeamOption = {
  source_team_id: string;
  name: string;
};

const PAGE_SIZE = 20;
const CARD_PAGE_SIZE = 24;

const ROLE_OPTIONS = ['Agent', 'Office Admin', 'Regional Admin'];
const JOB_TITLE_OPTIONS = [
  'Agent',
  'Assistant MCA',
  'Assistant TL',
  'Director of First Impressions',
  'Lead Agent',
  'Market Centre Administrator',
  'MCTT',
  'Operating Partner',
  'Productivity Coach',
  'Rental Agent',
  'Team Admin',
  'Team Agent',
  'Team Leader',
];
const COMMUNITY_OPTIONS = ['Agent', 'ALC', 'DEI', 'Luxury', 'Rainbow', 'RALC', 'YP'];
const DOCUMENT_TYPE_OPTIONS = ['ID Document', 'BSA Document', 'FFC Document', 'Employment Contract'];

function normalizeAgentStatus(value: string | null): 'Active' | 'Inactive' | 'Unknown' {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === '1' || normalized === 'active') return 'Active';
  if (normalized === '2' || normalized === 'inactive') return 'Inactive';
  return 'Unknown';
}

function agentInitials(name: string | null, first: string | null, last: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  }
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';
}

function agentDisplayName(row: AgentRow): string {
  if (row.full_name?.trim()) return row.full_name.trim();
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown';
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-800',
  Inactive: 'bg-slate-100 text-slate-600',
};

function emptyForm(): AgentFormState {
  return {
    source_associate_id: '',
    status_name: 'Active',
    national_id: '',
    first_name: '',
    last_name: '',
    ffc_number: '',
    kwsa_email: '',
    private_email: '',
    mobile_number: '',
    office_number: '',
    image_url: '',
    social_media: [{ platform: '', url: '' }],
    source_market_center_id: '',
    source_team_id: '',
    growth_share_sponsor: '',
    temporary_growth_share_sponsor: '',
    kwuid: '',
    proposed_growth_share_sponsor: '',
    vested: false,
    vesting_period_start_date: '',
    listing_approval_required: false,
    exclude_from_individual_reports: false,
    roles: [],
    job_titles: [],
    service_communities: [],
    admin_market_centers: [],
    admin_teams: [],
    property24_opt_in: false,
    agent_property24_id: '',
    property24_status: '',
    entegral_opt_in: false,
    agent_entegral_id: '',
    entegral_status: '',
    private_property_opt_in: false,
    private_property_status: '',
    cap: '',
    manual_cap: false,
    agent_split: '',
    projected_cos: '',
    projected_cap: '',
    commission_notes: [],
    start_date: '',
    end_date: '',
    anniversary_date: '',
    cap_date: '',
    date_notes: [],
    documents: DOCUMENT_TYPE_OPTIONS.map((documentType) => ({
      document_type: documentType,
      document_name: '',
      document_url: '',
    })),
    document_notes: [],
  };
}

function AgentAvatar({ imageUrl, name, first, last }: { imageUrl: string | null; name: string | null; first: string | null; last: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = agentInitials(name, first, last);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  if (imageUrl && !imgFailed) {
    return (
      <img
        src={imageUrl}
        alt={agentDisplayName({ full_name: name, first_name: first, last_name: last } as AgentRow)}
        className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const hash = initials.charCodeAt(0) % 6;
  const colors = ['bg-red-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-cyan-500'];
  return (
    <div className={`h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-lg shadow ring-2 ring-white ${colors[hash]}`}>
      {initials}
    </div>
  );
}

function toInputDate(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function toggleArrayValue(current: string[], value: string): string[] {
  if (current.includes(value)) {
    return current.filter((item) => item !== value);
  }
  return [...current, value];
}

export default function AgentsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Inactive'>('Active');
  const [view, setView] = useState<ViewMode>('card');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<AssociateSection>('personal');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(emptyForm());
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreviewUrl, setPendingImagePreviewUrl] = useState<string | null>(null);

  const pageSize = view === 'card' ? CARD_PAGE_SIZE : PAGE_SIZE;

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['agents', page, search, view, statusFilter],
    queryFn: () => {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      params.set('status', statusFilter);
      return fetch(`/api/agents?${params.toString()}`).then(async (r) => {
        if (!r.ok) throw new Error('Unable to load agents');
        return r.json() as Promise<AgentsResponse>;
      });
    },
    placeholderData: (prev) => prev,
  });

  const { data: marketCenterData } = useQuery({
    queryKey: ['market-center-options-for-associates'],
    queryFn: () =>
      fetch('/api/market-centers?limit=250&offset=0&status=Active').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load market center options');
        return r.json() as Promise<{ items: MarketCenterOption[] }>;
      }),
  });

  // Team options placeholder — teams are edited via source IDs for now
  const _unusedTeamQuery = { data: { items: [] as TeamOption[] } };
  void _unusedTeamQuery;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / pageSize)), [data?.total, pageSize]);
  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((item) => normalizeAgentStatus(item.status_name) === statusFilter);
  }, [data?.items, statusFilter]);

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  useEffect(() => {
    return () => {
      if (pendingImagePreviewUrl) {
        URL.revokeObjectURL(pendingImagePreviewUrl);
      }
    };
  }, [pendingImagePreviewUrl]);

  function openCreateForm(): void {
    if (pendingImagePreviewUrl) {
      URL.revokeObjectURL(pendingImagePreviewUrl);
    }
    setPendingImagePreviewUrl(null);
    setPendingImageFile(null);
    setIsImageUploading(false);
    setEditingId(null);
    setFormError(null);
    setActiveSection('personal');
    setForm(emptyForm());
    setIsFormOpen(true);
  }

  async function openEditForm(item: AgentRow): Promise<void> {
    if (pendingImagePreviewUrl) {
      URL.revokeObjectURL(pendingImagePreviewUrl);
    }
    setPendingImagePreviewUrl(null);
    setPendingImageFile(null);
    setIsImageUploading(false);
    setEditingId(item.id);
    setFormError(null);
    setIsLoadingDetails(true);
    setActiveSection('personal');
    setForm(emptyForm());
    setIsFormOpen(true);

    try {
      const response = await fetch(`/api/agents/${item.id}/details`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Unable to load associate details');
      }

      const details = (await response.json()) as AssociateDetailsResponse;
      setForm((prev) => ({
        ...prev,
        source_associate_id: (details.source_associate_id as string | undefined) ?? item.source_associate_id,
        status_name: (details.status_name as string | undefined) ?? item.status_name ?? 'Active',
        national_id: (details.national_id as string | undefined) ?? '',
        first_name: (details.first_name as string | undefined) ?? item.first_name ?? '',
        last_name: (details.last_name as string | undefined) ?? item.last_name ?? '',
        ffc_number: (details.ffc_number as string | undefined) ?? '',
        kwsa_email: (details.kwsa_email as string | undefined) ?? item.email ?? '',
        private_email: (details.private_email as string | undefined) ?? '',
        mobile_number: (details.mobile_number as string | undefined) ?? item.mobile_number ?? '',
        office_number: (details.office_number as string | undefined) ?? '',
        image_url: (details.image_url as string | undefined) ?? item.image_url ?? '',
        social_media:
          details.social_media && details.social_media.length > 0
            ? details.social_media.map((entry) => ({
                platform: entry.platform ?? '',
                url: entry.url ?? '',
              }))
            : [{ platform: '', url: '' }],
        source_market_center_id: (details.source_market_center_id as string | undefined) ?? item.source_market_center_id ?? '',
        source_team_id: (details.source_team_id as string | undefined) ?? item.source_team_id ?? '',
        growth_share_sponsor: (details.growth_share_sponsor as string | undefined) ?? '',
        temporary_growth_share_sponsor: (details.temporary_growth_share_sponsor as string | undefined) ?? '',
        kwuid: (details.kwuid as string | undefined) ?? item.kwuid ?? '',
        proposed_growth_share_sponsor: (details.proposed_growth_share_sponsor as string | undefined) ?? '',
        vested: Boolean(details.vested),
        vesting_period_start_date: toInputDate(details.vesting_period_start_date),
        listing_approval_required: Boolean(details.listing_approval_required),
        exclude_from_individual_reports: Boolean(details.exclude_from_individual_reports),
        roles: details.roles ?? [],
        job_titles: details.job_titles ?? [],
        service_communities: details.service_communities ?? [],
        admin_market_centers: details.admin_market_centers ?? [],
        admin_teams: details.admin_teams ?? [],
        property24_opt_in: Boolean(details.property24_opt_in),
        agent_property24_id: (details.agent_property24_id as string | undefined) ?? '',
        property24_status: (details.property24_status as string | undefined) ?? '',
        entegral_opt_in: Boolean(details.entegral_opt_in),
        agent_entegral_id: (details.agent_entegral_id as string | undefined) ?? '',
        entegral_status: (details.entegral_status as string | undefined) ?? '',
        private_property_opt_in: Boolean(details.private_property_opt_in),
        private_property_status: (details.private_property_status as string | undefined) ?? '',
        cap: (details.cap as string | undefined) ?? '',
        manual_cap: Number((details.manual_cap as string | number | undefined) ?? 0) > 0,
        agent_split: (details.agent_split as string | undefined) ?? '',
        projected_cos: (details.projected_cos as string | undefined) ?? '',
        projected_cap: (details.projected_cap as string | undefined) ?? '',
        start_date: toInputDate(details.start_date),
        end_date: toInputDate(details.end_date),
        anniversary_date: toInputDate(details.anniversary_date),
        cap_date: toInputDate(details.cap_date),
        documents:
          details.documents && details.documents.length > 0
            ? details.documents.map((doc) => ({
                document_type: doc.document_type,
                document_name: doc.document_name ?? '',
                document_url: doc.document_url ?? '',
              }))
            : prev.documents,
        commission_notes: details.commission_notes?.map((note) => note.note_text) ?? [],
        date_notes: details.date_notes?.map((note) => note.note_text) ?? [],
        document_notes: details.document_notes?.map((note) => note.note_text) ?? [],
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to load associate details');
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function uploadImageForAssociate(associateId: string, file: File): Promise<string> {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`/api/agents/${associateId}/upload-image`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? 'Failed to upload image');
    }

    const data = (await response.json()) as { image_url: string };
    return data.image_url;
  }

  async function handleImageUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setFormError(null);
    if (pendingImagePreviewUrl) {
      URL.revokeObjectURL(pendingImagePreviewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingImageFile(file);
    setPendingImagePreviewUrl(previewUrl);

    // Upload happens on Save for both create and edit to keep one consistent flow.
    // We keep the persisted image_url unchanged until upload succeeds.
    return;
  }

  async function handleDocumentUpload(index: number, file: File | undefined): Promise<void> {
    if (!file) return;
    if (!editingId) {
      setFormError('Please save the associate first before uploading documents');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('document_type', form.documents[index].document_type);

      const response = await fetch(`/api/agents/${editingId}/upload-document`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Failed to upload document');
      }

      const data = (await response.json()) as { document_url: string };
      setForm((p) => ({
        ...p,
        documents: p.documents.map((doc, i) =>
          i === index ? { ...doc, document_url: data.document_url, document_name: file.name } : doc
        ),
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to upload document');
    }
  }

  async function saveAgent(): Promise<void> {
    if (isImageUploading) {
      setFormError('Please wait for the image upload to finish before saving.');
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/agents/${editingId}` : '/api/agents';
      const safeImageUrl = form.image_url.startsWith('blob:') ? '' : form.image_url;
      const payload = {
        ...form,
        image_url: safeImageUrl,
        full_name: [form.first_name, form.last_name].filter(Boolean).join(' ').trim(),
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? 'Failed to save associate');
      }

      const result = (await response.json().catch(() => ({}))) as { id?: string };
      const persistedId = editingId ?? result.id;

      if (pendingImageFile && persistedId) {
        try {
          setIsImageUploading(true);
          const uploadedUrl = await uploadImageForAssociate(persistedId, pendingImageFile);
          setForm((p) => ({ ...p, image_url: uploadedUrl }));
          setPendingImageFile(null);
          if (pendingImagePreviewUrl) {
            URL.revokeObjectURL(pendingImagePreviewUrl);
            setPendingImagePreviewUrl(null);
          }
        } catch (error) {
          setEditingId(persistedId);
          setFormError(
            error instanceof Error
              ? `Associate saved, but image upload failed: ${error.message}`
              : 'Associate saved, but image upload failed.'
          );
          await refetch();
          return;
        } finally {
          setIsImageUploading(false);
        }
      }

      setIsFormOpen(false);
      await refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save associate');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Associates</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {isLoading ? 'Loading...' : `${(data?.total ?? 0).toLocaleString()} associates in migration database`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => {
                setView('card');
                setPage(1);
              }}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === 'card' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => {
                setView('list');
                setPage(1);
              }}
              className={`px-3 py-1.5 flex items-center gap-1.5 border-l border-slate-300 ${view === 'list' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              List
            </button>
          </div>
          <button className="primary-btn" type="button" onClick={() => refetch()}>
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="primary-btn" type="button" onClick={openCreateForm}>
            Add Associate
          </button>
        </div>
      </div>

      <div className="surface-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, KWUID or market center..."
            className="w-full md:max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'Active' | 'Inactive');
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
        </div>
      </div>

      {isError && <div className="surface-card p-6 text-center text-amber-700">Could not load associates.</div>}

      {view === 'card' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="surface-card p-5 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                </div>
              ))
            : filteredItems.map((item) => {
                const name = agentDisplayName(item);
                const statusLabel = item.status_name ?? 'Unknown';
                const statusClass = STATUS_COLORS[statusLabel] ?? 'bg-slate-100 text-slate-600';
                return (
                  <div key={item.id} className="surface-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
                    <div className="mb-1 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {item.market_center_logo_url ? (
                          <img
                            src={item.market_center_logo_url}
                            alt={`${item.market_center_name ?? 'Market Centre'} logo`}
                            className="h-7 w-7 rounded-md border border-slate-200 bg-white object-contain p-1"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-md border border-slate-200 bg-white text-center text-[10px] font-semibold leading-7 text-slate-500">MC</div>
                        )}
                        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-600">{item.market_center_name ?? item.source_market_center_id ?? 'Unassigned'}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
                    </div>

                    <div className="flex items-start gap-3">
                      <AgentAvatar imageUrl={item.image_url} name={item.full_name} first={item.first_name} last={item.last_name} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate leading-snug">{name}</p>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <p>{item.email ?? '-'}</p>
                      <p>{item.mobile_number ?? '-'}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Active Listings</p>
                        <p className="mt-0.5 text-base font-semibold text-slate-900">{item.active_listing_count ?? 0}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Registered Deals</p>
                        <p className="mt-0.5 text-base font-semibold text-slate-900">{item.registered_transaction_count ?? 0}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <p className="text-[11px] text-slate-400 font-mono">{item.kwuid ? `KWUID: ${item.kwuid}` : ''}</p>
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => void openEditForm(item)}>
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>
      )}

      {view === 'list' && (
        <section className="surface-card p-0 overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Associate</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">KWUID</th>
                  <th className="px-4 py-3">Market Center</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                {filteredItems.map((item) => {
                  const statusLabel = item.status_name ?? 'Unknown';
                  const statusClass = STATUS_COLORS[statusLabel] ?? 'bg-slate-100 text-slate-600';
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{agentDisplayName(item)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.email ?? '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.mobile_number ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.kwuid ?? '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.market_center_name ?? item.source_market_center_id ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => void openEditForm(item)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {data ? `Showing ${data.offset + 1}-${Math.min(data.offset + data.items.length, data.total)} of ${data.total.toLocaleString()}` : ''}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
            type="button"
            onClick={() => setPage((p) => p - 1)}
            disabled={!canGoPrev}
          >
            Previous
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50"
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!canGoNext}
          >
            Next
          </button>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Associate Workspace</p>
                <h2 className="text-2xl font-semibold text-slate-900">
                  {editingId ? `${form.first_name || ''} ${form.last_name || ''}`.trim() || 'Edit Associate' : 'New Associate'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" type="button" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </button>
                <button className="primary-btn" type="button" onClick={() => void saveAgent()} disabled={isSaving || isLoadingDetails || isImageUploading}>
                  {isImageUploading ? 'Uploading image...' : isSaving ? 'Saving...' : 'Save Associate'}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <aside className="w-64 border-r border-slate-200 bg-slate-50 p-3 space-y-2">
                {[
                  ['personal', 'Personal Details'],
                  ['kw', 'KW Details'],
                  ['commission', 'Commission'],
                  ['dates', 'Dates'],
                  ['documents', 'Documents'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveSection(key as AssociateSection)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${
                      activeSection === key ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </aside>

              <div className="flex-1 overflow-auto p-6 space-y-6">
                {isLoadingDetails && <p className="text-sm text-slate-500">Loading associate details...</p>}
                {formError && <p className="text-sm text-amber-700">{formError}</p>}

                {activeSection === 'personal' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Personal Details</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Associate Status</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.status_name} onChange={(e) => setForm((p) => ({ ...p, status_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">National ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.national_id} onChange={(e) => setForm((p) => ({ ...p, national_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">First Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Last Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">FFC Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.ffc_number} onChange={(e) => setForm((p) => ({ ...p, ffc_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">KWSA Email</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.kwsa_email} onChange={(e) => setForm((p) => ({ ...p, kwsa_email: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Private Email</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.private_email} onChange={(e) => setForm((p) => ({ ...p, private_email: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Mobile Number (xxxxxxxxxx)</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. 0658339187" value={form.mobile_number} onChange={(e) => setForm((p) => ({ ...p, mobile_number: e.target.value.replace(/\s/g, '') }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Office Number (xxxxxxxxxx)</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. 0123451414" value={form.office_number} onChange={(e) => setForm((p) => ({ ...p, office_number: e.target.value.replace(/\s/g, '') }))} /></label>
                      <div className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-xs text-slate-600">Associate Image</span>
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <input
                              type="file"
                              accept="image/*"
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-full"
                              onChange={(e) => void handleImageUpload(e.currentTarget.files?.[0])
                              }
                            />
                          </div>
                          {(pendingImagePreviewUrl || form.image_url) && (
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                              onClick={() => {
                                if (pendingImagePreviewUrl) {
                                  URL.revokeObjectURL(pendingImagePreviewUrl);
                                  setPendingImagePreviewUrl(null);
                                }
                                setPendingImageFile(null);
                                setForm((p) => ({ ...p, image_url: '' }));
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {(pendingImagePreviewUrl || form.image_url) && (
                          <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 w-32">
                            <img
                              src={pendingImagePreviewUrl ?? form.image_url}
                              alt="Associate"
                              className="w-full h-32 object-cover"
                              onError={() => {
                                if (pendingImagePreviewUrl) {
                                  URL.revokeObjectURL(pendingImagePreviewUrl);
                                  setPendingImagePreviewUrl(null);
                                  setPendingImageFile(null);
                                } else {
                                  setForm((p) => ({ ...p, image_url: '' }));
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900">Social Media</p>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                          onClick={() => setForm((p) => ({ ...p, social_media: [...p.social_media, { platform: '', url: '' }] }))}
                        >
                          Add Entry
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {form.social_media.map((row, index) => (
                          <div key={index} className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2">
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Platform" value={row.platform} onChange={(e) => setForm((p) => ({ ...p, social_media: p.social_media.map((item, i) => i === index ? { ...item, platform: e.target.value } : item) }))} />
                            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Profile URL" value={row.url} onChange={(e) => setForm((p) => ({ ...p, social_media: p.social_media.map((item, i) => i === index ? { ...item, url: e.target.value } : item) }))} />
                            <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, social_media: p.social_media.filter((_, i) => i !== index) }))}>Remove</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {activeSection === 'kw' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">KW Details</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Market Center</span><select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.source_market_center_id} onChange={(e) => setForm((p) => ({ ...p, source_market_center_id: e.target.value }))}><option value="">Select</option>{(marketCenterData?.items ?? []).map((mc) => <option key={mc.source_market_center_id} value={mc.source_market_center_id}>{mc.name}</option>)}</select></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Team</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.source_team_id} onChange={(e) => setForm((p) => ({ ...p, source_team_id: e.target.value }))} placeholder="Team source id" /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Growth Share Sponsor</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.growth_share_sponsor} onChange={(e) => setForm((p) => ({ ...p, growth_share_sponsor: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Temporary Growth Share Sponsor</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.temporary_growth_share_sponsor} onChange={(e) => setForm((p) => ({ ...p, temporary_growth_share_sponsor: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">KWUID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.kwuid} onChange={(e) => setForm((p) => ({ ...p, kwuid: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Proposed Growth Share Sponsor</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.proposed_growth_share_sponsor} onChange={(e) => setForm((p) => ({ ...p, proposed_growth_share_sponsor: e.target.value }))} /></label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.vested} onChange={(e) => setForm((p) => ({ ...p, vested: e.target.checked }))} />Vested</label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.listing_approval_required} onChange={(e) => setForm((p) => ({ ...p, listing_approval_required: e.target.checked }))} />Listing Approval Required</label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.exclude_from_individual_reports} onChange={(e) => setForm((p) => ({ ...p, exclude_from_individual_reports: e.target.checked }))} />Exclude From Individual Reports</label>
                    </div>

                    <label className="flex flex-col gap-1 max-w-xs"><span className="text-xs text-slate-600">Vesting Period Start Date</span><input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.vesting_period_start_date} onChange={(e) => setForm((p) => ({ ...p, vesting_period_start_date: e.target.value }))} /></label>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900 mb-2">Roles</p><div className="flex flex-wrap gap-2">{ROLE_OPTIONS.map((option) => <button key={option} type="button" className={`rounded-full px-3 py-1 text-xs border ${form.roles.includes(option) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setForm((p) => ({ ...p, roles: toggleArrayValue(p.roles, option) }))}>{option}</button>)}</div></div>
                      <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900 mb-2">Job Titles</p><div className="flex flex-wrap gap-2">{JOB_TITLE_OPTIONS.map((option) => <button key={option} type="button" className={`rounded-full px-3 py-1 text-xs border ${form.job_titles.includes(option) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setForm((p) => ({ ...p, job_titles: toggleArrayValue(p.job_titles, option) }))}>{option}</button>)}</div></div>
                      <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900 mb-2">Service Communities</p><div className="flex flex-wrap gap-2">{COMMUNITY_OPTIONS.map((option) => <button key={option} type="button" className={`rounded-full px-3 py-1 text-xs border ${form.service_communities.includes(option) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setForm((p) => ({ ...p, service_communities: toggleArrayValue(p.service_communities, option) }))}>{option}</button>)}</div></div>
                      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 mb-2">Admin Market Centers</p>
                          <div className="flex flex-wrap gap-2">{(marketCenterData?.items ?? []).map((mc) => <button key={mc.source_market_center_id} type="button" className={`rounded-full px-3 py-1 text-xs border ${form.admin_market_centers.includes(mc.source_market_center_id) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setForm((p) => ({ ...p, admin_market_centers: toggleArrayValue(p.admin_market_centers, mc.source_market_center_id) }))}>{mc.name}</button>)}</div>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 mb-2">Admin Teams (Source IDs)</p>
                          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Comma separated team source ids" value={form.admin_teams.join(', ')} onChange={(e) => setForm((p) => ({ ...p, admin_teams: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) }))} />
                          <p className="mt-1 text-xs text-slate-500">Team lookups are not wired yet, so this uses source IDs for now.</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-900 mb-3">Third Party Integrations</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.property24_opt_in} onChange={(e) => setForm((p) => ({ ...p, property24_opt_in: e.target.checked }))} />Property24 Opt In</label>
                        <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Agent Property24 ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.agent_property24_id} onChange={(e) => setForm((p) => ({ ...p, agent_property24_id: e.target.value }))} /></label>
                        <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Property24 Status</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.property24_status} onChange={(e) => setForm((p) => ({ ...p, property24_status: e.target.value }))} /></label>
                        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.entegral_opt_in} onChange={(e) => setForm((p) => ({ ...p, entegral_opt_in: e.target.checked }))} />Entergal Opt In</label>
                        <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Agent Entergal ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.agent_entegral_id} onChange={(e) => setForm((p) => ({ ...p, agent_entegral_id: e.target.value }))} /></label>
                        <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Entergal Status</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.entegral_status} onChange={(e) => setForm((p) => ({ ...p, entegral_status: e.target.value }))} /></label>
                        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.private_property_opt_in} onChange={(e) => setForm((p) => ({ ...p, private_property_opt_in: e.target.checked }))} />Private Property Opt In</label>
                        <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Private Property Status</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.private_property_status} onChange={(e) => setForm((p) => ({ ...p, private_property_status: e.target.value }))} /></label>
                      </div>
                    </div>
                  </section>
                )}

                {activeSection === 'commission' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Commission</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Total Cap Amount</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.cap} onChange={(e) => setForm((p) => ({ ...p, cap: e.target.value }))} /></label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm self-end"><input type="checkbox" checked={form.manual_cap} onChange={(e) => setForm((p) => ({ ...p, manual_cap: e.target.checked }))} />Manual Cap Override</label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Agent Split %</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.agent_split} onChange={(e) => setForm((p) => ({ ...p, agent_split: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Projected CO$</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.projected_cos} onChange={(e) => setForm((p) => ({ ...p, projected_cos: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Projected Cap</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.projected_cap} onChange={(e) => setForm((p) => ({ ...p, projected_cap: e.target.value }))} /></label>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Commission Notes</p><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, commission_notes: [...p.commission_notes, ''] }))}>Add Note</button></div>
                      <div className="mt-3 space-y-2">{form.commission_notes.map((note, index) => <div key={index} className="flex gap-2"><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={note} onChange={(e) => setForm((p) => ({ ...p, commission_notes: p.commission_notes.map((item, i) => i === index ? e.target.value : item) }))} /><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, commission_notes: p.commission_notes.filter((_, i) => i !== index) }))}>Remove</button></div>)}</div>
                    </div>
                  </section>
                )}

                {activeSection === 'dates' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Dates</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Start Date</span><input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">End Date</span><input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Anniversary Date</span><input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.anniversary_date} onChange={(e) => setForm((p) => ({ ...p, anniversary_date: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Cap Date</span><input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.cap_date} onChange={(e) => setForm((p) => ({ ...p, cap_date: e.target.value }))} /></label>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Date Notes</p><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, date_notes: [...p.date_notes, ''] }))}>Add Note</button></div>
                      <div className="mt-3 space-y-2">{form.date_notes.map((note, index) => <div key={index} className="flex gap-2"><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={note} onChange={(e) => setForm((p) => ({ ...p, date_notes: p.date_notes.map((item, i) => i === index ? e.target.value : item) }))} /><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, date_notes: p.date_notes.filter((_, i) => i !== index) }))}>Remove</button></div>)}</div>
                    </div>
                  </section>
                )}

                {activeSection === 'documents' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Documents</h3>
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Document Type</th>
                            <th className="px-3 py-2">Document Name</th>
                            <th className="px-3 py-2">Document URL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {form.documents.map((doc, index) => (
                            <tr key={`${doc.document_type}-${index}`}>
                              <td className="px-3 py-2">
                                <select className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={doc.document_type} onChange={(e) => setForm((p) => ({ ...p, documents: p.documents.map((item, i) => i === index ? { ...item, document_type: e.target.value } : item) }))}>
                                  {DOCUMENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2"><input className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="e.g. Contract 2024" value={doc.document_name} onChange={(e) => setForm((p) => ({ ...p, documents: p.documents.map((item, i) => i === index ? { ...item, document_name: e.target.value } : item) }))} /></td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1 items-center">
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="text-sm"
                                    onChange={(e) => void handleDocumentUpload(index, e.currentTarget.files?.[0])
                                    }
                                  />
                                  {doc.document_url && (
                                    <a
                                      href={doc.document_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline text-xs"
                                    >
                                      View
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Document Notes</p><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, document_notes: [...p.document_notes, ''] }))}>Add Note</button></div>
                      <div className="mt-3 space-y-2">{form.document_notes.map((note, index) => <div key={index} className="flex gap-2"><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={note} onChange={(e) => setForm((p) => ({ ...p, document_notes: p.document_notes.map((item, i) => i === index ? e.target.value : item) }))} /><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((p) => ({ ...p, document_notes: p.document_notes.filter((_, i) => i !== index) }))}>Remove</button></div>)}</div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
