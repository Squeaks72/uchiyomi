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
import { MigrateSourceSheet } from './MigrateSourceSheet';
import { useContextMenu } from './ContextMenu';

interface Kept {
  mySource: string | null;
  keepVersions: boolean;
  keeping: boolean;
  coloredSource: string | null;
  /** The colored edition when it is its own title on a source: that source's name and the title. */
  coloredRef?: { source: string; sourceName: string; title: string } | null;
  /** Per chapter number: the sources whose copies are kept beside the endorsed one. */
  held: Record<string, { sourceId: string; pages: number; scanlator?: string | null; stamped?: boolean }[]>;
  /** Chapter numbers whose endorsed file carries a source's stamp (banner, logo). Absent from an older server. */
  stampedEndorsed?: number[];
  /** This account's pick of one chapter's copy, by book id ('@endorsed': the endorsed file). Absent from an older server. */
  picks?: Record<string, string>;
  /** An admin's endorsement of a chapter's copy, by chapter number, where it is not the main source's. */
  endorsements?: Record<string, string>;
  sources: { sourceId: string; name: string; primary: boolean; kept: number }[];
}

export function useKept(id: string, enabled = true) {
  // Refreshed while a pass is running, so the counts climb on screen.
  return useQuery({ queryKey: ['kept', id], queryFn: () => api<Kept>(`/api/series/${encodeURIComponent(id)}/kept`), staleTime: 15_000, enabled: enabled && !!id,
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

export function KeptVersions({ id, title }: { id: string; title?: string }) {
  const [picking, setPicking] = useState(false);
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
            {s.sourceId === '@colored' ? tr('Colored') : s.name}{s.kept > 0 ? <span className="ms-1 text-fog-500">· {s.kept}</span> : null}
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
            {data.sources.filter((s) => s.sourceId !== '@colored').map((s) => (
              <button key={s.sourceId} type="button" disabled={busy} onClick={() => void setColored(s.sourceId)} aria-pressed={data.coloredSource === s.sourceId}
                className={`chip text-xs disabled:opacity-50 ${data.coloredSource === s.sourceId ? 'chip-active' : ''}`}>{s.name}</button>
            ))}
            {/* The edition that is its own title, on any source -- one the series follows included. */}
            <button type="button" disabled={busy} onClick={() => setPicking(true)} aria-pressed={data.coloredSource === '@colored'} data-colored-pick
              className={`chip text-xs disabled:opacity-50 ${data.coloredSource === '@colored' ? 'chip-active' : ''}`}>
              {data.coloredRef ? `${data.coloredRef.title || tr('Colored')} · ${data.coloredRef.sourceName}` : tr('Pick a title from a source…')}
            </button>
          </div>
        </div>
      )}
      {picking && (
        <MigrateSourceSheet id={id} title={title ?? ''} attached={[]} mainId={null} listed={null} colored
          onDone={() => { setPicking(false); void qc.invalidateQueries({ queryKey: key }); }} onClose={() => setPicking(false)} />
      )}
    </section>
  );
}

/**
 * Reading from (2026-11-18), in the series page's chapter toolbar: which source's copies THIS account reads the series from, said on the
 * key itself so the choice is always in view, and changed or undone from its menu (✓ on the current one). Endorsed copies is the default;
 * a source is offered once the server holds copies from it (or it is the current choice), each with how many. Chapters picked one by one
 * (a version row) are counted, and can all be put back. Drawn only when there is a choice to make or to undo.
 */
export function ReadFromPicker({ id, names }: { id: string; names: Record<string, string> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useKept(id);
  const mine = data?.mySource ?? null;
  const picks = Object.keys(data?.picks ?? {}).length;
  const options = (data?.sources ?? []).filter((s) => s.kept > 0 || s.sourceId === mine);
  const nameOf = (sid: string) => options.find((o) => o.sourceId === sid)?.name ?? names[sid] ?? sid;
  const set = async (sid: string | null) => {
    try {
      await api(`/api/series/${encodeURIComponent(id)}/my-source`, { method: 'PUT', json: { sourceId: sid } });
      for (const k of [['kept', id], ['series-books', id]]) void qc.invalidateQueries({ queryKey: k });
      toast(sid ? tr('Reading this series from {source}', { source: nameOf(sid) }) : tr('Reading the endorsed copies'), 'success');
    } catch { toast(tr('Could not save'), 'error'); }
  };
  const clearPicks = async () => {
    try {
      await api(`/api/series/${encodeURIComponent(id)}/my-picks/clear`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['kept', id] });
      toast(tr('Every chapter follows your choice again'), 'success');
    } catch { toast(tr('Could not save'), 'error'); }
  };
  const tick = (on: boolean, label: string) => `${on ? '✓ ' : ' '}${label}`;
  const menu = useContextMenu(() => [
    { label: tick(mine === null, tr('Endorsed copies')), title: tr('The copy this server endorses for each chapter'), onSelect: () => void set(null) },
    ...options.map((o) => ({
      label: tick(mine === o.sourceId, o.kept === 1 ? tr('{source} · 1 chapter here', { source: o.name }) : tr('{source} · {n} chapters here', { source: o.name, n: o.kept })),
      title: tr('Chapters this source has no copy of are read from the endorsed copy'),
      onSelect: () => void set(o.sourceId),
    })),
    ...(picks ? [{ label: picks === 1 ? tr('Put back 1 chapter picked by hand') : tr('Put back {n} chapters picked by hand', { n: picks }), divider: true, onSelect: () => void clearPicks() }] : []),
  ], { label: tr('Reading from') });
  if (!data || (!options.length && !mine && !picks)) return null;
  const current = mine ? nameOf(mine) : tr('Endorsed copies');
  return (
    <>
      <button type="button" onClick={(e) => menu.openFrom(e.currentTarget)} aria-haspopup="menu" aria-expanded={menu.open} data-read-from={mine ?? ''}
        className={`btn-key whitespace-nowrap ${mine || picks ? 'btn-key-accent' : ''}`}>
        <span className="text-fog-400">{tr('Reading from')}:</span> {current}
        {picks > 0 && <span className="text-[11px] opacity-80"> · {picks === 1 ? tr('1 chapter picked') : tr('{n} chapters picked', { n: picks })}</span>}
        <span aria-hidden className="ms-0.5">▾</span>
      </button>
      {menu.element}
    </>
  );
}
