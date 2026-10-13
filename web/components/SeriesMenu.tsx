'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import type { Series } from '@/lib/types';
import { useToast } from './Toast';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { useSeriesActions } from './SeriesActions';
import { SeriesPropertiesSheet } from './SeriesPropertiesSheet';

/**
 * A series card's menu (#100): the few things worth doing without opening the series, from wherever it is on
 * screen -- the library grid, Home's rails, the admin console, the reader's Up next.
 *
 * Deliberately short (the proposal's own instinct): the cards are links, so Open in a new tab and Copy link
 * stand in for what the browser's menu offered; then what the Library's Select mode already does for many
 * series, here for one; and for an admin, a check for new chapters; for anyone who may download, the slow
 * archive of the rest (#117). Offered by role, never offered and then refused, and greyed rather than hidden
 * while offline. Anything larger is the series page, one click away.
 */
export function useSeriesMenu(series: Series, onDescribe?: () => void, opts?: { keepReading?: boolean; onSelect?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { status } = useAuth();
  const offline = status === 'offline';
  const actions = useSeriesActions();
  const href = `/series/?id=${encodeURIComponent(series.id)}`;
  // A card built from a book (Home's Keep reading) carries no `yomi`: its favourite state comes from the id list.
  const favIds = useQuery({
    queryKey: ['favorite-ids'], enabled: !series.yomi, staleTime: 60_000,
    queryFn: () => api<{ ids: string[] }>('/api/favorites/ids').then((r) => r.ids),
  });
  const favourite = series.yomi ? !!series.yomi.favorite : !!favIds.data?.includes(series.id);
  const [properties, setProperties] = useState(false);

  // Home's Keep reading row only: the series stays in the library and returns to the row when it is read again.
  const leaveKeepReading = async () => {
    try {
      await api(`/api/keep-reading/${encodeURIComponent(series.id)}`, { method: 'PUT', json: { hidden: true } });
      toast(tr('Removed from Keep reading. Reading it again brings it back.'), 'success');
      qc.invalidateQueries({ queryKey: ['home'] });
    } catch { toast(tr('Could not do that'), 'error'); }
  };

  const items = (): MenuItem[] => [
    ...(onDescribe ? [{ label: tr('Description and details'), onSelect: onDescribe }] : []),
    ...(opts?.onSelect ? [{ label: tr('Select'), hook: 'start-select', onSelect: opts.onSelect }] : []),
    { label: tr('Open in a new tab'), onSelect: () => { window.open(href, '_blank', 'noopener'); } },
    {
      label: tr('Copy link'),
      onSelect: async () => {
        try { await navigator.clipboard.writeText(new URL(href, window.location.href).toString()); toast(tr('Link copied'), 'success'); }
        catch { toast(tr('Could not copy the link'), 'error'); }
      },
    },
    ...actions.items([series.id], { favourite }).map((it, k) => (k === 0 ? { ...it, divider: true } : it)),
    ...(opts?.keepReading ? [{ label: tr('Remove from Keep reading'), disabled: offline, hook: 'leave-keep-reading', onSelect: leaveKeepReading }] : []),
    { label: tr('Properties…'), divider: true, onSelect: () => setProperties(true) },
  ];

  const menu = useContextMenu(items, { label: series.metadata?.title || series.name });
  // The sheet rides on the menu's `element`, so every card that renders the menu renders it too.
  const element = <>{menu.element}{actions.element}{properties && <SeriesPropertiesSheet series={series} onClose={() => setProperties(false)} />}</>;
  return { ...menu, element };
}
