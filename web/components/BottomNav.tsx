'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { IcHome, IcGrid, IcSearch, IcDownload, IcMore, IcPlus } from './icons';
import { useAuth, canDownload } from '@/lib/auth';
import { keys, t as tr } from '@/lib/i18n';
import { isDesktop, DESKTOP_HIDDEN } from '@/lib/desktop';
import { useLayer } from '@/lib/layers';
import { useDownloadsRing } from '@/lib/useServerDownloads';
import { LibraryTabIcon } from './DownloadsRing';
import { MoreSheet } from './MoreSheet';
import { moreMatch } from '@/lib/moreMenu';

// `keys()` is the identity function; it exists so these reach the translation extractor, which
// cannot see a label rendered as `tr(label)`. This nav shipped untranslated once already.
// See lib/i18n.ts.
const NAV_LABELS = keys('Home', 'Library', 'Search', 'Discover', 'Offline', 'More');
// The sixth tab used to be "You" (/profile). It is More now: Profile & settings is the sheet's own row, beside the
// pages the bar had no way to reach (Lists, Favorites, Updates, Moments, History, Wrapped, Downloads, Admin).
const items: { href: string; label: string; Icon: typeof IcHome; match: (p: string) => boolean; more?: boolean }[] = [
  { href: '/', label: NAV_LABELS[0], Icon: IcHome, match: (p: string) => p === '/' },
  { href: '/library', label: NAV_LABELS[1], Icon: IcGrid, match: (p: string) => p.startsWith('/library') || p.startsWith('/series') },
  { href: '/search', label: NAV_LABELS[2], Icon: IcSearch, match: (p: string) => p.startsWith('/search') },
  // Discover had no entry here at all, on a phone-first PWA, while being item five of five on the desktop
  // nav. The page that adds new series was reachable only from a small + on the library page.
  { href: '/discover', label: NAV_LABELS[3], Icon: IcPlus, match: (p: string) => p.startsWith('/discover') },
  { href: '/downloads', label: NAV_LABELS[4], Icon: IcDownload, match: (p: string) => p.startsWith('/downloads') },
  { href: '/profile', label: NAV_LABELS[5], Icon: IcMore, match: moreMatch, more: true },
];

export function BottomNav() {
  const path = usePathname();
  const { user, status } = useAuth();
  const [more, setMore] = useState(false);
  // Any navigation closes the sheet (its links also close it on tap; this covers back/forward and the palette).
  useEffect(() => { setMore(false); }, [path]);
  // On the notices' layer stack (lib/layers.ts): with the nav up, a notice sits above it rather than under it,
  // and while a dialog is open a notice takes the bar's place -- measured, so it covers the bar exactly
  // rather than leaving half of its icons showing above it.
  const barRef = useRef<HTMLDivElement>(null);
  useLayer('nav', true, { ref: barRef });
  // What the server is fetching, on the Library tab (v0.49.0; the floating pill is gone). The tab still leads
  // to the Library -- a destination that changed with the server's state would surprise -- and Downloads is
  // one tap away there. Nothing at all for an account that may not download.
  const ring = useDownloadsRing();
  // Offline, only Downloads leads anywhere: every other tab is assembled from the server. They stay VISIBLE
  // and go inert rather than disappearing -- a nav that loses four of its six items reads as the app having
  // broken, which is the opposite of what an offline mode should communicate.
  const offline = status === 'offline';
  // An account that may not add series has nothing to do on Discover -- every route the page calls is now
  // refused for it -- so the tab is a promise the app cannot keep. The page itself says so if you type it.
  const allowed = canDownload(user) ? items : items.filter((i) => i.href !== '/discover');
  // Uchiyomi Desktop has no Offline tab: the chapters are already on this disk (lib/desktop.ts).
  const shown = isDesktop() ? allowed.filter((i) => !(DESKTOP_HIDDEN.navHrefs as readonly string[]).includes(i.href)) : allowed;
  return (
    <>
    <nav aria-label={tr('Main')} className="safe-bottom fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="mx-auto max-w-2xl px-4 pb-2">
        <div ref={barRef} className="glass grad-border flex items-center justify-around rounded-3xl px-1 py-1.5 shadow-lift">
          {shown.map(({ href, label, Icon, match, more: isMore }) => {
            const active = match(path);
            const dead = offline && href !== '/downloads';
            const ringed = href === '/library' && ring.show;
            const tabCls = `group relative flex min-w-0 flex-1 flex-col items-center gap-1 py-2${dead ? ' pointer-events-none opacity-35' : ''}`;
            const inner = (
              <>
                {active && (
                  <motion.span layoutId="navpill" className="absolute inset-x-2 inset-y-1 rounded-2xl bg-accent-soft" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                )}
                <span className={`relative z-10 transition ${active ? 'text-accent' : 'text-fog-400 group-active:text-fog-200'}`}>
                  {ringed ? <LibraryTabIcon ring={ring}><Icon width={22} height={22} /></LibraryTabIcon> : <Icon width={22} height={22} />}
                </span>
                <span className={`relative z-10 whitespace-nowrap text-xs font-medium ${active ? 'text-accent' : 'text-fog-300'}`}>{tr(label)}</span>
              </>
            );
            // More opens a sheet rather than going anywhere, so it is a button; it is as inert offline as the tabs
            // it sits with (everything in it is assembled from the server).
            if (isMore) {
              return (
                <button key={href} type="button" aria-haspopup="dialog" aria-expanded={more} aria-disabled={dead || undefined} aria-current={active ? 'page' : undefined}
                  onClick={dead ? undefined : () => setMore(true)} data-nav-more className={tabCls}>{inner}</button>
              );
            }
            return (
              <Link key={href} href={href} aria-disabled={dead || undefined} aria-current={active ? 'page' : undefined}
                onClick={dead ? (e) => e.preventDefault() : undefined}
                aria-label={ringed && ring.label ? `${tr(label)} · ${ring.label}` : undefined}
                className={tabCls}>{inner}</Link>
            );
          })}
        </div>
      </div>
    </nav>
    {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}
