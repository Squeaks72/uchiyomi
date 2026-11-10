// What the phone's "More" sheet lists (components/MoreSheet.tsx): every page the five tabs have no room for.
// Pure and icon-free so the rules (who sees Admin, who sees Downloads, what is gone on Uchiyomi Desktop) are
// testable; the sheet pairs each key with an icon.
import { t as tr } from './i18n';
import { downloadsHref } from './libraryView';

export type MoreKey = 'lists' | 'favorites' | 'updates' | 'moments' | 'history' | 'wrapped' | 'downloads' | 'profile' | 'admin';
export interface MoreEntry { key: MoreKey; label: string; href: string }

/** The routes the More tab stands for: it is "current" on any of them. */
export const MORE_PREFIXES = ['/profile', '/settings', '/admin', '/collection', '/updates', '/moments', '/history', '/wrapped'] as const;
export const moreMatch = (path: string): boolean => MORE_PREFIXES.some((p) => path.startsWith(p));

export function moreEntries(o: { admin: boolean; mayDownload: boolean }): MoreEntry[] {
  return [
    { key: 'lists', label: tr('Lists'), href: '/collections/' },
    { key: 'favorites', label: tr('Favorites'), href: '/collection/?id=favorites' },
    { key: 'updates', label: tr('Updates'), href: '/updates/' },
    { key: 'moments', label: tr('Moments'), href: '/moments/' },
    { key: 'history', label: tr('Reading history'), href: '/history/' },
    { key: 'wrapped', label: tr('Wrapped'), href: '/wrapped/' },
    // What the server is fetching (Library -> Downloads); the Offline tab is this device's copies.
    ...(o.mayDownload ? [{ key: 'downloads' as const, label: tr('Downloads'), href: downloadsHref() }] : []),
    { key: 'profile', label: tr('Profile & settings'), href: '/profile/' },
    ...(o.admin ? [{ key: 'admin' as const, label: tr('Admin'), href: '/admin/' }] : []),
  ];
}
