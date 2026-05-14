import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';

type NotificationPreviewItem = {
  id: string;
  title: string;
  message: string;
  category: string;
  is_read: boolean;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
};

type NotificationsPreviewResponse = {
  items: NotificationPreviewItem[];
  counts: {
    unread: number;
    pending: number;
    approved: number;
    rejected: number;
  };
};

export default function Navbar({ onMenuOpen }: { onMenuOpen?: () => void }) {
  const { user, logout, contexts, activeContext, setActiveContext } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const activeContextId = activeContext?.id ?? 'no-context';

  const { data: notificationsData } = useQuery<NotificationsPreviewResponse>({
    queryKey: ['notifications', 'bell', activeContextId],
    queryFn: async () => {
      const response = await fetch('/api/notifications?filter=all&limit=5');
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Unable to load notifications');
      }
      return response.json() as Promise<NotificationsPreviewResponse>;
    },
    enabled: Boolean(user),
    staleTime: 15000,
  });

  const unreadCount = notificationsData?.counts.unread ?? 0;
  const previewItems = (notificationsData?.items ?? []).filter((item) => !item.is_read);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (unreadCount === 0) {
      setNotificationsOpen(false);
    }
  }, [unreadCount]);

  const hasMultipleContexts = contexts.length > 1;

  return (
    <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onMenuOpen}
          className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="text-slate-800 text-base sm:text-lg font-semibold tracking-tight">Operations Platform</h2>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
          <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 shrink-0" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M8 2v4M16 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          {today}
        </span>
      </div>

      <div className="flex items-center space-x-3">
        {user && (
          <div
            ref={notificationsRef}
            className="relative"
            onMouseEnter={() => setNotificationsOpen(true)}
            onMouseLeave={() => setNotificationsOpen(false)}
          >
            <button
              type="button"
              onClick={() => navigate('/notifications')}
              onFocus={() => setNotificationsOpen(true)}
              className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Open notifications"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M15 17H5.5a1.5 1.5 0 0 1-1.2-2.4L6 12.5V10a6 6 0 1 1 12 0v2.5l1.7 2.1a1.5 1.5 0 0 1-1.2 2.4H15Zm0 0a3 3 0 0 1-6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 z-[9999] mt-2 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Notifications</p>
                      <p className="text-xs text-slate-500">{unreadCount} unread</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsOpen(false);
                        navigate('/notifications');
                      }}
                      className="text-xs font-medium text-red-700 hover:text-red-800"
                    >
                      View all
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {previewItems.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">No unread notifications.</div>
                  ) : previewItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setNotificationsOpen(false);
                        navigate(item.entity_type === 'listing' && item.entity_id ? `/listings?review=${item.entity_id}` : '/notifications');
                      }}
                      className="block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', item.category === 'APPROVED' ? 'bg-green-100 text-green-700' : item.category === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')}>
                          {item.category}
                        </span>
                        {!item.is_read && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">Unread</span>}
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.message}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {user && (
          <div className="relative z-[9999]" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
            >
              {user.picture ? (
                <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-200" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-700 flex items-center justify-center text-white text-xs font-semibold ring-2 ring-red-800/30">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-slate-800">{user.name}</span>
                {activeContext && (
                  <span className="text-xs font-medium text-slate-500">{activeContext.label}</span>
                )}
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className={clsx('w-3.5 h-3.5 text-slate-400 transition-transform hidden sm:block', dropdownOpen && 'rotate-180')}
              >
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-[9999] overflow-hidden">
                {/* User info */}
                <div className="flex items-center gap-2.5 px-3 py-3 border-b border-slate-100 bg-slate-50/60">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-red-700 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
                    {activeContext && (
                      <p className="text-xs text-slate-500 truncate">{activeContext.label}</p>
                    )}
                  </div>
                </div>

                {/* Context switcher */}
                {hasMultipleContexts && (
                  <>
                    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Switch role</p>
                    {contexts.map((ctx) => (
                      <button
                        key={ctx.id}
                        type="button"
                        onClick={() => { setActiveContext(ctx); setDropdownOpen(false); }}
                        className={clsx(
                          'w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors',
                          activeContext?.id === ctx.id && 'bg-red-50'
                        )}
                      >
                        <span className={clsx(
                          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                          activeContext?.id === ctx.id ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-600'
                        )}>
                          {ctx.role.charAt(0).toUpperCase()}
                        </span>
                        <div className="leading-tight min-w-0">
                          <p className={clsx('text-sm font-medium truncate', activeContext?.id === ctx.id ? 'text-red-700' : 'text-slate-700')}>
                            {ctx.label}
                          </p>
                          {ctx.marketCenter && (
                            <p className="text-xs text-slate-400 truncate">{ctx.marketCenter}</p>
                          )}
                        </div>
                        {activeContext?.id === ctx.id && (
                          <svg viewBox="0 0 24 24" fill="none" className="ml-auto mt-0.5 w-4 h-4 shrink-0 text-red-700">
                            <path d="m5 12 5 5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {/* Sign out */}
                <div className="border-t border-slate-100 mt-1 pt-1 pb-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="m16 17 5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
