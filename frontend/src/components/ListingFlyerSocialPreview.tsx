import { forwardRef, useEffect, useMemo, useState } from 'react';
import { type ListingFlyerData, type ListingFlyerMetric } from './ListingFlyerPreview';

export type SocialFlyerVariant = 'square' | 'wide' | 'portrait' | 'story';

type ListingFlyerSocialPreviewProps = {
  data: ListingFlyerData;
  variant: SocialFlyerVariant;
  statusPillText?: string;
  forExport?: boolean;
};

const SOCIAL_VARIANT_DIMENSIONS: Record<SocialFlyerVariant, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  wide: { width: 1200, height: 628 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

function StatIcon({ kind }: { kind: ListingFlyerMetric['icon'] }) {
  const className = 'h-4 w-4 text-white';

  if (kind === 'bed') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M3 12h18v6H3z" />
        <path d="M5 12V8a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3v3" />
      </svg>
    );
  }
  if (kind === 'bath') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M4 13h16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
        <path d="M7 13V7a2 2 0 1 1 4 0v1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 11l9-6 9 6" />
      <path d="M5 10h14v8H5z" />
      <path d="M8 18v-3M12 18v-3M16 18v-3" />
    </svg>
  );
}

function metricValue(metrics: ListingFlyerMetric[], key: 'bedrooms' | 'bathrooms' | 'garages'): string {
  const match = metrics.find((entry) => entry.key === key);
  return match?.value ?? '-';
}

const ListingFlyerSocialPreview = forwardRef<HTMLDivElement, ListingFlyerSocialPreviewProps>(function ListingFlyerSocialPreview(
  { data, variant, statusPillText = 'Just Listed', forExport = false },
  ref,
) {
  const dimensions = SOCIAL_VARIANT_DIMENSIONS[variant];
  const aspectRatio = `${dimensions.width} / ${dimensions.height}`;
  const isStory = variant === 'story';
  const isWide = variant === 'wide';

  const bedrooms = metricValue(data.metrics, 'bedrooms');
  const bathrooms = metricValue(data.metrics, 'bathrooms');
  const garages = metricValue(data.metrics, 'garages');
  const heroCandidates = useMemo(
    () => [...new Set([data.heroImageUrl, ...data.galleryImageUrls].filter((entry): entry is string => Boolean(entry)))],
    [data.heroImageUrl, data.galleryImageUrls],
  );
  const [heroCandidateIndex, setHeroCandidateIndex] = useState(0);
  const activeHeroImageUrl = forExport ? (data.heroImageUrl ?? null) : (heroCandidates[heroCandidateIndex] ?? null);

  useEffect(() => {
    setHeroCandidateIndex(0);
  }, [heroCandidates]);

  return (
    <div
      ref={ref}
      className="mx-auto overflow-hidden bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.4)]"
      style={{
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        minWidth: `${dimensions.width}px`,
        maxWidth: `${dimensions.width}px`,
        minHeight: `${dimensions.height}px`,
        maxHeight: `${dimensions.height}px`,
        aspectRatio,
      }}
    >
      <div className="relative h-full w-full">
        {activeHeroImageUrl ? (
          <img
            src={activeHeroImageUrl}
            alt={data.title}
            className="h-full w-full object-cover"
            crossOrigin={forExport ? 'anonymous' : undefined}
            onError={forExport ? undefined : () => {
              setHeroCandidateIndex((current) => (current < heroCandidates.length ? current + 1 : current));
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(130deg,#334155,#0f172a)] text-sm uppercase tracking-[0.2em] text-white/70">
            No image
          </div>
        )}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.18)_0%,rgba(15,23,42,0.36)_36%,rgba(15,23,42,0.86)_100%)]" />

        <div className={`absolute left-8 top-8 rounded-full bg-red-600 font-extrabold uppercase tracking-[0.14em] text-white ${isWide ? 'px-4 py-1.5 text-[24px]' : 'px-5 py-2 text-[28px]'}`}>
          {statusPillText}
        </div>

        <div className={`absolute inset-x-0 ${isStory ? 'bottom-10' : 'bottom-8'} px-8`}>
          <div className={`rounded-3xl border border-white/20 bg-slate-900/78 backdrop-blur-sm ${isWide ? 'p-5' : 'p-7'}`}>
            <p className={`${isStory ? 'text-[74px]' : isWide ? 'text-[56px]' : 'text-[66px]'} font-black leading-[1] tracking-[-0.02em] text-white`}>{data.price}</p>
            <p
              className={`mt-3 font-semibold leading-[1.1] text-white ${isWide ? 'text-[32px]' : 'text-[40px]'}`}
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {data.title}
            </p>

            <div className={`mt-5 flex flex-wrap items-center ${isWide ? 'gap-3' : 'gap-5'}`}>
              <div className={`inline-flex items-center gap-2 rounded-full bg-white/10 font-bold text-white ${isWide ? 'px-3 py-1.5 text-[22px]' : 'px-4 py-2 text-[26px]'}`}>
                <StatIcon kind="bed" />
                <span>{bedrooms}</span>
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full bg-white/10 font-bold text-white ${isWide ? 'px-3 py-1.5 text-[22px]' : 'px-4 py-2 text-[26px]'}`}>
                <StatIcon kind="bath" />
                <span>{bathrooms}</span>
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full bg-white/10 font-bold text-white ${isWide ? 'px-3 py-1.5 text-[22px]' : 'px-4 py-2 text-[26px]'}`}>
                <StatIcon kind="garage" />
                <span>{garages}</span>
              </div>
            </div>

            <div className={`mt-6 flex items-center justify-between gap-4 border-t border-white/20 ${isWide ? 'pt-4' : 'pt-5'}`}>
              <div className="flex min-w-0 items-center gap-3">
                {data.associate.photoUrl ? (
                  <img src={data.associate.photoUrl} alt={data.associate.name} className={`${isWide ? 'h-14 w-14' : 'h-16 w-16'} rounded-full border border-white/35 object-cover`} />
                ) : (
                  <div className={`${isWide ? 'h-14 w-14' : 'h-16 w-16'} flex items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white`}>{data.associate.initials}</div>
                )}
                <div className="min-w-0">
                  <p className={`truncate font-semibold text-white ${isWide ? 'text-[24px]' : 'text-[28px]'}`}>{data.associate.name}</p>
                  <p className={`truncate font-medium text-white/85 ${isWide ? 'text-[16px]' : 'text-[18px]'}`}>{data.associate.phone}</p>
                </div>
              </div>

              {data.associate.marketCenterLogoUrl ? (
                <img
                  src={data.associate.marketCenterLogoUrl}
                  alt={data.associate.marketCenterName ?? 'Market Centre'}
                  className={`${isWide ? 'h-12 max-w-[250px]' : 'h-14 max-w-[280px]'} w-auto object-contain`}
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              ) : (
                <p className={`${isWide ? 'text-[15px]' : 'text-[18px]'} font-semibold uppercase tracking-[0.14em] text-white/80`}>
                  {data.associate.marketCenterName ?? 'Keller Williams'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const listingFlyerSocialDimensions = SOCIAL_VARIANT_DIMENSIONS;

export default ListingFlyerSocialPreview;
