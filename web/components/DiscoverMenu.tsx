'use client';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { applyFavorite } from '@/lib/favoriteCache';
import { t as tr } from '@/lib/i18n';
import { useToast } from './Toast';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { useAdultMark } from './useAdultMark';

/**
 * The menu of a card on Discover -- the newest wall, a search result, a trending title -- the way a library card has
 * one (SeriesMenu.tsx): right-click, press-and-hold or Shift+F10. Short, and by what the card can do: add it, or open
 * the library entry it already is; search every source for the title; copy it. The card's own click stays the
 * primary action, so nothing here is the only way to anything.
 */
export function useDiscoverMenu({ title, libraryHref, librarySeriesId, onAdd, addLabel, onSearch, onDescribe }: {
  title: string;
  /** The library entry the title already is: offered instead of Add. */
  libraryHref?: string;
  /** The library entry's id: with it the menu can favourite the title (only a series you hold can be one). */
  librarySeriesId?: string;
  onAdd?: () => void;
  /** The add item's words when it is not plain Add: another edition of a title the library holds. */
  addLabel?: string;
  onSearch?: (title: string) => void;
  /** Opens the at-a-glance card: the way to it on a touch screen, where a thumbnail has no hover. */
  onDescribe?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const favs = useQuery({
    queryKey: ['favorite-ids'], enabled: !!librarySeriesId, staleTime: 60_000,
    queryFn: () => api<{ ids: string[] }>('/api/favorites/ids').then((r) => r.ids),
  });
  const isFav = !!librarySeriesId && !!favs.data?.includes(librarySeriesId);
  const toggleFav = async () => {
    if (!librarySeriesId) return;
    const next = !isFav;
    const had = favs.data ?? [];
    qc.setQueryData(['favorite-ids'], next ? [...had, librarySeriesId] : had.filter((i) => i !== librarySeriesId));
    try {
      if (next) await api('/api/favorites', { json: { seriesId: librarySeriesId } });
      else await api(`/api/favorites/${librarySeriesId}`, { method: 'DELETE' });
      toast(next ? tr('Added to favorites') : tr('Removed from favorites'), 'success');
      applyFavorite(qc, librarySeriesId, next);
      qc.invalidateQueries({ queryKey: ['home'] });
      qc.invalidateQueries({ queryKey: ['library'] });
    } catch {
      qc.setQueryData(['favorite-ids'], had);
      toast(tr('Could not change the favorite'), 'error');
    }
  };
  const adultItem = useAdultMark(title, librarySeriesId);
  const items = (): MenuItem[] => [
    ...(onDescribe ? [{ label: tr('Description and details'), onSelect: onDescribe }] : []),
    ...(libraryHref ? [
      { label: tr('Open in library'), onSelect: () => router.push(libraryHref) },
      { label: tr('Open in a new tab'), onSelect: () => { window.open(libraryHref, '_blank', 'noopener'); } },
    ] : []),
    ...(librarySeriesId ? [{ label: isFav ? tr('Remove from favorites') : tr('Favorite'), onSelect: toggleFav }] : []),
    ...(onAdd ? [{ label: addLabel ?? tr('Add to library'), divider: !!libraryHref, onSelect: onAdd }] : []),
    ...(onSearch ? [{ label: tr('Search all sources for this title'), divider: !!(libraryHref || onAdd), onSelect: () => onSearch(title) }] : []),
    {
      label: tr('Copy title'), divider: !onSearch && !!(libraryHref || onAdd),
      onSelect: async () => {
        try { await navigator.clipboard.writeText(title); toast(tr('Title copied'), 'success'); }
        catch { toast(tr('Could not copy the title'), 'error'); }
      },
    },
    ...adultItem,
  ];
  return useContextMenu(items, { label: title });
}
