'use client';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { IcChevronLeft } from '@/components/icons';
import { HOME_ROWS, homeRowOrder, homeRowsHidden, isDefaultHomeRows, type HomeRowId, type HomeRowsSetting } from '@/lib/homeRows';
import { t as tr } from '@/lib/i18n';

const LABELS: Record<HomeRowId, () => string> = {
  continue: () => tr('Keep reading'),
  updates: () => tr('New episodes'),
  favorites: () => tr('Your favorites'),
  because: () => tr('Because you read…'),
  rated: () => tr('Because you rated…'),
  collections: () => tr('Your collections'),
  added: () => tr('Recently added'),
  top: () => tr('Top 10 in your library'),
};

export function HomeRowsSheet({ onClose }: { onClose: () => void }) {
  const { user, setSettings } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const saved = user?.settings?.homeRows as HomeRowsSetting | undefined;
  const order = homeRowOrder(saved);
  const hidden = homeRowsHidden(saved);

  const save = async (next: { order: HomeRowId[]; hidden: HomeRowId[] }) => {
    const previous = saved;
    setSettings({ homeRows: next });
    try { await api('/api/settings', { method: 'PUT', json: { homeRows: next } }); qc.invalidateQueries({ queryKey: ['home'] }); }
    catch { setSettings({ homeRows: previous }); toast(tr('Could not save'), 'error'); }
  };
  const move = (id: HomeRowId, by: -1 | 1) => {
    const from = order.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    void save({ order: next, hidden: [...hidden] });
  };
  const toggle = (id: HomeRowId) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id); else h.add(id);
    void save({ order, hidden: [...h] });
  };

  return (
    <Sheet title={tr('Customize Home')} onClose={onClose} overBottomNav
      footer={<button type="button" disabled={isDefaultHomeRows(saved)} onClick={() => void save({ order: [...HOME_ROWS], hidden: [] })} className="btn-ghost w-full disabled:opacity-40">{tr('Reset to default')}</button>}>
      <p className="px-5 pb-3 text-xs text-fog-400">{tr('Reorder the rows on Home or hide the ones you do not want. A row with nothing to show stays out of the way either way.')}</p>
      <ul className="px-3 pb-4">
        {order.map((id, i) => {
          const off = hidden.has(id);
          return (
            <li key={id} data-home-row={id} className="flex items-center gap-2 rounded-xl px-2 py-2">
              <span className={`min-w-0 flex-1 truncate text-sm ${off ? 'text-fog-500 line-through' : 'text-fog-100'}`}>{LABELS[id]()}</span>
              <button type="button" disabled={i === 0} onClick={() => move(id, -1)} aria-label={tr('Move up')} className="grid h-9 w-9 place-items-center rounded-full text-fog-300 disabled:opacity-30">
                <IcChevronLeft width={18} height={18} className="rotate-90" />
              </button>
              <button type="button" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={tr('Move down')} className="grid h-9 w-9 place-items-center rounded-full text-fog-300 disabled:opacity-30">
                <IcChevronLeft width={18} height={18} className="-rotate-90" />
              </button>
              <button type="button" role="switch" aria-checked={!off} onClick={() => toggle(id)} className={`chip text-xs ${off ? '' : 'chip-active'}`}>{off ? tr('Hidden') : tr('Shown')}</button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
