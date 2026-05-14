import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type AssociateRow = {
  id: string;
  source_associate_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status_name: string | null;
  kwuid: string | null;
  image_url: string | null;
  source_market_center_id: string | null;
  source_team_id: string | null;
  market_center_name: string | null;
  market_center_logo_url: string | null;
  updated_at: string;
};

type AssociatesResponse = {
  total: number;
  limit: number;
  offset: number;
  items: AssociateRow[];
};

const PAGE_SIZE = 20;
type AssociatesView = 'cards' | 'list';
const STATUS_FILTERS = ['All', 'Active', 'Inactive', 'Pending'] as const;

function toShortDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
}

function associateName(item: AssociateRow): string {
  return item.full_name || [item.first_name, item.last_name].filter(Boolean).join(' ') || item.source_associate_id;
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function statusBadgeClass(status: string | null): string {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'active' || normalized === '1') return 'status-chip good';
  if (normalized === 'inactive' || normalized === '0') return 'status-chip';
  return 'status-chip warn';
}

function HeaderIcon({ kind }: { kind: 'search' | 'status' }) {
  if (kind === 'search') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
      <path d="M5 7h14M8 12h8M10 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

async function fetchAssociates(page: number, search: string, status: string): Promise<AssociatesResponse> {
  const offset = (page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  if (search.trim().length > 0) {
    params.set('search', search.trim());
  }

  if (status !== 'All') {
    params.set('status', status);
  }

  const response = await fetch(`/api/associates?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Unable to load associates from database');
  }

  return response.json() as Promise<AssociatesResponse>;
}

export default function AssociatesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [view, setView] = useState<AssociatesView>('cards');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['associates', page, search, status],
    queryFn: () => fetchAssociates(page, search, status),
    placeholderData: (previousData) => previousData,
  });

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data?.total]);

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const activeOnPage = (data?.items ?? []).filter((item) => {
    const normalized = (item.status_name ?? '').trim().toLowerCase();
    return normalized === 'active' || normalized === '1';
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Associates</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <button
              className={`rounded-md px-3 py-1.5 ${view === 'cards' ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              type="button"
              onClick={() => setView('cards')}
            >
              Cards
            </button>
            <button
              className={`rounded-md px-3 py-1.5 ${view === 'list' ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              type="button"
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
          <button className="primary-btn" type="button">Add Associate</button>
        </div>
      </div>

      <section className="surface-card p-4 md:p-5">
        <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-3 md:px-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative w-full md:max-w-xl">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                <HeaderIcon kind="search" />
              </span>
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, email, KWUID or market center..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-0"
              />
            </label>

            <label className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                <HeaderIcon kind="status" />
              </span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as (typeof STATUS_FILTERS)[number]);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900"
              >
                {STATUS_FILTERS.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>{statusOption}</option>
                ))}
              </select>
            </label>

            <span className="text-xs text-slate-600">Page {page} of {totalPages}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              Active on page: {activeOnPage}
            </span>
          </div>
        </div>

        {isLoading && <p className="mt-4 text-sm text-slate-500">Loading associates...</p>}

        {isError && <p className="mt-4 text-sm text-amber-700">Could not load associates from the backend API.</p>}

        {!isLoading && !isError && (data?.items.length ?? 0) === 0 && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
            No associate rows found for this filter.
          </div>
        )}

        {!isLoading && !isError && view === 'cards' && (data?.items.length ?? 0) > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data?.items.map((item) => {
              const associateImageUrl = (item.image_url ?? '').trim();

              return (
              <article key={item.id} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2.5 py-2.5">
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
                  <span className={statusBadgeClass(item.status_name)}>{item.status_name ?? 'Unknown'}</span>
                </div>

                <div className="flex items-start gap-3">
                  {associateImageUrl ? (
                    <img
                      src={associateImageUrl}
                      alt={associateName(item)}
                      className="h-11 w-11 shrink-0 rounded-full border border-slate-200 bg-white object-cover p-0.5"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-full border border-red-200 bg-red-50 text-center text-sm font-semibold leading-[2.75rem] text-red-700">
                      {initials(associateName(item))}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold leading-tight text-slate-900">{associateName(item)}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Source ID: {item.source_associate_id}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5 text-sm text-slate-700">
                  <p className="truncate">
                    {item.email ? (
                      <a href={`mailto:${item.email}`} className="text-red-700 hover:text-red-800 hover:underline">
                        {item.email}
                      </a>
                    ) : (
                      '-'
                    )}
                  </p>
                  <p>{item.kwuid ? `KWUID: ${item.kwuid}` : 'KWUID: -'}</p>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Updated {toShortDate(item.updated_at)}</span>
                  <button className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50" type="button">
                    Edit
                  </button>
                </div>
              </article>
            );})}
          </div>
        )}

        {!isLoading && !isError && view === 'list' && (data?.items.length ?? 0) > 0 && (
          <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Associate</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Market Center</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">KWUID</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                {data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{associateName(item)}</td>
                    <td className="px-3 py-2">
                      {item.email ? (
                        <a href={`mailto:${item.email}`} className="text-red-700 hover:text-red-800 hover:underline">
                          {item.email}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2">{item.market_center_name ?? item.source_market_center_id ?? '-'}</td>
                    <td className="px-3 py-2"><span className={statusBadgeClass(item.status_name)}>{item.status_name ?? 'Unknown'}</span></td>
                    <td className="px-3 py-2">{item.kwuid ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{toShortDate(item.updated_at)}</td>
                    <td className="px-3 py-2">
                      <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" type="button">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

      <div className="surface-card p-4">
        <p className="text-sm text-slate-700">
          This view is now reading directly from <span className="font-semibold">migration.core_associates</span>.
        </p>
      </div>
    </div>
  );
}
