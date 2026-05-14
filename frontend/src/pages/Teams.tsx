import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type TeamRow = {
  id: string;
  source_team_id: string;
  name: string;
  registered_name: string | null;
  status_name: string | null;
  contact_number: string | null;
  contact_email: string | null;
  address_city: string | null;
  logo_url: string | null;
  market_center_id: string | null;
  market_center_name: string | null;
  market_center_logo_url: string | null;
  agent_count: string;
  active_listing_count: string;
  lead_agent_name: string | null;
  lead_agent_email: string | null;
  lead_agent_mobile: string | null;
  lead_agent_image_url: string | null;
  updated_at: string;
};

type TeamsResponse = {
  total: number;
  limit: number;
  offset: number;
  items: TeamRow[];
};

type CapRecord = {
  commission_split_to_team: string | null;
  team_cap_amount: string | null;
  manual_cap: boolean;
  cap_year: number | null;
};

type CapHistoryRecord = {
  id: string;
  commission_split_to_team: string | null;
  team_cap_amount: string | null;
  manual_cap: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

type AssociateCommissionsRecord = {
  has_individual_cap: boolean;
  associate_default_cap: string | null;
  associate_default_split: string | null;
  productivity_coach: string | null;
};

type DatesRecord = {
  open_date: string | null;
  close_date: string | null;
  cap_date: string | null;
  anniversary_date: string | null;
  anniversary_comment: string | null;
};

type PortalSettingsRecord = {
  use_mc_account_p24: boolean;
  p24_agency_id: string | null;
  feed_to_p24: boolean;
  p24_auction_approved: boolean;
  use_mc_account_entegral: boolean;
  entegral_url: string | null;
  feed_to_entegral: boolean;
  entegral_portals: string[];
};

type NoteRecord = {
  id: string;
  note_text: string;
  note_type: string;
  created_by: string;
  created_at: string;
};

type MemberRecord = {
  id: string;
  source_associate_id: string;
  full_name: string | null;
  status_name: string | null;
  role_names: string[];
};

type TeamDetail = TeamRow & {
  address_line1: string | null;
  address_suburb: string | null;
  address_province: string | null;
  address_postal_code: string | null;
  source_market_center_id: string | null;
  created_at: string;
  cap: CapRecord | null;
  cap_history: CapHistoryRecord[];
  associate_commissions: AssociateCommissionsRecord | null;
  dates: DatesRecord | null;
  portal_settings: PortalSettingsRecord | null;
  notes: NoteRecord[];
  members: MemberRecord[];
};

type MarketCenterOption = {
  source_market_center_id: string;
  name: string;
};

type TeamFormState = {
  name: string;
  registered_name: string;
  status_name: string;
  source_market_center_id: string;
  contact_number: string;
  contact_email: string;
  logo_url: string;
  address_line1: string;
  address_suburb: string;
  address_city: string;
  address_province: string;
  address_postal_code: string;
  // Cap
  team_cap_amount: string;
  commission_split_to_team: string;
  manual_cap: boolean;
  cap_year: string;
  // Associate commissions
  has_individual_cap: boolean;
  associate_default_cap: string;
  associate_default_split: string;
  productivity_coach: string;
  // Dates
  open_date: string;
  close_date: string;
  cap_date: string;
  anniversary_date: string;
  anniversary_comment: string;
  // Portals
  use_mc_account_p24: boolean;
  p24_agency_id: string;
  feed_to_p24: boolean;
  p24_auction_approved: boolean;
  use_mc_account_entegral: boolean;
  entegral_url: string;
  feed_to_entegral: boolean;
  entegral_portals: string[];
  // Notes
  notes: string[];
};

type TeamPermissionsResponse = {
  can_create_team: boolean;
  can_edit_team_details: boolean;
  can_edit_team_cap: boolean;
  can_edit_team_dates: boolean;
  can_edit_any_team: boolean;
  editable_source_team_ids: string[];
  scope: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(value: string | null): 'Active' | 'Inactive' | 'Unknown' {
  const n = (value ?? '').trim().toLowerCase();
  if (n === '1' || n === 'active') return 'Active';
  if (n === '2' || n === 'inactive') return 'Inactive';
  return 'Unknown';
}

function teamInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

function displayCount(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : '0';
}

function emptyForm(): TeamFormState {
  return {
    name: '',
    registered_name: '',
    status_name: 'Active',
    source_market_center_id: '',
    contact_number: '',
    contact_email: '',
    logo_url: '',
    address_line1: '',
    address_suburb: '',
    address_city: '',
    address_province: '',
    address_postal_code: '',
    team_cap_amount: '',
    commission_split_to_team: '',
    manual_cap: false,
    cap_year: String(new Date().getFullYear()),
    has_individual_cap: false,
    associate_default_cap: '',
    associate_default_split: '',
    productivity_coach: '',
    open_date: '',
    close_date: '',
    cap_date: '',
    anniversary_date: '',
    anniversary_comment: '',
    use_mc_account_p24: true,
    p24_agency_id: '',
    feed_to_p24: true,
    p24_auction_approved: false,
    use_mc_account_entegral: true,
    entegral_url: '',
    feed_to_entegral: true,
    entegral_portals: [],
    notes: [],
  };
}

function detailToForm(d: TeamDetail): TeamFormState {
  return {
    name: d.name ?? '',
    registered_name: d.registered_name ?? '',
    status_name: normalizeStatus(d.status_name) === 'Inactive' ? 'Inactive' : 'Active',
    source_market_center_id: d.source_market_center_id ?? '',
    contact_number: d.contact_number ?? '',
    contact_email: d.contact_email ?? '',
    logo_url: d.logo_url ?? '',
    address_line1: d.address_line1 ?? '',
    address_suburb: d.address_suburb ?? '',
    address_city: d.address_city ?? '',
    address_province: d.address_province ?? '',
    address_postal_code: d.address_postal_code ?? '',
    team_cap_amount: d.cap?.team_cap_amount ?? '',
    commission_split_to_team: d.cap?.commission_split_to_team ?? '',
    manual_cap: d.cap?.manual_cap ?? false,
    cap_year: String(d.cap?.cap_year ?? new Date().getFullYear()),
    has_individual_cap: d.associate_commissions?.has_individual_cap ?? false,
    associate_default_cap: d.associate_commissions?.associate_default_cap ?? '',
    associate_default_split: d.associate_commissions?.associate_default_split ?? '',
    productivity_coach: d.associate_commissions?.productivity_coach ?? '',
    open_date: d.dates?.open_date ?? '',
    close_date: d.dates?.close_date ?? '',
    cap_date: d.dates?.cap_date ?? '',
    anniversary_date: d.dates?.anniversary_date ?? '',
    anniversary_comment: d.dates?.anniversary_comment ?? '',
    use_mc_account_p24: d.portal_settings?.use_mc_account_p24 ?? true,
    p24_agency_id: d.portal_settings?.p24_agency_id ?? '',
    feed_to_p24: d.portal_settings?.feed_to_p24 ?? true,
    p24_auction_approved: d.portal_settings?.p24_auction_approved ?? false,
    use_mc_account_entegral: d.portal_settings?.use_mc_account_entegral ?? true,
    entegral_url: d.portal_settings?.entegral_url ?? '',
    feed_to_entegral: d.portal_settings?.feed_to_entegral ?? true,
    entegral_portals: d.portal_settings?.entegral_portals ?? [],
    notes: d.notes.map((n) => n.note_text),
  };
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-800',
  Inactive: 'bg-slate-100 text-slate-600',
};

type ViewMode = 'card' | 'list';
type TeamSection = 'details' | 'cap' | 'dates' | 'portals' | 'commission' | 'members' | 'notes';

const PAGE_SIZE = 20;
const CARD_PAGE_SIZE = 24;

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const { activeContext } = useAuth();
  const queryClient = useQueryClient();

  // List state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Inactive'>('Active');
  const [view, setView] = useState<ViewMode>('card');

  // Form/modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSourceTeamId, setEditingSourceTeamId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<TeamSection>('details');
  const [form, setForm] = useState<TeamFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const pageSize = view === 'card' ? CARD_PAGE_SIZE : PAGE_SIZE;

  // List query
  const listParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    if (search.trim()) p.set('search', search.trim());
    p.set('status', statusFilter.toLowerCase());
    return p.toString();
  }, [page, search, statusFilter, pageSize]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['teams', listParams, activeContext?.id ?? 'none'],
    queryFn: () =>
      fetch(`/api/teams?${listParams}`).then(async (r) => {
        if (!r.ok) throw new Error('Unable to load teams');
        return r.json() as Promise<TeamsResponse>;
      }),
    placeholderData: (prev) => prev,
  });

  // Market center options
  const { data: mcOptions } = useQuery({
    queryKey: ['market-center-options-for-teams', activeContext?.id ?? 'none'],
    queryFn: () =>
      fetch('/api/market-centers?limit=250&offset=0&status=Active').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load market centres');
        return r.json() as Promise<{ items: MarketCenterOption[] }>;
      }),
  });

  const { data: teamPermissions } = useQuery({
    queryKey: ['team-permissions', activeContext?.id ?? 'none'],
    queryFn: () =>
      fetch('/api/teams/permissions').then(async (r) => {
        if (!r.ok) throw new Error('Unable to load team permissions');
        return r.json() as Promise<TeamPermissionsResponse>;
      }),
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil((data?.total ?? 0) / pageSize)), [data?.total, pageSize]);
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const canCreateTeam = teamPermissions?.can_create_team ?? false;
  const canEditAnyTeam = teamPermissions?.can_edit_any_team ?? false;

  const canEditTeamBySourceId = (sourceTeamId: string | null | undefined): boolean => {
    if (!teamPermissions?.can_edit_team_details) return false;
    if (canEditAnyTeam) return true;
    if (!sourceTeamId) return false;
    return (teamPermissions.editable_source_team_ids ?? []).includes(sourceTeamId);
  };

  const canEditCurrentTeamDetails = editingId
    ? canEditTeamBySourceId(editingSourceTeamId)
    : canCreateTeam;

  const canEditCurrentTeamCap = (teamPermissions?.can_edit_team_cap ?? false)
    && (editingId ? canEditTeamBySourceId(editingSourceTeamId) : canCreateTeam);

  const canEditCurrentTeamDates = (teamPermissions?.can_edit_team_dates ?? false)
    && (editingId ? canEditTeamBySourceId(editingSourceTeamId) : canCreateTeam);

  function openCreateForm(): void {
    if (!canCreateTeam) return;
    setEditingId(null);
    setEditingSourceTeamId(null);
    setFormError(null);
    setActiveSection('details');
    setForm(emptyForm());
    setIsFormOpen(true);
  }

  async function openEditForm(item: TeamRow): Promise<void> {
    setEditingId(item.id);
    setEditingSourceTeamId(item.source_team_id);
    setFormError(null);
    setIsLoadingDetails(true);
    setActiveSection('details');
    setForm(emptyForm());
    setIsFormOpen(true);

    try {
      const r = await fetch(`/api/teams/${item.id}`);
      if (!r.ok) {
        const payload = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Unable to load team details');
      }
      const detail = (await r.json()) as TeamDetail;
      setForm(detailToForm(detail));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to load team details');
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function saveTeam(): Promise<void> {
    if (!canEditCurrentTeamDetails) {
      setFormError('You do not have permission to edit this team.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/teams/${editingId}` : '/api/teams';
      const payload = {
        ...form,
        // Non-admin team roles may edit details only; backend also enforces this.
        ...(canEditCurrentTeamCap
          ? {}
          : {
              team_cap_amount: undefined,
              commission_split_to_team: undefined,
              manual_cap: undefined,
              cap_year: undefined,
            }),
        ...(canEditCurrentTeamDates
          ? {}
          : {
              open_date: undefined,
              close_date: undefined,
              cap_date: undefined,
              anniversary_date: undefined,
              anniversary_comment: undefined,
            }),
      };
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const payload = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Failed to save team');
      }
      setIsFormOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      await refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save team');
    } finally {
      setIsSaving(false);
    }
  }

  // Keep page in bounds when pageSize changes
  useEffect(() => { setPage(1); }, [view]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Teams</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => { setView('card'); setPage(1); }}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === 'card' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => { setView('list'); setPage(1); }}
              className={`px-3 py-1.5 flex items-center gap-1.5 border-l border-slate-300 ${view === 'list' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              List
            </button>
          </div>
          {canCreateTeam && (
            <button className="primary-btn" type="button" onClick={openCreateForm}>
              New Team
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="surface-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search team name, city, email or source ID…"
            className="w-full md:max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as 'Active' | 'Inactive'); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
        </div>
      </div>

      {isError && (
        <div className="surface-card p-6 text-center text-amber-700">Could not load teams.</div>
      )}

      {/* ── Card view ── */}
      {view === 'card' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="surface-card p-5 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                </div>
              ))
            : (data?.items ?? []).map((item) => {
                const statusLabel = normalizeStatus(item.status_name);
                const statusClass = STATUS_COLORS[statusLabel] ?? 'bg-slate-100 text-slate-600';
                return (
                  <div key={item.id} className="surface-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
                    {/* MC banner with logo */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {item.market_center_logo_url ? (
                          <img
                            src={item.market_center_logo_url}
                            alt={item.market_center_name ?? 'MC'}
                            className="h-7 w-7 rounded-md object-contain bg-white border border-slate-200"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-md border border-slate-200 bg-white text-center text-[10px] font-semibold leading-7 text-slate-500">MC</div>
                        )}
                        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-600">{item.market_center_name ?? 'Unassigned'}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
                    </div>

                    {/* Team + lead summary */}
                    <div className="flex items-start gap-3">
                      <TeamAvatar
                        name={item.lead_agent_name ?? item.name}
                        logoUrl={item.lead_agent_image_url}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate leading-snug">{item.name}</p>
                        {item.registered_name && (
                          <p className="truncate text-xs text-slate-400">{item.registered_name}</p>
                        )}
                        <p className="mt-1 truncate text-xs font-medium text-slate-700">
                          Lead Agent: {item.lead_agent_name ?? 'Not assigned'}
                        </p>
                      </div>
                    </div>

                    {/* Lead agent contact */}
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Lead Contact</p>
                      <p className="mt-1 text-xs text-slate-700 truncate">{item.lead_agent_email ?? item.contact_email ?? 'No email on profile'}</p>
                      <p className="text-xs text-slate-700 truncate">{item.lead_agent_mobile ?? item.contact_number ?? 'No phone on profile'}</p>
                    </div>

                    {/* Stats: Active Members */}
                    <div className="border-t border-slate-100 pt-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Active Members</p>
                        <p className="mt-0.5 text-base font-semibold text-slate-900">{displayCount(item.agent_count)}</p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <p className="text-[11px] text-slate-400 font-mono">{item.source_team_id}</p>
                      <button
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        type="button"
                        onClick={() => void openEditForm(item)}
                      >
                        {canEditTeamBySourceId(item.source_team_id) ? 'Edit' : 'View'}
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>
      )}

      {/* ── List view ── */}
      {view === 'list' && (
        <section className="surface-card p-0 overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-4 py-3">Market Centre</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                {(data?.items ?? []).map((item) => {
                  const statusLabel = normalizeStatus(item.status_name);
                  const statusClass = STATUS_COLORS[statusLabel] ?? 'bg-slate-100 text-slate-600';
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{item.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.market_center_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.address_city ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.contact_email ?? item.contact_number ?? '—'}</td>
                      <td className="px-4 py-2.5">{item.agent_count}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          type="button"
                          onClick={() => void openEditForm(item)}
                        >
                          {canEditTeamBySourceId(item.source_team_id) ? 'Edit' : 'View'}
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

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {data ? `Showing ${(page - 1) * pageSize + 1}–${Math.min((page - 1) * pageSize + (data.items.length), data.total)} of ${data.total.toLocaleString()}` : ''}
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

      {/* ── Edit / Create modal ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-6 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            {/* Modal header */}
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Team Workspace</p>
                <h2 className="text-2xl font-semibold text-slate-900">
                  {editingId ? (form.name || 'Edit Team') : 'New Team'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void saveTeam()}
                  disabled={isSaving || isLoadingDetails || !canEditCurrentTeamDetails}
                >
                  {!canEditCurrentTeamDetails ? 'Read Only' : isSaving ? 'Saving…' : 'Save Team'}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Section sidebar */}
              <aside className="w-64 border-r border-slate-200 bg-slate-50 p-3 space-y-1">
                {(
                  [
                    ['details', 'Team Details'],
                    ['cap', 'Cap & Commission'],
                    ['dates', 'Dates'],
                    ['portals', 'Portal Settings'],
                    ['commission', 'Associate Defaults'],
                    ['members', 'Members'],
                    ['notes', 'Notes'],
                  ] as Array<[TeamSection, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveSection(key)}
                    className={clsx(
                      'w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                      activeSection === key
                        ? 'bg-red-600 text-white'
                        : 'text-slate-700 hover:bg-slate-200'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </aside>

              {/* Section content */}
              <div className="flex-1 overflow-y-auto p-6">
                {formError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}
                {!canEditCurrentTeamDetails && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                    You can view this team but cannot edit it in your current role/context.
                  </div>
                )}
                {isLoadingDetails && (
                  <div className="text-center text-sm text-slate-400 py-8">Loading details…</div>
                )}

                {!isLoadingDetails && (
                  <>
                    {/* ─ Team Details ─ */}
                    {activeSection === 'details' && (
                      <fieldset disabled={!canEditCurrentTeamDetails} className="space-y-4 max-w-2xl disabled:opacity-80">
                        <h3 className="text-base font-semibold text-slate-900">Team Details</h3>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Team Name *</span>
                            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Registered Name</span>
                            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.registered_name} onChange={(e) => setForm((p) => ({ ...p, registered_name: e.target.value }))} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Status</span>
                            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.status_name} onChange={(e) => setForm((p) => ({ ...p, status_name: e.target.value }))}>
                              <option value="Active">Active</option>
                              <option value="Inactive">Inactive</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Market Centre</span>
                            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.source_market_center_id} onChange={(e) => setForm((p) => ({ ...p, source_market_center_id: e.target.value }))}>
                              <option value="">Select market centre</option>
                              {(mcOptions?.items ?? []).map((mc) => <option key={mc.source_market_center_id} value={mc.source_market_center_id}>{mc.name}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Contact Number</span>
                            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.contact_number} onChange={(e) => setForm((p) => ({ ...p, contact_number: e.target.value }))} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-slate-600">Contact Email</span>
                            <input type="email" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.contact_email} onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))} />
                          </label>
                          <label className="flex flex-col gap-1 md:col-span-2">
                            <span className="text-xs text-slate-600">Logo URL</span>
                            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.logo_url} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} placeholder="https://…" />
                          </label>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                          <p className="text-sm font-semibold text-slate-900">Address</p>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 md:col-span-2">
                              <span className="text-xs text-slate-600">Street / Unit</span>
                              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.address_line1} onChange={(e) => setForm((p) => ({ ...p, address_line1: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Suburb</span>
                              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.address_suburb} onChange={(e) => setForm((p) => ({ ...p, address_suburb: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">City</span>
                              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.address_city} onChange={(e) => setForm((p) => ({ ...p, address_city: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Province</span>
                              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.address_province} onChange={(e) => setForm((p) => ({ ...p, address_province: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Postal Code</span>
                              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.address_postal_code} onChange={(e) => setForm((p) => ({ ...p, address_postal_code: e.target.value }))} />
                            </label>
                          </div>
                        </div>
                      </fieldset>
                    )}

                    {/* ─ Cap & Commission ─ */}
                    {activeSection === 'cap' && (
                      <fieldset disabled={!canEditCurrentTeamCap} className="space-y-4 max-w-lg disabled:opacity-80">
                        <h3 className="text-base font-semibold text-slate-900">Cap & Commission</h3>
                        {!canEditCurrentTeamCap && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            Team cap values are read-only for your role.
                          </div>
                        )}
                        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Cap Year</span>
                              <input type="number" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.cap_year} onChange={(e) => setForm((p) => ({ ...p, cap_year: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Team Cap Amount (R)</span>
                              <input type="number" step="0.01" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.team_cap_amount} onChange={(e) => setForm((p) => ({ ...p, team_cap_amount: e.target.value }))} />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-slate-600">Commission Split to Team (%)</span>
                              <input type="number" step="0.01" min="0" max="100" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.commission_split_to_team} onChange={(e) => setForm((p) => ({ ...p, commission_split_to_team: e.target.value }))} />
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm mt-5">
                              <input type="checkbox" checked={form.manual_cap} onChange={(e) => setForm((p) => ({ ...p, manual_cap: e.target.checked }))} />
                              Manual Cap Override
                            </label>
                          </div>
                        </div>
                      </fieldset>
                    )}

                    {/* ─ Dates ─ */}
                    {activeSection === 'dates' && (
                      <fieldset disabled={!canEditCurrentTeamDates} className="space-y-4 max-w-lg disabled:opacity-80">
                        <h3 className="text-base font-semibold text-slate-900">Dates</h3>
                        {!canEditCurrentTeamDates && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            Team dates are read-only for your role.
                          </div>
                        )}
                        <div className="rounded-xl border border-slate-200 p-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Open Date</span><input type="date" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.open_date} onChange={(e) => setForm((p) => ({ ...p, open_date: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Close Date</span><input type="date" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.close_date} onChange={(e) => setForm((p) => ({ ...p, close_date: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Cap Date</span><input type="date" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.cap_date} onChange={(e) => setForm((p) => ({ ...p, cap_date: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Anniversary Date</span><input type="date" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.anniversary_date} onChange={(e) => setForm((p) => ({ ...p, anniversary_date: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs text-slate-600">Anniversary Comment</span><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.anniversary_comment} onChange={(e) => setForm((p) => ({ ...p, anniversary_comment: e.target.value }))} /></label>
                          </div>
                        </div>
                      </fieldset>
                    )}

                    {/* ─ Portal Settings ─ */}
                    {activeSection === 'portals' && (
                      <fieldset disabled={!canEditCurrentTeamDetails} className="space-y-4 max-w-xl disabled:opacity-80">
                        <h3 className="text-base font-semibold text-slate-900">Portal Settings</h3>
                        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                          <p className="text-sm font-medium text-slate-700">Property24</p>
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.use_mc_account_p24} onChange={(e) => setForm((p) => ({ ...p, use_mc_account_p24: e.target.checked }))} /> Use Market Centre P24 Account (default)</label>
                          {!form.use_mc_account_p24 && (
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Own P24 Agency ID</span><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.p24_agency_id} onChange={(e) => setForm((p) => ({ ...p, p24_agency_id: e.target.value }))} /></label>
                          )}
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.feed_to_p24} onChange={(e) => setForm((p) => ({ ...p, feed_to_p24: e.target.checked }))} /> Feed listings to P24</label>
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.p24_auction_approved} onChange={(e) => setForm((p) => ({ ...p, p24_auction_approved: e.target.checked }))} /> P24 Auction Approved</label>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                          <p className="text-sm font-medium text-slate-700">Entegral</p>
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.use_mc_account_entegral} onChange={(e) => setForm((p) => ({ ...p, use_mc_account_entegral: e.target.checked }))} /> Use Market Centre Entegral Account (default)</label>
                          {!form.use_mc_account_entegral && (
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Own Entegral URL</span><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.entegral_url} onChange={(e) => setForm((p) => ({ ...p, entegral_url: e.target.value }))} /></label>
                          )}
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.feed_to_entegral} onChange={(e) => setForm((p) => ({ ...p, feed_to_entegral: e.target.checked }))} /> Feed listings to Entegral</label>
                        </div>
                      </fieldset>
                    )}

                    {/* ─ Associate Defaults ─ */}
                    {activeSection === 'commission' && (
                      <fieldset disabled={!canEditCurrentTeamDetails} className="space-y-4 max-w-lg disabled:opacity-80">
                        <h3 className="text-base font-semibold text-slate-900">Associate Defaults</h3>
                        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.has_individual_cap} onChange={(e) => setForm((p) => ({ ...p, has_individual_cap: e.target.checked }))} /> Associates in this team have individual caps</label>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Default Associate Cap (R)</span><input type="number" step="0.01" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.associate_default_cap} onChange={(e) => setForm((p) => ({ ...p, associate_default_cap: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1"><span className="text-xs text-slate-600">Default Associate Split (%)</span><input type="number" step="0.01" min="0" max="100" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.associate_default_split} onChange={(e) => setForm((p) => ({ ...p, associate_default_split: e.target.value }))} /></label>
                            <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs text-slate-600">Productivity Coach</span><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.productivity_coach} onChange={(e) => setForm((p) => ({ ...p, productivity_coach: e.target.value }))} /></label>
                          </div>
                        </div>
                      </fieldset>
                    )}

                    {/* ─ Members (read-only) ─ */}
                    {activeSection === 'members' && (
                      <div className="space-y-3">
                        <h3 className="text-base font-semibold text-slate-900">Members</h3>
                        {!editingId ? (
                          <p className="text-sm text-slate-500">Save the team first, then members can be assigned from the Associates page.</p>
                        ) : (
                          <MembersSection teamId={editingId} />
                        )}
                      </div>
                    )}

                    {/* ─ Notes ─ */}
                    {activeSection === 'notes' && (
                      <fieldset disabled={!canEditCurrentTeamDetails} className="space-y-3 max-w-2xl disabled:opacity-80">
                        <div className="flex items-center justify-between">
                          <h3 className="text-base font-semibold text-slate-900">Notes</h3>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            onClick={() => setForm((p) => ({ ...p, notes: [...p.notes, ''] }))}
                          >
                            Add Note
                          </button>
                        </div>
                        {form.notes.length === 0 && (
                          <p className="text-sm text-slate-400">No notes yet.</p>
                        )}
                        {form.notes.map((note, i) => (
                          <div key={i} className="flex gap-2">
                            <textarea
                              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              rows={2}
                              value={note}
                              onChange={(e) => setForm((p) => ({ ...p, notes: p.notes.map((n, ni) => ni === i ? e.target.value : n) }))}
                            />
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs self-start"
                              onClick={() => setForm((p) => ({ ...p, notes: p.notes.filter((_, ni) => ni !== i) }))}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </fieldset>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TeamAvatar({ name, logoUrl }: { name: string | null; logoUrl: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = teamInitials(name);

  useEffect(() => { setImgFailed(false); }, [logoUrl]);

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={name ?? 'Team'}
        className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const hash = (initials.charCodeAt(0) ?? 0) % 6;
  const colors = ['bg-red-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-cyan-500'];
  return (
    <div className={`h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-lg shadow ring-2 ring-white ${colors[hash]}`}>
      {initials}
    </div>
  );
}

function MembersSection({ teamId }: { teamId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['teams', 'detail', teamId, 'members'],
    queryFn: () =>
      fetch(`/api/teams/${teamId}`).then(async (r) => {
        if (!r.ok) throw new Error('Failed to load');
        return (r.json() as Promise<TeamDetail>).then((d) => d.members);
      }),
  });

  if (isLoading) return <div className="text-sm text-slate-400 py-4">Loading members…</div>;

  const members = data ?? [];
  return members.length === 0 ? (
    <p className="text-sm text-slate-400">No members assigned. Assign agents to this team from the Associates page.</p>
  ) : (
    <section className="surface-card p-0 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Roles</th>
            <th className="px-4 py-3">Source ID</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {members.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-900">{m.full_name ?? '—'}</td>
              <td className="px-4 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.status_name?.toLowerCase() === 'active' || m.status_name === '1' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {m.status_name ?? '—'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-slate-500">{m.role_names.join(', ') || '—'}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{m.source_associate_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

