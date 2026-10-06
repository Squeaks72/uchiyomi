'use client';
import { useRouter } from 'next/navigation';
import { t as tr } from '@/lib/i18n';
import { useToast } from './Toast';
import { useContextMenu, type MenuItem } from './ContextMenu';

/**
 * The menu of a card on Discover -- the newest wall, a search result, a trending title -- the way a library card has
 * one (SeriesMenu.tsx): right-click, press-and-hold or Shift+F10. Short, and by what the card can do: add it, or open
 * the library entry it already is; search every source for the title; copy it. The card's own click stays the
 * primary action, so nothing here is the only way to anything.
 */
export function useDiscoverMenu({ title, libraryHref, onAdd, onSearch }: {
  title: string;
  /** The library entry the title already is: offered instead of Add. */
  libraryHref?: string;
  onAdd?: () => void;
  onSearch?: (title: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const items = (): MenuItem[] => [
    ...(libraryHref ? [
      { label: tr('Open in library'), onSelect: () => router.push(libraryHref) },
      { label: tr('Open in a new tab'), onSelect: () => { window.open(libraryHref, '_blank', 'noopener'); } },
    ] : onAdd ? [{ label: tr('Add to library'), onSelect: onAdd }] : []),
    ...(onSearch ? [{ label: tr('Search all sources for this title'), divider: !!(libraryHref || onAdd), onSelect: () => onSearch(title) }] : []),
    {
      label: tr('Copy title'), divider: !onSearch && !!(libraryHref || onAdd),
      onSelect: async () => {
        try { await navigator.clipboard.writeText(title); toast(tr('Title copied'), 'success'); }
        catch { toast(tr('Could not copy the title'), 'error'); }
      },
    },
  ];
  return useContextMenu(items, { label: title });
}
