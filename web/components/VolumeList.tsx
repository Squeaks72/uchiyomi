'use client';
// The series page's Volumes view (fork, lib/volumes.ts): the chapters as the volumes -- or the arcs -- that collect
// them, for a reader who waits for a whole volume and then binges it. Each volume says how much of it is here and how
// much is read, opens on its next unread chapter, and unfolds into its chapters.
//
// "Wait for whole volumes" is this account's switch for this series: on, it hears when a volume or arc is complete (a
// push, and any notification target that asked for it) and nothing about single chapters of it.
//
// Admins can read the list again from Wikipedia, or write their own volumes and arcs, one per line.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { chapterLabel, chapterName, relativeTime } from '@/lib/format';
import { groupByUnits, spanText, type SeriesVolumes, type UnitView } from '@/lib/volumes';
import type { Book } from '@/lib/types';
import { useToast } from '@/components/Toast';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { Switch } from '@/components/Switch';
import { Segmented } from '@/components/settings';
import { IcBell, IcCheck, IcChevronRight, IcPencil, IcPlay, IcRefresh } from '@/components/icons';

export const volumesQuery = (id: string) => ({
  queryKey: ['series-volumes', id],
  queryFn: () => api<SeriesVolumes>(`/api/series/${encodeURIComponent(id)}/volumes`),
  staleTime: 5 * 60_000,
});

function sourceLine(v: SeriesVolumes): string {
  const when = v.checkedAt ? ` · ${tr('checked {when}', { when: relativeTime(v.checkedAt) })}` : '';
  switch (v.source) {
    case 'wikipedia': return `${tr('Volumes from Wikipedia')}${v.page ? ` — ${v.page}` : ''}${when}`;
    case 'names': return `${tr('Volumes from the chapter names')}${when}`;
    case 'manual': return tr('Volumes set by an admin');
    default: return v.checkedAt ? `${tr('No volume list found for this series')}${when}` : tr('The volume list has not been looked for yet');
  }
}

export function VolumeList({ seriesId, books, isAdmin, onRead, onMarkRead }: {
  seriesId: string;
  books: readonly Book[];
  isAdmin: boolean;
  onRead: (b: Book) => void;
  onMarkRead: (books: Book[]) => Promise<void>;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ ...volumesQuery(seriesId), enabled: !!seriesId });
  const [mode, setMode] = useState<'volume' | 'arc'>('volume');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const units = mode === 'arc' ? data?.arcs ?? [] : data?.volumes ?? [];
  const groups = useMemo(() => groupByUnits(units, books), [units, books]);
  const set = (v: SeriesVolumes) => qc.setQueryData(['series-volumes', seriesId], v);

  const wait = async (on: boolean) => {
    try {
      await api(`/api/series/${encodeURIComponent(seriesId)}/volumes/wait`, { method: 'PUT', json: { on } });
      if (data) set({ ...data, waiting: on });
      toast(on ? tr('You will hear when a whole volume is here') : tr('You will hear about each new chapter again'), 'success');
    } catch (e) { toast(msgOf(e, tr('Could not save')), 'error'); }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const v = await api<SeriesVolumes>(`/api/series/${encodeURIComponent(seriesId)}/volumes/refresh`, { method: 'POST' });
      set(v);
      toast(!v.volumes.length ? tr('No volume list found for this series') : v.volumes.length === 1 ? tr('1 volume found') : tr('{n} volumes found', { n: v.volumes.length }), v.volumes.length ? 'success' : 'info');
    } catch (e) { toast(msgOf(e, tr('Could not read the volume list')), 'error'); }
    setBusy(false);
  };

  if (!data) return <div className="skeleton my-3 h-24 rounded" />;
  const keyOf = (g: UnitView<Book>) => (g.unit ? `${g.unit.kind}:${g.unit.label}` : g.group);
  const toggle = (k: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div data-volume-list>
      <div className="mb-3 rounded-xl border border-ink-800 bg-ink-900/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <IcBell width={16} height={16} aria-hidden className="shrink-0 text-fog-400" />
          <div className="min-w-0 flex-1 basis-48">
            <p id={`wait-${seriesId}`} className="text-sm text-fog-100">{tr('Wait for whole volumes')}</p>
            <p className="text-[11px] leading-relaxed text-fog-500">
              {tr('Tell me when a whole volume or arc is here, instead of every new chapter.')}
            </p>
          </div>
          <Switch on={data.waiting} onChange={(on) => { void wait(on); }} label={tr('Wait for whole volumes')} />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {data.arcs.length > 0 && (
          <Segmented label={tr('Group by')} value={mode} onChange={(m) => setMode(m)}
            options={[{ value: 'volume', label: tr('Volumes') }, { value: 'arc', label: tr('Arcs') }]} />
        )}
        <p className="me-auto text-[11px] text-fog-500">{sourceLine(data)}</p>
        {isAdmin && (
          <>
            <button type="button" onClick={refresh} disabled={busy} className="btn-key disabled:opacity-50">
              <IcRefresh width={14} height={14} />{busy ? tr('Looking…') : tr('Look again')}
            </button>
            <button type="button" onClick={() => setEditing(true)} className="btn-key">
              <IcPencil width={14} height={14} />{tr('Edit volumes')}
            </button>
          </>
        )}
      </div>

      {!units.length ? (
        <p className="max-w-prose py-3 text-sm text-fog-500">
          {mode === 'arc' ? tr('No arcs are set for this series.') : tr('No volumes are known for this series yet.')}
          {isAdmin ? ` ${tr('Use Edit volumes to write them yourself.')}` : ''}
        </p>
      ) : (
        <ul className="divide-y divide-ink-800/70 border-y border-ink-800/70">
          {groups.map((g) => {
            const k = keyOf(g);
            const expanded = open.has(k);
            const title = g.unit ? (g.unit.kind === 'volume' ? tr('Volume {n}', { n: g.unit.label }) : g.unit.label)
              : g.group === 'tail' ? tr('Not in a volume yet') : tr('Other chapters');
            const span = spanText(g.need);
            const allRead = g.books.length > 0 && g.read === g.books.length;
            return (
              <li key={k} data-unit={k} data-complete={g.complete || undefined}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                  <button type="button" onClick={() => toggle(k)} aria-expanded={expanded}
                    className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-start">
                    <IcChevronRight width={14} height={14} aria-hidden className={`shrink-0 text-fog-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fog-100">{title}</span>
                      <span className="block text-[11px] text-fog-500">
                        {[
                          span ? tr('Ch. {span}', { span }) : null,
                          g.unit?.released ? tr('released {date}', { date: g.unit.released }) : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  <span className="flex items-center gap-2 text-[11px]">
                    {g.group !== 'unit' ? (
                      <span className="text-fog-500">{g.books.length === 1 ? tr('1 chapter') : tr('{n} chapters', { n: g.books.length })}</span>
                    ) : g.complete ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-300"><IcCheck width={12} height={12} aria-hidden />{tr('All here')}</span>
                    ) : (
                      <span className={g.have ? 'text-amber-300' : 'text-fog-500'}>{tr('{n} of {m} here', { n: g.have, m: g.need.length })}</span>
                    )}
                    {g.books.length > 0 && (
                      <span className={allRead ? 'text-fog-500' : 'text-fog-400'}>{allRead ? tr('Read') : tr('{n} read', { n: g.read })}</span>
                    )}
                  </span>
                  {g.next && (
                    <button type="button" onClick={() => onRead(g.next!)} className={`btn-key ${g.complete && !allRead ? 'btn-key-accent' : ''}`}>
                      <IcPlay width={12} height={12} />{allRead ? tr('Read again') : g.read ? tr('Continue') : tr('Read')}
                    </button>
                  )}
                </div>
                {expanded && (
                  <div className="pb-3 ps-6">
                    {g.books.length > 0 && !allRead && (
                      <button type="button" className="chip mb-2 px-2.5 py-1 text-[11px]"
                        onClick={() => { void onMarkRead(g.books.filter((b) => !b.readProgress?.completed)); }}>
                        {tr('Mark these read')}
                      </button>
                    )}
                    <ol className="space-y-0.5">
                      {rowsOf(g).map((r) => r.book ? (
                        <li key={r.book.id}>
                          <button type="button" onClick={() => onRead(r.book!)} disabled={r.book.pruned}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-start text-sm hover:bg-ink-800/60 disabled:opacity-50">
                            <span className={`truncate ${r.book.readProgress?.completed ? 'text-fog-500' : 'text-fog-100'}`}>
                              {chapterLabel(r.book)}{chapterName(r.book) ? ` · ${chapterName(r.book)}` : ''}
                            </span>
                            {r.book.readProgress?.completed && <IcCheck width={12} height={12} aria-label={tr('Read')} className="ms-auto shrink-0 text-fog-500" />}
                          </button>
                        </li>
                      ) : (
                        <li key={`m${r.number}`} className="px-1.5 py-1 text-sm text-fog-600">{tr('Ch. {n} — not here yet', { n: r.number })}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <EditVolumes seriesId={seriesId} data={data} onClose={() => setEditing(false)} onSaved={(v) => { set(v); setEditing(false); }} />}
    </div>
  );
}

/** A unit's rows in order: the chapters here, and a line for each whole chapter it names that is not. */
function rowsOf(g: UnitView<Book>): Array<{ book?: Book; number: number }> {
  const here = new Set<number>();
  for (const b of g.books) {
    here.add(b.number);
    const end = b.numberEnd != null && b.numberEnd > b.number ? b.numberEnd : b.number;
    for (let n = Math.floor(b.number) + 1; n <= Math.floor(end); n++) here.add(n);
  }
  const rows: Array<{ book?: Book; number: number }> = g.books.map((b) => ({ book: b, number: b.number }));
  for (const n of g.need) if (!here.has(n)) rows.push({ number: n });
  return rows.sort((a, b) => a.number - b.number);
}

/** The admin's own volumes and arcs, one per line. Starts from what is shown now; empty clears it. */
function EditVolumes({ seriesId, data, onClose, onSaved }: { seriesId: string; data: SeriesVolumes; onClose: () => void; onSaved: (v: SeriesVolumes) => void }) {
  const toast = useToast();
  const start = data.manual ?? [
    ...data.volumes.map((u) => `Volume ${u.label}: ${ranges(u.chapters)}`),
    ...data.arcs.map((u) => `Arc ${u.label}: ${ranges(u.chapters)}`),
  ].join('\n');
  const [text, setText] = useState(start);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    // Saving the automatic list unchanged would freeze it: the next volume Wikipedia adds would never arrive.
    if (value !== null && !data.manual && value.trim() === start.trim()) { onClose(); return; }
    setBusy(true);
    setError('');
    try {
      const v = await api<SeriesVolumes>(`/api/series/${encodeURIComponent(seriesId)}/volumes/manual`, { method: 'PUT', json: { text: value } });
      toast(value ? tr('Saved') : tr('Back to the automatic volumes'), 'success');
      onSaved(v);
    } catch (e) { setError(msgOf(e, tr('Could not save'))); }
    setBusy(false);
  };
  return (
    <Modal title={tr('Edit volumes')} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="max-w-prose text-[11px] leading-relaxed text-fog-500">
          {tr('One per line: “Volume 3: 17-25” or “Arc Water 7: 322-430”. Ranges can be listed with commas: “8-15, 15.5”. Volumes written here replace the automatic ones; arcs can only be written here.')}
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} spellCheck={false}
          className="field font-mono text-xs" dir="ltr" placeholder={tr('Volume 1: 1-7')} />
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2 text-sm">{tr('Cancel')}</button>
          {data.manual && (
            <button type="button" onClick={() => save(null)} disabled={busy} className="btn-ghost flex-1 py-2 text-sm disabled:opacity-40">{tr('Use the automatic volumes')}</button>
          )}
          <button type="button" onClick={() => save(text.trim() ? text : null)} disabled={busy} className="btn-accent flex-1 py-2 text-sm font-semibold disabled:opacity-40">
            {busy ? tr('Working…') : tr('Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ranges(chapters: readonly number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < chapters.length) {
    let j = i;
    while (j + 1 < chapters.length && Number.isInteger(chapters[j]) && chapters[j + 1] === chapters[j] + 1) j++;
    out.push(j > i ? `${chapters[i]}-${chapters[j]}` : String(chapters[i]));
    i = j + 1;
  }
  return out.join(', ');
}
