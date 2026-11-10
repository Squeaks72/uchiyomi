'use client';
// Admin → Library → Unmapped files (bff lib/unmapped.ts): files in the downloads folder that the library does not hold.
// Chapter archives can be mapped to an existing or a new series (their number guessed from the name, corrected here);
// anything can be deleted, which moves it to a bin that empties itself after the time limit set under Settings.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { bytes, relativeTime } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import { useToast } from '@/components/Toast';
import { ConfirmDialog, Modal, msgOf } from '@/components/ConfirmDialog';

interface UFile { path: string; name: string; size: number; mtime: number; kind: 'archive' | 'other'; guess: number | null }
interface UGroup { folder: string; files: UFile[]; suggest?: { id: string; title: string; folder: string } }
interface Binned { id: string; orig: string; size: number; deleted_at: string; expires_at: string }
interface Listing {
  groups: UGroup[]; files: number; archives: number; bytes: number; truncated: boolean;
  bin: { days: number; rows: Binned[]; bytes: number };
}
interface Item { path: string; ok: boolean; reason?: string }
interface Found { id: string; title: string; folder: string }

const KEY = ['admin-unmapped'];

/** The folder a new series would get when none is typed: mirrors the server (routes/unmapped.ts folderNameOf). */
const folderOf = (title: string) => `Imported/${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')}`;

export function UnmappedFiles() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api<Listing>('/api/admin/unmapped') });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = data?.groups ?? [];
  const all = groups.flatMap((g) => g.files);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const chosen = [...picked].map((p) => byPath.get(p)).filter((f): f is UFile => !!f);
  const archives = chosen.filter((f) => f.kind === 'archive');
  const numberOf = (f: UFile) => numbers[f.path] ?? (f.guess == null ? '' : String(f.guess));

  const toggle = (paths: string[], on: boolean) => setPicked((s) => {
    const n = new Set(s);
    for (const p of paths) (on ? n.add(p) : n.delete(p));
    return n;
  });
  const refresh = () => { setPicked(new Set()); return qc.invalidateQueries({ queryKey: KEY }); };

  const report = (what: string, results: Item[]) => {
    const bad = results.filter((r) => !r.ok);
    const ok = results.length - bad.length;
    if (!bad.length) { toast(tr('{what}: {n} done', { what, n: ok }), 'success'); return; }
    toast(`${tr('Refused: {n}', { n: bad.length })}: ${bad.slice(0, 3).map((r) => `${r.path.split('/').pop()} – ${r.reason}`).join(' · ')}`, ok ? 'info' : 'error');
  };

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { toast(msgOf(e, fail), 'error'); }
    setBusy(false);
  };

  const del = () => run(async () => {
    const r = await api<{ results: Item[] }>('/api/admin/unmapped/delete', { method: 'POST', json: { paths: chosen.map((f) => f.path) } });
    report(tr('Deleted'), r.results);
    setDeleting(false);
    await refresh();
  }, tr('Could not delete the files'));

  const restore = (ids: string[]) => run(async () => {
    const r = await api<{ results: Item[] }>('/api/admin/unmapped/restore', { method: 'POST', json: { ids } });
    report(tr('Restored'), r.results);
    await refresh();
  }, tr('Could not put the files back'));

  const empty = () => run(async () => {
    await api('/api/admin/unmapped/purge', { method: 'POST', json: {} });
    setEmptying(false);
    await refresh();
  }, tr('Could not empty the bin'));

  const suggestion = (() => {
    const folders = new Set(chosen.map((f) => f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')))));
    return folders.size === 1 ? groups.find((g) => g.folder === [...folders][0])?.suggest : undefined;
  })();

  return (
    <div className="full space-y-3" id="unmapped-files">
      <div className="px-1">
        <h3 className="text-[13px] font-semibold text-fog-300">{tr('Unmapped files')}</h3>
        <p className="mt-0.5 max-w-prose text-xs text-fog-500">
          {tr('Files in the downloads folder that are not part of the library. Map chapter archives to a series, or delete what you do not want. Deleted files wait in a bin before they are removed for good.')}
        </p>
      </div>

      {isLoading ? (
        <div role="status" className="card grad-border p-4 text-sm text-fog-500">{tr('Loading…')}</div>
      ) : !groups.length ? (
        <div className="card grad-border p-5 text-center text-sm text-fog-500">{tr('Every file in the downloads folder is in the library.')}</div>
      ) : (
        <>
          <p className="px-1 text-xs text-fog-400">
            {tr('Files: {n} · {size}', { n: data!.files, size: bytes(data!.bytes) })}
            {data!.truncated ? ` · ${tr('only the first part of a very large folder was looked at')}` : ''}
          </p>
          <div className="card grad-border divide-y divide-ink-800/70 overflow-hidden">
            {groups.map((g) => {
              const paths = g.files.map((f) => f.path);
              const allOn = paths.every((p) => picked.has(p));
              return (
                <section key={g.folder || '/'} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={allOn} aria-label={tr('Select all in this folder')} onChange={(e) => toggle(paths, e.target.checked)} />
                    <p className="min-w-0 flex-1 truncate text-sm text-fog-100" dir="ltr" title={g.folder}>{g.folder || tr('(downloads folder itself)')}</p>
                    {g.suggest && <span className="chip shrink-0 text-[11px]">{tr('Looks like {title}', { title: g.suggest.title })}</span>}
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {g.files.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={picked.has(f.path)} aria-label={f.name} onChange={(e) => toggle([f.path], e.target.checked)} />
                        <span className="min-w-0 flex-1 truncate text-fog-200" dir="ltr" title={f.name}>{f.name}</span>
                        <span className="shrink-0 text-fog-500">{f.kind === 'archive' ? bytes(f.size) : `${bytes(f.size)} · ${tr('other file')}`}</span>
                        {f.kind === 'archive' && (
                          <label className="flex shrink-0 items-center gap-1 text-fog-500">
                            {tr('Ch.')}
                            <input inputMode="decimal" value={numberOf(f)} onChange={(e) => setNumbers((n) => ({ ...n, [f.path]: e.target.value }))}
                              aria-label={tr('Chapter number')} placeholder="?" className="w-14 rounded border border-ink-700 bg-transparent px-1.5 py-0.5 text-right text-fog-100" />
                          </label>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <button className="chip text-xs disabled:opacity-50" disabled={!archives.length || busy} onClick={() => setMapping(true)}>
              {tr('Map to a series ({n})', { n: archives.length })}
            </button>
            <button className="chip text-xs hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50" disabled={!chosen.length || busy} onClick={() => setDeleting(true)}>
              {tr('Delete ({n})', { n: chosen.length })}
            </button>
            <button className="chip text-xs" onClick={() => toggle(paths(all), picked.size < all.length)}>
              {picked.size < all.length ? tr('Select all') : tr('Select none')}
            </button>
          </div>
        </>
      )}

      {!!data?.bin.rows.length && (
        <details className="card grad-border p-4">
          <summary className="cursor-pointer text-sm text-fog-200">
            {tr('Recently deleted ({n}) · {size}', { n: data.bin.rows.length, size: bytes(data.bin.bytes) })}
          </summary>
          <p className="mt-2 text-xs text-fog-500">{tr('Kept for {days} days, then removed for good. Change this under Settings → Maintenance.', { days: data.bin.days })}</p>
          <ul className="mt-2 space-y-1.5">
            {data.bin.rows.slice(0, 200).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fog-300" dir="ltr" title={r.orig}>{r.orig}</span>
                <span className="shrink-0 text-fog-500">{tr('goes {when}', { when: relativeTime(r.expires_at) })}</span>
                <button className="chip shrink-0 text-xs disabled:opacity-50" disabled={busy} onClick={() => restore([r.id])}>{tr('Put back')}</button>
              </li>
            ))}
          </ul>
          <button className="chip mt-3 text-xs hover:border-rose-500/50 hover:text-rose-400" disabled={busy} onClick={() => setEmptying(true)}>{tr('Empty the bin now')}</button>
        </details>
      )}

      {mapping && (
        <MapDialog files={archives} numberOf={numberOf} setNumber={(p, v) => setNumbers((n) => ({ ...n, [p]: v }))}
          suggest={suggestion} onClose={() => setMapping(false)}
          onDone={async (results) => { report(tr('Mapped'), results); setMapping(false); await refresh(); }} />
      )}
      {deleting && (
        <ConfirmDialog
          title={chosen.length === 1 ? tr('Delete this file?') : tr('Delete the selected files?')}
          body={<p>{tr('They move to the bin and are removed for good after {days} days. Until then you can put them back.', { days: data?.bin.days ?? 14 })}</p>}
          confirmLabel={tr('Delete')} danger busy={busy} onConfirm={del} onClose={() => setDeleting(false)} />
      )}
      {emptying && (
        <ConfirmDialog title={tr('Empty the bin now?')} body={<p>{tr('Everything in the bin is removed for good. This cannot be undone.')}</p>}
          confirmLabel={tr('Empty the bin')} danger busy={busy} onConfirm={empty} onClose={() => setEmptying(false)} />
      )}
    </div>
  );
}

const paths = (fs: UFile[]) => fs.map((f) => f.path);

function MapDialog({ files, numberOf, setNumber, suggest, onClose, onDone }: {
  files: UFile[]; numberOf: (f: UFile) => string; setNumber: (path: string, v: string) => void;
  suggest?: Found; onClose: () => void; onDone: (r: Item[]) => Promise<void>;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [term, setTerm] = useState(suggest?.title ?? '');
  const [target, setTarget] = useState<Found | null>(suggest ?? null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: found } = useQuery({
    queryKey: ['admin-unmapped-series', term], enabled: mode === 'existing' && term.trim().length > 0,
    queryFn: () => api<{ content: Found[] }>(`/api/admin/unmapped/series?q=${encodeURIComponent(term.trim())}`),
  });
  const nums = files.map((f) => Number(numberOf(f)));
  const missing = files.some((f, i) => numberOf(f).trim() === '' || !Number.isFinite(nums[i]));
  const dupes = new Set(nums).size !== nums.length;
  const ready = !missing && !dupes && (mode === 'existing' ? !!target : !!title.trim());

  const go = async () => {
    setBusy(true);
    try {
      const r = await api<{ results: Item[] }>('/api/admin/unmapped/map', {
        method: 'POST',
        json: {
          ...(mode === 'existing' ? { seriesId: target!.id } : { newSeries: { title: title.trim() } }),
          items: files.map((f, i) => ({ path: f.path, number: nums[i] })),
        },
      });
      await onDone(r.results);
    } catch (e: any) {
      let msg = msgOf(e, tr('Could not map the files'));
      try { const b = JSON.parse(e?.body || '{}'); if (b.message) msg = b.message; } catch {}
      toast(msg, 'error');
    }
    setBusy(false);
  };

  return (
    <Modal title={tr('Map to a series')} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="flex gap-2">
          <button className={`chip text-xs ${mode === 'existing' ? 'border-violet-500/60 text-violet-300' : ''}`} onClick={() => setMode('existing')}>{tr('Existing series')}</button>
          <button className={`chip text-xs ${mode === 'new' ? 'border-violet-500/60 text-violet-300' : ''}`} onClick={() => setMode('new')}>{tr('New series')}</button>
        </div>
        {mode === 'existing' ? (
          <div>
            <input value={term} onChange={(e) => { setTerm(e.target.value); setTarget(null); }} placeholder={tr('Search your library')}
              className="w-full rounded border border-ink-700 bg-transparent px-2 py-1.5 text-fog-100" />
            <ul data-lenis-prevent className="mt-1 max-h-40 space-y-0.5 overflow-auto">
              {(target && !found?.content.some((s) => s.id === target.id) ? [target] : []).concat(found?.content ?? []).map((s) => (
                <li key={s.id}>
                  <button className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-ink-800 ${target?.id === s.id ? 'bg-ink-800 text-violet-300' : 'text-fog-200'}`} onClick={() => setTarget(s)}>
                    {s.title} <span className="text-fog-500" dir="ltr">· {s.folder}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('Title of the new series')}
              className="w-full rounded border border-ink-700 bg-transparent px-2 py-1.5 text-fog-100" />
            {title.trim() && <p className="mt-1 text-xs text-fog-500">{tr('Folder')}: <span dir="ltr">{folderOf(title)}</span></p>}
          </div>
        )}
        <ul data-lenis-prevent className="max-h-52 space-y-1 overflow-auto border-t border-ink-800 pt-2">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-fog-300" dir="ltr" title={f.path}>{f.name}</span>
              <label className="flex shrink-0 items-center gap-1 text-fog-500">
                {tr('Ch.')}
                <input inputMode="decimal" value={numberOf(f)} onChange={(e) => setNumber(f.path, e.target.value)} aria-label={tr('Chapter number')}
                  className="w-16 rounded border border-ink-700 bg-transparent px-1.5 py-0.5 text-right text-fog-100" />
              </label>
            </li>
          ))}
        </ul>
        {missing && <p className="text-xs text-amber-300">{tr('Every file needs a chapter number.')}</p>}
        {!missing && dupes && <p className="text-xs text-amber-300">{tr('Two files have the same chapter number.')}</p>}
        <div className="flex justify-end gap-2">
          <button className="chip text-xs" onClick={onClose}>{tr('Cancel')}</button>
          <button className="chip border-violet-500/60 text-xs text-violet-300 disabled:opacity-50" disabled={!ready || busy} onClick={go}>
            {busy ? tr('Mapping…') : tr('Map')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
