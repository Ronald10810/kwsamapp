import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { REPORTS } from '../../pages/reportsConfig';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

type NavIconName =
  | 'home'
  | 'dashboard'
  | 'associates'
  | 'marketCentres'
  | 'listings'
  | 'rentals'
  | 'transactions'
  | 'teams'
  | 'reports'
  | 'aiTools'
  | 'loom';

function NavIcon({ name }: { name: NavIconName }) {
  const base = 'h-4 w-4 text-white/90';

  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 21v-5h5V21" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13" y="10" width="8" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'associates':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M4 19c0-2.5 2.2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M14.5 19c.3-1.5 1.8-2.6 3.8-2.6 1.2 0 2.2.4 3 .9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'marketCentres':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 21V7l8-4 8 4v14" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9 21v-4h6v4" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'listings':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
          <rect x="9" y="13" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case 'rentals':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M3 10.5 12 4l9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 9.5V21h13V9.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 15h5M9.5 18h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'transactions':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 7h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m13 4 3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 17H8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m11 14-3 3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'teams':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <circle cx="12" cy="7" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M5 19c0-3 3-5 7-5s7 2 7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="19" cy="8" r="2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="5" cy="8" r="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M21 18c-.5-1.5-1.8-2.5-3.5-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M3 18c.5-1.5 1.8-2.5 3.5-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'reports':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 15v3M12 11v7M16 13v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'aiTools':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M6 2h9l4 4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" />
          <path d="M14 2v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M9 12h6M9 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="10" cy="9" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'loom':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 4v2M12 18v2M4 12h2M18 12h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOfficeAdmin, isRegionalAdmin } = useAuth();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isActive = (path: string) => location.pathname === path;
  const isReportsRoute = location.pathname.startsWith('/reports');
  const [reportsOpen, setReportsOpen] = useState(isReportsRoute);

  useEffect(() => {
    if (isReportsRoute) {
      setReportsOpen(true);
    }
  }, [isReportsRoute]);

  // Auto-close drawer on navigation (mobile)
  useEffect(() => {
    onCloseRef.current?.();
  }, [location.pathname]);

  function handleReportsClick(): void {
    setReportsOpen((prev) => !prev);
    if (!isReportsRoute) {
      navigate(`/reports/${REPORTS[0].id}`);
    }
  }

  const isAdminRole = isOfficeAdmin || isRegionalAdmin;

  const links = [
    // MC Admin Tools — first for admin roles
    ...(isAdminRole ? [{ path: '/mc-admin-tools', label: 'MC Admin Tools', icon: 'dashboard' as NavIconName }] : []),
    // Home — first for agent roles
    ...(!isAdminRole ? [{ path: '/home', label: 'Home', icon: 'home' as NavIconName }] : []),
    // Dashboard — everyone
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' as NavIconName },
    { path: '/agents', label: 'Associates', icon: 'associates' as NavIconName },
    { path: '/teams', label: 'Teams', icon: 'teams' as NavIconName },
    { path: '/market-centres', label: 'Market Centres', icon: 'marketCentres' as NavIconName },
    { path: '/listings', label: 'Listings', icon: 'listings' as NavIconName },
    { path: '/rentals', label: 'Rentals', icon: 'rentals' as NavIconName },
    { path: '/transactions', label: 'Transactions', icon: 'transactions' as NavIconName },
    { path: '/ai-tools', label: 'AI Tools', icon: 'aiTools' as NavIconName },
    { path: '/loom', label: 'Property Intelligence', icon: 'loom' as NavIconName },
  ];

  return (
    <>
      {/* Mobile backdrop overlay */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 lg:hidden',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar — fixed overlay on mobile, sticky in-flow on desktop */}
      <aside
        className={clsx(
          'sidebar-shell overflow-y-auto px-6 pb-6 pt-3 text-white border-r border-red-900/30',
          'transition-transform duration-300 ease-in-out',
          // Mobile: fixed drawer
          'fixed top-0 left-0 h-full w-72 z-50',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: sticky in-flow, always visible
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:z-auto'
        )}
      >
        {/* Mobile close button */}
        <div className="flex items-center justify-end lg:hidden -mr-2 mb-1 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      <div className="mb-3">
        <div className="-mt-2 mb-1 h-24 overflow-hidden">
          <img
            src="https://static.wixstatic.com/media/cd2dff_661d95737ba4452d9c15f33d43643f72~mv2.png"
            alt="KWSA"
            className="h-40 w-full -translate-y-5 object-contain object-left"
            loading="lazy"
          />
        </div>
        <p className="text-sm text-red-100/80 leading-6">KWSA Listing Platform for Millionaire Real Estate Agents</p>
      </div>

      <nav className="space-y-2 mt-6">
        {links.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            className={clsx(
              'flex items-center gap-3 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-all duration-200',
              isActive(link.path)
                ? 'bg-red-500/20 text-red-50 shadow-sm shadow-black/20 ring-1 ring-red-300/25'
                : 'text-red-100/85 hover:bg-white/10 hover:text-white'
            )}
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/10">
              <NavIcon name={link.icon} />
            </span>
            {link.label}
          </Link>
        ))}

        <div className="rounded-lg border border-red-900/40 bg-black/10">
          <button
            type="button"
            onClick={handleReportsClick}
            className={clsx(
              'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] font-medium transition-all duration-200',
              reportsOpen ? 'rounded-t-lg' : 'rounded-lg',
              isReportsRoute
                ? 'bg-red-500/20 text-red-50 ring-1 ring-red-300/25'
                : 'text-red-100/85 hover:bg-white/10 hover:text-white'
            )}
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/10">
              <NavIcon name="reports" />
            </span>
            <span className="flex-1">Reports</span>
            <span className={clsx('text-xs transition-transform', reportsOpen ? 'rotate-180' : 'rotate-0')}>▼</span>
          </button>

          {reportsOpen && (
            <div className="space-y-1 px-3 pb-3 pt-1">
              {REPORTS.map((report) => {
                const reportPath = `/reports/${report.id}`;
                const reportActive = location.pathname === reportPath;
                return (
                  <Link
                    key={report.id}
                    to={reportPath}
                    className={clsx(
                      'block rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      reportActive
                        ? 'bg-white/15 text-white'
                        : 'text-red-100/80 hover:bg-white/10 hover:text-white'
                    )}
                  >
                    {report.title}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>


    </aside>
    </>
  );
}
