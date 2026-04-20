import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type MarketCentreRow = {
  id: string;
  source_market_center_id: string;
  name: string;
  status_name: string | null;
  company_registered_name: string | null;
  frontdoor_id: string | null;
  contact_number: string | null;
  contact_email: string | null;
  kw_office_id: string | null;
  city: string | null;
  logo_image_url: string | null;
  market_center_property24_id: string | null;
  property24_opt_in: boolean;
  agent_count: string;
  team_count: string;
  updated_at: string;
};

type MarketCentresResponse = {
  total: number;
  limit: number;
  offset: number;
  items: MarketCentreRow[];
};

type NoteRecord = {
  note_text: string;
  created_by: string | null;
  created_at: string;
};

type TeamSummary = {
  id: string;
  source_team_id: string;
  name: string;
  status_name: string | null;
  agent_count: string;
};

type AgentSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  image_url: string | null;
  status_name: string | null;
  team_name: string | null;
};

type MarketCentreDetailsResponse = {
  id: string;
  source_market_center_id: string;
  name: string;
  status_name: string | null;
  company_registered_name: string | null;
  kw_office_id: string | null;
  frontdoor_id: string | null;
  contact_number: string | null;
  contact_email: string | null;
  has_individual_cap: boolean;
  agent_default_cap: string | null;
  market_center_default_split: string | null;
  agent_default_split: string | null;
  productivity_coach: string | null;
  property24_opt_in: boolean;
  property24_auction_approved: boolean;
  market_center_property24_id: string | null;
  private_property_id: string | null;
  entegral_opt_in: boolean;
  entegral_url: string | null;
  entegral_portals: string[];
  logo_image_url: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  suburb: string | null;
  erf_number: string | null;
  unit_number: string | null;
  door_number: string | null;
  estate_name: string | null;
  street_number: string | null;
  street_name: string | null;
  postal_code: string | null;
  longitude: string | null;
  latitude: string | null;
  override_display_location: boolean;
  display_longitude: string | null;
  display_latitude: string | null;
  notes: NoteRecord[];
  teams: TeamSummary[];
  agents: AgentSummary[];
};

type MarketCentreFormState = {
  source_market_center_id: string;
  name: string;
  status_name: string;
  company_registered_name: string;
  kw_office_id: string;
  frontdoor_id: string;
  contact_number: string;
  contact_email: string;
  has_individual_cap: boolean;
  agent_default_cap: string;
  market_center_default_split: string;
  agent_default_split: string;
  productivity_coach: string;
  property24_opt_in: boolean;
  property24_auction_approved: boolean;
  market_center_property24_id: string;
  private_property_id: string;
  entegral_opt_in: boolean;
  entegral_url: string;
  entegral_portals: string[];
  logo_image_url: string;
  country: string;
  province: string;
  city: string;
  suburb: string;
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
  display_longitude: string;
  display_latitude: string;
  notes: string[];
};

type ViewMode = 'card' | 'list';
type MarketCentreSection = 'details' | 'integrations' | 'address' | 'notes' | 'relations';

const PAGE_SIZE = 20;

const ENTEGRAL_PORTAL_OPTIONS = [
  'Bid-or-Buy',
  'Entegral Flex Websites',
  'Gumtree',
  'ImmoAfrica',
  'MyProperty South Africa',
  'MyProperty Namibia',
  'IOL Property (Property360)',
  'Private Property',
  'Namibia bundle includes HouseFinder',
  'South Africa bundle includes Ananzi',
  'Property Central',
  'Property House',
  'Property Matcher',
  'Includes GotProperty (JunkMail) and Locanto (PriceCheck removed)',
  'Flow',
  'Qwengo',
];

const SECTION_OPTIONS: Array<{ key: MarketCentreSection; label: string }> = [
  { key: 'details', label: 'Market Centre Details' },
  { key: 'integrations', label: 'Third Party' },
  { key: 'address', label: 'Address' },
  { key: 'notes', label: 'Notes' },
  { key: 'relations', label: 'Teams and Agents' },
];

function decodeStatus(raw: string | null): string {
  if (raw === '1' || raw?.toLowerCase() === 'active') return 'Active';
  if (raw === '2' || raw?.toLowerCase() === 'inactive') return 'Inactive';
  return raw ?? 'Unknown';
}

function mcInitial(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? 'K';
}

const MC_BG_PALETTE = [
  'bg-red-600', 'bg-rose-600', 'bg-sky-600', 'bg-violet-600',
  'bg-amber-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-pink-600',
];

function mcColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return MC_BG_PALETTE[Math.abs(hash) % MC_BG_PALETTE.length];
}

function emptyForm(): MarketCentreFormState {
  return {
    source_market_center_id: '',
    name: '',
    status_name: 'Active',
    company_registered_name: '',
    kw_office_id: '',
    frontdoor_id: '',
    contact_number: '',
    contact_email: '',
    has_individual_cap: false,
    agent_default_cap: '',
    market_center_default_split: '',
    agent_default_split: '',
    productivity_coach: '',
    property24_opt_in: false,
    property24_auction_approved: false,
    market_center_property24_id: '',
    private_property_id: '',
    entegral_opt_in: false,
    entegral_url: '',
    entegral_portals: [],
    logo_image_url: '',
    country: '',
    province: '',
    city: '',
    suburb: '',
    erf_number: '',
    unit_number: '',
    door_number: '',
    estate_name: '',
    street_number: '',
    street_name: '',
    postal_code: '',
    longitude: '',
    latitude: '',
    override_display_location: false,
    display_longitude: '',
    display_latitude: '',
    notes: [],
  };
}

function toValue(value: string | null | undefined): string {
  return value ?? '';
}

function renderLogo(url: string | null | undefined, name: string): JSX.Element {
  const color = mcColor(name || 'Keller Williams');
  if (url) {
    return <img src={url} alt={name} className="h-14 w-14 rounded-xl object-cover shadow ring-2 ring-white" />;
  }

  return (
    <div className={`h-14 w-14 rounded-xl flex items-center justify-center text-white font-bold text-xl shrink-0 ${color}`}>
      {mcInitial(name || 'K')}
    </div>
  );
}

export default function MarketCentresPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Inactive'>('Active');
  const [view, setView] = useState<ViewMode>('card');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<MarketCentreSection>('details');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<MarketCentreFormState>(emptyForm());
  const [relatedTeams, setRelatedTeams] = useState<TeamSummary[]>([]);
  const [relatedAgents, setRelatedAgents] = useState<AgentSummary[]>([]);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [pendingLogoPreviewUrl, setPendingLogoPreviewUrl] = useState<string | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['market-centres', page, search, statusFilter],
    queryFn: () => {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      params.set('status', statusFilter);
      return fetch(`/api/market-centers?${params.toString()}`).then(async (r) => {
        if (!r.ok) throw new Error('Unable to load market centres');
        return r.json() as Promise<MarketCentresResponse>;
      });
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    return () => {
      if (pendingLogoPreviewUrl) {
        URL.revokeObjectURL(pendingLogoPreviewUrl);
      }
    };
  }, [pendingLogoPreviewUrl]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)), [data?.total]);
  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((item) => decodeStatus(item.status_name) === statusFilter);
  }, [data?.items, statusFilter]);
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  function resetEditor(): void {
    setEditingId(null);
    setActiveSection('details');
    setFormError(null);
    setForm(emptyForm());
    setRelatedTeams([]);
    setRelatedAgents([]);
    setIsLoadingDetails(false);
    setPendingLogoFile(null);
    if (pendingLogoPreviewUrl) {
      URL.revokeObjectURL(pendingLogoPreviewUrl);
      setPendingLogoPreviewUrl(null);
    }
  }

  function openCreateForm(): void {
    resetEditor();
    setIsFormOpen(true);
  }

  async function openEditForm(item: MarketCentreRow): Promise<void> {
    resetEditor();
    setEditingId(item.id);
    setActiveSection('details');
    setForm((prev) => ({
      ...prev,
      source_market_center_id: item.source_market_center_id,
      name: item.name,
      status_name: item.status_name ?? 'Active',
      company_registered_name: item.company_registered_name ?? '',
      kw_office_id: item.kw_office_id ?? '',
      frontdoor_id: item.frontdoor_id ?? '',
      contact_number: item.contact_number ?? '',
      contact_email: item.contact_email ?? '',
      logo_image_url: item.logo_image_url ?? '',
      city: item.city ?? '',
      market_center_property24_id: item.market_center_property24_id ?? '',
      property24_opt_in: Boolean(item.property24_opt_in),
    }));
    setIsFormOpen(true);
    setIsLoadingDetails(true);

    try {
      const response = await fetch(`/api/market-centers/${item.id}/details`);
      const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<MarketCentreDetailsResponse>;
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load market centre details');
      }

      const details = payload as MarketCentreDetailsResponse;
      setForm({
        source_market_center_id: details.source_market_center_id ?? item.source_market_center_id,
        name: details.name ?? item.name,
        status_name: details.status_name ?? item.status_name ?? 'Active',
        company_registered_name: toValue(details.company_registered_name),
        kw_office_id: toValue(details.kw_office_id),
        frontdoor_id: toValue(details.frontdoor_id),
        contact_number: toValue(details.contact_number),
        contact_email: toValue(details.contact_email),
        has_individual_cap: Boolean(details.has_individual_cap),
        agent_default_cap: toValue(details.agent_default_cap),
        market_center_default_split: toValue(details.market_center_default_split),
        agent_default_split: toValue(details.agent_default_split),
        productivity_coach: toValue(details.productivity_coach),
        property24_opt_in: Boolean(details.property24_opt_in),
        property24_auction_approved: Boolean(details.property24_auction_approved),
        market_center_property24_id: toValue(details.market_center_property24_id),
        private_property_id: toValue(details.private_property_id),
        entegral_opt_in: Boolean(details.entegral_opt_in),
        entegral_url: toValue(details.entegral_url),
        entegral_portals: details.entegral_portals ?? [],
        logo_image_url: toValue(details.logo_image_url),
        country: toValue(details.country),
        province: toValue(details.province),
        city: toValue(details.city),
        suburb: toValue(details.suburb),
        erf_number: toValue(details.erf_number),
        unit_number: toValue(details.unit_number),
        door_number: toValue(details.door_number),
        estate_name: toValue(details.estate_name),
        street_number: toValue(details.street_number),
        street_name: toValue(details.street_name),
        postal_code: toValue(details.postal_code),
        longitude: toValue(details.longitude),
        latitude: toValue(details.latitude),
        override_display_location: Boolean(details.override_display_location),
        display_longitude: toValue(details.display_longitude),
        display_latitude: toValue(details.display_latitude),
        notes: details.notes?.map((note) => note.note_text) ?? [],
      });
      setRelatedTeams(details.teams ?? []);
      setRelatedAgents(details.agents ?? []);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to load market centre details');
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function uploadLogo(marketCenterId: string, file: File): Promise<string> {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`/api/market-centers/${marketCenterId}/upload-logo`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? 'Failed to upload logo');
    }

    const result = (await response.json()) as { logo_image_url: string };
    return result.logo_image_url;
  }

  async function handleLogoSelection(file: File | undefined): Promise<void> {
    if (!file) return;
    setFormError(null);
    if (pendingLogoPreviewUrl) {
      URL.revokeObjectURL(pendingLogoPreviewUrl);
    }
    setPendingLogoFile(file);
    setPendingLogoPreviewUrl(URL.createObjectURL(file));
  }

  async function saveMarketCentre(): Promise<void> {
    setIsSaving(true);
    setFormError(null);

    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/market-centers/${editingId}` : '/api/market-centers';
      const safeLogoUrl = form.logo_image_url.startsWith('blob:') ? '' : form.logo_image_url;
      const payload = {
        ...form,
        logo_image_url: safeLogoUrl,
        notes: form.notes.map((note) => note.trim()).filter(Boolean),
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!response.ok) {
        throw new Error(result.error ?? 'Failed to save market centre');
      }

      const savedId = editingId ?? result.id;
      if (savedId && pendingLogoFile) {
        const logoImageUrl = await uploadLogo(savedId, pendingLogoFile);
        setForm((prev) => ({ ...prev, logo_image_url: logoImageUrl }));
        setPendingLogoFile(null);
        if (pendingLogoPreviewUrl) {
          URL.revokeObjectURL(pendingLogoPreviewUrl);
          setPendingLogoPreviewUrl(null);
        }
      }

      setIsFormOpen(false);
      await refetch();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save market centre');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Market Centres</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {isLoading ? 'Loading...' : `${(data?.total ?? 0).toLocaleString()} market centres in migration database`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button type="button" onClick={() => { setView('card'); setPage(1); }} className={`px-3 py-1.5 ${view === 'card' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Cards</button>
            <button type="button" onClick={() => { setView('list'); setPage(1); }} className={`px-3 py-1.5 border-l border-slate-300 ${view === 'list' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>List</button>
          </div>
          <button className="primary-btn" type="button" onClick={() => refetch()}>{isFetching ? 'Refreshing...' : 'Refresh'}</button>
          <button className="primary-btn" type="button" onClick={openCreateForm}>Add Market Centre</button>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Market Centre Workspace</p>
                <h2 className="text-2xl font-semibold text-slate-900">{editingId ? form.name || 'Edit Market Centre' : 'New Market Centre'}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" type="button" onClick={() => setIsFormOpen(false)}>Cancel</button>
                <button className="primary-btn" type="button" onClick={() => void saveMarketCentre()} disabled={isSaving || isLoadingDetails}>{isSaving ? 'Saving...' : 'Save Market Centre'}</button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <aside className="w-64 border-r border-slate-200 bg-slate-50 p-3 space-y-3 overflow-auto">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex justify-center">{renderLogo(pendingLogoPreviewUrl ?? form.logo_image_url, form.name || 'Market Centre')}</div>
                  <div className="mt-4 space-y-1 text-center">
                    <p className="font-semibold text-slate-900">{form.name || 'New Market Centre'}</p>
                    <p className="text-xs text-slate-500">{form.company_registered_name || 'No registered company name yet'}</p>
                  </div>
                  <div className="mt-4 space-y-1 text-xs text-slate-500">
                    <p>Source ID: {form.source_market_center_id || 'Generated on save if blank'}</p>
                    <p>KW Office ID: {form.kw_office_id || 'Not set'}</p>
                    <p>P24 ID: {form.market_center_property24_id || 'Not set'}</p>
                  </div>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Logo Image</span>
                    <input type="file" accept="image/*" className="block w-full text-xs" onChange={(e) => void handleLogoSelection(e.target.files?.[0])} />
                  </label>
                </div>

                {SECTION_OPTIONS.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${activeSection === section.key ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-white'}`}
                  >
                    {section.label}
                  </button>
                ))}

                <p className="text-xs text-slate-400">Teams and agents remain read-only here. Create and manage them from the Associates applet.</p>
              </aside>

              <div className="flex-1 overflow-auto p-6 space-y-6">
                {isLoadingDetails && <p className="text-sm text-slate-500">Loading market centre details...</p>}
                {formError && <p className="text-sm text-amber-700">{formError}</p>}

                {activeSection === 'details' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Market Centre Details</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Source ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.source_market_center_id} onChange={(e) => setForm((prev) => ({ ...prev, source_market_center_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Market Centre Status</span><select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={decodeStatus(form.status_name) === 'Inactive' ? 'Inactive' : 'Active'} onChange={(e) => setForm((prev) => ({ ...prev, status_name: e.target.value }))}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Company Registered Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.company_registered_name} onChange={(e) => setForm((prev) => ({ ...prev, company_registered_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">KW Office ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.kw_office_id} onChange={(e) => setForm((prev) => ({ ...prev, kw_office_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">FrontDoor ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.frontdoor_id} onChange={(e) => setForm((prev) => ({ ...prev, frontdoor_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Phone</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.contact_number} onChange={(e) => setForm((prev) => ({ ...prev, contact_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Email</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.contact_email} onChange={(e) => setForm((prev) => ({ ...prev, contact_email: e.target.value }))} /></label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.has_individual_cap} onChange={(e) => setForm((prev) => ({ ...prev, has_individual_cap: e.target.checked }))} />Has Individual Cap</label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Agent Default Cap</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.agent_default_cap} onChange={(e) => setForm((prev) => ({ ...prev, agent_default_cap: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Market Centre Default Split</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.market_center_default_split} onChange={(e) => setForm((prev) => ({ ...prev, market_center_default_split: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Agent Default Split</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.agent_default_split} onChange={(e) => setForm((prev) => ({ ...prev, agent_default_split: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Productivity Coach</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.productivity_coach} onChange={(e) => setForm((prev) => ({ ...prev, productivity_coach: e.target.value }))} /></label>
                    </div>
                  </section>
                )}

                {activeSection === 'integrations' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Third Party Integration Details</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.property24_opt_in} onChange={(e) => setForm((prev) => ({ ...prev, property24_opt_in: e.target.checked }))} />Property24 Opt In</label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.property24_auction_approved} onChange={(e) => setForm((prev) => ({ ...prev, property24_auction_approved: e.target.checked }))} />Property24 Auction Approved</label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.entegral_opt_in} onChange={(e) => setForm((prev) => ({ ...prev, entegral_opt_in: e.target.checked }))} />Entegral Opt In</label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">MC Property24 ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.market_center_property24_id} onChange={(e) => setForm((prev) => ({ ...prev, market_center_property24_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Private Property ID</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.private_property_id} onChange={(e) => setForm((prev) => ({ ...prev, private_property_id: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Entegral URL</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.entegral_url} onChange={(e) => setForm((prev) => ({ ...prev, entegral_url: e.target.value }))} /></label>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-900 mb-3">Entegral Portals to Feed To</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {ENTEGRAL_PORTAL_OPTIONS.map((portal) => (
                          <label key={portal} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                            <input type="checkbox" checked={form.entegral_portals.includes(portal)} onChange={(e) => setForm((prev) => ({ ...prev, entegral_portals: e.target.checked ? [...prev.entegral_portals, portal] : prev.entegral_portals.filter((item) => item !== portal) }))} />
                            {portal}
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {activeSection === 'address' && (
                  <section className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">Address Details</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Country</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.country} onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Province</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.province} onChange={(e) => setForm((prev) => ({ ...prev, province: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">City</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Suburb</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.suburb} onChange={(e) => setForm((prev) => ({ ...prev, suburb: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Erf Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.erf_number} onChange={(e) => setForm((prev) => ({ ...prev, erf_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Unit Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.unit_number} onChange={(e) => setForm((prev) => ({ ...prev, unit_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Door Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.door_number} onChange={(e) => setForm((prev) => ({ ...prev, door_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Estate Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.estate_name} onChange={(e) => setForm((prev) => ({ ...prev, estate_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Street Number</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.street_number} onChange={(e) => setForm((prev) => ({ ...prev, street_number: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-1"><span className="text-xs text-slate-600">Street Name</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.street_name} onChange={(e) => setForm((prev) => ({ ...prev, street_name: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Postal Code</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.postal_code} onChange={(e) => setForm((prev) => ({ ...prev, postal_code: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Longitude</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.longitude} onChange={(e) => setForm((prev) => ({ ...prev, longitude: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Latitude</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.latitude} onChange={(e) => setForm((prev) => ({ ...prev, latitude: e.target.value }))} /></label>
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={form.override_display_location} onChange={(e) => setForm((prev) => ({ ...prev, override_display_location: e.target.checked }))} />Override Display Location</label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Display Longitude</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.display_longitude} onChange={(e) => setForm((prev) => ({ ...prev, display_longitude: e.target.value }))} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Display Latitude</span><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={form.display_latitude} onChange={(e) => setForm((prev) => ({ ...prev, display_latitude: e.target.value }))} /></label>
                    </div>
                  </section>
                )}

                {activeSection === 'notes' && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">Notes</h3>
                      <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((prev) => ({ ...prev, notes: [...prev.notes, ''] }))}>Add Note</button>
                    </div>
                    {form.notes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-400">No notes captured yet.</div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                        {form.notes.map((note, index) => (
                          <div key={index} className="flex gap-2">
                            <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={3} value={note} onChange={(e) => setForm((prev) => ({ ...prev, notes: prev.notes.map((item, idx) => idx === index ? e.target.value : item) }))} />
                            <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => setForm((prev) => ({ ...prev, notes: prev.notes.filter((_, idx) => idx !== index) }))}>Remove</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeSection === 'relations' && (
                  <section className="space-y-6">
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">Teams</h3>
                        <p className="text-xs text-slate-500">Read-only here. Teams must be created and maintained from the Associates applet.</p>
                      </div>
                      <div className="overflow-auto rounded-xl border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Team</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Active Agents</th><th className="px-4 py-3">Source ID</th></tr></thead>
                          <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                            {relatedTeams.length === 0 ? <tr><td className="px-4 py-6 text-slate-400" colSpan={4}>No teams linked to this market centre.</td></tr> : relatedTeams.map((team) => (
                              <tr key={team.id}><td className="px-4 py-3 font-medium">{team.name}</td><td className="px-4 py-3 text-slate-600">{decodeStatus(team.status_name)}</td><td className="px-4 py-3 text-slate-600">{team.agent_count}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{team.source_team_id}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">Agents</h3>
                        <p className="text-xs text-slate-500">Only active agents are shown here. Agent creation and maintenance stays in the Associates applet.</p>
                      </div>
                      <div className="overflow-auto rounded-xl border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Status</th></tr></thead>
                          <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                            {relatedAgents.length === 0 ? <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>No active agents linked to this market centre.</td></tr> : relatedAgents.map((agent) => (
                              <tr key={agent.id}>
                                <td className="px-4 py-3"><div className="flex items-center gap-2">{renderLogo(agent.image_url, agent.full_name ?? 'Agent')}<span className="font-medium">{agent.full_name ?? 'Unknown Agent'}</span></div></td>
                                <td className="px-4 py-3 text-slate-600">{agent.team_name ?? '-'}</td>
                                <td className="px-4 py-3 text-slate-600">{agent.email ?? '-'}</td>
                                <td className="px-4 py-3 text-slate-600">{agent.mobile_number ?? '-'}</td>
                                <td className="px-4 py-3 text-slate-600">{decodeStatus(agent.status_name)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="surface-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search market centre name, registered name, source ID, office ID, P24 ID or city..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500" />
          </div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as 'Active' | 'Inactive'); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
          <span className="text-xs text-slate-500 whitespace-nowrap">Page {page} of {totalPages}</span>
        </div>
      </div>

      {isError && <div className="surface-card p-6 text-center text-amber-700">Could not load market centres. Make sure the backend API is running.</div>}

      {view === 'card' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="surface-card p-5 animate-pulse">
                  <div className="flex gap-3 items-start"><div className="h-12 w-12 rounded-xl bg-slate-200 shrink-0" /><div className="flex-1 space-y-2 mt-1"><div className="h-4 bg-slate-200 rounded w-3/4" /><div className="h-3 bg-slate-100 rounded w-1/2" /></div></div>
                </div>
              ))
            : filteredItems.map((item) => {
                const statusLabel = decodeStatus(item.status_name);
                return (
                  <div key={item.id} className="surface-card overflow-hidden hover:shadow-md transition-shadow">
                    <div className={`h-1.5 ${mcColor(item.name)}`} />
                    <div className="p-5 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        {renderLogo(item.logo_image_url, item.name)}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 leading-snug">{item.name}</p>
                          <p className="text-xs text-slate-500 truncate">{item.company_registered_name ?? 'No registered name captured'}</p>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusLabel === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{statusLabel}</span>
                            <span className="rounded-full bg-sky-100 text-sky-800 px-2 py-0.5 text-xs font-medium">{item.agent_count} active agents</span>
                            <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">{item.team_count} teams</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-slate-600">
                        <div>{item.city || 'City not captured'}{item.kw_office_id ? ` - ${item.kw_office_id}` : ''}</div>
                        {item.contact_number && <div>{item.contact_number}</div>}
                        {item.contact_email && <div className="truncate">{item.contact_email}</div>}
                        {item.market_center_property24_id && <div>P24: {item.market_center_property24_id}</div>}
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                        <p className="text-[11px] text-slate-400 font-mono">{item.frontdoor_id ? `Frontdoor: ${item.frontdoor_id}` : item.source_market_center_id}</p>
                        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => void openEditForm(item)}>Edit</button>
                      </div>
                    </div>
                  </div>
                );
              })}
          {!isLoading && !isError && filteredItems.length === 0 && <div className="col-span-full text-center py-16 text-slate-500">No market centres found.</div>}
        </div>
      )}

      {view === 'list' && (
        <section className="surface-card p-0 overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Market Centre</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Teams</th><th className="px-4 py-3">Active Agents</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">P24</th><th className="px-4 py-3">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                {isLoading && <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>Loading market centres...</td></tr>}
                {isError && <tr><td className="px-4 py-6 text-amber-700" colSpan={7}>Could not load market centres.</td></tr>}
                {!isLoading && !isError && filteredItems.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>No market centres found.</td></tr>}
                {filteredItems.map((item) => {
                  const statusLabel = decodeStatus(item.status_name);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><div className="flex items-center gap-2.5">{renderLogo(item.logo_image_url, item.name)}<div><div className="font-medium">{item.name}</div><div className="text-xs text-slate-400">{item.company_registered_name ?? item.source_market_center_id}</div></div></div></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusLabel === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{statusLabel}</span></td>
                      <td className="px-4 py-3 text-slate-600">{item.team_count}</td>
                      <td className="px-4 py-3 text-slate-600">{item.agent_count}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{item.city ?? '-'}<div className="text-slate-400">{item.kw_office_id ?? ''}</div></td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{item.market_center_property24_id ?? '-'}<div className="text-slate-400">{item.property24_opt_in ? 'Opted in' : 'Not opted in'}</div></td>
                      <td className="px-4 py-3"><button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" type="button" onClick={() => void openEditForm(item)}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{data ? `Showing ${data.offset + 1}-${Math.min(data.offset + data.items.length, data.total)} of ${data.total.toLocaleString()}` : ''}</p>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50" type="button" onClick={() => setPage((prev) => prev - 1)} disabled={!canGoPrev}>Previous</button>
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50" type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!canGoNext}>Next</button>
        </div>
      </div>
    </div>
  );
}