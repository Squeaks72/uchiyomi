'use client';
// Attach or move a series to another source by hand (the fork's Suwayomi-style "migrate"), for the series the
// automatic Find cannot judge: one with fewer than 3 chapters has nothing to line up, so a person picks the match.
//
// The search term is editable (it starts as the series' title; its other names are one tap away), the answer is one rail
// per source as in the import review's manual search, and a pick is compared -- cover, title, chapter count against what
// the series lists now -- before anything is written. POST /api/admin/series/:id/attach-source has no overlap gate.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Sheet, Img } from '@/components/ui';
import { ScrollRail } from '@/components/ScrollRail';
import { SourceIcon } from '@/components/SourcePicker';
import { sourceCover } from '@/components/cards';
import { useToast } from '@/components/Toast';
import { msgOf } from '@/components/ConfirmDialog';
import { IcCheck, IcSearch, IcX } from '@/components/icons';
import { t as tr } from '@/lib/i18n';
import { bookCountText } from '@/lib/format';
import { attachButtons, migrateTerms } from '@/lib/migrateSource';
import type { AltTitle } from '@/lib/findSources';

interface SourceResult { sourceId: string; title: string; coverUrl?: string }
interface SourceGroup { source: string; name: string; lang: string | null; results: SourceResult[] }
interface Pick { source: string; sourceId: string; title: string; coverUrl?: string; name: string }
interface Detail { title: string; coverUrl: string | null; count: number }

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function MigrateSourceSheet({ id, title, attached, mainId, listed, onDone, onClose }: {
  id: string;
  title: string;
  /** Source ids the series already uses (main first): marked in the rails, and the main decides which buttons show. */
  attached: string[];
  mainId: string | null;
  /** How many chapters the series lists now, for the comparison. */
  listed: number | null;
  /** The attach went through: the page refetches. */
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [term, setTerm] = useState(title);
  const debounced = useDebounced(term.trim(), 400);
  const [pick, setPick] = useState<Pick | null>(null);
  const [keepOld, setKeepOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const alts = useQuery({
    queryKey: ['series-alt-titles', id],
    queryFn: () => api<{ titles: AltTitle[] }>(`/api/admin/series/${encodeURIComponent(id)}/alt-titles`),
    staleTime: 60_000,
  });
  const terms = migrateTerms(title, (alts.data?.titles ?? []).map((a) => a.title));

  const { data, isFetching, error } = useQuery({
    queryKey: ['migrate-search', debounced],
    queryFn: () => api<{ content: SourceGroup[] }>(`/api/sources/search-all?groupBy=source&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: ['migrate-detail', pick?.source, pick?.sourceId],
    queryFn: () => api<Detail>(`/api/sources/detail?source=${encodeURIComponent(pick!.source)}&sourceId=${encodeURIComponent(pick!.sourceId)}`),
    enabled: !!pick,
    staleTime: 60_000,
  });

  const act = async (as: 'follower' | 'main') => {
    if (!pick) return;
    setBusy(true);
    setRefusal(null);
    try {
      await api(`/api/admin/series/${encodeURIComponent(id)}/attach-source`, {
        json: { source: pick.source, sourceSeriesId: pick.sourceId, title: pick.title, as, ...(as === 'main' ? { old: keepOld ? 'keep' : 'drop' } : {}) },
      });
      toast(as === 'main' ? tr('{name} is now the main source', { name: `⁨${pick.name}⁩` }) : tr('Now also checking {name}', { name: `⁨${pick.name}⁩` }), 'success');
      onDone();
    } catch (e) { setRefusal(msgOf(e, tr('Could not attach that source'))); }
    setBusy(false);
  };

  const buttons = attachButtons(mainId);
  const groups = data?.content ?? [];
  const delta = detail.data && listed != null ? detail.data.count - listed : null;

  const footer = pick ? (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900/50 p-2">
        <Img src={pick.coverUrl ? sourceCover(pick.source, pick.coverUrl) : ''} alt="" fallbackSrc={pick.coverUrl || undefined} className="h-16 w-11 shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fog-100">{pick.title}</p>
          <p className="truncate text-[11px] text-fog-400">
            {pick.name}{detail.isFetching ? ` · ${tr('checking…')}` : detail.data ? ` · ${bookCountText(detail.data.count)}` : ''}
          </p>
          {delta != null && listed != null && (
            <p className={`text-[11px] ${delta >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {tr('This series lists {n} now', { n: listed })}
            </p>
          )}
        </div>
      </div>
      {refusal && <p role="alert" className="text-[11px] leading-relaxed text-amber-300" data-migrate-refusal>{refusal}</p>}
      {buttons.main && mainId && (
        <label className="flex items-center gap-2 text-[11px] text-fog-400">
          <input type="checkbox" checked={keepOld} onChange={(e) => setKeepOld(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          {tr('Keep the current main source as a backup')}
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => setPick(null)} disabled={busy} className="chip flex-1 py-1.5 text-xs disabled:opacity-50">{tr('Cancel')}</button>
        {buttons.follower && (
          <button type="button" onClick={() => act('follower')} disabled={busy} className="chip flex-1 py-1.5 text-xs disabled:opacity-50" data-migrate-follow>
            {tr('Add as extra source')}
          </button>
        )}
        <button type="button" onClick={() => act('main')} disabled={busy} className="btn-accent flex-1 py-1.5 text-xs disabled:opacity-50" data-migrate-main>
          {busy ? tr('Working…') : buttons.follower ? tr('Move here') : tr('Use this source')}
        </button>
      </div>
    </div>
  ) : undefined;

  return (
    <Sheet title={tr('Add or move source')} onClose={onClose} overBottomNav footer={footer}>
      <div className="sticky top-0 z-10 -mx-4 mb-3 bg-ink-950/90 px-4 pb-2 pt-1 backdrop-blur-xs">
        <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2 focus-within:border-accent">
          <IcSearch width={17} height={17} className="text-fog-500" />
          <input ref={inputRef} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr('Search sources…')}
            autoCapitalize="none" className="w-full bg-transparent text-sm text-fog-50 outline-hidden placeholder:text-fog-500" data-migrate-term />
          {term && <button type="button" onClick={() => setTerm('')} className="text-fog-500" aria-label={tr('Clear')}><IcX width={15} height={15} /></button>}
        </div>
        {terms.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {terms.map((t) => (
              <button key={t} type="button" onClick={() => setTerm(t)} aria-pressed={t === term.trim()}
                className={`chip max-w-full truncate text-[11px] ${t === term.trim() ? 'chip-active' : ''}`}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {debounced.length < 2 ? (
        <p className="py-10 text-center text-sm text-fog-500">{tr('Type at least 2 characters to search.')}</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-fog-500">{tr('Search failed — try again.')}</p>
      ) : isFetching && !data ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton mb-1.5 h-4 w-32 rounded" />
              <div className="flex gap-2.5">{Array.from({ length: 4 }).map((_, j) => <div key={j} className="skeleton aspect-[2/3] w-24 shrink-0 rounded-lg" />)}</div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-fog-500">{tr('Nobody has that title. Try another name above.')}</p>
      ) : (
        <div className="space-y-4 pb-2">
          {groups.map((g) => (
            <div key={g.source}>
              <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs font-semibold text-fog-300">
                <SourceIcon id={g.source} name={g.name} size={16} />
                <span className="truncate">{g.name}{g.lang ? ` (${g.lang.toUpperCase()})` : ''}</span>
                {attached.includes(g.source) && <span className="chip px-1.5 py-0 text-[9px]">{g.source === mainId ? tr('main') : tr('attached')}</span>}
              </p>
              <ScrollRail className="flex gap-2.5 pb-3">
                {g.results.map((r) => {
                  const selected = pick?.source === g.source && pick?.sourceId === r.sourceId;
                  return (
                    <button key={r.sourceId} type="button" disabled={busy}
                      onClick={() => { setRefusal(null); setPick({ source: g.source, sourceId: r.sourceId, title: r.title, coverUrl: r.coverUrl, name: g.name }); }}
                      className="w-24 shrink-0 text-start disabled:opacity-50">
                      <span className="relative block">
                        <Img src={sourceCover(g.source, r.coverUrl)} alt={r.title} fallbackSrc={r.coverUrl}
                          className={`aspect-[2/3] w-24 rounded-lg border ${selected ? 'border-accent ring-2 ring-accent' : 'border-ink-700'}`} />
                        {selected && <span className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-accent text-black"><IcCheck width={12} height={12} /></span>}
                      </span>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-fog-300">{r.title}</p>
                    </button>
                  );
                })}
              </ScrollRail>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
