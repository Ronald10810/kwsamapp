export type TeamLeaderBadgeType =
  | 'FAST_STARTER'
  | 'MOMENTUM_BUILDER'
  | 'FORTY_CLUB'
  | 'TOP_CALLER'
  | 'CONVERSION_KING'
  | 'COMEBACK_MC'
  | 'CONSISTENCY_AWARD'
  | 'RAINMAKER_DAY';

export interface TeamLeaderBadgeInfo {
  label: string;
  imageSrc: string;
  fallbackEmoji: string;
}

export const TEAM_LEADER_BADGE_INFO: Record<string, TeamLeaderBadgeInfo> = {
  FAST_STARTER: {
    label: 'Fast Starter',
    imageSrc: '/images/team-leader-badges/fast-starter.png',
    fallbackEmoji: '🌅',
  },
  MOMENTUM_BUILDER: {
    label: 'Momentum Builder',
    imageSrc: '/images/team-leader-badges/momentum-builder.png',
    fallbackEmoji: '🚀',
  },
  FORTY_CLUB: {
    label: '40 Club',
    imageSrc: '/images/team-leader-badges/forty-club.png',
    fallbackEmoji: '📞',
  },
  TOP_CALLER: {
    label: 'Top Caller',
    imageSrc: '/images/team-leader-badges/top-caller.png',
    fallbackEmoji: '🏆',
  },
  CONVERSION_KING: {
    label: 'Conversion King',
    imageSrc: '/images/team-leader-badges/conversion-king.png',
    fallbackEmoji: '👑',
  },
  COMEBACK_MC: {
    label: 'Comeback MC',
    imageSrc: '/images/team-leader-badges/comeback-mc.png',
    fallbackEmoji: '🔄',
  },
  CONSISTENCY_AWARD: {
    label: 'Consistency Award',
    imageSrc: '/images/team-leader-badges/consistency-award.png',
    fallbackEmoji: '⭐',
  },
  RAINMAKER_DAY: {
    label: 'Rainmaker Day',
    imageSrc: '/images/team-leader-badges/rainmaker-day.png',
    fallbackEmoji: '☔',
  },
};
