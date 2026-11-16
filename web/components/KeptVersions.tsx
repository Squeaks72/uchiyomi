'use client';
// Every source's copy of a chapter, on a series' Sources sheet (bff lib/bookVersionsRead.ts):
//  - for anyone: "Read from" -- which followed source this account reads the series from. Its reader, OPDS and Mihon are served that
//    source's copy of each chapter where one is kept, and the endorsed copy otherwise. Reading progress is by chapter number, so
//    switching source never makes a chapter unread.
//  - for an admin: the series' switch to keep every followed source's copy (more disk; a pass fetches them in the background).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { useToast } from './Toast';

interface Kept {
  mySource: string | null;
  keepVersions: boolean;
  keeping: boolean;
  coloredSource: string | null;
  sources: { sourceId: string; name: string; primary: boolean; kept: number }[];
}

function useKept(id: string) {
  // Refreshed while a pass is running, so the counts climb on screen.
  return useQuery({ queryKey: ['kept', id], queryFn: () => api<Kept>(`/api/series/${encodeURIComponent(id)}/kept`), staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.keeping ? 8_000 : false) });
}

/**
 * Original or colored, on the series page: shown when an admin has named a colored edition for the series. It is the account's source
 * for the series switched between the original (the endorsed copies) and that source -- so the reader, OPDS and Mihon follow it -- and a
 * chapter with no colored copy yet comes from the original, whichever is chosen.
 */
export function ColorToggle({ id, className = '' }: { id: string; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data } = useKept(id);
  if (!data?.coloredSource) return null;
  const colored = data.mySource === data.coloredSource;
  const set = async (to: boolean) => {
    if (to === colored) return;
    setBusy(true);
    try {
      await api(`/api/series/${encodeURIComponent(id)}/my-source`, { method: 'PUT', json: { sourceId: to ? data.coloredSource : null } });
      for (const k of [['series-books', id], ['series-listing', id], ['kept', id]]) void qc.invalidateQueries({ queryKey: k });
    } catch { toast(tr('Could not save'), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className={className} data-color-toggle>
      <div role="radiogroup" aria-label={tr('Version')} className="inline-flex overflow-hidden rounded-lg border border-ink-700">
        {[{ on: false, label: tr('Original') }, { on: true, label: tr('Colored') }].map((o) => (
          <button key={String(o.on)} type="button" role="radio" aria-checked={colored === o.on} disabled={busy} onClick={() => void set(o.on)}
            className={`px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-50 pointer-coarse:py-2.5 ${colored === o.on ? 'bg-accent text-black' : 'text-fog-300 hover:text-fog-100'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function KeptVersions({ id }: { id: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const key = ['kept', id];
  const { data } = useKept(id);
  if (!data || data.sources.length < 2) return null;

  const choose = async (sourceId: string | null) => {
    setBusy(true);
    try {
      await api(`/api/series/${encodeURIComponent(id)}/my-source`, { method: 'PUT', json: { sourceId } });
      // Pages and chapter lists are per source now: everything cached for this series is asked again.
      for (const k of [['series-books', id], ['series-listing', id], ['kept', id]]) void qc.invalidateQueries({ queryKey: k });
    } catch { toast(tr('Could not save'), 'error'); } finally { setBusy(false); }
  };
  const setKeep = async (on: boolean) => {
    setBusy(true);
    try {
      await api(`/api/admin/series/${encodeURIComponent(id)}/keep-versions`, { method: 'PUT', json: { on } });
      void qc.invalidateQueries({ queryKey: key });
    } catch { toast(tr('Could not save'), 'error'); } finally { setBusy(false); }
  };
  const setColored = async (sourceId: string | null) => {
    setBusy(true);
    try {
      await api(`/api/admin/series/${encodeURIComponent(id)}/colored-source`, { method: 'PUT', json: { sourceId } });
      void qc.invalidateQueries({ queryKey: key });
    } catch { toast(tr('Could not save'), 'error'); } finally { setBusy(false); }
  };
  const total = data.sources.reduce((n, s) => n + s.kept, 0);

  return (
    <section className="mt-5" data-kept-versions>
      <p className="mb-1.5 text-[13px] font-semibold text-fog-300">{tr('Read from')}</p>
      <p className="mb-2 max-w-prose text-[11px] leading-relaxed text-fog-500">
        {tr('Chapters kept from a source are served from it to you, in the reader, OPDS and Mihon. Any other chapter comes from the endorsed copy.')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => void choose(null)} aria-pressed={data.mySource === null}
          className={`chip text-xs disabled:opacity-50 ${data.mySource === null ? 'chip-active' : ''}`}>{tr('Endorsed copy')}</button>
        {data.sources.map((s) => (
          <button key={s.sourceId} type="button" disabled={busy} onClick={() => void choose(s.sourceId)} aria-pressed={data.mySource === s.sourceId}
            className={`chip text-xs disabled:opacity-50 ${data.mySource === s.sourceId ? 'chip-active' : ''}`}>
            {s.name}{s.kept > 0 ? <span className="ms-1 text-fog-500">· {s.kept}</span> : null}
          </button>
        ))}
      </div>
      {isAdmin && (
        <div className="mt-3">
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-fog-500">
            <input type="checkbox" className="mt-0.5 shrink-0 pointer-coarse:size-5 accent-[rgb(var(--accent))]"
              checked={data.keepVersions} disabled={busy} onChange={(e) => void setKeep(e.target.checked)} />
            <span>
              <span className="text-fog-300">{tr('Keep every source’s copy')}</span>
              {' '}{tr('Downloads each followed source’s copy of every chapter beside the endorsed one, so readers can choose their source. Uses more disk.')}
              {data.keepVersions && <span className="mt-1 block text-fog-400">{data.keeping ? tr('Fetching copies…') : total === 1 ? tr('1 copy kept') : tr('{n} copies kept', { n: total })}</span>}
            </span>
          </label>
        </div>
      )}
      {isAdmin && (
        <div className="mt-3" data-colored-source>
          <p className="mb-1.5 text-[13px] font-semibold text-fog-300">{tr('Colored edition')}</p>
          <p className="mb-2 max-w-prose text-[11px] leading-relaxed text-fog-500">
            {tr('The source that carries the colored version. Its copies of every chapter are always downloaded, and readers can switch between the original and the colored one on the series page.')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => void setColored(null)} aria-pressed={!data.coloredSource}
              className={`chip text-xs disabled:opacity-50 ${!data.coloredSource ? 'chip-active' : ''}`}>{tr('None')}</button>
            {data.sources.map((s) => (
              <button key={s.sourceId} type="button" disabled={busy} onClick={() => void setColored(s.sourceId)} aria-pressed={data.coloredSource === s.sourceId}
                className={`chip text-xs disabled:opacity-50 ${data.coloredSource === s.sourceId ? 'chip-active' : ''}`}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
