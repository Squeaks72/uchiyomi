'use client';
// Add and remove genres on a whole selection (admin). The same tag box the series page and Edit details use.
import { useState } from 'react';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Modal, msgOf } from '@/components/ConfirmDialog';
import { GenreTagInput } from '@/components/GenreTagInput';
import { useToast } from '@/components/Toast';

export function BulkGenresModal({ n, seriesIds, onClose, onDone }: { n: number; seriesIds: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ applied: number }>('/api/admin/series/bulk/genres', { json: { seriesIds, add, remove } });
      toast(r.applied === 1 ? tr('1 series updated') : tr('{n} series updated', { n: r.applied }), 'success');
      onDone();
      onClose();
    } catch (e) { toast(msgOf(e, tr('Could not apply that')), 'error'); setBusy(false); }
  };
  return (
    <Modal title={n === 1 ? tr('Edit genres of 1 series') : tr('Edit genres of {n} series', { n })} onClose={onClose}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Add these genres')}</p>
      <GenreTagInput genres={add} onChange={setAdd} id="bulk-genres-add" />
      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-fog-500">{tr('Remove these genres')}</p>
      <GenreTagInput genres={remove} onChange={setRemove} id="bulk-genres-remove" />
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="btn-ghost flex-1 py-2 text-sm">{tr('Cancel')}</button>
        <button onClick={save} disabled={busy || (!add.length && !remove.length)} className="btn-accent flex-1 py-2 text-sm disabled:opacity-40">
          {busy ? tr('Working…') : tr('Apply')}
        </button>
      </div>
    </Modal>
  );
}
