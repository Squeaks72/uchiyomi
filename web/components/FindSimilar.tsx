'use client';
// Find similar (fork): the series page's panel for "more like this, but closer". More like this matches ANY of a series'
// first three genres, which for a series with common genres is most of the catalogue. Here the person picks which of the
// series' genres and tags matter and how many of them an answer must share (lib/anilistSimilar.ts does the matching).
//
// Closed until asked: opening it is what asks AniList, so a series page never does. Held series are library cards, the rest
// are AniList's covers (OutsideCard), leading to Discover for an account that may add series.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, canDownload } from '@/lib/auth';
import { AnilistLinkPicker } from '@/components/AnilistLink';
import { t as tr } from '@/lib/i18n';
import { defaultTags, effectiveMin, matchNote, searchUrl, type SimilarAnswer, type SimilarFacets } from '@/lib/similar';
import { ScrollRail, CARD_RAIL } from '@/components/ScrollRail';
import { OutsideCard } from '@/components/RelatedRail';
import { SeriesCard } from '@/components/cards';
import { RailSkeleton } from '@/components/ui';
import { IcChevronRight, IcRefresh } from '@/components/icons';

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title} data-similar-chip
      className={`chip ${on ? 'chip-active' : ''}`}>{children}</button>
  );
}

/** A line with a spinner: something is being asked of AniList, which can take several seconds. */
function Working({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" data-similar-working className="mb-3 flex items-center gap-2 text-sm text-accent">
      <IcRefresh width={16} height={16} className="animate-spin" aria-hidden />{children}
    </p>
  );
}

export function FindSimilar({ seriesId }: { seriesId: string }) {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  // null until the person touches a chip: the defaults come from the facets, which are not known when the state is made.
  const [genres, setGenres] = useState<string[]>([]);
  const [tags, setTags] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const facetsQ = useQuery({
    queryKey: ['similar-facets', seriesId],
    queryFn: () => api<SimilarFacets>(`/api/series/${encodeURIComponent(seriesId)}/similar/facets`),
    enabled: open && !!seriesId,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const facets = facetsQ.data;
  const chosenTags = tags ?? defaultTags(facets);
  const chosen = genres.length + chosenTags.length;
  const min = effectiveMin(chosen, picked);

  const searchQ = useQuery({
    queryKey: ['similar-search', seriesId, [...genres].sort(), [...chosenTags].sort(), min],
    queryFn: () => api<SimilarAnswer>(searchUrl(seriesId, genres, chosenTags, min)),
    enabled: open && !!facets?.lookups && chosen > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const mayAdd = canDownload(user);
  const answer = searchQ.data;
  // Nothing yet to show (first search), or a new one running over the last answer (kept on screen, dimmed).
  const searching = searchQ.isFetching;
  const firstSearch = searchQ.isPending && searchQ.fetchStatus !== 'idle';
  const noLookups = open && facets && !facets.lookups;

  return (
    <section className="mt-10" data-find-similar>
      {/* The whole heading is the button: a key at the far edge of a wide screen is too far from the words to be noticed. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-find-similar-toggle
        className="mx-4 mb-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-ink-700/60 bg-ink-900/40 px-4 py-3 text-start transition hover:border-accent/60 hover:bg-ink-800/60">
        <h2 className="font-display text-lg font-semibold tracking-tight text-fog-50">{tr('Find similar')}</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-fog-500">{open ? '' : tr('Pick the genres and tags that matter and how many an answer must share.')}</span>
        <IcChevronRight width={18} height={18} aria-hidden className={`shrink-0 text-accent transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-4">
          {facetsQ.isPending && <Working>{tr('Loading genres and tags from AniList…')}</Working>}
          {facetsQ.isError && <p className="text-sm text-fog-500" role="status">{tr('AniList is busy. Try again in a moment.')}</p>}
          {noLookups && (
            <div className="mb-3 space-y-3" data-similar-nolink>
              <p className="text-sm text-fog-300">{tr('This series has no AniList link to find similar series from.')}</p>
              {isAdmin
                ? <AnilistLinkPicker seriesId={seriesId} />
                : <p className="text-sm text-fog-500">{tr('An admin can link it to its AniList entry.')}</p>}
            </div>
          )}
          {facets?.lookups && (
            <>
              {facets.genres.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fog-500">{tr('Genres')}</p>
                  <div className="flex flex-wrap gap-2">
                    {facets.genres.map((g) => <Chip key={g} on={genres.includes(g)} onClick={() => setGenres(toggle(genres, g))}>{g}</Chip>)}
                  </div>
                </div>
              )}
              {facets.tags.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fog-500">{tr('Tags')}</p>
                  <div className="flex flex-wrap gap-2">
                    {facets.tags.map((x) => (
                      <Chip key={x.name} on={chosenTags.includes(x.name)} title={`${x.rank}%`}
                        onClick={() => setTags(toggle(chosenTags, x.name))}>{x.name}</Chip>
                    ))}
                  </div>
                </div>
              )}
              {chosen > 0 ? (
                <label className="mb-4 flex items-center gap-3 text-sm text-fog-200">
                  <span className="shrink-0" data-similar-min-label>{tr('Match at least')} <bdi dir="ltr">{min} / {chosen}</bdi></span>
                  <input type="range" min={1} max={chosen} step={1} value={min} data-similar-min
                    onChange={(e) => setPicked(Number(e.target.value))} className="min-w-0 max-w-xs flex-1" />
                </label>
              ) : <p className="mb-4 text-sm text-fog-500">{tr('Pick at least one genre or tag.')}</p>}
            </>
          )}
          {searching && <Working>{tr('Searching AniList for similar series…')}</Working>}
          {answer?.busy && <p className="text-sm text-fog-500" role="status">{tr('AniList is busy. Try again in a moment.')}</p>}
          {answer && !searching && !answer.busy && answer.content.length === 0 && (
            <p className="text-sm text-fog-500" data-similar-empty>{tr('Nothing shares that many. Lower the number or pick fewer.')}</p>
          )}
        </div>
      )}
      {open && firstSearch && <RailSkeleton />}
      {open && answer && answer.content.length > 0 && (
        <div className={`transition-opacity ${searching ? 'opacity-40' : ''}`} aria-busy={searching}>
        <ScrollRail label={tr('Find similar')} className={CARD_RAIL}>
          {answer.content.map((h) => (h.series
            ? <SeriesCard key={`s:${h.series.id}`} series={h.series} note={matchNote(h, answer.total)} />
            : h.outside ? <OutsideCard key={`al:${h.anilistId}`} item={h.outside} note={matchNote(h, answer.total)} mayAdd={mayAdd} /> : null))}
        </ScrollRail>
        </div>
      )}
    </section>
  );
}
