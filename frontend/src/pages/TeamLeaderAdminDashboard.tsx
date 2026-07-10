/**
 * Team Leader Admin Dashboard
 * 
 * Market Centre and Regional Admin view for Team Leader Performance reporting
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchAdminReport } from '../services/teamLeaderPerformanceApi';
import TeamLeaderTopTabs from '../components/teamLeader/TeamLeaderTopTabs';
import { TEAM_LEADER_BADGE_INFO } from '../constants/teamLeaderBadges';

interface LeaderReport {
  leaderId: number;
  leaderName: string;
  metrics: {
    callsAnswered: number;
    appointmentsSet: number;
    appointmentsHeld: number;
    grossAgents: number;
    conversionRatio: number;
    submissionCount: number;
  };
  badgesEarned: number;
  badgeTypes?: string[];
}

interface LocalMarketCentreReport {
  marketCentreId: string;
  marketCentreName: string;
  leaderName: string;
  callsAnswered: number;
  appointmentsSet: number;
  appointmentsHeld: number;
  grossAgents: number;
  badgeTypes?: string[];
}

interface AdminReportData {
  marketCenterId: string;
  period: string;
  dateRange: {
    start: string;
    end: string;
  };
  leaders: LeaderReport[];
  summaryRows?: LocalMarketCentreReport[];
  summaryLabel?: string;
}

export default function TeamLeaderAdminDashboard() {
  const { activeContext, isOfficeAdmin, isRegionalAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdminReportData | null>(null);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [marketCentreOptions, setMarketCentreOptions] = useState<Array<{ source_market_center_id: string; name: string }>>([]);
  const [selectedMarketCentreId, setSelectedMarketCentreId] = useState<string>(import.meta.env.DEV ? 'all' : '');
  const [marketCentresLoading, setMarketCentresLoading] = useState(true);

  const canViewReport = isOfficeAdmin || isRegionalAdmin;
  const activeMarketCentreId = activeContext?.marketCenterId ?? null;

  useEffect(() => {
    if (!canViewReport) return;

    const token = localStorage.getItem('kwsa_auth_token');
    if (!token) return;

    setMarketCentresLoading(true);

    fetch('/api/market-centers?limit=250&offset=0&status=Active', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) return { items: [] as Array<{ source_market_center_id: string; name: string }> };
        return response.json() as Promise<{ items?: Array<{ source_market_center_id: string; name: string }> }>;
      })
      .then((body) => {
        const items = body.items ?? [];
        setMarketCentreOptions(items);
        if (import.meta.env.DEV) {
          setSelectedMarketCentreId('all');
          setMarketCentresLoading(false);
          return;
        }
        if (activeMarketCentreId) {
          setSelectedMarketCentreId(activeMarketCentreId);
          return;
        }
        if (!selectedMarketCentreId && items[0]?.source_market_center_id) {
          setSelectedMarketCentreId(items[0].source_market_center_id);
        }
        setMarketCentresLoading(false);
      })
      .catch(() => {
        setMarketCentresLoading(false);
      });
  }, [activeMarketCentreId, canViewReport, selectedMarketCentreId]);

  const marketCenterId = useMemo(() => {
    const trimmed = selectedMarketCentreId.trim();
    return trimmed || null;
  }, [selectedMarketCentreId]);

  useEffect(() => {
    const fetchReport = async () => {
      if (!canViewReport) {
        setError('Access restricted to Market Centre and Regional Admin contexts');
        setLoading(false);
        return;
      }

      if (!marketCenterId) {
        if (marketCentresLoading) {
          setLoading(true);
          return;
        }
        setError('No market centre selected');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const token = localStorage.getItem('kwsa_auth_token');
        if (!token) {
          setError('Not authenticated');
          return;
        }

        const data = await fetchAdminReport(token, marketCenterId, period, activeContext?.id ?? undefined);
        setReport(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [canViewReport, marketCenterId, marketCentresLoading, period]);

  if (!canViewReport) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white/95 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8c1c2a]">Team Leader Performance Report</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Access restricted</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          This report is available only to Market Centre Admin and Regional Admin contexts.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading performance report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-semibold">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8">
        <div className="text-slate-600">No data available</div>
      </div>
    );
  }

  const localPreviewRows = report.summaryRows ?? [];
  const leaderRows = report.leaders ?? [];
  const useLocalPreview = localPreviewRows.length > 0;
  const sortedLocalPreviewRows = [...localPreviewRows].sort((a, b) => b.appointmentsHeld - a.appointmentsHeld || b.grossAgents - a.grossAgents || b.callsAnswered - a.callsAnswered);
  const sortedLeaderRows = [...leaderRows].sort((a, b) => b.metrics.appointmentsHeld - a.metrics.appointmentsHeld || b.metrics.grossAgents - a.metrics.grossAgents || b.metrics.callsAnswered - a.metrics.callsAnswered);

  const renderBadgeIcon = (badge: string) => {
    const info = TEAM_LEADER_BADGE_INFO[badge];
    return (
      <span key={badge} title={info?.label || badge} className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white">
        {info?.imageSrc ? (
          <img src={info.imageSrc} alt={info.label} className="h-7 w-7 object-contain" />
        ) : (
          <span className="text-sm">{info?.fallbackEmoji || '🎖️'}</span>
        )}
      </span>
    );
  };

  const totalMetrics = useLocalPreview
    ? {
        appointmentsSet: localPreviewRows.reduce((sum, row) => sum + row.appointmentsSet, 0),
        callsAnswered: localPreviewRows.reduce((sum, row) => sum + row.callsAnswered, 0),
        appointmentsHeld: localPreviewRows.reduce((sum, row) => sum + row.appointmentsHeld, 0),
        grossAgents: localPreviewRows.reduce((sum, row) => sum + row.grossAgents, 0),
        submissionDays: 0,
        badgesEarned: localPreviewRows.reduce((sum, row) => sum + (row.badgeTypes?.length || 0), 0),
      }
    : {
        appointmentsSet: leaderRows.reduce((sum, l) => sum + l.metrics.appointmentsSet, 0),
        callsAnswered: leaderRows.reduce((sum, l) => sum + l.metrics.callsAnswered, 0),
        appointmentsHeld: leaderRows.reduce((sum, l) => sum + l.metrics.appointmentsHeld, 0),
        grossAgents: leaderRows.reduce((sum, l) => sum + l.metrics.grossAgents, 0),
        submissionDays: leaderRows.reduce((sum, l) => sum + l.metrics.submissionCount, 0),
        badgesEarned: leaderRows.reduce((sum, l) => sum + l.badgesEarned, 0),
      };

  const avgConversionRatio =
    (useLocalPreview ? sortedLocalPreviewRows.length : sortedLeaderRows.length) > 0
      ? (useLocalPreview
          ? sortedLocalPreviewRows.reduce((sum, row) => sum + ((row.appointmentsHeld > 0 ? (row.grossAgents / row.appointmentsHeld) * 100 : 0)), 0) / sortedLocalPreviewRows.length
          : sortedLeaderRows.reduce((sum, l) => sum + l.metrics.conversionRatio, 0) / sortedLeaderRows.length)
      : 0;

  return (
    <div className="space-y-6 p-6">
      {/* Professional Header Section */}
      <div>
        <h1 className="text-3xl font-bold text-slate-950">Team Leader Hub</h1>
        <p className="mt-0.5 text-sm text-slate-600">Performance analytics and market centre rankings</p>
      </div>

      <TeamLeaderTopTabs />

      {/* Header */}
      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Team Leader Reporting</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {useLocalPreview ? 'June 2026 Market Centre Preview' : 'Team Leader Performance Report'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            {useLocalPreview ? `${report.summaryLabel ?? 'Jun-26'} local preview` : `${report.leaders.length} Team Leaders`}
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] lg:flex-row lg:items-end lg:justify-between lg:gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600">Market Centre</label>
              <select
                value={selectedMarketCentreId}
                onChange={(e) => setSelectedMarketCentreId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              >
                {import.meta.env.DEV && <option value="all">June 2026 local preview</option>}
                {!import.meta.env.DEV && marketCentreOptions.length === 0 && <option value="">Loading market centres...</option>}
                {!import.meta.env.DEV && marketCentreOptions.map((mc) => (
                  <option key={mc.source_market_center_id} value={mc.source_market_center_id}>
                    {mc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600">Report Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as 'month' | 'year')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              >
                <option value="month">This Month</option>
                <option value="year">This Year</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <div className="group rounded-2xl border border-blue-100/60 bg-gradient-to-br from-blue-50 to-blue-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-blue-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Total Appointments</p>
          <p className="mt-2 text-3xl font-bold text-blue-700">{totalMetrics.appointmentsSet}</p>
        </div>
        <div className="group rounded-2xl border border-green-100/60 bg-gradient-to-br from-green-50 to-green-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-green-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Total Calls</p>
          <p className="mt-2 text-3xl font-bold text-green-700">{totalMetrics.callsAnswered}</p>
        </div>
        <div className="group rounded-2xl border border-purple-100/60 bg-gradient-to-br from-purple-50 to-purple-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-purple-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Held</p>
          <p className="mt-2 text-3xl font-bold text-purple-700">{totalMetrics.appointmentsHeld}</p>
        </div>
        <div className="group rounded-2xl border border-yellow-100/60 bg-gradient-to-br from-yellow-50 to-yellow-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-yellow-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Gross Gain</p>
          <p className="mt-2 text-3xl font-bold text-yellow-700">{totalMetrics.grossAgents}</p>
        </div>
        <div className="group rounded-2xl border border-pink-100/60 bg-gradient-to-br from-pink-50 to-pink-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-pink-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Avg Conversion</p>
          <p className="mt-2 text-3xl font-bold text-pink-700">{avgConversionRatio.toFixed(1)}%</p>
        </div>
        <div className="group rounded-2xl border border-emerald-100/60 bg-gradient-to-br from-emerald-50 to-emerald-50/50 p-3 shadow-sm transition-all hover:shadow-md hover:border-emerald-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Badges This Period</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">{totalMetrics.badgesEarned}</p>
        </div>
      </div>

      {/* Team Leader Rankings Table */}
      <div className="rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-950">Team Leader Rankings</h2>
          <p className="mt-0.5 text-sm text-slate-600">Performance metrics ranked by appointments held</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {useLocalPreview ? (
                  <>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Market Centre</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Team Leader</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Appts</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Calls</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Held</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Gain</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Total</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Conv.</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Badges</th>
                  </>
                ) : (
                  <>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Rank</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Team Leader</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Appts</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Calls</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Held</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Gain</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Total</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-xs">Conv.</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs">Badges</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {useLocalPreview
                ? sortedLocalPreviewRows.map((row) => {
                  const conversionRatio = row.appointmentsHeld > 0 ? (row.grossAgents / row.appointmentsHeld) * 100 : 0;
                  const total = row.appointmentsSet + row.callsAnswered + row.appointmentsHeld + row.grossAgents;
                    return (
                      <tr key={row.marketCentreId} className="border-b hover:bg-slate-50 text-sm">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.marketCentreName}</td>
                        <td className="px-4 py-3 text-slate-700">{row.leaderName}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.appointmentsSet}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.callsAnswered}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.appointmentsHeld}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.grossAgents}</td>
                        <td className="px-4 py-3 text-right font-semibold">{total}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold text-xs">
                            {conversionRatio.toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {(row.badgeTypes || []).length === 0 ? (
                              <span className="text-xs text-slate-400">None</span>
                            ) : (
                              (row.badgeTypes || []).map((badge) => renderBadgeIcon(badge))
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : sortedLeaderRows.map((leader, idx) => (
                    (() => {
                      const total = leader.metrics.appointmentsSet + leader.metrics.callsAnswered + leader.metrics.appointmentsHeld + leader.metrics.grossAgents;
                      return (
                    <tr key={leader.leaderId} className="border-b hover:bg-slate-50 text-sm">
                      <td className="px-4 py-3">
                        <span className="font-bold text-base text-blue-600">#{idx + 1}</span>
                      </td>
                      <td className="px-4 py-3">{leader.leaderName}</td>
                      <td className="px-4 py-3 text-right font-semibold">{leader.metrics.appointmentsSet}</td>
                      <td className="px-4 py-3 text-right font-semibold">{leader.metrics.callsAnswered}</td>
                      <td className="px-4 py-3 text-right font-semibold">{leader.metrics.appointmentsHeld}</td>
                      <td className="px-4 py-3 text-right font-semibold">{leader.metrics.grossAgents}</td>
                      <td className="px-4 py-3 text-right font-semibold">{total}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold text-xs">
                          {leader.metrics.conversionRatio.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {(leader.badgeTypes || []).length === 0 ? (
                            <span className="text-xs text-slate-400">None</span>
                          ) : (
                            (leader.badgeTypes || []).map((badge) => renderBadgeIcon(badge))
                          )}
                        </div>
                      </td>
                    </tr>
                      );
                    })()
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance Analysis */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h3 className="mb-4 text-lg font-semibold text-slate-950">
            {useLocalPreview ? 'Preview Notes' : 'Top Performers'}
          </h3>
          <div className="space-y-3">
            {useLocalPreview ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <p>Local preview is grouped by market centre for June 2026.</p>
                <p className="mt-2">Each row is linked to the Team Leader for that market centre, with the Operating Partner used as the fallback when no Team Leader exists.</p>
              </div>
            ) : (
              report.leaders.slice(0, 3).map((leader, idx) => (
                <div key={leader.leaderId} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                  <div>
                    <p className="font-semibold">
                      {idx === 0 && '🥇 '}
                      {idx === 1 && '🥈 '}
                      {idx === 2 && '🥉 '}
                      {leader.leaderName}
                    </p>
                    <p className="text-xs text-slate-500">{leader.metrics.appointmentsSet} appointments</p>
                  </div>
                  <span className="text-lg font-bold text-blue-600">{leader.badgesEarned} badges</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h3 className="mb-4 text-lg font-semibold text-slate-950">Key Metrics</h3>
          <div className="space-y-4">
            {useLocalPreview ? (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Avg Appointments Per MC</span>
                    <span className="font-semibold">{(totalMetrics.appointmentsSet / sortedLocalPreviewRows.length).toFixed(1)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${Math.min(((totalMetrics.appointmentsSet / sortedLocalPreviewRows.length) / 40) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Avg Calls Per MC</span>
                    <span className="font-semibold">{(totalMetrics.callsAnswered / sortedLocalPreviewRows.length).toFixed(0)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${Math.min(((totalMetrics.callsAnswered / sortedLocalPreviewRows.length) / 140) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Market Centre Avg Conversion</span>
                    <span className="font-semibold">{avgConversionRatio.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full"
                      style={{ width: `${Math.min(avgConversionRatio, 100)}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Avg Appointments Per TL</span>
                    <span className="font-semibold">
                      {(totalMetrics.appointmentsSet / sortedLeaderRows.length).toFixed(1)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${Math.min(((totalMetrics.appointmentsSet / sortedLeaderRows.length) / 15) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Avg Calls Per TL</span>
                    <span className="font-semibold">
                      {(totalMetrics.callsAnswered / sortedLeaderRows.length).toFixed(0)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${Math.min(((totalMetrics.callsAnswered / sortedLeaderRows.length) / 50) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Market Center Avg Conversion</span>
                    <span className="font-semibold">{avgConversionRatio.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full"
                      style={{ width: `${Math.min(avgConversionRatio, 100)}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="rounded-[26px] border border-blue-100 bg-blue-50 p-6">
        <h3 className="mb-3 text-lg font-semibold text-slate-950">Market Centre Insights</h3>
        <ul className="space-y-2 text-slate-700">
          {useLocalPreview ? (
            <>
              <li>
                • <strong>{sortedLocalPreviewRows.length}</strong> market centres in the June 2026 preview
              </li>
              <li>
                • <strong>{totalMetrics.appointmentsSet}</strong> total appointments across the preview set
              </li>
              <li>
                • <strong>{totalMetrics.grossAgents}</strong> gross agents represented across the rows
              </li>
              <li>
                • Each market centre row resolves to the Team Leader first, then the Operating Partner fallback
              </li>
              <li>
                • Local preview is intentionally static for testing and presentation
              </li>
            </>
          ) : (
            <>
              <li>
                • <strong>{report.leaders.length}</strong> active team leaders this period
              </li>
              <li>
                • <strong>{totalMetrics.appointmentsSet}</strong> total appointments across the market centre
              </li>
              <li>
                • Market centre conversion rate: <strong>{avgConversionRatio.toFixed(1)}%</strong>
              </li>
              <li>
                • <strong>{totalMetrics.badgesEarned}</strong> badges earned by the team
              </li>
              <li>
                • Average submissions per leader: <strong>{(totalMetrics.submissionDays / report.leaders.length).toFixed(1)}</strong> days
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
