'use client';
// Sharing a list as a file: the Export button downloads it, the Import dialog reads one back (into a new list of the
// same name, or into one of yours). Titles travel, not ids, so a list made on one server imports on any other.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Modal } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useCollections } from '@/components/CollectionPicker';

export function useExportList() {
  const toast = useToast();
  return async (id: string, name: string) => {
    try {
      const file = await api<unknown>(`/api/collections/${encodeURIComponent(id)}/export`);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'list'}.uchiyomi-list.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast(tr('Could not export the list'), 'error'); }
  };
}

interface ListFile { format: string; name: string; items: Array<{ sources?: unknown[] | null }> }
interface ToAdd { title: string; sources: Array<{ source: string; sourceId: string }> }

export function ImportListModal({ onClose, onDone }: { onClose: () => void; onDone?: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const { data } = useCollections();
  const lists = data?.content ?? [];
  const [file, setFile] = useState<ListFile | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [autoAdd, setAutoAdd] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const withSources = file?.items.filter((i) => i.sources?.length).length ?? 0;

  const read = async (f: File | undefined) => {
    setBad(false); setFile(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.format !== 'uchiyomi-list' || !Array.isArray(j.items)) throw new Error('format');
      setFile(j);
    } catch { setBad(true); }
  };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api<{ id: string; name: string; added: number; saved: number; toAdd: ToAdd[] }>('/api/collections/import', { json: { list: file, ...(target ? { collectionId: target } : {}) } });
      let started = 0; let failed = 0;
      if (autoAdd && r.toAdd.length) {
        // One title at a time, each from the first of its sources this server can use. The series is in the library
        // the moment the add is answered, so the list picks it up from there.
        setProgress({ done: 0, total: r.toAdd.length });
        for (let i = 0; i < r.toAdd.length; i++) {
          let ok = false;
          for (const s of r.toAdd[i].sources) {
            try { await api('/api/sources/add', { json: { source: s.source, sourceId: s.sourceId } }); ok = true; break; } catch { /* next source */ }
          }
          if (ok) started++; else failed++;
          setProgress({ done: i + 1, total: r.toAdd.length });
        }
      }
      toast(autoAdd
        ? tr('Imported “{name}”: {a} in your library, {s} added and downloading, {f} could not be added', { name: `⁨${r.name}⁩`, a: r.added, s: started, f: failed })
        : tr('Imported “{name}”: {a} in your library, {s} saved for later', { name: `⁨${r.name}⁩`, a: r.added, s: r.saved }), 'success');
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      onDone?.(r.id);
      onClose();
    } catch { toast(tr('Could not import that file'), 'error'); setBusy(false); setProgress(null); }
  };
  return (
    <Modal title={tr('Import a list')} onClose={onClose}>
      <p className="mb-3 text-xs text-fog-500">{tr('Choose a list file someone exported from Uchiyomi. Titles you already have are added to the list; the rest are saved on it to add later.')}</p>
      <input ref={input} type="file" accept=".json,application/json" aria-label={tr('List file')} onChange={(e) => void read(e.target.files?.[0])}
        className="block w-full text-xs text-fog-300 file:me-3 file:rounded-lg file:border file:border-ink-700 file:bg-ink-800 file:px-3 file:py-2 file:text-fog-100" />
      {bad && <p role="alert" className="mt-2 text-xs text-rose-300">{tr('That is not an exported Uchiyomi list.')}</p>}
      {file && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-fog-100">{tr('“{name}” · {n} titles', { name: `⁨${file.name}⁩`, n: file.items.length })}</p>
          <label htmlFor="import-target" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Import into')}</label>
          <select id="import-target" value={target} onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-fog-100">
            <option value="">{tr('A new list named “{name}”', { name: file.name })}</option>
            {lists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {withSources > 0 && (
            <label className="mt-3 flex items-start gap-2 text-sm text-fog-200">
              <input type="checkbox" checked={autoAdd} onChange={(e) => setAutoAdd(e.target.checked)} className="mt-1" />
              <span>{tr('Also add the titles I do not have to my library ({n} can be added from their sources). This downloads every chapter.', { n: withSources })}</span>
            </label>
          )}
        </div>
      )}
      {progress && <p role="status" className="mt-3 text-xs text-fog-300">{tr('Adding {done} of {total}…', progress)}</p>}
      <button type="button" onClick={run} disabled={!file || busy} className="btn-accent mt-4 w-full py-2.5 text-sm disabled:opacity-50">{tr('Import')}</button>
    </Modal>
  );
}
