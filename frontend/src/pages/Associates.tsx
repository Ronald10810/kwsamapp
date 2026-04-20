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
  source_market_center_id: string | null;
  source_team_id: string | null;
  updated_at: string;
};

type AssociatesResponse = {
  total: number;
  limit: number;
  offset: number;
  items: AssociateRow[];
};

const PAGE_SIZE = 20;

async function fetchAssociates(page: number, search: string): Promise<AssociatesResponse> {
  const offset = (page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  if (search.trim().length > 0) {
    params.set('search', search.trim());
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

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['associates', page, search],
    queryFn: () => fetchAssociates(page, search),
    placeholderData: (previousData) => previousData,
  });

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data?.total]);

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Associates</h1>
        <div className="flex items-center gap-2">
          <span className="status-chip info">{data?.total ?? 0} total</span>
          <button className="primary-btn" type="button" onClick={() => refetch()}>
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="surface-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, KWUID, source id"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 md:max-w-md"
          />
          <span className="text-xs text-slate-600">Page {page} of {totalPages}</span>
        </div>

        <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">KWUID</th>
                <th className="px-3 py-2">Market Center</th>
                <th className="px-3 py-2">Source ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {isLoading && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={6}>Loading associates...</td>
                </tr>
              )}

              {isError && (
                <tr>
                  <td className="px-3 py-4 text-amber-700" colSpan={6}>Could not load associates from the backend API.</td>
                </tr>
              )}

              {!isLoading && !isError && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={6}>No associate rows found for this filter.</td>
                </tr>
              )}

              {data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-medium">{item.full_name || [item.first_name, item.last_name].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-3 py-2">{item.email ?? '-'}</td>
                  <td className="px-3 py-2">{item.status_name ?? '-'}</td>
                  <td className="px-3 py-2">{item.kwuid ?? '-'}</td>
                  <td className="px-3 py-2">{item.source_market_center_id ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{item.source_associate_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
