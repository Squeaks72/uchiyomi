'use client';
// Admin → Health: what sources stamp on their pages (2026-11-18, bff lib/edgeMarks.ts, routes/edgeMarks.ts) -- a banner along the
// bottom naming the site, a logo in a corner. One row per source that does it: how many chapters, examples of the strip as it is in
// the file, and a switch that cuts it off as pages are served (the files are never changed; off restores them). Under it, the series
// where another source's kept copy of a stamped chapter is clean, to endorse instead.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Switch } from './Switch';
import { useToast } from './Toast';
import { actionFailure } from './ConfirmDialog';

interface Example { id: string; bookId: string; seriesId: string | null; title: string | null; number: number | null; version: boolean; marks: { edge: 'top' | 'bottom'; depth: number; width: number }[] }
interface SourceRow { sourceId: string; name: string; checked: number; marked: number; versions: number; edges: ('top' | 'bottom')[]; trim: boolean; examples: Example[] }
interface Report {
  progress: { running: boolean; checked: number; remaining: number | null };
  sources: SourceRow[];
  cleanCopies: { seriesId: string; title: string; chapters: number }[];
}

export function SourceStamps() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, refetch } = useQuery({
    queryKey: ['edge-marks'], queryFn: () => api<Report>('/api/admin/edge-marks'), staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.progress.running ? 15_000 : false),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const p = data?.progress;

  const trim = async (s: SourceRow, on: boolean) => {
    try {
      await api('/api/admin/edge-marks/trim', { method: 'PUT', json: { sourceId: s.sourceId, on } });
      void refetch();
    } catch (e) { toast(actionFailure(e, tr('Could not save')), 'error'); }
  };
  const endorseClean = async (seriesId: string) => {
    setBusy(seriesId);
    try {
      const r = await api<{ started: number }>('/api/admin/edge-marks/endorse-clean', { method: 'POST', json: { seriesId } });
      toast(tr('Endorsing {n} clean copies', { n: r.started }), 'success');
      void qc.invalidateQueries({ queryKey: ['kept'] });
      void refetch();
    } catch (e) { toast(actionFailure(e, tr('Could not endorse')), 'error'); } finally { setBusy(null); }
  };
  const lookNow = async () => {
    try { await api('/api/admin/edge-marks/run', { method: 'POST' }); setTimeout(() => void refetch(), 1500); }
    catch (e) { toast(actionFailure(e, tr('Could not start')), 'error'); }
  };

  return (
    <section className="card full p-4" data-source-stamps>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fog-100">{tr('Source stamps')}</h3>
        <p role="status" className="text-xs text-fog-500">
          {!p ? tr('Counting…')
            : p.running ? tr('Looking at chapters · {n} left', { n: (p.remaining ?? 0).toLocaleString() })
            : p.remaining ? tr('Looked at: {n} · waiting: {m}', { n: p.checked.toLocaleString(), m: p.remaining.toLocaleString() })
            : tr('Chapters looked at: {n}', { n: (p?.checked ?? 0).toLocaleString() })}
          {p && !p.running && !!p.remaining && <button type="button" className="ms-2 text-accent hover:underline" onClick={() => void lookNow()}>{tr('Look now')}</button>}
        </p>
      </div>
      <p className="mt-1 max-w-prose text-xs text-fog-400">
        {tr('Banners and logos a source puts on the edge of every page. Cutting them off happens as pages are shown; the files are not changed, and turning it off brings them back.')}
      </p>

      {data && !data.sources.length && <p className="mt-3 text-sm text-fog-300">{tr('No source stamps its pages, of the chapters looked at so far.')}</p>}
      {!!data?.sources.length && (
        <ul className="mt-3 divide-y divide-ink-800/70" data-source-stamp-list>
          {data.sources.map((s) => (
            <li key={s.sourceId} className="py-2.5" data-source-stamp={s.sourceId}>
              <div className="flex items-center gap-3">
                <button type="button" className="min-w-0 flex-1 text-start" aria-expanded={open === s.sourceId} onClick={() => setOpen(open === s.sourceId ? null : s.sourceId)}>
                  <span dir="auto" className="block truncate text-sm text-fog-100">{s.name}</span>
                  <span className="text-[11px] text-fog-500">
                    {tr('Stamped on {n} of {m}', { n: s.marked.toLocaleString(), m: s.checked.toLocaleString() })}
                    {' · '}{s.edges.map((e) => (e === 'bottom' ? tr('bottom edge') : tr('top edge'))).join(', ')}
                  </span>
                </button>
                <label className="flex shrink-0 items-center gap-2 text-xs text-fog-300">
                  {tr('Cut off')}<Switch on={s.trim} onChange={(on) => void trim(s, on)} label={tr('Cut off {source}’s stamps', { source: `⁨${s.name}⁩` })} />
                </label>
              </div>
              {open === s.sourceId && (
                <div className="mt-2 space-y-2" data-source-stamp-examples>
                  {s.examples.map((e) => (
                    <figure key={e.id} className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/admin/edge-marks/${e.id}/strip`} alt="" loading="lazy" className="block w-full" />
                      <figcaption className="px-2 py-1 text-[11px] text-fog-500">
                        {e.seriesId ? <Link href={`/series/?id=${e.seriesId}`} dir="auto" className="text-fog-300 hover:text-accent">{e.title}</Link> : <span dir="auto">{e.title}</span>}
                        {e.number != null && <> · {tr('Chapter {n}', { n: e.number })}</>}
                        {e.version && <> · {tr('kept copy')}</>}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!!data?.cleanCopies.length && (
        <div className="mt-4" data-clean-copies>
          <p className="text-xs font-semibold text-fog-200">{tr('Clean copies you could endorse')}</p>
          <p className="text-[11px] text-fog-500">{tr('Stamped chapters where another source’s kept copy has no stamp.')}</p>
          <ul className="mt-1 divide-y divide-ink-800/70">
            {data.cleanCopies.map((c) => (
              <li key={c.seriesId} className="flex items-center gap-3 py-2 text-xs">
                <Link href={`/series/?id=${c.seriesId}`} dir="auto" className="min-w-0 flex-1 truncate text-fog-100 hover:text-accent">{c.title}</Link>
                <span className="shrink-0 tabular-nums text-fog-500">{c.chapters === 1 ? tr('1 chapter') : tr('{n} chapters', { n: c.chapters })}</span>
                <button type="button" className="btn-key shrink-0" disabled={busy === c.seriesId} onClick={() => void endorseClean(c.seriesId)}>{tr('Endorse clean copies')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
