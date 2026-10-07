'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { useIsHiddenTitle } from '@/lib/hiddenTitles';
import { Reveal } from '@/components/ui';
import { ScrollRail } from '@/components/ScrollRail';
import { TrendingCard, type Trending } from '@/components/DiscoverHero';

export type TrendingKind = 'manhwa' | 'manga' | 'manhua';

/** The rail's heading, a literal per kind so the translation tool can see each one. */
export const trendingTitle = (kind: TrendingKind) =>
  kind === 'manga' ? tr('Trending manga') : kind === 'manhua' ? tr('Trending manhua') : tr('Trending manhwa');

/**
 * A row of what is trending on AniList for one kind of work (`/api/discover/trending?kind=`), minus what the
 * library already has. Shows nothing while loading, when AniList is unreachable, or when nothing is left.
 * Manhwa is drawn by the Discover page itself (it shares that list with the optional hero banner); this is
 * for the other two.
 */
export function TrendingRail({ kind, enabled, onPick, onSearch }: {
  kind: Exclude<TrendingKind, 'manhwa'>;
  enabled: boolean;
  onPick: (t: Trending) => void;
  onSearch?: (title: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['discover-trending', kind],
    queryFn: () => api<{ content: Trending[] }>(`/api/discover/trending?kind=${kind}`),
    enabled,
    staleTime: 10 * 60_000,
  });
  const isHidden = useIsHiddenTitle();
  const items = (data?.content ?? []).filter((t) => !isHidden(t.title));
  if (!items.length) return null;
  const label = trendingTitle(kind);
  return (
    <section className="pb-6" data-trending-kind={kind}>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-fog-50 lg:text-xl">{label}</h2>
      <ScrollRail label={label} className="bleed flex gap-3 px-4 pb-3 lg:px-8 [scroll-snap-type:x_mandatory]">
        {items.map((t, i) => (
          <Reveal key={t.title} delay={Math.min(i, 12) * 28}>
            <TrendingCard t={t} onPick={onPick} onSearch={onSearch} />
          </Reveal>
        ))}
      </ScrollRail>
    </section>
  );
}
