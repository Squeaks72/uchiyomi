'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { canDownload, useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { applyFavorite } from '@/lib/favoriteCache';
import { archiveWhy } from '@/lib/archive';
import { followBulkNewest, BULK_NEWEST_POLL_MS, type BulkNewestStatus } from '@/lib/bulkNewest';
import { kickDownloads } from '@/lib/useServerDownloads';
import { findRefusal } from '@/lib/useFindRun';
import {
  BULK_CHAPTER_DELETE_POLL_MS, bulkChapterDeleteFinished, forgetBulkChapterDeleteRun, rememberBulkChapterDeleteRun,
  startedBulkChapterDeleteRun, type BulkChapterDeleteRun,
} from '@/lib/bulkChapterDelete';
import { useToast } from './Toast';
import { ConfirmDialog, msgOf } from './ConfirmDialog';
import { useArchiveEnqueue } from './ArchiveQueue';
import { MoveToLibrary } from './MoveToLibrary';
import { CollectionPickerModal } from './CollectionPicker';
import { FindStartDialog } from './FindSources';
import { BulkChapterDeleteRunDialog } from './BulkChapterDeleteRun';
import type { MenuItem } from './ContextMenu';

type Dialog = null | 'list' | 'move' | 'find' | 'remove' | 'chapters';

/**
 * Every action that makes sense for one series or for many, as menu items: the single source for the card's menu,
 * the Library's and a list's Select-mode menu, and anywhere else a series menu opens. `ids` is the series (or
 * selection) the menu was opened for; the server routes are the bulk ones, which take a selection of one.
 * `onDone` runs after an action changed things (the Library leaves Select mode with it).
 */
export function useSeriesActions({ onDone, builtinList }: { onDone?: () => void; builtinList?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin, status, user } = useAuth();
  const archive = useArchiveEnqueue();
  const offline = status === 'offline';
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [alsoPause, setAlsoPause] = useState(true);
  const [run, setRun] = useState<BulkChapterDeleteRun | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const settle = () => {
    for (const key of [['library'], ['home'], ['collection'], ['series'], ['series-books'], ['favorite-ids']]) qc.invalidateQueries({ queryKey: key });
    onDone?.();
  };
  const open = (d: Dialog, of: string[]) => { setIds(of); setDialog(d); };
  const close = () => setDialog(null);

  const bulk = async (of: string[], path: string, extra: Record<string, unknown>, done: (n: number) => string) => {
    try {
      const r = await api<{ applied: number; skipped?: { id: string }[]; problems?: { reason?: string }[] }>(path, { json: { seriesIds: of, ...extra } });
      if (r.problems?.length) toast(`${r.problems.length === 1 ? tr('1 folder could not be moved') : tr('{n} folders could not be moved', { n: r.problems.length })}: ${r.problems[0].reason ?? ''}`, 'error');
      else toast(r.applied ? done(r.applied) : tr('That series is no longer in the library'), r.applied ? 'success' : 'error');
      if (r.applied && typeof extra.favorite === 'boolean') { const gone = new Set((r.skipped ?? []).map((x) => x.id)); for (const sid of of) if (!gone.has(sid)) applyFavorite(qc, sid, extra.favorite); }
      settle();
    } catch { toast(tr('Could not do that'), 'error'); }
  };
  const updated = (n: number) => (n === 1 ? tr('1 series updated') : tr('{n} series updated', { n }));

  const fetchNewest = async (of: string[]) => {
    try {
      const start = await api<{ ok: true; total: number }>('/api/library/bulk/newest', { method: 'POST', json: { ids: of } });
      toast(tr('Fetching {done} of {total}…', { done: 0, total: start.total }), 'info', { busy: true });
      const end = await followBulkNewest({
        poll: () => api<BulkNewestStatus>('/api/library/bulk/newest'),
        onProgress: () => {},
        wait: () => new Promise<void>((r) => setTimeout(r, BULK_NEWEST_POLL_MS)),
        cancelled: () => false,
      });
      if (end.outcome === 'lost') toast(tr('Lost track of the fetch. Check the library in a moment.'), 'error');
      else if (end.outcome === 'finished') {
        const last = end.status!;
        const n = (o: BulkNewestStatus['results'][number]['outcome']) => last.results.filter((r) => r.outcome === o).length;
        const [got, same, skipped, failed] = [n('downloaded'), n('up_to_date'), n('skipped'), n('failed')];
        const parts: string[] = [];
        if (got) parts.push(got === 1 ? tr('Fetched 1 chapter') : tr('Fetched {n} chapters', { n: got }));
        if (same) parts.push(same === 1 ? tr('1 up to date') : tr('{n} up to date', { n: same }));
        if (skipped) parts.push(skipped === 1 ? tr('1 skipped') : tr('{n} skipped', { n: skipped }));
        if (failed) parts.push(failed === 1 ? tr('1 failed') : tr('{n} failed', { n: failed }));
        toast(parts.length ? parts.join(' · ') : tr('Nothing to fetch'), failed && !got ? 'error' : 'success');
        settle();
      }
    } catch (e) { toast(msgOf(e, tr('Could not start the fetch')), 'error'); }
  };

  const check = async (of: string[]) => {
    try {
      await Promise.all(of.map((id) => api(`/api/admin/series/${encodeURIComponent(id)}/check`, { method: 'POST', json: {} })));
      toast(tr('Checking for new chapters…'), 'info', { busy: true });
    } catch { toast(tr('Could not do that'), 'error'); }
  };

  const monitor = async (of: string[], on: boolean) => {
    try {
      const r = await api<{ applied: number; skipped: unknown[] }>('/api/admin/series/bulk/auto-update', { json: { seriesIds: of, autoUpdate: on } });
      const head = on
        ? (r.applied === 1 ? tr('Monitored 1 series') : tr('Monitored {n} series', { n: r.applied }))
        : (r.applied === 1 ? tr('Unmonitored 1 series') : tr('Unmonitored {n} series', { n: r.applied }));
      toast(r.skipped.length ? `${head} · ${r.skipped.length === 1 ? tr('1 skipped') : tr('{n} skipped', { n: r.skipped.length })}` : head, r.applied ? 'success' : 'error');
      if (r.applied) settle();
    } catch (e) { toast(msgOf(e, tr('Could not change monitoring')), 'error'); }
  };

  const find = async (of: string[], review: boolean) => {
    try {
      const r = await api<{ runId: string; total: number }>('/api/admin/sources/find', { method: 'POST', json: { seriesIds: of, ...(review ? { review } : {}) } });
      const n = r?.total ?? of.length;
      toast(n === 1 ? tr('Looking for other sources for 1 series… Library → Downloads shows how it goes.')
        : tr('Looking for other sources for {n} series… Library → Downloads shows how it goes.', { n }), 'info', { busy: true });
      void kickDownloads(qc);
      settle();
    } catch (e) { toast(findRefusal(e), 'error'); }
  };

  const removeFromLibrary = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: true; hidden: number; skipped: { id: string; reason: string }[] }>('/api/admin/series/bulk/hide', { json: { ids } });
      close();
      if (r.hidden === 0) toast(r.skipped.length === 1 ? tr('Nothing removed · 1 skipped') : tr('Nothing removed · {n} skipped', { n: r.skipped.length }), 'error');
      else {
        const parts = [r.hidden === 1 ? tr('Removed 1 series') : tr('Removed {n} series', { n: r.hidden })];
        if (r.skipped.length) parts.push(r.skipped.length === 1 ? tr('1 skipped') : tr('{n} skipped', { n: r.skipped.length }));
        toast(parts.join(' · '), 'success');
        settle();
      }
    } catch (e) { toast(msgOf(e, tr('Could not remove those')), 'error'); }
    setBusy(false);
  };

  const deleteChapters = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: true; runId: string; total: number }>('/api/admin/series/bulk/chapters/delete', { method: 'POST', json: { seriesIds: ids, pause: alsoPause } });
      rememberBulkChapterDeleteRun(r.runId);
      setRun(startedBulkChapterDeleteRun(r.runId, r.total, alsoPause));
      setRunOpen(true);
      close();
      settle();
    } catch (e) { toast(msgOf(e, tr('Could not start the cleanup')), 'error'); }
    setBusy(false);
  };

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let again = true;
      try {
        const r = await api<{ run: BulkChapterDeleteRun | null }>(`/api/admin/series/bulk/chapters/delete?runId=${encodeURIComponent(run.id)}`);
        if (!alive || !r.run) return;
        setRun(r.run);
        again = r.run.status === 'running';
        if (!again) { qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['home'] }); }
      } catch { /* the server run is durable; keep asking */ }
      if (alive && again) timer = setTimeout(poll, BULK_CHAPTER_DELETE_POLL_MS);
    };
    timer = setTimeout(poll, 50);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [run?.id, run?.status, qc]);

  const cancelRun = async () => {
    if (!run || run.status !== 'running' || run.cancelRequested) return;
    setCancelling(true);
    try {
      await api('/api/admin/series/bulk/chapters/delete/cancel', { method: 'POST', json: { runId: run.id } });
      setRun((r) => (r && r.id === run.id ? { ...r, cancelRequested: true } : r));
    } catch (e) { toast(msgOf(e, tr('Could not stop the cleanup')), 'error'); }
    setCancelling(false);
  };
  const closeRun = () => {
    setRunOpen(false);
    if (run && bulkChapterDeleteFinished(run)) { forgetBulkChapterDeleteRun(run.id); setRun(null); }
  };

  const n = ids.length;
  const element: ReactNode = (
    <>
      {dialog === 'list' && <CollectionPickerModal seriesIds={ids} onClose={close} onDone={() => { close(); settle(); }} />}
      {dialog === 'move' && <MoveToLibrary n={n} busy={busy} onClose={close} onPick={async (libraryId) => {
        setBusy(true); close();
        await bulk(ids, '/api/admin/series/library', { libraryId }, updated);
        qc.invalidateQueries({ queryKey: ['library-sources'] });
        setBusy(false);
      }} />}
      {dialog === 'find' && <FindStartDialog onClose={close} onStart={(review) => { close(); void find(ids, review); }} />}
      {dialog === 'remove' && (
        <ConfirmDialog
          title={n === 1 ? tr('Remove 1 series from the library?') : tr('Remove {n} series from the library?', { n })}
          danger busy={busy} confirmLabel={tr('Remove')}
          body={<>
            <p><strong className="text-fog-100">{tr('No files are deleted.')}</strong> {tr('The chapters stay exactly where they are on disk, and nothing in your library folder is touched.')}</p>
            <p className="mt-2">{tr("Everyone's reading progress, history, favourites and ratings are kept, so you can put them back at any time from Admin → Library.")}</p>
          </>}
          onConfirm={removeFromLibrary} onClose={close} />
      )}
      {dialog === 'chapters' && (
        <ConfirmDialog
          title={n === 1 ? tr('Delete the downloaded chapters of 1 series?') : tr('Delete the downloaded chapters of {n} series?', { n })}
          danger busy={busy} confirmLabel={tr('Delete chapters')}
          body={<>
            <p>{tr('Every chapter Uchiyomi downloaded is deleted from the server, except each series’ cover chapter, so the covers stay. Files in a library you built by hand, and bookmarked chapters, are left alone.')}</p>
            <p className="mt-2">{tr('The chapters stay listed and everyone keeps their reading history. Fetch again on the series page brings a chapter back.')}</p>
            <p className="mt-2 font-medium text-amber-300">{tr('Deleting a chapter being read can lose its reading position.')}</p>
            <label className="mt-3 flex items-start gap-2 text-sm text-fog-200">
              <input type="checkbox" className="mt-0.5 pointer-coarse:size-5 pointer-coarse:shrink-0" checked={alsoPause} onChange={(e) => setAlsoPause(e.target.checked)} data-also-pause />
              <span>
                {tr('Also stop updates for these series')}
                <span className="block text-xs text-fog-500">{tr('Otherwise the next check downloads their newest chapters again.')}</span>
              </span>
            </label>
          </>}
          onConfirm={deleteChapters} onClose={close} />
      )}
      {run && runOpen && <BulkChapterDeleteRunDialog run={run} cancelling={cancelling} onCancel={() => { void cancelRun(); }} onClose={closeRun} />}
    </>
  );

  /**
   * The menu for `of`: one series or a selection. `favourite`: whether one series is already a favourite.
   * `monitored`: whether every one of them is monitored (true), none is (false), or it is mixed or unknown (undefined),
   * which offers both.
   */
  const items = (of: string[], opts: { favourite?: boolean; monitored?: boolean } = {}): MenuItem[] => {
    const many = of.length > 1;
    const dl = canDownload(user);
    const favourite = !many && !!opts.favourite;
    const off = offline;
    const downloads: MenuItem[] = [
      ...(dl ? [
        { label: tr('Fetch newest'), disabled: off, onSelect: () => fetchNewest(of) },
        { label: tr('Archive slowly'), disabled: off, title: archiveWhy(), onSelect: async () => { const r = await archive(of); if (r) settle(); } },
      ] : []),
    ];
    const manage: MenuItem[] = [
      { label: tr('Check for new chapters'), disabled: off, onSelect: () => check(of) },
      { label: tr('Find other sources'), disabled: off, hook: 'find-selected', onSelect: () => open('find', of) },
      { label: tr('Move library'), disabled: off, hook: 'move-library', onSelect: () => open('move', of) },
      ...(opts.monitored !== true ? [{ label: tr('Monitor'), disabled: off, onSelect: () => monitor(of, true) }] : []),
      ...(opts.monitored !== false ? [{ label: tr('Unmonitor'), disabled: off, onSelect: () => monitor(of, false) }] : []),
    ];
    const remove: MenuItem[] = [
      { label: tr('Delete chapters'), danger: true, disabled: off, onSelect: () => { setAlsoPause(true); open('chapters', of); } },
      { label: tr('Remove from library'), danger: true, disabled: off, onSelect: () => open('remove', of) },
    ];
    return [
      { label: tr('Add to list'), disabled: off, onSelect: () => open('list', of) },
      {
        label: favourite ? tr('Remove from favorites') : tr('Favorite'), disabled: off,
        onSelect: () => bulk(of, '/api/favorites/bulk', { favorite: !favourite }, () => (favourite ? tr('Removed from favorites') : tr('Added to favorites'))),
      },
      ...(many ? [{ label: tr('Remove from favorites'), disabled: off, onSelect: () => bulk(of, '/api/favorites/bulk', { favorite: false }, () => tr('Removed from favorites')) }] : []),
      { label: many ? tr('Mark read') : tr('Mark all read'), disabled: off, onSelect: () => bulk(of, '/api/library/bulk/read', { completed: true }, () => tr('Marked read')) },
      { label: many ? tr('Mark unread') : tr('Mark all unread'), disabled: off, onSelect: () => bulk(of, '/api/library/bulk/read', { completed: false }, () => tr('Marked unread')) },
      { label: tr('Download'), divider: true, onSelect: () => {}, children: downloads },
      ...(isAdmin ? [
        { label: tr('Manage'), onSelect: () => {}, children: manage },
        { label: tr('Remove'), danger: true, onSelect: () => {}, children: remove },
      ] : []),
    ].filter((it) => !(builtinList && it.label === tr('Favorite')));
  };

  return { items, element };
}
