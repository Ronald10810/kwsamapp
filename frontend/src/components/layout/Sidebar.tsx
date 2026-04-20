import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { REPORTS } from '../../pages/reportsConfig';

type NavIconName = 'dashboard' | 'associates' | 'marketCentres' | 'listings' | 'transactions' | 'reports';

function NavIcon({ name }: { name: NavIconName }) {
  const base = 'h-4 w-4 text-white/90';

  switch (name) {
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
    case 'transactions':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 7h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m13 4 3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 17H8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="m11 14-3 3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'reports':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={base} aria-hidden="true">
          <path d="M4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 15v3M12 11v7M16 13v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => location.pathname === path;
  const isReportsRoute = location.pathname.startsWith('/reports');
  const [reportsOpen, setReportsOpen] = useState(isReportsRoute);

  useEffect(() => {
    if (isReportsRoute) {
      setReportsOpen(true);
    }
  }, [isReportsRoute]);

  function handleReportsClick(): void {
    setReportsOpen((prev) => !prev);
    if (!isReportsRoute) {
      navigate(`/reports/${REPORTS[0].id}`);
    }
  }

  const links = [
    { path: '/', label: 'Dashboard', icon: 'dashboard' as NavIconName },
    { path: '/agents', label: 'Associates', icon: 'associates' as NavIconName },
    { path: '/market-centres', label: 'Market centres', icon: 'marketCentres' as NavIconName },
    { path: '/listings', label: 'Listings', icon: 'listings' as NavIconName },
    { path: '/transactions', label: 'Transactions', icon: 'transactions' as NavIconName },
  ];

  return (
    <aside className="sidebar-shell sticky top-0 h-screen w-72 overflow-y-auto px-6 pb-6 pt-3 text-white border-r border-red-900/30">
      <div className="mb-7">
        <div className="-mt-2 mb-2 h-24 overflow-hidden">
          <img
            src="https://static.wixstatic.com/media/cd2dff_661d95737ba4452d9c15f33d43643f72~mv2.png"
            alt="KWSA"
            className="h-40 w-full -translate-y-5 object-contain object-left"
            loading="lazy"
          />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
        <p className="mt-3 text-sm text-red-100/80 leading-6">KWSA Listing Platform for Millionaire Real Estate Agents</p>
      </div>

      <nav className="space-y-2">
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

      <div className="mt-10 pt-6 border-t border-red-900/40 text-xs text-red-100/75 leading-6">
        <p>Environment: Development</p>
        <p>Data Engine: Pipeline v2</p>
      </div>
    </aside>
  );
}
