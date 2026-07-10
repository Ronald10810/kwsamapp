import { useEffect, useMemo, useState } from 'react';
import TeamLeaderTopTabs from '../components/teamLeader/TeamLeaderTopTabs';
import { useAuth } from '../contexts/AuthContext';
import { DailySubmissionReport, fetchAdminDailyFigures } from '../services/teamLeaderPerformanceApi';

interface MarketCentreOption {
  source_market_center_id: string;
  name: string;
}

function monthValueFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildRecentMonthOptions(count: number): string[] {
  const now = new Date();
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    values.push(monthValueFromDate(d));
  }
  return values;
}

export default function TeamLeaderDailyFigures() {
  const { activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();

  const [marketCentresLoading, setMarketCentresLoading] = useState(true);
  const [marketCentreOptions, setMarketCentreOptions] = useState<MarketCentreOption[]>([]);
  const [selectedMarketCentreId, setSelectedMarketCentreId] = useState<string>('');

  const [selectedMonth, setSelectedMonth] = useState<string>(monthValueFromDate(new Date()));
  const [report, setReport] = useState<DailySubmissionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canViewReport = isOfficeAdmin || isRegionalAdmin;
  const activeMarketCentreId = activeContext?.marketCenterId ?? '';

  const monthOptions = useMemo(() => buildRecentMonthOptions(12), []);

  useEffect(() => {
    if (!canViewReport) {
      setMarketCentresLoading(false);
      return;
    }

    const token = localStorage.getItem('kwsa_auth_token');
    if (!token) {
      setMarketCentresLoading(false);
      return;
    }

    if (isOfficeAdmin) {
      setSelectedMarketCentreId(activeMarketCentreId);
      setMarketCentresLoading(false);
      return;
    }

    setMarketCentresLoading(true);
    fetch('/api/market-centers?limit=250&offset=0&status=Active', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) return { items: [] as MarketCentreOption[] };
        return response.json() as Promise<{ items?: MarketCentreOption[] }>;
      })
      .then((body) => {
        const items = body.items ?? [];
        setMarketCentreOptions(items);
        if (!selectedMarketCentreId) {
          setSelectedMarketCentreId(activeMarketCentreId || items[0]?.source_market_center_id || '');
        }
      })
      .catch(() => {
        setError('Failed to load market centre options');
      })
      .finally(() => {
        setMarketCentresLoading(false);
      });
  }, [activeMarketCentreId, canViewReport, isOfficeAdmin, selectedMarketCentreId]);

  const effectiveMarketCentreId = useMemo(() => {
    if (isOfficeAdmin) return activeMarketCentreId;
    return selectedMarketCentreId.trim();
  }, [activeMarketCentreId, isOfficeAdmin, selectedMarketCentreId]);

  useEffect(() => {
    if (!canViewReport) {
      setError('Access restricted to Market Centre and Regional Admin contexts');
      setLoading(false);
      return;
    }

    if (!effectiveMarketCentreId || !selectedMonth || marketCentresLoading) {
      setLoading(marketCentresLoading);
      return;
    }

    const token = localStorage.getItem('kwsa_auth_token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    fetchAdminDailyFigures(token, effectiveMarketCentreId, selectedMonth, activeContext?.id)
      .then((data) => {
        setReport(data);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load daily figures');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeContext?.id, canViewReport, effectiveMarketCentreId, marketCentresLoading, selectedMonth]);

  if (!canViewReport) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white/95 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8c1c2a]">Team Leader Daily Figures</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Access restricted</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          This report is available only to Market Centre Admin and Regional Admin contexts.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-8 p-8">
        <TeamLeaderTopTabs />
        <div className="p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading daily figures...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8 p-8">
        <TeamLeaderTopTabs />
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-semibold">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Professional Header Section */}
      <div>
        <h1 className="text-3xl font-bold text-slate-950">Team Leader Hub</h1>
        <p className="mt-0.5 text-sm text-slate-600">Daily submitted metrics and performance tracking</p>
      </div>

      <TeamLeaderTopTabs />

      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Team Leader Reporting</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Daily Figures</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Day-by-day submitted figures for {report?.marketCenterName || 'selected market centre'}.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] lg:flex-row lg:items-end lg:justify-between lg:gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600">Market Centre</label>
              <select
                value={effectiveMarketCentreId}
                onChange={(e) => setSelectedMarketCentreId(e.target.value)}
                disabled={isOfficeAdmin}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-all hover:border-slate-400 disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              >
                {isOfficeAdmin ? (
                  <option value={activeMarketCentreId}>{report?.marketCenterName || activeMarketCentreId}</option>
                ) : (
                  marketCentreOptions.map((mc) => (
                    <option key={mc.source_market_center_id} value={mc.source_market_center_id}>
                      {mc.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <div className="group rounded-2xl border border-blue-100/60 bg-gradient-to-br from-blue-50 to-blue-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-blue-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Submissions</p>
          <p className="mt-2 text-3xl font-bold text-blue-700">{report?.monthTotals.submissions ?? 0}</p>
        </div>
        <div className="group rounded-2xl border border-green-100/60 bg-gradient-to-br from-green-50 to-green-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-green-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Calls</p>
          <p className="mt-2 text-3xl font-bold text-green-700">{report?.monthTotals.callsAnswered ?? 0}</p>
        </div>
        <div className="group rounded-2xl border border-indigo-100/60 bg-gradient-to-br from-indigo-50 to-indigo-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-indigo-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Appointments</p>
          <p className="mt-2 text-3xl font-bold text-indigo-700">{report?.monthTotals.appointmentsSet ?? 0}</p>
        </div>
        <div className="group rounded-2xl border border-purple-100/60 bg-gradient-to-br from-purple-50 to-purple-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-purple-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Held</p>
          <p className="mt-2 text-3xl font-bold text-purple-700">{report?.monthTotals.appointmentsHeld ?? 0}</p>
        </div>
        <div className="group rounded-2xl border border-yellow-100/60 bg-gradient-to-br from-yellow-50 to-yellow-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-yellow-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Gross Gain</p>
          <p className="mt-2 text-3xl font-bold text-yellow-700">{report?.monthTotals.grossAgents ?? 0}</p>
        </div>
        <div className="group rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-slate-300">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Conversion</p>
          <p className="mt-2 text-3xl font-bold text-slate-700">{(report?.monthTotals.conversionRatio ?? 0).toFixed(1)}%</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-950">Daily Submissions</h2>
          <p className="mt-0.5 text-sm text-slate-600">Individual submission records</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Date</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs">Team Leader</th>
                <th className="text-right px-6 py-3 font-semibold">Appointments</th>
                <th className="text-right px-6 py-3 font-semibold">Calls</th>
                <th className="text-right px-6 py-3 font-semibold">Held</th>
                <th className="text-right px-6 py-3 font-semibold">Gross Gain</th>
                <th className="text-right px-6 py-3 font-semibold">Total</th>
                <th className="text-right px-6 py-3 font-semibold">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {(report?.rows ?? []).map((row) => {
                const conversion = row.appointmentsHeld > 0 ? (row.grossAgents / row.appointmentsHeld) * 100 : 0;
                return (
                  <tr key={`${row.metricDate}-${row.associateId}`} className="border-b hover:bg-slate-50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{row.metricDate}</td>
                    <td className="px-6 py-4 text-slate-700">{row.leaderName}</td>
                    <td className="px-6 py-4 text-right font-semibold">{row.appointmentsSet}</td>
                    <td className="px-6 py-4 text-right font-semibold">{row.callsAnswered}</td>
                    <td className="px-6 py-4 text-right font-semibold">{row.appointmentsHeld}</td>
                    <td className="px-6 py-4 text-right font-semibold">{row.grossAgents}</td>
                    <td className="px-6 py-4 text-right font-semibold">{row.total}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-flex items-center justify-center w-12 h-8 rounded-full bg-purple-100 text-purple-700 font-semibold">
                        {conversion.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(report?.rows ?? []).length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-sm text-slate-500" colSpan={8}>
                    No daily submissions found for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-950">Daily Totals</h2>
          <p className="mt-1 text-sm text-slate-600">Aggregated daily metrics</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Date</th>
                <th className="text-right px-6 py-3 font-semibold">Submissions</th>
                <th className="text-right px-6 py-3 font-semibold">Appointments</th>
                <th className="text-right px-6 py-3 font-semibold">Calls</th>
                <th className="text-right px-6 py-3 font-semibold">Held</th>
                <th className="text-right px-6 py-3 font-semibold">Gross Gain</th>
                <th className="text-right px-6 py-3 font-semibold">Total</th>
                <th className="text-right px-6 py-3 font-semibold">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {(report?.dailyTotals ?? []).map((day) => {
                const conversion = day.appointmentsHeld > 0 ? (day.grossAgents / day.appointmentsHeld) * 100 : 0;
                return (
                  <tr key={day.metricDate} className="border-b hover:bg-slate-50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{day.metricDate}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.submissions}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.appointmentsSet}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.callsAnswered}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.appointmentsHeld}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.grossAgents}</td>
                    <td className="px-6 py-4 text-right font-semibold">{day.total}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-flex items-center justify-center w-12 h-8 rounded-full bg-purple-100 text-purple-700 font-semibold">
                        {conversion.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(report?.dailyTotals ?? []).length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-sm text-slate-500" colSpan={8}>
                    No daily totals available for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
