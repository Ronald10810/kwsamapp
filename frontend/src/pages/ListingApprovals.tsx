import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type ApprovalQueueItem = {
  id: string;
  listing_id: string;
  status: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  submission_comment: string | null;
  submitted_at: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  listing_number: string | null;
  property_title: string | null;
  address_line: string | null;
  suburb: string | null;
  city: string | null;
  source_market_center_id: string | null;
};

type ApprovalQueueResponse = { items: ApprovalQueueItem[] };

const FILTERS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type QueueFilter = typeof FILTERS[number];

export default function ListingApprovalsPage() {
  const navigate = useNavigate();
  const { isOfficeAdmin, activeContext } = useAuth();
  const [filter, setFilter] = useState<QueueFilter>('PENDING');
  const [actionInFlightId, setActionInFlightId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<ApprovalQueueResponse>({
    queryKey: ['listing-approval-queue', activeContext?.id ?? 'no-context', filter],
    queryFn: async () => {
      const response = await fetch(`/api/listings/approvals/queue?status=${encodeURIComponent(filter)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Unable to load listing approvals');
      }
      return response.json() as Promise<ApprovalQueueResponse>;
    },
    enabled: isOfficeAdmin,
  });

  if (!isOfficeAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Listing Approval Queue</h1>
        <div className="surface-card p-6">
          <p className="text-sm text-slate-600">Switch to an Office Admin role to review listing approval requests.</p>
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  async function reviewListingApproval(listingId: string, action: 'approve' | 'reject'): Promise<void> {
    setActionError(null);
    setActionInFlightId(`${action}:${listingId}`);
    try {
      const comment = action === 'reject'
        ? (window.prompt('Reason for rejection (optional):') ?? '').trim()
        : 'Approved from listing approval queue';

      const response = await fetch(`/api/listings/${listingId}/${action}-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment || undefined }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to ${action} listing approval`);
      }

      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to process approval action');
    } finally {
      setActionInFlightId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Listing Approval Queue</h1>
          <p className="mt-1 text-sm text-slate-500">Review requests for {activeContext?.marketCenter ?? 'your market centre'} and open them in the listing workspace.</p>
        </div>
        <button className="primary-btn" type="button" onClick={() => void refetch()}>
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="surface-card p-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-medium ${filter === entry ? 'bg-red-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => setFilter(entry)}
            >
              {entry.charAt(0)}{entry.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {actionError && <div className="surface-card border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>}
        {isLoading && <div className="surface-card p-6 text-sm text-slate-500">Loading approval queue...</div>}
        {!isLoading && items.length === 0 && (
          <div className="surface-card p-6 text-sm text-slate-500">No {filter.toLowerCase()} listing approvals for this market centre.</div>
        )}
        {items.map((item) => (
          <div key={item.id} className="surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{item.listing_number ?? 'No number'}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === 'APPROVED' ? 'bg-green-100 text-green-700' : filter === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {item.status}
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900">{item.property_title ?? item.address_line ?? 'Untitled listing'}</h2>
                <p className="text-sm text-slate-600">{[item.address_line, item.suburb, item.city].filter(Boolean).join(', ') || 'Address not captured yet'}</p>
                <p className="text-sm text-slate-500">Submitted by {item.submitted_by_name ?? item.submitted_by_email ?? 'Unknown'}{item.submitted_at ? ` on ${new Date(item.submitted_at).toLocaleString()}` : ''}</p>
                {item.submission_comment && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{item.submission_comment}</p>}
                {item.review_comment && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{item.review_comment}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => navigate(`/listings?review=${item.listing_id}`)}
                >
                  Review Listing
                </button>
                {item.status === 'PENDING' && (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                      disabled={actionInFlightId !== null}
                      onClick={() => void reviewListingApproval(item.listing_id, 'approve')}
                    >
                      {actionInFlightId === `approve:${item.listing_id}` ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                      disabled={actionInFlightId !== null}
                      onClick={() => void reviewListingApproval(item.listing_id, 'reject')}
                    >
                      {actionInFlightId === `reject:${item.listing_id}` ? 'Rejecting...' : 'Reject'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
