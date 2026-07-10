/**
 * Team Leader Performance Hub
 * 
 * Gamified daily performance tracking for Team Leaders with badges, leaderboards, and admin reporting.
 * FEATURE FLAG: TEAM_LEADER_PERFORMANCE_HUB_ENABLED (disabled by default)
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TeamLeaderTopTabs from '../components/teamLeader/TeamLeaderTopTabs';
import { TEAM_LEADER_BADGE_INFO } from '../constants/teamLeaderBadges';

interface DailyMetrics {
  callsAnswered: number;
  appointmentsSet: number;
  appointmentsHeld: number;
  grossAgents: number;
  notes?: string;
}

interface DashboardData {
  associate: {
    id: number;
    name: string;
  };
  today: any;
  thisWeek: {
    callsAnswered: number;
    appointmentsSet: number;
    appointmentsHeld: number;
    grossAgents: number;
    conversionRatio: number;
    submissionCount: number;
  };
  thisMonth: {
    callsAnswered: number;
    appointmentsSet: number;
    appointmentsHeld: number;
    grossAgents: number;
    conversionRatio: number;
    submissionCount: number;
  };
  recentBadges: any[];
  leaderboardPosition: number;
  totalLeaderboardSize: number;
}

interface LeaderboardEntry {
  rank: number;
  associateId: number;
  associateName: string;
  appointmentsSet: number;
  callsAnswered: number;
  appointmentsHeld: number;
  grossAgents: number;
  conversionRatio?: number;
  submissionCount: number;
}

export default function TeamLeaderPerformanceHub() {
  const { isOfficeAdmin, isRegionalAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [selectedBadge, setSelectedBadge] = useState<{ label: string; imageSrc: string; earnedAt: string } | null>(null);
  const [metrics, setMetrics] = useState<DailyMetrics>({
    callsAnswered: 0,
    appointmentsSet: 0,
    appointmentsHeld: 0,
    grossAgents: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedBadges, setSubmittedBadges] = useState<any[]>([]);
  const canViewHub = isOfficeAdmin || isRegionalAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const token = localStorage.getItem('kwsa_auth_token');
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }

    try {
      const dashRes = await fetch('/api/team-leader/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!dashRes.ok) throw new Error('Failed to load dashboard');
      const dashboardData = await dashRes.json();
      setDashboard(dashboardData);

      const leaderRes = await fetch('/api/team-leader/leaderboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!leaderRes.ok) throw new Error('Failed to load leaderboard');
      const leaderData = await leaderRes.json();
      setLeaderboard(leaderData.leaderboard || []);

      if (import.meta.env.DEV && dashboardData?.associate?.marketCenterName) {
        // Disabled temporarily for debugging
        /*
        const reportRes = await fetch('/api/team-leader/admin/performance-report?mc_id=all&period=month', {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Active-Context': 'regional_admin',
          },
        });

        if (reportRes.ok) {
          const reportData = await reportRes.json() as { summaryRows?: Array<{ marketCentreName: string }> };
          const summaryRows = reportData.summaryRows ?? [];
          const normalizedTarget = dashboardData.associate.marketCenterName.trim().toLowerCase();
          const position = summaryRows.findIndex((row) => row.marketCentreName.trim().toLowerCase() === normalizedTarget) + 1;
          if (position > 0) {
            setPreviewRank({ position, total: summaryRows.length });
          }
        }
        */
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch dashboard and leaderboard data
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Handle metric input change
  const handleMetricChange = (field: keyof DailyMetrics, value: string) => {
    setMetrics({
      ...metrics,
      [field]: field === 'notes' ? value : Math.max(0, parseInt(value) || 0),
    });
  };

  // Submit daily metrics
  const handleSubmitMetrics = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const token = localStorage.getItem('kwsa_auth_token');

      const res = await fetch('/api/team-leader/daily-metrics', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metrics),
      });

      if (!res.ok) throw new Error('Failed to submit metrics');

      const result = await res.json();
      setSubmittedBadges(result.badgesEarned || []);
      setSubmitSuccess(true);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit metrics');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canViewHub) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white/95 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8c1c2a]">Team Leader Performance Hub</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Access restricted</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          This feature is available only to Market Centre Admin and Regional Admin contexts.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#b31d33] mx-auto mb-4"></div>
          <p className="text-slate-600">Loading Team Leader Performance Hub...</p>
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

  if (!dashboard) {
    return (
      <div className="p-8">
        <div className="text-slate-600">No data available</div>
      </div>
    );
  }

  const conversionRatioWeek = dashboard.thisWeek.conversionRatio || 0;
  const conversionRatioMonth = dashboard.thisMonth.conversionRatio || 0;
  const sortedLeaderboard = [...leaderboard].sort(
    (a, b) => b.appointmentsHeld - a.appointmentsHeld || b.grossAgents - a.grossAgents || b.callsAnswered - a.callsAnswered
  );
  const formatBadgeMonthYear = (value: string) =>
    new Date(value).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 p-6">
      {/* Header - Consistent with other pages */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Team Leader Hub</h1>
          <p className="mt-0.5 text-sm text-slate-600">Track daily metrics, earn badges, and climb the leaderboard</p>
        </div>
        {/* Rank Card on the Right */}
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-gradient-to-br from-red-50 to-red-50/50 px-5 py-3 shadow-sm h-fit">
          <div>
            <p className="text-xs font-semibold text-slate-500">YOUR RANK</p>
            <p className="text-2xl font-bold text-[#b31d33]">#{dashboard.leaderboardPosition} of {dashboard.totalLeaderboardSize}</p>
          </div>
          <div className="pl-3 border-l border-red-100">
            <p className="text-xs text-slate-600 font-medium">{(dashboard.associate as any).marketCenterName || dashboard.associate.name}</p>
          </div>
        </div>
      </div>

      <TeamLeaderTopTabs />

      {/* Success Message */}
      {submitSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-green-700 font-semibold text-sm">✅ Metrics submitted successfully!</p>
          {submittedBadges.length > 0 && (
            <p className="text-green-600 mt-1 text-sm">
              🎉 You earned {submittedBadges.length} new badge(s): {submittedBadges.map((b) => b.displayName).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Daily Entry Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-base font-semibold text-slate-950">Today's Metrics</h2>
          <p className="mt-0.5 text-xs text-slate-600">Submit your daily performance</p>
        </div>
        <form onSubmit={handleSubmitMetrics} className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600 mb-2">Calls Answered</label>
            <input
              type="number"
              min="0"
              value={metrics.callsAnswered}
              onChange={(e) => handleMetricChange('callsAnswered', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600 mb-2">Appointments Set</label>
            <input
              type="number"
              min="0"
              value={metrics.appointmentsSet}
              onChange={(e) => handleMetricChange('appointmentsSet', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600 mb-2">Appointments Held</label>
            <input
              type="number"
              min="0"
              value={metrics.appointmentsHeld}
              onChange={(e) => handleMetricChange('appointmentsHeld', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600 mb-2">Gross Agents</label>
            <input
              type="number"
              min="0"
              value={metrics.grossAgents}
              onChange={(e) => handleMetricChange('grossAgents', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-600 mb-2">Notes (optional)</label>
            <textarea
              value={metrics.notes || ''}
              onChange={(e) => handleMetricChange('notes', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm transition-all hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b31d33]/20 focus:border-[#b31d33]"
              rows={2}
              placeholder="Add any notes about your day..."
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="md:col-span-2 rounded-lg bg-gradient-to-r from-[#b31d33] to-[#8c1c2a] px-5 py-2 font-semibold text-sm text-white transition-all hover:from-[#a0192d] hover:to-[#7d1524] hover:shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit Metrics'}
          </button>
        </form>
      </div>

      {/* Progress Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-950">This Week</h3>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Calls Answered</span>
                <span className="font-semibold text-slate-900">{dashboard.thisWeek.callsAnswered}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-[#b31d33]" style={{ width: `${Math.min((dashboard.thisWeek.callsAnswered / 50) * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Appointments Set</span>
                <span className="font-semibold text-slate-900">{dashboard.thisWeek.appointmentsSet}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min((dashboard.thisWeek.appointmentsSet / 20) * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Conversion Ratio</span>
                <span className="font-semibold text-slate-900">{conversionRatioWeek.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(conversionRatioWeek, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Gross Gain</span>
                <span className="font-semibold text-slate-900">{dashboard.thisWeek.grossAgents}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${Math.min((dashboard.thisWeek.grossAgents / 20) * 100, 100)}%` }} />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">{dashboard.thisWeek.submissionCount} days submitted</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-950">This Month</h3>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Calls Answered</span>
                <span className="font-semibold text-slate-900">{dashboard.thisMonth.callsAnswered}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-[#b31d33]" style={{ width: `${Math.min((dashboard.thisMonth.callsAnswered / 200) * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Appointments Set</span>
                <span className="font-semibold text-slate-900">{dashboard.thisMonth.appointmentsSet}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min((dashboard.thisMonth.appointmentsSet / 80) * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Conversion Ratio</span>
                <span className="font-semibold text-slate-900">{conversionRatioMonth.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(conversionRatioMonth, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">Gross Gain</span>
                <span className="font-semibold text-slate-900">{dashboard.thisMonth.grossAgents}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${Math.min((dashboard.thisMonth.grossAgents / 60) * 100, 100)}%` }} />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">{dashboard.thisMonth.submissionCount} days submitted</p>
          </div>
        </div>
      </div>

      {/* Badges Section */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-950">Your Badges ({dashboard.recentBadges.length})</h2>
          <p className="mt-0.5 text-xs text-slate-600">Achievements earned this month</p>
        </div>
        <div className="p-4">
        {dashboard.recentBadges.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {dashboard.recentBadges.map((badge) => {
              const info = TEAM_LEADER_BADGE_INFO[badge.badgeType];
              return (
                <div key={badge.id} className="group rounded-lg border border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-50/50 p-2.5 text-center shadow-sm transition-all hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5">
                  {info?.imageSrc ? (
                    <button
                      type="button"
                      onClick={() => setSelectedBadge({ label: info.label, imageSrc: info.imageSrc, earnedAt: badge.earnedAt })}
                      className="mx-auto mb-1.5 block rounded-lg transition-all hover:scale-110 hover:drop-shadow-lg focus:outline-none focus:ring-2 focus:ring-[#b31d33] focus:ring-offset-2"
                      aria-label={`Open larger image for ${info.label}`}
                    >
                      <img
                        src={info.imageSrc}
                        alt={info.label}
                        className="h-14 w-auto object-contain"
                      />
                    </button>
                  ) : (
                    <div className="mb-1 text-xl">{info?.fallbackEmoji || '🎖️'}</div>
                  )}
                  <p className="font-semibold text-xs text-slate-950">{info?.label || badge.badgeDisplayName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{formatBadgeMonthYear(badge.earnedAt)}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-600">No badges earned yet. Keep submitting metrics to earn achievements! 🎯</p>
        )}
        </div>
      </div>

      {selectedBadge && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedBadge.label} badge preview`}
          onClick={() => setSelectedBadge(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Badge Preview</p>
                  <h3 className="text-2xl font-bold text-slate-950">{selectedBadge.label}</h3>
                  <p className="mt-1 text-sm text-slate-600">{formatBadgeMonthYear(selectedBadge.earnedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBadge(null)}
                  className="rounded-full bg-white border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex-shrink-0 shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex justify-center p-8">
              <img
                src={selectedBadge.imageSrc}
                alt={selectedBadge.label}
                className="h-64 w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Section */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-950">Weekly Leaderboard</h2>
          <p className="mt-0.5 text-xs text-slate-600">Top performers this week</p>
        </div>
        {leaderboard.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700 text-xs">Rank</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-700 text-xs">Name</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700 text-xs">Appts</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700 text-xs">Calls</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700 text-xs">Held</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700 text-xs">Gain</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-700 text-xs">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedLeaderboard.map((entry, index) => {
                  const conversionRatio = entry.appointmentsHeld > 0
                    ? (entry.grossAgents / entry.appointmentsHeld) * 100
                    : 0;
                  const displayedRank = entry.associateId === dashboard.associate.id
                    ? dashboard.leaderboardPosition
                    : index + 1;

                  return (
                  <tr
                    key={entry.associateId}
                    className={entry.associateId === dashboard.associate.id ? 'bg-red-50/60' : 'hover:bg-slate-50/80 transition-colors'}
                  >
                    <td className="px-3 py-2">
                      <span className="font-bold text-sm text-[#b31d33]">#{displayedRank}</span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900 text-xs">
                      {entry.associateName}
                      {entry.associateId === dashboard.associate.id && <span className="text-xs ml-2 rounded-full bg-red-200 px-2 py-0.5 text-red-800 font-semibold inline-block">You</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 text-xs">{entry.appointmentsSet}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 text-xs">{entry.callsAnswered}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 text-xs">{entry.appointmentsHeld}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 text-xs">{entry.grossAgents}</td>
                    <td className="px-3 py-2 text-right"><span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold text-xs">{conversionRatio.toFixed(1)}%</span></td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-600 px-4 py-3 text-xs">Leaderboard data coming soon...</p>
        )}
      </div>

      {/* Motivational Section */}
      <div className="rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-blue-50/40 px-4 py-3 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Your Next Target</h3>
        <p className="text-xs text-slate-700 leading-relaxed mt-1">
          {dashboard.thisWeek.appointmentsSet < 3
            ? `You're ${3 - dashboard.thisWeek.appointmentsSet} appointments away from earning the Momentum Builder badge this week! 🚀`
            : dashboard.thisMonth.appointmentsSet < 40
            ? 'Get your market centre to 40+ appointments this month for the 40 Club badge! 📞'
            : dashboard.thisMonth.appointmentsSet < 80
            ? 'You\'re making great progress! Aim for 80 appointments this month for the championship! 👑'
            : 'Amazing performance! You\'re crushing it. Keep up the momentum! 🔥'}
        </p>
      </div>
    </div>
  );
}
