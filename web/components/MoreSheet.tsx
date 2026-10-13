'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Sheet } from './ui';
import { IcBookmark, IcHeart, IcBell, IcMoments, IcClock, IcSparkle, IcCloudDownload, IcSettings, IcSliders, IcSearch, IcChevronRight } from './icons';
import { useAuth, canDownload } from '@/lib/auth';
import { t as tr } from '@/lib/i18n';
import { moreEntries, type MoreKey } from '@/lib/moreMenu';
import { openPalette } from '@/lib/palette';
import { Avatar } from './Avatar';
import { QuickSettingsSheet } from './ProfileMenu';

const ICONS: Record<MoreKey, (p: { width: number; height: number }) => React.ReactElement> = {
  lists: IcBookmark, favorites: IcHeart, updates: IcBell, moments: IcMoments, history: IcClock, wrapped: IcSparkle,
  downloads: IcCloudDownload, profile: IcSettings, admin: IcSliders,
};

/**
 * The phone's "More" sheet: the destinations the five tabs have no room for (Lists, Favorites, Updates, Moments,
 * History, Wrapped, Downloads, Profile & settings, Admin), and the command palette, which a phone has no hotkey for.
 *
 * A `Sheet` (components/ui.tsx), so it is on the notices' layer stack, closes on Escape and on the backdrop, traps
 * Tab and gives focus back. Like every sheet opened from a page with a nav it passes `overBottomNav`
 * (test/notices.test.ts); its backdrop covers the bar, and Sheet pads the safe area.
 */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const { user, isAdmin, status } = useAuth();
  const [quick, setQuick] = useState(false);
  const entries = moreEntries({ admin: isAdmin, mayDownload: status === 'authed' && canDownload(user) });
  const row = 'flex w-full items-center gap-3 rounded-xl px-2 py-3 text-start text-sm text-fog-100 hover:bg-ink-800/70 active:bg-ink-800';
  const chip = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-700 text-fog-300';
  if (quick) return <QuickSettingsSheet onClose={onClose} />;
  return (
    <Sheet title={tr('More')} onClose={onClose} overBottomNav>
      <ul className="pb-2">
        <li className="mb-1 border-b border-ink-800/70 pb-1">
          <button type="button" data-more="quick" aria-haspopup="dialog" onClick={() => setQuick(true)} className={row}>
            <Avatar avatar={user?.avatar} size={36} />
            <span className="min-w-0 flex-1 truncate">{user?.displayName}</span>
            <span className="shrink-0 text-xs text-fog-400">{tr('Quick settings')}</span>
          </button>
        </li>
        {entries.map((e) => {
          const Icon = ICONS[e.key];
          return (
            <li key={e.key}>
              <Link href={e.href} onClick={onClose} data-more={e.key} className={row}>
                <span className={chip}><Icon width={18} height={18} /></span>
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <IcChevronRight width={16} height={16} aria-hidden className="shrink-0 text-fog-400 rtl:-scale-x-100" />
              </Link>
            </li>
          );
        })}
        <li className="mt-1 border-t border-ink-800/70 pt-1">
          <button type="button" data-more="palette" onClick={() => { onClose(); openPalette(''); }} className={row}>
            <span className={chip}><IcSearch width={18} height={18} /></span>
            <span className="min-w-0 flex-1 truncate">{tr('Search pages, settings and actions')}</span>
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
