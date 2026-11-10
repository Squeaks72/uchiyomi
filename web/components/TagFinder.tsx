'use client';
// Discover → Tags: find new series by AniList's tags and genres (bff GET /api/discover/by-tags). A title must carry EVERY tag
// picked and none of those excluded (type "-gore"); a card opens the same add dialog as the trending rows.
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { IcX } from '@/components/icons';
import { MenuTrendingCard, type Trending } from '@/components/DiscoverHero';
import { SourceFilters } from '@/components/SourceFilters';
import type { SourceItem } from '@/components/cards';

interface TagInfo { name: string; category: string; adult: boolean }
interface TagList { tags: TagInfo[]; genres: string[] }
interface Page { content: Trending[]; hasNext: boolean }

const COUNTRIES: Array<{ id: string; label: () => string }> = [
  { id: '', label: () => tr('Any origin') }, { id: 'KR', label: () => tr('Manhwa') }, { id: 'JP', label: () => tr('Manga') }, { id: 'CN', label: () => tr('Manhua') },
];
const SORTS: Array<{ id: string; label: () => string }> = [
  { id: 'POPULARITY_DESC', label: () => tr('Most popular') }, { id: 'TRENDING_DESC', label: () => tr('Trending') },
  { id: 'SCORE_DESC', label: () => tr('Top rated') }, { id: 'START_DATE_DESC', label: () => tr('Newest') },
];
const GRID = 'grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 lg:gap-x-4 xl:grid-cols-8';

export function TagFinder({ onPick, onSearch, onClose, filterSources, onOpenItem }: {
  onPick: (t: Trending) => void; onSearch: (title: string) => void; onClose: () => void;
  /** The sources that declare filters of their own, and what a result of one of them does when tapped. */
  filterSources: Array<{ id: string; name: string; lang: string | null }>; onOpenItem: (it: SourceItem) => void;
}) {
  const [where, setWhere] = useState<'anilist' | 'source'>('anilist');
  const [picked, setPicked] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('POPULARITY_DESC');

  const list = useQuery({ queryKey: ['discover-tag-list'], queryFn: () => api<TagList>('/api/discover/tag-list'), staleTime: 3600_000, retry: 1 });
  const names = useMemo(() => [
    ...(list.data?.genres ?? []).map((g) => ({ name: g, category: tr('Genre') })),
    ...(list.data?.tags ?? []).map((t) => ({ name: t.name, category: t.category.replace(/-/g, ' · ') })),
  ], [list.data]);

  const negative = text.trim().startsWith('-');
  const needle = text.trim().replace(/^-/, '').toLowerCase();
  const used = new Set([...picked, ...excluded].map((n) => n.toLowerCase()));
  const suggestions = useMemo(() => {
    if (!needle) return [];
    const starts = names.filter((n) => n.name.toLowerCase().startsWith(needle));
    const rest = names.filter((n) => !n.name.toLowerCase().startsWith(needle) && n.name.toLowerCase().includes(needle));
    return [...starts, ...rest].filter((n) => !used.has(n.name.toLowerCase())).slice(0, 8);
  }, [needle, names, picked, excluded]);

  const add = (name: string) => {
    (negative ? setExcluded : setPicked)((l) => (l.includes(name) ? l : [...l, name]));
    setText('');
  };

  const q = useInfiniteQuery({
    queryKey: ['discover-by-tags', picked, excluded, country, sort],
    enabled: picked.length > 0,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      for (const t of picked) p.append('tag', t);
      for (const t of excluded) p.append('exclude', t);
      if (country) p.set('country', country);
      p.set('sort', sort);
      p.set('page', String(pageParam));
      return api<Page>(`/api/discover/by-tags?${p}`);
    },
    getNextPageParam: (last, all) => (last.hasNext ? all.length + 1 : undefined),
    staleTime: 5 * 60_000,
  });
  const items = q.data?.pages.flatMap((p) => p.content) ?? [];
  const seen = new Set<string>();
  const unique = items.filter((t) => { const k = t.id != null ? `al:${t.id}` : t.title; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <section data-tag-finder className="card grad-border mt-4 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-fog-50">{tr('Find by tags')}</h2>
        <button type="button" onClick={onClose} aria-label={tr('Close')} className="text-fog-500 hover:text-fog-200"><IcX width={16} height={16} /></button>
      </div>
      {filterSources.length > 0 && (
        <div className="flex gap-2" role="group" aria-label={tr('Where to search')}>
          <button type="button" aria-pressed={where === 'anilist'} onClick={() => setWhere('anilist')} className={`chip text-xs ${where === 'anilist' ? 'border-accent/60 text-fog-50' : ''}`}>{tr('Across AniList')}</button>
          <button type="button" aria-pressed={where === 'source'} onClick={() => setWhere('source')} className={`chip text-xs ${where === 'source' ? 'border-accent/60 text-fog-50' : ''}`}>{tr('On one source')}</button>
        </div>
      )}
      {where === 'source' && filterSources.length > 0 ? <SourceFilters sources={filterSources} onOpen={onOpenItem} /> : (<>
      <div className="flex flex-wrap items-center gap-1.5">
        {picked.map((n) => (
          <button key={n} type="button" onClick={() => setPicked((l) => l.filter((x) => x !== n))} className="chip text-xs border-accent/50 text-fog-100" aria-label={tr('Remove {tag}', { tag: n })}>{n} <span aria-hidden>×</span></button>
        ))}
        {excluded.map((n) => (
          <button key={n} type="button" onClick={() => setExcluded((l) => l.filter((x) => x !== n))} className="chip text-xs border-rose-500/50 text-rose-300" aria-label={tr('Remove {tag}', { tag: n })}>− {n} <span aria-hidden>×</span></button>
        ))}
      </div>
      <div className="relative">
        <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === 'Enter' && suggestions[0]) { e.preventDefault(); add(suggestions[0].name); } if (e.key === 'Backspace' && !text) setPicked((l) => l.slice(0, -1)); }}
          placeholder={tr('Add a tag or genre, such as Time Loop or Romance')} aria-label={tr('Add a tag or genre')}
          className="w-full rounded border border-ink-700 bg-transparent px-3 py-2 text-sm text-fog-100" />
        {suggestions.length > 0 && (
          <ul data-lenis-prevent className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-ink-700 bg-ink-900 shadow-xl">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button type="button" onClick={() => add(s.name)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-fog-100 hover:bg-ink-800">
                  <span>{negative ? '− ' : ''}{s.name}</span><span className="text-[11px] text-fog-500">{s.category}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-fog-500">{tr('A series must have every tag you pick. Start with - to leave one out, such as -gore.')}</p>
      {(list.data?.genres?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr('Genre')}>
          {list.data!.genres.map((g) => {
            const on = picked.includes(g);
            return <button key={g} type="button" aria-pressed={on} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== g) : [...l, g]))} className={`chip text-xs ${on ? 'border-accent/60 text-fog-50' : ''}`}>{g}</button>;
          })}
        </div>
      )}
      {list.isError && <p className="text-xs text-amber-300">{tr('The tag list could not be loaded from AniList. Try again in a moment.')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {COUNTRIES.map((c) => (
          <button key={c.id} type="button" onClick={() => setCountry(c.id)} aria-pressed={country === c.id}
            className={`chip text-xs ${country === c.id ? 'border-accent/60 text-fog-50' : ''}`}>{c.label()}</button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tr('Sort by')} className="ms-auto rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-fog-200">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label()}</option>)}
        </select>
      </div>

      {picked.length === 0 ? null : q.isLoading ? (
        <div role="status" className="py-6 text-center text-sm text-fog-500">{tr('Searching AniList…')}</div>
      ) : q.isError ? (
        <div className="py-4 text-center text-sm text-amber-300">
          {tr('The search failed.')} <button type="button" className="underline" onClick={() => q.refetch()}>{tr('Try again')}</button>
        </div>
      ) : unique.length === 0 ? (
        <p className="py-6 text-center text-sm text-fog-500">{tr('Nothing new matches all of those. Try fewer tags, or another origin.')}</p>
      ) : (
        <>
          <div className={GRID}>
            {unique.map((t) => <MenuTrendingCard key={t.id ?? t.title} t={t} onPick={onPick} onSearch={onSearch} />)}
          </div>
          {q.hasNextPage && (
            <div className="text-center">
              <button type="button" className="btn-ghost px-5 py-2 text-sm" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                {q.isFetchingNextPage ? tr('Loading…') : tr('Show more')}
              </button>
            </div>
          )}
        </>
      )}
      </>)}
    </section>
  );
}
