'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Page, Series } from '@/lib/types';
import { SeriesTile } from '@/components/cards';
import { IcSearch, IcSparkle, IcX } from '@/components/icons';
import Link from 'next/link';
import { PlaceRow, usePaletteActions } from '@/components/CommandPalette';
import { openPalette } from '@/lib/palette';
import { t as tr } from '@/lib/i18n';
import { AdultToggle, useAdultFilterConfigured, useAdultShown, useLibraries } from '@/components/AdultToggle';
import { canDownload, useAuth } from '@/lib/auth';
import { isDesktop } from '@/lib/desktop';
import { findDestinations } from '@/lib/destinations';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchInner() {
  const router = useRouter();
  const initial = useSearchParams().get('q') || '';
  const [q, setQ] = useState(initial);
  const debounced = useDebounced(q.trim(), 280);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!initial) inputRef.current?.focus();
    try {
      setRecent(JSON.parse(localStorage.getItem('yomi_recent') || '[]'));
    } catch {}
  }, [initial]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    enabled: debounced.length >= 2,
    queryFn: () => api<Page<Series>>('/api/series/search', { json: { query: debounced, size: 60 } }),
  });
  // v0.55.4: the pages and settings the query names, as the palette lists them (a phone has no palette): under the
  // series, admins' only for admins, none of Desktop's missing ones there (lib/destinations.ts).
  const { isAdmin, user, status } = useAuth();
  const mayAdd = status === 'authed' && canDownload(user);
  const adultConfigured = useAdultFilterConfigured();
  const adultOn = useAdultShown();
  const hasAdultLibrary = (useLibraries().data ?? []).some((l) => l.adult);
  const places = useMemo(() => findDestinations(debounced, { admin: isAdmin, desktop: isDesktop(), limit: 8 }), [debounced, isAdmin]);

  // The palette's actions (Surprise me, Updates, Moments, Server fetching ...), which a phone could not reach: all of them
  // before a query, those the query names after it.
  const noop = useMemo(() => () => {}, []);
  const goTo = useMemo(() => (href: string) => router.push(href), [router]);
  const allActions = usePaletteActions(goTo, noop);
  const actions = useMemo(
    () => (debounced.length < 2 ? allActions : allActions.filter((a) => a.label.toLowerCase().includes(debounced.toLowerCase()) || a.key.includes(debounced.toLowerCase()))),
    [allActions, debounced],
  );
  const actionsList = actions.length > 0 && (
    <section data-search-actions aria-label={tr('Actions')} className="mt-6 pb-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fog-400">{tr('Actions')}</p>
      <div className="card divide-y divide-ink-800/70 overflow-hidden rounded-2xl">
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={() => void a.run()} className="flex w-full items-center gap-3 px-4 py-2.5 text-start">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-700 text-fog-300">{a.icon}</span>
            <span className="min-w-0 truncate text-sm text-fog-100">{a.label}</span>
            {a.hint && <span className="ms-auto shrink-0 text-xs text-fog-400">{a.hint}</span>}
          </button>
        ))}
      </div>
    </section>
  );

  const remember = (term: string) => {
    if (!term) return;
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 8);
    setRecent(next);
    localStorage.setItem('yomi_recent', JSON.stringify(next));
  };

  return (
    <div className="min-h-screen-d">
      <header className="safe-top sticky top-0 z-30 bg-ink-950/85 px-4 pb-3 backdrop-blur-xl lg:static lg:bg-transparent lg:px-0 lg:pt-6 lg:backdrop-blur-none">
        <h1 className="sr-only">{tr('Search')}</h1>
        <div className="flex items-center gap-2 rounded-2xl border border-ink-600 bg-ink-850 px-3.5 py-3 focus-within:border-accent lg:max-w-xl">
          <IcSearch width={20} height={20} className="text-fog-400" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={tr('Search your library…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => remember(debounced)}
            placeholder={tr('Search your library…')}
            className="w-full bg-transparent text-base text-fog-50 outline-hidden focus-visible:outline-accent focus-visible:outline-offset-0 placeholder:text-fog-400"
          />
          {q && (
            <button type="button" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label={tr('Clear search')}
              className="relative grid h-6 w-6 place-items-center text-fog-400 before:absolute before:-inset-2">
              <IcX width={18} height={18} />
            </button>
          )}
        </div>
        {/* A phone has no Ctrl+K or "/": this opens the same command palette (pages, settings, actions). */}
        <button type="button" onClick={() => openPalette(q)} data-search-palette className="chip mt-2 text-xs lg:hidden">
          <IcSparkle width={14} height={14} aria-hidden />{tr('Search pages, settings and actions')}
        </button>
      </header>

      {debounced.length < 2 && recent.length > 0 && (
        <div className="px-5 pt-5 lg:px-0">
          <p id="search-recent" className="mb-2 text-xs font-medium uppercase tracking-wider text-fog-400">{tr('Recent')}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="search-recent">
            {recent.map((r) => (
              <button key={r} onClick={() => setQ(r)} className="chip">
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {debounced.length < 2 && actionsList && <div className="px-4 pt-2 lg:px-0 lg:max-w-xl">{actionsList}</div>}

      {debounced.length >= 2 && (
        <div className="px-4 pt-4 lg:px-0">
          {isFetching && !data ? (
            <div role="status" aria-busy="true" className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-9 3xl:grid-cols-10">
              <span className="sr-only">{tr('Searching…')}</span>
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />)}
            </div>
          ) : (data?.content.length ?? 0) === 0 ? (
            <p role="status" className={`${places.length ? 'py-6' : 'py-20'} text-center text-sm text-fog-400`}>
              {tr('No series match “{query}”.', { query: `\u2068${debounced}\u2069` })}
            </p>
          ) : null}
          {/* The 18+ filter hides a series by its library, rating or genres (an admin's list includes plain tags like
              "Mature"), so a title that IS in the library can come back as no match. Say so, with the switch. */}
          {!(isFetching && !data) && (data?.content.length ?? 0) === 0 && !adultOn && (adultConfigured || hasAdultLibrary) && (
            <div className="pb-4 text-center" data-search-adult-hint>
              <p className="mb-2 text-xs text-fog-400">{tr('Series hidden by the 18+ filter are not searched.')}</p>
            </div>
          )}
          {!(isFetching && !data) && (data?.content.length ?? 0) === 0 && mayAdd && (
            <p className="pb-4 text-center">
              <Link href={`/discover?q=${encodeURIComponent(debounced)}`} data-search-discover className="chip text-xs">{tr('Search your sources for “{query}”', { query: `\u2068${debounced}\u2069` })}</Link>
            </p>
          )}
          {(isFetching && !data) || (data?.content.length ?? 0) === 0 ? null : (
            <>
              <p role="status" className="mb-3 text-xs text-fog-400">{data?.totalElements === 1 ? tr('1 result') : tr('{n} results', { n: data?.totalElements ?? 0 })}</p>
              <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 lg:gap-x-4 xl:grid-cols-8 2xl:grid-cols-9 3xl:grid-cols-10">
                {data?.content.map((s, i) => <SeriesTile key={s.id} series={s} eager={i < 12} />)}
              </div>
            </>
          )}
          {places.length > 0 && (
            <section data-search-places aria-label={tr('Pages and settings')} className="mt-6 pb-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fog-400">{tr('Pages and settings')}</p>
              <div className="card divide-y divide-ink-800/70 overflow-hidden rounded-2xl">
                {places.map((p) => <PlaceRow key={p.key} place={p} href={p.href} />)}
              </div>
            </section>
          )}
          {actionsList}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen-d" />}>
      <SearchInner />
    </Suspense>
  );
}
