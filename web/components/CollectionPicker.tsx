'use client';
// Choosing one of your lists (or making one) for a set of series: the Library's bulk "Add to list", and the
// "Added to your library" window's list choice both use it.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Modal } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';

export interface CollectionRow { id: string; name: string; accent: string | null; item_count: number }

export const useCollections = () =>
  useQuery({ queryKey: ['collections'], queryFn: () => api<{ content: CollectionRow[] }>('/api/collections') });

/** Add `seriesIds` to a list, creating it first when `newName` is given. Resolves to the list's name. */
export async function addToList(seriesIds: string[], pick: { id: string } | { newName: string }): Promise<string> {
  const c = 'id' in pick ? null : await api<CollectionRow>('/api/collections', { json: { name: pick.newName.trim() } });
  const id = 'id' in pick ? pick.id : c!.id;
  await api(`/api/collections/${id}/items/bulk`, { json: { seriesIds } });
  return c?.name ?? '';
}

const fld = 'w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-fog-100 outline-hidden focus-visible:outline-accent focus-visible:outline-offset-0 transition focus:border-accent/60';

export function CollectionPickerModal({ seriesIds, onClose, onDone }: { seriesIds: string[]; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useCollections();
  const lists = data?.content ?? [];
  const run = async (pick: { id: string } | { newName: string }, label: string) => {
    setBusy(true);
    try {
      await addToList(seriesIds, pick);
      toast(tr('Added to “{name}”', { name: `⁨${label}⁩` }), 'success');
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection'] });
      onDone?.();
      onClose();
    } catch { toast(tr('Could not do that'), 'error'); setBusy(false); }
  };
  const create = () => { const n = name.trim(); if (n) void run({ newName: n }, n); };
  return (
    <Modal title={seriesIds.length === 1 ? tr('Add to collection') : tr('Add {n} series to a collection', { n: seriesIds.length })} onClose={onClose}>
      {isLoading ? (
        <div role="status" className="skeleton h-24 rounded-xl"><span className="sr-only">{tr('Loading…')}</span></div>
      ) : (
        <ul data-lenis-prevent className="max-h-64 space-y-1.5 overflow-y-auto">
          {lists.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={busy} onClick={() => run({ id: c.id }, c.name)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-ink-700 px-3 py-2.5 text-start transition hover:border-accent/50 disabled:opacity-50">
                <span aria-hidden className="h-4 w-1.5 shrink-0 rounded-full" style={{ background: c.accent || 'rgb(var(--accent))' }} />
                <span className="min-w-0 truncate text-sm text-fog-100">{c.name}</span>
                <span className="ms-auto shrink-0 text-[11px] text-fog-500">{c.item_count}</span>
              </button>
            </li>
          ))}
          {!lists.length && <li className="py-2 text-center text-xs text-fog-500">{tr('No collections yet — create one below.')}</li>}
        </ul>
      )}
      <div className="mt-3 flex gap-2 border-t border-ink-800 pt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
          aria-label={tr('New collection…')} placeholder={tr('New collection…')} className={`${fld} flex-1`} />
        <button type="button" onClick={create} disabled={!name.trim() || busy} className="btn-accent px-3 text-xs disabled:opacity-50">{tr('Create')}</button>
      </div>
    </Modal>
  );
}

/** A compact choice for the add window: no list, one of yours, or a new one made on the spot. */
export type ListChoice = { id: string } | null;

export function ListChoiceField({ value, onChange }: { value: ListChoice; onChange: (v: ListChoice) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useCollections();
  const lists = data?.content ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const make = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const c = await api<CollectionRow>('/api/collections', { json: { name: n } });
      await qc.invalidateQueries({ queryKey: ['collections'] });
      setCreating(false); setName('');
      onChange({ id: c.id });
    } catch { toast(tr('Could not do that'), 'error'); }
  };
  return (
    <div className="text-start">
      <label htmlFor="add-to-list" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Also add to a list')}</label>
      <select id="add-to-list" value={creating ? '__new' : value?.id ?? ''} className={fld}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') { setCreating(true); onChange(null); } else { setCreating(false); onChange(v ? { id: v } : null); }
        }}>
        <option value="">{tr('No list')}</option>
        {lists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="__new">{tr('New list…')}</option>
      </select>
      {creating && (
        <div className="mt-2 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && make()}
            placeholder={tr('New collection…')} aria-label={tr('New collection…')} className={`${fld} flex-1`} />
          <button type="button" onClick={make} disabled={!name.trim()} className="btn-accent px-3 text-xs disabled:opacity-50">{tr('Create')}</button>
        </div>
      )}
    </div>
  );
}
