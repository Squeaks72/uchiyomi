'use client';
// Discover for a reader who may not reach the sources (2026-11-18): nothing here asks a source or any outside service. It shows what the
// server already has -- a search of the library, AniList's trending and "because you read" picks as the server stored them -- and turns
// anything missing into a request to the admin (bff routes/requests.ts), or a title saved to one of the reader's lists for later.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Page, Series } from '@/lib/types';
import { t as tr, keys } from '@/lib/i18n';
import { relativeTime } from '@/lib/format';
import type { ReadPick } from '@/lib/forYou';
import type { Trending } from './DiscoverHero';
import { SeriesCard, sourceCover } from './cards';
import { CollectionPickerModal } from './CollectionPicker';
import { ScrollRail, CARD_RAIL } from './ScrollRail';
import { Img, SectionTitle } from './ui';
import { Modal } from './ConfirmDialog';
import { useToast } from './Toast';
import { IcBookmark, IcSearch, IcX } from './icons';

interface MyRequest { id: string; title: string; status: 'open' | 'added' | 'declined'; seriesId: string | null; adminNote: string | null; createdAt: string; coverUrl: string | null }
interface Wanted { title: string; anilistId?: number | null; cover?: string | null }

const TREND_LABELS = keys('Trending manhwa', 'Trending manga', 'Trending manhua');
const COUNTRIES = [['KR', TREND_LABELS[0]], ['JP', TREND_LABELS[1]], ['CN', TREND_LABELS[2]]] as const;

export function MemberDiscover() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const search = useQuery({
    queryKey: ['member-search', term], enabled: term.length >= 2, staleTime: 30_000,
    queryFn: () => api<Page<Series>>('/api/series/search', { json: { query: term, size: 30 } }),
  });
  const mine = useQuery({ queryKey: ['my-requests'], queryFn: () => api<{ content: MyRequest[] }>('/api/requests/mine'), staleTime: 30_000 });
  const because = useQuery({ queryKey: ['member-because'], queryFn: () => api<{ content: ReadPick[] }>('/api/discover/because'), staleTime: 300_000, retry: false });
  const [saving, setSaving] = useState<Wanted | null>(null);
  const [asking, setAsking] = useState<Wanted | null>(null);
  const [freeTitle, setFreeTitle] = useState('');

  const requested = new Set((mine.data?.content ?? []).filter((r) => r.status === 'open').map((r) => r.title.toLowerCase()));
  const withdraw = async (id: string) => {
    try { await api(`/api/requests/${id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['my-requests'] }); }
    catch { toast(tr('Could not save'), 'error'); }
  };

  const Card = ({ w }: { w: Wanted }) => (
    <div className="w-36 shrink-0 sm:w-40" data-member-pick>
      <div className="aspect-[2/3] overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
        {w.cover && <Img src={sourceCover(undefined, w.cover)} alt="" className="h-full w-full" />}
      </div>
      <p dir="auto" className="mt-1.5 line-clamp-2 text-xs font-medium text-fog-100">{w.title}</p>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" onClick={() => setAsking(w)} disabled={requested.has(w.title.toLowerCase())} className="btn-key flex-1 px-2 text-[11px]" data-member-request>
          {requested.has(w.title.toLowerCase()) ? tr('Requested') : tr('Request')}
        </button>
        <button type="button" onClick={() => setSaving(w)} aria-label={tr('Save to a list for later')} title={tr('Save to a list for later')} className="btn-key w-8 px-0">
          <IcBookmark width={14} height={14} aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen-d px-4 pb-10 lg:px-0" data-member-discover>
      <h1 className="pt-4 font-display text-2xl font-semibold">{tr('Discover')}</h1>
      <p className="mt-1 max-w-prose text-sm text-fog-400">{tr('Find something in the library, or ask for a series it does not have yet.')}</p>

      {/* The library, searched: the same search as the top bar's, here because this is where a reader looks. */}
      <div className="relative mt-4 max-w-xl">
        <IcSearch width={16} height={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fog-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search the library')} aria-label={tr('Search the library')}
          className="field w-full ps-9" data-member-search />
        {q && <button type="button" onClick={() => setQ('')} aria-label={tr('Clear')} className="absolute end-2 top-1/2 -translate-y-1/2 text-fog-500"><IcX width={16} height={16} /></button>}
      </div>
      {term.length >= 2 && (
        <section className="mt-4">
          {(search.data?.content.length ?? 0) > 0 ? (
            <ScrollRail label={tr('In the library')} className={CARD_RAIL}>{search.data!.content.map((s) => <SeriesCard key={s.id} series={s} />)}</ScrollRail>
          ) : !search.isFetching && (
            <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-4 text-sm text-fog-300">
              {tr('The library has nothing called “{query}”.', { query: `⁨${term}⁩` })}
              <button type="button" className="btn-key ms-2" onClick={() => setAsking({ title: term })} data-member-request-search>{tr('Request it')}</button>
            </div>
          )}
        </section>
      )}

      {(mine.data?.content.length ?? 0) > 0 && (
        <section className="mt-8" data-my-requests>
          <SectionTitle>{tr('Your requests')}</SectionTitle>
          <ul className="max-w-2xl divide-y divide-ink-800/70 rounded-2xl border border-ink-800">
            {mine.data!.content.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {r.seriesId ? <Link href={`/series/?id=${r.seriesId}`} dir="auto" className="block truncate text-fog-100 hover:text-accent">{r.title}</Link>
                    : <span dir="auto" className="block truncate text-fog-100">{r.title}</span>}
                  <span className="text-[11px] text-fog-500">
                    {r.status === 'open' ? tr('Waiting · asked {when}', { when: relativeTime(r.createdAt) })
                      : r.status === 'added' ? tr('Added to the library') : tr('Declined')}
                    {r.adminNote && <> · {r.adminNote}</>}
                  </span>
                </span>
                {r.status === 'open' && <button type="button" className="btn-key shrink-0 text-xs" onClick={() => void withdraw(r.id)}>{tr('Withdraw')}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(because.data?.content.length ?? 0) > 0 && (
        <section className="mt-8">
          <SectionTitle>{tr('Because you read')}</SectionTitle>
          <ScrollRail label={tr('Because you read')} className={CARD_RAIL}>
            {because.data!.content.map((p) => <Card key={`${p.id ?? p.title}`} w={{ title: p.title, anilistId: p.id ?? null, cover: p.cover }} />)}
          </ScrollRail>
        </section>
      )}

      {COUNTRIES.map(([c, label]) => <TrendingRow key={c} country={c} label={tr(label)} Card={Card} />)}

      {/* Anything else, by name: the admin looks for it. */}
      <section className="mt-10 max-w-xl" data-member-request-free>
        <SectionTitle>{tr('Request a series by name')}</SectionTitle>
        <div className="flex gap-2">
          <input value={freeTitle} onChange={(e) => setFreeTitle(e.target.value)} placeholder={tr('Title')} aria-label={tr('Title')} className="field min-w-0 flex-1" />
          <button type="button" className="btn-key btn-key-primary" disabled={!freeTitle.trim()} onClick={() => setAsking({ title: freeTitle.trim() })}>{tr('Request')}</button>
        </div>
      </section>

      {saving && <CollectionPickerModal seriesIds={[]} want={{ title: saving.title, coverUrl: saving.cover ?? null }} onClose={() => setSaving(null)} />}
      {asking && <RequestDialog wanted={asking} onClose={() => setAsking(null)} onSent={() => { setAsking(null); setFreeTitle(''); void qc.invalidateQueries({ queryKey: ['my-requests'] }); }} />}
    </div>
  );
}

/** One country's trending titles: those the library has (open them), then those it has not (request or save). */
function TrendingRow({ country, label, Card }: { country: string; label: string; Card: (p: { w: Wanted }) => React.ReactElement }) {
  const { data } = useQuery({
    queryKey: ['member-trending', country], staleTime: 300_000, retry: false,
    queryFn: () => api<{ content: Trending[]; inLibrary?: { id: number | null; title: string; cover: string | null; seriesId: string }[] }>(`/api/discover/trending?country=${country}`),
  });
  const held = data?.inLibrary ?? [];
  const missing = data?.content ?? [];
  if (!held.length && !missing.length) return null;
  return (
    <section className="mt-8" data-member-trending={country}>
      <SectionTitle>{label}</SectionTitle>
      <ScrollRail label={label} className={CARD_RAIL}>
        {held.map((h) => (
          <Link key={`h${h.seriesId}`} href={`/series/?id=${h.seriesId}`} className="w-36 shrink-0 sm:w-40" data-member-held>
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-accent/40 bg-ink-900">
              {h.cover && <Img src={sourceCover(undefined, h.cover)} alt="" className="h-full w-full" />}
              <span className="absolute start-1.5 top-1.5 rounded-[4px] bg-black/70 px-1 text-[10px] font-semibold uppercase tracking-wide text-accent">{tr('In the library')}</span>
            </div>
            <p dir="auto" className="mt-1.5 line-clamp-2 text-xs font-medium text-fog-100">{h.title}</p>
          </Link>
        ))}
        {missing.map((t) => <Card key={`${t.id ?? t.title}`} w={{ title: t.title, anilistId: t.id ?? null, cover: t.cover }} />)}
      </ScrollRail>
    </section>
  );
}

/** Send a request, with an optional note for the admin. */
function RequestDialog({ wanted, onClose, onSent }: { wanted: Wanted; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ already: boolean; request: { status: string } }>('/api/requests', {
        method: 'POST', json: { title: wanted.title, anilistId: wanted.anilistId ?? null, coverUrl: wanted.cover ?? null, note: note.trim() || null },
      });
      toast(r.request.status === 'added' ? tr('It is already in the library') : r.already ? tr('You already asked for this') : tr('Request sent'), 'success');
      onSent();
    } catch { toast(tr('Could not send the request'), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={tr('Request “{title}”', { title: `⁨${wanted.title}⁩` })} onClose={onClose}>
      <p className="text-sm text-fog-300">{tr('The admin is told, finds it and adds it to the library. You are notified when it is added or declined.')}</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={tr('A note for the admin (optional)')}
        aria-label={tr('A note for the admin (optional)')} className="field mt-3 w-full" />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-key">{tr('Cancel')}</button>
        <button type="button" onClick={() => void send()} disabled={busy} className="btn-key btn-key-primary" data-member-request-send>{tr('Send request')}</button>
      </div>
    </Modal>
  );
}
