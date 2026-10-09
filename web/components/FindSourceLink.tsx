'use client';
// Health's "Open · Find a source": the Sources sheet on the search that attaches one, opened right on the Health page
// instead of walking off to the series.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Series } from '@/lib/types';
import { t as tr } from '@/lib/i18n';
import { seriesHref } from '@/lib/healthLinks';
import { SourcesSheet, useSeriesGroups } from '@/components/SourcesSheet';
import { SeriesEditor } from '@/components/SeriesEditor';
import { ConfirmDialog, msgOf } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';

const NONE = { has: () => false };

function Host({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: series } = useQuery({ queryKey: ['series', id], queryFn: () => api<Series>(`/api/series/${id}`) });
  const g = useSeriesGroups(id, true);
  const toSeries = () => router.push(seriesHref(id));
  return (
    <SourcesSheet id={id} title={series?.metadata?.title || series?.name || ''} series={series} groups={g.groups} admin={g.admin}
      error={g.error} isLoading={g.isLoading} haveNumbers={NONE} checkedAt={g.checkedAt} startAttach
      onSaved={() => { for (const k of [['series', id], ['series-books', id], ['series-scanlators', id], ['health'], ['home'], ['library']]) qc.invalidateQueries({ queryKey: k }); }}
      onClose={onClose} onExplain={toSeries} onFindMissing={toSeries} />
  );
}

export function FindSourceLink({ id, className }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={`${tr('Open')}: ${tr('Find a source')}`}>
        {tr('Open')} · {tr('Find a source')}{' '}›
      </button>
      {open && <Host id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditorHost({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: series } = useQuery({ queryKey: ['series', id], queryFn: () => api<Series>(`/api/series/${id}`) });
  if (!series) return null;
  return (
    <SeriesEditor id={id} series={series} tab="details" onClose={onClose}
      onSaved={() => { for (const k of [['series', id], ['health'], ['home'], ['library']]) qc.invalidateQueries({ queryKey: k }); }} />
  );
}

/** Health's "Add details" (a series missing its description or genres: write them by hand) and "Remove" (hide it from the library; no files are deleted). */
export function SeriesRowTools({ id, title, details, className }: { id: string; title: string; details?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/series/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast(tr('Series removed from the library'), 'success');
      setRemoving(false);
      for (const k of [['health'], ['home'], ['library']]) qc.invalidateQueries({ queryKey: k });
    } catch (e) { toast(msgOf(e, tr('Could not remove it')), 'error'); }
    setBusy(false);
  };
  return (
    <>
      {details && <button type="button" className={className} onClick={() => setEditing(true)}>{tr('Add details by hand')}{'\u00a0'}›</button>}
      <button type="button" className={className} onClick={() => setRemoving(true)}>{tr('Remove from library')}{'\u00a0'}›</button>
      {editing && <EditorHost id={id} onClose={() => setEditing(false)} />}
      {removing && (
        <ConfirmDialog title={tr('Remove from library?')} danger twoStep busy={busy} confirmLabel={tr('Remove')}
          body={(
            <>
              <p><strong className="text-fog-100">{tr('No files are deleted.')}</strong>{' '}{tr('The chapters stay exactly where they are on disk, and nothing in your library folder is touched.')}</p>
              <p className="mt-2">{title}</p>
              <p className="mt-2">{tr('Everyone’s reading progress, history, favourites and ratings are kept, so you can put it back at any time from Admin → Library, or just add it again.')}</p>
            </>
          )}
          onConfirm={remove} onClose={() => setRemoving(false)} />
      )}
    </>
  );
}
