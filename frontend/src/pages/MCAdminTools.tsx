import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import MCDashboardTab from './mc-admin/MCDashboardTab';
import RentalsPage from './Rentals';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MCAgent = {
  associate_id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  image_url: string | null;
  active_listing_count: string;
};

type AgentListing = {
  id: string;
  listing_number: string | null;
  status_name: string | null;
  listing_status_tag: string | null;
  sale_or_rent: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  price: string | null;
  property_type: string | null;
  property_sub_type: string | null;
  is_published: boolean | null;
  feed_to_property24: boolean | null;
  property24_ref: string | null;
  feed_to_private_property: boolean | null;
  private_property_ref: string | null;
  feed_to_kww: boolean | null;
  kww_ref: string | null;
  feed_to_entegral: boolean | null;
  entegral_ref: string | null;
  thumbnail_url: string | null;
};

type PortalResult = {
  portal: string;
  withdrawOk: boolean | null;
  withdrawError: string | null;
  publishOk: boolean | null;
  publishError: string | null;
};

type ListingTransferResult = {
  listingId: string;
  listingNumber: string | null;
  newListingId: string | null;
  newListingNumber: string | null;
  address: string | null;
  portals: PortalResult[];
  agentSwapped: boolean;
  error: string | null;
};

type TransferJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  fromAgentName: string;
  toAgentName: string;
  total: number;
  completed: number;
  results: ListingTransferResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type TransferLogRow = {
  id: string;
  job_id: string;
  listing_id: string;
  listing_number: string | null;
  from_agent_name: string | null;
  to_agent_name: string | null;
  portals_json: PortalResult[] | null;
  agent_swapped: boolean;
  transfer_error: string | null;
  requested_by: string | null;
  transferred_at: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatPrice(raw: string | null): string {
  if (!raw) return '—';
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return raw;
  return `R ${n.toLocaleString('en-ZA')}`;
}

function PortalBadge({ label, refId }: { label: string; refId: string | null | undefined }) {
  if (!refId) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
      {label}
    </span>
  );
}

function StatusDot({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-slate-400 text-xs">{label}: —</span>;
  return (
    <span className={clsx('text-xs font-medium', ok ? 'text-emerald-600' : 'text-red-600')}>
      {label}: {ok ? '✓' : '✗'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tab: Listing Transfer
// ─────────────────────────────────────────────────────────────────────────────

function ListingTransferTab() {
  const { token, activeContext, isRegionalAdmin, isOfficeAdmin } = useAuth();

  const mcSourceId = activeContext?.marketCenterId ?? null;

  const [agents, setAgents] = useState<MCAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [fromAgentId, setFromAgentId] = useState('');
  const [listings, setListings] = useState<AgentListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toAgentId, setToAgentId] = useState('');

  // Confirmation modal
  const [showConfirm, setShowConfirm] = useState(false);

  // Job progress
  const [activeJob, setActiveJob] = useState<TransferJob | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<TransferLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (activeContext?.id) h['x-active-context'] = activeContext.id;
    return h;
  }, [token, activeContext]);

  // Load agents for this MC
  useEffect(() => {
    if (!mcSourceId) return;
    setAgentsLoading(true);
    setAgentsError(null);
    fetch(`/api/listing-transfer/mc-agents/${encodeURIComponent(mcSourceId)}`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((data: { agents?: MCAgent[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setAgents(data.agents ?? []);
      })
      .catch((err: unknown) => setAgentsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setAgentsLoading(false));
  }, [mcSourceId, authHeaders]);

  // Load listings when fromAgentId changes
  useEffect(() => {
    if (!fromAgentId) {
      setListings([]);
      setSelectedIds(new Set());
      return;
    }
    setListingsLoading(true);
    setListingsError(null);
    fetch(`/api/listing-transfer/agent-listings/${fromAgentId}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: { listings?: AgentListing[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setListings(data.listings ?? []);
        setSelectedIds(new Set());
      })
      .catch((err: unknown) => setListingsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setListingsLoading(false));
  }, [fromAgentId, authHeaders]);

  function toggleAll() {
    if (selectedIds.size === listings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(listings.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fromAgent = agents.find((a) => a.associate_id === fromAgentId);
  const toAgent = agents.find((a) => a.associate_id === toAgentId);
  const selectedCount = selectedIds.size;
  const canTransfer = selectedCount > 0 && !!toAgentId && toAgentId !== fromAgentId;

  async function startTransfer() {
    setShowConfirm(false);
    const res = await fetch('/api/listing-transfer/jobs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        fromAgentId: Number(fromAgentId),
        toAgentId: Number(toAgentId),
        listingIds: [...selectedIds].map(Number),
        activeContext: activeContext?.id ?? null,
      }),
    });
    const data = await res.json() as { jobId?: string; error?: string };
    if (!res.ok || !data.jobId) {
      alert(`Failed to start transfer: ${data.error ?? 'Unknown error'}`);
      return;
    }
    // Start polling
    const initialJob: TransferJob = {
      id: data.jobId,
      status: 'pending',
      fromAgentName: fromAgent?.full_name ?? '',
      toAgentName: toAgent?.full_name ?? '',
      total: selectedCount,
      completed: 0,
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    setActiveJob(initialJob);
    setShowProgress(true);
    scheduleJobPoll(data.jobId);
  }

  function scheduleJobPoll(jobId: string) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listing-transfer/jobs/${jobId}`, { headers: authHeaders() });
        const job = await r.json() as TransferJob;
        setActiveJob(job);
        if (job.status === 'running' || job.status === 'pending') {
          scheduleJobPoll(jobId);
        } else {
          // Refresh agents + listings after completion
          if (mcSourceId) {
            fetch(`/api/listing-transfer/mc-agents/${encodeURIComponent(mcSourceId)}`, { headers: authHeaders() })
              .then((r2) => r2.json())
              .then((d: { agents?: MCAgent[] }) => { if (d.agents) setAgents(d.agents); })
              .catch(() => undefined);
          }
          if (fromAgentId) {
            fetch(`/api/listing-transfer/agent-listings/${fromAgentId}`, { headers: authHeaders() })
              .then((r2) => r2.json())
              .then((d: { listings?: AgentListing[] }) => {
                if (d.listings) { setListings(d.listings); setSelectedIds(new Set()); }
              })
              .catch(() => undefined);
          }
        }
      } catch {
        scheduleJobPoll(jobId);
      }
    }, 1500);
  }

  function loadHistory() {
    setHistoryLoading(true);
    fetch('/api/listing-transfer/history', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: { log?: TransferLogRow[] }) => setHistoryRows(d.log ?? []))
      .catch(() => undefined)
      .finally(() => setHistoryLoading(false));
  }

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        MC Admin Tools are only available to Office Admins and Regional Admins.
      </div>
    );
  }

  if (!mcSourceId && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        Please switch to an Office Admin context to use this tool.
      </div>
    );
  }

  const progressPct = activeJob
    ? Math.round((activeJob.completed / Math.max(activeJob.total, 1)) * 100)
    : 0;
  const workflowStep = !fromAgentId ? 1 : selectedCount === 0 ? 2 : !toAgentId ? 3 : 4;

  return (
    <div className="space-y-6">
      {/* ── Section header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Listing Transfer</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Transfer active listings from one agent to another. All portal listings are withdrawn and republished under the new agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowHistory(true); loadHistory(); }}
          className="shrink-0 ml-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-700 transition-colors shadow-sm"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true"><path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/></svg>
          Transfer History
        </button>
      </div>

      <div className="surface-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { n: 1, label: 'Source Agent' },
              { n: 2, label: 'Listings' },
              { n: 3, label: 'Target Agent' },
              { n: 4, label: 'Review & Transfer' },
            ].map((item) => (
              <div key={item.n} className={clsx('inline-flex items-center gap-2 rounded-full border px-3 py-1', workflowStep >= item.n ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500')}>
                <span className={clsx('inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold', workflowStep >= item.n ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600')}>{item.n}</span>
                <span className="font-semibold">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Current selection:</span>{' '}
            {fromAgent?.full_name ?? 'No source'} → {toAgent?.full_name ?? 'No target'} · {selectedCount} selected
          </div>
        </div>
      </div>

      {/* ── Step 1: Pick source agent ── */}
      <div className="surface-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Step 1</p>
            <h3 className="text-base font-semibold text-slate-800 mt-0.5">Select the agent whose listings you want to transfer</h3>
          </div>
          {fromAgentId && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 border border-red-200">
              {agents.find(a => a.associate_id === fromAgentId)?.full_name ?? 'Selected'}
            </span>
          )}
        </div>

        {agentsLoading && (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            Loading agents…
          </div>
        )}
        {agentsError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{agentsError}</div>
        )}

        {!agentsLoading && !agentsError && (
          agents.length === 0
            ? <p className="text-sm text-slate-500 py-2">No active agents found in this market centre.</p>
            : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                {agents.map((agent) => {
                  const isSelected = fromAgentId === agent.associate_id;
                  const count = Number(agent.active_listing_count);
                  return (
                    <button
                      key={agent.associate_id}
                      type="button"
                      onClick={() => { setFromAgentId(agent.associate_id); setToAgentId(''); }}
                      className={clsx(
                        'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150',
                        isSelected
                          ? 'border-red-400 bg-red-50 ring-2 ring-red-300 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-red-200 hover:bg-red-50/40 hover:shadow-sm'
                      )}
                    >
                      {agent.image_url ? (
                        <img src={agent.image_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" />
                      ) : (
                        <div className={clsx(
                          'h-12 w-12 rounded-full flex items-center justify-center text-base font-bold ring-2 ring-white shadow',
                          isSelected ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'
                        )}>
                          {(agent.full_name ?? '?')[0].toUpperCase()}
                        </div>
                      )}
                      <div className="w-full min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800 leading-4">{agent.full_name ?? 'Unknown'}</p>
                        <p className={clsx(
                          'mt-0.5 text-[11px] font-medium',
                          count > 0 ? (isSelected ? 'text-red-600' : 'text-slate-500') : 'text-slate-300'
                        )}>
                          {count} {count === 1 ? 'listing' : 'listings'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
        )}
      </div>

      {/* ── Step 2: Select listings ── */}
      {fromAgentId && (
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Step 2</p>
              <h3 className="text-base font-semibold text-slate-800 mt-0.5">Select listings to transfer</h3>
            </div>
            {listings.length > 0 && (
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
                    {selectedCount} selected
                  </span>
                )}
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-700 transition-colors shadow-sm"
                >
                  {selectedIds.size === listings.length ? 'Deselect All' : 'Select All'} ({listings.length})
                </button>
              </div>
            )}
          </div>

          {listingsLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              Loading listings…
            </div>
          )}
          {listingsError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{listingsError}</div>
          )}

          {!listingsLoading && !listingsError && listings.length === 0 && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
              This agent has no active listings.
            </div>
          )}

          {!listingsLoading && listings.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === listings.length && listings.length > 0}
                        onChange={toggleAll}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left">Listing #</th>
                    <th className="px-3 py-2.5 text-left">Address</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-right">Price</th>
                    <th className="px-3 py-2.5 text-left">Portals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listings.map((listing) => (
                    <tr
                      key={listing.id}
                      onClick={() => toggleOne(listing.id)}
                      className={clsx(
                        'cursor-pointer transition-colors',
                        selectedIds.has(listing.id) ? 'bg-red-50' : 'hover:bg-slate-50'
                      )}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(listing.id)}
                          onChange={() => toggleOne(listing.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                        {listing.listing_number ?? listing.id}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 max-w-xs truncate">
                        {[listing.address, listing.suburb, listing.city].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                        {listing.property_sub_type ?? listing.property_type ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700 whitespace-nowrap">
                        {formatPrice(listing.price)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <PortalBadge label="P24" refId={listing.property24_ref} />
                          <PortalBadge label="PP" refId={listing.private_property_ref} />
                          <PortalBadge label="KWW" refId={listing.kww_ref} />
                          <PortalBadge label="ENT" refId={listing.entegral_ref} />
                          {!listing.property24_ref && !listing.private_property_ref && !listing.kww_ref && !listing.entegral_ref && (
                            <span className="text-xs text-slate-400">No active portal refs</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedCount > 0 && (
            <div className="flex justify-end pt-1">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-800">{selectedCount}</span> listing{selectedCount !== 1 ? 's' : ''} selected
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Pick target agent ── */}
      {fromAgentId && selectedCount > 0 && (
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Step 3</p>
              <h3 className="text-base font-semibold text-slate-800 mt-0.5">Select the agent to transfer to</h3>
            </div>
            {toAgentId && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                {agents.find(a => a.associate_id === toAgentId)?.full_name ?? 'Selected'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {agents
              .filter((a) => a.associate_id !== fromAgentId)
              .map((agent) => {
                const isSelected = toAgentId === agent.associate_id;
                const count = Number(agent.active_listing_count);
                return (
                  <button
                    key={agent.associate_id}
                    type="button"
                    onClick={() => setToAgentId(agent.associate_id)}
                    className={clsx(
                      'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150',
                      isSelected
                        ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40 hover:shadow-sm'
                    )}
                  >
                    {agent.image_url ? (
                      <img src={agent.image_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" />
                    ) : (
                      <div className={clsx(
                        'h-12 w-12 rounded-full flex items-center justify-center text-base font-bold ring-2 ring-white shadow',
                        isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      )}>
                        {(agent.full_name ?? '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="w-full min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-800 leading-4">{agent.full_name ?? 'Unknown'}</p>
                      <p className={clsx(
                        'mt-0.5 text-[11px] font-medium',
                        count > 0 ? (isSelected ? 'text-emerald-600' : 'text-slate-500') : 'text-slate-300'
                      )}>
                        {count} {count === 1 ? 'listing' : 'listings'}
                      </p>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Transfer button ── */}
      {canTransfer && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-800">Ready to transfer</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedCount} listing{selectedCount !== 1 ? 's' : ''} from{' '}
              <span className="font-medium">{fromAgent?.full_name}</span> to{' '}
              <span className="font-medium">{toAgent?.full_name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="primary-btn"
          >
            Transfer {selectedCount} Listing{selectedCount !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* ── Confirmation modal ── */}
      {showConfirm && fromAgent && toAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Confirm Listing Transfer</h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              You are about to transfer{' '}
              <strong>{selectedCount} listing{selectedCount !== 1 ? 's' : ''}</strong> from{' '}
              <strong>{fromAgent.full_name}</strong> to <strong>{toAgent.full_name}</strong>.
            </p>
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
              <strong>What will happen:</strong> Each selected listing will be <em>withdrawn</em> from all
              active portals. A <em>new listing</em> with a new listing number will then be created under
              <strong> {toAgent.full_name}</strong> with all the same details, and published to the same
              portals. The original listing will be marked Inactive. This cannot be undone automatically.
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startTransfer}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Yes, Transfer Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Progress modal ── */}
      {showProgress && activeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Transferring Listings…</h3>
              {(activeJob.status === 'done' || activeJob.status === 'failed') && (
                <button
                  type="button"
                  onClick={() => setShowProgress(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                >
                  ✕
                </button>
              )}
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{activeJob.fromAgentName} → {activeJob.toAgentName}</span>
                <span>{activeJob.completed} / {activeJob.total}</span>
              </div>
              <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-500',
                    activeJob.status === 'done' ? 'bg-emerald-500' : activeJob.status === 'failed' ? 'bg-red-500' : 'bg-red-600'
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {activeJob.status === 'running' || activeJob.status === 'pending' ? (
              <p className="text-sm text-slate-600 animate-pulse">Processing… please wait.</p>
            ) : activeJob.status === 'done' ? (
              <p className="text-sm text-emerald-700 font-medium">✓ Transfer complete!</p>
            ) : (
              <p className="text-sm text-red-700 font-medium">Transfer failed: {activeJob.error}</p>
            )}

            {/* Per-listing results */}
            {activeJob.results.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                {activeJob.results.map((r) => (
                  <div key={r.listingId} className={clsx('px-3 py-2', r.error ? 'bg-red-50' : 'bg-white')}>
                    <p className="font-medium text-slate-800">
                      {r.listingNumber ?? `#${r.listingId}`} — {r.address ?? 'No address'}
                    </p>
                    {r.newListingNumber && (
                      <p className="text-emerald-700 text-[11px] mt-0.5">
                        New listing: <span className="font-semibold">{r.newListingNumber}</span>
                      </p>
                    )}
                    {r.error && <p className="text-red-600 mt-0.5">Error: {r.error}</p>}
                    {!r.error && (
                      <div className="flex flex-wrap gap-3 mt-1">
                        {r.portals.map((p) => (
                          <div key={p.portal} className="flex flex-col gap-0.5">
                            <span className="font-semibold text-slate-600">{p.portal}</span>
                            <StatusDot ok={p.withdrawOk} label="Withdraw" />
                            <StatusDot ok={p.publishOk} label="Publish" />
                          </div>
                        ))}
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-slate-600">Agent</span>
                          <StatusDot ok={r.agentSwapped} label="Assigned" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── History modal ── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-bold text-slate-800">Transfer History</h3>
              <button type="button" onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            {historyLoading && <p className="text-sm text-slate-500">Loading…</p>}

            {!historyLoading && historyRows.length === 0 && (
              <p className="text-sm text-slate-500">No transfers recorded yet.</p>
            )}

            {!historyLoading && historyRows.length > 0 && (
              <div className="overflow-y-auto flex-1 rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 text-slate-600 uppercase tracking-wide font-semibold">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Date</th>
                      <th className="px-3 py-2.5 text-left">Listing</th>
                      <th className="px-3 py-2.5 text-left">From Agent</th>
                      <th className="px-3 py-2.5 text-left">To Agent</th>
                      <th className="px-3 py-2.5 text-left">Portals</th>
                      <th className="px-3 py-2.5 text-left">Requested By</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                          {new Date(row.transferred_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.listing_number ?? row.listing_id}</td>
                        <td className="px-3 py-2 text-slate-600">{row.from_agent_name ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{row.to_agent_name ?? '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(row.portals_json ?? []).map((p) => (
                              <span key={p.portal} className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium',
                                p.publishOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                              )}>
                                {p.portal}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{row.requested_by ?? '—'}</td>
                        <td className="px-3 py-2">
                          {row.transfer_error ? (
                            <span className="text-red-600 font-medium">Failed</span>
                          ) : row.agent_swapped ? (
                            <span className="text-emerald-600 font-medium">Success</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tab: Agent Deregistration
// ─────────────────────────────────────────────────────────────────────────────

type DeregAgent = {
  associate_id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  image_url: string | null;
  total_listing_count: string;
  primary_listing_count: string;
};

type DeregListing = {
  id: string;
  listing_number: string | null;
  status_name: string | null;
  address: string | null;
  suburb: string | null;
  price: string | null;
  property_type: string | null;
  is_published: boolean | null;
  is_primary: boolean;
  agent_role: string | null;
  feed_to_property24: boolean | null;
  property24_ref: string | null;
  feed_to_private_property: boolean | null;
  private_property_ref: string | null;
  feed_to_kww: boolean | null;
  kww_ref: string | null;
  feed_to_entegral: boolean | null;
  entegral_ref: string | null;
};

type WithdrawalResult = {
  listingId: string;
  listingNumber: string | null;
  address: string | null;
  wasPrimary: boolean;
  portals: { portal: string; withdrawOk: boolean | null; withdrawError: string | null }[];
  error: string | null;
};

type WithdrawalJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  agentName: string;
  total: number;
  completed: number;
  results: WithdrawalResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type AgentPortalRemovalResult = {
  portal: 'Property24' | 'Private Property';
  attempted: boolean;
  removed: boolean;
  message: string;
  details: string | null;
};

type AgentPortalRemovalSummary = {
  property24: AgentPortalRemovalResult;
  privateProperty: AgentPortalRemovalResult;
  allSucceeded: boolean;
};

type DeregStep =
  | 'select-agent'
  | 'action-modal'
  | 'transfer-select-target'
  | 'transfer-confirm'
  | 'transfer-running'
  | 'transfer-done'
  | 'withdraw-confirm'
  | 'withdraw-running'
  | 'withdraw-done'
  | 'deactivation-reason'
  | 'done';

function AgentDeregistrationTab() {
  const { token, activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();
  const mcSourceId = activeContext?.marketCenterId ?? null;

  // Agent list
  const [agents, setAgents] = useState<DeregAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  // Flow state
  const [step, setStep] = useState<DeregStep>('select-agent');
  const [selectedAgent, setSelectedAgent] = useState<DeregAgent | null>(null);
  const [allListings, setAllListings] = useState<DeregListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);

  // Transfer path
  const [toAgentId, setToAgentId] = useState('');
  const [transferJob, setTransferJob] = useState<TransferJob | null>(null);
  const transferPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Withdraw path
  const [withdrawJob, setWithdrawJob] = useState<WithdrawalJob | null>(null);
  const withdrawPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deactivation reason
  const [reason, setReason] = useState('');
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivatedName, setDeactivatedName] = useState('');
  const [portalRemoval, setPortalRemoval] = useState<AgentPortalRemovalSummary | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (activeContext?.id) h['x-active-context'] = activeContext.id;
    return h;
  }, [token, activeContext]);

  // Load agents
  useEffect(() => {
    if (!mcSourceId) return;
    setAgentsLoading(true);
    setAgentsError(null);
    fetch(`/api/agent-deregistration/mc-agents/${encodeURIComponent(mcSourceId)}`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((data: { agents?: DeregAgent[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setAgents(data.agents ?? []);
      })
      .catch((err: unknown) => setAgentsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setAgentsLoading(false));
  }, [mcSourceId, authHeaders]);

  function resetFlow() {
    setStep('select-agent');
    setSelectedAgent(null);
    setAllListings([]);
    setToAgentId('');
    setTransferJob(null);
    setWithdrawJob(null);
    setReason('');
    setDeactivateError(null);
    setDeactivatedName('');
    setPortalRemoval(null);
    if (transferPollRef.current) clearTimeout(transferPollRef.current);
    if (withdrawPollRef.current) clearTimeout(withdrawPollRef.current);
  }

  async function handleAgentSelect(agent: DeregAgent) {
    setSelectedAgent(agent);
    setListingsLoading(true);
    try {
      const r = await fetch(`/api/agent-deregistration/agent-all-listings/${agent.associate_id}`, {
        headers: authHeaders(),
      });
      const data = await r.json() as { listings?: DeregListing[]; error?: string };
      if (data.error) throw new Error(data.error);
      setAllListings(data.listings ?? []);
    } catch {
      setAllListings([]);
    } finally {
      setListingsLoading(false);
    }
    setStep('action-modal');
  }

  // ── Transfer path ─────────────────────────────────────────────────────────

  const primaryListings = allListings.filter((l) => l.is_primary);
  const secondaryListings = allListings.filter((l) => !l.is_primary);
  const toAgent = agents.find((a) => a.associate_id === toAgentId);

  async function startTransfer() {
    if (!selectedAgent || !toAgentId) return;
    setStep('transfer-running');
    try {
      const res = await fetch('/api/listing-transfer/jobs', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fromAgentId: Number(selectedAgent.associate_id),
          toAgentId: Number(toAgentId),
          listingIds: primaryListings.map((l) => Number(l.id)),
          activeContext: activeContext?.id ?? null,
        }),
      });
      const data = await res.json() as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        alert(`Failed to start transfer: ${data.error ?? 'Unknown error'}`);
        setStep('transfer-confirm');
        return;
      }
      const initial: TransferJob = {
        id: data.jobId,
        status: 'pending',
        fromAgentName: selectedAgent.full_name ?? '',
        toAgentName: toAgent?.full_name ?? '',
        total: primaryListings.length,
        completed: 0,
        results: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      setTransferJob(initial);
      scheduleTransferPoll(data.jobId);
    } catch (err) {
      alert(`Transfer error: ${err instanceof Error ? err.message : String(err)}`);
      setStep('transfer-confirm');
    }
  }

  function scheduleTransferPoll(jobId: string) {
    if (transferPollRef.current) clearTimeout(transferPollRef.current);
    transferPollRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listing-transfer/jobs/${jobId}`, { headers: authHeaders() });
        const job = await r.json() as TransferJob;
        setTransferJob(job);
        if (job.status === 'running' || job.status === 'pending') {
          scheduleTransferPoll(jobId);
        } else {
          setStep('transfer-done');
          // Refresh agent list so listing counts update
          reloadAgents();
        }
      } catch {
        scheduleTransferPoll(jobId);
      }
    }, 1500);
  }

  // ── Withdraw path ─────────────────────────────────────────────────────────

  async function startWithdrawal() {
    if (!selectedAgent) return;
    setStep('withdraw-running');
    try {
      const res = await fetch('/api/agent-deregistration/withdraw-jobs', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          agentId: Number(selectedAgent.associate_id),
          activeContext: activeContext?.id ?? null,
        }),
      });
      const data = await res.json() as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        alert(`Failed to start withdrawal: ${data.error ?? 'Unknown error'}`);
        setStep('withdraw-confirm');
        return;
      }
      const initial: WithdrawalJob = {
        id: data.jobId,
        status: 'pending',
        agentName: selectedAgent.full_name ?? '',
        total: allListings.length,
        completed: 0,
        results: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      setWithdrawJob(initial);
      scheduleWithdrawPoll(data.jobId);
    } catch (err) {
      alert(`Withdrawal error: ${err instanceof Error ? err.message : String(err)}`);
      setStep('withdraw-confirm');
    }
  }

  function scheduleWithdrawPoll(jobId: string) {
    if (withdrawPollRef.current) clearTimeout(withdrawPollRef.current);
    withdrawPollRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/agent-deregistration/withdraw-jobs/${jobId}`, { headers: authHeaders() });
        const job = await r.json() as WithdrawalJob;
        setWithdrawJob(job);
        if (job.status === 'running' || job.status === 'pending') {
          scheduleWithdrawPoll(jobId);
        } else {
          setStep('withdraw-done');
          reloadAgents();
        }
      } catch {
        scheduleWithdrawPoll(jobId);
      }
    }, 1500);
  }

  // ── Deactivation ──────────────────────────────────────────────────────────

  async function confirmDeactivation() {
    if (!selectedAgent || !reason.trim()) return;
    setDeactivateLoading(true);
    setDeactivateError(null);
    setPortalRemoval(null);
    try {
      const jobId = withdrawJob?.id ?? null;
      const res = await fetch('/api/agent-deregistration/deactivate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          agentId: Number(selectedAgent.associate_id),
          reason: reason.trim(),
          withdrawJobId: jobId,
        }),
      });
      const data = await res.json() as {
        success?: boolean;
        agentName?: string;
        error?: string;
        portalSync?: AgentPortalRemovalSummary;
      };
      if (!res.ok || !data.success) {
        setDeactivateError(data.error ?? 'Failed to deactivate agent.');
        if (data.portalSync) setPortalRemoval(data.portalSync);
        return;
      }
      if (data.portalSync) setPortalRemoval(data.portalSync);
      setDeactivatedName(data.agentName ?? selectedAgent.full_name ?? 'Agent');
      setStep('done');
      // Remove deactivated agent from the local list
      setAgents((prev) => prev.filter((a) => a.associate_id !== selectedAgent.associate_id));
    } catch (err) {
      setDeactivateError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeactivateLoading(false);
    }
  }

  function reloadAgents() {
    if (!mcSourceId) return;
    fetch(`/api/agent-deregistration/mc-agents/${encodeURIComponent(mcSourceId)}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: { agents?: DeregAgent[] }) => { if (data.agents) setAgents(data.agents); })
      .catch(() => undefined);
  }

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        Agent Deregistration is only available to Office Admins and Regional Admins.
      </div>
    );
  }

  if (!mcSourceId && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        Please switch to an Office Admin context to use this tool.
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Agent Deregistration</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Deregister an active agent. All listings will be transferred or withdrawn before deactivation.
        </p>
      </div>

      <div className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Guided Flow</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">1. Select Agent</span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">2. Choose Transfer or Withdraw</span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">3. Review Progress</span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">4. Capture Deregistration Reason</span>
        </div>
      </div>

      {/* ── Step: done ── */}
      {step === 'done' && (
        <div className="surface-card p-8 flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-emerald-600"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">{deactivatedName} has been deregistered</h3>
            <p className="text-sm text-slate-500 mt-1">
              This agent is now inactive and will no longer appear as an active agent in the system.
            </p>
          </div>
          {portalRemoval && (
            <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-sm font-semibold text-slate-800 mb-2">Portal Removal Status</p>
              {[portalRemoval.property24, portalRemoval.privateProperty].map((item) => (
                <div key={item.portal} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5 mb-2 last:mb-0">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{item.portal}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.message}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.removed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {item.removed ? 'Removed' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={resetFlow}
            className="mt-2 rounded-lg border border-slate-300 px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Deregister Another Agent
          </button>
        </div>
      )}

      {/* ── Step: select-agent ── */}
      {step === 'select-agent' && (
        <div className="surface-card p-5 space-y-4">
          <p className="text-sm font-medium text-slate-600">Select the agent to deregister:</p>

          {agentsLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Loading agents…
            </div>
          )}
          {agentsError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{agentsError}</div>
          )}
          {!agentsLoading && !agentsError && agents.length === 0 && (
            <p className="text-sm text-slate-500 py-2">No active agents found in this market centre.</p>
          )}
          {!agentsLoading && !agentsError && agents.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {agents.map((agent) => {
                const total = Number(agent.total_listing_count);
                return (
                  <button
                    key={agent.associate_id}
                    type="button"
                    onClick={() => handleAgentSelect(agent)}
                    disabled={listingsLoading}
                    className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center transition-all duration-150 hover:border-red-300 hover:bg-red-50/40 hover:shadow-sm disabled:opacity-50"
                  >
                    {agent.image_url ? (
                      <img src={agent.image_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" />
                    ) : (
                      <div className="h-12 w-12 rounded-full flex items-center justify-center text-base font-bold bg-slate-100 text-slate-500 ring-2 ring-white shadow">
                        {(agent.full_name ?? '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="w-full min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-800 leading-4">{agent.full_name ?? 'Unknown'}</p>
                      <p className={clsx('mt-0.5 text-[11px] font-medium', total > 0 ? 'text-slate-500' : 'text-slate-300')}>
                        {total} {total === 1 ? 'listing' : 'listings'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Action modal — has listings ── */}
      {step === 'action-modal' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-red-100 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-red-600"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Deregister {selectedAgent.full_name}</h3>
                {listingsLoading ? (
                  <p className="text-sm text-slate-500 mt-1 animate-pulse">Checking active listings…</p>
                ) : allListings.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    <p className="text-sm text-slate-600">
                      <strong>{selectedAgent.full_name}</strong> currently has{' '}
                      <strong>{allListings.length}</strong> active {allListings.length === 1 ? 'listing' : 'listings'}
                      {primaryListings.length > 0 && secondaryListings.length > 0 && (
                        <span className="text-slate-500">
                          {' '}({primaryListings.length} primary, {secondaryListings.length} supporting)
                        </span>
                      )}
                      .
                    </p>
                    <p className="text-sm text-slate-600 font-medium">Would you like to transfer these listings to another agent?</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 mt-1">
                    <strong>{selectedAgent.full_name}</strong> has no active listings.
                  </p>
                )}
              </div>
            </div>

            {!listingsLoading && allListings.length > 0 && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Transfer:</strong> Primary listings will be transferred to another agent and republished. Supporting agent roles will be removed.</p>
                <p><strong>Withdraw:</strong> Primary listings will be fully withdrawn from all portals and marked inactive. Supporting agent roles will be removed.</p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={resetFlow}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              {!listingsLoading && allListings.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setStep('withdraw-confirm')}
                    className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    No — Withdraw All Listings
                  </button>
                  {primaryListings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep('transfer-select-target')}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      Yes — Transfer Listings
                    </button>
                  )}
                </>
              )}
              {!listingsLoading && allListings.length === 0 && (
                <button
                  type="button"
                  onClick={() => setStep('deactivation-reason')}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Deactivate Agent
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Transfer: select target agent ── */}
      {(step === 'transfer-select-target' || step === 'transfer-confirm') && selectedAgent && (
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Deregistering</span>
                <span className="text-sm font-semibold text-slate-800">{selectedAgent.full_name}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-800">Select the agent to transfer {primaryListings.length} {primaryListings.length === 1 ? 'listing' : 'listings'} to</h3>
              {secondaryListings.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedAgent.full_name} is also a supporting agent on {secondaryListings.length} other {secondaryListings.length === 1 ? 'listing' : 'listings'} — they will be removed from those automatically.
                </p>
              )}
            </div>
            <button type="button" onClick={resetFlow} className="text-slate-400 hover:text-slate-600 text-xl ml-4">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {agents
              .filter((a) => a.associate_id !== selectedAgent.associate_id)
              .map((agent) => {
                const isSelected = toAgentId === agent.associate_id;
                const count = Number(agent.total_listing_count);
                return (
                  <button
                    key={agent.associate_id}
                    type="button"
                    onClick={() => setToAgentId(agent.associate_id)}
                    className={clsx(
                      'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150',
                      isSelected
                        ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40 hover:shadow-sm'
                    )}
                  >
                    {agent.image_url ? (
                      <img src={agent.image_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" />
                    ) : (
                      <div className={clsx(
                        'h-12 w-12 rounded-full flex items-center justify-center text-base font-bold ring-2 ring-white shadow',
                        isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      )}>
                        {(agent.full_name ?? '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="w-full min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-800 leading-4">{agent.full_name ?? 'Unknown'}</p>
                      <p className={clsx('mt-0.5 text-[11px] font-medium', count > 0 ? (isSelected ? 'text-emerald-600' : 'text-slate-500') : 'text-slate-300')}>
                        {count} {count === 1 ? 'listing' : 'listings'}
                      </p>
                    </div>
                  </button>
                );
              })}
          </div>

          {toAgentId && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-slate-800">Transfer to {toAgent?.full_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {primaryListings.length} {primaryListings.length === 1 ? 'listing' : 'listings'} from{' '}
                  <span className="font-medium">{selectedAgent.full_name}</span> will be transferred and republished under{' '}
                  <span className="font-medium">{toAgent?.full_name}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('transfer-confirm')}
                className="shrink-0 ml-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Review & Transfer
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Transfer: confirmation modal ── */}
      {step === 'transfer-confirm' && selectedAgent && toAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Confirm Listing Transfer</h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Transfer <strong>{primaryListings.length} {primaryListings.length === 1 ? 'listing' : 'listings'}</strong> from{' '}
              <strong>{selectedAgent.full_name}</strong> to <strong>{toAgent.full_name}</strong>.
            </p>
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
              Each listing will be withdrawn from all portals, duplicated as a new listing under{' '}
              <strong>{toAgent.full_name}</strong>, and republished. The original listings will be marked Inactive.
              {secondaryListings.length > 0 && (
                <span> {selectedAgent.full_name} will also be removed from {secondaryListings.length} supporting agent {secondaryListings.length === 1 ? 'role' : 'roles'}.</span>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setStep('transfer-select-target')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Back
              </button>
              <button type="button" onClick={startTransfer} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">
                Start Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transfer / Withdraw: running progress modal ── */}
      {(step === 'transfer-running' || step === 'withdraw-running') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">
              {step === 'transfer-running' ? 'Transferring Listings…' : 'Withdrawing Listings…'}
            </h3>

            {step === 'transfer-running' && transferJob && (() => {
              const pct = Math.round((transferJob.completed / Math.max(transferJob.total, 1)) * 100);
              return (
                <>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>{transferJob.fromAgentName} → {transferJob.toAgentName}</span>
                      <span>{transferJob.completed} / {transferJob.total}</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all duration-500', transferJob.status === 'done' ? 'bg-emerald-500' : transferJob.status === 'failed' ? 'bg-red-500' : 'bg-red-600')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className={clsx('text-sm', (transferJob.status === 'running' || transferJob.status === 'pending') ? 'text-slate-600 animate-pulse' : transferJob.status === 'done' ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium')}>
                    {(transferJob.status === 'running' || transferJob.status === 'pending') ? 'Processing… please wait.' : transferJob.status === 'done' ? '✓ Transfer complete!' : `Transfer failed: ${transferJob.error}`}
                  </p>
                  {transferJob.results.length > 0 && (
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                      {transferJob.results.map((r) => (
                        <div key={r.listingId} className={clsx('px-3 py-2', r.error ? 'bg-red-50' : 'bg-white')}>
                          <p className="font-medium text-slate-800">{r.listingNumber ?? `#${r.listingId}`} — {r.address ?? 'No address'}</p>
                          {r.newListingNumber && <p className="text-emerald-700 text-[11px] mt-0.5">New listing: <span className="font-semibold">{r.newListingNumber}</span></p>}
                          {r.error && <p className="text-red-600 mt-0.5">Error: {r.error}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {step === 'withdraw-running' && withdrawJob && (() => {
              const pct = Math.round((withdrawJob.completed / Math.max(withdrawJob.total, 1)) * 100);
              return (
                <>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Withdrawing all listings for {withdrawJob.agentName}</span>
                      <span>{withdrawJob.completed} / {withdrawJob.total}</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all duration-500', withdrawJob.status === 'done' ? 'bg-emerald-500' : withdrawJob.status === 'failed' ? 'bg-red-500' : 'bg-red-600')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className={clsx('text-sm', (withdrawJob.status === 'running' || withdrawJob.status === 'pending') ? 'text-slate-600 animate-pulse' : withdrawJob.status === 'done' ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium')}>
                    {(withdrawJob.status === 'running' || withdrawJob.status === 'pending') ? 'Withdrawing from portals… please wait.' : withdrawJob.status === 'done' ? '✓ All listings withdrawn!' : `Withdrawal failed: ${withdrawJob.error}`}
                  </p>
                  {withdrawJob.results.length > 0 && (
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                      {withdrawJob.results.map((r) => (
                        <div key={r.listingId} className={clsx('px-3 py-2', r.error ? 'bg-red-50' : 'bg-white')}>
                          <p className="font-medium text-slate-800">
                            {r.listingNumber ?? `#${r.listingId}`} — {r.address ?? 'No address'}
                            <span className={clsx('ml-2 text-[10px] font-semibold', r.wasPrimary ? 'text-red-600' : 'text-slate-400')}>
                              {r.wasPrimary ? 'PRIMARY' : 'SUPPORTING'}
                            </span>
                          </p>
                          {r.error && <p className="text-red-600 mt-0.5">Error: {r.error}</p>}
                          {!r.error && r.wasPrimary && r.portals.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {r.portals.map((p) => (
                                <span key={p.portal} className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', p.withdrawOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                                  {p.portal}: {p.withdrawOk ? '✓' : '✗'}
                                </span>
                              ))}
                            </div>
                          )}
                          {!r.error && !r.wasPrimary && <p className="text-slate-400 mt-0.5 text-[11px]">Removed as supporting agent</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Withdraw confirm modal ── */}
      {step === 'withdraw-confirm' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Withdraw All Listings</h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              We are now going to <strong>withdraw all of {selectedAgent.full_name}'s listings from all portals</strong>.
            </p>
            {primaryListings.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-1">
                <p><strong>{primaryListings.length} primary {primaryListings.length === 1 ? 'listing' : 'listings'}:</strong> Will be fully withdrawn from all portals (Property24, Private Property, KWW, Entegral) and marked as Inactive/Withdrawn.</p>
                {secondaryListings.length > 0 && (
                  <p><strong>{secondaryListings.length} supporting {secondaryListings.length === 1 ? 'role' : 'roles'}:</strong> {selectedAgent.full_name} will be removed from these listings. The listings themselves will remain active.</p>
                )}
              </div>
            )}
            {primaryListings.length === 0 && secondaryListings.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <p>{selectedAgent.full_name} will be removed as a supporting agent from <strong>{secondaryListings.length} {secondaryListings.length === 1 ? 'listing' : 'listings'}</strong>. Those listings will remain active.</p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setStep('action-modal')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Back
              </button>
              <button type="button" onClick={startWithdrawal} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">
                Continue — Withdraw All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transfer done: proceed to deactivation ── */}
      {step === 'transfer-done' && selectedAgent && transferJob && (
        <div className="surface-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-emerald-600"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Listing transfer complete!</h3>
              <p className="text-sm text-slate-500">
                {transferJob.completed} {transferJob.completed === 1 ? 'listing has' : 'listings have'} been transferred to{' '}
                <span className="font-medium">{transferJob.toAgentName}</span>. You can now deactivate{' '}
                <span className="font-medium">{selectedAgent.full_name}</span>.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep('deactivation-reason')}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Deactivate {selectedAgent.full_name}
            </button>
          </div>
        </div>
      )}

      {/* ── Withdraw done: proceed to deactivation ── */}
      {step === 'withdraw-done' && selectedAgent && withdrawJob && (
        <div className="surface-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-emerald-600"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">All listings have been processed!</h3>
              <p className="text-sm text-slate-500">
                {withdrawJob.results.filter((r) => r.wasPrimary).length} primary {withdrawJob.results.filter((r) => r.wasPrimary).length === 1 ? 'listing has' : 'listings have'} been withdrawn from all portals.
                {withdrawJob.results.filter((r) => !r.wasPrimary).length > 0 && (
                  <> {withdrawJob.results.filter((r) => !r.wasPrimary).length} supporting agent {withdrawJob.results.filter((r) => !r.wasPrimary).length === 1 ? 'role has' : 'roles have'} been removed.</>
                )}
                {' '}You can now deactivate <span className="font-medium">{selectedAgent.full_name}</span>.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep('deactivation-reason')}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Deactivate {selectedAgent.full_name}
            </button>
          </div>
        </div>
      )}

      {/* ── Deactivation reason modal ── */}
      {step === 'deactivation-reason' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Deregister {selectedAgent.full_name}</h3>
            <p className="text-sm text-slate-600">
              Please provide a reason for deregistering this agent. This will be recorded in the audit log.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Reason for deregistration <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Agent has resigned from the company, effective 2026-05-08…"
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
              />
            </div>
            {deactivateError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 space-y-2">
                <p>{deactivateError}</p>
                {portalRemoval && (
                  <div className="space-y-1.5 border-t border-red-200 pt-2">
                    {[portalRemoval.property24, portalRemoval.privateProperty].map((item) => (
                      <div key={item.portal} className="text-xs">
                        <span className="font-semibold">{item.portal}:</span>{' '}
                        {item.removed ? 'Removed' : `Failed${item.details ? ` - ${item.details}` : ''}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={resetFlow}
                disabled={deactivateLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeactivation}
                disabled={!reason.trim() || deactivateLoading}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deactivateLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    Deactivating…
                  </span>
                ) : (
                  `Confirm Deregistration`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tab: Agent Reactivation
// ─────────────────────────────────────────────────────────────────────────────

type InactiveAgent = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  national_id: string | null;
  kwuid: string | null;
  image_url: string | null;
  email: string | null;
  mobile_number: string | null;
  status_name: string | null;
  source_market_center_id: string | null;
  market_center_name: string | null;
};

type ReactivationForm = {
  first_name: string;
  last_name: string;
  national_id: string;
  kwuid: string;
  ffc_number: string;
  kwsa_email: string;
  private_email: string;
  mobile_number: string;
  office_number: string;
  source_market_center_id: string;
  cap: string;
  agent_split: string;
  start_date: string;
  property24_opt_in: boolean;
  private_property_opt_in: boolean;
  entegral_opt_in: boolean;
};

type ReacStep =
  | 'search'
  | 'confirm-mc'
  | 'edit-profile'
  | 'confirm-summary'
  | 'saving'
  | 'done';

type MarketCentreOpt = { source_market_center_id: string; name: string };

function AgentReactivationTab() {
  const { token, activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();
  const mcSourceId = activeContext?.marketCenterId ?? null;

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InactiveAgent[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Flow
  const [step, setStep] = useState<ReacStep>('search');
  const [selectedAgent, setSelectedAgent] = useState<InactiveAgent | null>(null);
  const [form, setForm] = useState<ReactivationForm>({
    first_name: '', last_name: '', national_id: '', kwuid: '', ffc_number: '',
    kwsa_email: '', private_email: '', mobile_number: '', office_number: '',
    source_market_center_id: '', cap: '', agent_split: '', start_date: '',
    property24_opt_in: false, private_property_opt_in: false, entegral_opt_in: false,
  });
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reactivatedAt, setReactivatedAt] = useState('');

  // Market centres for dropdown
  const [marketCentres, setMarketCentres] = useState<MarketCentreOpt[]>([]);
  useEffect(() => {
    fetch('/api/market-centers?limit=250&offset=0&status=Active', {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((d: { items?: MarketCentreOpt[] }) => setMarketCentres(d.items ?? []))
      .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (activeContext?.id) h['x-active-context'] = activeContext.id;
    return h;
  }, [token, activeContext]);

  function resetFlow() {
    setStep('search');
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    setSearchError(null);
    setSelectedAgent(null);
    setSaveError(null);
    setReactivatedAt('');
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setHasSearched(true);
    try {
      const params = new URLSearchParams({ search: searchQuery.trim(), status: 'Inactive', limit: '20', offset: '0' });
      const r = await fetch(`/api/associates?${params.toString()}`, { headers: authHeaders() });
      const data = await r.json() as { items?: InactiveAgent[]; error?: string };
      if (data.error) throw new Error(data.error);
      setSearchResults(data.items ?? []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchLoading(false);
    }
  }

  async function selectAgent(agent: InactiveAgent) {
    setSelectedAgent(agent);
    // Load full details to pre-fill the form
    try {
      const r = await fetch(`/api/agents/${agent.id}/details`, { headers: authHeaders() });
      const details = await r.json() as Record<string, unknown>;
      setForm({
        first_name: (details.first_name as string | undefined) ?? agent.first_name ?? '',
        last_name: (details.last_name as string | undefined) ?? agent.last_name ?? '',
        national_id: (details.national_id as string | undefined) ?? agent.national_id ?? '',
        kwuid: (details.kwuid as string | undefined) ?? agent.kwuid ?? '',
        ffc_number: (details.ffc_number as string | undefined) ?? '',
        kwsa_email: (details.kwsa_email as string | undefined) ?? agent.email ?? '',
        private_email: (details.private_email as string | undefined) ?? '',
        mobile_number: (details.mobile_number as string | undefined) ?? agent.mobile_number ?? '',
        office_number: (details.office_number as string | undefined) ?? '',
        source_market_center_id: mcSourceId ?? agent.source_market_center_id ?? '',
        cap: (details.cap as string | undefined) ?? '',
        agent_split: (details.agent_split as string | undefined) ?? '',
        start_date: '',
        property24_opt_in: Boolean(details.property24_opt_in),
        private_property_opt_in: Boolean(details.private_property_opt_in),
        entegral_opt_in: Boolean(details.entegral_opt_in),
      });
    } catch {
      // Use what we have from the list row
      setForm((p) => ({
        ...p,
        first_name: agent.first_name ?? '',
        last_name: agent.last_name ?? '',
        national_id: agent.national_id ?? '',
        kwuid: agent.kwuid ?? '',
        kwsa_email: agent.email ?? '',
        mobile_number: agent.mobile_number ?? '',
        source_market_center_id: mcSourceId ?? agent.source_market_center_id ?? '',
        property24_opt_in: false,
        private_property_opt_in: false,
        entegral_opt_in: false,
      }));
    }
    setStep('confirm-mc');
  }

  const selectedMCName = marketCentres.find((mc) => mc.source_market_center_id === form.source_market_center_id)?.name ?? form.source_market_center_id;
  const currentMCName = marketCentres.find((mc) => mc.source_market_center_id === mcSourceId)?.name ?? mcSourceId ?? 'your market centre';
  const marketCentreLabel = (name: string) => (name.trim().toUpperCase().startsWith('KW ') ? name : `KW ${name}`);

  async function saveAndReactivate() {
    if (!selectedAgent) return;
    setSaveLoading(true);
    setSaveError(null);
    try {
      // Compute full_name
      const fullName = [form.first_name, form.last_name].filter(Boolean).join(' ').trim() ||
        (selectedAgent.full_name ?? 'Unknown');

      const payload = {
        agentId: Number(selectedAgent.id),
        first_name: form.first_name,
        last_name: form.last_name,
        full_name: fullName,
        national_id: form.national_id,
        kwuid: form.kwuid,
        ffc_number: form.ffc_number,
        kwsa_email: form.kwsa_email,
        private_email: form.private_email,
        mobile_number: form.mobile_number,
        office_number: form.office_number,
        image_url: selectedAgent.image_url ?? '',
        source_market_center_id: form.source_market_center_id,
        cap: form.cap,
        agent_split: form.agent_split,
        start_date: form.start_date || null,
        property24_opt_in: form.property24_opt_in,
        private_property_opt_in: form.private_property_opt_in,
        entegral_opt_in: form.entegral_opt_in,
        status_name: 'Active',
      };

      const res = await fetch('/api/agent-deregistration/reactivate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await res.json() as { id?: string; success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setSaveError(data.error ?? 'Failed to reactivate agent.');
        return;
      }

      setReactivatedAt(selectedMCName);
      setStep('done');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaveLoading(false);
    }
  }

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return <div className="text-slate-500 text-sm py-8 text-center">Agent Reactivation is only available to Office Admins and Regional Admins.</div>;
  }

  const agentDisplayName = (a: InactiveAgent) =>
    a.full_name?.trim() || [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Unknown';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Agent Reactivation</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Search for a previously inactive agent by ID number or KWUID and reactivate them at your market centre.
        </p>
      </div>

      <div className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">How It Works</p>
        <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-3">
          <li>1. Search by ID number, KWUID, or name</li>
          <li>2. Confirm target market centre and update profile details</li>
          <li>3. Review summary and complete reactivation</li>
        </ul>
      </div>

      {/* ── Done ── */}
      {step === 'done' && selectedAgent && (
        <div className="surface-card p-8 flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-emerald-600"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {agentDisplayName(selectedAgent)} has been reactivated at {marketCentreLabel(reactivatedAt)}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              This agent is now active and will appear in the agent roster for their market centre.
            </p>
          </div>
          <button type="button" onClick={resetFlow} className="mt-2 rounded-lg border border-slate-300 px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Reactivate Another Agent
          </button>
        </div>
      )}

      {/* ── Search ── */}
      {step === 'search' && (
        <div className="surface-card p-5 space-y-4">
          <p className="text-sm font-medium text-slate-600">
            Enter the agent's <strong>ID Number</strong> or <strong>KWUID</strong> to search the inactive associate database:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="ID number, KWUID, or name…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={!searchQuery.trim() || searchLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {searchLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              ) : 'Search'}
            </button>
          </div>

          {searchError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{searchError}</div>}

          {hasSearched && !searchLoading && searchResults.length === 0 && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
              No inactive agents found matching <strong>{searchQuery}</strong>. Try a different ID number or KWUID.
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Agent</th>
                    <th className="px-3 py-2.5 text-left">ID Number</th>
                    <th className="px-3 py-2.5 text-left">KWUID</th>
                    <th className="px-3 py-2.5 text-left">Last Market Centre</th>
                    <th className="px-3 py-2.5 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {searchResults.map((agent) => (
                    <tr key={agent.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          {agent.image_url ? (
                            <img src={agent.image_url} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-white shadow-sm" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                              {(agentDisplayName(agent))[0].toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-slate-800">{agentDisplayName(agent)}</p>
                            <p className="text-xs text-slate-500">{agent.email ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs">{agent.national_id ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs">{agent.kwuid ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600 text-xs">{agent.market_center_name ?? agent.source_market_center_id ?? '—'}</td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => selectAgent(agent)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm MC modal ── */}
      {step === 'confirm-mc' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {selectedAgent.image_url ? (
                <img src={selectedAgent.image_url} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow" />
              ) : (
                <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center text-xl font-bold text-slate-500 ring-2 ring-white shadow">
                  {(agentDisplayName(selectedAgent))[0].toUpperCase()}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-slate-800">{agentDisplayName(selectedAgent)}</h3>
                <p className="text-sm text-slate-500">
                  Was an agent at{' '}
                  <span className="font-medium text-slate-700">
                    {selectedAgent.market_center_name ?? selectedAgent.source_market_center_id ?? 'an unknown market centre'}
                  </span>
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              Would you like to reactivate <strong>{agentDisplayName(selectedAgent)}</strong> at{' '}
              <strong>{marketCentreLabel(currentMCName)}</strong>?
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={resetFlow} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                No, Cancel
              </button>
              <button type="button" onClick={() => setStep('edit-profile')} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                Yes — Review &amp; Update Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit profile ── */}
      {step === 'edit-profile' && selectedAgent && (
        <div className="surface-card p-5 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">Review &amp; Update Agent Profile</h3>
              <p className="text-sm text-slate-500 mt-0.5">
                Check all details are correct before reactivating{' '}
                <span className="font-medium">{agentDisplayName(selectedAgent)}</span>.
              </p>
            </div>
            <button type="button" onClick={resetFlow} className="text-slate-400 hover:text-slate-600 text-xl ml-4">✕</button>
          </div>

          {/* Personal */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Personal Information</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">First Name <span className="text-red-500">*</span></span>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Last Name <span className="text-red-500">*</span></span>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">ID Number (National ID)</span>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none" value={form.national_id} onChange={(e) => setForm((p) => ({ ...p, national_id: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">KWUID</span>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-red-400 focus:outline-none" value={form.kwuid} onChange={(e) => setForm((p) => ({ ...p, kwuid: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">FFC Number</span>
                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.ffc_number} onChange={(e) => setForm((p) => ({ ...p, ffc_number: e.target.value }))} />
              </label>
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Contact Details</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">KWSA Email</span>
                <input type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.kwsa_email} onChange={(e) => setForm((p) => ({ ...p, kwsa_email: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Private Email</span>
                <input type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.private_email} onChange={(e) => setForm((p) => ({ ...p, private_email: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Mobile Number</span>
                <input type="tel" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" placeholder="e.g. 0821234567" value={form.mobile_number} onChange={(e) => setForm((p) => ({ ...p, mobile_number: e.target.value.replace(/\s/g, '') }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Office Number</span>
                <input type="tel" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.office_number} onChange={(e) => setForm((p) => ({ ...p, office_number: e.target.value.replace(/\s/g, '') }))} />
              </label>
            </div>
          </div>

          {/* Market Centre & Commission */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Market Centre &amp; Commission</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Market Centre <span className="text-red-500">*</span></span>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
                  value={form.source_market_center_id}
                  onChange={(e) => setForm((p) => ({ ...p, source_market_center_id: e.target.value }))}
                >
                  <option value="">— Select Market Centre —</option>
                  {marketCentres.map((mc) => (
                    <option key={mc.source_market_center_id} value={mc.source_market_center_id}>{mc.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Cap Amount (R)</span>
                <input type="number" min="0" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" placeholder="e.g. 29000" value={form.cap} onChange={(e) => setForm((p) => ({ ...p, cap: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Agent Split (%)</span>
                <input type="number" min="0" max="100" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" placeholder="e.g. 70" value={form.agent_split} onChange={(e) => setForm((p) => ({ ...p, agent_split: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Reactivation Start Date</span>
                <input type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
              </label>
            </div>
          </div>

          {/* Portal Opt-ins */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Portal Opt-ins</p>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-3">
              Existing portal agent IDs are intentionally not reused on reactivation. New IDs will be allocated by each portal when listings are published.
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.property24_opt_in}
                  onChange={(e) => setForm((p) => ({ ...p, property24_opt_in: e.target.checked }))}
                />
                Property24 Opt In
              </label>
              <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.private_property_opt_in}
                  onChange={(e) => setForm((p) => ({ ...p, private_property_opt_in: e.target.checked }))}
                />
                Private Property Opt In
              </label>
              <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.entegral_opt_in}
                  onChange={(e) => setForm((p) => ({ ...p, entegral_opt_in: e.target.checked }))}
                />
                Entegral Opt In
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={resetFlow} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              type="button"
              onClick={() => setStep('confirm-summary')}
              disabled={!form.first_name.trim() || !form.last_name.trim() || !form.source_market_center_id}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reactivate →
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm summary modal ── */}
      {step === 'confirm-summary' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Confirm Reactivation</h3>
            <p className="text-sm text-slate-500">
              You are about to reactivate the following agent at <strong>{marketCentreLabel(selectedMCName)}</strong>:
            </p>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
              {[
                { label: 'Name', value: [form.first_name, form.last_name].filter(Boolean).join(' ') || agentDisplayName(selectedAgent) },
                { label: 'ID Number', value: form.national_id || '—' },
                { label: 'KWUID', value: form.kwuid || '—' },
                { label: 'Mobile Number', value: form.mobile_number || '—' },
                { label: 'KWSA Email', value: form.kwsa_email || '—' },
                { label: 'Market Centre', value: marketCentreLabel(selectedMCName) },
                { label: 'Cap Amount', value: form.cap ? `R ${Number(form.cap).toLocaleString('en-ZA')}` : '—' },
                { label: 'Agent Split', value: form.agent_split ? `${form.agent_split}%` : '—' },
                { label: 'P24 Opt In', value: form.property24_opt_in ? 'Yes' : 'No' },
                { label: 'Private Property Opt In', value: form.private_property_opt_in ? 'Yes' : 'No' },
                { label: 'Entegral Opt In', value: form.entegral_opt_in ? 'Yes' : 'No' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 text-xs font-semibold text-slate-500">{label}</span>
                  <span className="text-slate-800 font-medium truncate">{value}</span>
                </div>
              ))}
            </div>

            {saveError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{saveError}</div>}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => { setSaveError(null); setStep('edit-profile'); }} disabled={saveLoading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Edit
              </button>
              <button type="button" onClick={saveAndReactivate} disabled={saveLoading} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {saveLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    Reactivating…
                  </span>
                ) : 'Continue — Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tab: MC Document Hub
// ─────────────────────────────────────────────────────────────────────────────

type DocHubFolder = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
};

type DocHubItem = {
  id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  file_url: string;
  original_file_name: string;
  mime_type: string;
  file_size: string | null;
  uploaded_by: string | null;
  created_at: string;
};

type DocHubResponse = {
  folders?: DocHubFolder[];
  documents?: DocHubItem[];
  error?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocTypeIcon({ mime }: { mime: string }) {
  if (mime === 'application/pdf') {
    return (
      <div className="h-12 w-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-red-600">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </div>
    );
  }
  return (
    <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-blue-600">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M3 9l5 5 4-4 9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor"/>
      </svg>
    </div>
  );
}

function MCDocumentHubTab() {
  const { token, activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();

  const [folders, setFolders] = useState<DocHubFolder[]>([]);
  const [docs, setDocs] = useState<DocHubItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFolderId, setUploadFolderId] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<DocHubFolder | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderDesc, setFolderDesc] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [movingDocId, setMovingDocId] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const authFetchHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (activeContext?.id) h['x-active-context'] = activeContext.id;
    return h;
  }, [token, activeContext]);

  useEffect(() => {
    loadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDocs() {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const r = await fetch('/api/mc-document-hub', { headers: authFetchHeaders() });
      const data = await r.json() as DocHubResponse;
      if (data.error) throw new Error(data.error);
      setFolders(data.folders ?? []);
      setDocs(data.documents ?? []);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocsLoading(false);
    }
  }

  function resetUploadForm() {
    setUploadTitle('');
    setUploadDesc('');
    setUploadFolderId('');
    setUploadFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function openCreateFolderModal() {
    setEditingFolder(null);
    setFolderName('');
    setFolderDesc('');
    setFolderError(null);
    setShowFolderModal(true);
  }

  function openEditFolderModal(folder: DocHubFolder) {
    setEditingFolder(folder);
    setFolderName(folder.name);
    setFolderDesc(folder.description ?? '');
    setFolderError(null);
    setShowFolderModal(true);
  }

  async function handleSaveFolder() {
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setFolderError('Folder name is required.');
      return;
    }
    setFolderSaving(true);
    setFolderError(null);
    try {
      const isEdit = Boolean(editingFolder);
      const endpoint = isEdit ? `/api/mc-document-hub/folders/${editingFolder!.id}` : '/api/mc-document-hub/folders';
      const method = isEdit ? 'PATCH' : 'POST';
      const r = await fetch(endpoint, {
        method,
        headers: {
          ...authFetchHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          description: folderDesc.trim() || null,
        }),
      });
      const data = await r.json() as (DocHubFolder & { error?: string });
      if (!r.ok || data.error) {
        setFolderError(data.error ?? 'Failed to save folder.');
        return;
      }
      if (isEdit) {
        setFolders((prev) => prev.map((f) => (f.id === data.id ? data : f)));
      } else {
        setFolders((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setShowFolderModal(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setFolderSaving(false);
    }
  }

  async function handleDeleteFolder(id: string) {
    setDeletingFolder(true);
    try {
      const r = await fetch(`/api/mc-document-hub/folders/${id}`, {
        method: 'DELETE',
        headers: authFetchHeaders(),
      });
      const data = await r.json() as { success?: boolean; error?: string };
      if (!r.ok || !data.success) {
        alert(data.error ?? 'Failed to delete folder.');
        return;
      }
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setDocs((prev) => prev.map((d) => (d.folder_id === id ? { ...d, folder_id: null } : d)));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingFolder(false);
      setDeleteFolderId(null);
    }
  }

  async function handleMoveDoc(id: string, folderId: string) {
    setMovingDocId(id);
    try {
      const r = await fetch(`/api/mc-document-hub/${id}/move`, {
        method: 'PATCH',
        headers: {
          ...authFetchHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder_id: folderId || null }),
      });
      const data = await r.json() as { success?: boolean; folder_id?: string | null; error?: string };
      if (!r.ok || !data.success) {
        alert(data.error ?? 'Failed to move document.');
        return;
      }
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folder_id: data.folder_id ?? null } : d)));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setMovingDocId(null);
    }
  }

  async function handleUpload() {
    if (!uploadFile || !uploadTitle.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('title', uploadTitle.trim());
      fd.append('description', uploadDesc.trim());
      if (uploadFolderId) fd.append('folder_id', uploadFolderId);
      fd.append('file', uploadFile);
      const r = await fetch('/api/mc-document-hub', {
        method: 'POST',
        headers: authFetchHeaders(), // no Content-Type — let browser set multipart boundary
        body: fd,
      });
      const data = await r.json() as (DocHubItem & { error?: string });
      if (!r.ok || data.error) {
        setUploadError(data.error ?? 'Upload failed.');
        return;
      }
      setDocs((prev) => [data, ...prev]);
      setShowUpload(false);
      resetUploadForm();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const r = await fetch(`/api/mc-document-hub/${id}`, {
        method: 'DELETE',
        headers: authFetchHeaders(),
      });
      const data = await r.json() as { success?: boolean; error?: string };
      if (!r.ok || !data.success) {
        alert(data.error ?? 'Failed to delete document.');
        return;
      }
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  const rootDocs = useMemo(() => docs.filter((d) => !d.folder_id), [docs]);
  const docsByFolder = useMemo(() => {
    const map = new Map<string, DocHubItem[]>();
    for (const doc of docs) {
      if (!doc.folder_id) continue;
      const existing = map.get(doc.folder_id) ?? [];
      existing.push(doc);
      map.set(doc.folder_id, existing);
    }
    return map;
  }, [docs]);

  function renderDocCard(doc: DocHubItem) {
    const sizeBytes = doc.file_size ? Number(doc.file_size) : null;
    const isPdf = doc.mime_type === 'application/pdf';
    const uploadDate = new Date(doc.created_at).toLocaleDateString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    return (
      <div
        key={doc.id}
        className="surface-card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
      >
        <div className="flex items-start gap-3">
          <DocTypeIcon mime={doc.mime_type} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800 text-sm leading-5 line-clamp-2">{doc.title}</p>
            {doc.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{doc.description}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
          <span>{isPdf ? 'PDF' : doc.mime_type.split('/')[1].toUpperCase()}</span>
          {sizeBytes !== null && <span>{formatBytes(sizeBytes)}</span>}
          <span>{uploadDate}</span>
        </div>

        <p className="text-[11px] text-slate-400 truncate" title={doc.original_file_name}>
          {doc.original_file_name}
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Folder</span>
          <select
            value={doc.folder_id ?? ''}
            onChange={(e) => void handleMoveDoc(doc.id, e.target.value)}
            disabled={movingDocId === doc.id}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
          >
            <option value="">Root (no folder)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 mt-auto pt-1 border-t border-slate-100">
          <a
            href={doc.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            View
          </a>
          <button
            type="button"
            onClick={() => setDeleteId(doc.id)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Delete
          </button>
        </div>
      </div>
    );
  }

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        MC Document Hub is only available to Office Admins and Regional Admins.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">MC Document Hub</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Organize documents in one-level folders for your market centre.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
              {docs.length} document{docs.length === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
              {folders.length} folder{folders.length === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-500">
              Supported: PDF, JPG, PNG (max 20 MB)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateFolderModal}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.8"/><path d="M12 11v6M9 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Add Folder
          </button>
          <button
            type="button"
            onClick={() => { resetUploadForm(); setShowUpload(true); }}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
            Add Document
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {docsLoading && (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500 justify-center">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
          Loading documents…
        </div>
      )}
      {docsError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{docsError}</div>
      )}

      {/* Empty state */}
      {!docsLoading && !docsError && docs.length === 0 && (
        <div className="surface-card p-12 flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-slate-400">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">No documents yet</p>
            <p className="text-xs text-slate-500 mt-1">Click <strong>Add Document</strong> to upload your first document to this market centre.</p>
          </div>
        </div>
      )}

      {!docsLoading && (folders.length > 0 || docs.length > 0) && (
        <div className="space-y-6">
          {rootDocs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Root Documents</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {rootDocs.map((doc) => renderDocCard(doc))}
              </div>
            </div>
          )}

          {folders.map((folder) => {
            const folderDocs = docsByFolder.get(folder.id) ?? [];
            return (
              <div key={folder.id} className="surface-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-amber-500"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.8"/></svg>
                      <h3 className="text-sm font-semibold text-slate-800">{folder.name}</h3>
                      <span className="text-xs text-slate-500">{folderDocs.length} file{folderDocs.length === 1 ? '' : 's'}</span>
                    </div>
                    {folder.description && <p className="text-xs text-slate-500 mt-1">{folder.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditFolderModal(folder)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteFolderId(folder.id)}
                      className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {folderDocs.length === 0 ? (
                  <p className="text-xs text-slate-500">No documents in this folder yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {folderDocs.map((doc) => renderDocCard(doc))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Upload modal ── */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Add Document</h3>
              <button type="button" onClick={() => { setShowUpload(false); resetUploadForm(); }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Document Name <span className="text-red-500">*</span></span>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g. KW Action Exclusive Mandate"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Description <span className="text-slate-400 font-normal">(optional)</span></span>
              <textarea
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="Short description of what this document is for…"
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Folder <span className="text-slate-400 font-normal">(optional)</span></span>
              <select
                value={uploadFolderId}
                onChange={(e) => setUploadFolderId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              >
                <option value="">Root (no folder)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">File <span className="text-red-500">*</span></span>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={clsx(
                  'cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                  uploadFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-red-300 hover:bg-red-50/30'
                )}
              >
                {uploadFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-emerald-700">{uploadFile.name}</p>
                    <p className="text-xs text-emerald-600">{formatBytes(uploadFile.size)}</p>
                    <p className="text-xs text-slate-400">Click to change</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-slate-300 mx-auto"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <p className="text-sm font-medium text-slate-600">Click to select a file</p>
                    <p className="text-xs text-slate-400">PDF, JPEG, or PNG — max 20 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setUploadFile(f);
                  setUploadError(null);
                }}
              />
            </div>

            {uploadError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{uploadError}</div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => { setShowUpload(false); resetUploadForm(); }} disabled={uploading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!uploadFile || !uploadTitle.trim() || uploading}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    Uploading…
                  </span>
                ) : 'Upload Document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Folder create/edit modal ── */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">{editingFolder ? 'Edit Folder' : 'Add Folder'}</h3>
              <button type="button" onClick={() => setShowFolderModal(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Folder Name <span className="text-red-500">*</span></span>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="e.g. Compliance Templates"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Description <span className="text-slate-400 font-normal">(optional)</span></span>
              <textarea
                value={folderDesc}
                onChange={(e) => setFolderDesc(e.target.value)}
                placeholder="Short description for this folder..."
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
              />
            </label>

            {folderError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{folderError}</div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => setShowFolderModal(false)} disabled={folderSaving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveFolder}
                disabled={folderSaving || !folderName.trim()}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {folderSaving ? 'Saving…' : (editingFolder ? 'Save Changes' : 'Create Folder')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Folder delete confirm modal ── */}
      {deleteFolderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">Delete Folder?</h3>
            <p className="text-sm text-slate-600">
              This will delete <strong>{folders.find((f) => f.id === deleteFolderId)?.name ?? 'this folder'}</strong>.
              The folder must be empty before it can be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteFolderId(null)} disabled={deletingFolder} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteFolder(deleteFolderId)}
                disabled={deletingFolder}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingFolder ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">Delete Document?</h3>
            <p className="text-sm text-slate-600">
              This will permanently remove{' '}
              <strong>{docs.find((d) => d.id === deleteId)?.title ?? 'this document'}</strong> from the MC Document Hub. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteId(null)} disabled={deleting} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteId)}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page — MC Admin Tools with sub-tabs
// ─────────────────────────────────────────────────────────────────────────────

type LoginActivityRow = {
  id: string;
  associate_name: string | null;
  market_center_name: string | null;
  associate_phone: string | null;
  associate_email: string;
  logged_in_at: string;
  login_method: string;
};

type LoginActivityResponse = {
  date: string;
  count: number;
  items: LoginActivityRow[];
};

function toInputDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function LoginActivityTab() {
  const { token, activeContext } = useAuth();
  const [date, setDate] = useState<string>(toInputDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LoginActivityRow[]>([]);
  const [lastLoadedDate, setLastLoadedDate] = useState<string | null>(null);

  async function loadActivity() {
    if (!date) {
      setError('Please select a date.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeContext?.id) headers['x-active-context'] = activeContext.id;

      const res = await fetch(`/api/login-activity?date=${encodeURIComponent(date)}`, {
        headers,
      });

      const body = await res.json() as LoginActivityResponse | { error?: string };
      if (!res.ok) {
        throw new Error((body as { error?: string })?.error ?? `Failed to load (${res.status})`);
      }

      setRows((body as LoginActivityResponse).items ?? []);
      setLastLoadedDate(date);
    } catch (err) {
      setRows([]);
      setLastLoadedDate(null);
      setError(err instanceof Error ? err.message : 'Failed to load login activity.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="surface-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Login Activity</h2>
          <p className="mt-1 text-sm text-slate-500">
            Select a date and click Load to view who logged into MAPP on that date.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-red-400 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadActivity()}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {lastLoadedDate && !error && (
        <p className="mt-4 text-sm text-slate-500">
          Showing {rows.length} login {rows.length === 1 ? 'entry' : 'entries'} for {lastLoadedDate}.
        </p>
      )}

      {!loading && !error && lastLoadedDate && rows.length === 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No login activity found for this date.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Associate Name</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Market Centre</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Phone</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Email</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Logged In At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-slate-800">{row.associate_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{row.market_center_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{row.associate_phone ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{row.associate_email}</td>
                  <td className="px-3 py-2 text-slate-600">{new Date(row.logged_in_at).toLocaleString('en-ZA')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type SubTab = 'mc-dashboard' | 'rentals' | 'listing-transfer' | 'agent-deregistration' | 'agent-reactivation' | 'mc-document-hub' | 'login-activity';

const BASE_SUB_TABS: { id: Exclude<SubTab, 'login-activity'>; label: string }[] = [
  { id: 'mc-dashboard', label: 'MC Dashboard' },
  { id: 'rentals', label: 'Rentals' },
  { id: 'listing-transfer', label: 'Listing Transfer' },
  { id: 'agent-deregistration', label: 'Agent Deregistration' },
  { id: 'agent-reactivation', label: 'Agent Reactivation' },
  { id: 'mc-document-hub', label: 'MC Document Hub' },
];

export default function MCAdminToolsPage() {
  const { user, isOfficeAdmin, isRegionalAdmin } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('mc-dashboard');
  const subTabs: { id: SubTab; label: string }[] = [
    ...BASE_SUB_TABS,
    ...(isRegionalAdmin ? [{ id: 'login-activity' as const, label: 'Login Activity' }] : []),
  ];

  useEffect(() => {
    const exists = subTabs.some((tab) => tab.id === activeSubTab);
    if (!exists) {
      setActiveSubTab('mc-dashboard');
    }
  }, [activeSubTab, subTabs]);

  if (!isOfficeAdmin && !isRegionalAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500 text-sm">
          You do not have permission to access MC Admin Tools.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title text-2xl sm:text-3xl lg:text-4xl">MC Admin Tools</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Administrative tools for Office Admins and Regional Admins.
          </p>
        </div>
      </div>

      {/* Sub-tab bar */}
      <section className="surface-card p-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0',
                activeSubTab === tab.id
                  ? 'bg-red-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Sub-tab content */}
      {activeSubTab === 'mc-dashboard' && (
        <MCDashboardTab
          userName={user?.name}
          onQuickAction={(tab) => setActiveSubTab(tab)}
        />
      )}
      {activeSubTab === 'rentals' && <RentalsPage />}
      {activeSubTab === 'listing-transfer' && <ListingTransferTab />}
      {activeSubTab === 'agent-deregistration' && <AgentDeregistrationTab />}
      {activeSubTab === 'agent-reactivation' && <AgentReactivationTab />}
      {activeSubTab === 'mc-document-hub' && <MCDocumentHubTab />}
      {activeSubTab === 'login-activity' && isRegionalAdmin && <LoginActivityTab />}
    </div>
  );
}
