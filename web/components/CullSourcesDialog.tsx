'use client';
import { useMemo, useState } from 'react';
import { Modal } from '@/components/ConfirmDialog';
import { cullPlan, foreignSources, type CullBook, type CullPlan } from '@/lib/cullPlan';
import { skippedNotOursText } from '@/lib/counted';
import { t as tr } from '@/lib/i18n';
import type { VersionCopy } from '@/lib/types';

/**
 * "Remove chapters from other sources": for a series whose files came partly from a source that is not its main one
 * (a wrong migration, a follow that turned out to be another work). Shows which sources hold chapters here, lets the
 * admin leave any of them out, and says exactly what will happen before it does -- the plan is lib/cullPlan.ts's.
 */
export function CullSourcesDialog({ books, primary, sourceNames, mainCopy, busy, onApply, onClose }: {
  books: readonly CullBook[];
  primary: string;
  sourceNames: Record<string, string>;
  mainCopy: (number: number) => VersionCopy | undefined;
  busy: boolean;
  onApply: (plan: CullPlan) => void;
  onClose: () => void;
}) {
  const foreign = useMemo(() => foreignSources(books, primary), [books, primary]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(foreign.map((f) => f.id)));
  const [swap, setSwap] = useState(true);
  const plan = useMemo(() => cullPlan({ books, primary, sources: picked, swap, mainCopy }), [books, primary, picked, swap, mainCopy]);
  const name = (id: string) => sourceNames[id] ?? id;
  const total = plan.remove.length + plan.swaps.length + plan.deleteIds.length;
  const hasMain = useMemo(() => foreign.some((f) => books.some((b) => b.sourceId === f.id && mainCopy(b.number))), [foreign, books, mainCopy]);
  return (
    <Modal title={tr('Remove chapters from other sources')} onClose={onClose} wide>
      <p className="text-sm text-fog-300">{tr('These chapters are on the server but did not come from {main}, this series’ main source.', { main: name(primary) })}</p>
      <ul className="mt-3 space-y-1.5" data-cull-sources>
        {foreign.map((f) => (
          <li key={f.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-ink-700 px-3 py-2 text-sm">
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} />
              <span className="min-w-0 flex-1 truncate text-fog-100">{name(f.id)}</span>
              <span className="shrink-0 text-xs text-fog-500">{f.count === 1 ? tr('1 chapter') : tr('{n} chapters', { n: f.count })}</span>
            </label>
          </li>
        ))}
      </ul>
      {hasMain && (
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-fog-200">
          <input type="checkbox" className="mt-1" checked={swap} onChange={() => setSwap((v) => !v)} data-cull-swap />
          <span>{tr('Where {main} has the same chapter number, fetch its copy instead of leaving a gap.', { main: name(primary) })}</span>
        </label>
      )}
      <ul className="mt-4 space-y-1 text-sm text-fog-300" data-cull-summary>
        {plan.remove.length > 0 && <li>{plan.remove.length === 1 ? tr('1 chapter will be deleted and removed from the series.') : tr('{n} chapters will be deleted and removed from the series.', { n: plan.remove.length })}</li>}
        {plan.swaps.length > 0 && <li>{plan.swaps.length === 1 ? tr('1 chapter will be replaced with the main source’s copy.') : tr('{n} chapters will be replaced with the main source’s copy.', { n: plan.swaps.length })}</li>}
        {plan.deleteIds.length > 0 && <li>{plan.deleteIds.length === 1 ? tr('1 duplicate file will be deleted.') : tr('{n} duplicate files will be deleted.', { n: plan.deleteIds.length })}</li>}
        {plan.notOurs > 0 && <li className="text-amber-300/90">{skippedNotOursText(plan.notOurs)}</li>}
        {total === 0 && <li className="text-fog-500">{tr('Nothing to remove with these sources.')}</li>}
      </ul>
      <p className="mt-3 text-xs text-fog-500">{tr('A chapter somebody has bookmarked is skipped. “Removed chapters” on this page brings a removed chapter back.')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-key" onClick={onClose} disabled={busy}>{tr('Cancel')}</button>
        <button type="button" className="btn-key btn-key-danger" data-cull-apply disabled={busy || total === 0} onClick={() => onApply(plan)}>
          {busy ? '…' : tr('Remove {n}', { n: total })}
        </button>
      </div>
    </Modal>
  );
}
