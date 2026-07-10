import { NavLink } from 'react-router-dom';

export default function TeamLeaderTopTabs() {
  const baseClass =
    'inline-flex items-center rounded-full px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm h-fit">
      <NavLink
        to="/team-leader-performance"
        className={({ isActive }) =>
          `${baseClass} ${
            isActive
              ? 'bg-[#b31d33] text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`
        }
      >
        Team Leader
      </NavLink>
      <NavLink
        to="/team-leader-admin"
        className={({ isActive }) =>
          `${baseClass} ${
            isActive
              ? 'bg-[#b31d33] text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`
        }
      >
        TL Performance Report
      </NavLink>
      <NavLink
        to="/team-leader-daily-figures"
        className={({ isActive }) =>
          `${baseClass} ${
            isActive
              ? 'bg-[#b31d33] text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`
        }
      >
        Daily Figures
      </NavLink>
      <NavLink
        to="/team-leader-badges"
        className={({ isActive }) =>
          `${baseClass} ${
            isActive
              ? 'bg-[#b31d33] text-white shadow-sm'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`
        }
      >
        Badge Index
      </NavLink>
    </div>
  );
}
