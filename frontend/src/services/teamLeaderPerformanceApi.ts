/**
 * Team Leader Performance API Service
 * Centralized API calls for team leader performance features
 */

const API_BASE = '/api/team-leader';

export interface DailyMetrics {
  callsAnswered: number;
  appointmentsSet: number;
  appointmentsHeld: number;
  grossAgents: number;
  notes?: string;
}

export interface DashboardData {
  associate: { id: number; name: string };
  today: any;
  thisWeek: any;
  thisMonth: any;
  recentBadges: any[];
  leaderboardPosition: number;
  totalLeaderboardSize: number;
}

export interface LeaderboardEntry {
  rank: number;
  associateId: number;
  associateName: string;
  appointmentsSet: number;
  callsAnswered: number;
  appointmentsHeld: number;
  submissionCount: number;
}

export interface DailySubmissionRow {
  metricDate: string;
  associateId: number;
  leaderName: string;
  callsAnswered: number;
  appointmentsSet: number;
  appointmentsHeld: number;
  grossAgents: number;
  total: number;
  submittedAt: string;
  notes: string | null;
}

export interface DailySubmissionDayTotal {
  metricDate: string;
  submissions: number;
  callsAnswered: number;
  appointmentsSet: number;
  appointmentsHeld: number;
  grossAgents: number;
  total: number;
}

export interface DailySubmissionReport {
  marketCenterId: string;
  marketCenterName: string;
  month: string;
  rows: DailySubmissionRow[];
  dailyTotals: DailySubmissionDayTotal[];
  monthTotals: {
    submissions: number;
    callsAnswered: number;
    appointmentsSet: number;
    appointmentsHeld: number;
    grossAgents: number;
    total: number;
    conversionRatio: number;
  };
}

async function apiCall(endpoint: string, options?: RequestInit) {
  const token = localStorage.getItem('kwsa_auth_token');
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

export async function fetchDashboard(token: string) {
  return apiCall('/dashboard', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchLeaderboard(token: string, period: string = 'week') {
  return apiCall(`/leaderboard?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchBadges(token: string) {
  return apiCall('/badges', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchDailyMetrics(token: string, date?: string) {
  const endpoint = date ? `/daily-metrics/${date}` : '/daily-metrics';
  return apiCall(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function submitDailyMetrics(token: string, metrics: DailyMetrics) {
  return apiCall('/daily-metrics', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(metrics),
  });
}

export async function fetchAdminReport(token: string, marketCenterId: string, period: string = 'month', contextId?: string) {
  return apiCall(`/admin/performance-report?mc_id=${marketCenterId}&period=${period}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contextId ? { 'X-Active-Context': contextId } : {}),
    },
  });
}

export async function fetchAdminDailyFigures(token: string, marketCenterId: string, month: string, contextId?: string) {
  const params = new URLSearchParams({ mc_id: marketCenterId, month });
  return apiCall(`/admin/daily-submissions?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contextId ? { 'X-Active-Context': contextId } : {}),
    },
  });
}
