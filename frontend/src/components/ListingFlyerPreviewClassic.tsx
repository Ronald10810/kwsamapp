import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type ListingFlyerData, type ListingFlyerMetric } from './ListingFlyerPreview';

type ListingFlyerPreviewProps = {
  data: ListingFlyerData;
  isLoadingAssociate: boolean;
  isLoadingListingDetails: boolean;
  forExport?: boolean;
};

function FlyerMetricIcon({ kind }: { kind: ListingFlyerMetric['icon'] }) {
  const className = 'h-4 w-4 text-[#7a4f32]';

  if (kind === 'bed') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M3 12h18v6H3z" />
        <path d="M5 12V8a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3v3" />
        <path d="M3 18v2M21 18v2" />
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
  if (kind === 'garage') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M3 11l9-6 9 6" />
        <path d="M5 10h14v8H5z" />
        <path d="M8 18v-3M12 18v-3M16 18v-3" />
      </svg>
    );
  }
  if (kind === 'parking') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M10 16V8h4a3 3 0 0 1 0 6h-4" />
      </svg>
    );
  }
  if (kind === 'erf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M4 7h16v10H4z" />
        <path d="M9 7v10M15 7v10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M5 5h14v14H5z" />
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

const ListingFlyerPreviewClassic = forwardRef<HTMLDivElement, ListingFlyerPreviewProps>(function ListingFlyerPreviewClassic(
  { data, isLoadingAssociate, isLoadingListingDetails, forExport = false },
  ref,
) {
  const descriptionArticleRef = useRef<HTMLElement | null>(null);
  const descriptionParagraphRef = useRef<HTMLParagraphElement | null>(null);
  const [descriptionLineClamp, setDescriptionLineClamp] = useState(9);
  const facts = data.facts.slice(0, 6);
  const hasFacts = facts.length > 0;
  const gallery = data.galleryImageUrls.slice(0, 3);
  const statTiles = data.metrics.slice(0, 5);
  const heroCandidates = useMemo(
    () => [...new Set([data.heroImageUrl, ...data.galleryImageUrls].filter((entry): entry is string => Boolean(entry)))],
    [data.heroImageUrl, data.galleryImageUrls],
  );
  const [heroCandidateIndex, setHeroCandidateIndex] = useState(0);
  const activeHeroImageUrl = forExport ? (data.heroImageUrl ?? null) : (heroCandidates[heroCandidateIndex] ?? null);

  useEffect(() => {
    setHeroCandidateIndex(0);
  }, [heroCandidates]);

  useLayoutEffect(() => {
    const article = descriptionArticleRef.current;
    const paragraph = descriptionParagraphRef.current;
    if (!article || !paragraph) return;

    const MIN_LINES = 4;
    const BOTTOM_GAP_PX = 2;

    const recomputeClamp = () => {
      const paragraphStyle = window.getComputedStyle(paragraph);
      const articleStyle = window.getComputedStyle(article);
      const lineHeight = Number.parseFloat(paragraphStyle.lineHeight || '0');
      const paddingBottom = Number.parseFloat(articleStyle.paddingBottom || '0');
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

      const articleRect = article.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const usableHeight = articleRect.bottom - paragraphRect.top - paddingBottom - BOTTOM_GAP_PX;
      const nextClamp = Math.max(MIN_LINES, Math.floor(usableHeight / lineHeight));
      setDescriptionLineClamp((prev) => (prev === nextClamp ? prev : nextClamp));
    };

    recomputeClamp();

    const observer = new ResizeObserver(() => {
      recomputeClamp();
    });
    observer.observe(article);

    window.addEventListener('resize', recomputeClamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recomputeClamp);
    };
  }, [data.description, isLoadingListingDetails, forExport]);

  return (
    <div
      ref={ref}
      className="mx-auto h-[1123px] w-[794px] max-w-[794px] overflow-hidden bg-white text-slate-900 shadow-[0_30px_90px_rgba(15,23,42,0.18)]"
      style={{ aspectRatio: '794 / 1123' }}
    >
      <div className="relative flex h-full flex-col bg-[#f4f4f4]">
        <section className="relative h-[310px] overflow-hidden bg-slate-200">
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
            <div className="flex h-full items-center justify-center bg-[linear-gradient(120deg,#d8d8d8,#f1f1f1)] text-sm font-medium text-slate-600">Property image not available</div>
          )}

          <div className="absolute left-0 top-0 bg-red-600 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white">
            {data.statusLabel || 'For Sale'}
          </div>

          <div className="absolute bottom-0 right-0 bg-red-600 px-4 py-1 text-[15px] font-bold text-white">
            {data.price}
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white px-6 pb-4 pt-3 text-center">
          <h1
            className="mx-auto max-w-[680px] text-[36px] font-semibold leading-[1.04] tracking-[-0.015em] text-slate-900"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {data.title}
          </h1>
          {data.address ? (
            <p
              className="mx-auto mt-1 max-w-[670px] text-[12px] text-slate-600"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {data.address}
            </p>
          ) : null}
        </section>

        <section className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-white px-1.5 py-1.5">
          {gallery.length > 0 ? gallery.map((url, idx) => (
            <div key={`${url}-${idx}`} className="h-[118px] overflow-hidden rounded border border-slate-200 bg-slate-100">
              <img src={url} alt={`Gallery ${idx + 1}`} className="h-full w-full object-cover" />
            </div>
          )) : (
            <div className="col-span-3 flex h-[118px] items-center justify-center rounded border border-slate-200 bg-slate-100 text-[10px] text-slate-500">No additional images</div>
          )}
        </section>

        {data.metrics.length > 0 ? (
          <section className="grid grid-cols-3 gap-2 border-b border-slate-300 bg-white px-1.5 py-1.5">
            {Array.from({ length: 3 }).map((_, colIdx) => {
              const topMetric = statTiles[colIdx] ?? null;
              const bottomMetric = statTiles[colIdx + 3] ?? null;

              return (
                <div key={`metric-col-${colIdx}`} className="grid grid-rows-[40px_40px] overflow-hidden rounded border border-slate-300 bg-[#3f3f46]">
                  {topMetric ? (
                    <div className="flex h-full items-center justify-center gap-2 border-b border-slate-300 px-2 text-white">
                      <FlyerMetricIcon kind={topMetric.icon} />
                      <span className="text-[11px] font-semibold leading-none tracking-[0.03em]">{topMetric.value} {topMetric.label}</span>
                    </div>
                  ) : (
                    <div className="h-full border-b border-slate-300" />
                  )}

                  {colIdx === 2 ? (
                    <div className="flex h-full items-center justify-center px-2 text-white">
                      <span className="text-[11px] font-semibold leading-none tracking-[0.03em]">Ref: {data.reference}</span>
                    </div>
                  ) : bottomMetric ? (
                    <div className="flex h-full items-center justify-center gap-2 px-2 text-white">
                      <FlyerMetricIcon kind={bottomMetric.icon} />
                      <span className="text-[11px] font-semibold leading-none tracking-[0.03em]">{bottomMetric.value} {bottomMetric.label}</span>
                    </div>
                  ) : (
                    <div className="h-full" />
                  )}
                </div>
              );
            })}
          </section>
        ) : null}

        <section className="grid min-h-0 flex-1 grid-cols-[1.55fr_0.95fr] gap-3 bg-white px-5 py-2">
          <article ref={descriptionArticleRef} className="min-h-0 rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-[16px] font-semibold text-slate-900">Property Description</h2>
            {isLoadingListingDetails ? <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">Refreshing</p> : null}
            <p
              ref={descriptionParagraphRef}
              className="mt-2 whitespace-pre-line text-[11px] leading-[1.55] text-slate-700"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: descriptionLineClamp,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                paddingBottom: '2px',
              }}
            >
              {data.description}
            </p>
          </article>

          <aside className="grid min-h-0 grid-rows-[auto_1fr] gap-3">
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">Agent Details</p>
              <div className="mt-2 flex items-start gap-2.5">
                {data.associate.photoUrl ? (
                  <img src={data.associate.photoUrl} alt={data.associate.name} className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-200 text-base font-bold text-slate-700">{data.associate.initials}</div>
                )}
                <div className="min-w-0 overflow-hidden">
                  <p className="truncate text-[14px] font-semibold leading-tight text-slate-900">{data.associate.name}</p>
                  {data.associate.marketCenterName ? <p className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{data.associate.marketCenterName}</p> : null}
                  <p className="mt-1 truncate text-[10px] text-slate-700">{data.associate.phone}</p>
                  <p className="truncate text-[9px] text-slate-600">{data.associate.email}</p>
                  {isLoadingAssociate ? <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-slate-400">Refreshing</p> : null}
                </div>
              </div>
            </section>

            <section className="min-h-0 rounded-lg border border-slate-200 bg-[#fafafa] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">Additional Info</p>
              <div className="mt-1.5 space-y-1">
                {hasFacts ? facts.map((fact) => (
                  <div key={fact.key} className="flex items-center justify-between gap-2 text-[10px] border-b border-slate-200 pb-1 last:border-b-0 last:pb-0">
                    <span className="text-slate-500">{fact.label}</span>
                    <span className="max-w-[60%] truncate text-right font-semibold text-slate-800" title={fact.value}>{fact.value}</span>
                  </div>
                )) : <p className="text-[10px] text-slate-500">No additional facts available.</p>}
              </div>
            </section>
          </aside>
        </section>

        <footer className="mt-auto bg-red-700 px-5 py-3 text-white">
          <div className="grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-4 gap-y-2">
            <div className="flex items-center gap-3">
              {data.associate.photoUrl ? (
                <img src={data.associate.photoUrl} alt={data.associate.name} className="h-12 w-12 rounded object-cover border border-white/20" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded bg-white/20 text-sm font-bold">{data.associate.initials}</div>
              )}
              <div>
                <p className="text-[13px] font-semibold leading-tight">{data.associate.name}</p>
                <p className="text-[10px] text-white/80">{data.associate.phone} | {data.associate.email}</p>
              </div>
            </div>

            <div className="row-span-2 flex items-end justify-end pb-[2px]">
              {data.associate.marketCenterLogoUrl ? (
                <img src={data.associate.marketCenterLogoUrl} alt={data.associate.marketCenterName ?? 'Market Centre'} className="h-12 w-auto max-w-[220px] object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
              ) : (
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85">Contact us for more details</p>
              )}
            </div>

            {data.disclaimer ? <p className="text-[9px] text-white/80">{data.disclaimer}</p> : <span />}
          </div>
        </footer>
      </div>
    </div>
  );
});

export default ListingFlyerPreviewClassic;
