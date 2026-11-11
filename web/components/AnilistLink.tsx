'use client';
// Link a series to its AniList entry by hand (fork; admin). Automatic matching leaves a title it is not sure of alone, and a
// series with no link has no Find similar, related works or scores. The search starts from the series' own title; picking an
// entry records it as a person's choice, which automatic matching never overwrites (bff routes/catalog.ts anilist-link).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Img } from '@/components/ui';
import { IcRefresh } from '@/components/icons';

interface Pick { anilistId: number; title: string; altTitle: string | null; cover: string | null; format: string | null; status: string | null; score: number | null }

export function AnilistLinkPicker({ seriesId, onLinked }: { seriesId: string; onLinked?: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [asked, setAsked] = useState('');
  const search = useQuery({
    queryKey: ['anilist-picks', seriesId, asked],
    queryFn: () => api<{ content: Pick[] }>(`/api/series/${encodeURIComponent(seriesId)}/anilist/search?q=${encodeURIComponent(asked)}`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const link = useMutation({
    mutationFn: (p: Pick) => api(`/api/series/${encodeURIComponent(seriesId)}/anilist-link`, { method: 'PUT', json: { anilistId: p.anilistId, title: p.title } }),
    onSuccess: () => {
      for (const k of ['similar-facets', 'similar-search', 'related', 'similar']) void qc.invalidateQueries({ queryKey: [k, seriesId] });
      onLinked?.();
    },
  });
  const lookupsOff = link.error instanceof ApiError && link.error.status === 409;
  return (
    <div data-anilist-link className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setAsked(text.trim()); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} className="field min-w-0 flex-1" maxLength={120}
          placeholder={tr('Search AniList (the series’ title by default)')} aria-label={tr('Search AniList')} />
        <button type="submit" className="btn-key">{tr('Search')}</button>
      </form>
      {search.isFetching && (
        <p role="status" className="flex items-center gap-2 text-sm text-accent">
          <IcRefresh width={16} height={16} className="animate-spin" aria-hidden />{tr('Searching AniList…')}
        </p>
      )}
      {search.isError && <p role="status" className="text-sm text-fog-500">{tr('AniList is busy. Try again in a moment.')}</p>}
      {lookupsOff && <p role="alert" className="text-sm text-fog-300">{tr('This series’ library has AniList lookups turned off, so a link would not be used.')}</p>}
      {link.isError && !lookupsOff && <p role="alert" className="text-sm text-fog-300">{tr('Could not save the link.')}</p>}
      <ul className="space-y-2">
        {(search.data?.content ?? []).map((p) => (
          <li key={p.anilistId} className="flex items-center gap-3 rounded-xl border border-ink-700/60 p-2">
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-ink-800">
              {p.cover && <Img src={p.cover} alt="" className="h-full w-full" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fog-100">{p.title}</p>
              <p className="truncate text-xs text-fog-500">{[p.altTitle, p.format, p.status, p.score != null ? `${p.score}%` : null].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" className="btn-key" disabled={link.isPending} data-anilist-pick={p.anilistId} onClick={() => link.mutate(p)}>
              {link.isPending && link.variables?.anilistId === p.anilistId ? tr('Linking…') : tr('Link')}
            </button>
          </li>
        ))}
      </ul>
      {search.data && search.data.content.length === 0 && !search.isFetching && <p className="text-sm text-fog-500">{tr('No AniList entries found. Try another name.')}</p>}
    </div>
  );
}
