'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/ui';
import { api, img } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { t as tr } from '@/lib/i18n';
import { orderBoxes } from '@/lib/readerPanels';

/**
 * Panel detection for one series (Series → More → Panel detection): run the detector, look at what it found, and say when it is not
 * good enough. The server (bff lib/panelJob.ts) finds the panels with a neural network at three tiers -- fast, careful, thorough --
 * and keeps every tier's answer for a page side by side, so "Try harder" ADDS an answer and one can choose between them, or reject the
 * page and have it read whole. Nothing here changes the pages: it is the verdict on the boxes, shared by every account.
 */
type Tier = 'fast' | 'careful' | 'thorough';
const TIERS: Tier[] = ['fast', 'careful', 'thorough'];
const TIER_LABEL: Record<Tier, () => string> = { fast: () => tr('Fast'), careful: () => tr('Careful'), thorough: () => tr('Thorough') };

interface Status {
  running: boolean; mode: string | null; tier: Tier | null; current: string | null; queued: number;
  chapters: number; pages: number; failed: number; lastError: string | null;
  models: Record<Tier, { ready: boolean; megabytes: number }>;
}
interface Item {
  page: number; width: number | null; height: number | null;
  candidates: Partial<Record<Tier, { boxes: number[][] }>>;
  chosen: Tier | null; rejected: boolean; textH: number | null; next: Tier | null;
}
interface BookReview { pages: number; detected: number; items: Item[]; status: Status }
interface SeriesReview { chapters: Array<{ id: string; number: number; title: string | null; pages: number; found: number; rejected: number; tiers: Tier[] }>; status: Status }

const countPanels = (n: number): string => (n === 1 ? tr('1 panel') : tr('{n} panels', { n }));
const boxesOf = (it: Item, tier: Tier | null = it.chosen): number[][] => (tier ? it.candidates[tier]?.boxes ?? [] : []);

/** One page's picture with its boxes drawn over it, numbered in reading order. */
function Overlay({ bookId, item, tier, rtl, wide }: { bookId: string; item: Item; tier: Tier | null; rtl: boolean; wide?: boolean }) {
  const boxes = useMemo(() => orderBoxes(boxesOf(item, tier).map(([x, y, w, h]) => ({ x, y, w, h })), rtl), [item, tier, rtl]);
  const aspect = item.width && item.height ? `${item.width} / ${item.height}` : '2 / 3';
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-ink-900" style={{ aspectRatio: aspect }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.pageFit(bookId, item.page, wide ? 900 : 360)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-fill" />
      {boxes.map((b, i) => (
        <div key={i} className={`absolute border-2 ${item.rejected ? 'border-red-500/70 border-dashed' : 'border-emerald-400/90'}`}
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
          <span className="absolute start-0 top-0 rounded-br bg-black/70 px-1 text-[10px] font-semibold tabular-nums leading-4 text-white">{i + 1}</span>
        </div>
      ))}
      {item.rejected && <span className="absolute inset-x-0 bottom-0 bg-red-900/80 py-0.5 text-center text-[10px] font-medium text-white">{tr('Rejected — read whole')}</span>}
    </div>
  );
}

export function PanelReview({ seriesId, title, rtl = false, onClose }: { seriesId: string; title: string; rtl?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [bookId, setBookId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'rejected' | 'few'>('all');
  const [open, setOpen] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>('fast');

  const series = useQuery({
    queryKey: ['panels-series', seriesId],
    queryFn: () => api<SeriesReview>(`/api/series/${seriesId}/panels`),
    refetchInterval: (q) => (q.state.data?.status.running || (q.state.data?.status.queued ?? 0) > 0 ? 3000 : false),
  });
  const book = useQuery({
    queryKey: ['panels-book', bookId],
    queryFn: () => api<BookReview>(`/api/books/${bookId}/panels`),
    enabled: !!bookId,
    refetchInterval: (q) => (q.state.data?.status.running || (q.state.data?.status.queued ?? 0) > 0 ? 3000 : false),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['panels-series', seriesId] }); if (bookId) void qc.invalidateQueries({ queryKey: ['panels-book', bookId] }); };
  const status = book.data?.status ?? series.data?.status;
  const post = async (path: string, body: object, ok: string) => {
    try { await api(path, { method: 'POST', json: body }); toast(ok, 'success'); setTimeout(refresh, 600); }
    catch { toast(tr('Failed'), 'error'); }
  };
  const verdict = async (page: number, body: { rejected?: boolean; chosen?: Tier }) => {
    if (!bookId) return;
    try { await api(`/api/books/${bookId}/pages/${page}/panels`, { method: 'PUT', json: body }); refresh(); }
    catch { toast(tr('Failed'), 'error'); }
  };

  const items = useMemo(() => (book.data?.items ?? []).filter((it) => (filter === 'rejected' ? it.rejected : filter === 'few' ? boxesOf(it).length < 2 && !it.rejected : true)), [book.data, filter]);
  const chapter = series.data?.chapters.find((c) => c.id === bookId);
  const detail = open != null ? book.data?.items.find((i) => i.page === open) : null;
  // The sheet keeps its scroll between views: a page opened from far down the grid, or a grid after a page, starts at the top.
  useEffect(() => { document.querySelector('[data-panel-status]')?.scrollIntoView({ block: 'start' }); }, [bookId, open]);
  const needsModel = (t: Tier) => status && !status.models[t].ready;

  const statusLine = status?.running
    ? `${tr('Working on {name}', { name: status.current ?? '…' })}${status.queued > 0 ? ` · ${tr('{n} waiting', { n: status.queued })}` : ''}`
    : status?.lastError ? tr('Stopped: {why}', { why: status.lastError }) : tr('Idle');

  return (
    <Sheet title={bookId ? `${title} · ${chapter?.title || tr('Chapter {n}', { n: chapter?.number ?? '' })}` : `${title} · ${tr('Panel detection')}`} onClose={onClose} wrapTitle overBottomNav>
      <p role="status" className={`mb-3 text-xs ${status?.running ? 'text-accent' : status?.lastError ? 'text-red-400' : 'text-fog-500'}`} data-panel-status>{statusLine}</p>

      {!bookId && (
        <>
          <div className="mb-4 rounded-xl border border-ink-700 p-3">
            <p className="text-sm font-medium text-fog-200">{tr('Find the panels of every chapter')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {TIERS.map((t) => (
                <button key={t} type="button" aria-pressed={tier === t} onClick={() => setTier(t)} className={`chip text-xs ${tier === t ? 'border-accent text-accent' : ''}`}>
                  {TIER_LABEL[t]()}{needsModel(t) ? ` · ${tr('{n} MB', { n: status!.models[t].megabytes })}` : ''}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-fog-500">
              {tr('Fast takes a moment a page. Careful and Thorough look harder and take longer; a model is downloaded the first time its tier runs. Chapters already done at this tier are skipped.')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn-key" disabled={status?.running} data-detect-series
                onClick={() => void post(`/api/series/${seriesId}/panels`, { tier }, tr('Started'))}>{tr('Detect panels')}</button>
              <button type="button" className="btn-key" disabled={status?.running} data-harder-rejected
                onClick={() => void post(`/api/series/${seriesId}/panels`, { harder: true, onlyRejected: true }, tr('Trying harder on the rejected pages'))}>{tr('Try harder on rejected pages')}</button>
              <button type="button" className="btn-key" disabled={status?.running}
                onClick={() => void post(`/api/series/${seriesId}/panels`, { harder: true }, tr('Trying harder on every page'))}>{tr('Try harder on everything')}</button>
            </div>
          </div>
          <ul className="space-y-1.5" data-panel-chapters>
            {(series.data?.chapters ?? []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { setBookId(c.id); setOpen(null); setFilter('all'); }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2 text-start hover:border-ink-500">
                  <span className="min-w-0 truncate text-sm text-fog-200">{c.title || tr('Chapter {n}', { n: c.number })}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-fog-500">
                    {c.rejected > 0 && <span className="rounded bg-red-900/60 px-1.5 text-red-200">{c.rejected === 1 ? tr('1 rejected') : tr('{n} rejected', { n: c.rejected })}</span>}
                    {c.found ? <span>{c.found}/{c.pages}</span> : <span>{tr('not detected')}</span>}
                    {c.tiers.length > 0 && <span>{c.tiers.map((t) => TIER_LABEL[t]()[0]).join('')}</span>}
                  </span>
                </button>
              </li>
            ))}
            {series.isLoading && <li className="text-xs text-fog-500">{tr('Loading…')}</li>}
          </ul>
        </>
      )}

      {bookId && !detail && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-key" onClick={() => { setBookId(null); setOpen(null); }}>{tr('All chapters')}</button>
            {(['all', 'rejected', 'few'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`chip text-xs ${filter === f ? 'border-accent text-accent' : ''}`}>
                {f === 'all' ? tr('All') : f === 'rejected' ? tr('Rejected') : tr('No panels')}
              </button>
            ))}
            <button type="button" className="btn-key ms-auto" disabled={status?.running} data-harder-chapter
              onClick={() => void post(`/api/books/${bookId}/panels`, { harder: true, pages: (book.data?.items ?? []).filter((i) => i.rejected).map((i) => i.page) }, tr('Trying harder on the rejected pages'))}>
              {tr('Try harder on rejected')}
            </button>
          </div>
          {!book.data?.detected && !book.isLoading && (
            <p className="text-sm text-fog-400">{tr('Nothing has been detected in this chapter yet.')}</p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-panel-pages>
            {items.map((it) => (
              <div key={it.page} className="space-y-1">
                <button type="button" onClick={() => setOpen(it.page)} aria-label={tr('Review page {n}', { n: it.page })} className="block w-full text-start">
                  <Overlay bookId={bookId} item={it} tier={it.chosen} rtl={rtl} />
                </button>
                <div className="flex items-center justify-between gap-1 text-[10px] text-fog-500">
                  <span className="tabular-nums">{it.page} · {countPanels(boxesOf(it).length)}{it.chosen ? ` · ${TIER_LABEL[it.chosen]()[0]}` : ''}</span>
                  <button type="button" className={`rounded px-1.5 py-0.5 ${it.rejected ? 'bg-emerald-900/60 text-emerald-200' : 'bg-red-900/50 text-red-200'}`}
                    onClick={() => void verdict(it.page, { rejected: !it.rejected })}>{it.rejected ? tr('Accept') : tr('Reject')}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {bookId && detail && (
        <div data-panel-detail>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-key" onClick={() => setOpen(null)}>{tr('All pages')}</button>
            <span className="text-sm text-fog-300">{tr('Page {n}', { n: detail.page })}</span>
            {detail.textH != null && <span className="text-[11px] text-fog-500">{tr('lettering {n}% of the width', { n: (detail.textH * 100).toFixed(1) })}</span>}
          </div>
          <div className="mx-auto max-w-md"><Overlay bookId={bookId} item={detail} tier={detail.chosen} rtl={rtl} wide /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {TIERS.filter((t) => detail.candidates[t]).map((t) => (
              <button key={t} type="button" aria-pressed={detail.chosen === t} onClick={() => void verdict(detail.page, { chosen: t })}
                className={`chip text-xs ${detail.chosen === t && !detail.rejected ? 'border-accent text-accent' : ''}`}>
                {TIER_LABEL[t]()} · {countPanels(detail.candidates[t]!.boxes.length)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-key" onClick={() => void verdict(detail.page, { rejected: !detail.rejected })}>{detail.rejected ? tr('Accept') : tr('Reject — read whole')}</button>
            <button type="button" className="btn-key" disabled={!detail.next || status?.running} data-harder-page
              onClick={() => void post(`/api/books/${bookId}/panels`, { harder: true, pages: [detail.page] }, tr('Trying harder'))}>
              {detail.next ? `${tr('Try harder')} · ${TIER_LABEL[detail.next]()}${needsModel(detail.next) ? ` (${tr('{n} MB', { n: status!.models[detail.next].megabytes })})` : ''}` : tr('Nothing harder to try')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
