'use client';
// Remove a library (fork): says up front whether it can be removed and why not, where its series will go, and -- for the ones
// no other library's folders cover, which would fall into the default library -- asks where to file them instead
// (bff routes/admin.ts GET /api/admin/libraries/:id/removal, DELETE ...?moveTo=).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { Modal } from '@/components/ConfirmDialog';

interface Plan {
  name: string;
  blocked: { error: string; message: string } | null;
  total: number;
  byLibrary: Array<{ id: string; name: string; n: number }>;
  unplaced: { n: number; sample: string[] };
}

const KEEP = '__default__';

export function RemoveLibraryDialog({ lib, libs, busy, onConfirm, onClose }: {
  lib: { id: string; name: string };
  /** Every library, to offer as a destination (this one and the private ones are left out). */
  libs: Array<{ id: string; name: string }>;
  busy: boolean;
  /** `moveTo` is the library chosen for the unplaced series, or '' to let them fall into the default library. */
  onConfirm: (moveTo: string) => void;
  onClose: () => void;
}) {
  const plan = useQuery({
    queryKey: ['library-removal', lib.id],
    queryFn: () => api<Plan>(`/api/admin/libraries/${encodeURIComponent(lib.id)}/removal`),
    staleTime: 0, retry: false,
  });
  const [choice, setChoice] = useState('');
  const p = plan.data;
  const unplaced = p?.unplaced.n ?? 0;
  const destinations = libs.filter((l) => l.id !== lib.id);
  // With series that would fall into the default library, the person decides rather than finding them there later.
  const ready = !!p && !p.blocked && (unplaced === 0 || choice !== '');
  const moveTo = choice === KEEP ? '' : choice;
  const others = (p?.byLibrary ?? []).filter((r) => r.id !== 'lib');
  return (
    <Modal title={tr('Remove “{name}”?', { name: lib.name })} onClose={onClose}>
      <div className="space-y-3 text-sm text-fog-300" data-remove-library>
        {plan.isPending && <p role="status" className="text-fog-500">{tr('Checking what removing it would do…')}</p>}
        {plan.isError && <p role="alert" className="text-rose-300">{tr('Could not check what removing it would do. Try again.')}</p>}
        {p?.blocked && (
          <p role="alert" data-remove-blocked className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200">
            <strong className="font-semibold">{tr('It cannot be removed.')}</strong> {p.blocked.message}
          </p>
        )}
        {p && !p.blocked && (
          <>
            <p>{tr('Nothing is deleted and no reading progress changes. Its {n} series move to:', { n: p.total })}</p>
            <ul className="list-disc space-y-0.5 ps-5 text-fog-200">
              {others.map((r) => <li key={r.id}>{tr('{n} to “{name}”, which holds their folder', { n: r.n, name: r.name })}</li>)}
              {unplaced > 0 && <li>{tr('{n} to the default library, because no other library holds their folder', { n: unplaced })}</li>}
              {p.total === 0 && <li>{tr('No series are in it.')}</li>}
            </ul>
            {unplaced > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2" data-remove-unplaced>
                <p className="font-semibold text-amber-200">{tr('{n} series would end up in the default library', { n: unplaced })}</p>
                <p className="mt-1 text-xs text-fog-400">
                  {p.unplaced.sample.join(', ')}{unplaced > p.unplaced.sample.length ? '…' : ''}
                </p>
                <label htmlFor="remove-library-to" className="mb-1 mt-3 block text-xs font-semibold text-fog-300">{tr('Move them to')}</label>
                <select id="remove-library-to" value={choice} onChange={(e) => setChoice(e.target.value)} className="field w-full text-sm" disabled={busy}>
                  <option value="">{tr('Choose a library…')}</option>
                  {destinations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  <option value={KEEP}>{tr('Let them fall into the default library')}</option>
                </select>
                <p className="mt-1 text-[11px] text-fog-500">{tr('They are filed there by hand: no files move, and a rescan keeps them there.')}</p>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-key">{tr('Cancel')}</button>
          <button type="button" disabled={!ready || busy} data-remove-confirm onClick={() => onConfirm(moveTo)}
            className="btn-key border-rose-500/60 text-rose-300 disabled:opacity-50">
            {busy ? tr('Removing…') : tr('Remove library')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
