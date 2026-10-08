'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lockup } from './Brand';
import { IcHome, IcGrid, IcSearch, IcRefresh, IcBell, IcSparkle, IcPlus, IcBookmark, IcMoments, IcDownload } from './icons';
import { triggerRefresh } from '@/lib/refresh';
import { api } from '@/lib/api';
import { useAuth, canDownload } from '@/lib/auth';
import { Avatar } from './Avatar';
import { HealthMarker } from './HealthAlert';
import { DownloadsNavIcon } from './DownloadsRing';
import { useToast } from './Toast';
import { keys, t as tr } from '@/lib/i18n';
import { isDesktop, DESKTOP_HIDDEN } from '@/lib/desktop';
import { navIconCls } from '@/lib/navStyle';

// `keys()` is the identity function; it exists so these reach the translation extractor, which
// cannot see a label rendered as `tr(label)`. This nav shipped untranslated once already.
// See lib/i18n.ts.
// ⚠️ The labels are POSITIONAL indices into that array, so removing one renumbers every entry after it --
// silently, with no type error, relabelling the tabs that follow. Browse came out here; Lists and Discover
// moved from 3,4 to 2,3.
const NAV_LABELS = keys('Home', 'Library', 'Lists', 'Discover', 'Downloads');
const links = [
  { href: '/', label: NAV_LABELS[0], Icon: IcHome, match: (p: string) => p === '/' },
  { href: '/library', label: NAV_LABELS[1], Icon: IcGrid, match: (p: string) => p.startsWith('/library') || p.startsWith('/series') },
  { href: '/collections', label: NAV_LABELS[2], Icon: IcBookmark, match: (p: string) => p.startsWith('/collection') },
  { href: '/discover', label: NAV_LABELS[3], Icon: IcPlus, match: (p: string) => p.startsWith('/discover') },
  // The chapters saved on THIS device. Last, so the four above keep their positions; hidden on Uchiyomi Desktop
  // (DESKTOP_HIDDEN.navHrefs: the files are already on this disk) and for an account that may not download.
  { href: '/downloads', label: NAV_LABELS[4], Icon: IcDownload, match: (p: string) => p.startsWith('/downloads') },
];

export function TopNav({ onSearchFocus }: { onSearchFocus?: () => void }) {
  const path = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const { user, status } = useAuth();
  const offline = status === 'offline';
  const [refreshing, setRefreshing] = useState(false);
  // `enabled`, not a conditional call: hooks must run in the same order every render. Offline this would be
  // a request at a dead network, and the browser harness counts every console error.
  const { data: upd } = useQuery({ queryKey: ['updates'], queryFn: () => api<{ content: any[] }>('/api/updates'), staleTime: 120000, enabled: !offline });
  const updCount = upd?.content?.length ?? 0;
  // Discover and Downloads are for an account that may download; Downloads is also gone on Uchiyomi Desktop.
  const shownLinks = canDownload(user)
    ? links.filter((l) => !(isDesktop() && (DESKTOP_HIDDEN.navHrefs as readonly string[]).includes(l.href)))
    : links.filter((l) => l.href !== '/discover' && l.href !== '/downloads');

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    // One card: "Library refreshed" takes the place of the busy one (the same key).
    toast(tr('Checking for new chapters…'), 'info', { busy: true, key: 'refresh' });
    await triggerRefresh();
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ['home'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      toast(tr('Library refreshed'), 'success', { key: 'refresh' });
      setRefreshing(false);
    }, 1800);
  };

  // ⚠️ IT HAS TO FIT AT 1024 px, in every language. From lg to xl the row is 960 px, and in Russian the four
  // nav links alone are 540: with the logo's words, a 288 px search and the round buttons it ran 170-220 px
  // past the window, the page scrolled sideways, and the flex row squeezed every round button into a 21 px
  // oval (v0.49.0 added the downloads button, which is how it was noticed). So below xl the gaps are 12 px,
  // the logo is its mark (the words stay for screen readers), and the search is the one thing that gives:
  // it takes what is left, down to its icon. Everything round keeps its 40 px (`shrink-0`).
  // ⚠️ Down to its icon, not to a sliver of its word: squeezed to ~60 px (Russian, an admin with the Health mark,
  // at 1024 px and at exactly 1280 px) the truncating label had 4 px, too few for an ellipsis, so a stroke of the
  // "П" stood beside the magnifier. The button is a size container, and the label (and the ⌘K hint) show only
  // when the button has room for them; the title and the accessible name stay.
  // web/test/e2e/layout.mjs measures the header at 1024 and 1280 px in de and ru.
  return (
    <header className="sticky top-0 z-40 hidden border-b border-ink-800/70 bg-ink-950/80 backdrop-blur-xl lg:block">
      <div className="shell flex items-center gap-3 py-3 xl:gap-6">
        <Link href="/" className="shrink-0"><Lockup className="text-2xl max-xl:sr-only" markSize={38} /></Link>
        <nav aria-label={tr('Main')} className="flex shrink-0 items-center gap-1">
          {shownLinks.map(({ href, label, Icon, match }) => {
            const active = match(path);
            return (
              <Link key={href} href={href} aria-disabled={offline || undefined} aria-current={active ? 'page' : undefined}
                onClick={offline ? (e) => e.preventDefault() : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition xl:px-3.5 ${active ? 'bg-accent-soft text-accent' : 'text-fog-400 hover:text-fog-100'}${offline ? ' pointer-events-none opacity-35' : ''}`}>
                <Icon width={18} height={18} />
                {/* Downloads is the fifth link: below xl its word gives way to its icon (the header must fit at 1024 px). */}
                {href === '/downloads' ? <span className="max-xl:sr-only">{tr(label)}</span> : tr(label)}
              </Link>
            );
          })}
        </nav>
        <button type="button" onClick={onSearchFocus} title={tr('Search…')} aria-label={tr('Search…')}
          className="ms-auto flex min-w-0 max-w-72 flex-1 @container items-center justify-center gap-2 overflow-hidden rounded-full border border-ink-700 bg-ink-850 px-3.5 py-2 text-start transition hover:border-accent/50">
          <IcSearch width={18} height={18} className="shrink-0 text-fog-400" />
          <span data-search-label className="hidden min-w-0 flex-1 truncate text-sm text-fog-400 @[4.5rem]:block">{tr('Search…')}</span>
          <kbd data-search-kbd className="hidden shrink-0 rounded-md border border-ink-700 px-1.5 py-0.5 text-xs text-fog-400 xl:@[12rem]:block" aria-hidden>⌘K</kbd>
        </button>
        {/* Secondary destination, so it sits in the right-hand cluster with Updates rather than becoming a
            sixth primary nav item -- the five on the left are the shape of the library, and Moments is a
            view of what you saved out of it. */}
        <Link href="/moments" title={tr('Moments')} aria-label={tr('Moments')} aria-current={path.startsWith('/moments') ? 'page' : undefined}
          className={navIconCls(path.startsWith('/moments'))}>
          <IcMoments width={19} height={19} />
        </Link>
        {/* Admins only, and only while the last Health report was not clean (#101). */}
        <HealthMarker />
        {/* What the server is fetching (v0.49.0, the pill's successor): just before the bell, so the two
            "something came in" buttons sit together. A viewer who may not download gets nothing here. */}
        <DownloadsNavIcon />
        <Link href="/updates" title={tr('Updates')} aria-label={updCount > 0 ? `${tr('Updates')} · ${updCount}` : tr('Updates')} aria-current={path.startsWith('/updates') ? 'page' : undefined} className={navIconCls(path.startsWith('/updates'), 'relative')}>
          <IcBell width={19} height={19} />
          {/* A squared tag, like the downloads ring's count beside it: a round one grows into a capsule at "9+". */}
          {updCount > 0 && <span data-updates-count className="absolute -end-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-[4px] bg-accent px-[3px] text-[11px] font-bold leading-none tabular-nums text-black">{updCount > 9 ? '9+' : updCount}</span>}
        </Link>
        <button onClick={refresh} type="button" title={tr('Check for new chapters')} aria-label={tr('Check for new chapters')} aria-busy={refreshing || undefined}
          className={`${navIconCls(refreshing)}${refreshing ? ' animate-spin' : ''}`}>
          <IcRefresh width={19} height={19} />
        </button>
        <Link href="/profile" className={`shrink-0 rounded-full transition hover:opacity-80 ${path.startsWith('/profile') ? 'ring-2 ring-accent ring-offset-2 ring-offset-ink-950' : ''}`} aria-label={tr('Profile')} aria-current={path.startsWith('/profile') ? 'page' : undefined}>
          <Avatar avatar={user?.avatar} size={40} />
        </Link>
      </div>
    </header>
  );
}
