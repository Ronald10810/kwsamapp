import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type NotificationItem = {
  id: string;
  notification_type: string;
  category: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

type NotificationsResponse = {
  items: NotificationItem[];
  counts: {
    unread: number;
    pending: number;
    approved: number;
    rejected: number;
  };
};

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
type NotificationFilter = typeof FILTERS[number];

export default function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [actionInFlightId, setActionInFlightId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [markAllInFlight, setMarkAllInFlight] = useState(false);
  const { isOfficeAdmin, activeContext } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeContextId = activeContext?.id ?? 'no-context';

  const { data, isLoading, isFetching, refetch } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', 'page', activeContextId, filter],
    queryFn: async () => {
      const response = await fetch(`/api/notifications?filter=${encodeURIComponent(filter)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Unable to load notifications');
      }
      return response.json() as Promise<NotificationsResponse>;
    },
  });

  const items = data?.items ?? [];

  async function markNotificationRead(id: string): Promise<void> {
    const response = await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to mark notification as read');
    }
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
  }

  async function markAllRead(): Promise<void> {
    setActionError(null);
    setMarkAllInFlight(true);
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to mark all notifications as read');
      }
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to mark all notifications as read');
    } finally {
      setMarkAllInFlight(false);
    }
  }

  async function reviewListingApproval(listingId: string, action: 'approve' | 'reject'): Promise<void> {
    setActionError(null);
    setActionInFlightId(`${action}:${listingId}`);
    try {
      const reviewComment = action === 'reject'
        ? (window.prompt('Reason for rejection (optional):') ?? '').trim()
        : 'Approved from notifications';

      const response = await fetch(`/api/listings/${listingId}/${action}-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_comment: reviewComment || undefined }),
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
          <h1 className="page-title">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Track listing approval requests, approvals, and rejections.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" onClick={() => void markAllRead()} disabled={markAllInFlight || (data?.counts.unread ?? 0) === 0}>
            {markAllInFlight ? 'Marking...' : 'Mark all read'}
          </button>
          <button className="primary-btn" type="button" onClick={() => void refetch()}>
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="surface-card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Unread</p><p className="mt-2 text-2xl font-semibold text-slate-900">{data?.counts.unread ?? 0}</p></div>
        <div className="surface-card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Pending</p><p className="mt-2 text-2xl font-semibold text-slate-900">{data?.counts.pending ?? 0}</p></div>
        <div className="surface-card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Approved</p><p className="mt-2 text-2xl font-semibold text-slate-900">{data?.counts.approved ?? 0}</p></div>
        <div className="surface-card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Rejected</p><p className="mt-2 text-2xl font-semibold text-slate-900">{data?.counts.rejected ?? 0}</p></div>
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
              {entry === 'all' ? 'All' : `${entry.charAt(0).toUpperCase()}${entry.slice(1)}`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {actionError && <div className="surface-card border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>}
        {isLoading && <div className="surface-card p-6 text-sm text-slate-500">Loading notifications...</div>}
        {!isLoading && items.length === 0 && <div className="surface-card p-6 text-sm text-slate-500">No notifications for this filter.</div>}
        {items.map((item) => (
          <div key={item.id} className="surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.category === 'APPROVED' ? 'bg-green-100 text-green-700' : item.category === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{item.category}</span>
                  {!item.is_read && <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">Unread</span>}
                </div>
                <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                <p className="text-sm text-slate-600">{item.message}</p>
                <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.entity_type === 'listing' && item.entity_id && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      void markNotificationRead(item.id).catch((error) => {
                        setActionError(error instanceof Error ? error.message : 'Failed to mark notification as read');
                      });
                      navigate(`/listings?review=${item.entity_id}`);
                    }}
                  >
                    Open Listing
                  </button>
                )}
                {!item.is_read && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => void markNotificationRead(item.id).catch((error) => {
                      setActionError(error instanceof Error ? error.message : 'Failed to mark notification as read');
                    })}
                  >
                    Mark read
                  </button>
                )}
                {isOfficeAdmin && item.entity_type === 'listing' && item.entity_id && item.notification_type === 'LISTING_APPROVAL_REQUESTED' && item.category === 'PENDING' && (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                      disabled={actionInFlightId !== null}
                      onClick={() => void reviewListingApproval(item.entity_id!, 'approve')}
                    >
                      {actionInFlightId === `approve:${item.entity_id}` ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                      disabled={actionInFlightId !== null}
                      onClick={() => void reviewListingApproval(item.entity_id!, 'reject')}
                    >
                      {actionInFlightId === `reject:${item.entity_id}` ? 'Rejecting...' : 'Reject'}
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
