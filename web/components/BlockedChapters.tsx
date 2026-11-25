'use client';
// A blocked group's chapters still on the shelf (#396, bff lib/blockedPurge.ts), and the question whether to remove
// them completely. Blocking a group is saved at once and only hides; this is the confirmed second step, asked wherever
// a block is made -- under "Translated by" in a series' Sources & translations sheet (`seriesId`), and in the
// Scanlation groups editor for every series (none). Asked inline, never in a dialog: both live in a Sheet, and a Modal
// opened under a Sheet cannot be tapped.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { useToast } from '@/components/Toast';
import { msgOf } from '@/components/ConfirmDialog';

export interface BlockedChapters {
  chapters: number;
  series: number;
  readers: number;
  books: Array<{ id: string; seriesId: string; seriesTitle: string; number: number; scanlator: string | null; pruned: boolean; keptCopy?: string | null }>;
  /** Kept copies (Keep every source's copy) by blocked groups, beside chapters that stay. */
  copies?: Array<{ bookId: string; sourceId: string; seriesId: string; number: number; scanlator: string | null }>;
  /** Of `chapters`, how many have another group's kept copy: that copy is endorsed in their place, nothing is lost. */
  endorsing?: number;
}

/** The query key: one series, or '*' for every series. A block saved anywhere invalidates ['blocked-chapters']. */
export const blockedChaptersKey = (seriesId?: string) => ['blocked-chapters', seriesId ?? '*'];

/** The question's sentence, by how many chapters, series and readers it is about. */
export function blockedChaptersText(d: Pick<BlockedChapters, 'chapters' | 'series' | 'readers' | 'copies' | 'endorsing'>, everySeries: boolean): string {
  const endorsing = d.endorsing ?? 0, copies = d.copies?.length ?? 0;
  const parts = [
    ...(d.chapters === 0 ? []
      : d.chapters === 1 ? [tr('1 downloaded chapter is only from blocked groups.')] : [tr('{n} downloaded chapters are only from blocked groups.', { n: d.chapters })]),
    ...(endorsing === 1 ? [tr('1 chapter keeps another group\'s copy: that copy is used instead.')]
      : endorsing > 1 ? [tr('{n} chapters keep another group\'s copy: that copy is used instead.', { n: endorsing })] : []),
    ...(copies === 1 ? [tr('1 kept copy comes from a blocked group.')]
      : copies > 1 ? [tr('{n} kept copies come from a blocked group.', { n: copies })] : []),
    ...(everySeries && d.series > 1 ? [tr('They are in {n} different series.', { n: d.series })] : []),
    tr('Remove them completely, as if they had never been downloaded?'),
    ...(d.readers === 1 ? [tr('Reading history on them goes too, for 1 reader.')]
      : d.readers > 1 ? [tr('Reading history on them goes too, for {n} readers.', { n: d.readers })] : []),
  ];
  return parts.join(' ');
}

export function BlockedChaptersAsk({ seriesId }: { seriesId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: blockedChaptersKey(seriesId),
    queryFn: () => api<BlockedChapters>(`/api/admin/blocked-chapters${seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : ''}`),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  // Keep answers for exactly the chapters asked about: a chapter blocked later asks again.
  const [kept, setKept] = useState<string | null>(null);
  const copyKeys = (data?.copies ?? []).map((c) => `${c.bookId}|${c.sourceId}`);
  if (!data?.chapters && !copyKeys.length) return null;
  const asked = [...data!.books.map((b) => b.id), ...copyKeys].join(',');
  if (kept === asked) return null;
  const remove = async () => {
    setBusy(true);
    try {
      const r = await api<{ removed: number; left: Array<{ reason: string }>; busy: string[]; endorsed?: number; copiesDropped?: number }>('/api/admin/blocked-chapters/purge', {
        method: 'POST', json: { bookIds: data!.books.map((b) => b.id), copies: copyKeys },
      });
      if (r.removed || !r.endorsed) toast(r.removed === 1 ? tr('Removed 1 chapter') : tr('Removed {n} chapters', { n: r.removed }), 'success');
      if (r.endorsed) toast(r.endorsed === 1 ? tr('1 chapter switched to another group\'s copy') : tr('{n} chapters switched to another group\'s copy', { n: r.endorsed }), 'success');
      const keptAsIs = r.left.filter((l) => l.reason === 'kept_copy').length;
      if (keptAsIs) toast(keptAsIs === 1 ? tr('1 chapter left unchanged: another group\'s copy cannot be fetched now.') : tr('{n} chapters left unchanged: another group\'s copy cannot be fetched now.', { n: keptAsIs }), 'info');
      if (r.left.length > keptAsIs || r.busy.length) toast(tr('Some chapters could not be removed now. Try again in a moment.'), 'error');
      for (const k of ['blocked-chapters', 'series-books', 'series-listing', 'series-versions', 'series', 'library', 'home']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    } catch (e) { toast(msgOf(e, tr('Could not remove the chapters')), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div role="alertdialog" aria-label={tr('Remove blocked chapters')} data-blocked-chapters-ask
      className="mt-2 border-s-2 border-rose-400/70 bg-ink-850/80 py-2 pe-2 ps-2.5">
      <p className="text-[12px] leading-relaxed text-fog-100">{blockedChaptersText(data!, !seriesId)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void remove()} disabled={busy} className="btn-key btn-key-danger" data-blocked-chapters-remove>
          {busy ? tr('Working…') : tr('Remove completely')}
        </button>
        <button type="button" onClick={() => setKept(asked)} disabled={busy} className="btn-key" data-blocked-chapters-keep>{tr('Keep')}</button>
      </div>
    </div>
  );
}
