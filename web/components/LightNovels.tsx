'use client';
// The light novel of a series' story. AniList says which novel a manga was drawn from, or which novels adapt it (bff
// lib/anilist.ts normaliseRelated, GET /api/series/:id/novels); when BookOrbit is linked (Admin -> BookOrbit sync) and holds
// that novel as an ebook, the card opens it there -- reading, read-aloud and the rest are BookOrbit's. An admin can attach a
// BookOrbit series by hand for the one the title match misses (it is then drawn even when AniList names no novel).
//
// Two places. Almost no manga has a novel to read, so the series PAGE draws only novels BookOrbit actually holds
// (`LightNovels`, above Related) and nothing at all otherwise -- not for an admin either. Everything else (AniList's novels
// that are not in BookOrbit, attaching and detaching) lives in Edit details -> Details (`LightNovelDetails`).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr, keys } from '@/lib/i18n';
import { Img, SectionTitle } from '@/components/ui';
import { sourceCover } from '@/components/cards';
import { statusText } from '@/lib/activity';
import { useToast } from './Toast';

interface Held { id: number; name: string; volumes: number; path: string }
interface NovelAnswer {
  lookups: boolean;
  bookorbit: string | null;
  canEdit: boolean;
  content: { anilistId: number | null; title: string; cover: string | null; status: string | null; score: number | null; relation: string | null; held: Held | null; manual: boolean }[];
}

const REL = ['SOURCE', 'ADAPTATION', 'ALTERNATIVE'] as const;
const REL_LABELS = keys('Source novel', 'Novel adaptation', 'Alternative version');

const novelsKey = (seriesId: string) => ['novels', seriesId];
const useNovels = (seriesId: string) => useQuery({
  queryKey: novelsKey(seriesId), queryFn: () => api<NovelAnswer>(`/api/series/${encodeURIComponent(seriesId)}/novels`), staleTime: 600_000, retry: false,
});

/** A novel the reader can open: BookOrbit is linked and holds it. The page draws only these. */
export const readable = (n: NovelAnswer['content'][number], bookorbit: string | null) => !!(n.held && bookorbit);

/** The series page: the light novels BookOrbit holds, or nothing. */
export function LightNovels({ seriesId }: { seriesId: string }) {
  const { data } = useNovels(seriesId);
  const held = data ? data.content.filter((n) => readable(n, data.bookorbit)) : [];
  if (!data || !held.length) return null;
  return (
    <section className="mt-10 px-4" data-light-novels>
      <SectionTitle>{tr('Light novel')}</SectionTitle>
      <NovelList data={{ ...data, content: held }} seriesId={seriesId} />
    </section>
  );
}

/** Edit details -> Details: every novel AniList names, whether BookOrbit has it, and (admin) attaching one by hand. */
export function LightNovelDetails({ seriesId }: { seriesId: string }) {
  const { data } = useNovels(seriesId);
  const [attaching, setAttaching] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  if (!data) return null;
  const attachable = data.canEdit && !!data.bookorbit;
  const link = async (boSeriesId: number) => {
    try {
      await api(`/api/admin/series/${encodeURIComponent(seriesId)}/novel-links`, { method: 'PUT', json: { boSeriesId, on: true } });
      setAttaching(false);
      void qc.invalidateQueries({ queryKey: novelsKey(seriesId) });
    } catch { toast(tr('Could not save'), 'error'); }
  };
  return (
    <div data-light-novel-details>
      {data.content.length
        ? <NovelList data={data} seriesId={seriesId} />
        : <p className="text-xs text-fog-500">{data.lookups ? tr('AniList names no light novel for this series.') : tr('AniList lookups are off for this series’ library.')}</p>}
      {attachable && !attaching && <button type="button" onClick={() => setAttaching(true)} className="btn-key mt-2 text-xs" data-novel-attach>{tr('Attach a BookOrbit series')}</button>}
      {attaching && <AttachSearch onPick={(id) => void link(id)} onCancel={() => setAttaching(false)} />}
    </div>
  );
}

function NovelList({ data, seriesId }: { data: NovelAnswer; seriesId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const link = async (boSeriesId: number, on: boolean) => {
    try {
      await api(`/api/admin/series/${encodeURIComponent(seriesId)}/novel-links`, { method: 'PUT', json: { boSeriesId, on } });
      void qc.invalidateQueries({ queryKey: novelsKey(seriesId) });
    } catch { toast(tr('Could not save'), 'error'); }
  };

  return (
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.content.map((n) => {
          const rel = (REL as readonly string[]).indexOf(n.relation ?? '');
          const href = n.held && data.bookorbit ? `${data.bookorbit}${n.held.path}` : null;
          return (
            <li key={n.anilistId ?? `bo:${n.held?.id}`} data-novel={n.anilistId ?? `bo:${n.held?.id}`} className="flex gap-3 rounded-2xl border border-ink-800/80 bg-ink-900/40 p-3">
              <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-700/60">
                <Img src={n.cover ? sourceCover(undefined, n.cover) : ''} alt="" fallbackSrc={n.cover || undefined} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="line-clamp-2 text-sm font-medium leading-snug text-fog-100">{n.title}</p>
                <p className="mt-0.5 text-[11px] text-fog-500">
                  {[rel >= 0 ? tr(REL_LABELS[rel]) : '', n.status ? statusText(n.status) : '', n.score ? `★ ${(n.score / 10).toFixed(1)}` : ''].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="btn-key btn-key-primary text-xs" data-novel-open>
                      {tr('Open in BookOrbit')}{n.held!.volumes > 1 ? ` · ${tr('{n} volumes', { n: n.held!.volumes })}` : ''}
                    </a>
                  ) : (
                    <span className="text-[11px] text-fog-500">{data.bookorbit ? tr('Not in BookOrbit yet') : tr('BookOrbit is not linked')}</span>
                  )}
                  {n.anilistId && <a href={`https://anilist.co/manga/${n.anilistId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-fog-400 hover:text-fog-100">AniList</a>}
                  {data.canEdit && n.manual && n.held && (
                    <button type="button" onClick={() => void link(n.held!.id, false)} className="text-[11px] text-fog-500 hover:text-fog-100" data-novel-detach>{tr('Detach')}</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
  );
}

/** Search BookOrbit's ebook series by name and pick one. */
function AttachSearch({ onPick, onCancel }: { onPick: (boSeriesId: number) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ['novel-search', term], enabled: term.length >= 2, staleTime: 30_000,
    queryFn: () => api<{ url: string | null; content: { id: number; name: string; volumes: number }[] }>(`/api/admin/bookorbit/novels?q=${encodeURIComponent(term)}`),
  });
  return (
    <div className="mt-2 rounded-2xl border border-ink-800/80 bg-ink-900/40 p-3" data-novel-search>
      <div className="flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search BookOrbit by name')} aria-label={tr('Search BookOrbit by name')}
          className="field min-w-0 flex-1" />
        <button type="button" onClick={onCancel} className="btn-key text-xs">{tr('Cancel')}</button>
      </div>
      {term.length >= 2 && (
        <ul className="mt-2 divide-y divide-ink-800/70">
          {(data?.content ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <span dir="auto" className="min-w-0 flex-1 truncate text-sm text-fog-100">{s.name}</span>
              <span className="shrink-0 text-[11px] text-fog-500">{s.volumes > 1 ? tr('{n} volumes', { n: s.volumes }) : tr('1 volume')}</span>
              <button type="button" onClick={() => onPick(s.id)} className="btn-key text-xs">{tr('Attach')}</button>
            </li>
          ))}
          {!isFetching && data && !data.content.length && <li className="py-2 text-[11px] text-fog-500">{tr('No ebook series found')}</li>}
        </ul>
      )}
    </div>
  );
}
