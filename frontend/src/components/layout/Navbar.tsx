export default function Navbar() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  return (
    <nav className="bg-white/80 backdrop-blur border-b border-red-100 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h2 className="text-slate-800 text-xl font-semibold tracking-tight">Operations Platform</h2>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-800">Live</span>
        <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600">{today}</span>
      </div>
      <div className="flex items-center space-x-3">
        <button className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
          Settings
        </button>
        <button className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
          Logout
        </button>
      </div>
    </nav>
  );
}
