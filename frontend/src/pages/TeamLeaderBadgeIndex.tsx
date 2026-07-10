import TeamLeaderTopTabs from '../components/teamLeader/TeamLeaderTopTabs';
import { TEAM_LEADER_BADGE_INFO, TeamLeaderBadgeType } from '../constants/teamLeaderBadges';

const BADGE_REQUIREMENTS: Record<TeamLeaderBadgeType, string> = {
  FAST_STARTER: 'Submit your daily figures before 09:00.',
  MOMENTUM_BUILDER: 'Set 3 or more appointments in one day.',
  FORTY_CLUB: 'Your market centre reaches 40+ appointments set in the month.',
  TOP_CALLER: 'Have the highest calls answered in your market centre for the day.',
  CONVERSION_KING: 'Hold at least 50% of appointments set on the day.',
  COMEBACK_MC: 'Your market centre moves from lowest yesterday to highest today.',
  CONSISTENCY_AWARD: 'Submit daily figures for 5 or more consecutive days.',
  RAINMAKER_DAY: 'Set 10+ appointments and answer 50+ calls on the same day.',
};

const BADGE_ORDER: TeamLeaderBadgeType[] = [
  'FAST_STARTER',
  'MOMENTUM_BUILDER',
  'FORTY_CLUB',
  'TOP_CALLER',
  'CONVERSION_KING',
  'COMEBACK_MC',
  'CONSISTENCY_AWARD',
  'RAINMAKER_DAY',
];

export default function TeamLeaderBadgeIndex() {
  return (
    <div className="space-y-8 p-8">      {/* Professional Header Section */}
      <div>
        <h1 className="text-3xl font-bold text-slate-950">Team Leader Hub</h1>
        <p className="mt-0.5 text-sm text-slate-600">All available badges and achievement rules</p>
      </div>
      <TeamLeaderTopTabs />

      <div className="rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Team Leader Badges</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Badge Index</h1>
        <p className="mt-2 text-sm text-slate-600">
          Every badge, its image, and what a Team Leader must do to achieve it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {BADGE_ORDER.map((badgeType) => {
          const badgeInfo = TEAM_LEADER_BADGE_INFO[badgeType];
          return (
            <article
              key={badgeType}
              className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                  {badgeInfo.imageSrc ? (
                    <img src={badgeInfo.imageSrc} alt={badgeInfo.label} className="h-20 w-20 object-contain" />
                  ) : (
                    <span className="text-2xl">{badgeInfo.fallbackEmoji}</span>
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{badgeInfo.label}</h2>
                </div>
              </div>
              <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                {BADGE_REQUIREMENTS[badgeType]}
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
