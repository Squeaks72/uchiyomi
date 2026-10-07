'use client';
import { useEffect, useRef, useState } from 'react';
import { Img, useAutoplay, useWideViewport } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { IcPause, IcPlay, IcPlus, IcSparkle } from '@/components/icons';
import { t as tr } from '@/lib/i18n';
import { dotWindow } from '@/lib/carousel';
import { useDiscoverMenu } from '@/components/DiscoverMenu';
import { Blurb } from '@/components/Blurb';

export interface Trending {
  title: string;
  cover: string | null;
  /** Wide AniList key art. Returned by /api/discover/trending since it shipped, and never once rendered. */
  banner?: string | null;
  description: string;
  genres: string[];
  score: number | null;
  chapters: number | null;
  status: string | null;
}

/**
 * The one cinematic surface on Discover, and it costs nothing to build.
 *
 * `/api/discover/trending` has always returned `banner`, `genres`, `score`, `chapters` and `status` for
 * twenty-four globally trending titles it has already filtered against this library. The page declared an
 * interface without `banner` and rendered the rest as a 144px thumbnail with a percentage badge. So the art
 * for a proper hero was sitting in the payload of a page whose complaint was that it is not cinematic.
 *
 * On a phone the banner is the wrong picture: a 4.75:1 strip inside a 1.1:1 box shows about a quarter of it,
 * reliably the quarter with no face. So narrow viewports take the 2:3 cover, cropped from the top.
 */
export function DiscoverHero({ slides, onPick }: { slides: Trending[]; onPick: (t: Trending) => void }) {
  const wide = useWideViewport();
  const [i, setI] = useState(0);
  const auto = useAutoplay();
  const startX = useRef(0);

  // 5s, not 7s. With ten slides a seven-second beat is a seventy-second loop, so the back half was seen by
  // essentially nobody; fifty seconds gives every slide a realistic chance while still leaving time to read
  // a title and decide.
  useEffect(() => {
    if (!auto.running || slides.length < 2) return;
    const t = setTimeout(() => setI((v) => (v + 1) % slides.length), 5000);
    return () => clearTimeout(t);
  }, [i, auto.running, slides.length]);

  // Warm the next slide's art. Nothing preloaded before, which at seven seconds was survivable and at five
  // would read as a flash of empty box on every advance. One Image per change, discarded immediately.
  useEffect(() => {
    if (slides.length < 2) return;
    const next = slides[(i + 1) % slides.length];
    const art = wide && next.banner ? next.banner : next.cover;
    if (!art) return;
    const img = new Image();
    img.src = sourceCover(undefined, art, wide ? 1600 : 800);
  }, [i, slides, wide]);

  if (!slides.length) return null;
  const cur = slides[Math.min(i, slides.length - 1)];
  // The banner if we have one and the room for it; otherwise the cover, which every item has.
  const art = wide && cur.banner ? cur.banner : cur.cover;
  const letterboxed = wide && !cur.banner;

  return (
    <section
      aria-label={tr('Trending now')}
      className="bleed relative isolate h-[44vh] min-h-[300px] overflow-hidden lg:h-[54vh] lg:min-h-[400px] lg:max-h-[600px] lg:rounded-b-3xl"
      {...auto.bind}
      onTouchStart={(e) => { startX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - startX.current;
        if (Math.abs(dx) > 50) setI((v) => (v + (dx < 0 ? 1 : slides.length - 1)) % slides.length);
      }}
    >
      <div key={cur.title} className={`absolute inset-0 ${auto.reduced ? '' : 'animate-fade-up'}`}>
        {/* A 2:3 cover in a 16:6 box would be pillarboxed against flat black, so its own blur fills the sides. */}
        {letterboxed && (
          <Img src={sourceCover(undefined, art, 800)} alt="" fallbackSrc={art || undefined}
            className="absolute inset-0 h-full w-full scale-125 opacity-50 blur-2xl" />
        )}
        <Img
          src={sourceCover(undefined, art, 1600)} alt="" fallbackSrc={art || undefined} eager
          className={`absolute inset-0 h-full w-full ${letterboxed ? 'mx-auto max-w-2xl' : ''}`}
          imgClassName={wide && cur.banner ? 'object-center' : 'object-top'}
        />
      </div>

      {/* Light, matching the home hero: the art is the point, and the type carries its own shadow. The first
          version stacked a full-height black gradient, an 85% inline scrim and a radial, which between them
          left a hero that looked like it had failed to load. */}
      <span aria-hidden className="absolute inset-0 bg-linear-to-t from-ink-950 via-ink-950/30 to-transparent" />
      <span aria-hidden className="scrim-soft absolute inset-0" />
      <span aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 70% at var(--start) 70%, rgb(var(--accent) / 0.14), transparent 70%)' }} />

      {/* Said aloud only while the slides are not changing by themselves (see HeroCarousel). */}
      <div aria-live={auto.running ? 'off' : 'polite'} className="relative z-10 flex h-full flex-col justify-end px-4 pb-5 lg:px-8 lg:pb-10">
        <span className="mb-2.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent backdrop-blur">
          <IcSparkle width={12} height={12} />{tr('Trending now')}
        </span>
        <h2 className="max-w-3xl font-display text-2xl font-bold leading-[1.06] text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.65)] lg:text-5xl xl:text-6xl">
          {cur.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fog-300 lg:text-sm">
          {cur.score != null && <span className="font-semibold text-accent">{cur.score}%</span>}
          {cur.chapters != null && <span>· {tr('{n} ch', { n: cur.chapters })}</span>}
          {(cur.genres ?? []).slice(0, 3).map((g) => <span key={g}>· {g}</span>)}
        </div>
        {cur.description && (
          <p className="mt-2.5 hidden max-w-xl text-sm leading-relaxed text-fog-300 lg:line-clamp-2">{cur.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5">
          <button type="button" onClick={() => onPick(cur)} className="btn-accent px-6 py-3 text-sm lg:px-7 lg:py-3.5 lg:text-base">
            <IcPlus width={17} height={17} />{tr('Find and add')}
          </button>
          {slides.length > 1 && (() => {
            // A window, not one dot per slide: see lib/carousel. The ends shrink when there is more beyond
            // them.
            //
            // The window exists because ten inline dots overflow a PHONE, next to a padded button inside a
            // padded container. That was never a desktop problem, and capping it everywhere made the jump
            // from five slides to ten completely invisible: the row looked pixel-identical either way. So
            // the bound follows the constraint -- generous where there is room, tight where there is not.
            const { items, moreBefore, moreAfter } = dotWindow(slides.length, i, wide ? 12 : 5);
            return (
              <div className="flex ps-1">
                {items.map((k, n) => {
                  const edge = (n === 0 && moreBefore) || (n === items.length - 1 && moreAfter);
                  return (
                    <button key={k} type="button" onClick={() => setI(k)} aria-label={slides[k].title}
                      aria-current={k === i} className="grid min-w-6 place-items-center px-1.5 py-2.5 lg:min-w-0 lg:px-[9px]">
                      <span className={`rounded-full transition-all ${k === i ? 'h-1.5 w-6 bg-accent' : edge ? 'h-1 w-1 bg-white/25' : 'h-1.5 w-1.5 bg-white/35'}`} />
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
      {/* Pause / Resume (WCAG 2.2.2); not drawn when the slides never move by themselves. In the corner, not the
          button row: that row is already as wide as a phone allows. */}
      {slides.length > 1 && !auto.reduced && (
        <button type="button" onClick={auto.toggle} aria-label={auto.userPaused ? tr('Resume') : tr('Pause')} title={auto.userPaused ? tr('Resume') : tr('Pause')}
          className="absolute end-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/60 active:scale-90 lg:end-6 lg:top-5">
          {auto.userPaused ? <IcPlay width={15} height={15} /> : <IcPause width={15} height={15} />}
        </button>
      )}
    </section>
  );
}

/** The trending items the hero did not take, as a rail. Same art, one size down. */
export function TrendingCard({ t, onPick, onSearch }: { t: Trending; onPick: (t: Trending) => void; onSearch?: (title: string) => void }) {
  const menu = useDiscoverMenu({ title: t.title, onAdd: () => onPick(t), onSearch });
  return (
    <>
    <button type="button" onClick={() => onPick(t)} className="group w-36 shrink-0 snap-start text-start lg:w-40" {...menu.bind}>
      <div className="grad-border relative aspect-[2/3] overflow-hidden rounded-2xl border border-ink-700/60 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-glow">
        <Img src={sourceCover(undefined, t.cover)} alt="" fallbackSrc={t.cover || undefined}
          className="h-full w-full" imgClassName="transition-transform duration-500 group-hover:scale-[1.06]" />
        {t.score != null && (
          <span className="absolute end-1.5 top-1.5 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[11px] font-semibold text-accent backdrop-blur">{t.score}%</span>
        )}
        <span aria-hidden className="absolute bottom-1.5 end-1.5 grid size-7 place-items-center rounded-full bg-accent text-black shadow-glow transition group-hover:scale-110">
          <IcPlus width={15} height={15} />
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight text-fog-300 transition group-hover:text-fog-100">{t.title}</p>
      <Blurb text={t.description} />
    </button>
    {menu.element}
    </>
  );
}
