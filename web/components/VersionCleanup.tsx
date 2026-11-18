'use client';
// Admin → Settings → Disk space: the unendorsed copies kept beside chapters (bff lib/bookVersionsRead.ts, routes/versions.ts), server-wide.
// Lists how many each series holds and their size, and deletes them -- all of them, or one series' -- sparing the colored edition and
// the copies somebody reads unless told otherwise. The endorsed file is never touched. A cleaned series stops keeping every copy, or
// the version keeper would fetch them all again.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { bytes } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import { ConfirmDialog, actionFailure } from './ConfirmDialog';
import { Row } from './settings';
import { Switch } from './Switch';
import { useToast } from './Toast';

interface Summary {
  copies: number;
  bytes: number;
  content: { id: string; title: string; copies: number; bytes: number; colored: number; picked: number; keepVersions: boolean }[];
}

export function VersionCleanupRow() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['versions-summary'], queryFn: () => api<Summary>('/api/admin/versions/summary'), staleTime: 30_000 });
  const [keepColored, setKeepColored] = useState(true);
  const [keepPicked, setKeepPicked] = useState(true);
  const [asking, setAsking] = useState<{ ids: string[] | null; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const rows = data?.content ?? [];

  const run = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      const r = await api<{ deleted: number; bytes: number; series: number }>('/api/admin/versions/cleanup', {
        method: 'POST', json: { ...(asking.ids ? { seriesIds: asking.ids } : {}), keepColored, keepPicked },
      });
      toast(r.deleted === 1 ? tr('Deleted 1 copy, freeing {size}', { size: bytes(r.bytes) }) : tr('Deleted {n} copies, freeing {size}', { n: r.deleted.toLocaleString(), size: bytes(r.bytes) }), 'success');
      void refetch();
      void qc.invalidateQueries({ queryKey: ['kept'] });
      setAsking(null);
    } catch (e) { toast(actionFailure(e, tr('Could not delete the copies')), 'error'); } finally { setBusy(false); }
  };

  return (
    <Row id="version-cleanup" label={tr('Kept versions')} stacked keepHelp
      help={tr('Copies of chapters kept beside the endorsed one, from other sources. Deleting them never touches the endorsed file, and a series cleaned here stops keeping every copy.')}>
      <div data-version-cleanup>
        <p className="text-sm text-fog-200">
          {!data ? tr('Counting…') : data.copies === 0 ? tr('No extra copies are kept.')
            : [data.copies === 1 ? tr('1 copy') : tr('{n} copies', { n: data.copies.toLocaleString() }), tr('{n} series', { n: rows.length }), bytes(data.bytes)].join(' · ')}
        </p>
        {data && data.copies > 0 && (
          <>
            <div className="mt-3 space-y-2">
              <label className="flex items-center justify-between gap-3 text-xs text-fog-300">
                {tr('Keep colored editions')}<Switch on={keepColored} onChange={setKeepColored} label={tr('Keep colored editions')} />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs text-fog-300">
                {tr('Keep copies someone reads from')}<Switch on={keepPicked} onChange={setKeepPicked} label={tr('Keep copies someone reads from')} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-key btn-key-danger" data-version-cleanup-all
                onClick={() => setAsking({ ids: null, label: tr('every series') })}>{tr('Delete unendorsed copies')}</button>
              <button type="button" className="btn-key" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? tr('Hide series') : tr('By series')}</button>
            </div>
            {open && (
              <ul className="mt-3 divide-y divide-ink-800/70" data-version-cleanup-series>
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-2 text-xs">
                    <span dir="auto" className="min-w-0 flex-1 truncate text-fog-100">{r.title}</span>
                    <span className="shrink-0 tabular-nums text-fog-500">
                      {r.copies === 1 ? tr('1 copy') : tr('{n} copies', { n: r.copies })} · {bytes(r.bytes)}
                      {r.colored > 0 && ` · ${r.colored === 1 ? tr('1 colored copy') : tr('{n} colored copies', { n: r.colored })}`}
                    </span>
                    <button type="button" className="btn-key shrink-0" onClick={() => setAsking({ ids: [r.id], label: r.title })}>{tr('Delete')}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {asking && (
        <ConfirmDialog title={tr('Delete unendorsed copies?')} danger busy={busy} confirmLabel={tr('Delete')}
          body={<p>{tr('The extra copies in {what} are deleted from the server. Endorsed chapters stay, and so does everyone’s progress. {spared}', {
            what: asking.label,
            spared: [keepColored ? tr('Colored editions are kept.') : '', keepPicked ? tr('Copies someone reads from are kept.') : ''].filter(Boolean).join(' '),
          })}</p>}
          onConfirm={run} onClose={() => setAsking(null)} />
      )}
    </Row>
  );
}
