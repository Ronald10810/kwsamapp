/**
 * Team Leader Performance Utilities
 * Helper functions for badges, metrics, and calculations
 */

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function calculateConversionRatio(held: number, set: number): number {
  if (set === 0) return 0;
  return Math.round((held / set) * 100);
}

export function getProgressPercentage(current: number, target: number): number {
  if (target === 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

export function getMetricThresholds() {
  return {
    calls: {
      excellent: 50,
      good: 25,
      fair: 15,
    },
    appointments: {
      excellent: 10,
      good: 5,
      fair: 3,
    },
    conversionRatio: {
      excellent: 75,
      good: 50,
      fair: 25,
    },
  };
}

export function getMotivationalMessage(callsAnswered: number, appointmentsSet: number, conversionRatio: number): string {
  const thresholds = getMetricThresholds();

  if (callsAnswered >= thresholds.calls.excellent && appointmentsSet >= thresholds.appointments.excellent) {
    return '🚀 You\'re on fire today! Keep this momentum going!';
  }

  if (conversionRatio >= thresholds.conversionRatio.excellent) {
    return '👑 Exceptional conversion rate! You\'re a pro!';
  }

  if (appointmentsSet >= thresholds.appointments.excellent) {
    return '⭐ Amazing appointment setting! Keep it up!';
  }

  if (callsAnswered >= thresholds.calls.good && appointmentsSet >= thresholds.appointments.good) {
    return '💪 Great progress! You\'re doing well!';
  }

  if (callsAnswered >= thresholds.calls.fair) {
    return '📞 Good call activity! Keep dialing!';
  }

  return '🎯 Every call brings you closer to success!';
}

export interface BadgeProgress {
  type: string;
  displayName: string;
  emoji: string;
  progress: number;
  achieved: boolean;
  nextTarget: string;
}

export function getBadgeProgress(metrics: any): BadgeProgress[] {
  const { callsAnswered = 0, appointmentsSet = 0, appointmentsHeld = 0 } = metrics || {};
  const conversionRatio = calculateConversionRatio(appointmentsHeld, appointmentsSet);

  return [
    {
      type: 'FAST_STARTER',
      displayName: 'Fast Starter',
      emoji: '🌅',
      progress: 0,
      achieved: false,
      nextTarget: 'Submit before 9 AM',
    },
    {
      type: 'MOMENTUM_BUILDER',
      displayName: 'Momentum Builder',
      emoji: '🚀',
      progress: Math.min(100, Math.round((appointmentsSet / 3) * 100)),
      achieved: appointmentsSet >= 3,
      nextTarget: `${3 - appointmentsSet} more appointments`,
    },
    {
      type: 'FORTY_CLUB',
      displayName: '40 Club',
      emoji: '📞',
      progress: Math.min(100, Math.round((callsAnswered / 40) * 100)),
      achieved: callsAnswered >= 40,
      nextTarget: `${Math.max(0, 40 - callsAnswered)} more calls`,
    },
    {
      type: 'TOP_CALLER',
      displayName: 'Top Caller',
      emoji: '🏆',
      progress: 0,
      achieved: false,
      nextTarget: 'Highest calls in MC today',
    },
    {
      type: 'CONVERSION_KING',
      displayName: 'Conversion King',
      emoji: '👑',
      progress: Math.min(100, Math.round((conversionRatio / 50) * 100)),
      achieved: conversionRatio >= 50,
      nextTarget: `${Math.max(0, 50 - conversionRatio)}% more conversion`,
    },
    {
      type: 'CONSISTENCY_AWARD',
      displayName: 'Consistency Award',
      emoji: '⭐',
      progress: 0,
      achieved: false,
      nextTarget: '5 consecutive days',
    },
    {
      type: 'RAINMAKER_DAY',
      displayName: 'Rainmaker Day',
      emoji: '☔',
      progress: Math.min(100, ((Math.min(callsAnswered / 50, 1) + Math.min(appointmentsSet / 10, 1)) / 2) * 100),
      achieved: callsAnswered >= 50 && appointmentsSet >= 10,
      nextTarget: '50+ calls AND 10+ appointments',
    },
    {
      type: 'COMEBACK_MC',
      displayName: 'Comeback MC',
      emoji: '🔄',
      progress: 0,
      achieved: false,
      nextTarget: 'Lead MC after being last',
    },
  ];
}
